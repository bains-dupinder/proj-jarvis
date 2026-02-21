import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openMemoryDb, type MemoryDb } from '../src/memory/db.js'
import { chunkText, IndexManager } from '../src/memory/indexer.js'
import { hybridSearch } from '../src/memory/search.js'
import { float32ToBlob, blobToFloat32 } from '../src/memory/embeddings.js'
import { indexSessionTranscripts } from '../src/memory/session-files.js'

// ─── chunkText ──────────────────────────────────────────────

describe('chunkText', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(chunkText(''), [])
    assert.deepEqual(chunkText('   '), [])
  })

  it('returns single chunk for short text', () => {
    const result = chunkText('hello world foo bar')
    assert.equal(result.length, 1)
    assert.equal(result[0], 'hello world foo bar')
  })

  it('chunks long text with overlap', () => {
    // Create text with exactly 800 words → should produce multiple chunks
    const words = Array.from({ length: 800 }, (_, i) => `word${i}`)
    const text = words.join(' ')
    const chunks = chunkText(text)

    // With 400 word chunks and 50 overlap, stride = 350
    // 800 words → ceil((800 - 400) / 350) + 1 = ~2-3 chunks
    assert.ok(chunks.length >= 2, `Expected ≥ 2 chunks, got ${chunks.length}`)

    // First chunk should start with word0
    assert.ok(chunks[0]!.startsWith('word0'))

    // Verify overlap: second chunk should contain words from the tail of the first
    // First chunk covers words 0-399, second covers 350-749 (overlap at 350-399)
    assert.ok(chunks[1]!.includes('word350'), 'Overlap should include word350')
    assert.ok(chunks[1]!.includes('word399'), 'Overlap should include word399')
  })
})

// ─── float32 blob conversion ──────────────────────────────────

describe('float32ToBlob / blobToFloat32', () => {
  it('round-trips a vector', () => {
    const vec = [1.0, -0.5, 0.25, 3.14159]
    const blob = float32ToBlob(vec)
    const restored = blobToFloat32(blob)

    assert.equal(restored.length, vec.length)
    for (let i = 0; i < vec.length; i++) {
      assert.ok(
        Math.abs(restored[i]! - vec[i]!) < 1e-5,
        `Index ${i}: ${restored[i]} != ${vec[i]}`,
      )
    }
  })

  it('handles empty vector', () => {
    const blob = float32ToBlob([])
    const restored = blobToFloat32(blob)
    assert.equal(restored.length, 0)
  })
})

// ─── openMemoryDb ──────────────────────────────────────────

describe('openMemoryDb', () => {
  let tmpDir: string
  let db: MemoryDb

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jarvis-mem-'))
  })

  after(async () => {
    try { db?.close() } catch { /* ok */ }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates tables on open', () => {
    db = openMemoryDb(join(tmpDir, 'test.db'))

    // Verify tables exist by inserting a file record
    db.prepare('INSERT INTO files (path, hash, indexed_at) VALUES (?, ?, ?)').run(
      '/tmp/test.txt', 'abc123', Date.now(),
    )

    const row = db.prepare('SELECT path FROM files WHERE path = ?').get('/tmp/test.txt') as { path: string }
    assert.equal(row.path, '/tmp/test.txt')
  })

  it('is idempotent (re-open same db)', () => {
    db.close()
    db = openMemoryDb(join(tmpDir, 'test.db'))

    // Data should persist
    const row = db.prepare('SELECT path FROM files WHERE path = ?').get('/tmp/test.txt') as { path: string }
    assert.equal(row.path, '/tmp/test.txt')
  })
})

// ─── IndexManager ──────────────────────────────────────────

describe('IndexManager', () => {
  let tmpDir: string
  let db: MemoryDb
  let indexer: IndexManager

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jarvis-idx-'))
    db = openMemoryDb(join(tmpDir, 'test.db'))
    indexer = new IndexManager(db, null) // No embedder, keyword-only
  })

  after(async () => {
    try { db.close() } catch { /* ok */ }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('indexes a text file into chunks', async () => {
    // Create a small test file
    const filePath = join(tmpDir, 'sample.txt')
    await writeFile(filePath, 'The quick brown fox jumps over the lazy dog. This is a test of the indexing system.', 'utf-8')

    const result = await indexer.sync([filePath])
    assert.equal(result.indexed, 1)
    assert.equal(result.skipped, 0)

    // Verify chunks were created
    const chunks = db.prepare('SELECT content FROM chunks WHERE file_path = ?').all(filePath) as Array<{ content: string }>
    assert.ok(chunks.length >= 1, 'Should have at least 1 chunk')
    assert.ok(chunks[0]!.content.includes('quick brown fox'))
  })

  it('skips files that have not changed', async () => {
    const filePath = join(tmpDir, 'sample.txt')
    const result = await indexer.sync([filePath])
    assert.equal(result.indexed, 0)
    assert.equal(result.skipped, 1)
  })

  it('re-indexes when file content changes', async () => {
    const filePath = join(tmpDir, 'sample.txt')
    await writeFile(filePath, 'Completely different content now.', 'utf-8')

    const result = await indexer.sync([filePath])
    assert.equal(result.indexed, 1)
    assert.equal(result.skipped, 0)

    const chunks = db.prepare('SELECT content FROM chunks WHERE file_path = ?').all(filePath) as Array<{ content: string }>
    assert.ok(chunks.length >= 1)
    assert.ok(chunks[0]!.content.includes('Completely different'))
  })

  it('handles non-existent files gracefully', async () => {
    const result = await indexer.sync(['/no/such/file.txt'])
    assert.equal(result.indexed, 0)
    assert.equal(result.skipped, 0)
  })
})

// ─── hybridSearch (keyword-only, no embedder) ──────────────

describe('hybridSearch (keyword-only)', () => {
  let tmpDir: string
  let db: MemoryDb

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jarvis-search-'))
    db = openMemoryDb(join(tmpDir, 'test.db'))

    const indexer = new IndexManager(db, null)

    // Create test documents
    const doc1 = join(tmpDir, 'rust.txt')
    await writeFile(doc1, 'Rust is a systems programming language focused on safety and concurrency. The borrow checker ensures memory safety.', 'utf-8')

    const doc2 = join(tmpDir, 'python.txt')
    await writeFile(doc2, 'Python is a high-level programming language known for readability. It uses garbage collection for memory management.', 'utf-8')

    const doc3 = join(tmpDir, 'cooking.txt')
    await writeFile(doc3, 'Chocolate cake requires flour, sugar, cocoa powder, and eggs. Bake at 350 degrees for 30 minutes.', 'utf-8')

    await indexer.sync([doc1, doc2, doc3])
  })

  after(async () => {
    try { db.close() } catch { /* ok */ }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('finds relevant documents by keyword', async () => {
    const results = await hybridSearch(db, null, 'programming language', 10)
    assert.ok(results.length >= 2, `Expected ≥ 2 results for "programming language", got ${results.length}`)

    // The programming docs should rank above the cooking doc
    const paths = results.map((r) => r.filePath)
    const hasProgramming = paths.some((p) => p.includes('rust') || p.includes('python'))
    assert.ok(hasProgramming, 'Should find programming-related docs')
  })

  it('returns empty for nonsense query', async () => {
    const results = await hybridSearch(db, null, 'xyzzy plugh', 10)
    assert.equal(results.length, 0)
  })

  it('respects the k limit', async () => {
    const results = await hybridSearch(db, null, 'programming', 1)
    assert.ok(results.length <= 1, `Expected ≤ 1 result with k=1, got ${results.length}`)
  })

  it('ranks by keyword match count (more matches = higher score)', async () => {
    // "memory safety" should score Rust higher since it contains both words together
    const results = await hybridSearch(db, null, 'memory safety borrow', 10)
    assert.ok(results.length >= 1)

    // Rust doc mentions "memory safety" and "borrow checker" — should rank first
    assert.ok(
      results[0]!.filePath.includes('rust'),
      `Expected rust doc to rank first, got ${results[0]!.filePath}`,
    )
  })

  it('search results have expected shape', async () => {
    const results = await hybridSearch(db, null, 'chocolate cake', 10)
    assert.ok(results.length >= 1)

    const r = results[0]!
    assert.equal(typeof r.chunkId, 'number')
    assert.equal(typeof r.filePath, 'string')
    assert.equal(typeof r.content, 'string')
    assert.equal(typeof r.score, 'number')
    assert.ok(r.score > 0, 'Score should be positive')
  })
})

// ─── indexSessionTranscripts ──────────────────────────────

describe('indexSessionTranscripts', () => {
  let tmpDir: string
  let sessionsDir: string
  let db: MemoryDb

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jarvis-sess-'))
    sessionsDir = join(tmpDir, 'sessions')
    await mkdir(sessionsDir, { recursive: true })
    db = openMemoryDb(join(tmpDir, 'test.db'))
  })

  after(async () => {
    try { db.close() } catch { /* ok */ }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('indexes JSONL transcript files', async () => {
    const transcript = [
      JSON.stringify({ role: 'user', content: 'How do I deploy to Kubernetes?', timestamp: 1700000000000 }),
      JSON.stringify({ role: 'assistant', content: 'You can use kubectl apply -f deployment.yaml to deploy resources to your Kubernetes cluster.', timestamp: 1700000001000 }),
    ].join('\n')

    await writeFile(join(sessionsDir, 'session-001.jsonl'), transcript, 'utf-8')

    const indexer = new IndexManager(db, null)
    const result = await indexSessionTranscripts(indexer, sessionsDir)
    assert.equal(result.indexed, 1)
  })

  it('skips non-JSONL files', async () => {
    await writeFile(join(sessionsDir, 'readme.md'), '# Not a transcript', 'utf-8')

    const indexer = new IndexManager(db, null)
    const result = await indexSessionTranscripts(indexer, sessionsDir)
    // session-001 should be skipped (already indexed), readme.md ignored
    assert.equal(result.indexed, 0)
    assert.equal(result.skipped, 1)
  })

  it('indexed transcripts are searchable', async () => {
    const results = await hybridSearch(db, null, 'Kubernetes deploy kubectl', 10)
    assert.ok(results.length >= 1, 'Should find the transcript about Kubernetes')
    assert.ok(results[0]!.content.includes('Kubernetes'))
  })

  it('handles missing sessions directory gracefully', async () => {
    const indexer = new IndexManager(db, null)
    const result = await indexSessionTranscripts(indexer, '/no/such/dir')
    assert.equal(result.indexed, 0)
    assert.equal(result.skipped, 0)
  })
})

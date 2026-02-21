import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { MemoryDb } from './db.js'
import type { EmbeddingProvider } from './embeddings.js'
import { float32ToBlob } from './embeddings.js'

/**
 * Target ~400 words per chunk with ~50 word overlap.
 * 1 word ≈ 1.3 tokens, so ~400 words ≈ ~520 tokens.
 */
const CHUNK_SIZE_WORDS = 400
const CHUNK_OVERLAP_WORDS = 50

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Split text into overlapping chunks by word count.
 */
export function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  if (words.length <= CHUNK_SIZE_WORDS) return [text.trim()]

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE_WORDS, words.length)
    chunks.push(words.slice(start, end).join(' '))
    start += CHUNK_SIZE_WORDS - CHUNK_OVERLAP_WORDS
    if (end === words.length) break
  }

  return chunks
}

/**
 * Manages the memory index: syncs files, chunks text, stores embeddings.
 */
export class IndexManager {
  constructor(
    private db: MemoryDb,
    private embedder: EmbeddingProvider | null,
  ) {}

  /**
   * Sync a list of files into the index.
   * Only re-indexes files that have changed (by SHA-256 hash).
   */
  async sync(filePaths: string[]): Promise<{ indexed: number; skipped: number }> {
    let indexed = 0
    let skipped = 0

    for (const filePath of filePaths) {
      let content: string
      try {
        content = await readFile(filePath, 'utf-8')
      } catch {
        continue // Skip files that can't be read
      }

      const hash = sha256(content)

      // Check if already indexed with same hash
      const existing = this.db.prepare(
        'SELECT hash FROM files WHERE path = ?',
      ).get(filePath) as { hash: string } | undefined

      if (existing?.hash === hash) {
        skipped++
        continue
      }

      // Delete old chunks if file was previously indexed
      if (existing) {
        this.db.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath)
        this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath)
      }

      // Chunk the content
      const chunks = chunkText(content)
      if (chunks.length === 0) continue

      // Insert file record
      this.db.prepare(
        'INSERT INTO files (path, hash, indexed_at) VALUES (?, ?, ?)',
      ).run(filePath, hash, Date.now())

      // Upsert chunks with embeddings
      await this.upsertChunks(filePath, chunks)
      indexed++
    }

    return { indexed, skipped }
  }

  /**
   * Insert chunks for a file, computing embeddings where possible.
   * Uses the embedding cache to avoid redundant API calls.
   */
  private async upsertChunks(filePath: string, chunks: string[]): Promise<void> {
    const insertStmt = this.db.prepare(
      'INSERT INTO chunks (file_path, chunk_idx, content, embedding) VALUES (?, ?, ?, ?)',
    )

    // Compute hashes for cache lookup
    const hashes = chunks.map(sha256)
    const embeddings: (Buffer | null)[] = new Array(chunks.length).fill(null)

    // Check cache
    const uncachedIndices: number[] = []
    const getCached = this.db.prepare(
      'SELECT embedding FROM embedding_cache WHERE hash = ?',
    )

    for (let i = 0; i < chunks.length; i++) {
      const cached = getCached.get(hashes[i]!) as { embedding: Buffer } | undefined
      if (cached) {
        embeddings[i] = cached.embedding
      } else {
        uncachedIndices.push(i)
      }
    }

    // Embed uncached chunks
    if (this.embedder && uncachedIndices.length > 0) {
      const textsToEmbed = uncachedIndices.map((i) => chunks[i]!)
      try {
        // Embed in batches of 20
        const batchSize = 20
        let embIdx = 0
        for (let b = 0; b < textsToEmbed.length; b += batchSize) {
          const batch = textsToEmbed.slice(b, b + batchSize)
          const vecs = await this.embedder.embed(batch)

          for (let j = 0; j < vecs.length; j++) {
            const origIdx = uncachedIndices[embIdx]!
            const blob = float32ToBlob(vecs[j]!)
            embeddings[origIdx] = blob

            // Cache the embedding
            this.db.prepare(
              'INSERT OR REPLACE INTO embedding_cache (hash, embedding, created_at) VALUES (?, ?, ?)',
            ).run(hashes[origIdx]!, blob, Date.now())

            embIdx++
          }
        }
      } catch (err) {
        console.warn('[memory] Embedding failed, storing chunks without vectors:', (err as Error).message)
      }
    }

    // Insert all chunks
    for (let i = 0; i < chunks.length; i++) {
      insertStmt.run(filePath, i, chunks[i]!, embeddings[i])
    }
  }
}

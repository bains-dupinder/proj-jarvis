# Phase 5 — Persistent Memory

## Goal
After sessions end, the assistant can recall context from past conversations using hybrid keyword + vector search over indexed transcripts.

## Prerequisites
- Phase 4 complete and passing verification
- `OPENAI_API_KEY` set in `.env` (used for embeddings)
- Node.js 22.5+ (built-in `node:sqlite` available)
- `sqlite-vec` native extension available (install: `npm i sqlite-vec`)

---

## Files to Create

### `src/memory/schema.ts`
- Purpose: SQL strings for database table creation
- Key exports:
  ```typescript
  export const CREATE_FILES_TABLE: string
  export const CREATE_CHUNKS_TABLE: string
  export const CREATE_CHUNKS_FTS_TABLE: string
  export const CREATE_EMBEDDING_CACHE_TABLE: string
  export const ALL_MIGRATIONS: string[]  // ordered list of all CREATE statements
  ```
- SQL:
  ```sql
  -- files: tracks which source files have been indexed and their content hash
  CREATE TABLE IF NOT EXISTS files (
    path       TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    indexed_at INTEGER NOT NULL
  );

  -- chunks: text segments with optional vector embeddings
  CREATE TABLE IF NOT EXISTS chunks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
    chunk_idx INTEGER NOT NULL,    -- order within file
    content   TEXT NOT NULL,
    embedding BLOB                 -- NULL until embedded
  );

  -- chunks_fts: FTS5 virtual table for BM25 keyword search
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
    USING fts5(content, content=chunks, content_rowid=id);

  -- embedding_cache: avoid re-calling embedding API for unchanged content
  CREATE TABLE IF NOT EXISTS embedding_cache (
    hash       TEXT PRIMARY KEY,   -- SHA-256 of chunk text
    embedding  BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  ```

---

### `src/memory/db.ts`
- Purpose: open SQLite database, load sqlite-vec extension, run migrations
- Key exports:
  ```typescript
  export interface Database {
    // Thin wrapper around node:sqlite DatabaseSync
    prepare(sql: string): Statement
    exec(sql: string): void
    close(): void
  }

  export function openDb(dbPath: string): Database
  ```
- Implementation notes:
  - Use `node:sqlite` (`DatabaseSync` class, available in Node.js 22.5+)
  - Load sqlite-vec: `db.loadExtension(require.resolve('sqlite-vec/vec0'))` or use the sqlite-vec npm package's path helper
  - Run all migrations from `ALL_MIGRATIONS` via `db.exec()`
  - Enable WAL mode: `db.exec('PRAGMA journal_mode=WAL')`
  - Enable foreign keys: `db.exec('PRAGMA foreign_keys=ON')`

---

### `src/memory/embeddings.ts`
- Purpose: define the embedding provider interface and implement OpenAI embeddings
- Key exports:
  ```typescript
  export interface EmbeddingProvider {
    model: string
    dimensions: number
    embed(texts: string[]): Promise<number[][]>
    // Returns one float32 array per input text
  }

  export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    model = 'text-embedding-3-small'
    dimensions = 1536
    constructor(apiKey: string)
    async embed(texts: string[]): Promise<number[][]>
  }

  export function float32ToBlob(vec: number[]): Buffer
  export function blobToFloat32(blob: Buffer): number[]
  // Helpers to serialise/deserialise embeddings for SQLite BLOB storage
  ```
- Implementation notes:
  - Use `openai` SDK: `client.embeddings.create({ model, input: texts })`
  - Batch in chunks of 100 (OpenAI limit)
  - `float32ToBlob`: `Buffer.from(new Float32Array(vec).buffer)`
  - `blobToFloat32`: `Array.from(new Float32Array(blob.buffer))`

---

### `src/memory/search.ts`
- Purpose: hybrid BM25 + vector search with Reciprocal Rank Fusion
- Key exports:
  ```typescript
  export interface SearchResult {
    chunkId: number
    filePath: string
    content: string
    score: number   // RRF score (higher = more relevant)
  }

  export async function hybridSearch(
    db: Database,
    embedder: EmbeddingProvider,
    query: string,
    k: number = 10,
  ): Promise<SearchResult[]>
  ```
- Algorithm:
  ```
  1. BM25 search:
     SELECT c.id, c.file_path, c.content, rank
     FROM chunks_fts
     JOIN chunks c ON chunks_fts.rowid = c.id
     WHERE chunks_fts MATCH ?
     ORDER BY rank   -- FTS5 rank (lower = more relevant)
     LIMIT 50

  2. Vector search (sqlite-vec):
     SELECT c.id, c.file_path, c.content,
            vec_distance_cosine(c.embedding, ?) as dist
     FROM chunks c
     WHERE c.embedding IS NOT NULL
     ORDER BY dist ASC
     LIMIT 50

  3. Reciprocal Rank Fusion:
     RRF_score(d) = Σ 1 / (k + rank_i(d))   where k = 60
     Merge both result lists by chunk id, compute combined RRF score
     Sort descending, return top-k
  ```
- Implementation notes:
  - Embed the query using `embedder.embed([query])` first
  - Convert query embedding to BLOB for sqlite-vec comparison
  - If embedder not available (no API key), fall back to BM25 only

---

### `src/memory/indexer.ts`
- Purpose: manage the index — sync files, chunk text, store embeddings
- Key exports:
  ```typescript
  export class IndexManager {
    constructor(db: Database, embedder: EmbeddingProvider)

    async sync(filePaths: string[]): Promise<void>
    // For each file: compute SHA-256, compare to stored hash
    // Re-index only changed/new files; delete stale chunks on hash change

    async chunkText(text: string, filePath: string): Promise<string[]>
    // Split into ~500-token chunks with 50-token overlap
    // Simple word-based tokenisation is fine for POC (no tiktoken dependency)

    async upsertChunks(filePath: string, chunks: string[]): Promise<void>
    // Insert chunks, look up embeddings in cache, call embedder for misses
    // Store new embeddings in cache and on chunk rows
    // Update chunks_fts via INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')
  }
  ```
- Implementation notes:
  - SHA-256: `crypto.createHash('sha256').update(text).digest('hex')`
  - Token approximation for chunking: split on whitespace, count words — 1 word ≈ 1.3 tokens (close enough for 500-token target)
  - Embed in batches of 20 to stay within rate limits at low cost
  - FTS5 rebuild trigger: after inserting/deleting chunks, run `INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')` to keep BM25 index fresh

---

### `src/memory/session-files.ts`
- Purpose: index session transcript JSONL files into the memory system
- Key exports:
  ```typescript
  export async function indexSessionTranscripts(
    indexManager: IndexManager,
    sessionsDir: string,
  ): Promise<void>
  // Reads all *.jsonl files in sessionsDir
  // Extracts text content from TranscriptEvent[]
  // Calls indexManager.sync() with the formatted content
  ```
- Implementation notes:
  - Convert each JSONL file to a plain text representation:
    ```
    [user] <timestamp>
    <content>

    [assistant] <timestamp>
    <content>
    ```
  - Pass the path of the `.jsonl` file as the `filePath` in the index
  - Called once on server start (after SessionManager is ready)

---

### Update `src/gateway/server.ts`
- After initialising `SessionManager`, open the memory DB and run indexing:
  ```typescript
  const db = openDb(path.join(getDataDir(), 'memory.db'))
  const embedder = new OpenAIEmbeddingProvider(process.env.OPENAI_API_KEY!)
  const indexManager = new IndexManager(db, embedder)
  // Index existing session transcripts in the background
  indexSessionTranscripts(indexManager, getSessionsDir()).catch(console.error)
  ```
- Also re-index after each `chat.final` event (new transcript content):
  - Trigger `indexSessionTranscripts(...)` (debounced, non-blocking)

### Add `src/gateway/methods/memory.ts`
- Purpose: expose memory search as an RPC method (for future UI integration)
- Key exports:
  ```typescript
  export const memorySearch: MethodHandler
  ```
- Params: `{ query: string, k?: number }`
- Returns: `{ results: SearchResult[] }`

### Register in server
```typescript
registry.register('memory.search', memorySearch)
```

---

## Verification

```bash
# 1. Start server (memory DB initialises automatically)
pnpm dev
# Expected log: "Memory index ready" or similar

# 2. Create a session and send some memorable facts
wscat -c ws://localhost:18789
{"type":"auth","token":"mysecrettoken"}
{"id":"1","method":"sessions.create","params":{}}
# copy sessionKey
{"id":"2","method":"chat.send","params":{"sessionKey":"<uuid>","message":"My favourite programming language is TypeScript and I work at Acme Corp."}}
# Wait for chat.final

# 3. Restart server to force re-index from disk
# (Ctrl+C, pnpm dev)

# 4. Search memory directly via RPC
{"id":"3","method":"memory.search","params":{"query":"favourite programming language","k":5}}
# Expected: results array containing the transcript chunk with "TypeScript"

# 5. Verify in a new session the agent can recall (requires passing memory results into system prompt)
# Note: full memory-augmented generation is wired in Phase 6 via the UI — this step just confirms
# the search mechanism works at the RPC level.

# 6. Inspect the database
sqlite3 ~/.proj-jarvis/memory.db
.tables
# Expected: files  chunks  chunks_fts  embedding_cache
SELECT count(*) FROM chunks;
# Expected: > 0 after indexing
SELECT content FROM chunks LIMIT 3;
# Expected: text excerpts from session transcripts

# 7. Verify embedding cache prevents redundant API calls
# Restart server twice — the second start should not make any embedding API calls
# (check network traffic or add a log in embed() showing cache hits)
```

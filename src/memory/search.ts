import type { MemoryDb } from './db.js'
import type { EmbeddingProvider } from './embeddings.js'
import { float32ToBlob } from './embeddings.js'

export interface SearchResult {
  chunkId: number
  filePath: string
  content: string
  score: number // RRF score (higher = more relevant)
}

/**
 * Extract meaningful keywords from a query for LIKE-based search.
 * Strips common stop words and short tokens.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'up', 'out',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we',
  'our', 'you', 'your', 'he', 'she', 'they', 'them', 'their', 'what',
  'which', 'who', 'when', 'where', 'how', 'not', 'no', 'nor', 'and',
  'or', 'but', 'if', 'then', 'so', 'than', 'too', 'very', 'just',
])

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}

/**
 * Keyword search using LIKE patterns on chunk content.
 * Returns chunks ranked by number of keyword matches (more matches = higher rank).
 */
function keywordSearch(db: MemoryDb, query: string, limit: number): Array<{ id: number; filePath: string; content: string; matchCount: number }> {
  const keywords = extractKeywords(query)
  if (keywords.length === 0) return []

  // Fetch all chunks that match at least one keyword
  // We build OR conditions: content LIKE '%kw1%' OR content LIKE '%kw2%'
  const conditions = keywords.map(() => 'LOWER(content) LIKE ?').join(' OR ')
  const params = keywords.map((kw) => `%${kw}%`)

  const sql = `
    SELECT id, file_path, content
    FROM chunks
    WHERE ${conditions}
    LIMIT 200
  `

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number
    file_path: string
    content: string
  }>

  // Score each row by counting how many keywords match
  const scored = rows.map((row) => {
    const lower = row.content.toLowerCase()
    let matchCount = 0
    for (const kw of keywords) {
      if (lower.includes(kw)) matchCount++
    }
    return { id: row.id, filePath: row.file_path, content: row.content, matchCount }
  })

  // Sort by match count descending
  scored.sort((a, b) => b.matchCount - a.matchCount)
  return scored.slice(0, limit)
}

/**
 * Vector search using sqlite-vec's vec_distance_cosine function.
 */
function vectorSearch(db: MemoryDb, queryEmbedding: Buffer, limit: number): Array<{ id: number; filePath: string; content: string; distance: number }> {
  try {
    const sql = `
      SELECT c.id, c.file_path, c.content,
             vec_distance_cosine(c.embedding, ?) as dist
      FROM chunks c
      WHERE c.embedding IS NOT NULL
      ORDER BY dist ASC
      LIMIT ?
    `
    const rows = db.prepare(sql).all(queryEmbedding, limit) as Array<{
      id: number
      file_path: string
      content: string
      dist: number
    }>
    return rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      content: r.content,
      distance: r.dist,
    }))
  } catch {
    // sqlite-vec might not be available
    return []
  }
}

/**
 * Hybrid keyword + vector search with Reciprocal Rank Fusion (RRF).
 *
 * RRF score for document d = Σ 1 / (k + rank_i(d))  where k = 60
 */
export async function hybridSearch(
  db: MemoryDb,
  embedder: EmbeddingProvider | null,
  query: string,
  k: number = 10,
): Promise<SearchResult[]> {
  const RRF_K = 60
  const FETCH_LIMIT = 50

  // 1. Keyword search
  const kwResults = keywordSearch(db, query, FETCH_LIMIT)

  // 2. Vector search (if embedder available)
  let vecResults: Array<{ id: number; filePath: string; content: string; distance: number }> = []
  if (embedder) {
    try {
      const [queryVec] = await embedder.embed([query])
      if (queryVec) {
        const queryBlob = float32ToBlob(queryVec)
        vecResults = vectorSearch(db, queryBlob, FETCH_LIMIT)
      }
    } catch {
      // Embedding failed — fall back to keyword only
    }
  }

  // 3. RRF merge
  const scores = new Map<number, { filePath: string; content: string; score: number }>()

  // Add keyword results
  for (let rank = 0; rank < kwResults.length; rank++) {
    const r = kwResults[rank]!
    const rrfScore = 1 / (RRF_K + rank + 1)
    const entry = scores.get(r.id)
    if (entry) {
      entry.score += rrfScore
    } else {
      scores.set(r.id, { filePath: r.filePath, content: r.content, score: rrfScore })
    }
  }

  // Add vector results
  for (let rank = 0; rank < vecResults.length; rank++) {
    const r = vecResults[rank]!
    const rrfScore = 1 / (RRF_K + rank + 1)
    const entry = scores.get(r.id)
    if (entry) {
      entry.score += rrfScore
    } else {
      scores.set(r.id, { filePath: r.filePath, content: r.content, score: rrfScore })
    }
  }

  // Sort by score descending, return top-k
  const merged: SearchResult[] = Array.from(scores.entries())
    .map(([chunkId, data]) => ({
      chunkId,
      filePath: data.filePath,
      content: data.content,
      score: data.score,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)

  return merged
}

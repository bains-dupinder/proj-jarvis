import { z } from 'zod'
import type { MethodHandler } from './types.js'
import { RpcError } from './registry.js'
import { hybridSearch } from '../../memory/search.js'

const SearchParams = z.object({
  query: z.string().min(1).max(2000),
  k: z.number().int().min(1).max(50).default(10),
})

/**
 * memory.search — search past session transcripts using hybrid keyword + vector search.
 */
export const memorySearch: MethodHandler = async (params, ctx) => {
  const parsed = SearchParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  if (!ctx.memoryDb) {
    throw new RpcError(-32603, 'Memory system not available')
  }

  const results = await hybridSearch(
    ctx.memoryDb,
    ctx.embedder ?? null,
    parsed.data.query,
    parsed.data.k,
  )

  return {
    results: results.map((r) => ({
      chunkId: r.chunkId,
      filePath: r.filePath,
      content: r.content,
      score: r.score,
    })),
  }
}

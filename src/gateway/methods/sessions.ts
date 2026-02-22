import { z } from 'zod'
import type { MethodHandler } from './types.js'
import { RpcError } from './registry.js'

const CreateParams = z.object({
  agentId: z.string().optional(),
})

const GetParams = z.object({
  sessionKey: z.string().uuid(),
})

function summarizeLabel(text: string, maxLen: number = 56): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (normalized.length <= maxLen) return normalized
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`
}

/**
 * sessions.create — create a new session
 */
export const sessionsCreate: MethodHandler = async (params, ctx) => {
  const parsed = CreateParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const session = await ctx.sessionManager.create(parsed.data.agentId)
  return { sessionKey: session.meta.key, meta: session.meta }
}

/**
 * sessions.list — list all sessions
 */
export const sessionsList: MethodHandler = async (_params, ctx) => {
  const sessions = await ctx.sessionManager.list()

  const enriched = await Promise.all(sessions.map(async (meta) => {
    if (meta.label?.trim()) return meta

    const session = await ctx.sessionManager.get(meta.key)
    if (!session) return meta

    const events = await session.readEvents()
    const firstUser = events.find((e) => e.role === 'user' && e.content.trim().length > 0)
    const derived = firstUser ? summarizeLabel(firstUser.content) : null

    if (!derived) return meta

    ctx.sessionManager.setLabel(meta.key, derived).catch(() => {})
    return { ...meta, label: derived }
  }))

  return { sessions: enriched }
}

/**
 * sessions.get — get session metadata and messages
 */
export const sessionsGet: MethodHandler = async (params, ctx) => {
  const parsed = GetParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const session = await ctx.sessionManager.get(parsed.data.sessionKey)
  if (!session) {
    throw new RpcError(-32603, `Session not found: ${parsed.data.sessionKey}`)
  }

  const events = await session.readEvents()

  // Convert transcript events to a simpler message format for the client
  const messages = events.map((e) => ({
    role: e.role,
    content: e.content,
    timestamp: e.timestamp,
    runId: e.runId,
    toolName: e.toolName,
  }))

  return { session: session.meta, messages }
}

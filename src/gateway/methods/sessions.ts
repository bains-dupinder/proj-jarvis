import { z } from 'zod'
import type { MethodHandler } from './types.js'
import { RpcError } from './registry.js'

const CreateParams = z.object({
  agentId: z.string().optional(),
})

const GetParams = z.object({
  sessionKey: z.string().uuid(),
})

/**
 * sessions.create — create a new session
 */
export const sessionsCreate: MethodHandler = async (params, ctx) => {
  const parsed = CreateParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const session = await ctx.sessionManager.create(parsed.data.agentId)
  return { sessionKey: session.meta.key }
}

/**
 * sessions.list — list all sessions
 */
export const sessionsList: MethodHandler = async (_params, ctx) => {
  const sessions = await ctx.sessionManager.list()
  return { sessions }
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

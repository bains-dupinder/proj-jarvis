import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MethodHandler } from './types.js'
import { RpcError } from './registry.js'
import { parseModelRef } from '../../agents/model-ref.js'
import { buildSystemPrompt, getAgentModelRef } from '../../agents/prompt-builder.js'
import { runAgentTurn } from '../../agents/runner.js'
import type { Message } from '../../agents/providers/types.js'
import type { TranscriptEvent } from '../../sessions/transcript.js'

const SendParams = z.object({
  sessionKey: z.string().uuid(),
  message: z.string().min(1).max(32_000),
})

const HistoryParams = z.object({
  sessionKey: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(100),
})

const AbortParams = z.object({
  runId: z.string().uuid(),
})

/**
 * Convert transcript events to Message[] for the model.
 * Only includes user and assistant roles (tool_result is embedded in the flow).
 */
function transcriptToMessages(events: TranscriptEvent[]): Message[] {
  return events
    .filter((e) => e.role === 'user' || e.role === 'assistant')
    .map((e) => ({
      role: e.role as 'user' | 'assistant',
      content: e.content,
    }))
}

/**
 * chat.send — start a streaming AI response with full session persistence.
 */
export const chatSend: MethodHandler = async (params, ctx) => {
  const parsed = SendParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const { sessionKey, message } = parsed.data

  // Load session
  const session = await ctx.sessionManager.get(sessionKey)
  if (!session) {
    throw new RpcError(-32603, `Session not found: ${sessionKey}`)
  }

  // Read existing transcript for conversation context
  const existingEvents = await session.readEvents()
  const messages: Message[] = transcriptToMessages(existingEvents)

  // Append user message to transcript
  const userEvent: TranscriptEvent = {
    role: 'user',
    content: message,
    timestamp: Date.now(),
  }
  await session.appendEvent(userEvent)
  messages.push({ role: 'user', content: message })

  // Resolve provider
  const agentId = session.meta.agentId
  const modelRefStr = await getAgentModelRef(ctx.workspacePath, agentId)
  if (!modelRefStr) {
    throw new RpcError(-32603, `No model configured for agent "${agentId}" in AGENTS.md`)
  }

  const modelRef = parseModelRef(modelRefStr)
  const provider = ctx.providers.get(modelRef.provider)
  if (!provider) {
    throw new RpcError(
      -32603,
      `Provider "${modelRef.provider}" not available. ` +
      `Set ${modelRef.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} in .env`,
    )
  }

  const systemPrompt = await buildSystemPrompt(ctx.workspacePath)
  const runId = randomUUID()

  // Track active run for abort support
  const controller = new AbortController()
  ctx.activeRuns.set(runId, controller)

  // Accumulate assistant text for transcript
  let assistantText = ''

  // Fire and forget — streaming happens asynchronously via push events
  runAgentTurn({
    provider,
    model: modelRef.model,
    systemPrompt,
    messages,
    tools: [], // Tools added in Phase 4
    onEvent: (event) => {
      // Check if aborted
      if (controller.signal.aborted) return

      if (event.type === 'delta') {
        assistantText += event.text
        ctx.sendEvent('chat.delta', { runId, text: event.text })
      }
      if (event.type === 'final') {
        // Persist assistant response to transcript
        const assistantEvent: TranscriptEvent = {
          role: 'assistant',
          content: assistantText,
          timestamp: Date.now(),
          runId,
        }
        session.appendEvent(assistantEvent).catch(() => {})
        ctx.sessionManager.touch(sessionKey).catch(() => {})
        ctx.activeRuns.delete(runId)
        ctx.sendEvent('chat.final', { runId, usage: event.usage })
      }
      if (event.type === 'error') {
        ctx.activeRuns.delete(runId)
        ctx.sendEvent('chat.error', { runId, message: event.message })
      }
    },
  }).catch((err) => {
    ctx.activeRuns.delete(runId)
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    ctx.sendEvent('chat.error', { runId, message: errMsg })
  })

  return { runId }
}

/**
 * chat.history — get the last N messages from a session transcript.
 */
export const chatHistory: MethodHandler = async (params, ctx) => {
  const parsed = HistoryParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const { sessionKey, limit } = parsed.data

  const session = await ctx.sessionManager.get(sessionKey)
  if (!session) {
    throw new RpcError(-32603, `Session not found: ${sessionKey}`)
  }

  const events = await session.readEvents()
  const messages = events.slice(-limit).map((e) => ({
    role: e.role,
    content: e.content,
    timestamp: e.timestamp,
    runId: e.runId,
    toolName: e.toolName,
  }))

  return { messages }
}

/**
 * chat.abort — abort a running generation by runId.
 */
export const chatAbort: MethodHandler = async (params, ctx) => {
  const parsed = AbortParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const controller = ctx.activeRuns.get(parsed.data.runId)
  if (!controller) {
    throw new RpcError(-32603, `Run not found or already completed: ${parsed.data.runId}`)
  }

  controller.abort()
  ctx.activeRuns.delete(parsed.data.runId)

  return { ok: true }
}

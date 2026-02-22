import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MethodHandler } from './types.js'
import { RpcError } from './registry.js'
import { parseModelRef } from '../../agents/model-ref.js'
import { buildSystemPrompt, getAgentModelRef } from '../../agents/prompt-builder.js'
import { runAgentTurn } from '../../agents/runner.js'
import type { Message } from '../../agents/providers/types.js'
import type { ModelProvider } from '../../agents/providers/types.js'
import type { TranscriptEvent } from '../../sessions/transcript.js'
import type { ToolContext } from '../../tools/types.js'
import { filterSecrets } from '../../security/secrets-filter.js'

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

const FALLBACK_PROVIDER_ORDER = ['openai', 'anthropic'] as const
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
}

function summarizeSessionLabel(text: string, maxLen: number = 56): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (normalized.length <= maxLen) return normalized
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`
}

function resolveProviderAndModel(
  providers: Map<string, ModelProvider>,
  requestedProvider: string,
  requestedModel: string,
): { provider: ModelProvider; model: string } {
  const directProvider = providers.get(requestedProvider)
  if (directProvider) {
    return {
      provider: directProvider,
      model: requestedModel,
    }
  }

  const prioritizedFallback = FALLBACK_PROVIDER_ORDER.find((id) => providers.has(id))
  const firstAvailable = providers.keys().next().value as string | undefined
  const fallbackProviderId = prioritizedFallback ?? firstAvailable

  if (!fallbackProviderId) {
    throw new RpcError(
      -32603,
      `No AI providers configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env`,
    )
  }

  const fallbackProvider = providers.get(fallbackProviderId)!
  const fallbackModel = DEFAULT_MODEL_BY_PROVIDER[fallbackProviderId] ?? requestedModel

  return {
    provider: fallbackProvider,
    model: fallbackModel,
  }
}

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
 * chat.send — start a streaming AI response with full session persistence and tool support.
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
  const shouldSetLabel = !existingEvents.some((e) => e.role === 'user')

  // Append user message to transcript
  const userEvent: TranscriptEvent = {
    role: 'user',
    content: message,
    timestamp: Date.now(),
  }
  await session.appendEvent(userEvent)
  messages.push({ role: 'user', content: message })
  if (shouldSetLabel) {
    const label = summarizeSessionLabel(message)
    if (label) {
      ctx.sessionManager.setLabel(sessionKey, label).catch(() => {})
    }
  }

  // Resolve provider
  const agentId = session.meta.agentId
  const modelRefStr = await getAgentModelRef(ctx.workspacePath, agentId)
  if (!modelRefStr) {
    throw new RpcError(-32603, `No model configured for agent "${agentId}" in AGENTS.md`)
  }

  const modelRef = parseModelRef(modelRefStr)
  const resolved = resolveProviderAndModel(
    ctx.providers,
    modelRef.provider,
    modelRef.model,
  )

  const systemPrompt = await buildSystemPrompt(ctx.workspacePath)
  const runId = randomUUID()

  // Track active run for abort support
  const controller = new AbortController()
  ctx.activeRuns.set(runId, controller)

  // Accumulate assistant text for transcript
  let assistantText = ''

  // Build tool context for tool execution
  const toolContext: ToolContext = {
    sessionKey,
    runId,
    sendEvent: ctx.sendEvent,
    reportProgress: (message) => ctx.sendEvent('tool.progress', { runId, message }),
    config: ctx.config,
  }

  // Fire and forget — streaming happens asynchronously via push events
  runAgentTurn({
    provider: resolved.provider,
    model: resolved.model,
    systemPrompt,
    messages,
    tools: ctx.toolRegistry.toDefinitions(),
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
    onToolCall: async (name, input, callId) => {
      const tool = ctx.toolRegistry.get(name)
      if (!tool) {
        return `Error: Unknown tool "${name}"`
      }

      // Validate input
      const validated = tool.inputSchema.safeParse(input)
      if (!validated.success) {
        return `Error: Invalid input for tool "${name}": ${validated.error.message}`
      }

      try {
        const result = await tool.execute(validated.data, toolContext)

        // Filter secrets from output
        const filteredOutput = filterSecrets(result.output)

        // Audit log
        ctx.auditLogger.append({
          ts: Date.now(),
          type: 'tool_exec',
          sessionKey,
          details: {
            tool: name,
            input: typeof input === 'object' ? JSON.stringify(input) : String(input),
            exitCode: result.exitCode,
            truncated: result.truncated,
            outputLength: filteredOutput.length,
          },
        }).catch(() => {})

        // Push attachments (e.g. screenshots) to the client
        if (result.attachments && result.attachments.length > 0) {
          ctx.sendEvent('tool.attachments', {
            runId,
            tool: name,
            attachments: result.attachments,
          })
        }

        // Push bash output so users can see command results even if the model response is terse.
        if (name === 'bash') {
          const maxPreview = 8_000
          const preview =
            filteredOutput.length > maxPreview
              ? `${filteredOutput.slice(0, maxPreview)}\n\n[output truncated]`
              : filteredOutput

          ctx.sendEvent('chat.tool_result', {
            runId,
            tool: name,
            exitCode: result.exitCode,
            output: preview,
          })
        }

        // Persist tool result to transcript (with attachment metadata, not data)
        session.appendEvent({
          role: 'tool_result',
          content: filteredOutput,
          timestamp: Date.now(),
          runId,
          toolName: name,
          attachmentCount: result.attachments?.length,
        }).catch(() => {})

        return filteredOutput
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Tool execution failed'

        // Audit denied/failed tools
        ctx.auditLogger.append({
          ts: Date.now(),
          type: 'tool_denied',
          sessionKey,
          details: { tool: name, error: errMsg },
        }).catch(() => {})

        return `Error: ${errMsg}`
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

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MethodHandler } from './types.js'
import { RpcError } from './registry.js'
import { parseModelRef } from '../../agents/model-ref.js'
import { buildSystemPrompt, getAgentModelRef } from '../../agents/prompt-builder.js'
import { runAgentTurn } from '../../agents/runner.js'
import type { Message } from '../../agents/providers/types.js'

const ChatSendParams = z.object({
  sessionKey: z.string(),
  message: z.string().min(1),
})

/**
 * chat.send — start a streaming AI response.
 *
 * Phase 2 stub: no session persistence, no tools.
 * Single-turn: takes one user message, streams response, returns runId.
 */
export const chatSend: MethodHandler = async (params, ctx) => {
  const parsed = ChatSendParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const { message } = parsed.data
  const runId = randomUUID()

  // Look up agent model ref from workspace AGENTS.md
  const agentId = ctx.config.agents.default
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

  const messages: Message[] = [
    { role: 'user', content: message },
  ]

  // Fire and forget — streaming happens asynchronously via push events
  runAgentTurn({
    provider,
    model: modelRef.model,
    systemPrompt,
    messages,
    tools: [], // No tools in Phase 2
    onEvent: (event) => {
      if (event.type === 'delta') {
        ctx.sendEvent('chat.delta', { runId, text: event.text })
      }
      if (event.type === 'final') {
        ctx.sendEvent('chat.final', { runId, usage: event.usage })
      }
      if (event.type === 'error') {
        ctx.sendEvent('chat.error', { runId, message: event.message })
      }
    },
  }).catch((err) => {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    ctx.sendEvent('chat.error', { runId, message: errMsg })
  })

  // Return immediately with runId — client listens for push events
  return { runId }
}

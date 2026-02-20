import type {
  ChatEvent,
  Message,
  ModelProvider,
  ToolDefinition,
  ContentBlock,
} from './providers/types.js'

export interface RunnerOptions {
  provider: ModelProvider
  model: string
  systemPrompt: string
  messages: Message[]
  tools: ToolDefinition[]
  onEvent: (event: ChatEvent) => void
  /**
   * Called when the model wants to use a tool.
   * Must return the tool output as a string.
   * In Phase 2 (no tools), this won't be called.
   */
  onToolCall?: (name: string, input: unknown, callId: string) => Promise<string>
}

const MAX_TOOL_TURNS = 10

/**
 * Run a single agent turn: call the model, handle tool calls in a loop,
 * and emit events back to the caller.
 *
 * The multi-turn loop handles tool calls:
 * 1. Model emits tool_call events
 * 2. We call onToolCall to get the result
 * 3. Append assistant tool_call + user tool_result to messages
 * 4. Re-call the model with updated messages
 * 5. Repeat until model emits final/error or max turns reached
 */
export async function runAgentTurn(opts: RunnerOptions): Promise<void> {
  const { provider, model, systemPrompt, onEvent, onToolCall } = opts
  const messages = [...opts.messages] // Don't mutate the original
  const tools = opts.tools

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const pendingToolCalls: Array<{
      name: string
      input: Record<string, unknown>
      callId: string
    }> = []

    let textAccumulator = ''
    let gotFinal = false

    const stream = provider.chat({ model, systemPrompt, messages, tools })

    for await (const event of stream) {
      onEvent(event)

      if (event.type === 'delta') {
        textAccumulator += event.text
      }

      if (event.type === 'tool_call') {
        pendingToolCalls.push({
          name: event.name,
          input: event.input,
          callId: event.callId,
        })
      }

      if (event.type === 'final') {
        gotFinal = true
      }

      if (event.type === 'error') {
        return // Stop on error
      }
    }

    // If no tool calls were made, we're done
    if (pendingToolCalls.length === 0) {
      return
    }

    // Process tool calls
    if (!onToolCall) {
      // No tool handler — shouldn't happen if tools are registered, but be safe
      return
    }

    // Build the assistant message with text + tool_use blocks
    const assistantBlocks: ContentBlock[] = []
    if (textAccumulator) {
      assistantBlocks.push({ type: 'text', text: textAccumulator })
    }
    for (const tc of pendingToolCalls) {
      assistantBlocks.push({
        type: 'tool_use',
        id: tc.callId,
        name: tc.name,
        input: tc.input,
      })
    }
    messages.push({ role: 'assistant', content: assistantBlocks })

    // Execute each tool call and build tool_result blocks
    const resultBlocks: ContentBlock[] = []
    for (const tc of pendingToolCalls) {
      const output = await onToolCall(tc.name, tc.input, tc.callId)
      resultBlocks.push({
        type: 'tool_result',
        toolUseId: tc.callId,
        content: output,
      })
    }
    messages.push({ role: 'user', content: resultBlocks })

    // If we got a final event after tool calls, the model might want to continue
    // Loop again to let the model process tool results
  }

  // Max turns reached
  onEvent({ type: 'error', message: 'Maximum tool call turns exceeded' })
}

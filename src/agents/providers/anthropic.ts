import Anthropic from '@anthropic-ai/sdk'
import type {
  ChatEvent,
  Message,
  ModelProvider,
  ToolDefinition,
  ContentBlock,
} from './types.js'

/**
 * Convert our Message format to Anthropic's message format.
 */
function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content }
    }

    // Convert content blocks
    const blocks: Anthropic.ContentBlockParam[] = msg.content.map((block: ContentBlock) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text ?? '' }
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id ?? '',
          name: block.name ?? '',
          input: block.input ?? {},
        }
      }
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result' as const,
          tool_use_id: block.toolUseId ?? '',
          content: block.content ?? '',
        }
      }
      return { type: 'text' as const, text: '' }
    })

    return { role: msg.role, content: blocks }
  })
}

/**
 * Convert our ToolDefinition to Anthropic's tool format.
 */
function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }))
}

export class AnthropicProvider implements ModelProvider {
  id = 'anthropic'
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async *chat(params: {
    model: string
    systemPrompt: string
    messages: Message[]
    tools: ToolDefinition[]
  }): AsyncIterable<ChatEvent> {
    const anthropicMessages = toAnthropicMessages(params.messages)
    const anthropicTools = toAnthropicTools(params.tools)

    try {
      const streamParams: Anthropic.MessageCreateParams = {
        model: params.model,
        max_tokens: 8192,
        system: params.systemPrompt,
        messages: anthropicMessages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      }

      const stream = this.client.messages.stream(streamParams)

      // Track tool calls being accumulated
      let currentToolCallId = ''
      let currentToolCallName = ''
      let currentToolCallInput = ''

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolCallId = event.content_block.id
            currentToolCallName = event.content_block.name
            currentToolCallInput = ''
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'delta', text: event.delta.text }
          }
          if (event.delta.type === 'input_json_delta') {
            currentToolCallInput += event.delta.partial_json
          }
        }

        if (event.type === 'content_block_stop') {
          if (currentToolCallId && currentToolCallName) {
            let input: Record<string, unknown> = {}
            try {
              input = JSON.parse(currentToolCallInput || '{}') as Record<string, unknown>
            } catch {
              // Malformed tool input — send what we have
            }
            yield {
              type: 'tool_call',
              name: currentToolCallName,
              input,
              callId: currentToolCallId,
            }
            currentToolCallId = ''
            currentToolCallName = ''
            currentToolCallInput = ''
          }
        }

        if (event.type === 'message_stop') {
          const finalMessage = await stream.finalMessage()
          yield {
            type: 'final',
            usage: {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
            },
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Anthropic API error'
      yield { type: 'error', message }
    }
  }
}

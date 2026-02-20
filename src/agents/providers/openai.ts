import OpenAI from 'openai'
import type {
  ChatEvent,
  Message,
  ModelProvider,
  ToolDefinition,
  ContentBlock,
} from './types.js'

/**
 * Convert our Message format to OpenAI's message format.
 */
function toOpenAIMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = []

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    // Handle content blocks (tool calls and tool results)
    const blocks = msg.content as ContentBlock[]

    if (msg.role === 'assistant') {
      // Collect text and tool_use blocks into a single assistant message
      const textParts: string[] = []
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = []

      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        }
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id ?? '',
            type: 'function',
            function: {
              name: block.name ?? '',
              arguments: JSON.stringify(block.input ?? {}),
            },
          })
        }
      }

      const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: textParts.join('\n') || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      }
      result.push(assistantMsg)
    }

    if (msg.role === 'user') {
      // tool_result blocks become separate tool messages
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          result.push({
            role: 'tool',
            tool_call_id: block.toolUseId ?? '',
            content: block.content ?? '',
          })
        }
        if (block.type === 'text' && block.text) {
          result.push({ role: 'user', content: block.text })
        }
      }
    }
  }

  return result
}

/**
 * Convert our ToolDefinition to OpenAI's tool format.
 */
function toOpenAITools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

export class OpenAIProvider implements ModelProvider {
  id = 'openai'
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async *chat(params: {
    model: string
    systemPrompt: string
    messages: Message[]
    tools: ToolDefinition[]
  }): AsyncIterable<ChatEvent> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...toOpenAIMessages(params.messages),
    ]
    const openaiTools = toOpenAITools(params.tools)

    try {
      const streamParams: OpenAI.ChatCompletionCreateParamsStreaming = {
        model: params.model,
        messages: openaiMessages,
        stream: true,
        stream_options: { include_usage: true },
        ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
      }

      const stream = await this.client.chat.completions.create(streamParams)

      // Track tool calls being accumulated across chunks
      const pendingToolCalls = new Map<number, {
        id: string
        name: string
        arguments: string
      }>()

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]

        if (choice?.delta?.content) {
          yield { type: 'delta', text: choice.delta.content }
        }

        // Accumulate tool call deltas
        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const existing = pendingToolCalls.get(tc.index)
            if (!existing) {
              pendingToolCalls.set(tc.index, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              })
            } else {
              if (tc.id) existing.id = tc.id
              if (tc.function?.name) existing.name += tc.function.name
              if (tc.function?.arguments) existing.arguments += tc.function.arguments
            }
          }
        }

        // When finish_reason is "tool_calls" or "stop", emit accumulated tool calls
        if (choice?.finish_reason === 'tool_calls') {
          for (const [, tc] of pendingToolCalls) {
            let input: Record<string, unknown> = {}
            try {
              input = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
            } catch {
              // Malformed tool input
            }
            yield {
              type: 'tool_call',
              name: tc.name,
              input,
              callId: tc.id,
            }
          }
          pendingToolCalls.clear()
        }

        // Usage is in the final chunk (when choices is empty and usage is present)
        if (chunk.usage) {
          yield {
            type: 'final',
            usage: {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            },
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OpenAI API error'
      yield { type: 'error', message }
    }
  }
}

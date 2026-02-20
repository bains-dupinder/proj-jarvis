export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; name: string; input: Record<string, unknown>; callId: string }
  | { type: 'final'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; message: string }

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  toolUseId?: string
  content?: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown> // JSON Schema
}

export interface ModelProvider {
  id: string
  chat(params: {
    model: string
    systemPrompt: string
    messages: Message[]
    tools: ToolDefinition[]
  }): AsyncIterable<ChatEvent>
}

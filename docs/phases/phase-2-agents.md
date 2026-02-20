# Phase 2 — Agents & AI Providers

## Goal
`chat.send` over WebSocket returns a real streamed AI response: `chat.delta` events with text chunks, followed by `chat.final`.

## Prerequisites
- Phase 1 complete and passing verification
- `ANTHROPIC_API_KEY` set in `.env` (and/or `OPENAI_API_KEY`)
- `workspace/AGENTS.md`, `workspace/SOUL.md`, `workspace/TOOLS.md` created

---

## Files to Create

### `src/agents/model-ref.ts`
- Purpose: parse `"provider/model"` strings into structured references
- Key exports:
  ```typescript
  export interface ModelRef { provider: string; model: string }
  export function parseModelRef(ref: string): ModelRef
  // e.g. "anthropic/claude-opus-4-6" → { provider: "anthropic", model: "claude-opus-4-6" }
  // Throws Error if no "/" present
  ```

---

### `src/agents/providers/types.ts`
- Purpose: define the common streaming interface all providers must implement
- Key exports:
  ```typescript
  export type ChatEvent =
    | { type: 'delta'; text: string }
    | { type: 'tool_call'; name: string; input: Record<string, unknown>; callId: string }
    | { type: 'final'; usage: { inputTokens: number; outputTokens: number } }
    | { type: 'error'; message: string }

  export interface Message {
    role: 'user' | 'assistant'
    content: string | ContentBlock[]  // string for simple, blocks for tool results
  }

  export interface ToolDefinition {
    name: string
    description: string
    inputSchema: Record<string, unknown>  // JSON Schema
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
  ```

---

### `src/agents/providers/anthropic.ts`
- Purpose: Anthropic Claude provider implementing `ModelProvider`
- Key exports:
  ```typescript
  export class AnthropicProvider implements ModelProvider {
    id = 'anthropic'
    constructor(apiKey: string)
    chat(...): AsyncIterable<ChatEvent>
  }
  ```
- Dependencies: `@anthropic-ai/sdk`
- Implementation notes:
  - Use `client.messages.stream(...)` for streaming
  - Map SDK events:
    - `content_block_delta` with `text_delta` → emit `{ type: 'delta', text }`
    - `content_block_start` with `tool_use` → track tool call, accumulate JSON
    - `content_block_stop` (after tool input) → emit `{ type: 'tool_call', name, input, callId }`
    - `message_stop` → emit `{ type: 'final', usage: { inputTokens, outputTokens } }`
  - On API error → emit `{ type: 'error', message }` then stop iteration
  - Pass `tools` array using Anthropic's tool format (convert from `ToolDefinition`)

---

### `src/agents/providers/openai.ts`
- Purpose: OpenAI provider implementing `ModelProvider`
- Key exports:
  ```typescript
  export class OpenAIProvider implements ModelProvider {
    id = 'openai'
    constructor(apiKey: string)
    chat(...): AsyncIterable<ChatEvent>
  }
  ```
- Dependencies: `openai`
- Implementation notes:
  - Use `client.chat.completions.stream(...)` with `stream: true`
  - Map SDK events:
    - `chunk.choices[0].delta.content` (non-null) → emit `{ type: 'delta', text }`
    - `chunk.choices[0].delta.tool_calls` → accumulate, on finish emit `{ type: 'tool_call', ... }`
    - Final chunk with `finish_reason` → emit `{ type: 'final', usage }`
  - Convert `ToolDefinition` to OpenAI's `tools` format (type: "function")

---

### `src/agents/prompt-builder.ts`
- Purpose: build the system prompt by reading workspace markdown files
- Key exports:
  ```typescript
  export async function buildSystemPrompt(workspacePath: string): Promise<string>
  ```
- Implementation notes:
  - Read `AGENTS.md`, `SOUL.md`, `TOOLS.md` from `workspacePath` with `fs.promises.readFile`
  - If a file doesn't exist, skip it (don't throw)
  - Concatenate with `\n\n---\n\n` separators
  - Result is the `system` parameter passed to the model

---

### `src/agents/runner.ts`
- Purpose: orchestrate a single chat turn — call the model, handle tool calls, yield events
- Key exports:
  ```typescript
  export interface RunnerOptions {
    provider: ModelProvider
    model: string
    systemPrompt: string
    messages: Message[]
    tools: Tool[]           // from src/tools/types.ts (Phase 4)
    onEvent: (event: ChatEvent) => void
    onToolCall: (name: string, input: unknown, callId: string) => Promise<string>
    // ^ returns tool output as string; called by runner when tool_call event arrives
  }

  export async function runAgentTurn(opts: RunnerOptions): Promise<void>
  ```
- Implementation notes:
  - Build `ToolDefinition[]` from `Tool[]` by extracting name/description/inputSchema
  - Iterate `AsyncIterable<ChatEvent>` from `provider.chat(...)`
  - On each event: call `onEvent(event)` so the gateway can forward to WS client
  - On `tool_call` event:
    1. Call `onToolCall(name, input, callId)` and await the result string
    2. Append the assistant's tool_call message + a user tool_result message to `messages`
    3. Re-call `provider.chat(...)` with the updated messages (multi-turn loop)
    4. Continue iterating the new stream
  - Stop when `final` or `error` event is received with no pending tool calls
  - In Phase 2 (no tools yet), `tools` will be empty — single-turn only

---

### `workspace/AGENTS.md`
```markdown
# Agents

## assistant

Model: anthropic/claude-opus-4-6
Description: A helpful, accurate, and concise general-purpose assistant.
```

---

### `workspace/SOUL.md`
```markdown
# Core Directives

You are a local virtual assistant running on the user's own machine.

- Be helpful, honest, and concise.
- When you are uncertain, say so.
- Do not fabricate information.
- Respect user privacy — this is a local system with no cloud logging.
- When executing commands, explain what you are about to do and why.
```

---

### `workspace/TOOLS.md`
```markdown
# Available Tools

## bash

Run a shell command on the user's machine.
The user must approve every command before it executes.
Use this tool to interact with the filesystem, run scripts, or gather system information.
Always use the minimum permissions necessary.
```

---

### Update `src/gateway/methods/registry.ts`
- Add a provider registry alongside the method registry:
  ```typescript
  export function createProviderRegistry(config: Config): Map<string, ModelProvider>
  // Instantiates AnthropicProvider if ANTHROPIC_API_KEY is set
  // Instantiates OpenAIProvider if OPENAI_API_KEY is set
  ```

### Update `src/gateway/methods/types.ts`
- Extend `MethodContext` with:
  ```typescript
  providers: Map<string, ModelProvider>
  workspacePath: string
  ```

### Add stub `src/gateway/methods/chat.ts`
- For Phase 2 verification only — implement `chat.send` minimally:
  - Look up the provider by parsing the agent's model ref from `AGENTS.md`
  - Call `buildSystemPrompt(workspacePath)`
  - Create a single-message `messages` array from params
  - Call `runAgentTurn(...)` with an empty tools array
  - Forward each `ChatEvent` to the WS client as:
    - `delta` → `sendEvent('chat.delta', { runId, text })`
    - `final` → `sendEvent('chat.final', { runId, usage })`
    - `error` → `sendEvent('chat.error', { runId, message })`
  - Return `{ runId }` as the RPC response immediately (streaming happens async)

---

## Verification

```bash
# 1. Add API key to .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# 2. Start server
pnpm dev

# 3. Connect with wscat and authenticate
wscat -c ws://localhost:18789
{"type":"auth","token":"mysecrettoken"}

# 4. Send a chat message (no session yet — stub accepts any sessionKey)
{"id":"2","method":"chat.send","params":{"sessionKey":"test","message":"What is 2+2?"}}

# Expected sequence of messages from server:
# {"id":"2","result":{"runId":"<uuid>"}}
# {"event":"chat.delta","data":{"runId":"<uuid>","text":"2"}}
# {"event":"chat.delta","data":{"runId":"<uuid>","text":"+2"}}
# ... more deltas ...
# {"event":"chat.final","data":{"runId":"<uuid>","usage":{"inputTokens":N,"outputTokens":N}}}
```

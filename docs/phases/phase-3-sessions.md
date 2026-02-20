# Phase 3 — Sessions & Chat RPC Methods

## Goal
Multi-session chat works end-to-end: create a session, send messages, retrieve history, restart the server, and history is still present from the JSONL transcript.

## Prerequisites
- Phase 2 complete and passing verification
- `~/.proj-jarvis/sessions/` directory exists (auto-created by `getDataDir()`)

---

## Files to Create

### `src/sessions/transcript.ts`
- Purpose: read and write JSONL transcript files for a session
- Key exports:
  ```typescript
  export interface TranscriptEvent {
    role: 'user' | 'assistant' | 'tool_result'
    content: string
    timestamp: number        // Unix ms
    runId?: string
    toolName?: string
  }

  export async function appendEvent(filePath: string, event: TranscriptEvent): Promise<void>
  // Opens file in append mode, writes JSON.stringify(event) + '\n'
  // Creates the file if it doesn't exist

  export async function readEvents(filePath: string): Promise<TranscriptEvent[]>
  // Reads file line by line, JSON.parse each line, returns array
  // Returns [] if file doesn't exist
  ```
- Implementation notes:
  - Use `fs.promises.appendFile` for appending (atomic enough for single-process use)
  - Use `fs.promises.readFile` + `.split('\n').filter(Boolean).map(JSON.parse)` for reading
  - Never throw if file doesn't exist on read — return `[]`

---

### `src/sessions/session.ts`
- Purpose: represent a single session with its metadata
- Key exports:
  ```typescript
  export interface SessionMeta {
    key: string
    agentId: string
    createdAt: number     // Unix ms
    updatedAt: number
    label?: string
  }

  export class Session {
    readonly meta: SessionMeta
    readonly transcriptPath: string
    constructor(meta: SessionMeta, sessionsDir: string)
    async appendEvent(event: TranscriptEvent): Promise<void>
    async readEvents(): Promise<TranscriptEvent[]>
  }
  ```

---

### `src/sessions/manager.ts`
- Purpose: create, retrieve, and list sessions backed by the filesystem
- Key exports:
  ```typescript
  export class SessionManager {
    constructor(sessionsDir: string)

    async create(agentId?: string): Promise<Session>
    // Generates key: crypto.randomUUID()
    // Writes <key>.meta.json alongside <key>.jsonl

    async get(key: string): Promise<Session | null>
    // Reads <key>.meta.json; returns null if not found

    async list(): Promise<SessionMeta[]>
    // Reads all *.meta.json files, returns sorted by createdAt desc
  }
  ```
- Implementation notes:
  - Session files stored as two files per session:
    - `<sessionsDir>/<key>.jsonl` — transcript events
    - `<sessionsDir>/<key>.meta.json` — SessionMeta JSON
  - `create()` writes `.meta.json` first, then returns Session
  - Session key is a UUID — do not accept arbitrary strings as keys from clients without validation

---

### `src/gateway/methods/agents.ts`
- Purpose: implement the `agents.list` RPC method
- Key exports:
  ```typescript
  export const agentsList: MethodHandler
  ```
- Implementation notes:
  - Parse `workspace/AGENTS.md` to extract agent definitions
  - Simple parse: look for `## <AgentName>` headings, then `Model:` and `Description:` lines below
  - Return `{ agents: [{ id: 'assistant', name: 'assistant', model: '...', description: '...' }] }`
  - Return at minimum the hardcoded default agent if parsing fails

---

### `src/gateway/methods/sessions.ts`
- Purpose: implement `sessions.create`, `sessions.list`, `sessions.get`
- Key exports:
  ```typescript
  export const sessionsCreate: MethodHandler
  export const sessionsList: MethodHandler
  export const sessionsGet: MethodHandler
  ```
- Param schemas (Zod):
  ```typescript
  const CreateParams = z.object({ agentId: z.string().optional() })
  const GetParams = z.object({ sessionKey: z.string().uuid() })
  ```
- Implementation notes:
  - `sessions.create` → call `ctx.sessionManager.create(params.agentId)`, return `{ sessionKey }`
  - `sessions.list` → call `ctx.sessionManager.list()`, return `{ sessions }`
  - `sessions.get` → call `ctx.sessionManager.get(key)`, read transcript events, convert to message format, return `{ session: meta, messages }`
  - Validate `sessionKey` is a UUID — reject non-UUID keys with code `-32602` (invalid params)

---

### `src/gateway/methods/chat.ts` (full implementation, replaces Phase 2 stub)
- Purpose: `chat.send`, `chat.history`, `chat.abort`
- Key exports:
  ```typescript
  export const chatSend: MethodHandler
  export const chatHistory: MethodHandler
  export const chatAbort: MethodHandler
  ```
- Param schemas (Zod):
  ```typescript
  const SendParams = z.object({
    sessionKey: z.string().uuid(),
    message: z.string().min(1).max(32_000),
  })
  const HistoryParams = z.object({
    sessionKey: z.string().uuid(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  const AbortParams = z.object({ runId: z.string().uuid() })
  ```
- `chat.send` implementation:
  1. Validate params with Zod
  2. Load session via `ctx.sessionManager.get(sessionKey)` — 404 error if not found
  3. Read existing transcript events → convert to `Message[]` for context
  4. Append user message event to transcript
  5. Generate `runId = crypto.randomUUID()`
  6. Return `{ runId }` to caller immediately
  7. Run `runAgentTurn(...)` asynchronously (do not `await` — fire and forget with error handling)
  8. On each `ChatEvent`:
     - `delta` → `sendEvent('chat.delta', { runId, text })`
     - `final` → append assistant message to transcript, `sendEvent('chat.final', { runId, usage })`
     - `error` → `sendEvent('chat.error', { runId, message })`
  9. Track active runs in a `Map<string, AbortController>` on `MethodContext` for abort support
- `chat.history` implementation:
  - Read session transcript, return last `limit` events as `{ messages }`
- `chat.abort` implementation:
  - Look up `runId` in active runs map, call `controller.abort()`

### Update `src/gateway/methods/types.ts`
Add to `MethodContext`:
```typescript
sessionManager: SessionManager
activeRuns: Map<string, AbortController>
```

### Update `src/gateway/server.ts`
- Instantiate `SessionManager` using `getSessionsDir()`
- Pass it through to `MethodContext` when dispatching

### Register all methods
In `src/gateway/server.ts` or a dedicated setup function:
```typescript
registry.register('health.check', healthCheck)
registry.register('agents.list', agentsList)
registry.register('sessions.create', sessionsCreate)
registry.register('sessions.list', sessionsList)
registry.register('sessions.get', sessionsGet)
registry.register('chat.send', chatSend)
registry.register('chat.history', chatHistory)
registry.register('chat.abort', chatAbort)
```

---

## Verification

```bash
# 1. Start server
pnpm dev

# 2. Connect and auth
wscat -c ws://localhost:18789
{"type":"auth","token":"mysecrettoken"}

# 3. List agents
{"id":"1","method":"agents.list","params":{}}
# Expected: {"id":"1","result":{"agents":[{"id":"assistant","model":"anthropic/claude-opus-4-6",...}]}}

# 4. Create a session
{"id":"2","method":"sessions.create","params":{}}
# Expected: {"id":"2","result":{"sessionKey":"<uuid>"}}
# Copy the sessionKey

# 5. Send a message
{"id":"3","method":"chat.send","params":{"sessionKey":"<uuid>","message":"Hello, my name is Alice."}}
# Expected: result with runId, then chat.delta events, then chat.final

# 6. Send a second message
{"id":"4","method":"chat.send","params":{"sessionKey":"<uuid>","message":"What is my name?"}}
# Expected: assistant should recall "Alice" from conversation history

# 7. Get history
{"id":"5","method":"chat.history","params":{"sessionKey":"<uuid>"}}
# Expected: both messages and assistant responses

# 8. Restart the server (Ctrl+C, pnpm dev)

# 9. Reconnect, auth, and get session list
{"id":"1","method":"sessions.list","params":{}}
# Expected: the session from step 4 still listed

# 10. Get session and verify transcript persisted
{"id":"2","method":"sessions.get","params":{"sessionKey":"<uuid>"}}
# Expected: full message history restored

# 11. Verify JSONL on disk
cat ~/.proj-jarvis/sessions/<uuid>.jsonl
# Expected: one JSON object per line
```

# Phase 4 — Tool Execution & Approval Workflow

## Goal
The agent can propose bash commands, the user must approve each one before it runs, and every execution is recorded in an append-only audit log.

## Prerequisites
- Phase 3 complete and passing verification
- `workspace/TOOLS.md` describes the bash tool (already created in Phase 2)

---

## Files to Create

### `src/tools/types.ts`
- Purpose: define the core interfaces for tools, results, and approval requests
- Key exports:
  ```typescript
  export interface ToolContext {
    sessionKey: string
    runId: string
    sendEvent: (event: string, data: unknown) => void
    config: Config
  }

  export interface Tool {
    name: string
    description: string
    inputSchema: z.ZodSchema          // Zod schema for input validation
    toDefinition(): ToolDefinition    // Convert to provider-facing ToolDefinition
    requiresApproval: boolean
    execute(input: unknown, context: ToolContext): Promise<ToolResult>
  }

  export interface ToolResult {
    output: string
    exitCode?: number
    truncated?: boolean
  }

  export interface ApprovalRequest {
    approvalId: string
    command: string
    workingDir: string
    sessionKey: string
  }
  ```

---

### `src/tools/approval.ts`
- Purpose: manage pending tool-execution approvals via a Promise-based map
- Key exports:
  ```typescript
  export class ApprovalManager {
    request(req: ApprovalRequest): Promise<void>
    // Creates a pending entry, returns a Promise that resolves on approve / rejects on deny
    // The pending promise is stored by approvalId

    resolve(approvalId: string): boolean
    // Resolves the pending promise; returns false if approvalId not found

    reject(approvalId: string, reason?: string): boolean
    // Rejects the pending promise with DeniedError; returns false if not found

    hasPending(approvalId: string): boolean
  }

  export class DeniedError extends Error {
    constructor(reason?: string)
  }
  ```
- Implementation notes:
  - Internal: `Map<string, { resolve: () => void; reject: (err: Error) => void }>`
  - `request()` adds to the map and returns the Promise
  - Clean up the map entry after resolve or reject (finally block inside Promise constructor)
  - Approval IDs must be UUIDs — validate in `resolve()` and `reject()`

---

### `src/tools/bash.ts`
- Purpose: implement the bash tool with approval gate, child process execution, output buffering
- Key exports:
  ```typescript
  export class BashTool implements Tool {
    name = 'bash'
    description = '...'
    requiresApproval = true
    constructor(approvalManager: ApprovalManager, config: Config)
    inputSchema: z.ZodObject<{ command: z.ZodString; workingDir?: z.ZodString }>
    toDefinition(): ToolDefinition
    async execute(input: unknown, context: ToolContext): Promise<ToolResult>
  }
  ```
- `execute()` implementation:
  1. Validate input with Zod (`command: string`, `workingDir?: string`)
  2. Generate `approvalId = crypto.randomUUID()`
  3. Send `exec.approval_request` push event to client:
     ```typescript
     context.sendEvent('exec.approval_request', {
       approvalId,
       command: input.command,
       workingDir: input.workingDir ?? process.cwd(),
     })
     ```
  4. Await `approvalManager.request({ approvalId, command, workingDir, sessionKey })`
     - On `DeniedError`: return `{ output: 'Command denied by user.' + (err.message ? ': ' + err.message : ''), exitCode: 1 }`
  5. On approval: spawn `child_process.spawn('bash', ['-c', command], { cwd: workingDir, env: sanitizedEnv() })`
  6. Buffer stdout + stderr:
     - Concatenate chunks into a `Buffer`
     - Stop collecting once `maxOutputBytes` reached (set `truncated: true`)
  7. Enforce timeout: `setTimeout(() => child.kill('SIGTERM'), config.tools.timeout)`
  8. Return `{ output: buffered.toString('utf8'), exitCode, truncated }`
- `sanitizedEnv()`: copy `process.env` but delete known-sensitive vars:
  - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PROJ_JARVIS_TOKEN`
  - Any key matching `/_(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$/i`
- Security notes:
  - **Never** interpolate user strings into the command — the model provides the command, and it has already gone through the approval gate
  - Set `shell: false` — use `bash -c` explicitly so there's one shell boundary only
  - Keep the working directory within `process.cwd()` or a configured workspace path (don't allow `../../../etc`)

---

### `src/tools/registry.ts`
- Purpose: register tools and expose them to both the agent runner and RPC methods
- Key exports:
  ```typescript
  export class ToolRegistry {
    register(tool: Tool): void
    get(name: string): Tool | undefined
    all(): Tool[]
    toDefinitions(): ToolDefinition[]  // For passing to ModelProvider.chat()
  }
  ```

---

### `src/gateway/methods/exec.ts`
- Purpose: implement `exec.approve` and `exec.deny` RPC methods
- Key exports:
  ```typescript
  export const execApprove: MethodHandler
  export const execDeny: MethodHandler
  ```
- Param schemas (Zod):
  ```typescript
  const ApproveParams = z.object({ approvalId: z.string().uuid() })
  const DenyParams = z.object({
    approvalId: z.string().uuid(),
    reason: z.string().optional(),
  })
  ```
- Implementation notes:
  - `exec.approve` → call `ctx.approvalManager.resolve(approvalId)`; if `false` → error `-32602` ("approval not found or already resolved")
  - `exec.deny` → call `ctx.approvalManager.reject(approvalId, reason)`
  - Return `{ ok: true }` on success

---

### `src/security/audit.ts`
- Purpose: append-only structured audit log for security-relevant events
- Key exports:
  ```typescript
  export interface AuditEvent {
    ts: number            // Unix ms
    type: 'auth' | 'tool_exec' | 'tool_denied' | 'config_change'
    sessionKey?: string
    details: Record<string, unknown>
  }

  export class AuditLogger {
    constructor(logPath: string, enabled: boolean)
    async append(event: AuditEvent): Promise<void>
  }
  ```
- Implementation notes:
  - Write `JSON.stringify(event) + '\n'` via `fs.promises.appendFile`
  - If `enabled` is false, `append()` is a no-op
  - **Never** include raw secrets in `details` — apply secrets filter before logging

---

### `src/security/secrets-filter.ts`
- Purpose: redact common secret patterns from strings before logging or display
- Key exports:
  ```typescript
  export function filterSecrets(text: string): string
  ```
- Patterns to redact (replace with `[REDACTED]`):
  - `sk-ant-[A-Za-z0-9-_]{20,}` — Anthropic API keys
  - `sk-[A-Za-z0-9]{20,}` — OpenAI API keys
  - `Bearer [A-Za-z0-9._-]{20,}` — Bearer tokens
  - `\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|PROJ_JARVIS_TOKEN)=[^\s]+` — env var assignments
  - `ghp_[A-Za-z0-9]{36}` — GitHub personal access tokens
- Implementation notes:
  - All patterns should be case-insensitive where appropriate
  - Return the filtered string; never mutate in place
  - Used in: tool output before storage, audit log details

---

### Update `src/agents/runner.ts`
Wire tool execution into the agent loop:
- Accept `toolRegistry: ToolRegistry` in `RunnerOptions`
- Pass `toolRegistry.toDefinitions()` to `provider.chat()`
- When a `tool_call` event arrives:
  1. Look up tool by name in registry; if not found → return error output to model
  2. Validate input using the tool's Zod schema; if invalid → return validation error to model
  3. Call `tool.execute(input, context)` where context includes `sendEvent` (so BashTool can push approval_request)
  4. Apply `filterSecrets()` to `result.output`
  5. Append tool execution to audit log
  6. Return `result.output` as the tool result string

### Update `src/gateway/methods/types.ts`
Add to `MethodContext`:
```typescript
toolRegistry: ToolRegistry
approvalManager: ApprovalManager
auditLogger: AuditLogger
```

### Update `src/gateway/server.ts`
- Instantiate `ApprovalManager`, `ToolRegistry`, `AuditLogger`
- Register `BashTool` in the registry
- Pass all to `MethodContext`
- Register `exec.approve` and `exec.deny` methods

---

## Verification

```bash
# 1. Start server
pnpm dev

# 2. Connect and auth
wscat -c ws://localhost:18789
{"type":"auth","token":"mysecrettoken"}

# 3. Create session and send a prompt that will trigger a tool
{"id":"1","method":"sessions.create","params":{}}
# copy sessionKey

{"id":"2","method":"chat.send","params":{"sessionKey":"<uuid>","message":"Please run: echo hello world"}}

# Expected sequence:
# {"id":"2","result":{"runId":"<run-uuid>"}}           ← immediate
# (model thinks, then decides to use bash tool)
# {"event":"exec.approval_request","data":{"approvalId":"<ap-uuid>","command":"echo hello world","workingDir":"/..."}}

# 4. Approve the command
{"id":"3","method":"exec.approve","params":{"approvalId":"<ap-uuid>"}}
# Expected: {"id":"3","result":{"ok":true}}

# 5. Model continues — output arrives
# {"event":"chat.delta","data":{"runId":"<run-uuid>","text":"hello world\n"}}
# ...
# {"event":"chat.final","data":{"runId":"<run-uuid>","usage":{...}}}

# 6. Test denial
{"id":"4","method":"chat.send","params":{"sessionKey":"<uuid>","message":"Run: rm -rf /tmp/testdir"}}
# When approval_request arrives:
{"id":"5","method":"exec.deny","params":{"approvalId":"<ap-uuid>","reason":"too dangerous"}}
# Model should respond acknowledging the denial

# 7. Verify audit log
cat ~/.proj-jarvis/audit.jsonl
# Expected: JSON lines with ts, type: "tool_exec" or "tool_denied", sessionKey, command

# 8. Test secrets filtering
{"id":"6","method":"chat.send","params":{"sessionKey":"<uuid>","message":"Run: echo ANTHROPIC_API_KEY=sk-ant-fake123"}}
# After approval and execution, the output in chat.delta should show [REDACTED] for the key value
```

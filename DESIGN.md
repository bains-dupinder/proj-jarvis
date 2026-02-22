# Proj Jarvis — Design Document

> **Status**: Implemented. All phases complete.
> This document is the single source of truth for architecture and interfaces.
> Phase instruction files under `docs/phases/` reference back here.

---

## Context

Build Jarvis from scratch, inspired by [OpenClaw](https://github.com/openclaw/openclaw)'s architecture but not derived from it. OpenClaw's core insight: a **local gateway server** speaks JSON-over-WebSocket to a web UI, with a clean provider abstraction for AI models, markdown-defined agent personalities, and a tool-execution approval workflow. We replicate these patterns with a minimal, auditable codebase.

---

## Design Principles

1. **Local-first** — gateway binds to `127.0.0.1` only; no cloud infra required
2. **Approval-gated tools** — bash and browser commands require explicit user approval before execution
3. **Provider-agnostic agents** — Anthropic and OpenAI share a common streaming interface
4. **Markdown-defined agents** — personality/behaviour lives in editable `.md` files, not code
5. **Minimal dependencies** — prefer Node.js built-ins; add packages only when genuinely needed
6. **Security by default** — secrets filtered from logs, Zod validation on all inputs, timing-safe auth

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                               │
│  Lit web components — <jarvis-app>, <jarvis-chat>, etc. │
│  WebSocket client (JSON-RPC over ws://)                 │
└────────────────────┬────────────────────────────────────┘
                     │ ws://localhost:18789
┌────────────────────▼────────────────────────────────────┐
│  Gateway Server (Node.js)                               │
│  HTTP: health check, serve static UI (prod)             │
│  WebSocket: JSON-RPC methods + server-push events       │
│  Auth: shared token (PROJ_JARVIS_TOKEN env var)         │
│                                                         │
│  Methods: chat.send, chat.history, chat.abort           │
│           agents.list, sessions.list/create/get         │
│           exec.approve, exec.deny, health.check         │
│           memory.search                                 │
│           scheduler.list, scheduler.get, scheduler.runs │
│                                                         │
│  Events pushed to client:                               │
│    chat.delta  — streaming text chunk                   │
│    chat.final  — generation complete                    │
│    chat.error  — generation failed                      │
│    exec.approval_request — tool needs user approval     │
│    tool.progress — mid-execution status update          │
│    tool.attachments — binary outputs (screenshots)      │
│    scheduler.run_completed — scheduled job finished     │
└────┬──────────┬──────────────┬───────────────────────────┘
     │          │              │
┌────▼────┐ ┌──▼───────┐ ┌───▼──────────────────────────┐
│ Memory  │ │Scheduler │ │  Agent Runner                 │
│ SQLite  │ │ Cron     │ │  Reads AGENTS.md / SOUL.md   │
│ +vec    │ │ engine   │ │  Calls provider (Anthropic   │
│ keyword │ │ SQLite   │ │    or OpenAI)                │
│ vector  │ │ jobs     │ │  Streams events to gateway   │
└─────────┘ └──────────┘ │  On tool call → approval     │
                          └────────────┬───────────────────┘
                                       │ (after approval)
                           ┌───────────▼─────────────┐
                           │  Tools                   │
                           │  bash → child_process    │
                           │  browser → Playwright    │
                           │  schedule → CRUD engine  │
                           └─────────────────────────┘
```

---

## POC Scope

### Included
- Gateway server (WebSocket + HTTP) on localhost
- JSON-RPC protocol with 14 methods
- Server-push events for streaming (7 event types)
- Shared-token authentication (timing-safe)
- Two AI providers: Anthropic Claude, OpenAI GPT (common streaming interface)
- Session management with JSONL transcripts
- Three tools: bash, browser, schedule — all with extensible Tool interface
- Approval workflow for bash and browser tools, auto-approve support for scheduled execution
- Persistent memory: SQLite + sqlite-vec, hybrid keyword + vector search
- Scheduler: cron-based recurring jobs with persistent storage, auto-approved agent execution
- Web UI: Lit web components, WebSocket client, markdown rendering
- Audit logging of all tool executions, auth events, and scheduled runs
- Secrets filtering on all outputs/logs

### Excluded from POC
- Device auth (ED25519 challenge-response) — post-POC hardening
- Docker sandbox — tool runs directly, sandboxing is a later phase
- Rate limiting — post-POC hardening
- File-read / web-fetch tools — bash covers both for POC
- Config hot-reload
- Plugin/extension system
- Multi-agent routing (single default agent for POC)
- Mobile / native apps

---

## Project Structure

```
proj-jarvis/
├── DESIGN.md                      ← this file
├── README.md
├── package.json                   # type: module, root scripts
├── tsconfig.json                  # ESNext, NodeNext, strict
├── .env.example                   # all env vars documented
├── .gitignore
│
├── docs/
│   └── phases/
│       ├── phase-1-scaffold.md    # Gateway skeleton + config
│       ├── phase-2-agents.md      # AI providers + agent runner
│       ├── phase-3-sessions.md    # Sessions + chat RPC methods
│       ├── phase-4-tools.md       # Bash tool + approval workflow
│       ├── phase-4b-browser-tool.md # Browser tool (Playwright)
│       ├── phase-5-memory.md      # SQLite + vector search
│       └── phase-6-ui.md          # Lit web UI
│
├── src/
│   ├── index.ts                   # Entry: parse args, start gateway
│   │
│   ├── config/
│   │   ├── schema.ts              # Zod config schema (5 groups)
│   │   ├── loader.ts              # Load config.json + env overrides
│   │   └── paths.ts               # ~/.proj-jarvis/ helpers
│   │
│   ├── gateway/
│   │   ├── server.ts              # startServer() → { close() }
│   │   ├── auth.ts                # verifyToken() — timing-safe
│   │   ├── ws-handler.ts          # WS upgrade, auth, frame dispatch
│   │   ├── http-handler.ts        # GET /health, 404 fallback
│   │   └── methods/
│   │       ├── types.ts           # MethodContext, MethodHandler
│   │       ├── registry.ts        # Map<string, MethodHandler>
│   │       ├── health.ts          # health.check
│   │       ├── agents.ts          # agents.list
│   │       ├── sessions.ts        # sessions.create/list/get
│   │       ├── chat.ts            # chat.send/history/abort
│   │       ├── exec.ts            # exec.approve/deny
│   │       ├── memory.ts          # memory.search
│   │       └── scheduler.ts       # scheduler.list/get/runs
│   │
│   ├── agents/
│   │   ├── runner.ts              # runAgentTurn — one chat turn with tool loop
│   │   ├── prompt-builder.ts      # Build system prompt from workspace
│   │   ├── model-ref.ts           # parseModelRef("provider/model")
│   │   └── providers/
│   │       ├── types.ts           # ModelProvider interface + ChatEvent
│   │       ├── anthropic.ts       # Anthropic SDK → AsyncIterable<ChatEvent>
│   │       └── openai.ts          # OpenAI SDK  → AsyncIterable<ChatEvent>
│   │
│   ├── tools/
│   │   ├── types.ts               # Tool, ToolResult, ToolContext (incl. autoApprove)
│   │   ├── approval.ts            # Pending approval map + Promise API
│   │   ├── registry.ts            # ToolRegistry: register + lookup
│   │   ├── bash.ts                # BashTool: spawn, buffer, timeout, approval guard
│   │   ├── browser.ts             # BrowserTool: Playwright actions, approval guard
│   │   ├── browser-session.ts     # BrowserSessionManager: lazy Chromium, contexts
│   │   └── schedule.ts            # ScheduleTool: CRUD via SchedulerEngine
│   │
│   ├── scheduler/
│   │   ├── cron.ts                # 5-field cron parser, getNextRun, describeCron
│   │   ├── schema.ts              # SQL: scheduled_jobs, job_runs tables
│   │   └── engine.ts              # SchedulerEngine: timers, CRUD, job execution
│   │
│   ├── memory/
│   │   ├── db.ts                  # Open SQLite + load sqlite-vec
│   │   ├── schema.ts              # CREATE TABLE SQL strings (memory + scheduler)
│   │   ├── embeddings.ts          # EmbeddingProvider + OpenAI impl
│   │   ├── search.ts              # hybridSearch: keyword + vector + RRF
│   │   ├── indexer.ts             # IndexManager: sync, chunk, upsert
│   │   └── session-files.ts       # Index JSONL transcripts
│   │
│   ├── sessions/
│   │   ├── manager.ts             # SessionManager: create/get/list
│   │   ├── session.ts             # Session class
│   │   └── transcript.ts          # appendEvent / readEvents (JSONL)
│   │
│   └── security/
│       ├── audit.ts               # appendAuditEvent → audit.jsonl
│       └── secrets-filter.ts      # filterSecrets(text) → redacted
│
├── tests/                         # 101 tests across 9 test files
│   ├── approval.test.ts
│   ├── browser-session.test.ts
│   ├── browser-tool.test.ts
│   ├── cron.test.ts
│   ├── memory.test.ts
│   ├── schedule-tool.test.ts
│   ├── scheduler-engine.test.ts
│   ├── secrets-filter.test.ts
│   └── tool-registry.test.ts
│
├── ui/
│   ├── package.json               # lit, vite, marked, dompurify
│   ├── vite.config.ts             # proxy /ws → localhost:18789
│   ├── index.html
│   └── src/
│       ├── app.ts                 # <jarvis-app> root + router
│       ├── ws-client.ts           # WsClient: connect, RPC, events
│       ├── auth-store.ts          # Token in sessionStorage
│       └── components/
│           ├── chat-view.ts       # <jarvis-chat-view>
│           ├── message-list.ts    # <jarvis-message-list>
│           ├── message-item.ts    # <jarvis-message-item>
│           ├── input-bar.ts       # <jarvis-input-bar>
│           ├── approval-dialog.ts # <jarvis-approval-dialog>
│           ├── session-list.ts    # <jarvis-session-list>
│           └── markdown-renderer.ts # Marked + DOMPurify
│
└── workspace/                     # User-editable agent definitions
    ├── AGENTS.md
    ├── SOUL.md
    └── TOOLS.md
```

---

## Key Interfaces

### JSON-RPC Protocol (over WebSocket)

All frames are plain JSON. Three frame types:

```typescript
// Client → Server (request)
{ id: string; method: string; params: unknown }

// Server → Client (response)
{ id: string; result?: unknown; error?: { code: number; message: string } }

// Server → Client (push event — no id)
{ event: string; data: unknown }
```

Authentication: the **first** message after WS upgrade must be:
```json
{ "type": "auth", "token": "<PROJ_JARVIS_TOKEN>" }
```
Server responds `{ "type": "auth", "ok": true }` or closes the connection.

---

### RPC Methods

| Method | Params | Returns | Notes |
|---|---|---|---|
| `health.check` | — | `{ status, uptime }` | No auth required |
| `agents.list` | — | `{ agents: Agent[] }` | |
| `sessions.create` | `{ agentId? }` | `{ sessionKey }` | |
| `sessions.list` | — | `{ sessions: Session[] }` | |
| `sessions.get` | `{ sessionKey }` | `{ session, messages }` | |
| `chat.send` | `{ sessionKey, message }` | `{ runId }` + push events | Starts stream |
| `chat.history` | `{ sessionKey, limit? }` | `{ messages }` | |
| `chat.abort` | `{ runId }` | `{ ok }` | |
| `exec.approve` | `{ approvalId }` | `{ ok }` | Unblocks tool execution |
| `exec.deny` | `{ approvalId, reason? }` | `{ ok }` | |
| `memory.search` | `{ query, k? }` | `{ results }` | Hybrid keyword + vector search |
| `scheduler.list` | `{ enabledOnly? }` | `{ jobs }` | List all scheduled jobs |
| `scheduler.get` | `{ id }` | `{ job }` | Get job details |
| `scheduler.runs` | `{ jobId, limit? }` | `{ runs }` | Get job execution history |

---

### Push Events

| Event | Data | Trigger |
|---|---|---|
| `chat.delta` | `{ runId, text }` | Each text chunk from model |
| `chat.final` | `{ runId, usage: { inputTokens, outputTokens } }` | Generation complete |
| `chat.error` | `{ runId, message }` | Generation failed |
| `exec.approval_request` | `{ approvalId, toolName, summary, details }` | Tool requiring approval (bash, browser) |
| `tool.progress` | `{ runId, message }` | Mid-execution status update |
| `tool.attachments` | `{ runId, tool, attachments }` | Binary outputs (e.g. screenshots) |
| `scheduler.run_completed` | `{ jobId, runId, status, summary }` | Scheduled job finished executing |

---

### ModelProvider Interface

```typescript
type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; name: string; input: Record<string, unknown>; callId: string }
  | { type: 'tool_result'; callId: string; output: string }
  | { type: 'final'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; message: string }

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema object
}

interface ModelProvider {
  id: string  // e.g. "anthropic" | "openai"
  chat(params: {
    model: string
    systemPrompt: string
    messages: Message[]
    tools: ToolDefinition[]
  }): AsyncIterable<ChatEvent>
}
```

---

### Tool Interface

The `Tool` interface is the single contract every tool must satisfy. Adding a new tool means creating one file that implements this interface and registering it — nothing else changes.

```typescript
interface ToolContext {
  sessionKey: string
  sendEvent: (event: string, data: unknown) => void  // push to WS client
  reportProgress: (message: string) => void          // stream status updates
  config: Config
  autoApprove?: boolean                               // skip approval (scheduled execution)
}

interface Tool {
  name: string                      // unique identifier, e.g. "bash", "browser", "schedule"
  description: string               // shown to AI model in system prompt
  inputSchema: z.ZodSchema          // validated before execute() is called
  requiresApproval: boolean         // if true, user must approve before execute()
  execute(input: unknown, context: ToolContext): Promise<ToolResult>
}

interface ToolResult {
  output: string                    // text returned to the model
  attachments?: ToolAttachment[]    // optional binary outputs (screenshots, files)
  exitCode?: number
  truncated?: boolean
}

interface ToolAttachment {
  type: 'image' | 'file'
  mimeType: string                  // e.g. 'image/png'
  data: string                      // base64-encoded
  name?: string
}
```

#### How to add a new tool (3 steps)
1. Create `src/tools/<name>.ts` implementing `Tool`
2. Register it in `src/gateway/server.ts`: `toolRegistry.register(new MyTool(...))`
3. Add a description to `workspace/TOOLS.md` so the AI model knows it exists

No changes needed to the gateway, agent runner, approval flow, or RPC methods.

#### Built-in tools

| Tool | File | Approval | Description |
|---|---|---|---|
| `bash` | `tools/bash.ts` | Required | Run shell commands, read files, run scripts |
| `browser` | `tools/browser.ts` | Required | Control a headless Chromium browser via Playwright: navigate, click, type, screenshot, extract text. Blocks dangerous URL schemes, refuses password fields. |
| `schedule` | `tools/schedule.ts` | Not required | Create, list, update, and delete cron-based scheduled jobs. The AI calls this tool when the user asks to schedule recurring tasks. |

#### Auto-approve mechanism

The `ToolContext.autoApprove` flag allows tools to skip the interactive approval workflow. This is used by the scheduler engine when executing jobs unattended — the bash and browser tools check this flag and skip the approval request/await cycle when it is set to `true`.

#### Progress streaming

`context.reportProgress(message)` sends a `tool.progress` push event to the UI:
```json
{ "event": "tool.progress", "data": { "runId": "...", "message": "Navigating to https://example.com..." } }
```
The UI renders these as inline status lines below the in-progress assistant message. This is especially important for the browser tool where individual actions can take seconds each.

---

## Tool Approval Flow

```
AgentRunner receives tool_call event from model
  │
  ├─ If tool.requiresApproval AND NOT autoApprove:
  │   │
  │   ├─ Generate approvalId via crypto.randomUUID()
  │   │
  │   ├─ Push exec.approval_request event to WS client
  │   │     { approvalId, toolName, summary, details }
  │   │     e.g. bash: { toolName:"bash", summary:"echo hello", details:{command,workingDir} }
  │   │          browser: { toolName:"browser", summary:"Navigate to google.com", details:{actions} }
  │   │
  │   ├─ Register pending Promise in approval.ts map
  │   │     pendingApprovals.set(approvalId, { resolve, reject })
  │   │
  │   ├─ UI shows <jarvis-approval-dialog> — command + working dir visible
  │   │
  │   ├─ User clicks Approve → client sends exec.approve { approvalId }
  │   │        OR Deny   → client sends exec.deny   { approvalId, reason? }
  │   │
  │   ├─ Gateway calls resolveApproval() or rejectApproval()
  │   │
  │   ├─ On approve: tool proceeds to execute
  │   │   On deny:   tool returns { output: "Denied: <reason>" }
  │   │
  ├─ If NOT requiresApproval OR autoApprove: execute immediately
  │
  ├─ Tool result appended to transcript + audit log
  │
  └─ Result returned to model as next conversation turn
```

---

## Browser Tool

The browser tool provides headless Chromium control via Playwright. It supports five action types that can be chained in a single tool call (up to 20 actions):

| Action | Params | Description |
|---|---|---|
| `navigate` | `{ url }` | Navigate to a URL (http/https only) |
| `click` | `{ selector }` | Click an element by CSS selector |
| `type` | `{ selector, text }` | Fill a form field (refuses password fields) |
| `screenshot` | — | Capture a PNG screenshot (returned as base64 attachment) |
| `extract` | `{ selector? }` | Extract text content (full page or specific element) |

Security measures:
- Blocks `file://`, `chrome://`, `chrome-extension://`, `about:`, `javascript:` URL schemes
- Refuses to type into password fields
- Each tool call gets an isolated BrowserContext (separate cookies/storage)
- Sessions can be reused via `sessionId` for multi-step workflows

---

## Scheduler Architecture

```
┌──────────────────────────────────────────────────┐
│  SchedulerEngine (in-process, gateway server)    │
│                                                  │
│  On start():                                     │
│    Load enabled jobs from SQLite                 │
│    For each job → compute next run → setTimeout  │
│                                                  │
│  On timer fire (executeJob):                     │
│    1. Create new session                         │
│    2. Resolve provider/model from AGENTS.md      │
│    3. runAgentTurn() with job.prompt              │
│       └─ ToolContext.autoApprove = true           │
│    4. Store result in job_runs table              │
│    5. Update scheduled_jobs.last_run_*            │
│    6. Broadcast scheduler.run_completed event     │
│    7. Reschedule for next cron occurrence         │
│                                                  │
│  CRUD: create / list / get / update / delete     │
│    Called by ScheduleTool (AI) or RPC methods     │
│                                                  │
│  NOTE: All timers run in the gateway process.    │
│  Jobs do NOT execute if the gateway is stopped.  │
└──────────────────────────────────────────────────┘

SQLite tables (in memory.db):

  scheduled_jobs:
    id              TEXT PRIMARY KEY
    name            TEXT NOT NULL
    cron_expression TEXT NOT NULL        -- 5-field cron: min hr dom mon dow
    prompt          TEXT NOT NULL        -- user message sent to agent
    agent_id        TEXT DEFAULT 'assistant'
    enabled         INTEGER DEFAULT 1
    created_at      INTEGER
    updated_at      INTEGER
    last_run_at     INTEGER
    last_run_status TEXT                 -- 'success' | 'error'
    last_run_summary TEXT

  job_runs:
    id          TEXT PRIMARY KEY
    job_id      TEXT REFERENCES scheduled_jobs(id) ON DELETE CASCADE
    started_at  INTEGER
    finished_at INTEGER
    status      TEXT                     -- 'running' | 'success' | 'error'
    summary     TEXT
    session_key TEXT
    error       TEXT
```

### Cron expression format

Standard 5-field: `minute hour day-of-month month day-of-week`

| Example | Meaning |
|---|---|
| `0 8 * * *` | Daily at 8:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 1 * *` | First of every month at midnight |
| `0 8,12,18 * * *` | At 8am, 12pm, and 6pm daily |

### Timer management

- Uses `setTimeout` per job (not `setInterval` or system cron)
- All timers run in the gateway Node.js process; jobs do not execute if the gateway is not running
- Handles Node.js 32-bit `setTimeout` limit (~24.8 days) with relay timers
- Prevents overlapping executions of the same job via `activeExecutions` set
- On server restart: loads all enabled jobs from DB, computes next run, schedules timers

---

## Memory Architecture

```
SQLite DB: ~/.proj-jarvis/memory.db

Tables:
  files           (path TEXT PK, hash TEXT, indexed_at INTEGER)
  chunks          (id INTEGER PK, file_path TEXT, content TEXT, embedding BLOB)
  embedding_cache (hash TEXT PK, embedding BLOB, created_at INTEGER)

Hybrid search algorithm:
  1. Keyword search using LIKE with stop word filtering → scored list A
  2. Vector cosine similarity on chunks.embedding (sqlite-vec) → scored list B
  3. Reciprocal Rank Fusion: score = 1/(k+rankA) + 1/(k+rankB), k=60
  4. Return top-k merged results with source file paths

Indexing:
  - Triggered on server start for any new/changed session transcript files
  - Text chunked at ~400 words with 50-word overlap
  - Embeddings: OpenAI text-embedding-3-small (1536 dims)
  - Embedding cache keyed on SHA-256(chunk text) — avoids re-calling API
  - Falls back to keyword-only search if OPENAI_API_KEY is not set
```

---

## Config Schema

```typescript
// src/config/schema.ts
const Config = z.object({
  gateway: z.object({
    port: z.number().default(18789),
    host: z.string().default('127.0.0.1'),
  }),
  agents: z.object({
    default: z.string().default('assistant'),
    workspacePath: z.string().optional(),   // defaults to ./workspace
  }),
  tools: z.object({
    timeout: z.number().default(120_000),        // ms
    maxOutputBytes: z.number().default(100_000),
  }),
  memory: z.object({
    enabled: z.boolean().default(true),
    embeddingModel: z.string().default('text-embedding-3-small'),
  }),
  security: z.object({
    auditLog: z.boolean().default(true),
    secretsFilter: z.boolean().default(true),
  }),
})

type Config = z.infer<typeof Config>
```

Config file: `~/.proj-jarvis/config.json` (auto-created with defaults on first run)

Environment overrides (all optional):

| Variable | Config field |
|---|---|
| `PROJ_JARVIS_TOKEN` | auth token (required if auth enabled) |
| `ANTHROPIC_API_KEY` | Anthropic provider |
| `OPENAI_API_KEY` | OpenAI provider + embeddings |
| `PROJ_JARVIS_PORT` | `gateway.port` |
| `PROJ_JARVIS_HOST` | `gateway.host` |

---

## Security Measures

| Layer | Measure | File |
|---|---|---|
| Network | Bind to `127.0.0.1` only | `gateway/server.ts` |
| Network | Reject non-localhost `Origin` headers | `gateway/ws-handler.ts` |
| Auth | Timing-safe token check via `crypto.timingSafeEqual` | `gateway/auth.ts` |
| Input | Zod validation on every RPC method params | `gateway/methods/*.ts` |
| Exec | User approval required before bash/browser commands | `tools/approval.ts` |
| Exec | Process timeout (120 s) + output byte cap (100 KB) | `tools/bash.ts` |
| Browser | Block dangerous URL schemes (file, chrome, javascript) | `tools/browser.ts` |
| Browser | Refuse to type into password fields | `tools/browser.ts` |
| Scheduler | Auto-approve only for authenticated user-created jobs | `scheduler/engine.ts` |
| Output | Regex-based secrets redaction on all tool output | `security/secrets-filter.ts` |
| Audit | Append-only JSONL audit log for tool runs, auth, scheduled jobs | `security/audit.ts` |
| UI | DOMPurify on all markdown-rendered HTML | `ui/src/components/markdown-renderer.ts` |

---

## Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 22+ | Built-in `node:sqlite`, `node:crypto`, `node:child_process` |
| Language | TypeScript 5, ESNext, NodeNext modules | Type safety, native ESM |
| Validation | Zod | Runtime schema + TypeScript type inference |
| WebSocket | `ws` npm package | Lightweight, production-proven |
| AI — Anthropic | `@anthropic-ai/sdk` | Official SDK, streaming support |
| AI — OpenAI | `openai` npm package | Official SDK, streaming support |
| Browser | `playwright` | Headless Chromium, reliable automation |
| Database | `node:sqlite` + `sqlite-vec` extension | Zero-setup, vector search, built-in |
| UI framework | Lit 3 | Lightweight web components, no virtual DOM |
| UI build | Vite 6 | Fast HMR dev server, simple config |
| Markdown | `marked` + `dompurify` | Render + sanitize AI content |
| Package manager | pnpm | Fast installs, workspace support |

---

## Implementation Phases

| # | Instruction File | Outcome |
|---|---|---|
| 1 | `docs/phases/phase-1-scaffold.md` | Server starts, `/health` OK, bad tokens rejected |
| 2 | `docs/phases/phase-2-agents.md` | `chat.send` streams real AI responses |
| 3 | `docs/phases/phase-3-sessions.md` | Multi-session chat, history survives restart |
| 4 | `docs/phases/phase-4-tools.md` | Bash tool with approval, audit log, secrets filter, extensible registry |
| 4b | `docs/phases/phase-4b-browser-tool.md` | Browser control via Playwright (navigate, click, screenshot) |
| 5 | `docs/phases/phase-5-memory.md` | Agent recalls context from past sessions |
| 6 | `docs/phases/phase-6-ui.md` | Full browser UI, end-to-end |
| 7 | — | Cron-based scheduler with persistent jobs, auto-approved execution |

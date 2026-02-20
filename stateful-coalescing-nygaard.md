# Virtual Assistant — Architecture & Implementation Plan

## Context

Build a stripped-down, secure virtual assistant inspired by [OpenClaw](https://github.com/openclaw/openclaw). OpenClaw is a sophisticated multi-platform AI gateway with 35 extensions, 52 skills, native apps, and 18+ messaging platform integrations. We keep its core architectural patterns (gateway, agents, tools, memory, access control) while removing the massive channel integrations, native apps, plugin SDK, and advanced features. Security is prioritized from day one.

---

## OpenClaw Architecture Summary

OpenClaw is a **TypeScript/Node.js monorepo** with these core layers:

| Layer | OpenClaw Location | What It Does |
|-------|-------------------|-------------|
| **Gateway** | `src/gateway/` (131 files) | WebSocket + HTTP server on `localhost:18789`. Binary protocol with Zod schemas. RPC methods (`chat.send`, `agents.list`, etc.). Event streaming (delta/final/error). |
| **Auth** | `src/gateway/auth.ts`, `device-auth.ts` | Timing-safe token comparison via `crypto.timingSafeEqual`. ED25519 device challenge-response. Tailscale WHOIS integration. Localhost bypass for local management. |
| **Agents** | `src/agents/` | Model catalog with 6+ providers (Anthropic, OpenAI, Bedrock, Gemini, Copilot, Qwen). `"provider/model"` reference parsing. Prompts built from workspace markdown files (`AGENTS.md`, `SOUL.md`, `TOOLS.md`). Per-agent workspaces and session logs (JSONL). |
| **Tools** | `src/agents/tools/` | 61 tool files. Bash execution with approval workflow (generates approval ID, awaits user allow-once/allow-always/deny). PTY or pipes. Output buffering with timeouts. Environment variable allowlist. Docker sandbox option. |
| **Memory** | `src/memory/` | SQLite + `sqlite-vec` for semantic search. BM25 + vector hybrid search. Multi-provider embeddings (OpenAI, Gemini, Voyage). Embedding cache with pruning. File hash tracking for incremental reindex. |
| **ACP** | `src/acp/` | Session-based access control. Role-based permissions. Command authorization. Session-scoped isolation. |
| **Config** | Config system | `~/.openclaw/openclaw.json`. Zod-validated schemas (~30 groups). Hot-reload via file watcher. Environment variable overrides. |
| **Sessions** | `src/sessions/` | Unique session keys. JSONL transcript storage. Per-session model overrides. Labels and organization. |
| **Frontend** | `ui/` | Lit web components (120+ components). Vite build. DOMPurify + Marked. WebSocket client with reconnection, heartbeat, exponential backoff. Controllers for chat, agents, channels, devices. |
| **Extensions** | `extensions/` | 35 channel plugins (Discord, Slack, Telegram, WhatsApp, Signal, LINE, Teams, etc.) via Plugin SDK with adapter interfaces (setup, auth, messaging, streaming, security, config). |
| **Skills** | `skills/` | 52 agent capabilities. |
| **Apps** | `apps/` | iOS, macOS, Android via shared OpenClawKit. |

### Key Patterns Worth Preserving
- **RPC over WebSocket**: Methods follow `namespace.action` naming (e.g., `chat.send`). Request/response with ID correlation. Server-pushed events for streaming.
- **Approval Workflow**: Tool execution generates an approval ID, pushes request to client, blocks until user responds. This is the security backbone.
- **Markdown-Defined Agents**: Agent personality and behavior come from `AGENTS.md`, `SOUL.md`, `TOOLS.md` — not code. Users edit markdown to customize.
- **Provider Abstraction**: `ModelProvider` interface with `chat()` returning `AsyncIterable<ChatEvent>`. Events: delta, tool_call, final, error.
- **Hybrid Memory Search**: BM25 keyword + vector cosine similarity in SQLite.

---

## What We Keep vs. Strip

### Keep (core architecture)
- Gateway server (WebSocket + HTTP, RPC methods, event streaming)
- Agent system (provider abstraction, prompt builder, model catalog)
- Tool execution (bash tool with approval workflow, file tool)
- Memory/storage (SQLite + vector search)
- Access control (session-based permissions)
- Security (audit logging, input sanitization, secrets filtering)
- Configuration (Zod-validated, file-based)
- Session management (JSONL transcripts)
- Web frontend (Lit + Vite, ~15 components)

### Strip (removed entirely)
- All 35 channel integrations (Discord, Slack, Telegram, WhatsApp, etc.)
- Plugin SDK and extension system
- Native apps (iOS, macOS, Android)
- TTS/Voice, Browser automation (Playwright), Canvas host
- Multi-node registry and service discovery
- Daemon mode, Cron system
- Media understanding (image/PDF analysis)
- Device pairing for native apps

### Simplify
- Providers: 6+ → 2 (Anthropic, OpenAI)
- Embeddings: 3 providers → 1 (OpenAI)
- RPC methods: 44 → 12
- Tools: 61 → ~8
- Config groups: ~30 → 6
- Frontend components: 120+ → ~15

---

## Project Structure

```
virtual-assistant/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
│
├── src/
│   ├── entry.ts                        # CLI bootstrap
│   │
│   ├── gateway/
│   │   ├── server.ts                   # startGatewayServer() entry
│   │   ├── server-options.ts           # GatewayServerOptions interface
│   │   ├── server-state.ts             # Runtime state container
│   │   ├── server-http.ts              # HTTP handler (health, static)
│   │   ├── server-ws.ts                # WebSocket upgrade + frame handling
│   │   ├── auth.ts                     # Token auth (timing-safe)
│   │   ├── device-auth.ts              # ED25519 challenge-response
│   │   ├── origin-check.ts             # Localhost origin validation
│   │   ├── protocol/
│   │   │   ├── codec.ts               # Encode/decode binary frames
│   │   │   ├── schema.ts              # Zod message types
│   │   │   └── client-info.ts         # Client metadata extraction
│   │   └── methods/
│   │       ├── index.ts               # Method registry map
│   │       ├── types.ts               # MethodHandler type
│   │       ├── chat.ts                # chat.send/history/abort
│   │       ├── agents.ts             # agents.list/get
│   │       ├── sessions.ts           # sessions.list/create/get
│   │       ├── config.ts             # config.get/update
│   │       ├── exec-approval.ts      # exec.approve/deny
│   │       ├── memory.ts             # memory.search
│   │       ├── health.ts             # health.check
│   │       └── system.ts             # system.info
│   │
│   ├── agents/
│   │   ├── agent.ts                   # Agent class
│   │   ├── agent-config.ts            # Per-agent config
│   │   ├── model-catalog.ts           # Static model registry
│   │   ├── model-ref.ts              # "provider/model" parsing
│   │   ├── prompt-builder.ts          # Build from AGENTS.md/SOUL.md/TOOLS.md
│   │   ├── providers/
│   │   │   ├── types.ts              # ModelProvider interface
│   │   │   ├── anthropic.ts          # Anthropic Claude
│   │   │   └── openai.ts            # OpenAI GPT
│   │   ├── tools/
│   │   │   ├── types.ts              # Tool interface, ToolResult
│   │   │   ├── bash-tool.ts          # Shell exec with approval
│   │   │   ├── file-tool.ts          # File read/write/edit
│   │   │   ├── web-fetch-tool.ts     # HTTP fetch
│   │   │   ├── memory-tool.ts        # Memory search/write
│   │   │   └── registry.ts          # Tool registry
│   │   └── sandbox/
│   │       ├── tool-policy.ts        # Allowlist/denylist
│   │       └── docker.ts            # Docker container exec
│   │
│   ├── memory/
│   │   ├── manager.ts                # MemoryIndexManager
│   │   ├── schema.ts                 # SQLite table definitions
│   │   ├── sqlite.ts                 # SQLite wrapper
│   │   ├── sqlite-vec.ts            # Vector extension loader
│   │   ├── embeddings.ts            # Provider abstraction
│   │   ├── embeddings-openai.ts     # OpenAI implementation
│   │   ├── search.ts                # Hybrid BM25 + vector
│   │   ├── session-files.ts         # JSONL transcript indexing
│   │   └── sync.ts                  # Incremental reindex
│   │
│   ├── acp/
│   │   ├── types.ts                  # Role enum, SessionPermissions
│   │   ├── session.ts               # Session-scoped permissions
│   │   ├── commands.ts              # Command authorization
│   │   └── server.ts               # Server-side enforcement
│   │
│   ├── security/
│   │   ├── audit.ts                  # Action audit logging
│   │   ├── audit-fs.ts              # Append-only filesystem trail
│   │   ├── external-content.ts      # Input sanitization
│   │   ├── rate-limiter.ts          # Token-bucket rate limiting
│   │   └── secrets-filter.ts        # Redact secrets from outputs
│   │
│   ├── config/
│   │   ├── config.ts                 # Loader + file watcher
│   │   ├── schema.ts                # Zod config schema (6 groups)
│   │   ├── defaults.ts              # Default values
│   │   ├── paths.ts                 # ~/.virtual-assistant/ resolution
│   │   └── env-vars.ts             # Env var mapping
│   │
│   ├── sessions/
│   │   ├── session.ts                # Session lifecycle
│   │   ├── session-key.ts           # Secure key generation
│   │   ├── transcript.ts            # JSONL read/write
│   │   └── model-overrides.ts       # Per-session model config
│   │
│   ├── process/
│   │   ├── exec.ts                   # Child process spawning
│   │   └── spawn-utils.ts           # PTY + pipe abstraction
│   │
│   ├── logging/
│   │   └── logger.ts                 # Structured JSON logger
│   │
│   └── shared/
│       ├── types.ts                  # Global type defs
│       ├── errors.ts                # Custom error classes
│       ├── crypto.ts                # ED25519, HMAC, random
│       └── text.ts                  # Text utilities
│
├── ui/
│   ├── package.json                  # Lit, Vite, DOMPurify, Marked
│   ├── index.html
│   ├── vite.config.ts               # Dev proxy → gateway
│   └── src/
│       ├── app.ts                    # <va-app> root
│       ├── ws-client.ts             # WebSocket client
│       ├── auth.ts                  # Token auth flow
│       ├── styles/
│       │   ├── theme.ts
│       │   └── reset.ts
│       ├── components/
│       │   ├── chat/
│       │   │   ├── chat-view.ts
│       │   │   ├── message-list.ts
│       │   │   ├── message-item.ts
│       │   │   ├── input-bar.ts
│       │   │   └── tool-approval.ts
│       │   ├── sidebar/
│       │   │   ├── sidebar.ts
│       │   │   ├── session-list.ts
│       │   │   └── agent-picker.ts
│       │   ├── settings/
│       │   │   └── settings-view.ts
│       │   └── shared/
│       │       ├── markdown.ts
│       │       ├── code-block.ts
│       │       └── spinner.ts
│       └── controllers/
│           ├── chat-controller.ts
│           ├── session-controller.ts
│           └── ws-controller.ts
│
├── workspace/                       # User-editable agent definitions
│   ├── AGENTS.md
│   ├── SOUL.md
│   └── TOOLS.md
│
└── test/
    ├── unit/
    ├── integration/
    └── helpers/
```

---

## RPC Methods (12 core)

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `chat.send` | `{ sessionKey, message, attachments? }` | `{ runId }` + streaming events | Send message, start AI response |
| `chat.history` | `{ sessionKey, limit? }` | `{ messages[] }` | Load conversation history |
| `chat.abort` | `{ runId }` | `{ ok }` | Cancel in-progress generation |
| `agents.list` | — | `{ agents[] }` | List available agents |
| `agents.get` | `{ agentId }` | `{ agent }` | Get agent details |
| `sessions.list` | — | `{ sessions[] }` | List all sessions |
| `sessions.create` | `{ agentId? }` | `{ sessionKey }` | Create new session |
| `sessions.get` | `{ sessionKey }` | `{ session, transcript }` | Get session with history |
| `config.get` | — | `{ config }` | Get current config |
| `exec.approve` | `{ approvalId }` | `{ ok }` | Approve tool execution |
| `exec.deny` | `{ approvalId, reason? }` | `{ ok }` | Deny tool execution |
| `health.check` | — | `{ status, uptime }` | Server health |

---

## Security Measures (Day One)

| Layer | Measure | File |
|-------|---------|------|
| Network | Localhost-only binding (`127.0.0.1`) | `gateway/server.ts` |
| Network | Origin header validation | `gateway/origin-check.ts` |
| Auth | Timing-safe token comparison | `gateway/auth.ts` |
| Auth | ED25519 device signatures (Phase 3) | `gateway/device-auth.ts` |
| Input | Zod validation on all RPC params | `gateway/methods/*.ts` |
| Input | External content sanitization | `security/external-content.ts` |
| Exec | User approval before every tool run | `agents/tools/bash-tool.ts` |
| Exec | Command allowlist/denylist | `agents/sandbox/tool-policy.ts` |
| Exec | Env var filtering (block `DYLD_*`, `NODE_OPTIONS`, etc.) | `process/exec.ts` |
| Exec | Process timeout (default 120s) | `process/exec.ts` |
| Exec | Docker sandbox option | `agents/sandbox/docker.ts` |
| Output | Secrets redaction (API keys, tokens) | `security/secrets-filter.ts` |
| Audit | Append-only log of all actions | `security/audit.ts` |
| Session | Role-based permission isolation | `acp/session.ts` |
| UI | DOMPurify on all rendered HTML | `ui/src/components/shared/markdown.ts` |
| Rate | Token-bucket rate limiter per session | `security/rate-limiter.ts` |

---

## Implementation Phases

### Phase 1: Foundation — Gateway + Agents + Tools
Build the core loop: send message → stream AI response → execute tools with approval.

1. Project scaffold (pnpm workspace, TS config, Vitest)
2. `src/shared/` — errors, crypto, text utilities
3. `src/logging/` — structured logger
4. `src/config/` — Zod schema, loader, defaults, paths
5. `src/gateway/` — HTTP server, WebSocket, protocol codec, auth
6. `src/gateway/methods/` — health, chat, agents, sessions, exec-approval
7. `src/agents/` — model-ref, catalog, Anthropic provider, OpenAI provider
8. `src/agents/tools/` — bash-tool with approval, file-tool
9. `src/sessions/` — session lifecycle, JSONL transcripts
10. `src/process/` — child process spawning with PTY
11. `src/security/` — audit logging, input sanitization, secrets filter
12. `src/acp/` — session permissions, command auth
13. `workspace/` — default AGENTS.md, SOUL.md, TOOLS.md

**Deliverable**: Working gateway that streams AI responses and executes tools with approval via WebSocket (testable with `wscat` or simple script).

### Phase 2: Memory + Frontend
Add persistent memory and a web interface.

1. `src/memory/` — SQLite + sqlite-vec, embeddings, hybrid search, manager
2. `src/agents/tools/memory-tool.ts` — agent-facing memory access
3. `src/gateway/methods/memory.ts` — memory search RPC
4. `ui/` — Lit + Vite scaffold, WebSocket client
5. Chat components — chat-view, message-list, message-item, input-bar
6. Tool approval dialog
7. Sidebar — session list, agent picker
8. Settings view
9. Markdown rendering with DOMPurify

**Deliverable**: Full web UI with chat, sessions, agent selection, tool approvals, and memory search.

### Phase 3: Hardening
Polish security and add remaining tools.

1. Docker sandbox mode
2. Rate limiter
3. ED25519 device auth
4. Config hot-reload
5. web-fetch-tool, web-search-tool
6. system.info, config.update methods
7. Comprehensive test suite
8. Error handling audit

---

## Verification

After each phase, verify:

1. **Phase 1**: Start gateway with `node dist/entry.js gateway`. Connect via WebSocket. Send `chat.send` with a test message. Verify streamed delta/final events. Send a tool-using prompt, verify approval request appears, approve it, verify tool output in response. Check `~/.virtual-assistant/audit.log` for logged actions. Check `~/.virtual-assistant/sessions/` for JSONL transcripts.

2. **Phase 2**: Open `http://localhost:5173` (Vite dev server). Verify chat UI renders. Send a message, see streamed response. Create a new session. Switch between sessions. Approve a tool execution via the dialog. Search memory via the sidebar/settings.

3. **Phase 3**: Run `pnpm test` — all unit and integration tests pass. Test Docker sandbox by configuring `tools.sandbox: "docker"`. Verify rate limiting blocks excessive requests. Test config hot-reload by editing `config.json` while server runs.

# Proj Jarvis

A local-first AI assistant (Jarvis) with a web UI, streaming responses, tool execution with user approval, persistent semantic memory, and cron-based task scheduling.

Inspired by [OpenClaw](https://github.com/openclaw/openclaw)'s architecture, built from scratch with a minimal and auditable codebase.

---

## Architecture

```
Browser UI (Lit + Vite)
    ↕ JSON-RPC over WebSocket
Gateway Server (Node.js, localhost:18789)
    ↕
Agent Runner → Anthropic / OpenAI
    ↕ (with user approval)
Tools: Bash, Browser (Playwright), Schedule
    ↕
Memory + Scheduler (SQLite + sqlite-vec)
```

See [DESIGN.md](./DESIGN.md) for the full architecture document.

---

## Quick Start

### Prerequisites
- Node.js 22+
- pnpm (`npm i -g pnpm`)
- An Anthropic or OpenAI API key

### Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd proj-jarvis
pnpm install

# 2. Configure
cp .env.example .env
# Edit .env — set PROJ_JARVIS_TOKEN and at least one AI API key

# 3. Start the gateway
pnpm dev

# 4. Start the UI (separate terminal)
cd ui && pnpm install && pnpm dev

# 5. Open http://localhost:5173, enter your token
```

---

## Features

### Tools
- **Bash** — run shell commands with user approval
- **Browser** — control a headless Chromium via Playwright (navigate, click, type, screenshot, extract text), with user approval
- **Schedule** — create, list, update, and delete recurring cron-based tasks via natural conversation (no approval needed)

### Memory
- Hybrid keyword + vector search over past session transcripts
- SQLite + sqlite-vec for vector cosine similarity
- OpenAI text-embedding-3-small embeddings (optional, falls back to keyword-only)

### Scheduler
- Persistent cron-based job scheduling stored in SQLite
- Jobs execute automatically at scheduled times using the full agent pipeline
- Auto-approved tool calls for unattended execution (bash, browser)
- Survives server restarts (jobs reload from database on startup)
- Manage schedules naturally via chat: "Check HN every morning at 8am and summarize the top stories"

---

## Implementation Status

| Phase | Description | Status |
|---|---|---|
| 1 | [Gateway Skeleton](docs/phases/phase-1-scaffold.md) | ✅ Complete |
| 2 | [Agents & Providers](docs/phases/phase-2-agents.md) | ✅ Complete |
| 3 | [Sessions & Chat RPC](docs/phases/phase-3-sessions.md) | ✅ Complete |
| 4 | [Tool Execution](docs/phases/phase-4-tools.md) | ✅ Complete |
| 4b | [Browser Tool](docs/phases/phase-4b-browser-tool.md) | ✅ Complete |
| 5 | [Persistent Memory](docs/phases/phase-5-memory.md) | ✅ Complete |
| 6 | [Web UI](docs/phases/phase-6-ui.md) | ✅ Complete |
| 7 | Scheduler | ✅ Complete |

---

## Security

- Gateway binds to `127.0.0.1` only — not accessible from other machines
- All WebSocket connections require a shared token (timing-safe comparison)
- Bash and browser tools require explicit user approval before execution
- Scheduled jobs auto-approve tools but are configured only by the authenticated user
- Tool output is filtered for secrets before storage or display
- Browser tool blocks `file://`, `chrome://`, and `javascript:` URLs, refuses password fields
- All tool executions are recorded in an append-only audit log (`~/.proj-jarvis/audit.jsonl`)
- All rendered HTML passes through DOMPurify

---

## Project Structure

```
proj-jarvis/
├── DESIGN.md          ← architecture & interface specification
├── docs/phases/       ← per-phase implementation instructions
├── src/               ← backend (Node.js + TypeScript)
│   ├── agents/        ← AI provider abstraction + agent runner
│   ├── config/        ← config schema, loader, paths
│   ├── gateway/       ← HTTP + WebSocket server, RPC methods
│   ├── memory/        ← SQLite + sqlite-vec search + indexing
│   ├── scheduler/     ← cron parser, engine, schema
│   ├── security/      ← audit log, secrets filter
│   ├── sessions/      ← session manager, transcripts
│   └── tools/         ← bash, browser, schedule tools + approval
├── tests/             ← node:test test suites (101 tests)
├── ui/                ← frontend (Lit + Vite)
└── workspace/         ← agent definitions (edit to customise)
    ├── AGENTS.md
    ├── SOUL.md
    └── TOOLS.md
```

---

## Data Directory

All persistent data lives in `~/.proj-jarvis/`:

```
~/.proj-jarvis/
├── config.json        ← configuration (auto-created with defaults)
├── memory.db          ← SQLite database (memory + scheduler tables)
├── audit.jsonl        ← append-only audit log
└── sessions/
    ├── <uuid>.jsonl   ← conversation transcripts
    └── <uuid>.meta.json
```

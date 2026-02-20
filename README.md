# Virtual Assistant

A local-first AI assistant with a web UI, streaming responses, tool execution with user approval, and persistent semantic memory.

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
Bash Tool → child_process
    ↕
Memory (SQLite + vector search)
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
cd virtual-assistant
pnpm install

# 2. Configure
cp .env.example .env
# Edit .env — set VIRTUAL_ASSISTANT_TOKEN and at least one AI API key

# 3. Start the gateway
pnpm dev

# 4. Start the UI (separate terminal)
cd ui && pnpm install && pnpm dev

# 5. Open http://localhost:5173, enter your token
```

---

## Implementation Status

| Phase | Description | Status |
|---|---|---|
| 1 | [Gateway Skeleton](docs/phases/phase-1-scaffold.md) | Not started |
| 2 | [Agents & Providers](docs/phases/phase-2-agents.md) | Not started |
| 3 | [Sessions & Chat RPC](docs/phases/phase-3-sessions.md) | Not started |
| 4 | [Tool Execution](docs/phases/phase-4-tools.md) | Not started |
| 5 | [Persistent Memory](docs/phases/phase-5-memory.md) | Not started |
| 6 | [Web UI](docs/phases/phase-6-ui.md) | Not started |

---

## Security

- Gateway binds to `127.0.0.1` only — not accessible from other machines
- All WebSocket connections require a shared token (timing-safe comparison)
- Every bash command requires explicit user approval before execution
- Tool output is filtered for secrets before storage or display
- All tool executions are recorded in an append-only audit log (`~/.virtual-assistant/audit.jsonl`)
- All rendered HTML passes through DOMPurify

---

## Project Structure

```
virtual-assistant/
├── DESIGN.md          ← architecture & interface specification
├── docs/phases/       ← per-phase implementation instructions
├── src/               ← backend (Node.js + TypeScript)
├── ui/                ← frontend (Lit + Vite)
└── workspace/         ← agent definitions (edit to customise)
    ├── AGENTS.md
    ├── SOUL.md
    └── TOOLS.md
```

---

## Data Directory

All persistent data lives in `~/.virtual-assistant/`:

```
~/.virtual-assistant/
├── config.json        ← configuration (auto-created with defaults)
├── memory.db          ← SQLite database (sessions + embeddings)
├── audit.jsonl        ← append-only audit log
└── sessions/
    ├── <uuid>.jsonl   ← conversation transcripts
    └── <uuid>.meta.json
```

# Phase 1 — Project Scaffold & Gateway Skeleton

## Goal
The server starts on `localhost:18789`, `/health` returns `{"status":"ok"}`, and WebSocket connections with a wrong token are rejected.

## Prerequisites
- Node.js 22+ installed
- pnpm installed (`npm i -g pnpm`)
- `PROJ_JARVIS_TOKEN` set in `.env` (copy from `.env.example`)

## Files to Create

### Root config files

#### `package.json`
- Purpose: root package, scripts, dependencies
- Key fields:
  ```json
  {
    "type": "module",
    "scripts": {
      "dev": "tsx watch src/index.ts",
      "build": "tsc",
      "start": "node dist/index.js"
    }
  }
  ```
- Dependencies: `ws`, `zod`
- Dev dependencies: `typescript`, `tsx`, `@types/node`, `@types/ws`

#### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

---

### `src/index.ts`
- Purpose: CLI entry point — parses args, loads config, starts gateway
- Key exports: none (side-effects only)
- Implementation notes:
  - Parse `--port` flag from `process.argv`
  - Call `loadConfig()` from `src/config/loader.ts`
  - Call `startServer(config)` from `src/gateway/server.ts`
  - Handle `SIGINT` / `SIGTERM` by calling `server.close()`
  - Log port on startup: `Listening on ws://127.0.0.1:<port>`

---

### `src/config/paths.ts`
- Purpose: resolve and initialise the data directory
- Key exports:
  ```typescript
  export function getDataDir(): string
  // Returns ~/.proj-jarvis/, creates it if absent (mkdirSync recursive)

  export function getConfigFilePath(): string
  // Returns ~/.proj-jarvis/config.json

  export function getSessionsDir(): string
  export function getAuditLogPath(): string
  ```
- Implementation notes: use `os.homedir()` + `path.join`; never throw if dir already exists

---

### `src/config/schema.ts`
- Purpose: Zod schema that validates the entire config object
- Key exports:
  ```typescript
  export const ConfigSchema: z.ZodObject<...>
  export type Config = z.infer<typeof ConfigSchema>
  ```
- Schema groups (all fields have defaults so config file is optional):
  ```typescript
  gateway: { port: 18789, host: '127.0.0.1' }
  agents:  { default: 'assistant', workspacePath?: string }
  tools:   { timeout: 120_000, maxOutputBytes: 100_000 }
  memory:  { enabled: true, embeddingModel: 'text-embedding-3-small' }
  security: { auditLog: true, secretsFilter: true }
  ```

---

### `src/config/loader.ts`
- Purpose: load `config.json` from disk, merge env overrides, validate with Zod
- Key exports:
  ```typescript
  export function loadConfig(): Config
  ```
- Implementation notes:
  - If `config.json` doesn't exist, use all Zod defaults (don't throw)
  - Env overrides (applied after JSON load):
    - `PROJ_JARVIS_PORT` → `gateway.port` (parse as integer)
    - `PROJ_JARVIS_HOST` → `gateway.host`
  - Run `ConfigSchema.parse(merged)` — let Zod throw on bad config
  - Store resolved token separately: read `PROJ_JARVIS_TOKEN` from env (not stored in config file)

---

### `src/gateway/server.ts`
- Purpose: create HTTP server, attach WebSocket, return a handle
- Key exports:
  ```typescript
  export interface GatewayServer { close(): Promise<void> }
  export async function startServer(config: Config): Promise<GatewayServer>
  ```
- Implementation notes:
  - Create `http.createServer(httpHandler)`
  - Create `new WebSocketServer({ noServer: true })`
  - Attach `server.on('upgrade', wsUpgradeHandler)` from `ws-handler.ts`
  - `server.listen(config.gateway.port, config.gateway.host)` — localhost only
  - `close()` calls `wss.close()` then `server.close()` wrapped in a Promise

---

### `src/gateway/auth.ts`
- Purpose: validate the shared token in a timing-safe way
- Key exports:
  ```typescript
  export function verifyToken(provided: string, expected: string): boolean
  ```
- Implementation notes:
  - Convert both strings to `Buffer` via `Buffer.from(s, 'utf8')`
  - If lengths differ, do a dummy compare then return false (avoids length-based timing leak)
  - Use `crypto.timingSafeEqual(a, b)` from `node:crypto`
  - **Never** log the provided token value, even on failure

---

### `src/gateway/http-handler.ts`
- Purpose: handle plain HTTP requests (health check, future static serving)
- Key exports:
  ```typescript
  export function createHttpHandler(config: Config): http.RequestListener
  ```
- Implementation notes:
  - `GET /health` → `200` with `Content-Type: application/json`, body `{"status":"ok","uptime":<seconds>}`
  - All other paths → `404` with `{"error":"not found"}`
  - No auth on health endpoint (intentional — used by monitoring)

---

### `src/gateway/ws-handler.ts`
- Purpose: handle WebSocket upgrade and per-connection lifecycle
- Key exports:
  ```typescript
  export function createWsUpgradeHandler(
    wss: WebSocketServer,
    methods: MethodRegistry,
    config: Config,
    token: string,
  ): (req, socket, head) => void
  ```
- Implementation notes:
  - Check `Origin` header: if present and not `localhost` / `127.0.0.1` / `::1`, destroy the socket (no upgrade)
  - After upgrade, wait for the **first** message only:
    - Parse JSON; expect `{ type: "auth", token: string }`
    - Call `verifyToken(provided, token)`
    - On success: send `{ type: "auth", ok: true }`, attach the regular message handler
    - On failure: send `{ type: "auth", ok: false, error: "invalid token" }`, then `ws.close(4401, "unauthorized")`
  - Regular message handler:
    - Parse JSON frame as `{ id, method, params }`
    - Look up method in registry; if not found → send `{ id, error: { code: -32601, message: "method not found" } }`
    - Call handler; catch errors → send `{ id, error: { code: -32603, message: err.message } }`
  - `sendEvent(event, data)` helper: sends `{ event, data }` JSON to the WS client (used by streaming methods)

---

### `src/gateway/methods/types.ts`
- Purpose: shared types for all RPC method handlers
- Key exports:
  ```typescript
  export interface MethodContext {
    sendEvent(event: string, data: unknown): void
    config: Config
    token: string
    // extended in later phases: sessionManager, toolRegistry, memory
  }

  export type MethodHandler = (params: unknown, ctx: MethodContext) => Promise<unknown>
  ```

---

### `src/gateway/methods/registry.ts`
- Purpose: register and dispatch RPC methods
- Key exports:
  ```typescript
  export class MethodRegistry {
    register(name: string, handler: MethodHandler): void
    dispatch(name: string, params: unknown, ctx: MethodContext): Promise<unknown>
    // throws if method not found
  }
  ```

---

### `src/gateway/methods/health.ts`
- Purpose: handle the `health.check` RPC method
- Key exports:
  ```typescript
  export const healthCheck: MethodHandler
  // Returns { status: 'ok', uptime: process.uptime() }
  ```
- Implementation notes: no auth check needed here (auth already enforced at WS connection level)

---

## Verification

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env and set token
cp .env.example .env
# Edit .env and set PROJ_JARVIS_TOKEN=mysecrettoken

# 3. Start server in dev mode
pnpm dev

# 4. Health check (no auth needed)
curl http://localhost:18789/health
# Expected: {"status":"ok","uptime":1.23}

# 5. Test valid WebSocket auth (requires wscat: npm i -g wscat)
wscat -c ws://localhost:18789
# Once connected, send:
{"type":"auth","token":"mysecrettoken"}
# Expected response: {"type":"auth","ok":true}
# Then send:
{"id":"1","method":"health.check","params":{}}
# Expected: {"id":"1","result":{"status":"ok","uptime":...}}

# 6. Test invalid token
wscat -c ws://localhost:18789
{"type":"auth","token":"wrongtoken"}
# Expected: {"type":"auth","ok":false,"error":"invalid token"}
# Connection should close shortly after

# 7. Test non-localhost origin rejection (optional)
curl -H "Origin: http://evil.com" \
     -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     http://localhost:18789
# Expected: connection refused / 400
```

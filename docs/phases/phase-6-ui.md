# Phase 6 — Web UI

## Goal
A full browser interface at `http://localhost:5173`: enter a token, chat with the assistant, see streamed responses, approve/deny tool calls via a dialog, switch between sessions, and view session history.

## Prerequisites
- Phase 5 complete and passing verification
- `pnpm` available in the `ui/` workspace
- Gateway running on `localhost:18789`

---

## Files to Create

### `ui/package.json`
```json
{
  "name": "virtual-assistant-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lit": "^3.0.0",
    "marked": "^17.0.0",
    "dompurify": "^3.0.0"
  },
  "devDependencies": {
    "@types/dompurify": "^3.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  }
}
```

---

### `ui/vite.config.ts`
```typescript
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:18789',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
    },
  },
})
```
- The proxy maps `/ws` → `ws://localhost:18789` so the UI connects to `ws://localhost:5173/ws` during development (avoids CORS/mixed-origin issues)

---

### `ui/index.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Virtual Assistant</title>
</head>
<body>
  <va-app></va-app>
  <script type="module" src="/src/app.ts"></script>
</body>
</html>
```

---

### `ui/src/auth-store.ts`
- Purpose: persist and retrieve the auth token across page refreshes
- Key exports:
  ```typescript
  export function getToken(): string | null
  export function setToken(token: string): void
  export function clearToken(): void
  ```
- Implementation notes:
  - Use `sessionStorage` (not `localStorage`) — token clears when tab closes
  - Key: `'va_token'`

---

### `ui/src/ws-client.ts`
- Purpose: manage the WebSocket connection — auth, RPC calls, push event subscriptions, reconnect
- Key exports:
  ```typescript
  export type EventHandler = (data: unknown) => void

  export class WsClient {
    constructor(url: string, token: string)

    async connect(): Promise<void>
    // Opens WS, sends auth frame, awaits auth response
    // Rejects if token invalid

    async request<T = unknown>(method: string, params?: unknown): Promise<T>
    // Sends { id, method, params }, returns a Promise resolved by the matching response
    // Rejects on { error } response or connection drop

    on(event: string, handler: EventHandler): () => void
    // Subscribe to server push events; returns unsubscribe function

    disconnect(): void
    // Close the connection intentionally (no reconnect)
  }
  ```
- Implementation notes:
  - ID generation: `crypto.randomUUID()` or incrementing counter
  - Pending requests: `Map<string, { resolve, reject }>` keyed by request ID
  - On incoming message: if `id` present → resolve/reject pending; if `event` present → call registered handlers
  - Reconnect: on unexpected close, wait 1s, 2s, 4s (exponential back-off, max 30s), then reconnect
  - Do NOT reconnect if `disconnect()` was called intentionally
  - Auth handshake: first send `{ type: "auth", token }`, wait for `{ type: "auth", ok: true/false }`

---

### `ui/src/components/markdown-renderer.ts`
- Purpose: safely render markdown to HTML inside a shadow DOM slot
- Custom element: `<va-markdown>`
- Key attributes/properties: `content: string`
- Implementation notes:
  - `marked.parse(content)` → raw HTML string
  - `DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })` → safe HTML
  - Set `this.shadowRoot.innerHTML = safeHtml` (use shadow DOM to scope styles)
  - Re-render on `content` property change via LitElement `@property`
  - **Never** skip DOMPurify — all content could contain AI-generated or tool-output HTML

---

### `ui/src/components/message-item.ts`
- Purpose: render a single chat message (user or assistant)
- Custom element: `<va-message-item>`
- Properties: `role: 'user' | 'assistant'`, `content: string`, `streaming?: boolean`
- Template:
  ```html
  <div class="message message--${role}">
    <div class="role-label">${role}</div>
    <va-markdown .content=${content}></va-markdown>
    ${streaming ? html`<span class="cursor">▋</span>` : ''}
  </div>
  ```
- Styles: user messages right-aligned with distinct background, assistant messages left-aligned

---

### `ui/src/components/message-list.ts`
- Purpose: display a scrollable list of messages
- Custom element: `<va-message-list>`
- Properties: `messages: Array<{ role, content, streaming? }>`
- Implementation notes:
  - Use `@state()` internally for the message array
  - On `updated()` lifecycle: scroll to bottom if last message is new (`scrollTop = scrollHeight`)
  - Expose `addDelta(runId, text)` and `finishRun(runId)` methods for streaming updates:
    - `addDelta`: find the in-progress assistant message by runId, append text
    - `finishRun`: set `streaming = false` on that message
  - Use `repeat()` directive from Lit for efficient list rendering

---

### `ui/src/components/input-bar.ts`
- Purpose: text input for composing messages
- Custom element: `<va-input-bar>`
- Properties: `disabled: boolean`
- Events emitted: `send` (CustomEvent with `{ message: string }`)
- Template:
  ```html
  <form @submit=${handleSubmit}>
    <textarea
      placeholder="Message..."
      @keydown=${handleKeydown}
      ?disabled=${disabled}
    ></textarea>
    <button type="submit" ?disabled=${disabled}>Send</button>
  </form>
  ```
- Implementation notes:
  - Submit on Enter (without Shift), new line on Shift+Enter
  - Clear textarea after dispatching `send` event
  - `disabled` while a response is streaming (to prevent concurrent sends)

---

### `ui/src/components/approval-dialog.ts`
- Purpose: modal dialog shown when the assistant requests tool approval
- Custom element: `<va-approval-dialog>`
- Properties: `approvalId: string`, `command: string`, `workingDir: string`, `visible: boolean`
- Events emitted: `approve` (CustomEvent with `{ approvalId }`), `deny` (CustomEvent with `{ approvalId, reason? }`)
- Template:
  ```html
  <dialog ?open=${visible}>
    <h3>Command Approval Required</h3>
    <p>The assistant wants to run:</p>
    <pre><code>${command}</code></pre>
    <p>Working directory: <code>${workingDir}</code></p>
    <div class="actions">
      <button @click=${deny} class="btn-deny">Deny</button>
      <button @click=${approve} class="btn-approve">Approve</button>
    </div>
  </dialog>
  ```
- Security notes:
  - Render `command` inside `<code>` — never use `innerHTML` for the command string
  - The dialog should be modal (block all other interaction until resolved)
  - Make "Deny" the default/focused button to require deliberate action to approve

---

### `ui/src/components/session-list.ts`
- Purpose: sidebar list of past sessions
- Custom element: `<va-session-list>`
- Properties: `sessions: SessionMeta[]`, `activeKey: string | null`
- Events emitted: `session-select` (CustomEvent with `{ sessionKey }`), `session-new`
- Template: list of session items with creation date, new session button at top

---

### `ui/src/components/chat-view.ts`
- Purpose: compose the full chat experience — messages, input, approval dialog
- Custom element: `<va-chat-view>`
- Properties: `client: WsClient`, `sessionKey: string`
- Internal state: `messages[]`, `streaming: boolean`, `pendingApproval: ApprovalRequest | null`
- On mount (`connectedCallback`):
  1. Call `client.request('chat.history', { sessionKey })` → populate `messages`
  2. Subscribe to `chat.delta` → call `messageList.addDelta(runId, text)`
  3. Subscribe to `chat.final` → `messageList.finishRun(runId)`, `streaming = false`, enable input
  4. Subscribe to `chat.error` → show error, `streaming = false`, enable input
  5. Subscribe to `exec.approval_request` → set `pendingApproval`, show dialog
- On send event from `<va-input-bar>`:
  1. Disable input bar (`streaming = true`)
  2. Add user message to list optimistically
  3. Call `client.request('chat.send', { sessionKey, message })`
  4. Add empty assistant message (streaming) to list with the returned `runId`
- On approve from `<va-approval-dialog>`:
  - Call `client.request('exec.approve', { approvalId })`; clear `pendingApproval`
- On deny:
  - Call `client.request('exec.deny', { approvalId })`; clear `pendingApproval`

---

### `ui/src/app.ts`
- Purpose: root application component — auth gate, session sidebar, chat view
- Custom element: `<va-app>`
- Internal state: `authenticated: boolean`, `client: WsClient | null`, `sessions: SessionMeta[]`, `activeSessionKey: string | null`
- On mount:
  1. Check `getToken()` — if present, attempt to connect and authenticate
  2. If auth fails, show token entry form
- Token entry form (when not authenticated):
  ```html
  <form @submit=${handleTokenSubmit}>
    <input type="password" placeholder="Enter token" />
    <button>Connect</button>
  </form>
  ```
- After auth:
  1. Load sessions: `client.request('sessions.list')`
  2. Render: sidebar with `<va-session-list>` + main area with `<va-chat-view>`
- On `session-new`: `client.request('sessions.create')` → add to list, switch active session
- On `session-select`: switch `activeSessionKey`

---

## Verification

```bash
# 1. Install UI dependencies
cd ui && pnpm install && cd ..

# 2. Start the gateway backend
pnpm dev

# 3. In another terminal, start the UI dev server
cd ui && pnpm dev

# 4. Open browser at http://localhost:5173

# 5. Token gate
# Enter the wrong token → should show an error
# Enter the correct token → should proceed to chat

# 6. New session
# Click "New Session" → session appears in sidebar

# 7. Basic chat
# Type "Hello, I am testing the UI" → press Enter
# Expected: message appears, assistant response streams in word by word
# Cursor blinks while streaming, disappears when complete

# 8. Tool approval
# Type "Please run the command: date"
# Expected: approval dialog appears with the command visible
# Click "Approve" → output appears in assistant response
# Repeat and click "Deny" → assistant acknowledges denial

# 9. Session persistence
# Refresh the browser → reconnects, sessions list still visible
# Click the previous session → history loads from server

# 10. Multiple sessions
# Create two sessions, chat in each, switch between them
# Expected: each maintains independent history

# 11. Markdown rendering
# Ask: "Show me a code example in Python"
# Expected: code block renders with monospace font, no raw HTML visible

# 12. Security check
# Open browser devtools → Elements panel
# Inspect a message containing markdown
# Confirm no <script> tags or on* event handlers in rendered HTML
```

---

## Notes on Production Build

When shipping (not covered by POC):
1. Run `cd ui && pnpm build` — outputs to `ui/dist/`
2. In `src/gateway/http-handler.ts`, serve `ui/dist/` as static files for any request that isn't `/health` or a WebSocket
3. The WS connection URL changes from `ws://localhost:5173/ws` to `ws://localhost:18789` directly

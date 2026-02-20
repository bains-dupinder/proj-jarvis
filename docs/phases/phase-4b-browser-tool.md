# Phase 4b — Browser Tool (Playwright)

## Goal
The agent can control a browser: navigate to a URL, click elements, take screenshots, and return page content — all after user approval, with progress streamed back in real time.

## Prerequisites
- Phase 4 complete and passing verification (bash tool, approval flow, registry all working)
- Playwright installed: `pnpm add playwright` + `npx playwright install chromium`

## Why Playwright
- Native `page.screenshot({ encoding: 'base64' })` — no extra encoding step
- Clean async API maps directly to tool action types
- Built-in smart waiting (auto-waits for elements to be ready)
- Multi-context support for isolated browser sessions per agent run
- ESM + Node 22 support out of the box

---

## Design: How the Browser Tool Fits the Tool Interface

The browser tool takes a **sequence of actions** as its input (rather than a single command like bash). This lets the model compose a multi-step browsing session in one tool call:

```typescript
// Input schema
const BrowserInput = z.object({
  actions: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('navigate'), url: z.string().url() }),
    z.object({ type: z.literal('click'),    selector: z.string() }),
    z.object({ type: z.literal('type'),     selector: z.string(), text: z.string() }),
    z.object({ type: z.literal('screenshot') }),
    z.object({ type: z.literal('extract'),  selector: z.string().optional() }),
    // 'extract' returns innerText of selector (or full page if omitted)
  ])),
  sessionId: z.string().optional(),  // reuse an existing browser context
})
```

Each action is executed sequentially. After each action, a `tool.progress` event is pushed to the UI. Screenshots are returned as `ToolAttachment[]` in the `ToolResult`.

---

## Files to Create / Modify

### `src/tools/browser.ts`
- Purpose: Playwright-based browser control tool implementing `Tool`
- Key exports:
  ```typescript
  export class BrowserTool implements Tool {
    name = 'browser'
    description = '...'
    requiresApproval = true
    inputSchema = BrowserInput
    constructor(sessionManager: BrowserSessionManager, config: Config)
    toDefinition(): ToolDefinition
    async execute(input: unknown, context: ToolContext): Promise<ToolResult>
  }
  ```

#### `execute()` implementation
1. Validate input with Zod (`BrowserInput`)
2. Summarise the action plan for the approval request:
   ```typescript
   context.sendEvent('exec.approval_request', {
     approvalId,
     toolName: 'browser',
     summary: `${actions.length} browser action(s) — first: ${describeAction(actions[0])}`,
     details: { actions },
   })
   ```
3. Await approval via `approvalManager.request(...)`
4. Get or create a Playwright browser context via `BrowserSessionManager`
5. For each action:
   - Call `context.reportProgress(describeAction(action))` — pushes `tool.progress` event
   - Execute the action on the Playwright `Page`:
     - `navigate` → `await page.goto(url, { waitUntil: 'domcontentloaded' })`
     - `click` → `await page.click(selector)`
     - `type` → `await page.fill(selector, text)`
     - `screenshot` → `const data = await page.screenshot({ encoding: 'base64' })`; add to attachments
     - `extract` → `const text = await page.evaluate(sel => document.querySelector(sel)?.innerText ?? document.body.innerText, selector)`
6. Collect results:
   - Text summary of each action's outcome
   - Attachments array for all screenshots
7. Return `ToolResult { output: summary, attachments }`

- Security notes:
  - Never fill `<input type="password">` elements — detect type and refuse
  - Restrict navigable URLs: block `file://`, `chrome://`, `about:` schemes
  - Sandbox: run Playwright with `{ args: ['--no-sandbox', '--disable-dev-shm-usage'] }` in headless mode
  - No persistent browser profile — each `BrowserSessionManager` context is ephemeral

---

### `src/tools/browser-session.ts`
- Purpose: manage Playwright browser lifecycle — one shared `Browser` instance, per-run `BrowserContext`
- Key exports:
  ```typescript
  export class BrowserSessionManager {
    constructor()

    async getPage(sessionId?: string): Promise<{ page: Page; sessionId: string }>
    // If sessionId exists and context is alive, return its page
    // Otherwise launch a new context and return a fresh page

    async closeSession(sessionId: string): Promise<void>
    // Close the BrowserContext for this sessionId

    async closeAll(): Promise<void>
    // Close all contexts + the shared Browser instance (called on server shutdown)
  }
  ```
- Implementation notes:
  - Lazy-launch: `chromium.launch({ headless: true })` on first `getPage()` call
  - Store contexts: `Map<string, BrowserContext>`
  - Session IDs: `crypto.randomUUID()`
  - On server `close()`: call `browserSessionManager.closeAll()`

---

### Update `src/tools/types.ts`
Add `ToolAttachment` and `reportProgress` to existing interfaces:
```typescript
// Add to ToolContext:
reportProgress: (message: string) => void

// Add to ToolResult:
attachments?: ToolAttachment[]

// New interface:
export interface ToolAttachment {
  type: 'image' | 'file'
  mimeType: string      // e.g. 'image/png'
  data: string          // base64-encoded
  name?: string
}
```

### Update `src/tools/bash.ts`
Add `reportProgress` to the `ToolContext` it receives — bash can use it to stream "Running command..." before spawning.

### Update `src/gateway/methods/types.ts`
Extend `MethodContext` with:
```typescript
browserSessionManager: BrowserSessionManager
```

### Update `src/gateway/server.ts`
- Instantiate `BrowserSessionManager`
- Pass to `MethodContext`
- Register `BrowserTool` in tool registry:
  ```typescript
  toolRegistry.register(new BashTool(approvalManager, config))
  toolRegistry.register(new BrowserTool(browserSessionManager, config))
  ```
- On server `close()`: `await browserSessionManager.closeAll()`

### Update `src/agents/runner.ts`
Wire `reportProgress` into `ToolContext`:
```typescript
const toolContext: ToolContext = {
  sessionKey,
  runId,
  sendEvent: ctx.sendEvent,
  reportProgress: (message) => ctx.sendEvent('tool.progress', { runId, tool: toolName, message }),
  config: ctx.config,
}
```

### Update `src/gateway/ws-handler.ts` / `chat.ts`
Handle `ToolAttachment[]` in tool results:
- When `chat.final` is sent, include any attachments from tool results as part of the assistant message
- The UI can render screenshots inline in the message thread

### Update `workspace/TOOLS.md`
Already done — browser tool description added.

---

## `exec.approval_request` Event — Updated Generic Shape

Phase 4 had the approval request hardcoded for bash. Make it generic now:

```typescript
// Generic approval request (replaces bash-specific shape)
interface ApprovalRequest {
  approvalId: string
  toolName: string          // 'bash' | 'browser' | any future tool
  summary: string           // one-line human-readable description
  details: unknown          // tool-specific details shown in dialog
}

// bash details:
{ command: string; workingDir: string }

// browser details:
{ actions: BrowserAction[] }
```

Update `src/gateway/methods/exec.ts` — no changes needed (already uses `approvalId` only).
Update `src/tools/approval.ts` — store `ApprovalRequest` alongside the promise (for display in future UI enhancements).
Update `<jarvis-approval-dialog>` in Phase 6 UI to render details based on `toolName`.

---

## Verification

```bash
# 1. Install Playwright
cd /Users/bains/mycode/proj-jarvis
pnpm add playwright
npx playwright install chromium

# 2. Start server
pnpm dev

# 3. Connect and auth
wscat -c ws://localhost:18789
{"type":"auth","token":"mysecrettoken"}

# 4. Create session
{"id":"1","method":"sessions.create","params":{}}
# copy sessionKey

# 5. Ask the agent to browse
{"id":"2","method":"chat.send","params":{"sessionKey":"<uuid>","message":"Go to https://example.com and take a screenshot"}}

# Expected sequence:
# {"id":"2","result":{"runId":"<run-uuid>"}}
# {"event":"exec.approval_request","data":{"approvalId":"<ap>","toolName":"browser","summary":"2 browser action(s) — first: Navigate to https://example.com","details":{...}}}

# 6. Approve
{"id":"3","method":"exec.approve","params":{"approvalId":"<ap>"}}

# Expected:
# {"event":"tool.progress","data":{"runId":"...","tool":"browser","message":"Navigating to https://example.com..."}}
# {"event":"tool.progress","data":{"runId":"...","tool":"browser","message":"Taking screenshot..."}}
# {"event":"chat.delta","data":{"runId":"...","text":"I've navigated to example.com. Here's the screenshot:"}}
# {"event":"chat.final","data":{"runId":"...","usage":{...}}}

# 7. Verify screenshot attachment in transcript
cat ~/.proj-jarvis/sessions/<uuid>.jsonl | python3 -c "import sys,json; [print(e.get('attachments','')) for e in map(json.loads, sys.stdin) if e.get('attachments')]"
# Expected: base64 PNG data present

# 8. Test multi-step browsing
{"id":"4","method":"chat.send","params":{"sessionKey":"<uuid>","message":"Go to https://news.ycombinator.com, take a screenshot, then extract the text of the first story title"}}
# After approval: should see 3 progress events, screenshot attachment, and extracted title in response

# 9. Test security: password field refusal
{"id":"5","method":"chat.send","params":{"sessionKey":"<uuid>","message":"Go to https://github.com/login and fill in the password field"}}
# Expected: agent should refuse to fill password fields, explain why
```

---

## Notes on Future Tool Additions

To add any new tool after this phase (e.g. a web-search tool, file editor tool, calendar tool):

1. Create `src/tools/<name>.ts` implementing the `Tool` interface
2. Add it to `workspace/TOOLS.md` so the model knows it exists
3. Register it in `src/gateway/server.ts`

No other files need to change. The registry, approval flow, agent runner, and RPC methods are all tool-agnostic.

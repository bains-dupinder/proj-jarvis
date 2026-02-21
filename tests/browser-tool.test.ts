import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserTool } from '../src/tools/browser.js'
import { ApprovalManager } from '../src/tools/approval.js'
import { BrowserSessionManager } from '../src/tools/browser-session.js'
import { ConfigSchema } from '../src/config/schema.js'
import type { ToolContext } from '../src/tools/types.js'

const config = ConfigSchema.parse({})
const approvalManager = new ApprovalManager()
const sessionManager = new BrowserSessionManager()
const tool = new BrowserTool(approvalManager, sessionManager, config)

/**
 * Create a test ToolContext that auto-approves on next tick.
 * The approval must be deferred because execute() calls sendEvent synchronously
 * before awaiting approvalManager.request(), so the pending entry doesn't exist yet
 * when sendEvent fires.
 */
function makeCtx(): { ctx: ToolContext; events: Array<{ event: string; data: unknown }>; progress: string[] } {
  const events: Array<{ event: string; data: unknown }> = []
  const progress: string[] = []
  const ctx: ToolContext = {
    sessionKey: 'test-session',
    runId: 'test-run',
    sendEvent: (event, data) => {
      events.push({ event, data })
      if (event === 'exec.approval_request') {
        const req = data as { approvalId: string }
        // Defer so request() has time to register the pending entry
        setTimeout(() => approvalManager.resolve(req.approvalId), 0)
      }
    },
    reportProgress: (msg) => progress.push(msg),
    config,
  }
  return { ctx, events, progress }
}

after(async () => {
  await sessionManager.closeAll()
})

describe('BrowserTool', () => {
  it('has correct metadata', () => {
    assert.equal(tool.name, 'browser')
    assert.equal(tool.requiresApproval, true)
    const def = tool.toDefinition()
    assert.equal(def.name, 'browser')
    assert.ok(def.inputSchema)
  })

  it('navigates to a URL and extracts title', async () => {
    const { ctx, progress } = makeCtx()
    const result = await tool.execute({
      actions: [
        { type: 'navigate', url: 'data:text/html,<html><head><title>Test Page</title></head><body><h1>Hello</h1></body></html>' },
        { type: 'extract', selector: 'h1' },
      ],
    }, ctx)

    assert.ok(result.output.includes('Test Page'), 'should include page title')
    assert.ok(result.output.includes('Hello'), 'should include extracted text')
    assert.ok(progress.length >= 2, 'should report progress for each action')
  })

  it('takes a screenshot and returns attachment', async () => {
    const { ctx } = makeCtx()
    const result = await tool.execute({
      actions: [
        { type: 'navigate', url: 'data:text/html,<h1>Screenshot Test</h1>' },
        { type: 'screenshot' },
      ],
    }, ctx)

    assert.ok(result.attachments, 'should have attachments')
    assert.equal(result.attachments!.length, 1)
    assert.equal(result.attachments![0]!.type, 'image')
    assert.equal(result.attachments![0]!.mimeType, 'image/png')
    assert.ok(result.attachments![0]!.data.length > 100, 'base64 data should be non-trivial')
  })

  it('blocks file:// URLs', async () => {
    const { ctx } = makeCtx()
    const result = await tool.execute({
      actions: [
        { type: 'navigate', url: 'file:///etc/passwd' },
      ],
    }, ctx)

    assert.ok(result.output.includes('Blocked'), 'should block file:// scheme')
  })

  it('refuses to fill password fields', async () => {
    const { ctx } = makeCtx()
    const result = await tool.execute({
      actions: [
        { type: 'navigate', url: 'data:text/html,<input type="password" id="pw" />' },
        { type: 'type', selector: '#pw', text: 'secret' },
      ],
    }, ctx)

    assert.ok(result.output.includes('Refused') || result.output.includes('password'), 'should refuse password fields')
  })

  it('rejects invalid input', async () => {
    const { ctx } = makeCtx()
    const result = await tool.execute({ actions: [] }, ctx)
    assert.ok(result.output.includes('Invalid input'), 'empty actions should fail validation')
  })

  it('returns denied message when user denies', async () => {
    const denyApprovalManager = new ApprovalManager()
    const denyTool = new BrowserTool(denyApprovalManager, sessionManager, config)

    const events: Array<{ event: string; data: unknown }> = []
    const ctx: ToolContext = {
      sessionKey: 'test-session',
      runId: 'test-run',
      sendEvent: (event, data) => {
        events.push({ event, data })
        if (event === 'exec.approval_request') {
          const req = data as { approvalId: string }
          setTimeout(() => denyApprovalManager.reject(req.approvalId, 'not allowed'), 0)
        }
      },
      reportProgress: () => {},
      config,
    }

    const result = await denyTool.execute({
      actions: [{ type: 'navigate', url: 'https://example.com' }],
    }, ctx)

    assert.ok(result.output.includes('denied'), 'should indicate denial')
  })
})

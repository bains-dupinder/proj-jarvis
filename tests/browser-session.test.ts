import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserSessionManager } from '../src/tools/browser-session.js'

describe('BrowserSessionManager', () => {
  const mgr = new BrowserSessionManager()

  after(async () => {
    await mgr.closeAll()
  })

  it('creates a new page with a generated sessionId', async () => {
    const { page, sessionId } = await mgr.getPage()
    assert.ok(sessionId, 'sessionId should be set')
    assert.ok(page, 'page should exist')
    // Page should be usable
    await page.goto('data:text/html,<h1>hello</h1>')
    const title = await page.evaluate(() => document.querySelector('h1')?.textContent)
    assert.equal(title, 'hello')
    await mgr.closeSession(sessionId)
  })

  it('reuses a page for the same sessionId', async () => {
    const { sessionId } = await mgr.getPage()
    const { sessionId: sid2, page: page2 } = await mgr.getPage(sessionId)
    assert.equal(sid2, sessionId, 'should reuse sessionId')
    assert.ok(page2, 'page should exist')
    await mgr.closeSession(sessionId)
  })

  it('closeSession removes the context', async () => {
    const { sessionId } = await mgr.getPage()
    await mgr.closeSession(sessionId)
    // Getting the same sessionId should create a new context
    const { sessionId: sid2 } = await mgr.getPage(sessionId)
    assert.equal(sid2, sessionId, 'should create under same ID')
    await mgr.closeSession(sessionId)
  })

  it('closeAll shuts down all contexts', async () => {
    await mgr.getPage()
    await mgr.getPage()
    await mgr.closeAll()
    // After closeAll, getting a page should still work (lazy re-launch)
    const { page } = await mgr.getPage()
    assert.ok(page, 'should create new page after closeAll')
    await mgr.closeAll()
  })
})

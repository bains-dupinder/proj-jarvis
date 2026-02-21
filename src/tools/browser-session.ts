import { randomUUID } from 'node:crypto'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

export interface BrowserPage {
  page: Page
  sessionId: string
}

/**
 * Manages a shared Playwright Browser instance and per-run BrowserContexts.
 * Lazy-launches Chromium on first getPage() call.
 */
export class BrowserSessionManager {
  private browser: Browser | null = null
  private contexts = new Map<string, BrowserContext>()

  /**
   * Get or create a page for the given sessionId.
   * If no sessionId is provided, creates a new context with a fresh ID.
   */
  async getPage(sessionId?: string): Promise<BrowserPage> {
    // Lazy-launch browser
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      })
    }

    // Reuse existing context if alive
    if (sessionId) {
      const existing = this.contexts.get(sessionId)
      if (existing) {
        const pages = existing.pages()
        if (pages.length > 0) {
          return { page: pages[0]!, sessionId }
        }
        // Context exists but no pages — create one
        const page = await existing.newPage()
        return { page, sessionId }
      }
    }

    // Create new context + page
    const id = sessionId ?? randomUUID()
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'ProjJarvis/1.0 (Headless Chromium)',
    })
    this.contexts.set(id, context)
    const page = await context.newPage()
    return { page, sessionId: id }
  }

  /**
   * Close a specific browser context by session ID.
   */
  async closeSession(sessionId: string): Promise<void> {
    const ctx = this.contexts.get(sessionId)
    if (ctx) {
      await ctx.close()
      this.contexts.delete(sessionId)
    }
  }

  /**
   * Close all contexts and the shared browser instance.
   * Called on server shutdown.
   */
  async closeAll(): Promise<void> {
    for (const [id, ctx] of this.contexts) {
      try {
        await ctx.close()
      } catch {
        // best effort
      }
      this.contexts.delete(id)
    }
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}

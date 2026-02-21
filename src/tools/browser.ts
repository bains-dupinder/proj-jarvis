import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Page } from 'playwright'
import type { ToolDefinition } from '../agents/providers/types.js'
import type { Config } from '../config/schema.js'
import type { Tool, ToolContext, ToolResult, ToolAttachment } from './types.js'
import type { BrowserSessionManager } from './browser-session.js'
import { ApprovalManager, DeniedError } from './approval.js'

// ── Action schemas ──

const NavigateAction = z.object({
  type: z.literal('navigate'),
  url: z.string().url(),
})

const ClickAction = z.object({
  type: z.literal('click'),
  selector: z.string(),
})

const TypeAction = z.object({
  type: z.literal('type'),
  selector: z.string(),
  text: z.string(),
})

const ScreenshotAction = z.object({
  type: z.literal('screenshot'),
})

const ExtractAction = z.object({
  type: z.literal('extract'),
  selector: z.string().optional(),
})

const BrowserAction = z.discriminatedUnion('type', [
  NavigateAction,
  ClickAction,
  TypeAction,
  ScreenshotAction,
  ExtractAction,
])

const BrowserInput = z.object({
  actions: z.array(BrowserAction).min(1).max(20),
  sessionId: z.string().optional(),
})

type BrowserActionType = z.infer<typeof BrowserAction>

// ── Security helpers ──

const BLOCKED_SCHEMES = ['file:', 'chrome:', 'chrome-extension:', 'about:', 'javascript:']
const NAVIGATION_COMMIT_TIMEOUT_MS = 20_000
const NAVIGATION_DOMCONTENT_TIMEOUT_MS = 3_000

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url)
    return !BLOCKED_SCHEMES.includes(parsed.protocol)
  } catch {
    return false
  }
}

async function isPasswordField(page: Page, selector: string): Promise<boolean> {
  try {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return el instanceof HTMLInputElement && el.type === 'password'
    }, selector)
  } catch {
    return false
  }
}

function describeAction(action: BrowserActionType): string {
  switch (action.type) {
    case 'navigate':
      return `Navigate to ${action.url}`
    case 'click':
      return `Click "${action.selector}"`
    case 'type':
      return `Type into "${action.selector}"`
    case 'screenshot':
      return 'Take screenshot'
    case 'extract':
      return action.selector ? `Extract text from "${action.selector}"` : 'Extract full page text'
  }
}

// ── BrowserTool ──

export class BrowserTool implements Tool {
  name = 'browser'
  description =
    'Control a headless browser: navigate to URLs, click elements, type text, take screenshots, ' +
    'and extract page content. The user must approve every browser session before it executes. ' +
    'Input is a sequence of actions executed in order.'
  requiresApproval = true
  inputSchema = BrowserInput

  constructor(
    private approvalManager: ApprovalManager,
    private sessionManager: BrowserSessionManager,
    private config: Config,
  ) {}

  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      inputSchema: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: 'Sequence of browser actions to execute',
            items: {
              type: 'object',
              description:
                'A browser action. type is one of: navigate, click, type, screenshot, extract. ' +
                'navigate requires url. click/type require selector. type also requires text. ' +
                'extract optionally takes selector (defaults to full page).',
              properties: {
                type: { type: 'string', enum: ['navigate', 'click', 'type', 'screenshot', 'extract'] },
                url: { type: 'string', description: 'URL to navigate to (for navigate action)' },
                selector: { type: 'string', description: 'CSS selector (for click/type/extract)' },
                text: { type: 'string', description: 'Text to type (for type action)' },
              },
              required: ['type'],
            },
          },
          sessionId: {
            type: 'string',
            description: 'Reuse an existing browser session by its ID (optional)',
          },
        },
        required: ['actions'],
      },
    }
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = BrowserInput.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}` }
    }

    const { actions, sessionId } = parsed.data
    const approvalId = randomUUID()

    // Push approval request
    context.sendEvent('exec.approval_request', {
      approvalId,
      toolName: this.name,
      summary: `${actions.length} browser action(s) — first: ${describeAction(actions[0]!)}`,
      details: { actions: actions.map(describeAction) },
    })

    // Wait for approval
    try {
      await this.approvalManager.request(approvalId)
    } catch (err) {
      if (err instanceof DeniedError) {
        return {
          output: `Browser actions denied by user${err.message !== 'Denied by user' ? ': ' + err.message : '.'}`,
        }
      }
      throw err
    }

    // Get or create browser page
    const { page, sessionId: sid } = await this.sessionManager.getPage(sessionId)
    const attachments: ToolAttachment[] = []
    const results: string[] = []
    let screenshotCount = 0

    for (const action of actions) {
      context.reportProgress(describeAction(action) + '...')

      try {
        const result = await this.executeAction(
          page,
          action,
          attachments,
          screenshotCount,
          context.reportProgress,
        )
        results.push(result.text)
        screenshotCount = result.screenshotCount
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Action failed'
        results.push(`[${action.type}] Error: ${msg}`)
        break // Stop on first error
      }
    }

    const summary = [
      `Browser session: ${sid}`,
      ...results.map((r, i) => `${i + 1}. ${r}`),
    ].join('\n')

    return {
      output: summary,
      attachments: attachments.length > 0 ? attachments : undefined,
    }
  }

  private async executeAction(
    page: Page,
    action: BrowserActionType,
    attachments: ToolAttachment[],
    screenshotCount: number,
    reportProgress: (message: string) => void,
  ): Promise<{ text: string; screenshotCount: number }> {
    switch (action.type) {
      case 'navigate': {
        if (!isUrlAllowed(action.url)) {
          return {
            text: `[navigate] Blocked: URL scheme not allowed (${action.url})`,
            screenshotCount,
          }
        }
        await page.goto(action.url, {
          waitUntil: 'commit',
          timeout: NAVIGATION_COMMIT_TIMEOUT_MS,
        })
        let domContentLoaded = true
        try {
          await page.waitForLoadState('domcontentloaded', {
            timeout: NAVIGATION_DOMCONTENT_TIMEOUT_MS,
          })
        } catch {
          domContentLoaded = false
          reportProgress('Page still loading; continuing with available content.')
        }
        // Some sites never reach DOMContentLoaded under bot checks. Ensure body exists if possible.
        await page.waitForSelector('body', { timeout: 4_000 }).catch(() => {})
        const title = await page.title()
        return {
          text:
            `[navigate] Loaded: ${title} (${action.url})` +
            (domContentLoaded ? '' : ' [domcontentloaded timeout; continued after commit]'),
          screenshotCount,
        }
      }

      case 'click': {
        await page.click(action.selector, { timeout: 10_000 })
        return { text: `[click] Clicked "${action.selector}"`, screenshotCount }
      }

      case 'type': {
        if (await isPasswordField(page, action.selector)) {
          return {
            text: `[type] Refused: cannot fill password fields for security`,
            screenshotCount,
          }
        }
        await page.fill(action.selector, action.text, { timeout: 10_000 })
        return { text: `[type] Typed into "${action.selector}"`, screenshotCount }
      }

      case 'screenshot': {
        screenshotCount++
        const buffer = await page.screenshot({ type: 'png' })
        const base64 = buffer.toString('base64')
        attachments.push({
          type: 'image',
          mimeType: 'image/png',
          data: base64,
          name: `screenshot-${screenshotCount}.png`,
        })
        return { text: `[screenshot] Captured screenshot-${screenshotCount}.png`, screenshotCount }
      }

      case 'extract': {
        const selector = action.selector
        await page.waitForSelector('body', { timeout: 4_000 }).catch(() => {})
        const text = await page.evaluate((sel) => {
          if (sel) {
            const el = document.querySelector(sel)
            return el?.textContent?.trim() ?? `No element found for "${sel}"`
          }
          const root = document.body ?? document.documentElement
          if (!root) return 'No extractable text on page yet'
          return root.innerText.trim()
        }, selector ?? null)

        // Truncate to a sensible limit
        const maxLen = 10_000
        const truncated = text.length > maxLen
          ? text.slice(0, maxLen) + '\n...[truncated]'
          : text

        return {
          text: `[extract] ${selector ? `Text from "${selector}"` : 'Full page text'}:\n${truncated}`,
          screenshotCount,
        }
      }
    }
  }
}

import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { WebSocketServer } from 'ws'
import type { Config } from '../config/schema.js'
import type { ModelProvider } from '../agents/providers/types.js'
import { AnthropicProvider } from '../agents/providers/anthropic.js'
import { OpenAIProvider } from '../agents/providers/openai.js'
import { SessionManager } from '../sessions/manager.js'
import { getSessionsDir, getAuditLogPath, getDataDir } from '../config/paths.js'
import { ToolRegistry } from '../tools/registry.js'
import { ApprovalManager } from '../tools/approval.js'
import { BashTool } from '../tools/bash.js'
import { BrowserTool } from '../tools/browser.js'
import { BrowserSessionManager } from '../tools/browser-session.js'
import { AuditLogger } from '../security/audit.js'
import { openMemoryDb, type MemoryDb } from '../memory/db.js'
import { OpenAIEmbeddingProvider, type EmbeddingProvider } from '../memory/embeddings.js'
import { IndexManager } from '../memory/indexer.js'
import { indexSessionTranscripts } from '../memory/session-files.js'
import { createHttpHandler } from './http-handler.js'
import { createWsUpgradeHandler } from './ws-handler.js'
import { MethodRegistry } from './methods/registry.js'
import { healthCheck } from './methods/health.js'
import { agentsList } from './methods/agents.js'
import { sessionsCreate, sessionsList, sessionsGet } from './methods/sessions.js'
import { chatSend, chatHistory, chatAbort } from './methods/chat.js'
import { execApprove, execDeny } from './methods/exec.js'
import { memorySearch } from './methods/memory.js'

export interface GatewayServer {
  close(): Promise<void>
}

/**
 * Create provider instances from available API keys.
 */
function createProviders(): Map<string, ModelProvider> {
  const providers = new Map<string, ModelProvider>()

  const anthropicKey = process.env['ANTHROPIC_API_KEY']
  if (anthropicKey) {
    providers.set('anthropic', new AnthropicProvider(anthropicKey))
    console.log('  ✓ Anthropic provider ready')
  }

  const openaiKey = process.env['OPENAI_API_KEY']
  if (openaiKey) {
    providers.set('openai', new OpenAIProvider(openaiKey))
    console.log('  ✓ OpenAI provider ready')
  }

  if (providers.size === 0) {
    console.warn('  ⚠ No AI providers configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY')
  }

  return providers
}

export async function startServer(config: Config, token: string): Promise<GatewayServer> {
  const providers = createProviders()
  const sessionManager = new SessionManager(getSessionsDir())
  const activeRuns = new Map<string, AbortController>()

  // Tool infrastructure
  const approvalManager = new ApprovalManager()
  const toolRegistry = new ToolRegistry()
  const auditLogger = new AuditLogger(getAuditLogPath(), config.security.auditLog)
  const browserSessionManager = new BrowserSessionManager()

  // Register tools
  toolRegistry.register(new BashTool(approvalManager, config))
  toolRegistry.register(new BrowserTool(approvalManager, browserSessionManager, config))
  console.log(`  ✓ ${toolRegistry.all().length} tool(s) registered: ${toolRegistry.all().map(t => t.name).join(', ')}`)

  // Memory system
  let memoryDb: MemoryDb | null = null
  let embedder: EmbeddingProvider | null = null

  try {
    const dbPath = join(getDataDir(), 'memory.db')
    memoryDb = openMemoryDb(dbPath)

    const openaiKey = process.env['OPENAI_API_KEY']
    if (openaiKey) {
      embedder = new OpenAIEmbeddingProvider(openaiKey)
      console.log('  ✓ Memory system ready (keyword + vector search)')
    } else {
      console.log('  ✓ Memory system ready (keyword search only — set OPENAI_API_KEY for vectors)')
    }

    // Index existing session transcripts in the background
    const indexManager = new IndexManager(memoryDb, embedder)
    indexSessionTranscripts(indexManager, getSessionsDir())
      .then(({ indexed, skipped }) => {
        if (indexed > 0 || skipped > 0) {
          console.log(`  ✓ Memory indexed ${indexed} transcript(s), ${skipped} unchanged`)
        }
      })
      .catch((err) => console.warn('[memory] Background indexing failed:', err))
  } catch (err) {
    console.warn('  ⚠ Memory system unavailable:', (err as Error).message)
  }

  // Resolve workspace path
  const workspacePath = config.agents.workspacePath
    ? resolve(config.agents.workspacePath)
    : resolve('workspace')

  const methods = new MethodRegistry()
  methods.register('health.check', healthCheck)
  methods.register('agents.list', agentsList)
  methods.register('sessions.create', sessionsCreate)
  methods.register('sessions.list', sessionsList)
  methods.register('sessions.get', sessionsGet)
  methods.register('chat.send', chatSend)
  methods.register('chat.history', chatHistory)
  methods.register('chat.abort', chatAbort)
  methods.register('exec.approve', execApprove)
  methods.register('exec.deny', execDeny)
  methods.register('memory.search', memorySearch)

  const httpHandler = createHttpHandler(config)
  const server = createServer(httpHandler)

  const wss = new WebSocketServer({ noServer: true })
  const upgradeHandler = createWsUpgradeHandler({
    wss, methods, config, token,
    providers, workspacePath, sessionManager, activeRuns,
    toolRegistry, approvalManager, auditLogger, browserSessionManager,
    memoryDb, embedder,
  })

  server.on('upgrade', upgradeHandler)

  await new Promise<void>((resolve) => {
    server.listen(config.gateway.port, config.gateway.host, () => resolve())
  })

  console.log(`Listening on ws://${config.gateway.host}:${config.gateway.port}`)

  return {
    async close() {
      // Abort all active runs
      for (const [, controller] of activeRuns) {
        controller.abort()
      }
      activeRuns.clear()

      // Close browser sessions
      await browserSessionManager.closeAll()

      // Close memory database
      if (memoryDb) {
        try { memoryDb.close() } catch { /* best effort */ }
      }

      return new Promise<void>((resolve, reject) => {
        wss.close(() => {
          server.close((err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      })
    },
  }
}

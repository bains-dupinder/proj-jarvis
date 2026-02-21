import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import type { Config } from '../config/schema.js'
import type { ModelProvider } from '../agents/providers/types.js'
import { AnthropicProvider } from '../agents/providers/anthropic.js'
import { OpenAIProvider } from '../agents/providers/openai.js'
import { createHttpHandler } from './http-handler.js'
import { createWsUpgradeHandler } from './ws-handler.js'
import { MethodRegistry } from './methods/registry.js'
import { healthCheck } from './methods/health.js'
import { chatSend } from './methods/chat.js'

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

  // Resolve workspace path
  const workspacePath = config.agents.workspacePath
    ? resolve(config.agents.workspacePath)
    : resolve('workspace')

  const methods = new MethodRegistry()
  methods.register('health.check', healthCheck)
  methods.register('chat.send', chatSend)

  const httpHandler = createHttpHandler(config)
  const server = createServer(httpHandler)

  const wss = new WebSocketServer({ noServer: true })
  const upgradeHandler = createWsUpgradeHandler(wss, methods, config, token, providers, workspacePath)

  server.on('upgrade', upgradeHandler)

  await new Promise<void>((resolve) => {
    server.listen(config.gateway.port, config.gateway.host, () => resolve())
  })

  console.log(`Listening on ws://${config.gateway.host}:${config.gateway.port}`)

  return {
    close() {
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

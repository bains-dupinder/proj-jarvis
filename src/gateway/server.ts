import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import type { Config } from '../config/schema.js'
import { createHttpHandler } from './http-handler.js'
import { createWsUpgradeHandler } from './ws-handler.js'
import { MethodRegistry } from './methods/registry.js'
import { healthCheck } from './methods/health.js'

export interface GatewayServer {
  close(): Promise<void>
}

export async function startServer(config: Config, token: string): Promise<GatewayServer> {
  const methods = new MethodRegistry()
  methods.register('health.check', healthCheck)

  const httpHandler = createHttpHandler(config)
  const server = createServer(httpHandler)

  const wss = new WebSocketServer({ noServer: true })
  const upgradeHandler = createWsUpgradeHandler(wss, methods, config, token)

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

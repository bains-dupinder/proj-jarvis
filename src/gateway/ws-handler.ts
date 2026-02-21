import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WebSocket, WebSocketServer } from 'ws'
import type { Config } from '../config/schema.js'
import type { ModelProvider } from '../agents/providers/types.js'
import type { MethodContext } from './methods/types.js'
import { MethodRegistry, RpcError } from './methods/registry.js'
import { verifyToken } from './auth.js'

const LOCALHOST_ORIGINS = new Set([
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://[::1]',
  'https://[::1]',
])

function isLocalhostOrigin(origin: string): boolean {
  // Allow origins like http://localhost:5173
  try {
    const url = new URL(origin)
    const base = `${url.protocol}//${url.hostname}`
    return LOCALHOST_ORIGINS.has(base)
  } catch {
    return false
  }
}

export function createWsUpgradeHandler(
  wss: WebSocketServer,
  methods: MethodRegistry,
  config: Config,
  token: string,
  providers: Map<string, ModelProvider>,
  workspacePath: string,
) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Check Origin header — reject non-localhost origins
    const origin = req.headers['origin']
    if (origin && !isLocalhostOrigin(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
      handleConnection(ws, methods, config, token, providers, workspacePath)
    })
  }
}

function handleConnection(
  ws: WebSocket,
  methods: MethodRegistry,
  config: Config,
  token: string,
  providers: Map<string, ModelProvider>,
  workspacePath: string,
): void {
  let authenticated = false

  const sendJson = (data: unknown) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  const sendEvent = (event: string, data: unknown) => {
    sendJson({ event, data })
  }

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>
    } catch {
      sendJson({ id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }

    // First message must be auth
    if (!authenticated) {
      if (msg.type !== 'auth' || typeof msg.token !== 'string') {
        sendJson({ type: 'auth', ok: false, error: 'First message must be auth' })
        ws.close(4401, 'unauthorized')
        return
      }

      if (!verifyToken(msg.token, token)) {
        sendJson({ type: 'auth', ok: false, error: 'invalid token' })
        ws.close(4401, 'unauthorized')
        return
      }

      authenticated = true
      sendJson({ type: 'auth', ok: true })
      return
    }

    // Authenticated — handle JSON-RPC requests
    const id = msg.id as string | undefined
    const method = msg.method as string | undefined
    const params = msg.params ?? {}

    if (!id || !method) {
      sendJson({
        id: id ?? null,
        error: { code: -32600, message: 'Invalid request: id and method are required' },
      })
      return
    }

    const ctx: MethodContext = { sendEvent, config, token, providers, workspacePath }

    try {
      const result = await methods.dispatch(method, params, ctx)
      sendJson({ id, result })
    } catch (err) {
      if (err instanceof RpcError) {
        sendJson({ id, error: { code: err.code, message: err.message } })
      } else {
        const message = err instanceof Error ? err.message : 'Internal error'
        sendJson({ id, error: { code: -32603, message } })
      }
    }
  })

  ws.on('error', (err) => {
    console.error('[ws] Connection error:', err.message)
  })
}

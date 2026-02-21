export type EventHandler = (data: unknown) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

/**
 * WebSocket client with JSON-RPC request/response, push-event subscriptions,
 * and exponential-backoff reconnection.
 */
export class WsClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<string, PendingRequest>()
  private listeners = new Map<string, Set<EventHandler>>()
  private intentionalClose = false
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private url: string,
    private token: string,
  ) {}

  /**
   * Open the WS connection and complete the auth handshake.
   */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.intentionalClose = false
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        // Send auth frame
        this.ws!.send(JSON.stringify({ type: 'auth', token: this.token }))
      }

      // We handle auth in the first message, then switch to normal mode
      let authResolved = false

      this.ws.onmessage = (event) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.data as string)
        } catch {
          return
        }

        // Auth handshake response
        if (!authResolved && msg.type === 'auth') {
          authResolved = true
          if (msg.ok) {
            this.reconnectDelay = 1000 // Reset on successful connect
            resolve()
          } else {
            reject(new Error(String(msg.error ?? 'Auth failed')))
            this.ws?.close()
          }
          return
        }

        // RPC response (has `id`)
        if (msg.id && typeof msg.id === 'string') {
          const req = this.pending.get(msg.id)
          if (req) {
            this.pending.delete(msg.id)
            if (msg.error) {
              const err = msg.error as { message?: string }
              req.reject(new Error(err.message ?? 'RPC error'))
            } else {
              req.resolve(msg.result)
            }
          }
          return
        }

        // Push event (has `event`)
        if (msg.event && typeof msg.event === 'string') {
          const handlers = this.listeners.get(msg.event)
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(msg.data)
              } catch {
                // Swallow handler errors
              }
            }
          }
        }
      }

      this.ws.onclose = () => {
        // Reject all pending requests
        for (const [id, req] of this.pending) {
          req.reject(new Error('Connection closed'))
          this.pending.delete(id)
        }

        if (!authResolved) {
          authResolved = true
          reject(new Error('Connection closed before auth'))
        }

        // Reconnect unless intentional close
        if (!this.intentionalClose) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        // onerror fires before onclose, let onclose handle the cleanup
      }
    })
  }

  /**
   * Send a JSON-RPC request and return the result.
   */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'))
        return
      }

      const id = String(this.nextId++)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })

      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
  }

  /**
   * Subscribe to a server push event. Returns an unsubscribe function.
   */
  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
    return () => {
      this.listeners.get(event)?.delete(handler)
    }
  }

  /**
   * Intentionally close the connection (no reconnect).
   */
  disconnect(): void {
    this.intentionalClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    console.log(`[ws] Reconnecting in ${this.reconnectDelay}ms...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch(() => {
        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
      })
    }, this.reconnectDelay)
  }
}

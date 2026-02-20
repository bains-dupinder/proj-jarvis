import type { MethodHandler, MethodContext } from './types.js'

export class MethodRegistry {
  private handlers = new Map<string, MethodHandler>()

  register(name: string, handler: MethodHandler): void {
    this.handlers.set(name, handler)
  }

  async dispatch(name: string, params: unknown, ctx: MethodContext): Promise<unknown> {
    const handler = this.handlers.get(name)
    if (!handler) {
      throw new RpcError(-32601, `Method not found: ${name}`)
    }
    return handler(params, ctx)
  }
}

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

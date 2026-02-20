import type { Config } from '../../config/schema.js'

export interface MethodContext {
  sendEvent(event: string, data: unknown): void
  config: Config
  token: string
}

export type MethodHandler = (params: unknown, ctx: MethodContext) => Promise<unknown>

import type { Config } from '../../config/schema.js'
import type { ModelProvider } from '../../agents/providers/types.js'

export interface MethodContext {
  sendEvent(event: string, data: unknown): void
  config: Config
  token: string
  providers: Map<string, ModelProvider>
  workspacePath: string
}

export type MethodHandler = (params: unknown, ctx: MethodContext) => Promise<unknown>

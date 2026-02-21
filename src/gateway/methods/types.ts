import type { Config } from '../../config/schema.js'
import type { ModelProvider } from '../../agents/providers/types.js'
import type { SessionManager } from '../../sessions/manager.js'

export interface MethodContext {
  sendEvent(event: string, data: unknown): void
  config: Config
  token: string
  providers: Map<string, ModelProvider>
  workspacePath: string
  sessionManager: SessionManager
  activeRuns: Map<string, AbortController>
}

export type MethodHandler = (params: unknown, ctx: MethodContext) => Promise<unknown>

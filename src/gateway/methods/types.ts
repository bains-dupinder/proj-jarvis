import type { Config } from '../../config/schema.js'
import type { ModelProvider } from '../../agents/providers/types.js'
import type { SessionManager } from '../../sessions/manager.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { ApprovalManager } from '../../tools/approval.js'
import type { AuditLogger } from '../../security/audit.js'

export interface MethodContext {
  sendEvent(event: string, data: unknown): void
  config: Config
  token: string
  providers: Map<string, ModelProvider>
  workspacePath: string
  sessionManager: SessionManager
  activeRuns: Map<string, AbortController>
  toolRegistry: ToolRegistry
  approvalManager: ApprovalManager
  auditLogger: AuditLogger
}

export type MethodHandler = (params: unknown, ctx: MethodContext) => Promise<unknown>

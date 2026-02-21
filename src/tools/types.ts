import type { z } from 'zod'
import type { Config } from '../config/schema.js'
import type { ToolDefinition } from '../agents/providers/types.js'

export interface ToolContext {
  sessionKey: string
  runId: string
  sendEvent: (event: string, data: unknown) => void
  config: Config
}

export interface Tool {
  name: string
  description: string
  inputSchema: z.ZodSchema
  requiresApproval: boolean
  toDefinition(): ToolDefinition
  execute(input: unknown, context: ToolContext): Promise<ToolResult>
}

export interface ToolResult {
  output: string
  exitCode?: number
  truncated?: boolean
}

export interface ApprovalRequest {
  approvalId: string
  toolName: string
  summary: string
  details: Record<string, unknown>
  sessionKey: string
}

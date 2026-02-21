import { z } from 'zod'
import type { MethodHandler } from './types.js'
import { RpcError } from './registry.js'

const ApproveParams = z.object({
  approvalId: z.string().uuid(),
})

const DenyParams = z.object({
  approvalId: z.string().uuid(),
  reason: z.string().optional(),
})

/**
 * exec.approve — approve a pending tool execution request.
 */
export const execApprove: MethodHandler = async (params, ctx) => {
  const parsed = ApproveParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const ok = ctx.approvalManager.resolve(parsed.data.approvalId)
  if (!ok) {
    throw new RpcError(-32602, 'Approval not found or already resolved')
  }

  return { ok: true }
}

/**
 * exec.deny — deny a pending tool execution request.
 */
export const execDeny: MethodHandler = async (params, ctx) => {
  const parsed = DenyParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const ok = ctx.approvalManager.reject(parsed.data.approvalId, parsed.data.reason)
  if (!ok) {
    throw new RpcError(-32602, 'Approval not found or already resolved')
  }

  return { ok: true }
}

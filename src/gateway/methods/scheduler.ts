import { z } from 'zod'
import type { MethodHandler } from './types.js'
import { RpcError } from './registry.js'

const ListParams = z.object({
  enabledOnly: z.boolean().optional(),
})

const GetParams = z.object({
  id: z.string(),
})

const RunsParams = z.object({
  jobId: z.string(),
  limit: z.number().int().min(1).max(100).default(20),
})

/**
 * scheduler.list — list all scheduled jobs.
 */
export const schedulerList: MethodHandler = async (params, ctx) => {
  if (!ctx.scheduler) {
    throw new RpcError(-32603, 'Scheduler not available')
  }

  const parsed = ListParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  let jobs = ctx.scheduler.list()
  if (parsed.data.enabledOnly) {
    jobs = jobs.filter((j) => j.enabled)
  }

  return { jobs }
}

/**
 * scheduler.get — get a single job with details.
 */
export const schedulerGet: MethodHandler = async (params, ctx) => {
  if (!ctx.scheduler) {
    throw new RpcError(-32603, 'Scheduler not available')
  }

  const parsed = GetParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const job = ctx.scheduler.get(parsed.data.id)
  if (!job) {
    throw new RpcError(-32603, `Job not found: ${parsed.data.id}`)
  }

  return { job }
}

/**
 * scheduler.runs — get execution history for a job.
 */
export const schedulerRuns: MethodHandler = async (params, ctx) => {
  if (!ctx.scheduler) {
    throw new RpcError(-32603, 'Scheduler not available')
  }

  const parsed = RunsParams.safeParse(params)
  if (!parsed.success) {
    throw new RpcError(-32602, `Invalid params: ${parsed.error.message}`)
  }

  const runs = ctx.scheduler.getRuns(parsed.data.jobId, parsed.data.limit)
  return { runs }
}

import { z } from 'zod'
import type { ToolDefinition } from '../agents/providers/types.js'
import type { Tool, ToolContext, ToolResult } from './types.js'
import type { SchedulerEngine } from '../scheduler/engine.js'
import { isValidCron, describeCron, getNextRun } from '../scheduler/cron.js'

const ScheduleInput = z.object({
  action: z.enum(['create', 'list', 'get', 'update', 'delete']),
  // For create:
  name: z.string().optional(),
  cronExpression: z.string().optional(),
  prompt: z.string().optional(),
  agentId: z.string().optional(),
  // For get/update/delete:
  id: z.string().optional(),
  // For update:
  enabled: z.boolean().optional(),
})

export class ScheduleTool implements Tool {
  name = 'schedule'
  description =
    'Manage scheduled tasks. Use action "create" to schedule a recurring task with a cron expression and prompt. ' +
    'Use "list" to see all scheduled jobs. Use "get" with an id to see job details and recent run history. ' +
    'Use "update" with an id to modify a job (name, cronExpression, prompt, agentId, enabled). ' +
    'Use "delete" with an id to remove a job. ' +
    'Cron format: "minute hour day-of-month month day-of-week" (e.g., "0 8 * * *" for daily at 8am, ' +
    '"0 9 * * 1-5" for weekdays at 9am, "*/30 * * * *" for every 30 minutes).'
  requiresApproval = false
  inputSchema = ScheduleInput

  constructor(private scheduler: SchedulerEngine) {}

  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'list', 'get', 'update', 'delete'],
            description: 'The action to perform',
          },
          name: {
            type: 'string',
            description: 'Human-readable name for the job (for create/update)',
          },
          cronExpression: {
            type: 'string',
            description: 'Cron expression: "minute hour day-of-month month day-of-week" (for create/update)',
          },
          prompt: {
            type: 'string',
            description: 'The prompt/instruction to execute at each scheduled time (for create/update)',
          },
          agentId: {
            type: 'string',
            description: 'Agent ID to use for execution (optional, defaults to "assistant")',
          },
          id: {
            type: 'string',
            description: 'Job ID (for get/update/delete)',
          },
          enabled: {
            type: 'boolean',
            description: 'Enable or disable the job (for update)',
          },
        },
        required: ['action'],
      },
    }
  }

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const parsed = ScheduleInput.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}` }
    }

    const { action } = parsed.data

    switch (action) {
      case 'create': {
        if (!parsed.data.cronExpression || !parsed.data.prompt) {
          return { output: 'Error: "create" requires cronExpression and prompt' }
        }
        if (!isValidCron(parsed.data.cronExpression)) {
          return { output: `Error: Invalid cron expression "${parsed.data.cronExpression}"` }
        }

        try {
          const job = this.scheduler.create({
            name: parsed.data.name ?? 'Unnamed job',
            cronExpression: parsed.data.cronExpression,
            prompt: parsed.data.prompt,
            agentId: parsed.data.agentId,
          })

          const nextRun = getNextRun(job.cronExpression)
          return {
            output:
              `Created scheduled job:\n` +
              `  ID: ${job.id}\n` +
              `  Name: ${job.name}\n` +
              `  Schedule: ${describeCron(job.cronExpression)} (${job.cronExpression})\n` +
              `  Next run: ${nextRun.toLocaleString()}\n` +
              `  Prompt: ${job.prompt}`,
          }
        } catch (err) {
          return { output: `Error creating job: ${(err as Error).message}` }
        }
      }

      case 'list': {
        const jobs = this.scheduler.list()
        if (jobs.length === 0) {
          return { output: 'No scheduled jobs found.' }
        }

        const lines = jobs.map((j) => {
          const status = j.enabled ? 'enabled' : 'disabled'
          const lastRun = j.lastRunAt
            ? `last run ${new Date(j.lastRunAt).toLocaleString()} (${j.lastRunStatus})`
            : 'never run'
          return `- ${j.name} [${status}] (${j.cronExpression}) — ${lastRun}\n  ID: ${j.id}`
        })
        return { output: `Scheduled jobs (${jobs.length}):\n${lines.join('\n')}` }
      }

      case 'get': {
        if (!parsed.data.id) {
          return { output: 'Error: "get" requires an id' }
        }

        const job = this.scheduler.get(parsed.data.id)
        if (!job) {
          return { output: `No job found with ID: ${parsed.data.id}` }
        }

        const runs = this.scheduler.getRuns(job.id, 5)
        const runsText =
          runs.length > 0
            ? runs
                .map(
                  (r) =>
                    `  ${new Date(r.startedAt).toLocaleString()} — ${r.status}${
                      r.summary ? ': ' + r.summary.slice(0, 200) : ''
                    }`,
                )
                .join('\n')
            : '  No runs yet'

        let nextRunStr = 'N/A'
        if (job.enabled) {
          try {
            nextRunStr = getNextRun(job.cronExpression).toLocaleString()
          } catch { /* ignore */ }
        }

        return {
          output:
            `Job: ${job.name}\n` +
            `  ID: ${job.id}\n` +
            `  Schedule: ${describeCron(job.cronExpression)} (${job.cronExpression})\n` +
            `  Status: ${job.enabled ? 'enabled' : 'disabled'}\n` +
            `  Agent: ${job.agentId}\n` +
            `  Prompt: ${job.prompt}\n` +
            `  Next run: ${nextRunStr}\n` +
            `  Created: ${new Date(job.createdAt).toLocaleString()}\n` +
            `Recent runs:\n${runsText}`,
        }
      }

      case 'update': {
        if (!parsed.data.id) {
          return { output: 'Error: "update" requires an id' }
        }
        if (parsed.data.cronExpression && !isValidCron(parsed.data.cronExpression)) {
          return { output: `Error: Invalid cron expression "${parsed.data.cronExpression}"` }
        }

        try {
          const updated = this.scheduler.update(parsed.data.id, {
            name: parsed.data.name,
            cronExpression: parsed.data.cronExpression,
            prompt: parsed.data.prompt,
            agentId: parsed.data.agentId,
            enabled: parsed.data.enabled,
          })

          if (!updated) {
            return { output: `No job found with ID: ${parsed.data.id}` }
          }

          return {
            output: `Updated job "${updated.name}" (${updated.id})\n` +
              `  Schedule: ${describeCron(updated.cronExpression)} (${updated.cronExpression})\n` +
              `  Status: ${updated.enabled ? 'enabled' : 'disabled'}`,
          }
        } catch (err) {
          return { output: `Error updating job: ${(err as Error).message}` }
        }
      }

      case 'delete': {
        if (!parsed.data.id) {
          return { output: 'Error: "delete" requires an id' }
        }

        const ok = this.scheduler.delete(parsed.data.id)
        return {
          output: ok
            ? `Deleted job ${parsed.data.id}`
            : `No job found with ID: ${parsed.data.id}`,
        }
      }
    }
  }
}

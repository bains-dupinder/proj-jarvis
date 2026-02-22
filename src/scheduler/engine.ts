import { randomUUID } from 'node:crypto'
import type { MemoryDb } from '../memory/db.js'
import type { ModelProvider } from '../agents/providers/types.js'
import type { Message } from '../agents/providers/types.js'
import type { ToolDefinition } from '../agents/providers/types.js'
import type { SessionManager } from '../sessions/manager.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { AuditLogger } from '../security/audit.js'
import type { Config } from '../config/schema.js'
import type { ToolContext } from '../tools/types.js'
import { getNextRun, isValidCron } from './cron.js'
import { runAgentTurn } from '../agents/runner.js'
import { buildSchedulerSystemPrompt, getAgentModelRef } from '../agents/prompt-builder.js'
import { parseModelRef } from '../agents/model-ref.js'
import { filterSecrets } from '../security/secrets-filter.js'

// ── Types ──

export interface ScheduledJob {
  id: string
  name: string
  cronExpression: string
  prompt: string
  agentId: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
  lastRunStatus: string | null
  lastRunSummary: string | null
}

export interface JobRun {
  id: string
  jobId: string
  startedAt: number
  finishedAt: number | null
  status: 'running' | 'success' | 'error'
  summary: string | null
  sessionKey: string | null
  error: string | null
}

export interface SchedulerDeps {
  db: MemoryDb
  providers: Map<string, ModelProvider>
  sessionManager: SessionManager
  toolRegistry: ToolRegistry
  auditLogger: AuditLogger
  config: Config
  workspacePath: string
}

// ── Provider/model resolution (mirrors chat.ts logic) ──

const FALLBACK_PROVIDER_ORDER = ['openai', 'anthropic'] as const
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
}

const SCHEDULER_RUNTIME_PREAMBLE = [
  'You are executing an unattended scheduled job.',
  'Tool execution is pre-approved in scheduler mode.',
  'Do not ask the user for approval, confirmation, or permission.',
  'Do not ask follow-up questions that require a live reply.',
  'Do not narrate intended actions.',
  'Return final task output directly.',
  'Execute the task end-to-end and return concrete output.',
].join('\n')

const SCHEDULER_RETRY_PROMPT =
  'Scheduler auto-approval notice: approvals are already granted. ' +
  'Execute required tools now and return final output. Do not ask for approval.'

function resolveProviderAndModel(
  providers: Map<string, ModelProvider>,
  requestedProvider: string,
  requestedModel: string,
): { provider: ModelProvider; model: string } | null {
  const directProvider = providers.get(requestedProvider)
  if (directProvider) {
    return { provider: directProvider, model: requestedModel }
  }

  const prioritizedFallback = FALLBACK_PROVIDER_ORDER.find((id) => providers.has(id))
  const firstAvailable = providers.keys().next().value as string | undefined
  const fallbackProviderId = prioritizedFallback ?? firstAvailable

  if (!fallbackProviderId) return null

  const fallbackProvider = providers.get(fallbackProviderId)!
  const fallbackModel = DEFAULT_MODEL_BY_PROVIDER[fallbackProviderId] ?? requestedModel

  return { provider: fallbackProvider, model: fallbackModel }
}

function schedulerToolDefinitions(defs: ToolDefinition[]): ToolDefinition[] {
  return defs.map((def) => {
    if (def.name === 'browser') {
      return {
        ...def,
        description:
          'Control a headless browser: navigate to URLs, click elements, type text, ' +
          'take screenshots, and extract page content. In scheduler mode, browser actions ' +
          'are pre-approved and should execute directly without asking for confirmation.',
      }
    }

    if (def.name === 'bash') {
      return {
        ...def,
        description:
          'Run shell commands. In scheduler mode, command execution is pre-approved ' +
          'and should execute directly without asking for confirmation.',
      }
    }

    return def
  })
}

function looksLikeApprovalRequest(text: string): boolean {
  const normalized = text.toLowerCase()
  return (
    normalized.includes('approve') ||
    normalized.includes('approval') ||
    normalized.includes('proceed') ||
    normalized.includes('permission') ||
    normalized.includes('confirm')
  )
}

// ── Row mapper ──

interface JobRow {
  id: string
  name: string
  cron_expression: string
  prompt: string
  agent_id: string
  enabled: number
  created_at: number
  updated_at: number
  last_run_at: number | null
  last_run_status: string | null
  last_run_summary: string | null
}

interface RunRow {
  id: string
  job_id: string
  started_at: number
  finished_at: number | null
  status: string
  summary: string | null
  session_key: string | null
  error: string | null
}

function rowToJob(row: JobRow): ScheduledJob {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cron_expression,
    prompt: row.prompt,
    agentId: row.agent_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    lastRunSummary: row.last_run_summary,
  }
}

function rowToRun(row: RunRow): JobRun {
  return {
    id: row.id,
    jobId: row.job_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as JobRun['status'],
    summary: row.summary,
    sessionKey: row.session_key,
    error: row.error,
  }
}

// ── Timer constants ──

/** Node.js setTimeout max delay (2^31 - 1 ms, ~24.8 days). */
const MAX_TIMEOUT_MS = 2_147_483_647
/** Relay delay when next run is beyond MAX_TIMEOUT_MS (24 hours). */
const RELAY_DELAY_MS = 86_400_000

// ── Engine ──

export class SchedulerEngine {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private activeExecutions = new Set<string>()
  private running = false
  private broadcastEvent: ((event: string, data: unknown) => void) | null = null
  private deps: SchedulerDeps

  constructor(deps: SchedulerDeps) {
    this.deps = deps
  }

  /** Set the broadcast function (called after WSS is ready). */
  setBroadcast(fn: (event: string, data: unknown) => void): void {
    this.broadcastEvent = fn
  }

  /** Load all enabled jobs from DB and schedule their next runs. */
  start(): void {
    this.running = true
    const rows = this.deps.db.prepare(
      'SELECT * FROM scheduled_jobs WHERE enabled = 1',
    ).all() as unknown as JobRow[]

    for (const row of rows) {
      this.scheduleJob(rowToJob(row))
    }

    if (rows.length > 0) {
      console.log(`  ✓ Scheduler started with ${rows.length} active job(s)`)
    }
  }

  /** Cancel all pending timers. */
  stop(): void {
    this.running = false
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  // ── Timer management ──

  private scheduleJob(job: ScheduledJob): void {
    // Clear any existing timer for this job
    const existing = this.timers.get(job.id)
    if (existing) clearTimeout(existing)
    this.timers.delete(job.id)

    if (!job.enabled || !this.running) return

    try {
      const nextRun = getNextRun(job.cronExpression)
      let delay = nextRun.getTime() - Date.now()
      if (delay < 0) delay = 0

      if (delay > MAX_TIMEOUT_MS) {
        // Relay: check again in 24 hours
        this.timers.set(
          job.id,
          setTimeout(() => this.scheduleJob(job), RELAY_DELAY_MS),
        )
      } else {
        this.timers.set(
          job.id,
          setTimeout(() => this.executeJob(job), delay),
        )
      }
    } catch (err) {
      console.warn(`[scheduler] Failed to schedule job ${job.id}:`, (err as Error).message)
    }
  }

  /** Execute a job: create session, run agent turn, store results. */
  private async executeJob(job: ScheduledJob): Promise<void> {
    if (!this.running) return

    // Prevent overlapping executions
    if (this.activeExecutions.has(job.id)) {
      console.warn(`[scheduler] Skipping job ${job.id} — previous run still active`)
      this.scheduleJob(job) // Reschedule for next time
      return
    }

    this.activeExecutions.add(job.id)
    const runId = randomUUID()
    const now = Date.now()

    // Insert run record
    this.deps.db.prepare(
      'INSERT INTO job_runs (id, job_id, started_at, status) VALUES (?, ?, ?, ?)',
    ).run(runId, job.id, now, 'running')

    let sessionKey: string | null = null

    try {
      // Create a new session for this job
      const session = await this.deps.sessionManager.create(job.agentId)
      sessionKey = session.meta.key

      // Update run with session key
      this.deps.db.prepare(
        'UPDATE job_runs SET session_key = ? WHERE id = ?',
      ).run(sessionKey, runId)

      // Resolve provider and model
      const modelRefStr = await getAgentModelRef(this.deps.workspacePath, job.agentId)
      if (!modelRefStr) {
        throw new Error(`No model configured for agent "${job.agentId}" in AGENTS.md`)
      }

      const modelRef = parseModelRef(modelRefStr)
      const resolved = resolveProviderAndModel(
        this.deps.providers,
        modelRef.provider,
        modelRef.model,
      )

      if (!resolved) {
        throw new Error('No AI providers configured')
      }

      const baseSystemPrompt = await buildSchedulerSystemPrompt(this.deps.workspacePath)
      const systemPrompt = baseSystemPrompt
        ? `${SCHEDULER_RUNTIME_PREAMBLE}\n\n---\n\n${baseSystemPrompt}`
        : SCHEDULER_RUNTIME_PREAMBLE
      const messages: Message[] = [{ role: 'user', content: job.prompt }]
      const tools = schedulerToolDefinitions(this.deps.toolRegistry.toDefinitions())

      // Append user message to session transcript
      await session.appendEvent({
        role: 'user',
        content: job.prompt,
        timestamp: now,
      })

      // Build tool context with auto-approve
      const toolContext: ToolContext = {
        sessionKey,
        runId,
        sendEvent: () => {},          // No WS client for scheduled runs
        reportProgress: () => {},     // No WS client for scheduled runs
        config: this.deps.config,
        autoApprove: true,
      }

      const runTurn = async (turnMessages: Message[]): Promise<{ text: string; toolCalls: number }> => {
        let text = ''
        let toolCalls = 0

        await runAgentTurn({
          provider: resolved.provider,
          model: resolved.model,
          systemPrompt,
          messages: turnMessages,
          tools,
          onEvent: (event) => {
            if (event.type === 'delta') {
              text += event.text
            }
            // Ignore final/error — we handle them after runAgentTurn resolves
          },
          onToolCall: async (name, input, _callId) => {
            toolCalls += 1

            const tool = this.deps.toolRegistry.get(name)
            if (!tool) return `Error: Unknown tool "${name}"`

            const validated = tool.inputSchema.safeParse(input)
            if (!validated.success) {
              return `Error: Invalid input for tool "${name}": ${validated.error.message}`
            }

            try {
              const result = await tool.execute(validated.data, toolContext)
              const filtered = filterSecrets(result.output)

              // Audit log
              this.deps.auditLogger.append({
                ts: Date.now(),
                type: 'scheduler_run',
                sessionKey: sessionKey!,
                details: {
                  tool: name,
                  jobId: job.id,
                  exitCode: result.exitCode,
                  outputLength: filtered.length,
                },
              }).catch(() => {})

              return filtered
            } catch (err) {
              return `Error: ${err instanceof Error ? err.message : 'Tool execution failed'}`
            }
          },
        })

        return { text, toolCalls }
      }

      let turnResult = await runTurn(messages)
      let assistantText = turnResult.text

      // If the model still asks for approval despite scheduler pre-approval, retry once with a hard nudge.
      if (turnResult.toolCalls === 0 && looksLikeApprovalRequest(assistantText)) {
        const retryMessages: Message[] = [
          ...messages,
          { role: 'assistant', content: assistantText },
          { role: 'user', content: SCHEDULER_RETRY_PROMPT },
        ]
        turnResult = await runTurn(retryMessages)
        assistantText = turnResult.text
      }

      // Persist assistant response to session transcript
      if (assistantText) {
        await session.appendEvent({
          role: 'assistant',
          content: assistantText,
          timestamp: Date.now(),
          runId,
        })
      }

      // Success — update records
      const summary = assistantText || '(no output)'
      const finishedAt = Date.now()

      this.deps.db.prepare(
        'UPDATE job_runs SET status = ?, finished_at = ?, summary = ? WHERE id = ?',
      ).run('success', finishedAt, summary, runId)

      this.deps.db.prepare(
        'UPDATE scheduled_jobs SET last_run_at = ?, last_run_status = ?, last_run_summary = ? WHERE id = ?',
      ).run(finishedAt, 'success', summary, job.id)

      // Broadcast to connected clients
      if (this.broadcastEvent) {
        this.broadcastEvent('scheduler.run_completed', {
          jobId: job.id,
          jobName: job.name,
          runId,
          sessionKey,
          status: 'success',
          summary,
        })
      }

      console.log(`[scheduler] Job "${job.name}" completed successfully`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      const finishedAt = Date.now()

      this.deps.db.prepare(
        'UPDATE job_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?',
      ).run('error', finishedAt, errMsg, runId)

      this.deps.db.prepare(
        'UPDATE scheduled_jobs SET last_run_at = ?, last_run_status = ?, last_run_summary = ? WHERE id = ?',
      ).run(finishedAt, 'error', errMsg, job.id)

      if (this.broadcastEvent) {
        this.broadcastEvent('scheduler.run_completed', {
          jobId: job.id,
          jobName: job.name,
          runId,
          sessionKey,
          status: 'error',
          error: errMsg,
        })
      }

      console.warn(`[scheduler] Job "${job.name}" failed:`, errMsg)
    } finally {
      this.activeExecutions.delete(job.id)
      // Re-schedule for next occurrence
      this.scheduleJob(job)
    }
  }

  // ── CRUD operations ──

  create(params: {
    name: string
    cronExpression: string
    prompt: string
    agentId?: string
  }): ScheduledJob {
    if (!isValidCron(params.cronExpression)) {
      throw new Error(`Invalid cron expression: "${params.cronExpression}"`)
    }

    const id = randomUUID()
    const now = Date.now()

    this.deps.db.prepare(
      `INSERT INTO scheduled_jobs (id, name, cron_expression, prompt, agent_id, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, params.name, params.cronExpression, params.prompt, params.agentId ?? 'assistant', now, now)

    const job: ScheduledJob = {
      id,
      name: params.name,
      cronExpression: params.cronExpression,
      prompt: params.prompt,
      agentId: params.agentId ?? 'assistant',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunSummary: null,
    }

    if (this.running) {
      this.scheduleJob(job)
    }

    return job
  }

  list(): ScheduledJob[] {
    const rows = this.deps.db.prepare(
      'SELECT * FROM scheduled_jobs ORDER BY created_at DESC',
    ).all() as unknown as JobRow[]

    return rows.map(rowToJob)
  }

  get(id: string): ScheduledJob | null {
    const row = this.deps.db.prepare(
      'SELECT * FROM scheduled_jobs WHERE id = ?',
    ).get(id) as JobRow | undefined

    return row ? rowToJob(row) : null
  }

  update(id: string, params: {
    name?: string
    cronExpression?: string
    prompt?: string
    agentId?: string
    enabled?: boolean
  }): ScheduledJob | null {
    const existing = this.get(id)
    if (!existing) return null

    if (params.cronExpression !== undefined && !isValidCron(params.cronExpression)) {
      throw new Error(`Invalid cron expression: "${params.cronExpression}"`)
    }

    const updated = {
      name: params.name ?? existing.name,
      cronExpression: params.cronExpression ?? existing.cronExpression,
      prompt: params.prompt ?? existing.prompt,
      agentId: params.agentId ?? existing.agentId,
      enabled: params.enabled ?? existing.enabled,
    }

    this.deps.db.prepare(
      `UPDATE scheduled_jobs
       SET name = ?, cron_expression = ?, prompt = ?, agent_id = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(updated.name, updated.cronExpression, updated.prompt, updated.agentId, updated.enabled ? 1 : 0, Date.now(), id)

    const job = this.get(id)!

    // Reschedule: clear old timer and set new one (or stop if disabled)
    const existingTimer = this.timers.get(id)
    if (existingTimer) clearTimeout(existingTimer)
    this.timers.delete(id)

    if (this.running && job.enabled) {
      this.scheduleJob(job)
    }

    return job
  }

  delete(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false

    // Clear timer
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)

    this.deps.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id)
    return true
  }

  getRuns(jobId: string, limit: number = 20): JobRun[] {
    const rows = this.deps.db.prepare(
      'SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?',
    ).all(jobId, limit) as unknown as RunRow[]

    return rows.map(rowToRun)
  }

  /** Expose the timers map size for testing. */
  get activeTimerCount(): number {
    return this.timers.size
  }
}

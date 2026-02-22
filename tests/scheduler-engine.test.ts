import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openMemoryDb, type MemoryDb } from '../src/memory/db.js'
import { SchedulerEngine, type SchedulerDeps } from '../src/scheduler/engine.js'
import type { Config } from '../src/config/schema.js'
import { SessionManager } from '../src/sessions/manager.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { AuditLogger } from '../src/security/audit.js'

/** Build a minimal SchedulerDeps for testing (no real AI providers). */
function buildTestDeps(db: MemoryDb, tmpDir: string): SchedulerDeps {
  const sessionsDir = join(tmpDir, 'sessions')
  return {
    db,
    providers: new Map(), // No real providers for CRUD tests
    sessionManager: new SessionManager(sessionsDir),
    toolRegistry: new ToolRegistry(),
    auditLogger: new AuditLogger(join(tmpDir, 'audit.jsonl'), false),
    config: { tools: { maxOutputBytes: 1024, timeout: 5000 } } as Config,
    workspacePath: tmpDir,
  }
}

describe('SchedulerEngine CRUD', () => {
  let tmpDir: string
  let db: MemoryDb
  let engine: SchedulerEngine

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jarvis-sched-'))
    await mkdir(join(tmpDir, 'sessions'), { recursive: true })
    db = openMemoryDb(join(tmpDir, 'test.db'))
    engine = new SchedulerEngine(buildTestDeps(db, tmpDir))
  })

  after(async () => {
    engine.stop()
    try { db.close() } catch { /* ok */ }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates a job and returns it', () => {
    const job = engine.create({
      name: 'Test Job',
      cronExpression: '0 8 * * *',
      prompt: 'Check the weather',
    })

    assert.ok(job.id, 'Job should have an ID')
    assert.equal(job.name, 'Test Job')
    assert.equal(job.cronExpression, '0 8 * * *')
    assert.equal(job.prompt, 'Check the weather')
    assert.equal(job.agentId, 'assistant')
    assert.equal(job.enabled, true)
    assert.equal(job.lastRunAt, null)
  })

  it('lists all jobs', () => {
    const jobs = engine.list()
    assert.ok(jobs.length >= 1, 'Should have at least 1 job')
    assert.equal(jobs[0]!.name, 'Test Job')
  })

  it('gets a job by ID', () => {
    const jobs = engine.list()
    const job = engine.get(jobs[0]!.id)
    assert.ok(job, 'Should find the job')
    assert.equal(job!.name, 'Test Job')
  })

  it('returns null for unknown ID', () => {
    const job = engine.get('nonexistent-id')
    assert.equal(job, null)
  })

  it('updates a job', () => {
    const jobs = engine.list()
    const updated = engine.update(jobs[0]!.id, {
      name: 'Updated Job',
      cronExpression: '*/30 * * * *',
    })

    assert.ok(updated, 'Should return updated job')
    assert.equal(updated!.name, 'Updated Job')
    assert.equal(updated!.cronExpression, '*/30 * * * *')
    assert.equal(updated!.prompt, 'Check the weather') // Unchanged
  })

  it('update returns null for unknown ID', () => {
    const result = engine.update('nonexistent', { name: 'foo' })
    assert.equal(result, null)
  })

  it('disables a job via update', () => {
    const jobs = engine.list()
    const updated = engine.update(jobs[0]!.id, { enabled: false })
    assert.equal(updated!.enabled, false)
  })

  it('re-enables a job via update', () => {
    const jobs = engine.list()
    const updated = engine.update(jobs[0]!.id, { enabled: true })
    assert.equal(updated!.enabled, true)
  })

  it('deletes a job', () => {
    const jobs = engine.list()
    const id = jobs[0]!.id

    const ok = engine.delete(id)
    assert.equal(ok, true)

    const after = engine.get(id)
    assert.equal(after, null)
  })

  it('delete returns false for unknown ID', () => {
    const ok = engine.delete('nonexistent-id')
    assert.equal(ok, false)
  })

  it('rejects invalid cron on create', () => {
    assert.throws(
      () => engine.create({ name: 'Bad', cronExpression: 'not a cron', prompt: 'test' }),
      /Invalid cron/,
    )
  })

  it('rejects invalid cron on update', () => {
    const job = engine.create({ name: 'Valid', cronExpression: '0 8 * * *', prompt: 'test' })
    assert.throws(
      () => engine.update(job.id, { cronExpression: 'bad' }),
      /Invalid cron/,
    )
    engine.delete(job.id) // Clean up
  })
})

describe('SchedulerEngine timer management', () => {
  let tmpDir: string
  let db: MemoryDb
  let engine: SchedulerEngine

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jarvis-sched-t-'))
    await mkdir(join(tmpDir, 'sessions'), { recursive: true })
    db = openMemoryDb(join(tmpDir, 'test.db'))
    engine = new SchedulerEngine(buildTestDeps(db, tmpDir))
  })

  after(async () => {
    engine.stop()
    try { db.close() } catch { /* ok */ }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('start() schedules timers for enabled jobs', () => {
    engine.create({ name: 'Job A', cronExpression: '0 8 * * *', prompt: 'test a' })
    engine.create({ name: 'Job B', cronExpression: '0 9 * * *', prompt: 'test b' })

    engine.start()
    assert.equal(engine.activeTimerCount, 2, 'Should have 2 active timers')
  })

  it('stop() clears all timers', () => {
    engine.stop()
    assert.equal(engine.activeTimerCount, 0, 'Should have 0 active timers after stop')
  })

  it('create() sets a timer when engine is running', () => {
    engine.start()
    const initialCount = engine.activeTimerCount

    engine.create({ name: 'Job C', cronExpression: '0 10 * * *', prompt: 'test c' })
    assert.equal(engine.activeTimerCount, initialCount + 1)

    engine.stop()
  })

  it('delete() clears the timer for that job', () => {
    engine.start()
    const job = engine.create({ name: 'Temp', cronExpression: '0 12 * * *', prompt: 'temp' })
    const countBefore = engine.activeTimerCount

    engine.delete(job.id)
    assert.equal(engine.activeTimerCount, countBefore - 1)

    engine.stop()
  })

  it('disabling a job clears its timer', () => {
    engine.start()
    const countBefore = engine.activeTimerCount
    const jobs = engine.list()
    const enabledJob = jobs.find((j) => j.enabled)!

    engine.update(enabledJob.id, { enabled: false })
    assert.ok(engine.activeTimerCount < countBefore, 'Timer count should decrease')

    // Re-enable for other tests
    engine.update(enabledJob.id, { enabled: true })
    engine.stop()
  })
})

describe('SchedulerEngine getRuns', () => {
  let tmpDir: string
  let db: MemoryDb
  let engine: SchedulerEngine

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jarvis-sched-r-'))
    await mkdir(join(tmpDir, 'sessions'), { recursive: true })
    db = openMemoryDb(join(tmpDir, 'test.db'))
    engine = new SchedulerEngine(buildTestDeps(db, tmpDir))
  })

  after(async () => {
    engine.stop()
    try { db.close() } catch { /* ok */ }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array for job with no runs', () => {
    const job = engine.create({ name: 'No Runs', cronExpression: '0 8 * * *', prompt: 'test' })
    const runs = engine.getRuns(job.id)
    assert.deepEqual(runs, [])
  })
})

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openMemoryDb, type MemoryDb } from '../src/memory/db.js'
import { SchedulerEngine, type SchedulerDeps } from '../src/scheduler/engine.js'
import { ScheduleTool } from '../src/tools/schedule.js'
import type { ToolContext } from '../src/tools/types.js'
import type { Config } from '../src/config/schema.js'
import { SessionManager } from '../src/sessions/manager.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { AuditLogger } from '../src/security/audit.js'

/** Minimal stub ToolContext for testing (no real session). */
function stubContext(): ToolContext {
  return {
    sessionKey: 'test-session',
    runId: 'test-run',
    sendEvent: () => {},
    reportProgress: () => {},
    config: { tools: { maxOutputBytes: 1024, timeout: 5000 } } as Config,
  }
}

describe('ScheduleTool', () => {
  let tmpDir: string
  let db: MemoryDb
  let engine: SchedulerEngine
  let tool: ScheduleTool

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jarvis-tool-'))
    await mkdir(join(tmpDir, 'sessions'), { recursive: true })
    db = openMemoryDb(join(tmpDir, 'test.db'))

    const deps: SchedulerDeps = {
      db,
      providers: new Map(),
      sessionManager: new SessionManager(join(tmpDir, 'sessions')),
      toolRegistry: new ToolRegistry(),
      auditLogger: new AuditLogger(join(tmpDir, 'audit.jsonl'), false),
      config: { tools: { maxOutputBytes: 1024, timeout: 5000 } } as Config,
      workspacePath: tmpDir,
    }

    engine = new SchedulerEngine(deps)
    tool = new ScheduleTool(engine)
  })

  after(async () => {
    engine.stop()
    try { db.close() } catch { /* ok */ }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('has correct metadata', () => {
    assert.equal(tool.name, 'schedule')
    assert.equal(tool.requiresApproval, false)
  })

  it('create: returns formatted output', async () => {
    const result = await tool.execute(
      {
        action: 'create',
        name: 'Morning News',
        cronExpression: '0 8 * * *',
        prompt: 'Check the news',
      },
      stubContext(),
    )

    assert.ok(result.output.includes('Created scheduled job'), result.output)
    assert.ok(result.output.includes('Morning News'))
    assert.ok(result.output.includes('0 8 * * *'))
    assert.ok(result.output.includes('Check the news'))
  })

  it('create: requires cronExpression and prompt', async () => {
    const result = await tool.execute(
      { action: 'create', name: 'Missing fields' },
      stubContext(),
    )

    assert.ok(result.output.includes('Error'), result.output)
    assert.ok(result.output.includes('requires'))
  })

  it('create: rejects invalid cron', async () => {
    const result = await tool.execute(
      { action: 'create', cronExpression: 'bad', prompt: 'test' },
      stubContext(),
    )

    assert.ok(result.output.includes('Invalid cron'), result.output)
  })

  it('list: shows all jobs', async () => {
    const result = await tool.execute({ action: 'list' }, stubContext())

    assert.ok(result.output.includes('Morning News'), result.output)
    assert.ok(result.output.includes('Scheduled jobs'), result.output)
  })

  it('list: shows empty message when no jobs', async () => {
    // Delete all existing jobs first
    const jobs = engine.list()
    for (const j of jobs) engine.delete(j.id)

    const result = await tool.execute({ action: 'list' }, stubContext())
    assert.ok(result.output.includes('No scheduled jobs'), result.output)
  })

  it('get: returns error for missing id', async () => {
    const result = await tool.execute({ action: 'get' }, stubContext())
    assert.ok(result.output.includes('Error'), result.output)
  })

  it('get: returns error for unknown id', async () => {
    const result = await tool.execute(
      { action: 'get', id: 'nonexistent' },
      stubContext(),
    )
    assert.ok(result.output.includes('No job found'), result.output)
  })

  it('get: returns job details', async () => {
    const job = engine.create({
      name: 'Detail Test',
      cronExpression: '*/30 * * * *',
      prompt: 'Do something',
    })

    const result = await tool.execute(
      { action: 'get', id: job.id },
      stubContext(),
    )

    assert.ok(result.output.includes('Detail Test'))
    assert.ok(result.output.includes(job.id))
    assert.ok(result.output.includes('Do something'))
    assert.ok(result.output.includes('No runs yet'))
  })

  it('update: modifies job fields', async () => {
    const jobs = engine.list()
    const job = jobs[0]!

    const result = await tool.execute(
      { action: 'update', id: job.id, name: 'Renamed Job' },
      stubContext(),
    )

    assert.ok(result.output.includes('Updated'), result.output)
    assert.ok(result.output.includes('Renamed Job'))
  })

  it('update: rejects invalid cron', async () => {
    const jobs = engine.list()
    const job = jobs[0]!

    const result = await tool.execute(
      { action: 'update', id: job.id, cronExpression: 'nope' },
      stubContext(),
    )

    assert.ok(result.output.includes('Invalid cron'), result.output)
  })

  it('update: returns error for unknown id', async () => {
    const result = await tool.execute(
      { action: 'update', id: 'nonexistent', name: 'foo' },
      stubContext(),
    )

    assert.ok(result.output.includes('No job found'), result.output)
  })

  it('delete: removes a job', async () => {
    const job = engine.create({
      name: 'To Delete',
      cronExpression: '0 12 * * *',
      prompt: 'Delete me',
    })

    const result = await tool.execute(
      { action: 'delete', id: job.id },
      stubContext(),
    )

    assert.ok(result.output.includes('Deleted'), result.output)
    assert.equal(engine.get(job.id), null)
  })

  it('delete: returns error for unknown id', async () => {
    const result = await tool.execute(
      { action: 'delete', id: 'nonexistent' },
      stubContext(),
    )

    assert.ok(result.output.includes('No job found'), result.output)
  })

  it('delete: requires id', async () => {
    const result = await tool.execute({ action: 'delete' }, stubContext())
    assert.ok(result.output.includes('Error'), result.output)
  })
})

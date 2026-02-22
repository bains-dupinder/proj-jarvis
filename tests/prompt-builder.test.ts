import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildSchedulerSystemPrompt, buildSystemPrompt } from '../src/agents/prompt-builder.js'

async function withWorkspace(
  files: Record<string, string>,
  fn: (workspacePath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-prompt-'))
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, 'utf-8')
    }
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('prompt-builder', () => {
  it('buildSystemPrompt reads AGENTS, SOUL, TOOLS in order', async () => {
    await withWorkspace(
      {
        'AGENTS.md': 'agents section',
        'SOUL.md': 'soul section',
        'TOOLS.md': 'tools section',
      },
      async (workspacePath) => {
        const prompt = await buildSystemPrompt(workspacePath)
        assert.equal(prompt, 'agents section\n\n---\n\nsoul section\n\n---\n\ntools section')
      },
    )
  })

  it('buildSchedulerSystemPrompt appends SCHEDULER overrides when present', async () => {
    await withWorkspace(
      {
        'AGENTS.md': 'agents',
        'SOUL.md': 'soul',
        'TOOLS.md': 'tools',
        'SCHEDULER.md': 'scheduler overrides',
      },
      async (workspacePath) => {
        const prompt = await buildSchedulerSystemPrompt(workspacePath)
        assert.equal(
          prompt,
          'agents\n\n---\n\nsoul\n\n---\n\ntools\n\n---\n\nscheduler overrides',
        )
      },
    )
  })

  it('buildSchedulerSystemPrompt falls back to base prompt when SCHEDULER is missing', async () => {
    await withWorkspace(
      {
        'AGENTS.md': 'agents only',
      },
      async (workspacePath) => {
        const base = await buildSystemPrompt(workspacePath)
        const scheduler = await buildSchedulerSystemPrompt(workspacePath)
        assert.equal(scheduler, base)
      },
    )
  })
})

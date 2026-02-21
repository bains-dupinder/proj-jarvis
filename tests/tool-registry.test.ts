import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { ToolRegistry } from '../src/tools/registry.js'
import type { Tool, ToolContext, ToolResult } from '../src/tools/types.js'
import type { ToolDefinition } from '../src/agents/providers/types.js'

/** Minimal stub tool for testing the registry. */
class StubTool implements Tool {
  name = 'stub'
  description = 'A stub tool'
  inputSchema = z.object({ echo: z.string() })
  requiresApproval = false

  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      inputSchema: { type: 'object', properties: { echo: { type: 'string' } }, required: ['echo'] },
    }
  }

  async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = this.inputSchema.parse(input)
    return { output: parsed.echo }
  }
}

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const reg = new ToolRegistry()
    const tool = new StubTool()
    reg.register(tool)

    assert.equal(reg.get('stub'), tool)
    assert.equal(reg.get('nonexistent'), undefined)
  })

  it('lists all registered tools', () => {
    const reg = new ToolRegistry()
    reg.register(new StubTool())

    assert.equal(reg.all().length, 1)
    assert.equal(reg.all()[0]!.name, 'stub')
  })

  it('converts to ToolDefinitions', () => {
    const reg = new ToolRegistry()
    reg.register(new StubTool())

    const defs = reg.toDefinitions()
    assert.equal(defs.length, 1)
    assert.equal(defs[0]!.name, 'stub')
    assert.equal(typeof defs[0]!.inputSchema, 'object')
  })
})

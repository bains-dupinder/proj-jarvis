import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runAgentTurn } from '../src/agents/runner.js'
import type {
  ChatEvent,
  Message,
  ModelProvider,
  ToolDefinition,
} from '../src/agents/providers/types.js'

class StubProvider implements ModelProvider {
  id = 'stub'
  private turnIdx = 0

  constructor(private readonly turns: ChatEvent[][]) {}

  async *chat(_params: {
    model: string
    systemPrompt: string
    messages: Message[]
    tools: ToolDefinition[]
  }): AsyncIterable<ChatEvent> {
    const events = this.turns[this.turnIdx] ?? []
    this.turnIdx += 1
    for (const event of events) {
      yield event
    }
  }
}

function isFinalEvent(event: ChatEvent): event is Extract<ChatEvent, { type: 'final' }> {
  return event.type === 'final'
}

describe('runAgentTurn', () => {
  it('emits a single final event after tool-call continuation completes', async () => {
    const provider = new StubProvider([
      [
        { type: 'delta', text: 'Let me check that.' },
        { type: 'tool_call', name: 'schedule', input: { action: 'list' }, callId: 'call-1' },
        { type: 'final', usage: { inputTokens: 10, outputTokens: 4 } },
      ],
      [
        { type: 'delta', text: 'Here is the list of jobs.' },
        { type: 'final', usage: { inputTokens: 20, outputTokens: 8 } },
      ],
    ])

    const events: ChatEvent[] = []
    const toolCalls: Array<{ name: string; input: unknown; callId: string }> = []

    await runAgentTurn({
      provider,
      model: 'test-model',
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'List scheduled jobs' }],
      tools: [{ name: 'schedule', description: 'List scheduler jobs', inputSchema: { type: 'object' } }],
      onEvent: (event) => events.push(event),
      onToolCall: async (name, input, callId) => {
        toolCalls.push({ name, input, callId })
        return 'Scheduled jobs (1): ...'
      },
    })

    assert.equal(toolCalls.length, 1)
    assert.deepEqual(toolCalls[0], {
      name: 'schedule',
      input: { action: 'list' },
      callId: 'call-1',
    })

    assert.deepEqual(events.map((e) => e.type), ['delta', 'tool_call', 'delta', 'final'])

    const finals = events.filter(isFinalEvent)
    assert.equal(finals.length, 1)
    assert.deepEqual(finals[0].usage, { inputTokens: 20, outputTokens: 8 })
  })

  it('emits final event for a single-turn response with no tool calls', async () => {
    const provider = new StubProvider([
      [
        { type: 'delta', text: 'Hello there.' },
        { type: 'final', usage: { inputTokens: 3, outputTokens: 2 } },
      ],
    ])

    const events: ChatEvent[] = []

    await runAgentTurn({
      provider,
      model: 'test-model',
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [],
      onEvent: (event) => events.push(event),
    })

    assert.deepEqual(events.map((e) => e.type), ['delta', 'final'])
    const finals = events.filter(isFinalEvent)
    assert.equal(finals.length, 1)
    assert.deepEqual(finals[0].usage, { inputTokens: 3, outputTokens: 2 })
  })
})

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MethodHandler } from './types.js'

interface AgentInfo {
  id: string
  model: string
  description: string
}

/**
 * Parse AGENTS.md to extract agent definitions.
 * Looks for ## headings with Model: and Description: lines below.
 */
async function parseAgentsMd(workspacePath: string): Promise<AgentInfo[]> {
  try {
    const content = await readFile(join(workspacePath, 'AGENTS.md'), 'utf-8')
    const lines = content.split('\n')
    const agents: AgentInfo[] = []

    let current: Partial<AgentInfo> | null = null

    for (const line of lines) {
      const headingMatch = line.match(/^##\s+(\S+)/)
      if (headingMatch) {
        if (current?.id && current.model) {
          agents.push({
            id: current.id,
            model: current.model,
            description: current.description ?? '',
          })
        }
        current = { id: headingMatch[1] }
        continue
      }

      if (current) {
        const modelMatch = line.match(/^Model:\s*(.+)$/i)
        if (modelMatch) {
          current.model = modelMatch[1].trim()
        }
        const descMatch = line.match(/^Description:\s*(.+)$/i)
        if (descMatch) {
          current.description = descMatch[1].trim()
        }
      }
    }

    // Push last agent
    if (current?.id && current.model) {
      agents.push({
        id: current.id,
        model: current.model,
        description: current.description ?? '',
      })
    }

    return agents
  } catch {
    return []
  }
}

/**
 * agents.list — return all configured agents from workspace/AGENTS.md
 */
export const agentsList: MethodHandler = async (_params, ctx) => {
  let agents = await parseAgentsMd(ctx.workspacePath)

  // Fallback: always return at least the default agent
  if (agents.length === 0) {
    agents = [{
      id: ctx.config.agents.default,
      model: 'anthropic/claude-opus-4-6',
      description: 'Default assistant',
    }]
  }

  return { agents }
}

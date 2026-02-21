import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', 'TOOLS.md']

/**
 * Build the system prompt by reading and concatenating workspace markdown files.
 * Missing files are silently skipped.
 */
export async function buildSystemPrompt(workspacePath: string): Promise<string> {
  const sections: string[] = []

  for (const file of WORKSPACE_FILES) {
    try {
      const content = await readFile(join(workspacePath, file), 'utf-8')
      if (content.trim()) {
        sections.push(content.trim())
      }
    } catch {
      // File doesn't exist — skip silently
    }
  }

  return sections.join('\n\n---\n\n')
}

/**
 * Parse the model reference from AGENTS.md for a given agent ID.
 * Looks for a line like "Model: anthropic/claude-opus-4-6" under the agent heading.
 */
export async function getAgentModelRef(
  workspacePath: string,
  agentId: string,
): Promise<string | null> {
  try {
    const content = await readFile(join(workspacePath, 'AGENTS.md'), 'utf-8')
    const lines = content.split('\n')

    let inAgent = false
    for (const line of lines) {
      // Match ## agentId heading
      if (line.match(new RegExp(`^##\\s+${agentId}\\s*$`))) {
        inAgent = true
        continue
      }
      // Another heading means we've left the agent section
      if (inAgent && line.match(/^##\s+/)) {
        break
      }
      if (inAgent) {
        const modelMatch = line.match(/^Model:\s*(.+)$/i)
        if (modelMatch) {
          return modelMatch[1].trim()
        }
      }
    }
  } catch {
    // File doesn't exist
  }
  return null
}

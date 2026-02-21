import type { Tool } from './types.js'
import type { ToolDefinition } from '../agents/providers/types.js'

export class ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  all(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Convert all tools to ToolDefinition[] for passing to ModelProvider.chat().
   */
  toDefinitions(): ToolDefinition[] {
    return this.all().map((t) => t.toDefinition())
  }
}

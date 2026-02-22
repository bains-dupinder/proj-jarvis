import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ToolDefinition } from '../agents/providers/types.js'
import type { Config } from '../config/schema.js'
import type { Tool, ToolContext, ToolResult } from './types.js'
import { ApprovalManager, DeniedError } from './approval.js'

const BashInput = z.object({
  command: z.string().min(1),
  workingDir: z.string().optional(),
})

/**
 * Keys matching these patterns are stripped from the env passed to child processes.
 */
const SENSITIVE_KEY_PATTERN = /_(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$/i
const ALWAYS_STRIP = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'PROJ_JARVIS_TOKEN',
])

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue
    if (ALWAYS_STRIP.has(key)) continue
    if (SENSITIVE_KEY_PATTERN.test(key)) continue
    env[key] = value
  }
  return env
}

export class BashTool implements Tool {
  name = 'bash'
  description = 'Run a shell command on the user\'s machine. The user must approve every command before it executes.'
  requiresApproval = true
  inputSchema = BashInput

  constructor(
    private approvalManager: ApprovalManager,
    private config: Config,
  ) {}

  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
          workingDir: {
            type: 'string',
            description: 'Working directory for the command (defaults to server cwd)',
          },
        },
        required: ['command'],
      },
    }
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = BashInput.safeParse(input)
    if (!parsed.success) {
      return { output: `Invalid input: ${parsed.error.message}`, exitCode: 1 }
    }

    const { command, workingDir } = parsed.data
    const cwd = workingDir ?? process.cwd()

    // Skip approval for auto-approved contexts (e.g. scheduled jobs)
    if (!context.autoApprove) {
      const approvalId = randomUUID()

      // Push approval request to client
      context.sendEvent('exec.approval_request', {
        approvalId,
        toolName: this.name,
        summary: command,
        details: { command, workingDir: cwd },
      })

      // Wait for user approval
      try {
        await this.approvalManager.request(approvalId)
      } catch (err) {
        if (err instanceof DeniedError) {
          return {
            output: `Command denied by user${err.message !== 'Denied by user' ? ': ' + err.message : '.'}`,
            exitCode: 1,
          }
        }
        throw err
      }
    }

    // Approved — execute the command
    context.reportProgress(`Running: ${command}`)
    return this.spawn(command, cwd)
  }

  private spawn(command: string, cwd: string): Promise<ToolResult> {
    const maxBytes = this.config.tools.maxOutputBytes
    const timeout = this.config.tools.timeout

    return new Promise<ToolResult>((resolve) => {
      const child = spawn('bash', ['-c', command], {
        cwd,
        env: sanitizedEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const chunks: Buffer[] = []
      let totalBytes = 0
      let truncated = false

      const collectChunk = (chunk: Buffer) => {
        if (truncated) return
        totalBytes += chunk.length
        if (totalBytes > maxBytes) {
          truncated = true
          // Take only up to the limit
          const excess = totalBytes - maxBytes
          chunks.push(chunk.subarray(0, chunk.length - excess))
        } else {
          chunks.push(chunk)
        }
      }

      child.stdout.on('data', collectChunk)
      child.stderr.on('data', collectChunk)

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        // Give it a moment to die, then SIGKILL
        setTimeout(() => child.kill('SIGKILL'), 2000)
      }, timeout)

      child.on('close', (code) => {
        clearTimeout(timer)
        const output = Buffer.concat(chunks).toString('utf-8')
        resolve({
          output: output || `(process exited with code ${code ?? 'unknown'})`,
          exitCode: code ?? 1,
          truncated,
        })
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          output: `Failed to spawn process: ${err.message}`,
          exitCode: 1,
        })
      })
    })
  }
}

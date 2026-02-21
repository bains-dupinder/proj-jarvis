import { appendFile } from 'node:fs/promises'
import { filterSecrets } from './secrets-filter.js'

export interface AuditEvent {
  ts: number // Unix ms
  type: 'auth' | 'tool_exec' | 'tool_denied' | 'config_change'
  sessionKey?: string
  details: Record<string, unknown>
}

export class AuditLogger {
  constructor(
    private readonly logPath: string,
    private readonly enabled: boolean,
  ) {}

  /**
   * Append an audit event to the JSONL log.
   * Secrets are filtered from details before writing.
   * No-op if audit logging is disabled.
   */
  async append(event: AuditEvent): Promise<void> {
    if (!this.enabled) return

    // Deep-filter secrets from details string values
    const sanitized: AuditEvent = {
      ...event,
      details: Object.fromEntries(
        Object.entries(event.details).map(([k, v]) => [
          k,
          typeof v === 'string' ? filterSecrets(v) : v,
        ]),
      ),
    }

    const line = JSON.stringify(sanitized) + '\n'

    try {
      await appendFile(this.logPath, line, 'utf-8')
    } catch {
      // Best effort — don't crash the server if audit log write fails
    }
  }
}

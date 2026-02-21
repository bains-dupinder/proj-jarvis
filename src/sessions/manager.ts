import { randomUUID } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Session, type SessionMeta } from './session.js'

export class SessionManager {
  constructor(private readonly sessionsDir: string) {}

  /**
   * Create a new session. Writes the meta file immediately.
   */
  async create(agentId?: string): Promise<Session> {
    const key = randomUUID()
    const now = Date.now()

    const meta: SessionMeta = {
      key,
      agentId: agentId ?? 'assistant',
      createdAt: now,
      updatedAt: now,
    }

    const metaPath = join(this.sessionsDir, `${key}.meta.json`)
    await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

    return new Session(meta, this.sessionsDir)
  }

  /**
   * Get a session by key. Returns null if not found.
   */
  async get(key: string): Promise<Session | null> {
    const metaPath = join(this.sessionsDir, `${key}.meta.json`)

    try {
      const raw = await readFile(metaPath, 'utf-8')
      const meta = JSON.parse(raw) as SessionMeta
      return new Session(meta, this.sessionsDir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw err
    }
  }

  /**
   * List all sessions, sorted by createdAt descending (newest first).
   */
  async list(): Promise<SessionMeta[]> {
    try {
      const files = await readdir(this.sessionsDir)
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'))

      const sessions: SessionMeta[] = []
      for (const file of metaFiles) {
        try {
          const raw = await readFile(join(this.sessionsDir, file), 'utf-8')
          sessions.push(JSON.parse(raw) as SessionMeta)
        } catch {
          // Skip corrupted meta files
        }
      }

      return sessions.sort((a, b) => b.createdAt - a.createdAt)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw err
    }
  }

  /**
   * Update the updatedAt timestamp on a session's meta file.
   */
  async touch(key: string): Promise<void> {
    const metaPath = join(this.sessionsDir, `${key}.meta.json`)

    try {
      const raw = await readFile(metaPath, 'utf-8')
      const meta = JSON.parse(raw) as SessionMeta
      meta.updatedAt = Date.now()
      await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch {
      // Best effort — don't throw if meta file is missing
    }
  }
}

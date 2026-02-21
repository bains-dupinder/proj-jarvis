import { join } from 'node:path'
import {
  appendEvent,
  readEvents,
  type TranscriptEvent,
} from './transcript.js'

export interface SessionMeta {
  key: string
  agentId: string
  createdAt: number // Unix ms
  updatedAt: number
  label?: string
}

export class Session {
  readonly meta: SessionMeta
  readonly transcriptPath: string

  constructor(meta: SessionMeta, sessionsDir: string) {
    this.meta = meta
    this.transcriptPath = join(sessionsDir, `${meta.key}.jsonl`)
  }

  async appendEvent(event: TranscriptEvent): Promise<void> {
    await appendEvent(this.transcriptPath, event)
  }

  async readEvents(): Promise<TranscriptEvent[]> {
    return readEvents(this.transcriptPath)
  }
}

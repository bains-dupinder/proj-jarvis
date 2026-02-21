import { appendFile, readFile } from 'node:fs/promises'

export interface TranscriptEvent {
  role: 'user' | 'assistant' | 'tool_result'
  content: string
  timestamp: number // Unix ms
  runId?: string
  toolName?: string
  attachmentCount?: number
}

/**
 * Append a transcript event to a JSONL file.
 * Creates the file if it doesn't exist.
 */
export async function appendEvent(filePath: string, event: TranscriptEvent): Promise<void> {
  const line = JSON.stringify(event) + '\n'
  await appendFile(filePath, line, 'utf-8')
}

/**
 * Read all transcript events from a JSONL file.
 * Returns [] if the file doesn't exist.
 */
export async function readEvents(filePath: string): Promise<TranscriptEvent[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TranscriptEvent)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

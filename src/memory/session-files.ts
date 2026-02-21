import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexManager } from './indexer.js'

interface TranscriptEvent {
  role: string
  content: string
  timestamp: number
}

/**
 * Convert a JSONL transcript file to plain text suitable for indexing.
 */
function transcriptToText(jsonlContent: string): string {
  const lines = jsonlContent.split('\n').filter(Boolean)
  const parts: string[] = []

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as TranscriptEvent
      if (event.role === 'user' || event.role === 'assistant') {
        const ts = new Date(event.timestamp).toISOString()
        parts.push(`[${event.role}] ${ts}\n${event.content}`)
      }
    } catch {
      // Skip malformed lines
    }
  }

  return parts.join('\n\n')
}

/**
 * Prepare transcript files for indexing by converting JSONL to plain text temp files.
 * Returns the list of file paths that can be passed to IndexManager.sync().
 *
 * Instead of writing temp files, we write the plain-text versions alongside the JSONL
 * files with a .txt extension, and pass those to sync().
 */
export async function indexSessionTranscripts(
  indexManager: IndexManager,
  sessionsDir: string,
): Promise<{ indexed: number; skipped: number }> {
  let files: string[]
  try {
    const entries = await readdir(sessionsDir)
    files = entries.filter((f) => f.endsWith('.jsonl'))
  } catch {
    return { indexed: 0, skipped: 0 }
  }

  if (files.length === 0) return { indexed: 0, skipped: 0 }

  // We index the JSONL files directly — the indexer will read them,
  // but we need to convert JSONL → plain text first.
  // We'll create .txt companion files for indexing.
  const { writeFile } = await import('node:fs/promises')
  const txtPaths: string[] = []

  for (const file of files) {
    const jsonlPath = join(sessionsDir, file)
    const txtPath = jsonlPath.replace('.jsonl', '.memory.txt')

    try {
      const content = await readFile(jsonlPath, 'utf-8')
      const text = transcriptToText(content)
      if (text.trim().length > 0) {
        await writeFile(txtPath, text, 'utf-8')
        txtPaths.push(txtPath)
      }
    } catch {
      // Skip files that can't be read
    }
  }

  if (txtPaths.length === 0) return { indexed: 0, skipped: 0 }

  return indexManager.sync(txtPaths)
}

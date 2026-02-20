import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const DATA_DIR_NAME = '.proj-jarvis'

export function getDataDir(): string {
  const dir = join(homedir(), DATA_DIR_NAME)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getConfigFilePath(): string {
  return join(getDataDir(), 'config.json')
}

export function getSessionsDir(): string {
  const dir = join(getDataDir(), 'sessions')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getAuditLogPath(): string {
  return join(getDataDir(), 'audit.jsonl')
}

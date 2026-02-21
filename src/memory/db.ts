/**
 * Open a SQLite database with sqlite-vec loaded and migrations applied.
 * Uses the experimental node:sqlite module (Node 22.5+).
 */

import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { ALL_MIGRATIONS } from './schema.js'

const require = createRequire(import.meta.url)

export interface StatementResult {
  [key: string]: unknown
}

/**
 * Thin typed wrapper around node:sqlite DatabaseSync.
 */
export interface MemoryDb {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number }
    get(...params: unknown[]): StatementResult | undefined
    all(...params: unknown[]): StatementResult[]
  }
  exec(sql: string): void
  close(): void
}

/**
 * Open (or create) a SQLite database at the given path.
 * Loads sqlite-vec, enables WAL mode + foreign keys, and runs all migrations.
 */
export function openMemoryDb(dbPath: string): MemoryDb {
  const db = new DatabaseSync(dbPath, { allowExtension: true })

  // Load sqlite-vec for vector distance functions
  try {
    const sqliteVec = require('sqlite-vec')
    sqliteVec.load(db)
  } catch (err) {
    console.warn('[memory] Failed to load sqlite-vec extension:', (err as Error).message)
    console.warn('[memory] Vector search will be unavailable — keyword search only')
  }

  // Performance pragmas
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA foreign_keys=ON')

  // Run migrations
  for (const migration of ALL_MIGRATIONS) {
    db.exec(migration)
  }

  return db as MemoryDb
}

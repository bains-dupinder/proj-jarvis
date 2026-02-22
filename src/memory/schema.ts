/**
 * SQL table definitions for the memory system.
 * Uses node:sqlite (DatabaseSync) + sqlite-vec for vector search.
 * Keyword search uses a simple word-matching approach (no FTS5 in node:sqlite).
 */

import { SCHEDULER_MIGRATIONS } from '../scheduler/schema.js'

export const CREATE_FILES_TABLE = `
  CREATE TABLE IF NOT EXISTS files (
    path       TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    indexed_at INTEGER NOT NULL
  )
`

export const CREATE_CHUNKS_TABLE = `
  CREATE TABLE IF NOT EXISTS chunks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
    chunk_idx INTEGER NOT NULL,
    content   TEXT NOT NULL,
    embedding BLOB
  )
`

export const CREATE_EMBEDDING_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS embedding_cache (
    hash       TEXT PRIMARY KEY,
    embedding  BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )
`

export const CREATE_CHUNKS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path)
`

export const ALL_MIGRATIONS: string[] = [
  CREATE_FILES_TABLE,
  CREATE_CHUNKS_TABLE,
  CREATE_EMBEDDING_CACHE_TABLE,
  CREATE_CHUNKS_INDEX,
  ...SCHEDULER_MIGRATIONS,
]

/**
 * SQL table definitions for the scheduler system.
 * Uses the same memory.db database opened by openMemoryDb().
 */

export const CREATE_SCHEDULED_JOBS_TABLE = `
  CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    agent_id        TEXT NOT NULL DEFAULT 'assistant',
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_run_at     INTEGER,
    last_run_status TEXT,
    last_run_summary TEXT
  )
`

export const CREATE_JOB_RUNS_TABLE = `
  CREATE TABLE IF NOT EXISTS job_runs (
    id          TEXT PRIMARY KEY,
    job_id      TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    status      TEXT NOT NULL DEFAULT 'running',
    summary     TEXT,
    session_key TEXT,
    error       TEXT
  )
`

export const CREATE_JOB_RUNS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id)
`

export const SCHEDULER_MIGRATIONS: string[] = [
  CREATE_SCHEDULED_JOBS_TABLE,
  CREATE_JOB_RUNS_TABLE,
  CREATE_JOB_RUNS_INDEX,
]

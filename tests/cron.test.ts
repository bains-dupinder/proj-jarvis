import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseCron, isValidCron, getNextRun, describeCron } from '../src/scheduler/cron.js'

// ─── parseCron ────────────────────────────────────────────

describe('parseCron', () => {
  it('parses wildcard in all fields', () => {
    const fields = parseCron('* * * * *')
    assert.equal(fields.minutes.size, 60)
    assert.equal(fields.hours.size, 24)
    assert.equal(fields.daysOfMonth.size, 31)
    assert.equal(fields.months.size, 12)
    assert.equal(fields.daysOfWeek.size, 7)
  })

  it('parses specific values', () => {
    const fields = parseCron('0 8 * * *')
    assert.deepEqual([...fields.minutes], [0])
    assert.deepEqual([...fields.hours], [8])
    assert.equal(fields.daysOfMonth.size, 31)
  })

  it('parses step pattern (every 15 minutes)', () => {
    const fields = parseCron('*/15 * * * *')
    const mins = [...fields.minutes].sort((a, b) => a - b)
    assert.deepEqual(mins, [0, 15, 30, 45])
  })

  it('parses ranges', () => {
    const fields = parseCron('0 9 * * 1-5')
    const dow = [...fields.daysOfWeek].sort((a, b) => a - b)
    assert.deepEqual(dow, [1, 2, 3, 4, 5])
  })

  it('parses lists', () => {
    const fields = parseCron('0,30 * * * *')
    const mins = [...fields.minutes].sort((a, b) => a - b)
    assert.deepEqual(mins, [0, 30])
  })

  it('parses range with step', () => {
    const fields = parseCron('0 8-18/2 * * *')
    const hrs = [...fields.hours].sort((a, b) => a - b)
    assert.deepEqual(hrs, [8, 10, 12, 14, 16, 18])
  })

  it('parses complex mixed fields', () => {
    const fields = parseCron('0,15,30,45 9 1 1,6 *')
    assert.equal(fields.minutes.size, 4)
    assert.deepEqual([...fields.hours], [9])
    assert.deepEqual([...fields.daysOfMonth], [1])
    assert.deepEqual([...fields.months].sort((a, b) => a - b), [1, 6])
  })

  it('throws on too few fields', () => {
    assert.throws(() => parseCron('* * *'), /Expected 5 fields/)
  })

  it('throws on too many fields', () => {
    assert.throws(() => parseCron('* * * * * *'), /Expected 5 fields/)
  })

  it('throws on out-of-range values', () => {
    assert.throws(() => parseCron('60 * * * *'), /out of range/)
    assert.throws(() => parseCron('* 25 * * *'), /out of range/)
    assert.throws(() => parseCron('* * 0 * *'), /out of range/)
    assert.throws(() => parseCron('* * * 13 *'), /out of range/)
    assert.throws(() => parseCron('* * * * 7'), /out of range/)
  })

  it('throws on empty string', () => {
    assert.throws(() => parseCron(''), /Expected 5 fields/)
  })

  it('throws on invalid token', () => {
    assert.throws(() => parseCron('abc * * * *'))
  })
})

// ─── isValidCron ──────────────────────────────────────────

describe('isValidCron', () => {
  it('returns true for valid expressions', () => {
    assert.equal(isValidCron('* * * * *'), true)
    assert.equal(isValidCron('0 8 * * *'), true)
    assert.equal(isValidCron('*/15 * * * *'), true)
    assert.equal(isValidCron('0 9 * * 1-5'), true)
  })

  it('returns false for invalid expressions', () => {
    assert.equal(isValidCron(''), false)
    assert.equal(isValidCron('* *'), false)
    assert.equal(isValidCron('60 * * * *'), false)
    assert.equal(isValidCron('abc'), false)
  })
})

// ─── getNextRun ───────────────────────────────────────────

describe('getNextRun', () => {
  it('computes next daily 8am after 7:59', () => {
    const after = new Date('2025-06-15T07:59:00')
    const next = getNextRun('0 8 * * *', after)
    assert.equal(next.getHours(), 8)
    assert.equal(next.getMinutes(), 0)
    assert.equal(next.getDate(), 15) // Same day
  })

  it('computes next daily 8am after 8:01 (next day)', () => {
    const after = new Date('2025-06-15T08:01:00')
    const next = getNextRun('0 8 * * *', after)
    assert.equal(next.getHours(), 8)
    assert.equal(next.getMinutes(), 0)
    assert.equal(next.getDate(), 16) // Next day
  })

  it('computes next half-hour step', () => {
    const after = new Date('2025-06-15T14:10:00')
    const next = getNextRun('*/30 * * * *', after)
    assert.equal(next.getMinutes(), 30)
    assert.equal(next.getHours(), 14)
  })

  it('computes next weekday (Mon-Fri)', () => {
    // June 15, 2025 is a Sunday
    const after = new Date('2025-06-15T10:00:00')
    const next = getNextRun('0 9 * * 1-5', after)
    assert.equal(next.getDay(), 1) // Monday
    assert.equal(next.getHours(), 9)
  })

  it('computes next first-of-month', () => {
    const after = new Date('2025-06-15T00:00:00')
    const next = getNextRun('0 0 1 * *', after)
    assert.equal(next.getDate(), 1)
    assert.equal(next.getMonth(), 6) // July (0-based)
  })

  it('returns a date in the future', () => {
    const now = new Date()
    const next = getNextRun('* * * * *')
    assert.ok(next.getTime() > now.getTime(), 'Next run should be in the future')
  })
})

// ─── describeCron ─────────────────────────────────────────

describe('describeCron', () => {
  it('describes daily at specific time', () => {
    const desc = describeCron('0 8 * * *')
    assert.ok(desc.includes('08:00'), `Expected "08:00" in "${desc}"`)
  })

  it('describes weekday schedule', () => {
    const desc = describeCron('0 9 * * 1-5')
    assert.ok(desc.includes('Monday through Friday'), `Expected weekday description in "${desc}"`)
  })

  it('describes every-N-minutes', () => {
    const desc = describeCron('*/15 * * * *')
    assert.ok(desc.includes('15 minutes'), `Expected "15 minutes" in "${desc}"`)
  })

  it('describes every minute', () => {
    const desc = describeCron('* * * * *')
    assert.ok(desc.includes('Every minute'), `Expected "Every minute" in "${desc}"`)
  })
})

/**
 * Minimal 5-field cron expression parser.
 * Format: minute hour day-of-month month day-of-week
 *
 * Supports: *, N, N-M, N-M/S, * /N, and comma-separated lists of the above.
 * Day-of-week: 0 = Sunday, 6 = Saturday.
 */

export interface CronFields {
  minutes: Set<number>     // 0-59
  hours: Set<number>       // 0-23
  daysOfMonth: Set<number> // 1-31
  months: Set<number>      // 1-12
  daysOfWeek: Set<number>  // 0-6 (0 = Sunday)
}

/**
 * Parse a single cron field (e.g. "1-5", "star/15", "1,3,5") into a Set of integers.
 * The "star/15" notation represents step patterns like * followed by /15.
 */
function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()

  for (const part of field.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) throw new Error(`Empty part in field "${field}"`)

    // Match step patterns: */N or N-M/S
    const stepMatch = trimmed.match(/^(\*|(\d+)-(\d+))\/(\d+)$/)
    if (stepMatch) {
      const step = parseInt(stepMatch[4]!, 10)
      if (step === 0) throw new Error(`Step cannot be zero in "${trimmed}"`)

      let start: number
      let end: number

      if (stepMatch[1] === '*') {
        start = min
        end = max
      } else {
        start = parseInt(stepMatch[2]!, 10)
        end = parseInt(stepMatch[3]!, 10)
      }

      if (start < min || start > max || end < min || end > max) {
        throw new Error(`Value out of range [${min}-${max}] in "${trimmed}"`)
      }

      for (let i = start; i <= end; i += step) {
        values.add(i)
      }
      continue
    }

    // Wildcard
    if (trimmed === '*') {
      for (let i = min; i <= max; i++) values.add(i)
      continue
    }

    // Range: N-M
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]!, 10)
      const end = parseInt(rangeMatch[2]!, 10)
      if (start < min || start > max || end < min || end > max) {
        throw new Error(`Value out of range [${min}-${max}] in "${trimmed}"`)
      }
      if (start > end) {
        throw new Error(`Invalid range: start > end in "${trimmed}"`)
      }
      for (let i = start; i <= end; i++) values.add(i)
      continue
    }

    // Plain number
    const num = parseInt(trimmed, 10)
    if (isNaN(num) || trimmed !== String(num)) {
      throw new Error(`Invalid value "${trimmed}" in cron field`)
    }
    if (num < min || num > max) {
      throw new Error(`Value ${num} out of range [${min}-${max}]`)
    }
    values.add(num)
  }

  return values
}

/**
 * Parse a 5-field cron expression into expanded field sets.
 */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Expected 5 fields in cron expression, got ${parts.length}: "${expr}"`)
  }

  return {
    minutes: parseField(parts[0]!, 0, 59),
    hours: parseField(parts[1]!, 0, 23),
    daysOfMonth: parseField(parts[2]!, 1, 31),
    months: parseField(parts[3]!, 1, 12),
    daysOfWeek: parseField(parts[4]!, 0, 6),
  }
}

/**
 * Validate a cron expression without throwing.
 */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr)
    return true
  } catch {
    return false
  }
}

/**
 * Check whether both day-of-month and day-of-week are restricted (not all values).
 * Standard cron uses OR logic when both are restricted.
 */
function isDomRestricted(fields: CronFields): boolean {
  return fields.daysOfMonth.size < 31
}

function isDowRestricted(fields: CronFields): boolean {
  return fields.daysOfWeek.size < 7
}

/**
 * Compute the next occurrence of a cron expression after the given date.
 * Searches forward up to 366 days (527,040 minutes).
 */
export function getNextRun(expr: string, after?: Date): Date {
  const fields = parseCron(expr)
  const start = after ? new Date(after.getTime()) : new Date()

  // Advance to next minute boundary
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)

  const bothRestricted = isDomRestricted(fields) && isDowRestricted(fields)
  const MAX_ITERATIONS = 527_040 // 366 days in minutes

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const candidate = new Date(start.getTime() + i * 60_000)
    const month = candidate.getMonth() + 1 // 1-12
    const dom = candidate.getDate()         // 1-31
    const dow = candidate.getDay()          // 0-6
    const hour = candidate.getHours()       // 0-23
    const minute = candidate.getMinutes()   // 0-59

    // Month must match
    if (!fields.months.has(month)) continue

    // Day matching: if both dom and dow are restricted, use OR logic (standard cron)
    if (bothRestricted) {
      if (!fields.daysOfMonth.has(dom) && !fields.daysOfWeek.has(dow)) continue
    } else {
      if (!fields.daysOfMonth.has(dom)) continue
      if (!fields.daysOfWeek.has(dow)) continue
    }

    // Hour and minute must match
    if (!fields.hours.has(hour)) continue
    if (!fields.minutes.has(minute)) continue

    return candidate
  }

  throw new Error(`No next run found within 366 days for cron expression: "${expr}"`)
}

/**
 * Return a human-readable description of a cron expression.
 */
export function describeCron(expr: string): string {
  const fields = parseCron(expr)

  const parts: string[] = []

  // Time
  if (fields.minutes.size === 1 && fields.hours.size === 1) {
    const min = [...fields.minutes][0]!
    const hr = [...fields.hours][0]!
    parts.push(`At ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`)
  } else if (fields.minutes.size === 60 && fields.hours.size === 24) {
    parts.push('Every minute')
  } else if (fields.hours.size === 24) {
    // Check for step pattern in minutes
    const mins = [...fields.minutes].sort((a, b) => a - b)
    if (mins.length > 1 && mins[0] === 0) {
      const step = mins[1]! - mins[0]!
      const isStep = mins.every((v, i) => v === i * step)
      if (isStep) {
        parts.push(`Every ${step} minutes`)
      } else {
        parts.push(`At minutes ${mins.join(', ')} of every hour`)
      }
    } else {
      parts.push(`At minutes ${mins.join(', ')} of every hour`)
    }
  } else {
    const hrs = [...fields.hours].sort((a, b) => a - b)
    const mins = [...fields.minutes].sort((a, b) => a - b)
    const timeStr = mins.map((m) => String(m).padStart(2, '0')).join(', ')
    parts.push(`At ${hrs.map((h) => `${String(h).padStart(2, '0')}:${timeStr}`).join(', ')}`)
  }

  // Days of week
  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  if (fields.daysOfWeek.size < 7) {
    const days = [...fields.daysOfWeek].sort((a, b) => a - b)
    if (days.length === 5 && days[0] === 1 && days[4] === 5) {
      parts.push('Monday through Friday')
    } else {
      parts.push(days.map((d) => DOW_NAMES[d]).join(', '))
    }
  }

  // Days of month
  if (fields.daysOfMonth.size < 31) {
    const doms = [...fields.daysOfMonth].sort((a, b) => a - b)
    parts.push(`on day ${doms.join(', ')} of the month`)
  }

  // Months
  const MONTH_NAMES = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  if (fields.months.size < 12) {
    const mos = [...fields.months].sort((a, b) => a - b)
    parts.push(`in ${mos.map((m) => MONTH_NAMES[m]).join(', ')}`)
  }

  return parts.join(', ') || expr
}

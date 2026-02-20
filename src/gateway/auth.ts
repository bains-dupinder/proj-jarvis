import { timingSafeEqual } from 'node:crypto'

/**
 * Compare a provided token against the expected token using
 * constant-time comparison to prevent timing attacks.
 */
export function verifyToken(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf-8')
  const expectedBuf = Buffer.from(expected, 'utf-8')

  if (providedBuf.length !== expectedBuf.length) {
    // Perform a dummy comparison to avoid length-based timing leaks,
    // then return false regardless of the result.
    timingSafeEqual(expectedBuf, expectedBuf)
    return false
  }

  return timingSafeEqual(providedBuf, expectedBuf)
}

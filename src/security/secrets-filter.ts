/**
 * Patterns that match common secrets in text output.
 * Each match is replaced with [REDACTED].
 */
const SECRET_PATTERNS: RegExp[] = [
  // Anthropic API keys
  /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  // OpenAI API keys
  /sk-[A-Za-z0-9]{20,}/g,
  // Bearer tokens
  /Bearer [A-Za-z0-9._\-]{20,}/gi,
  // GitHub personal access tokens
  /ghp_[A-Za-z0-9]{36}/g,
  // GitHub OAuth tokens
  /gho_[A-Za-z0-9]{36}/g,
  // Env var assignments of known sensitive keys
  /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|PROJ_JARVIS_TOKEN)=[^\s]+/g,
]

/**
 * Redact common secret patterns from a string.
 * Returns a new string with secrets replaced by [REDACTED].
 */
export function filterSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

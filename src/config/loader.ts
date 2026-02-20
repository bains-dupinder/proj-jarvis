import { readFileSync, existsSync } from 'node:fs'
import { config as loadDotenv } from 'dotenv'
import { ConfigSchema, type Config } from './schema.js'
import { getConfigFilePath } from './paths.js'

// Load .env file from project root
loadDotenv()

export function loadConfig(): Config {
  const configPath = getConfigFilePath()

  let fileConfig: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8')
    fileConfig = JSON.parse(raw) as Record<string, unknown>
  }

  // Apply env overrides
  const portEnv = process.env['PROJ_JARVIS_PORT']
  const hostEnv = process.env['PROJ_JARVIS_HOST']

  if (portEnv || hostEnv) {
    const gateway = (fileConfig.gateway ?? {}) as Record<string, unknown>
    if (portEnv) gateway.port = parseInt(portEnv, 10)
    if (hostEnv) gateway.host = hostEnv
    fileConfig.gateway = gateway
  }

  return ConfigSchema.parse(fileConfig)
}

export function getToken(): string {
  const token = process.env['PROJ_JARVIS_TOKEN']
  if (!token) {
    throw new Error(
      'PROJ_JARVIS_TOKEN environment variable is required. ' +
      'Set it in your .env file or shell environment.'
    )
  }
  return token
}

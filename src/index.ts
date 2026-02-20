import { config as loadDotenv } from 'dotenv'
loadDotenv()

import { loadConfig, getToken } from './config/loader.js'
import { startServer } from './gateway/server.js'

const config = loadConfig()

// Allow --port CLI override
const portArgIdx = process.argv.indexOf('--port')
if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
  config.gateway.port = parseInt(process.argv[portArgIdx + 1], 10)
}

const token = getToken()
const server = await startServer(config, token)

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down...')
  await server.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

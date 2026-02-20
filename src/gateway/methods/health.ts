import type { MethodHandler } from './types.js'

export const healthCheck: MethodHandler = async () => {
  return {
    status: 'ok',
    uptime: process.uptime(),
  }
}

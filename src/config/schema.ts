import { z } from 'zod'

export const ConfigSchema = z.object({
  gateway: z.object({
    port: z.number().default(18789),
    host: z.string().default('127.0.0.1'),
  }).default({}),
  agents: z.object({
    default: z.string().default('assistant'),
    workspacePath: z.string().optional(),
  }).default({}),
  tools: z.object({
    timeout: z.number().default(120_000),
    maxOutputBytes: z.number().default(100_000),
  }).default({}),
  memory: z.object({
    enabled: z.boolean().default(true),
    embeddingModel: z.string().default('text-embedding-3-small'),
  }).default({}),
  security: z.object({
    auditLog: z.boolean().default(true),
    secretsFilter: z.boolean().default(true),
  }).default({}),
})

export type Config = z.infer<typeof ConfigSchema>

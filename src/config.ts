import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  UPLOAD_API_KEY: z.string().min(16),
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_CHANNEL_ID: z.string().startsWith('-'),
  TELEGRAM_API_BASE: z.string().url().default('https://api.telegram.org'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.string().url().default('https://viddey.com'),
  UPLOAD_TEMP_DIR: z.string().default('/tmp/viddey-uploads'),
  CHUNK_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
  MAX_CONCURRENT_UPLOADS: z.coerce.number().int().positive().default(20),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  UPLOAD_RATE_LIMIT: z.coerce.number().int().positive().default(5),
  CHUNK_RATE_LIMIT: z.coerce.number().int().positive().default(300),
  CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
})

const result = schema.safeParse(process.env)
if (!result.success) {
  console.error('[config] Invalid environment variables:')
  for (const [field, issues] of Object.entries(result.error.flatten().fieldErrors)) {
    console.error(`  ${field}: ${(issues ?? []).join(', ')}`)
  }
  process.exit(1)
}

const e = result.data

export const config = {
  server: { port: e.PORT, host: e.HOST, isDev: e.NODE_ENV === 'development' },
  auth: { apiKey: e.UPLOAD_API_KEY },
  telegram: { token: e.TELEGRAM_BOT_TOKEN, channelId: e.TELEGRAM_CHANNEL_ID, apiBase: e.TELEGRAM_API_BASE },
  supabase: { url: e.SUPABASE_URL, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY },
  site: { url: e.NEXT_PUBLIC_SITE_URL },
  upload: {
    tempDir: e.UPLOAD_TEMP_DIR,
    chunkSize: e.CHUNK_SIZE_BYTES,
    maxFileSize: e.MAX_FILE_SIZE_BYTES,
    maxConcurrent: e.MAX_CONCURRENT_UPLOADS,
    sessionTtl: e.SESSION_TTL_MS,
    uploadRateLimit: e.UPLOAD_RATE_LIMIT,
    chunkRateLimit: e.CHUNK_RATE_LIMIT,
    cleanupInterval: e.CLEANUP_INTERVAL_MS,
  },
  cors: { origins: e.CORS_ORIGINS.split(',').map((o) => o.trim()) },
} as const

export type Config = typeof config

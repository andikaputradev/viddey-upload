import Fastify, { type FastifyServerOptions } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { config } from './config.js'
import { sessionRoutes } from './routes/sessions.js'
import { healthRoutes } from './routes/health.js'
import { startCleanup, stopCleanup, initializeSessionStore } from './services/session-store.js'
import { ensureBaseDir } from './services/storage.js'
import { toMessage } from './lib/error.js'

function buildLoggerOptions(): FastifyServerOptions['logger'] {
  if (config.server.isDev) {
    return {
      level: 'debug',
      transport: { target: 'pino-pretty', options: { colorize: true, singleLine: false } },
    }
  }
  return { level: 'info' }
}

export async function buildServer() {
  const fastify = Fastify({
    logger: buildLoggerOptions(),
    trustProxy: true,
    bodyLimit: config.upload.chunkSize + 65_536,
    requestIdLogLabel: 'reqId',
  })

  await fastify.register(cors, {
    origin: config.cors.origins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Upload-Key', 'Content-Length'],
    exposedHeaders: ['X-RateLimit-Remaining'],
    credentials: false,
    maxAge: 86400,
  })

  await fastify.register(rateLimit, {
    global: false,
    max: config.upload.chunkRateLimit,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      ok: false,
      error: 'Too many requests — please slow down',
      code: 'RATE_LIMITED',
    }),
  })

  await fastify.register(multipart, {
    limits: {
      fileSize: config.upload.chunkSize + 65_536,
      files: 1,
      fields: 0,
      headerPairs: 20,
    },
  })

  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: toMessage(error), stack: error.stack }, 'Unhandled error')
    const status = error.statusCode ?? 500
    void reply.status(status).send({
      ok: false,
      error: status >= 500 ? 'Internal server error' : error.message,
      code: error.code ?? 'INTERNAL_ERROR',
    })
  })

  fastify.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ ok: false, error: 'Route not found', code: 'NOT_FOUND' })
  })

  await fastify.register(healthRoutes)
  await fastify.register(sessionRoutes)

  fastify.addHook('onClose', async () => {
    stopCleanup()
  })

  return fastify
}

export async function startServer() {
  await ensureBaseDir()
  await initializeSessionStore()

  const server = await buildServer()
  startCleanup()

  try {
    await server.listen({ port: config.server.port, host: config.server.host })
  } catch (err: unknown) {
    server.log.error({ err: toMessage(err) }, 'Failed to start server')
    process.exit(1)
  }

  const shutdown = async (signal: string) => {
    server.log.info({ signal }, 'Shutdown signal received')
    try {
      await server.close()
    } catch (err: unknown) {
      server.log.error({ err: toMessage(err) }, 'Error during shutdown')
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('uncaughtException', (err: unknown) => {
    server.log.fatal({ err: toMessage(err) }, 'Uncaught exception')
    process.exit(1)
  })
  process.on('unhandledRejection', (reason: unknown) => {
    server.log.fatal({ reason: toMessage(reason) }, 'Unhandled promise rejection')
    process.exit(1)
  })

  return server
}
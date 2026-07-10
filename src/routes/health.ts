import type { FastifyInstance } from 'fastify'
import { getActiveCount, getSessionCount } from '../services/session-store.js'

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }))

  fastify.get('/ready', async (_request, reply) => {
    const active = getActiveCount()
    if (active < 0) {
      return reply.status(503).send({ status: 'unavailable', reason: 'session store error' })
    }
    return reply.send({ status: 'ready', timestamp: new Date().toISOString() })
  })

  fastify.get('/metrics', async () => {
    const mem = process.memoryUsage()
    return {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      sessions: {
        active: getActiveCount(),
        total: getSessionCount(),
      },
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
      },
      process: {
        pid: process.pid,
        version: process.version,
        platform: process.platform,
      },
    }
  })
}

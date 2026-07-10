import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import {
  createSession,
  getSession,
  updateSessionState,
  markChunkReceived,
  setSessionResult,
  deleteSession,
  getActiveCount,
  toView,
} from '../services/session-store.js'
import {
  ensureSessionDir,
  writeChunkStream,
  chunkExists,
  deleteSessionDir,
  getSessionDir,
} from '../services/storage.js'
import { uploadToTelegram } from '../services/telegram.js'
import { insertVideo, slugExists } from '../services/supabase.js'
import {
  validateMimeType,
  validateExtension,
  sanitizeFilename,
  validateApiKey,
  validateSessionId,
} from '../lib/security.js'
import { generateSessionId, generateSlug, generateDeleteToken } from '../lib/slug.js'
import { isReadableStream } from '../lib/utils.js'
import { toMessage } from '../lib/error.js'
import { ok, err } from '../types/index.js'

const createSessionSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  fileSize: z.number().int().positive().max(config.upload.maxFileSize),
})

interface SessionParams {
  id: string
}

interface ChunkParams {
  id: string
  index: string
}

interface CreateSessionBody {
  fileName: string
  mimeType: string
  fileSize: number
}

function authGuard(
  request: { headers: Readonly<Record<string, string | string[] | undefined>> },
  reply: { status: (n: number) => { send: (b: unknown) => unknown } }
): boolean {
  const key = request.headers['x-upload-key']
  const keyStr = Array.isArray(key) ? key[0] : key
  if (!validateApiKey(keyStr, config.auth.apiKey)) {
    void reply.status(401).send(err('Unauthorized', 'AUTH_REQUIRED'))
    return false
  }
  return true
}

export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser(
    'application/octet-stream',
    function (_request, payload, done) {
      done(null, payload)
    }
  )

  fastify.post<{ Body: CreateSessionBody }>(
    '/sessions',
    async (request, reply) => {
      if (!authGuard(request, reply)) return

      if (getActiveCount() >= config.upload.maxConcurrent) {
        return reply.status(503).send(err('Server at capacity. Please retry shortly.', 'CAPACITY'))
      }

      const parsed = createSessionSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(422).send(
          err(`Validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`, 'VALIDATION')
        )
      }

      const { fileName, mimeType, fileSize } = parsed.data

      if (!validateMimeType(mimeType)) {
        return reply.status(415).send(err(`Unsupported MIME type: ${mimeType}`, 'MIME_INVALID'))
      }
      if (!validateExtension(fileName)) {
        return reply.status(415).send(err('Unsupported file extension', 'EXT_INVALID'))
      }
      if (fileSize > config.upload.maxFileSize) {
        return reply.status(413).send(err('File exceeds maximum allowed size', 'FILE_TOO_LARGE'))
      }

      const sessionId = generateSessionId()
      const sanitizedName = sanitizeFilename(fileName)
      const totalChunks = Math.ceil(fileSize / config.upload.chunkSize)
      const sessionDir = getSessionDir(sessionId)
      const now = new Date()

      try {
        await ensureSessionDir(sessionId)
      } catch (e) {
        request.log.error({ sessionId, err: toMessage(e) }, 'Failed to create session directory')
        return reply.status(500).send(err('Failed to initialise upload session', 'STORAGE_ERROR'))
      }

      createSession({
        id: sessionId,
        state: 'created',
        fileName,
        sanitizedName,
        mimeType,
        fileSize,
        totalChunks,
        chunkSize: config.upload.chunkSize,
        receivedChunks: new Set<number>(),
        sessionDir,
        createdAt: now,
        updatedAt: now,
        telegramProgress: { loaded: 0, total: fileSize },
        result: null,
        error: null,
      })

      request.log.info({ sessionId, fileName, fileSize, totalChunks }, 'Upload session created')

      return reply.status(201).send(
        ok({ sessionId, totalChunks, chunkSize: config.upload.chunkSize })
      )
    }
  )

  fastify.put<{ Params: ChunkParams }>(
    '/sessions/:id/chunks/:index',
    async (request, reply) => {
      if (!authGuard(request, reply)) return

      const { id, index } = request.params

      if (!validateSessionId(id)) {
        return reply.status(400).send(err('Invalid session ID format', 'SESSION_ID_INVALID'))
      }

      const chunkIndex = parseInt(index, 10)
      if (!Number.isFinite(chunkIndex) || chunkIndex < 0) {
        return reply.status(400).send(err('Invalid chunk index', 'CHUNK_INVALID'))
      }

      const session = getSession(id)
      if (session === undefined) {
        return reply.status(404).send(err('Session not found', 'SESSION_NOT_FOUND'))
      }
      if (session.state === 'cancelled' || session.state === 'failed') {
        return reply.status(410).send(err('Session is no longer active', 'SESSION_INACTIVE'))
      }
      if (session.state === 'uploading_telegram' || session.state === 'completed') {
        return reply.status(409).send(err('Session is already being finalised', 'SESSION_LOCKED'))
      }
      if (chunkIndex >= session.totalChunks) {
        return reply.status(400).send(err('Chunk index out of range', 'CHUNK_OUT_OF_RANGE'))
      }

      if (await chunkExists(id, chunkIndex)) {
        return reply.send(ok({ chunkIndex, status: 'already_received' }))
      }

      if (!isReadableStream(request.body)) {
        return reply.status(400).send(err('Expected binary stream body', 'NO_BODY'))
      }

      try {
        const bytesWritten = await writeChunkStream(id, chunkIndex, request.body)
        markChunkReceived(id, chunkIndex)
        request.log.debug({ sessionId: id, chunkIndex, bytesWritten }, 'Chunk received')
        return reply.send(ok({ chunkIndex, bytesWritten, status: 'received' }))
      } catch (e) {
        request.log.error({ sessionId: id, chunkIndex, err: toMessage(e) }, 'Chunk write failed')
        return reply.status(500).send(err('Failed to store chunk', 'WRITE_ERROR'))
      }
    }
  )

  fastify.post<{ Params: SessionParams }>(
    '/sessions/:id/complete',
    async (request, reply) => {
      if (!authGuard(request, reply)) return

      const { id } = request.params

      if (!validateSessionId(id)) {
        return reply.status(400).send(err('Invalid session ID format', 'SESSION_ID_INVALID'))
      }

      const session = getSession(id)
      if (session === undefined) {
        return reply.status(404).send(err('Session not found', 'SESSION_NOT_FOUND'))
      }
      if (session.state === 'completed') {
        return reply.send(ok(toView(session)))
      }
      if (session.state === 'uploading_telegram') {
        return reply.status(202).send(ok({ message: 'Already processing', sessionId: id }))
      }
      if (session.state === 'cancelled' || session.state === 'failed') {
        return reply.status(410).send(err('Session is no longer active', 'SESSION_INACTIVE'))
      }

      const missingChunks: number[] = []
      for (let i = 0; i < session.totalChunks; i++) {
        if (!session.receivedChunks.has(i)) missingChunks.push(i)
      }
      if (missingChunks.length > 0) {
        return reply.status(400).send(
          err(`Missing chunks: ${missingChunks.slice(0, 20).join(', ')}`, 'CHUNKS_MISSING')
        )
      }

      updateSessionState(id, 'uploading_telegram')
      request.log.info({ sessionId: id, totalChunks: session.totalChunks }, 'Starting Telegram upload')
      setImmediate(() => { void processUpload(id, fastify) })

      return reply.status(202).send(ok({ message: 'Processing started', sessionId: id }))
    }
  )

  fastify.get<{ Params: SessionParams }>(
    '/sessions/:id',
    async (request, reply) => {
      if (!authGuard(request, reply)) return

      const { id } = request.params

      if (!validateSessionId(id)) {
        return reply.status(400).send(err('Invalid session ID format', 'SESSION_ID_INVALID'))
      }

      const session = getSession(id)
      if (session === undefined) {
        return reply.status(404).send(err('Session not found', 'SESSION_NOT_FOUND'))
      }

      return reply.send(ok(toView(session)))
    }
  )

  fastify.delete<{ Params: SessionParams }>(
    '/sessions/:id',
    async (request, reply) => {
      if (!authGuard(request, reply)) return

      const { id } = request.params

      if (!validateSessionId(id)) {
        return reply.status(400).send(err('Invalid session ID format', 'SESSION_ID_INVALID'))
      }

      const session = getSession(id)
      if (session === undefined) {
        return reply.status(404).send(err('Session not found', 'SESSION_NOT_FOUND'))
      }

      updateSessionState(id, 'cancelled')
      deleteSession(id)
      await deleteSessionDir(id)

      request.log.info({ sessionId: id }, 'Session cancelled and cleaned up')
      return reply.send(ok({ message: 'Session cancelled' }))
    }
  )
}

async function processUpload(sessionId: string, fastify: FastifyInstance): Promise<void> {
  const session = getSession(sessionId)
  if (session === undefined) return

  try {
    const telegramResult = await uploadToTelegram(
      sessionId,
      session.totalChunks,
      session.sanitizedName,
      session.mimeType,
      session.fileSize
    )

    let slug = generateSlug()
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!(await slugExists(slug))) break
      slug = generateSlug()
    }

    const deleteToken = generateDeleteToken()

    await insertVideo({
      slug,
      title: session.sanitizedName,
      telegram_file_id: telegramResult.fileId,
      telegram_file_path: telegramResult.filePath,
      file_size: telegramResult.fileSize,
      mime_type: session.mimeType,
      delete_token: deleteToken,
      upload_status: 'completed',
    })

    setSessionResult(sessionId, {
      slug,
      deleteToken,
      url: `${config.site.url}/v/${slug}`,
      telegramFileId: telegramResult.fileId,
      telegramFilePath: telegramResult.filePath,
    })

    fastify.log.info({ sessionId, slug }, 'Upload pipeline completed')
  } catch (e) {
    const message = toMessage(e)
    fastify.log.error({ sessionId, err: message }, 'Upload pipeline failed')
    updateSessionState(sessionId, 'failed', message)
  } finally {
    await deleteSessionDir(sessionId)
  }
}

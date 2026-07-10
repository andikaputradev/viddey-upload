import fs from 'fs/promises'
import { createWriteStream, createReadStream } from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Transform, Readable } from 'stream'
import { config } from '../config.js'
import { toMessage } from '../lib/error.js'
import type { PersistedSession, UploadSession } from '../types/index.js'

export function getSessionDir(sessionId: string): string {
  const base = path.resolve(config.upload.tempDir)
  const target = path.resolve(base, sessionId)
  if (!target.startsWith(base + path.sep)) {
    throw new Error(`Path traversal detected for session ID: ${sessionId}`)
  }
  return target
}

export function getChunkPath(sessionId: string, chunkIndex: number): string {
  return path.join(getSessionDir(sessionId), 'chunks', `${chunkIndex}.bin`)
}

export async function ensureBaseDir(): Promise<void> {
  await fs.mkdir(config.upload.tempDir, { recursive: true })
}

export async function ensureSessionDir(sessionId: string): Promise<string> {
  const dir = getSessionDir(sessionId)
  await fs.mkdir(path.join(dir, 'chunks'), { recursive: true })
  return dir
}

export async function writeChunkStream(
  sessionId: string,
  chunkIndex: number,
  stream: NodeJS.ReadableStream
): Promise<number> {
  const finalPath = getChunkPath(sessionId, chunkIndex)
  const tmpPath = `${finalPath}.tmp`

  let bytesWritten = 0
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytesWritten += chunk.length
      cb(null, chunk)
    },
  })

  const writeStream = createWriteStream(tmpPath)

  try {
    await pipeline(stream as Readable, counter, writeStream)
    if (bytesWritten === 0) {
      await fs.unlink(tmpPath).catch(() => undefined)
      throw new Error('Zero bytes written — empty chunk rejected')
    }
    await fs.rename(tmpPath, finalPath)
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => undefined)
    throw err
  }

  return bytesWritten
}

export async function chunkExists(sessionId: string, chunkIndex: number): Promise<boolean> {
  try {
    await fs.access(getChunkPath(sessionId, chunkIndex))
    return true
  } catch {
    return false
  }
}

export async function* streamAllChunks(
  sessionId: string,
  totalChunks: number
): AsyncGenerator<Buffer> {
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = getChunkPath(sessionId, i)
    const fileStream = createReadStream(chunkPath)
    for await (const chunk of fileStream) {
      yield chunk as Buffer
    }
  }
}

export async function deleteSessionDir(sessionId: string): Promise<void> {
  try {
    const dir = getSessionDir(sessionId)
    await fs.rm(dir, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[storage] Failed to delete session dir ${sessionId}: ${toMessage(err)}`)
  }
}

export async function persistSession(session: UploadSession): Promise<void> {
  const sessionFile = path.join(session.sessionDir, 'session.json')
  const payload: PersistedSession = {
    ...session,
    receivedChunks: Array.from(session.receivedChunks),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  }
  const tmp = `${sessionFile}.tmp`
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf-8')
  await fs.rename(tmp, sessionFile)
}

export async function loadPersistedSessions(): Promise<UploadSession[]> {
  const sessions: UploadSession[] = []
  let entries: string[]
  try {
    entries = await fs.readdir(config.upload.tempDir)
  } catch {
    return sessions
  }

  for (const entry of entries) {
    const sessionFile = path.join(config.upload.tempDir, entry, 'session.json')
    try {
      const raw = await fs.readFile(sessionFile, 'utf-8')
      const data = JSON.parse(raw) as PersistedSession
      const session: UploadSession = {
        ...data,
        receivedChunks: new Set(data.receivedChunks),
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      }
      sessions.push(session)
    } catch {
      // Skip corrupted session files
    }
  }

  return sessions
}

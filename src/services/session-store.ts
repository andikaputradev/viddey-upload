import { config } from '../config.js'
import { persistSession, loadPersistedSessions, deleteSessionDir } from './storage.js'
import { toMessage } from '../lib/error.js'
import type { UploadSession, SessionView, SessionState } from '../types/index.js'

const store = new Map<string, UploadSession>()
let cleanupHandle: NodeJS.Timeout | null = null

export async function initializeSessionStore(): Promise<void> {
  const recovered = await loadPersistedSessions()
  const now = Date.now()
  let count = 0

  for (const session of recovered) {
    const age = now - session.updatedAt.getTime()
    if (age > config.upload.sessionTtl) {
      await deleteSessionDir(session.id)
      continue
    }

    if (session.state === 'uploading_telegram') {
      session.state = 'failed'
      session.error = 'Upload interrupted by server restart — please re-upload'
      session.updatedAt = new Date()
    }

    if (session.state !== 'completed' && session.state !== 'cancelled') {
      store.set(session.id, session)
      count++
    }
  }

  if (count > 0) {
    console.info(`[session-store] Recovered ${count} sessions from disk`)
  }
}

export function startCleanup(): void {
  if (cleanupHandle !== null) return

  cleanupHandle = setInterval(() => {
    void runCleanup()
  }, config.upload.cleanupInterval)
}

export function stopCleanup(): void {
  if (cleanupHandle !== null) {
    clearInterval(cleanupHandle)
    cleanupHandle = null
  }
}

async function runCleanup(): Promise<void> {
  const now = Date.now()
  const toDelete: string[] = []

  for (const [id, session] of store.entries()) {
    const age = now - session.updatedAt.getTime()
    const isTerminal =
      session.state === 'completed' ||
      session.state === 'failed' ||
      session.state === 'cancelled'

    if (age > config.upload.sessionTtl || (isTerminal && age > 120_000)) {
      toDelete.push(id)
    }
  }

  for (const id of toDelete) {
    store.delete(id)
    await deleteSessionDir(id)
  }

  if (toDelete.length > 0) {
    console.info(`[session-store] Cleaned up ${toDelete.length} expired sessions`)
  }
}

async function syncToDisk(session: UploadSession): Promise<void> {
  try {
    await persistSession(session)
  } catch (err) {
    console.warn(`[session-store] Failed to persist session ${session.id}: ${toMessage(err)}`)
  }
}

export function createSession(session: UploadSession): void {
  store.set(session.id, session)
  void syncToDisk(session)
}

export function getSession(id: string): UploadSession | undefined {
  return store.get(id)
}

export function updateSessionState(id: string, state: SessionState, error?: string): boolean {
  const s = store.get(id)
  if (s === undefined) return false
  s.state = state
  s.updatedAt = new Date()
  if (error !== undefined) s.error = error
  void syncToDisk(s)
  return true
}

export function markChunkReceived(id: string, chunkIndex: number): boolean {
  const s = store.get(id)
  if (s === undefined) return false
  s.receivedChunks.add(chunkIndex)
  s.state = 'receiving'
  s.updatedAt = new Date()
  void syncToDisk(s)
  return true
}

export function updateTelegramProgress(id: string, loaded: number, total: number): void {
  const s = store.get(id)
  if (s === undefined) return
  s.telegramProgress = { loaded, total }
  s.updatedAt = new Date()
}

export function setSessionResult(id: string, result: UploadSession['result']): boolean {
  const s = store.get(id)
  if (s === undefined) return false
  s.result = result
  s.state = 'completed'
  s.updatedAt = new Date()
  void syncToDisk(s)
  return true
}

export function deleteSession(id: string): void {
  store.delete(id)
}

export function getActiveCount(): number {
  let n = 0
  for (const s of store.values()) {
    if (s.state === 'created' || s.state === 'receiving' || s.state === 'uploading_telegram') n++
  }
  return n
}

export function getSessionCount(): number {
  return store.size
}

export function toView(session: UploadSession): SessionView {
  return {
    id: session.id,
    state: session.state,
    fileName: session.fileName,
    fileSize: session.fileSize,
    totalChunks: session.totalChunks,
    receivedChunksCount: session.receivedChunks.size,
    telegramProgress: session.telegramProgress,
    result: session.result,
    error: session.error,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  }
}

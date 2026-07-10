export type SessionState =
  | 'created'
  | 'receiving'
  | 'received'
  | 'uploading_telegram'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface TelegramProgress {
  loaded: number
  total: number
}

export interface SessionResult {
  slug: string
  deleteToken: string
  url: string
  telegramFileId: string
  telegramFilePath: string
}

export interface UploadSession {
  id: string
  state: SessionState
  fileName: string
  sanitizedName: string
  mimeType: string
  fileSize: number
  totalChunks: number
  chunkSize: number
  receivedChunks: Set<number>
  sessionDir: string
  createdAt: Date
  updatedAt: Date
  telegramProgress: TelegramProgress
  result: SessionResult | null
  error: string | null
}

export interface SessionView {
  id: string
  state: SessionState
  fileName: string
  fileSize: number
  totalChunks: number
  receivedChunksCount: number
  telegramProgress: TelegramProgress
  result: SessionResult | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface TelegramSendResult {
  fileId: string
  filePath: string
  fileSize: number
}

export interface ApiOk<T> {
  ok: true
  data: T
}

export interface ApiErr {
  ok: false
  error: string
  code?: string
}

export type ApiResult<T> = ApiOk<T> | ApiErr

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data }
}

export function err(error: string, code?: string): ApiErr {
  return { ok: false, error, ...(code !== undefined ? { code } : {}) }
}

export interface PersistedSession
  extends Omit<UploadSession, 'receivedChunks' | 'createdAt' | 'updatedAt'> {
  receivedChunks: number[]
  createdAt: string
  updatedAt: string
}

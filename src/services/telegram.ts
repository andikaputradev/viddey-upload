import { Readable, Transform } from 'stream'
import FormData from 'form-data'
import axios, { type AxiosError } from 'axios'
import { config } from '../config.js'
import { streamAllChunks } from './storage.js'
import { updateTelegramProgress } from './session-store.js'
import { retryWithBackoff } from '../lib/utils.js'
import { toMessage } from '../lib/error.js'
import type { TelegramSendResult } from '../types/index.js'

interface TelegramApiFile {
  file_id: string
  file_unique_id: string
  file_size?: number
  file_path: string
}

interface TelegramApiDocument {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

interface TelegramApiResponse<T> {
  ok: boolean
  result: T
  description?: string
  error_code?: number
}

interface SendDocumentResult {
  document?: TelegramApiDocument
  video?: TelegramApiDocument
}

function endpoint(method: string): string {
  return `${config.telegram.apiBase}/bot${config.telegram.token}/${method}`
}

function isRetryableError(err: unknown): boolean {
  const axErr = err as AxiosError
  if (!axErr.isAxiosError) return true
  const status = axErr.response?.status
  if (status === undefined) return true
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function makeProgressTransform(sessionId: string, totalBytes: number): Transform {
  let transferred = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      transferred += chunk.length
      updateTelegramProgress(sessionId, transferred, totalBytes)
      cb(null, chunk)
    },
  })
}

export async function uploadToTelegram(
  sessionId: string,
  totalChunks: number,
  fileName: string,
  mimeType: string,
  fileSize: number
): Promise<TelegramSendResult> {
  return retryWithBackoff(
    async () => {
      const sourceStream = Readable.from(streamAllChunks(sessionId, totalChunks))
      const progressTransform = makeProgressTransform(sessionId, fileSize)
      const pipedStream = sourceStream.pipe(progressTransform)

      const form = new FormData()
      form.append('chat_id', config.telegram.channelId)
      form.append('document', pipedStream, {
        filename: fileName,
        contentType: mimeType,
        knownLength: fileSize,
      })

      let response: Awaited<ReturnType<typeof axios.post<TelegramApiResponse<SendDocumentResult>>>>
      try {
        response = await axios.post<TelegramApiResponse<SendDocumentResult>>(
          endpoint('sendDocument'),
          form,
          {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 0,
          }
        )
      } catch (err) {
        const axErr = err as AxiosError
        const desc =
          (axErr.response?.data as TelegramApiResponse<unknown> | undefined)?.description
        throw new Error(desc ?? toMessage(err))
      }

      if (!response.data.ok) {
        throw new Error(response.data.description ?? 'Telegram returned ok=false')
      }

      const media = response.data.result.document ?? response.data.result.video
      if (media?.file_id === undefined) {
        throw new Error('Telegram response missing file_id')
      }

      const fileInfo = await getFile(media.file_id)

      return {
        fileId: media.file_id,
        filePath: fileInfo.file_path,
        fileSize: media.file_size ?? fileSize,
      }
    },
    3,
    5000,
    `telegram.sendDocument(session=${sessionId})`
  )
}

export async function getFile(fileId: string): Promise<TelegramApiFile> {
  return retryWithBackoff(
    async () => {
      let response: Awaited<ReturnType<typeof axios.get<TelegramApiResponse<TelegramApiFile>>>>
      try {
        response = await axios.get<TelegramApiResponse<TelegramApiFile>>(
          endpoint(`getFile?file_id=${encodeURIComponent(fileId)}`),
          { timeout: 30_000 }
        )
      } catch (err) {
        if (!isRetryableError(err)) throw err
        throw new Error(`getFile network error: ${toMessage(err)}`)
      }
      if (!response.data.ok) {
        throw new Error(response.data.description ?? 'getFile failed')
      }
      return response.data.result
    },
    3,
    2000,
    `telegram.getFile(${fileId})`
  )
}

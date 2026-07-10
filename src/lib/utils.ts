import { toMessage } from './error.js'

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
  label = 'operation'
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts - 1) {
        const jitter = Math.random() * 500
        const delay = baseDelayMs * Math.pow(2, attempt) + jitter
        console.warn(
          `[retry] ${label} failed (attempt ${attempt + 1}/${maxAttempts}): ${toMessage(err)} — retrying in ${Math.round(delay)}ms`
        )
        await sleep(delay)
      }
    }
  }
  throw lastErr
}

export function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return (
    value !== null &&
    typeof value === 'object' &&
    'pipe' in (value as object) &&
    typeof (value as { pipe: unknown }).pipe === 'function'
  )
}

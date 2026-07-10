const SESSION_ID_RE = /^[0-9a-zA-Z]{24}$/
const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
])
const ALLOWED_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.mpeg', '.mpg'])

export function validateSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id)
}

export function validateMimeType(mime: string): boolean {
  return ALLOWED_MIME.has(mime)
}

export function validateExtension(filename: string): boolean {
  const dot = filename.toLowerCase().lastIndexOf('.')
  if (dot === -1) return false
  return ALLOWED_EXT.has(filename.toLowerCase().slice(dot))
}

export function sanitizeFilename(name: string): string {
  const clean = name
    .replace(/[^\w.\-\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._\-]+/, '')
    .slice(0, 200)
  return clean.length > 0 ? clean : 'video'
}

export function getClientIp(
  headers: Readonly<Record<string, string | string[] | undefined>>
): string {
  const xff = headers['x-forwarded-for']
  if (xff !== undefined) {
    const raw = Array.isArray(xff) ? xff[0] : xff
    if (raw !== undefined) return raw.split(',')[0]?.trim() ?? '0.0.0.0'
  }
  const xri = headers['x-real-ip']
  if (xri !== undefined) return Array.isArray(xri) ? (xri[0] ?? '0.0.0.0') : xri
  return '0.0.0.0'
}

export function validateApiKey(provided: string | undefined, expected: string): boolean {
  if (provided === undefined || provided.length === 0 || expected.length === 0) return false
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= (provided.codePointAt(i) ?? 0) ^ (expected.codePointAt(i) ?? 0)
  }
  return diff === 0
}

export function validateOrigin(
  origin: string | string[] | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (origin === undefined) return false
  const raw = Array.isArray(origin) ? origin[0] : origin
  if (raw === undefined) return false
  return allowedOrigins.some((allowed) => raw === allowed || raw.startsWith(allowed))
}

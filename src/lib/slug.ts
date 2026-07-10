import { customAlphabet } from 'nanoid'
import { randomBytes } from 'crypto'

const genSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)
const genSessionId = customAlphabet(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  24
)

export function generateSlug(): string {
  return genSlug()
}

export function generateSessionId(): string {
  return genSessionId()
}

export function generateDeleteToken(): string {
  return randomBytes(32).toString('hex')
}

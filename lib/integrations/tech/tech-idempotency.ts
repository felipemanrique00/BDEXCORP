import { createHash, randomUUID } from 'node:crypto'

const memory = new Map<string, { value: unknown; expiresAt: number }>()
const DEFAULT_TTL_MS = 15 * 60_000

export function getIdempotencyKey(prefix: string, payload: unknown, provided?: string): string {
  if (provided) return provided
  const hash = createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex')
    .slice(0, 24)
  return `${prefix}_${hash}`
}

export function requestId(prefix = 'tech'): string {
  return `${prefix}_${randomUUID()}`
}

export function getIdempotentResult<T>(key: string): T | null {
  const item = memory.get(key)
  if (!item) return null
  if (item.expiresAt < Date.now()) {
    memory.delete(key)
    return null
  }
  return item.value as T
}

export function setIdempotentResult<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): T {
  memory.set(key, { value, expiresAt: Date.now() + ttlMs })
  return value
}

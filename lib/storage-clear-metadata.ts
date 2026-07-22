export interface StorageClearMetadata {
  version: 1
  last_clear_at: string
  last_clear_id: string
  cleared_keys: Record<string, string>
  full_reset_at?: string
  full_reset_id?: string
}

export function buildStorageClearMetadata(
  current: unknown,
  keys: readonly string[],
  options: { clearedAt: string; clearId: string; fullReset?: boolean },
): StorageClearMetadata {
  const previous = normalizeStorageClearMetadata(current)
  const clearedKeys = { ...previous?.cleared_keys }
  for (const key of keys) clearedKeys[key] = options.clearedAt

  return {
    version: 1,
    last_clear_at: options.clearedAt,
    last_clear_id: options.clearId,
    cleared_keys: clearedKeys,
    full_reset_at: options.fullReset ? options.clearedAt : previous?.full_reset_at,
    full_reset_id: options.fullReset ? options.clearId : previous?.full_reset_id,
  }
}

export function normalizeStorageClearMetadata(value: unknown): StorageClearMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const lastClearAt = validIso(source.last_clear_at)
  const lastClearId = String(source.last_clear_id || '').trim()
  if (!lastClearAt || !lastClearId) return null

  const clearedKeys: Record<string, string> = {}
  if (source.cleared_keys && typeof source.cleared_keys === 'object' && !Array.isArray(source.cleared_keys)) {
    for (const [key, timestamp] of Object.entries(source.cleared_keys as Record<string, unknown>)) {
      const normalizedTimestamp = validIso(timestamp)
      if (key && normalizedTimestamp) clearedKeys[key] = normalizedTimestamp
    }
  }

  return {
    version: 1,
    last_clear_at: lastClearAt,
    last_clear_id: lastClearId,
    cleared_keys: clearedKeys,
    full_reset_at: validIso(source.full_reset_at) || undefined,
    full_reset_id: source.full_reset_id ? String(source.full_reset_id) : undefined,
  }
}

export function mergeStorageClearMetadata(current: unknown, incoming: unknown): unknown {
  const currentMetadata = normalizeStorageClearMetadata(current)
  const incomingMetadata = normalizeStorageClearMetadata(incoming)
  if (!currentMetadata) return incomingMetadata || incoming
  if (!incomingMetadata) return currentMetadata

  const clearedKeys = { ...currentMetadata.cleared_keys }
  for (const [key, incomingTimestamp] of Object.entries(incomingMetadata.cleared_keys)) {
    if (timestamp(incomingTimestamp) > timestamp(clearedKeys[key])) clearedKeys[key] = incomingTimestamp
  }

  const latest = timestamp(incomingMetadata.last_clear_at) > timestamp(currentMetadata.last_clear_at)
    ? incomingMetadata
    : currentMetadata
  const latestFullReset = timestamp(incomingMetadata.full_reset_at) > timestamp(currentMetadata.full_reset_at)
    ? incomingMetadata
    : currentMetadata

  return {
    version: 1,
    last_clear_at: latest.last_clear_at,
    last_clear_id: latest.last_clear_id,
    cleared_keys: clearedKeys,
    full_reset_at: latestFullReset.full_reset_at,
    full_reset_id: latestFullReset.full_reset_id,
  } satisfies StorageClearMetadata
}

export function isStorageKeyClearNewer(
  remote: unknown,
  local: unknown,
  key: string,
): boolean {
  const remoteTimestamp = normalizeStorageClearMetadata(remote)?.cleared_keys[key]
  if (!remoteTimestamp) return false
  const localTimestamp = normalizeStorageClearMetadata(local)?.cleared_keys[key]
  return timestamp(remoteTimestamp) > timestamp(localTimestamp)
}

export function isFullStorageResetNewer(remote: unknown, local: unknown): boolean {
  const remoteTimestamp = normalizeStorageClearMetadata(remote)?.full_reset_at
  if (!remoteTimestamp) return false
  const localTimestamp = normalizeStorageClearMetadata(local)?.full_reset_at
  return timestamp(remoteTimestamp) > timestamp(localTimestamp)
}

export function wasStorageKeyCleared(metadata: unknown, key: string): boolean {
  return Boolean(normalizeStorageClearMetadata(metadata)?.cleared_keys[key])
}

export function getStorageClearAcknowledgements(metadata: unknown): Record<string, string> {
  return { ...(normalizeStorageClearMetadata(metadata)?.cleared_keys || {}) }
}

export function storageWriteAcknowledgesLatestClear(
  serverMetadata: unknown,
  clientAcknowledgements: unknown,
  key: string,
): boolean {
  const requiredTimestamp = normalizeStorageClearMetadata(serverMetadata)?.cleared_keys[key]
  if (!requiredTimestamp) return true
  if (!clientAcknowledgements || typeof clientAcknowledgements !== 'object' || Array.isArray(clientAcknowledgements)) {
    return false
  }
  const acknowledgedTimestamp = validIso((clientAcknowledgements as Record<string, unknown>)[key])
  return timestamp(acknowledgedTimestamp) >= timestamp(requiredTimestamp)
}

function validIso(value: unknown): string {
  const normalized = String(value || '').trim()
  return Number.isFinite(Date.parse(normalized)) ? normalized : ''
}

function timestamp(value?: string): number {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

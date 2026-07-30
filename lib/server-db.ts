import 'server-only'

import { randomUUID } from 'node:crypto'

import {
  SHARED_STORAGE_KEYS,
  SYSTEM_STORAGE_META_KEY,
  isSharedStorageKey,
} from '@/lib/storage-keys'
import { buildStorageClearMetadata } from '@/lib/storage-clear-metadata'
import { mergeStorageValues } from '@/lib/storage-merge'
import {
  databaseConfigured,
  getDatabasePool,
  pingDatabase,
  withTenantTransaction,
} from '@/lib/server/database'
import { getRequestContext, requireTenantId } from '@/lib/server/request-context'
import { syncCorporateDirectoryFromStorage } from '@/lib/server/corporate-directory-sync'
import { syncTravelDemandsFromStorage } from '@/lib/server/travel-demand-sync'
import { getDomainRolloutInTransaction } from '@/lib/server/domain-rollout-service'
import { filterRelationalDemandStorageWrites } from '@/lib/storage-relational-guard'

export { databaseConfigured, getDatabasePool, pingDatabase }

export interface StorageEntryVersion {
  key: string
  version: number
  updatedAt: string
}

export class StorageQuotaExceededError extends Error {}
export class MonthlyOperationLimitExceededError extends Error {}

export async function getStorageEntries(tenantId = requireTenantId()): Promise<Record<string, unknown>> {
  return getStorageEntriesByKeys(SHARED_STORAGE_KEYS, tenantId)
}

export async function getStorageEntriesByKeys(
  requestedKeys: readonly string[],
  tenantId = requireTenantId(),
): Promise<Record<string, unknown>> {
  const keys = Array.from(new Set(requestedKeys.filter(isSharedStorageKey)))
  if (!keys.length) return {}

  return withTenantTransaction(tenantId, async (client) => {
    const result = await client.query(
      `select key, value
       from app_kv
       where tenant_id = $1 and key = any($2::text[])`,
      [tenantId, keys],
    )
    return Object.fromEntries(result.rows.map((row) => [row.key, row.value]))
  })
}

export async function getStorageEntryVersions(tenantId = requireTenantId()): Promise<StorageEntryVersion[]> {
  return withTenantTransaction(tenantId, async (client) => {
    const result = await client.query(
      `select key, version, updated_at
       from app_kv
       where tenant_id = $1 and key = any($2::text[])
       order by key`,
      [tenantId, SHARED_STORAGE_KEYS],
    )
    return result.rows.map((row) => ({
      key: String(row.key),
      version: Number(row.version),
      updatedAt: new Date(row.updated_at).toISOString(),
    }))
  })
}

export async function setStorageEntries(
  entries: Record<string, unknown>,
  tenantId = requireTenantId(),
): Promise<number> {
  const priority: Record<string, number> = { 'bbt-data-v4': 0, 'bbt-atendimentos': 1 }
  const filtered = Object.entries(entries)
    .filter(([key]) => isSharedStorageKey(key))
    .sort(([left], [right]) => (priority[left] ?? 10) - (priority[right] ?? 10) || left.localeCompare(right))
  if (!filtered.length) return 0

  const context = getRequestContext()
  const actorUserId = context?.principal.user.id || null
  const storageLimit = context?.principal.limits.storageBytes || null
  const monthlyOperationLimit = context?.principal.limits.monthlyOperations || null
  return withTenantTransaction(tenantId, async (client) => {
    const keys = filtered.map(([key]) => key).sort()
    for (const key of keys) {
      await client.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [tenantId, key])
    }

    const existing = await client.query(
      `select key, value
       from app_kv
       where tenant_id = $1 and key = any($2::text[])`,
      [tenantId, keys],
    )
    const current = new Map(existing.rows.map((row) => [row.key, row.value]))
    let addedOperations = 0

    for (const [key, value] of filtered) {
      const guardedValue = key === 'bbt-atendimentos'
        ? filterRelationalDemandStorageWrites(
            current.get(key),
            value,
            await getDomainRolloutInTransaction(client, tenantId, 'demands'),
          )
        : value
      const merged = mergeStorageValues(key, current.get(key), guardedValue)
      if (key === 'bbt-atendimentos') {
        addedOperations += countAddedEntityIds(current.get(key), merged)
      }
      await client.query(
        `insert into app_kv (tenant_id, key, value, updated_by)
         values ($1, $2, $3::jsonb, $4)
         on conflict (tenant_id, key) do update set
           value = excluded.value,
           version = app_kv.version + 1,
           updated_by = excluded.updated_by`,
        [tenantId, key, JSON.stringify(merged ?? null), actorUserId],
      )
      if (key === 'bbt-data-v4') {
        await syncCorporateDirectoryFromStorage(client, tenantId, merged, actorUserId)
      }
      if (key === 'bbt-atendimentos') {
        await syncTravelDemandsFromStorage(client, tenantId, merged, actorUserId)
      }
      current.set(key, merged)
    }
    if (addedOperations > 0) {
      const usage = await client.query<{ operations_created: number }>(
        `insert into tenant_usage_monthly (tenant_id, month_start, operations_created)
         values ($1, date_trunc('month', current_date)::date, $2)
         on conflict (tenant_id, month_start) do update set
           operations_created = tenant_usage_monthly.operations_created + excluded.operations_created,
           updated_at = now()
         returning operations_created`,
        [tenantId, addedOperations],
      )
      const monthlyOperations = Number(usage.rows[0]?.operations_created || 0)
      if (monthlyOperationLimit && monthlyOperations > monthlyOperationLimit) {
        throw new MonthlyOperationLimitExceededError('Limite mensal de novas demandas do plano atingido.')
      }
    }
    if (storageLimit) {
      const usage = await client.query<{ bytes: string }>(
        `select (
           coalesce((select sum(pg_column_size(value)) from app_kv where tenant_id = $1), 0) +
           coalesce((select sum(size_bytes) from stored_files where tenant_id = $1 and status = 'active'), 0)
         )::bigint as bytes`,
        [tenantId],
      )
      if (Number(usage.rows[0]?.bytes || 0) > storageLimit) {
        throw new StorageQuotaExceededError('Limite de armazenamento do plano atingido.')
      }
    }
    return filtered.length
  })
}

function countAddedEntityIds(previous: unknown, next: unknown): number {
  const previousIds = entityIds(previous)
  const nextIds = entityIds(next)
  let added = 0
  for (const id of nextIds) {
    if (!previousIds.has(id)) added += 1
  }
  return added
}

function entityIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const id = (item as Record<string, unknown>).id
    return typeof id === 'string' && id.trim() ? [id.trim()] : []
  }))
}

export async function deleteStorageEntries(
  keys: string[],
  options: { fullReset?: boolean } = {},
  tenantId = requireTenantId(),
): Promise<number> {
  const filtered = Array.from(new Set(keys.filter(
    (key) => isSharedStorageKey(key) && key !== SYSTEM_STORAGE_META_KEY,
  )))
  if (!filtered.length) return 0

  const clearOperation = {
    clearedAt: new Date().toISOString(),
    clearId: randomUUID(),
    fullReset: options.fullReset === true,
  }
  const actorUserId = getRequestContext()?.principal.user.id || null

  return withTenantTransaction(tenantId, async (client) => {
    const lockedKeys = [...filtered, SYSTEM_STORAGE_META_KEY].sort()
    for (const key of lockedKeys) {
      await client.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [tenantId, key])
    }

    const currentMetaResult = await client.query(
      'select value from app_kv where tenant_id = $1 and key = $2',
      [tenantId, SYSTEM_STORAGE_META_KEY],
    )
    const metadata = buildStorageClearMetadata(
      currentMetaResult.rows[0]?.value,
      filtered,
      clearOperation,
    )
    const deleted = await client.query(
      'delete from app_kv where tenant_id = $1 and key = any($2::text[])',
      [tenantId, filtered],
    )
    await client.query(
      `insert into app_kv (tenant_id, key, value, updated_by)
       values ($1, $2, $3::jsonb, $4)
       on conflict (tenant_id, key) do update set
         value = excluded.value,
         version = app_kv.version + 1,
         updated_by = excluded.updated_by`,
      [tenantId, SYSTEM_STORAGE_META_KEY, JSON.stringify(metadata), actorUserId],
    )
    return deleted.rowCount || 0
  })
}

export async function getTenantStorageBytes(tenantId = requireTenantId()): Promise<number> {
  return withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<{ bytes: string }>(
      `select coalesce(sum(pg_column_size(value)), 0)::bigint as bytes
       from app_kv where tenant_id = $1`,
      [tenantId],
    )
    return Number(result.rows[0]?.bytes || 0)
  })
}

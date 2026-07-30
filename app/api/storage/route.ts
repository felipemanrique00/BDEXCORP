import { NextResponse } from 'next/server'

import {
  deleteStorageEntries,
  getStorageEntries,
  getStorageEntriesByKeys,
  MonthlyOperationLimitExceededError,
  setStorageEntries,
  StorageQuotaExceededError,
} from '@/lib/server-db'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import {
  isRestrictedStorageUser,
  scopeStorageEntriesForRead,
  scopeStorageEntriesForWrite,
} from '@/lib/security/storage-scope'
import { SYSTEM_STORAGE_META_KEY, isSharedStorageKey } from '@/lib/storage-keys'
import { storageWriteAcknowledgesLatestClear } from '@/lib/storage-clear-metadata'
import { logError } from '@/lib/server/logger'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { partitionLegacyStorageWrites } from '@/lib/server/legacy-storage-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_STORAGE_BODY_BYTES = 64 * 1024 * 1024
const MAX_DELETE_BODY_BYTES = 64 * 1024
const LEGACY_STORAGE_HEADERS = {
  Deprecation: 'true',
  Warning: '299 BDEX "API de storage generico em processo de desativacao; use APIs de dominio"',
  'X-BDEX-Storage-Mode': 'legacy-compatibility',
}

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'storage:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  return runInApiGuardContext(guard, async () => {
    try {
      const requestedKeys = parseRequestedKeys(request)
      const queryKeys = requestedKeys
        ? Array.from(new Set([...requestedKeys, SYSTEM_STORAGE_META_KEY, 'bbt-data-v4']))
        : null
      const entries = queryKeys
        ? await getStorageEntriesByKeys(queryKeys)
        : await getStorageEntries()
      const visibleEntries = scopeStorageEntriesForRead(entries, guard.user)
      const responseEntries = requestedKeys
        ? pickEntries(visibleEntries, [...requestedKeys, SYSTEM_STORAGE_META_KEY])
        : visibleEntries
      return NextResponse.json(
        {
          ok: true,
          enabled: true,
          scoped: isRestrictedStorageUser(guard.user),
          entries: responseEntries,
        },
        { headers: LEGACY_STORAGE_HEADERS },
      )
    } catch (error) {
      logError('storage_read_failed', error, { requestId: guard.requestId, errorCode: 'STORAGE_READ_FAILED' })
      return NextResponse.json(
        { ok: false, enabled: false, entries: {}, error: 'Falha ao ler armazenamento compartilhado.' },
        { status: 500 },
      )
    }
  })
}

function parseRequestedKeys(request: Request): string[] | null {
  const raw = new URL(request.url).searchParams.get('keys')
  if (raw == null) return null

  return Array.from(new Set(
    raw
      .split(',')
      .map((key) => key.trim())
      .filter(isSharedStorageKey),
  ))
}

function pickEntries(entries: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const selected: Record<string, unknown> = {}
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(entries, key)) selected[key] = entries[key]
  }
  return selected
}

export async function PUT(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'storage:put', limit: 240, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  return runInApiGuardContext(guard, async () => {
    try {
      const body = await readJsonBody<{
        entries?: Record<string, unknown>
        clearAcks?: Record<string, unknown>
      }>(request, MAX_STORAGE_BODY_BYTES)
      const requestedEntries = body?.entries && typeof body.entries === 'object' ? body.entries : {}
      const entries = Object.fromEntries(
        Object.entries(requestedEntries).filter(([key]) => key !== SYSTEM_STORAGE_META_KEY),
      )
      const policy = await partitionLegacyStorageWrites(guard.principal!, entries)
      const existingEntries = await getStorageEntries()
      const staleClearKeys = Object.keys(policy.accepted).filter(
        (key) => !storageWriteAcknowledgesLatestClear(
          existingEntries[SYSTEM_STORAGE_META_KEY],
          body?.clearAcks,
          key,
        ),
      )
      const policyRejectedKeys = policy.rejected.map((item) => item.key)
      const rejectedKeys = Array.from(new Set([...staleClearKeys, ...policyRejectedKeys]))
      const rejectedKeySet = new Set(rejectedKeys)
      const acceptedEntries = Object.fromEntries(
        Object.entries(policy.accepted).filter(([key]) => !rejectedKeySet.has(key)),
      )
      const allowedEntries = scopeStorageEntriesForWrite(acceptedEntries, existingEntries, guard.user)
      const saved = await setStorageEntries(allowedEntries)
      const mergedEntries: Record<string, unknown> = {}
      const storageEntries = saved > 0 ? await getStorageEntries() : existingEntries
      const visibleEntries = scopeStorageEntriesForRead(storageEntries, guard.user)
      for (const key of Object.keys(allowedEntries)) {
        if (Object.prototype.hasOwnProperty.call(visibleEntries, key)) mergedEntries[key] = visibleEntries[key]
      }
      if (saved > 0 || policy.rejected.length > 0) {
        await writeAuditEvent({
          action: policy.rejected.length > 0 ? 'storage.batch_write_restricted' : 'storage.batch_write',
          result: policy.rejected.length > 0 ? 'denied' : 'success',
          entityType: 'tenant_storage',
          metadata: {
            keys: Object.keys(allowedEntries).sort(),
            saved,
            rejectedKeys,
            rejections: policy.rejected,
            deprecatedEndpoint: true,
          },
        })
      }
      return NextResponse.json(
        {
          ok: true,
          enabled: true,
          scoped: isRestrictedStorageUser(guard.user),
          saved,
          entries: mergedEntries,
          rejectedKeys,
          rejections: policy.rejected,
          metadata: visibleEntries[SYSTEM_STORAGE_META_KEY] || null,
        },
        { headers: LEGACY_STORAGE_HEADERS },
      )
    } catch (error) {
      const bodyError = requestBodyErrorResponse(error)
      if (bodyError) {
        return NextResponse.json({ ok: false, enabled: true, saved: 0, error: bodyError.message }, { status: bodyError.status })
      }
      if (error instanceof StorageQuotaExceededError) {
        return NextResponse.json({ ok: false, enabled: true, saved: 0, error: error.message }, { status: 409 })
      }
      if (error instanceof MonthlyOperationLimitExceededError) {
        return NextResponse.json({ ok: false, enabled: true, saved: 0, error: error.message, code: 'MONTHLY_OPERATION_LIMIT' }, { status: 409 })
      }
      logError('storage_write_failed', error, { requestId: guard.requestId, errorCode: 'STORAGE_WRITE_FAILED' })
      return NextResponse.json(
        { ok: false, enabled: true, saved: 0, error: 'Falha ao salvar armazenamento compartilhado.' },
        { status: 500 },
      )
    }
  })
}

export async function DELETE(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'storage:delete', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  if (isRestrictedStorageUser(guard.user)) {
    return NextResponse.json({ enabled: false, error: 'Operacao restrita ao administrador global.' }, { status: 403 })
  }

  return runInApiGuardContext(guard, async () => {
    try {
      const body = await readJsonBody<{ keys?: unknown[] }>(request, MAX_DELETE_BODY_BYTES)
      const keys = Array.isArray(body?.keys) ? body.keys.map(String) : []
      const deleted = await deleteStorageEntries(keys)
      const entries = await getStorageEntries()
      if (deleted > 0) {
        await writeAuditEvent({
          action: 'storage.batch_delete',
          result: 'success',
          entityType: 'tenant_storage',
          metadata: { keys: keys.filter(isSharedStorageKey).sort(), deleted, deprecatedEndpoint: true },
        })
      }
      return NextResponse.json(
        {
          ok: true,
          enabled: true,
          deleted,
          metadata: entries[SYSTEM_STORAGE_META_KEY] || null,
        },
        { headers: LEGACY_STORAGE_HEADERS },
      )
    } catch (error) {
      const bodyError = requestBodyErrorResponse(error)
      if (bodyError) {
        return NextResponse.json({ ok: false, enabled: true, deleted: 0, error: bodyError.message }, { status: bodyError.status })
      }
      logError('storage_delete_failed', error, { requestId: guard.requestId, errorCode: 'STORAGE_DELETE_FAILED' })
      return NextResponse.json(
        { ok: false, enabled: true, deleted: 0, error: 'Falha ao remover armazenamento compartilhado.' },
        { status: 500 },
      )
    }
  })
}

import { NextResponse } from 'next/server'

import {
  deleteStorageEntries,
  getStorageEntries,
  setStorageEntries,
} from '@/lib/server-db'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import {
  isRestrictedStorageUser,
  scopeStorageEntriesForRead,
  scopeStorageEntriesForWrite,
} from '@/lib/security/storage-scope'
import { SYSTEM_STORAGE_META_KEY } from '@/lib/storage-keys'
import { storageWriteAcknowledgesLatestClear } from '@/lib/storage-clear-metadata'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_STORAGE_BODY_BYTES = 64 * 1024 * 1024
const MAX_DELETE_BODY_BYTES = 64 * 1024

export async function GET(request: Request) {
  const guard = guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'storage:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const entries = await getStorageEntries()
    return NextResponse.json({
      enabled: true,
      scoped: isRestrictedStorageUser(guard.user),
      entries: scopeStorageEntriesForRead(entries, guard.user),
    })
  } catch (error) {
    console.error('[storage:get]', error)
    return NextResponse.json(
      { enabled: false, entries: {}, error: 'Falha ao ler armazenamento compartilhado.' },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request) {
  const guard = guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'storage:put', limit: 240, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const body = await readJsonBody<{
      entries?: Record<string, unknown>
      clearAcks?: Record<string, unknown>
    }>(request, MAX_STORAGE_BODY_BYTES)
    const requestedEntries = body?.entries && typeof body.entries === 'object' ? body.entries : {}
    const entries = Object.fromEntries(
      Object.entries(requestedEntries).filter(([key]) => key !== SYSTEM_STORAGE_META_KEY),
    )
    const existingEntries = await getStorageEntries()
    const rejectedKeys = Object.keys(entries).filter((key) => !storageWriteAcknowledgesLatestClear(
      existingEntries[SYSTEM_STORAGE_META_KEY],
      body?.clearAcks,
      key,
    ))
    const rejectedKeySet = new Set(rejectedKeys)
    const acceptedEntries = Object.fromEntries(
      Object.entries(entries).filter(([key]) => !rejectedKeySet.has(key)),
    )
    const allowedEntries = scopeStorageEntriesForWrite(acceptedEntries, existingEntries, guard.user)
    const saved = await setStorageEntries(allowedEntries)
    const mergedEntries: Record<string, unknown> = {}
    const storageEntries = saved > 0 ? await getStorageEntries() : existingEntries
    const visibleEntries = scopeStorageEntriesForRead(storageEntries, guard.user)
    for (const key of Object.keys(allowedEntries)) {
      if (Object.prototype.hasOwnProperty.call(visibleEntries, key)) mergedEntries[key] = visibleEntries[key]
    }
    return NextResponse.json({
      enabled: true,
      scoped: isRestrictedStorageUser(guard.user),
      saved,
      entries: mergedEntries,
      rejectedKeys,
      metadata: visibleEntries[SYSTEM_STORAGE_META_KEY] || null,
    })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) {
      return NextResponse.json({ enabled: true, saved: 0, error: bodyError.message }, { status: bodyError.status })
    }
    console.error('[storage:put]', error)
    return NextResponse.json(
      { enabled: true, saved: 0, error: 'Falha ao salvar armazenamento compartilhado.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  const guard = guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'storage:delete', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  if (isRestrictedStorageUser(guard.user)) {
    return NextResponse.json({ enabled: false, error: 'Operacao restrita ao administrador global.' }, { status: 403 })
  }

  try {
    const body = await readJsonBody<{ keys?: unknown[] }>(request, MAX_DELETE_BODY_BYTES)
    const keys = Array.isArray(body?.keys) ? body.keys.map(String) : []
    const deleted = await deleteStorageEntries(keys)
    const entries = await getStorageEntries()
    return NextResponse.json({
      enabled: true,
      deleted,
      metadata: entries[SYSTEM_STORAGE_META_KEY] || null,
    })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) {
      return NextResponse.json({ enabled: true, deleted: 0, error: bodyError.message }, { status: bodyError.status })
    }
    console.error('[storage:delete]', error)
    return NextResponse.json(
      { enabled: true, deleted: 0, error: 'Falha ao remover armazenamento compartilhado.' },
      { status: 500 },
    )
  }
}

import { NextResponse } from 'next/server'

import { deleteStorageEntries, getStorageEntries } from '@/lib/server-db'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { isRestrictedStorageUser } from '@/lib/security/storage-scope'
import {
  RESETTABLE_SHARED_STORAGE_KEYS,
  SYSTEM_STORAGE_META_KEY,
} from '@/lib/storage-keys'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESET_CONFIRMATION = 'APAGAR TUDO'

export async function POST(request: Request) {
  const guard = guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'system:reset', limit: 3, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  if (isRestrictedStorageUser(guard.user)) {
    return NextResponse.json(
      { ok: false, error: 'Operacao restrita ao administrador global.' },
      { status: 403 },
    )
  }

  try {
    const body = await readJsonBody<{ confirmation?: string }>(request, 4 * 1024)
    if (body?.confirmation !== RESET_CONFIRMATION) {
      return NextResponse.json(
        { ok: false, error: 'Confirmacao de limpeza invalida.' },
        { status: 400 },
      )
    }

    const deleted = await deleteStorageEntries(
      [...RESETTABLE_SHARED_STORAGE_KEYS],
      { fullReset: true },
    )
    const entries = await getStorageEntries()

    return NextResponse.json({
      ok: true,
      deleted,
      clearedKeys: RESETTABLE_SHARED_STORAGE_KEYS.length,
      metadata: entries[SYSTEM_STORAGE_META_KEY] || null,
    })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) {
      return NextResponse.json(
        { ok: false, error: bodyError.message },
        { status: bodyError.status },
      )
    }
    console.error('[system:reset]', error)
    return NextResponse.json(
      { ok: false, error: 'Falha ao zerar o armazenamento do sistema.' },
      { status: 500 },
    )
  }
}

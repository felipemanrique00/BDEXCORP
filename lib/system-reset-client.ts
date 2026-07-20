'use client'

import {
  applyFullStorageResetLocally,
  prepareSharedStorageForSystemReset,
} from '@/lib/storage-quota'
import { SYSTEM_STORAGE_META_KEY } from '@/lib/storage-keys'

interface SystemResetResponse {
  ok: boolean
  deleted?: number
  clearedKeys?: number
  metadata?: unknown
  error?: string
}

export interface SystemResetResult {
  deleted: number
  clearedKeys: number
}

export async function resetAllSystemData(confirmation: string): Promise<SystemResetResult> {
  prepareSharedStorageForSystemReset()

  const response = await fetch('/api/system/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation }),
  })
  const payload = await response.json().catch(() => null) as SystemResetResponse | null
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Falha ao zerar o sistema (HTTP ${response.status}).`)
  }

  await applyFullStorageResetLocally(payload.metadata)
  await assertRemoteStorageIsClean()

  return {
    deleted: Number(payload.deleted || 0),
    clearedKeys: Number(payload.clearedKeys || 0),
  }
}

async function assertRemoteStorageIsClean(): Promise<void> {
  const response = await fetch('/api/storage', { method: 'GET', cache: 'no-store' })
  if (!response.ok) throw new Error('O servidor foi limpo, mas a verificacao final falhou.')

  const payload = await response.json().catch(() => null)
  const entries = payload?.entries && typeof payload.entries === 'object'
    ? payload.entries as Record<string, unknown>
    : null
  if (!entries) throw new Error('O servidor nao confirmou o estado final da limpeza.')

  const remainingKeys = Object.keys(entries).filter((key) => key !== SYSTEM_STORAGE_META_KEY)
  if (remainingKeys.length > 0) {
    throw new Error(`A limpeza nao foi concluida para ${remainingKeys.length} conjunto(s) de dados.`)
  }
}

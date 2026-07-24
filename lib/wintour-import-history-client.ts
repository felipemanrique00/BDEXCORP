'use client'

import type { WintourImportRun } from '@/lib/wintour-import-history'

export async function listWintourImportRunsFromServer(limit = 60): Promise<WintourImportRun[]> {
  const response = await fetch(`/api/demands/import?source=wintour&limit=${Math.min(Math.max(limit, 1), 200)}`, {
    method: 'GET',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(payload?.items)) {
    throw new Error(payload?.error || 'Nao foi possivel carregar o historico de importacoes.')
  }
  return payload.items.filter(isWintourImportRun)
}

function isWintourImportRun(value: unknown): value is WintourImportRun {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string'
    && typeof item.file_name === 'string'
    && typeof item.source_format === 'string'
    && typeof item.imported_at === 'string'
    && Number.isFinite(Number(item.total_records))
  )
}

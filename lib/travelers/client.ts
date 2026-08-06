'use client'

import type { TravelerDirectoryItem } from '@/lib/travelers/types'

export async function searchTravelers(input: {
  companyId: string
  q?: string
  limit?: number
}, signal?: AbortSignal): Promise<TravelerDirectoryItem[]> {
  const search = new URLSearchParams({
    companyId: input.companyId,
    limit: String(input.limit || 20),
  })
  if (input.q) search.set('q', input.q)
  const response = await fetch(`/api/travelers?${search}`, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.items)) {
    throw new Error(String(payload?.error || 'Nao foi possivel buscar viajantes.'))
  }
  return payload.items as TravelerDirectoryItem[]
}

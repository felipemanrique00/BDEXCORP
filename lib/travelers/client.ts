'use client'

import type { TravelerDirectoryItem } from '@/lib/travelers/types'

export async function searchTravelers(input: {
  companyId: string
  q?: string
  ids?: string[]
  limit?: number
}, signal?: AbortSignal): Promise<TravelerDirectoryItem[]> {
  const search = new URLSearchParams({
    companyId: input.companyId,
    limit: String(input.limit || 20),
  })
  if (input.q) search.set('q', input.q)
  if (input.ids?.length) search.set('ids', input.ids.join(','))
  const response = await fetch(`/api/travelers?${search}`, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.items)) {
    throw new Error(String(payload?.error || 'Nao foi possivel buscar viajantes.'))
  }
  return payload.items as TravelerDirectoryItem[]
}

export async function createTraveler(input: {
  companyId: string
  name: string
  cpf: string
  birthDate: string
  email?: string
  phone?: string
}): Promise<TravelerDirectoryItem> {
  return mutateTraveler('/api/travelers', 'POST', input)
}

export async function completeTravelerMissingProfile(
  travelerId: string,
  input: { name?: string; cpf?: string; birthDate?: string },
): Promise<TravelerDirectoryItem> {
  return mutateTraveler(
    `/api/travelers/${encodeURIComponent(travelerId)}/missing-profile`,
    'PATCH',
    input,
  )
}

async function mutateTraveler(
  endpoint: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<TravelerDirectoryItem> {
  const response = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || !payload?.item) {
    throw new Error(String(payload?.error || 'Nao foi possivel salvar o viajante.'))
  }
  return payload.item as TravelerDirectoryItem
}

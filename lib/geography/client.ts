'use client'

import type {
  GeographyCity,
  GeographyCountry,
  GeographySubdivision,
  GeographySyncResult,
  GeographySyncStatus,
} from '@/lib/geography/types'

export async function listGeographyCountries(
  query = '',
  signal?: AbortSignal,
): Promise<GeographyCountry[]> {
  const search = new URLSearchParams({ limit: '200' })
  if (query) search.set('q', query)
  return requestItems<GeographyCountry>(`/api/geography/countries?${search}`, signal)
}

export async function listGeographySubdivisions(
  countryId: string,
  signal?: AbortSignal,
): Promise<GeographySubdivision[]> {
  return requestItems<GeographySubdivision>(
    `/api/geography/subdivisions?countryId=${encodeURIComponent(countryId)}&limit=200`,
    signal,
  )
}

export async function listGeographyCities(input: {
  countryId: string
  subdivisionId?: string
  q?: string
  limit?: number
}, signal?: AbortSignal): Promise<GeographyCity[]> {
  const search = new URLSearchParams({ countryId: input.countryId, limit: String(input.limit || 100) })
  if (input.subdivisionId) search.set('subdivisionId', input.subdivisionId)
  if (input.q) search.set('q', input.q)
  return requestItems<GeographyCity>(`/api/geography/cities?${search}`, signal)
}

export async function syncGeographyFromIbge(): Promise<GeographySyncResult> {
  const response = await fetch('/api/geography/sync', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'ibge', datasetKey: 'brazil', includeCountries: true }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || !payload?.result) {
    throw new Error(String(payload?.error || 'Nao foi possivel sincronizar a geografia.'))
  }
  return payload.result as GeographySyncResult
}

export async function getGeographySyncStatus(
  datasetKey: 'brazil' | 'countries' = 'brazil',
): Promise<GeographySyncStatus> {
  const response = await fetch(`/api/geography/sync?datasetKey=${encodeURIComponent(datasetKey)}`, {
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || 'Nao foi possivel consultar a atualizacao geografica.'))
  }
  return {
    latestRun: payload?.latestRun || null,
    datasetVersion: payload?.datasetVersion || null,
  } as GeographySyncStatus
}

async function requestItems<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(path, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.items)) {
    throw new Error(String(payload?.error || 'Nao foi possivel carregar a geografia.'))
  }
  return payload.items as T[]
}

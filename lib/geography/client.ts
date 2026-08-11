'use client'

import type {
  AirportCatalogSyncResult,
  AirportCatalogSyncStatus,
  GeographyAirport,
  GeographyCity,
  GeographyCountry,
  GeographySubdivision,
  GeographySyncResult,
  GeographySyncStatus,
} from '@/lib/geography/types'

export interface GeographyAirportSearchOptions {
  q?: string
  countryCode?: string
  subdivisionCode?: string
  scheduledService?: boolean
  includeInactive?: boolean
  includeWithoutIata?: boolean
  limit?: number
  offset?: number
}

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

export async function searchGeographyAirports(
  input: GeographyAirportSearchOptions = {},
  signal?: AbortSignal,
): Promise<{ items: GeographyAirport[]; total: number }> {
  const search = new URLSearchParams()
  if (input.q) search.set('q', input.q)
  if (input.countryCode) search.set('countryCode', input.countryCode)
  if (input.subdivisionCode) search.set('subdivisionCode', input.subdivisionCode)
  if (input.scheduledService !== undefined) search.set('scheduledService', String(input.scheduledService))
  if (input.includeInactive !== undefined) search.set('includeInactive', String(input.includeInactive))
  if (input.includeWithoutIata !== undefined) search.set('includeWithoutIata', String(input.includeWithoutIata))
  search.set('limit', String(input.limit || 30))
  if (input.offset) search.set('offset', String(input.offset))

  const response = await fetch(`/api/geography/airports?${search}`, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.items)) {
    throw new Error(String(payload?.error || 'Nao foi possivel carregar os aeroportos.'))
  }
  return {
    items: payload.items as GeographyAirport[],
    total: Number(payload.total || 0),
  }
}

export async function syncAirportCatalog(): Promise<AirportCatalogSyncResult> {
  const response = await fetch('/api/geography/airports/sync', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'ourairports', datasetKey: 'airports', deactivateMissing: true }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || !payload?.result) {
    throw new Error(String(payload?.error || 'Nao foi possivel sincronizar os aeroportos.'))
  }
  return payload.result as AirportCatalogSyncResult
}

export async function getAirportCatalogSyncStatus(): Promise<AirportCatalogSyncStatus> {
  const response = await fetch('/api/geography/airports/sync', { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || 'Nao foi possivel consultar a atualizacao dos aeroportos.'))
  }
  return {
    latestRun: payload?.latestRun || null,
    datasetVersion: payload?.datasetVersion || null,
  } as AirportCatalogSyncStatus
}

async function requestItems<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(path, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.items)) {
    throw new Error(String(payload?.error || 'Nao foi possivel carregar a geografia.'))
  }
  return payload.items as T[]
}

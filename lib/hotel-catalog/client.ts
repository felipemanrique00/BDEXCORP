'use client'

import type { HotelCatalogItem } from '@/lib/hotel-catalog/types'

export async function listHotelCatalog(
  filters: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<HotelCatalogItem[]> {
  const search = new URLSearchParams(filters)
  const payload = await request(
    `/api/hotel-catalog${search.size ? `?${search}` : ''}`,
    { signal },
  )
  return Array.isArray(payload.items) ? payload.items as HotelCatalogItem[] : []
}

export async function createHotelCatalogItem(input: Record<string, unknown>): Promise<HotelCatalogItem> {
  const payload = await request('/api/hotel-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return payload.item as HotelCatalogItem
}

export async function updateHotelCatalogItem(
  id: string,
  input: Record<string, unknown>,
): Promise<HotelCatalogItem> {
  const payload = await request(`/api/hotel-catalog/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return payload.item as HotelCatalogItem
}

export async function getHotelCatalogItem(id: string): Promise<HotelCatalogItem> {
  const payload = await request(`/api/hotel-catalog/${encodeURIComponent(id)}`)
  return payload.item as HotelCatalogItem
}

async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || 'Nao foi possivel concluir a operacao de hotel.'))
  }
  return payload as Record<string, unknown>
}

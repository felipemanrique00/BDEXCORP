'use client'

import type { HotelCatalogItem, HotelCatalogMedia } from '@/lib/hotel-catalog/types'

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

export async function uploadHotelCatalogMedia(
  hotelId: string,
  file: File,
  options: { roomTypeId?: string | null; altText?: string | null } = {},
): Promise<HotelCatalogMedia> {
  const form = new FormData()
  form.set('file', file)
  if (options.roomTypeId) form.set('roomTypeId', options.roomTypeId)
  if (options.altText?.trim()) form.set('altText', options.altText.trim())
  const payload = await request(`/api/hotel-catalog/${encodeURIComponent(hotelId)}/media`, {
    method: 'POST',
    body: form,
  })
  return payload.media as HotelCatalogMedia
}

export async function reorderHotelCatalogMedia(
  hotelId: string,
  roomTypeId: string | null,
  orderedMediaIds: string[],
): Promise<HotelCatalogMedia[]> {
  const payload = await request(`/api/hotel-catalog/${encodeURIComponent(hotelId)}/media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomTypeId, orderedMediaIds }),
  })
  return Array.isArray(payload.items) ? payload.items as HotelCatalogMedia[] : []
}

export async function deleteHotelCatalogMedia(hotelId: string, mediaId: string): Promise<void> {
  await request(
    `/api/hotel-catalog/${encodeURIComponent(hotelId)}/media/${encodeURIComponent(mediaId)}`,
    { method: 'DELETE' },
  )
}

async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || 'Nao foi possivel concluir a operacao de hotel.'))
  }
  return payload as Record<string, unknown>
}

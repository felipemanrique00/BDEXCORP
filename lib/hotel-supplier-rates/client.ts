'use client'

import type {
  CreateHotelSupplierLinkInput,
  CreateHotelSupplierRateInput,
  UpdateHotelSupplierLinkInput,
  UpdateHotelSupplierRateInput,
} from '@/lib/hotel-supplier-rates/schema'
import type { HotelSupplierLink, HotelSupplierRate } from '@/lib/hotel-supplier-rates/types'

export async function listHotelSupplierLinks(supplierId: string): Promise<HotelSupplierLink[]> {
  const payload = await request(basePath(supplierId))
  return Array.isArray(payload.items) ? payload.items as HotelSupplierLink[] : []
}

export async function createHotelSupplierLink(
  supplierId: string,
  input: CreateHotelSupplierLinkInput,
): Promise<{ item: HotelSupplierLink; replayed: boolean }> {
  const payload = await request(basePath(supplierId), jsonRequest('POST', input))
  return {
    item: payload.item as HotelSupplierLink,
    replayed: payload.replayed === true,
  }
}

export async function updateHotelSupplierLink(
  supplierId: string,
  linkId: string,
  input: UpdateHotelSupplierLinkInput,
): Promise<HotelSupplierLink> {
  const payload = await request(`${basePath(supplierId)}/${encodeURIComponent(linkId)}`, jsonRequest('PATCH', input))
  return payload.item as HotelSupplierLink
}

export async function listHotelSupplierRates(
  supplierId: string,
  linkId: string,
): Promise<HotelSupplierRate[]> {
  const payload = await request(`${basePath(supplierId)}/${encodeURIComponent(linkId)}/rates`)
  return Array.isArray(payload.items) ? payload.items as HotelSupplierRate[] : []
}

export async function createHotelSupplierRate(
  supplierId: string,
  linkId: string,
  input: CreateHotelSupplierRateInput,
): Promise<HotelSupplierRate> {
  const payload = await request(
    `${basePath(supplierId)}/${encodeURIComponent(linkId)}/rates`,
    jsonRequest('POST', input),
  )
  return payload.item as HotelSupplierRate
}

export async function updateHotelSupplierRate(
  supplierId: string,
  linkId: string,
  rateId: string,
  input: UpdateHotelSupplierRateInput,
): Promise<HotelSupplierRate> {
  const payload = await request(
    `${basePath(supplierId)}/${encodeURIComponent(linkId)}/rates/${encodeURIComponent(rateId)}`,
    jsonRequest('PATCH', input),
  )
  return payload.item as HotelSupplierRate
}

function basePath(supplierId: string): string {
  return `/api/commercial-suppliers/${encodeURIComponent(supplierId)}/hotel-links`
}

function jsonRequest(method: 'POST' | 'PATCH', input: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || 'Nao foi possivel concluir a operacao de vinculo/tarifa.'))
  }
  return payload as Record<string, unknown>
}

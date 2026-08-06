'use client'

import type { CommercialSupplier } from '@/lib/commercial-suppliers/types'

export async function listCommercialSuppliers(filters: Record<string, string> = {}): Promise<CommercialSupplier[]> {
  const query = new URLSearchParams(filters)
  const payload = await request(`/api/commercial-suppliers${query.size ? `?${query}` : ''}`)
  return Array.isArray(payload.items) ? payload.items as CommercialSupplier[] : []
}

export async function createCommercialSupplier(input: Record<string, unknown>): Promise<CommercialSupplier> {
  const payload = await request('/api/commercial-suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return payload.item as CommercialSupplier
}

export async function getCommercialSupplier(id: string): Promise<CommercialSupplier> {
  const payload = await request(`/api/commercial-suppliers/${encodeURIComponent(id)}`)
  return payload.item as CommercialSupplier
}

export async function updateCommercialSupplier(
  id: string,
  input: Record<string, unknown>,
): Promise<CommercialSupplier> {
  const payload = await request(`/api/commercial-suppliers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return payload.item as CommercialSupplier
}

async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || 'Nao foi possivel concluir a operacao de fornecedor.'))
  }
  return payload as Record<string, unknown>
}

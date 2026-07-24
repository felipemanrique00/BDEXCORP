'use client'

import type { GovernedTravelReservationList } from '@/lib/travel/reservation-records'

export async function listTravelReservationsFromServer(filters: {
  companyId?: string
  groupId?: string
  demandId?: string
  status?: 'draft' | 'prepared' | 'reserved' | 'issued' | 'cancelled' | 'failed'
  limit?: number
  offset?: number
} = {}, signal?: AbortSignal): Promise<GovernedTravelReservationList> {
  const search = new URLSearchParams()
  if (filters.companyId) search.set('companyId', filters.companyId)
  if (filters.groupId) search.set('groupId', filters.groupId)
  if (filters.demandId) search.set('demandId', filters.demandId)
  if (filters.status) search.set('status', filters.status)
  search.set('limit', String(filters.limit || 100))
  search.set('offset', String(filters.offset || 0))

  const response = await fetch(`/api/travel/reservations?${search.toString()}`, {
    cache: 'no-store',
    signal,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !Array.isArray(result.items)) {
    throw new Error(result?.error || 'Nao foi possivel carregar as reservas.')
  }
  return {
    items: result.items,
    total: Number(result.total || 0),
  } as GovernedTravelReservationList
}

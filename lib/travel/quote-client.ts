'use client'

import type { GovernedTravelQuoteList } from '@/lib/travel/quote-records'
import { appendCompanyIdsQuery } from '@/lib/company-selection-query'

export async function listTravelQuotesFromServer(filters: {
  companyId?: string
  companyIds?: string[]
  groupId?: string
  demandId?: string
  status?: 'pending' | 'completed' | 'selected' | 'expired' | 'failed'
  limit?: number
  offset?: number
} = {}, signal?: AbortSignal): Promise<GovernedTravelQuoteList> {
  const search = new URLSearchParams()
  if (filters.companyId) search.set('companyId', filters.companyId)
  appendCompanyIdsQuery(search, filters.companyIds)
  if (filters.groupId) search.set('groupId', filters.groupId)
  if (filters.demandId) search.set('demandId', filters.demandId)
  if (filters.status) search.set('status', filters.status)
  search.set('limit', String(filters.limit || 100))
  search.set('offset', String(filters.offset || 0))

  const response = await fetch(`/api/travel/quotes?${search.toString()}`, {
    cache: 'no-store',
    signal,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok || !Array.isArray(result.items)) {
    throw new Error(result?.error || 'Nao foi possivel carregar as cotacoes.')
  }
  return {
    items: result.items,
    total: Number(result.total || 0),
  } as GovernedTravelQuoteList
}

import {
  governanceJsonBody,
  GovernanceClientError,
  requestGovernanceJson,
} from '@/lib/governance-client'
import type { Atendimento } from '@/types'

import type {
  CorporateDemandDetail,
  CorporateDemandListItem,
  CorporateDemandSnapshot,
} from './demand-projection'

export { GovernanceClientError as CompanyPortalDemandClientError }

export interface CompanyPortalDemandScope {
  scopeType?: 'company' | 'group'
  scopeId?: string
}

export interface CompanyPortalDemandFilters extends CompanyPortalDemandScope {
  companyId?: string
  status?: string
  lifecycleStatus?: string
  serviceType?: string
  search?: string
  limit?: number
  offset?: number
}

export async function listCompanyPortalDemands(
  filters: CompanyPortalDemandFilters = {},
): Promise<{ items: CorporateDemandListItem[]; total: number }> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: CorporateDemandListItem[]
    total: number
  }>(`/api/company-portal/demands${queryString(filters)}`)
  return { items: payload.items, total: payload.total }
}

export async function getCompanyPortalDemand(
  demandId: string,
  scope: CompanyPortalDemandScope = {},
): Promise<CorporateDemandDetail> {
  const payload = await requestGovernanceJson<{ ok: true; item: CorporateDemandDetail }>(
    `/api/company-portal/demands/${encodeURIComponent(demandId)}${queryString(scope)}`,
  )
  return payload.item
}

export async function createCompanyPortalDemand(
  demand: Atendimento,
  scope: CompanyPortalDemandScope = {},
): Promise<{ item: CorporateDemandDetail; demand: CorporateDemandSnapshot; replayed: boolean }> {
  const payload = await requestGovernanceJson<{
    ok: true
    item: CorporateDemandDetail
    replayed: boolean
  }>(
    `/api/company-portal/demands${queryString(scope)}`,
    {
      method: 'POST',
      ...governanceJsonBody(
        { demand },
        { 'Idempotency-Key': `company-portal-demand:create:${demand.id}` },
      ),
    },
  )
  return { item: payload.item, demand: payload.item.demand, replayed: payload.replayed }
}

export async function updateCompanyPortalDemand(
  demandId: string,
  input: {
    demand: Atendimento
    expectedVersion: number
    reason: string
    idempotencyKey: string
  },
  scope: CompanyPortalDemandScope = {},
): Promise<{ item: CorporateDemandDetail; replayed: boolean }> {
  const payload = await requestGovernanceJson<{
    ok: true
    item: CorporateDemandDetail
    replayed: boolean
  }>(
    `/api/company-portal/demands/${encodeURIComponent(demandId)}${queryString(scope)}`,
    {
      method: 'PATCH',
      ...governanceJsonBody(
        { ...input, confirmed: true },
        { 'Idempotency-Key': input.idempotencyKey },
      ),
    },
  )
  return { item: payload.item, replayed: payload.replayed }
}

function queryString(filters: object): string {
  const search = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}

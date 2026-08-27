import { requestGovernanceJson } from '@/lib/governance-client'

import type {
  CorporateVoucherDetail,
  CorporateVoucherItem,
} from './corporate-projections'

export interface CompanyPortalVoucherScope {
  scopeType?: 'company' | 'group'
  scopeId?: string
}

export interface CompanyPortalVoucherFilters extends CompanyPortalVoucherScope {
  companyId?: string
  demandId?: string
  search?: string
  limit?: number
  offset?: number
}

export async function fetchCompanyPortalVouchers(
  filters: CompanyPortalVoucherFilters = {},
  signal?: AbortSignal,
): Promise<{ items: CorporateVoucherItem[]; total: number }> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: CorporateVoucherItem[]
    total: number
  }>(`/api/company-portal/vouchers${queryString(filters)}`, { signal })
  return { items: payload.items, total: payload.total }
}

export async function fetchCompanyPortalVoucher(
  voucherId: string,
  scope: CompanyPortalVoucherScope = {},
  signal?: AbortSignal,
): Promise<CorporateVoucherDetail> {
  const payload = await requestGovernanceJson<{ ok: true; voucher: CorporateVoucherDetail }>(
    `/api/company-portal/vouchers/${encodeURIComponent(voucherId)}${queryString(scope)}`,
    { signal },
  )
  return payload.voucher
}

function queryString(filters: object): string {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

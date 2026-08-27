import 'server-only'

import {
  projectCorporateVoucher,
  projectCorporateVoucherDetail,
  type CorporateVoucherDetail,
  type CorporateVoucherItem,
} from '@/lib/company-portal-lab/corporate-projections'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  resolveCompanyPortalScopeCompanyIds,
  type CompanyPortalScope,
} from '@/lib/server/company-portal-scope-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { getVoucher, listVouchers, VoucherServiceError } from '@/lib/server/voucher-service'

export interface CompanyPortalVoucherFilters extends CompanyPortalScope {
  demandId?: string
  search?: string
  limit?: number
  offset?: number
}

export async function listCompanyPortalVouchers(
  principal: RequestPrincipal,
  filters: CompanyPortalVoucherFilters = {},
): Promise<{ items: CorporateVoucherItem[]; total: number }> {
  const { scopeType, scopeId, companyId, ...listFilters } = filters
  const companyIds = resolveCompanyPortalScopeCompanyIds(
    principal,
    { scopeType, scopeId, companyId },
    'ver_vouchers',
  )
  const result = await listVouchers(principal, {
    ...listFilters,
    companyIds,
    bootstrapLegacy: false,
  })
  return {
    items: result.items.map(projectCorporateVoucher),
    total: result.total,
  }
}

export async function getCompanyPortalVoucher(
  principal: RequestPrincipal,
  voucherId: string,
  scope: CompanyPortalScope = {},
): Promise<CorporateVoucherDetail> {
  const companyIds = resolveCompanyPortalScopeCompanyIds(principal, scope, 'ver_vouchers')
  try {
    const voucher = await getVoucher(principal, voucherId, { bootstrapLegacy: false })
    if (!companyIds.includes(voucher.empresa_id)) throw companyPortalVoucherNotFound()
    return projectCorporateVoucherDetail(voucher)
  } catch (error) {
    if (error instanceof CorporateAccessDeniedError) throw companyPortalVoucherNotFound()
    throw error
  }
}

function companyPortalVoucherNotFound(): VoucherServiceError {
  return new VoucherServiceError('VOUCHER_NOT_FOUND', 'Voucher nao encontrado.', 404)
}

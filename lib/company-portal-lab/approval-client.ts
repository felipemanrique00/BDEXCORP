import { governanceJsonBody, requestGovernanceJson } from '@/lib/governance-client'

import type {
  CorporateApprovalDetail,
  CorporateApprovalItem,
} from './corporate-projections'

export interface CompanyPortalApprovalScope {
  scopeType?: 'company' | 'group'
  scopeId?: string
}

export interface CompanyPortalApprovalFilters extends CompanyPortalApprovalScope {
  status?: CorporateApprovalItem['status']
  companyId?: string
  demandId?: string
  assignedToMe?: boolean
  search?: string
  limit?: number
  offset?: number
}

export interface CompanyPortalApprovalDecisionInput {
  decision: 'approved' | 'rejected'
  reason: string
  expectedStepVersion: number
  idempotencyKey: string
  confirmation: true
}

export async function fetchCompanyPortalApprovals(
  filters: CompanyPortalApprovalFilters = {},
  signal?: AbortSignal,
): Promise<{ items: CorporateApprovalItem[]; total: number }> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: CorporateApprovalItem[]
    total: number
  }>(`/api/company-portal/approvals${queryString(filters)}`, { signal })
  return { items: payload.items, total: payload.total }
}

export async function fetchCompanyPortalApproval(
  instanceId: string,
  scope: CompanyPortalApprovalScope = {},
  signal?: AbortSignal,
): Promise<CorporateApprovalDetail> {
  const payload = await requestGovernanceJson<{ ok: true; approval: CorporateApprovalDetail }>(
    `/api/company-portal/approvals/${encodeURIComponent(instanceId)}${queryString(scope)}`,
    { signal },
  )
  return payload.approval
}

export async function decideCompanyPortalApproval(
  instanceId: string,
  input: CompanyPortalApprovalDecisionInput,
  scope: CompanyPortalApprovalScope = {},
  signal?: AbortSignal,
): Promise<CorporateApprovalDetail> {
  const payload = await requestGovernanceJson<{ ok: true; approval: CorporateApprovalDetail }>(
    `/api/company-portal/approvals/${encodeURIComponent(instanceId)}/decision${queryString(scope)}`,
    { method: 'POST', ...governanceJsonBody(input), signal },
  )
  return payload.approval
}

function queryString(filters: object): string {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

import 'server-only'

import {
  findCorporateApprovalDecisionTarget,
  projectCorporateApproval,
  projectCorporateApprovalDetail,
  type CorporateApprovalDetail,
  type CorporateApprovalItem,
} from '@/lib/company-portal-lab/corporate-projections'
import {
  ApprovalServiceError,
  decideApprovalAssignment,
  findApprovalDecisionReplayAssignmentId,
  getApprovalInstanceDetail,
  listApprovalInstances,
} from '@/lib/server/approval-service'
import { approvalDecisionInputSchema } from '@/lib/approvals'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  resolveCompanyPortalScopeCompanyIds,
  type CompanyPortalScope,
} from '@/lib/server/company-portal-scope-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

export interface CompanyPortalApprovalFilters extends CompanyPortalScope {
  status?: CorporateApprovalItem['status']
  demandId?: string
  assignedToMe?: boolean
  search?: string
  limit?: number
  offset?: number
}

export async function listCompanyPortalApprovals(
  principal: RequestPrincipal,
  filters: CompanyPortalApprovalFilters = {},
): Promise<{ items: CorporateApprovalItem[]; total: number }> {
  const { scopeType, scopeId, companyId, ...listFilters } = filters
  const companyIds = resolveCompanyPortalScopeCompanyIds(
    principal,
    { scopeType, scopeId, companyId },
    'ver_aprovacoes',
  )
  const result = await listApprovalInstances(principal, { ...listFilters, companyIds })
  return {
    items: result.items.map(projectCorporateApproval),
    total: result.total,
  }
}

export async function getCompanyPortalApproval(
  principal: RequestPrincipal,
  instanceId: string,
  scope: CompanyPortalScope = {},
): Promise<CorporateApprovalDetail> {
  const companyIds = resolveCompanyPortalScopeCompanyIds(principal, scope, 'ver_aprovacoes')
  const detail = await loadScopedApprovalDetail(principal, instanceId, companyIds)
  return projectCorporateApprovalDetail(detail, principal.user.id)
}

export async function decideCompanyPortalApproval(
  principal: RequestPrincipal,
  instanceId: string,
  rawInput: unknown,
  scope: CompanyPortalScope = {},
): Promise<CorporateApprovalDetail> {
  const companyIds = resolveCompanyPortalScopeCompanyIds(principal, scope, 'decidir_aprovacoes')
  const input = approvalDecisionInputSchema.parse(rawInput)
  const current = await loadScopedApprovalDetail(principal, instanceId, companyIds)
  const replayAssignmentId = await findApprovalDecisionReplayAssignmentId(
    principal,
    instanceId,
    input.idempotencyKey,
    companyIds,
  )
  const target = findCorporateApprovalDecisionTarget(current, principal.user.id)
  const assignmentId = replayAssignmentId || target?.assignmentId
  if (!assignmentId) {
    throw new ApprovalServiceError(
      'COMPANY_PORTAL_APPROVAL_DECISION_NOT_ASSIGNED',
      'Esta aprovação não aguarda uma decisão deste usuário.',
      403,
    )
  }
  const updated = await decideApprovalAssignment(
    principal,
    assignmentId,
    input,
    { allowedCompanyIds: companyIds },
  )
  if (!updated.companyId || !companyIds.includes(updated.companyId)) throw companyPortalApprovalNotFound()
  return projectCorporateApprovalDetail(updated, principal.user.id)
}

async function loadScopedApprovalDetail(
  principal: RequestPrincipal,
  instanceId: string,
  companyIds: readonly string[],
) {
  try {
    const detail = await getApprovalInstanceDetail(principal, instanceId)
    if (!detail.companyId || !companyIds.includes(detail.companyId)) throw companyPortalApprovalNotFound()
    return detail
  } catch (error) {
    if (
      error instanceof CorporateAccessDeniedError
      || (error instanceof ApprovalServiceError && error.status === 403)
    ) throw companyPortalApprovalNotFound()
    throw error
  }
}

function companyPortalApprovalNotFound(): ApprovalServiceError {
  return new ApprovalServiceError(
    'APPROVAL_INSTANCE_NOT_FOUND',
    'Aprovacao nao encontrada.',
    404,
  )
}

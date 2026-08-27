import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  approvalDecisionReplayMatches,
  assertApprovalDecisionCompanyScope,
} from '@/lib/server/approval-service'
import {
  resolveCompanyPortalScopeCompanyIds,
  resolveCompanyPortalScopeCompanyIdsWithAnyPermission,
} from '@/lib/server/company-portal-scope-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { CorporateAccessSummary, Permissoes, User } from '@/types'

describe('company portal approval and voucher scope', () => {
  it('accepts only an exact authorized company or consolidated group context', () => {
    const principal = corporatePrincipal()

    expect(resolveCompanyPortalScopeCompanyIds(principal, {
      scopeType: 'group',
      scopeId: 'group-a',
    }, 'ver_aprovacoes')).toEqual(['company-a', 'company-b'])
    expect(resolveCompanyPortalScopeCompanyIds(principal, {
      scopeType: 'company',
      scopeId: 'company-c',
    }, 'ver_aprovacoes')).toEqual(['company-c'])
    expect(() => resolveCompanyPortalScopeCompanyIds(principal, {
      scopeType: 'group',
      scopeId: 'group-a+group-b',
    }, 'ver_aprovacoes')).toThrowError(expect.objectContaining({
      code: 'COMPANY_PORTAL_CONTEXT_SCOPE_DENIED',
    }))
  })

  it('uses the corporate default context and filters it by resource permission', () => {
    const principal = corporatePrincipal({
      companies: companyAccess({
        'company-a': { ver_vouchers: true },
        'company-b': { ver_vouchers: false },
        'company-c': { ver_vouchers: true },
      }),
    })

    expect(resolveCompanyPortalScopeCompanyIds(principal, {}, 'ver_vouchers'))
      .toEqual(['company-a'])
    expect(() => resolveCompanyPortalScopeCompanyIds(principal, {
      scopeType: 'company',
      scopeId: 'company-b',
    }, 'ver_vouchers')).toThrowError(expect.objectContaining({
      code: 'COMPANY_PORTAL_SCOPE_EMPTY',
    }))
  })

  it('fails closed when a corporate session has no authorized context', () => {
    const principal = corporatePrincipal({ defaultContext: null, contexts: [] })
    expect(() => resolveCompanyPortalScopeCompanyIds(principal, {}, 'ver_aprovacoes'))
      .toThrowError(expect.objectContaining({ code: 'COMPANY_PORTAL_CONTEXT_SCOPE_DENIED' }))
  })

  it('can resolve one exact context against any of several explicit permissions', () => {
    const principal = corporatePrincipal({
      companies: companyAccess({
        'company-a': { ver_demandas: true, criar_demandas: false },
        'company-b': { ver_demandas: false, criar_demandas: true },
        'company-c': { ver_demandas: false, criar_demandas: false },
      }),
    })
    expect(resolveCompanyPortalScopeCompanyIdsWithAnyPermission(
      principal,
      { scopeType: 'group', scopeId: 'group-a' },
      ['ver_demandas', 'criar_demandas'],
    )).toEqual(['company-a', 'company-b'])
    expect(() => resolveCompanyPortalScopeCompanyIdsWithAnyPermission(
      principal,
      { scopeType: 'group', scopeId: 'group-a' },
      [],
    )).toThrowError(expect.objectContaining({ code: 'COMPANY_PORTAL_PERMISSION_SCOPE_INVALID' }))
  })

  it('applies selected company ids as an AND over approval visibility and voucher ownership', () => {
    const approvalCore = source('lib/server/approval-service.ts')
    const voucherCore = source('lib/server/voucher-service.ts')
    const approvalBoundary = source('lib/server/company-portal-approval-service.ts')
    const voucherBoundary = source('lib/server/company-portal-voucher-service.ts')

    expect(approvalCore).toContain('instance.company_id = any($${values.length}::text[])')
    expect(approvalCore).toContain("await requireCompanyAccess(principal, companyId, 'ver_aprovacoes')")
    expect(approvalCore).toContain("'APPROVAL_COMPANY_SCOPE_EMPTY'")
    expect(approvalCore).toContain("requesterApprovalOwnershipSql('instance', '$3')")
    expect(approvalCore).toContain('requester_owned_demand.company_id = ${instanceAlias}.company_id')
    expect(approvalCore).toContain('requester_owned_demand.deleted_at is null')
    expect(approvalCore).toContain("subject_snapshot ->> 'companyId' = ${instanceAlias}.company_id")
    expect(voucherCore).toContain('voucher.company_id = any($2::text[])')
    expect(voucherCore).toContain('requesterOwnVoucherExistsSql(')
    expect(voucherCore).toContain("'VOUCHER_COMPANY_SCOPE_EMPTY'")
    expect(voucherBoundary).toContain('resolveCompanyPortalScopeCompanyIds')
    expect(voucherBoundary).toContain('bootstrapLegacy: false')
    expect(voucherCore).toContain('filters.bootstrapLegacy === false')
    expect(voucherCore).toContain('options.bootstrapLegacy === false')
    expect(approvalBoundary).toContain('resolveCompanyPortalScopeCompanyIds')
  })

  it('returns not found for details outside the selected context and scopes decisions before assignment', () => {
    const approvalBoundary = source('lib/server/company-portal-approval-service.ts')
    const voucherBoundary = source('lib/server/company-portal-voucher-service.ts')
    const decisionBoundary = approvalBoundary.slice(
      approvalBoundary.indexOf('export async function decideCompanyPortalApproval'),
    )

    expect(approvalBoundary).toContain("'APPROVAL_INSTANCE_NOT_FOUND'")
    expect(decisionBoundary.indexOf("'decidir_aprovacoes'"))
      .toBeLessThan(decisionBoundary.indexOf('findCorporateApprovalDecisionTarget'))
    expect(approvalBoundary).toContain('!companyIds.includes(detail.companyId)')
    expect(voucherBoundary).toContain("'VOUCHER_NOT_FOUND'")
    expect(voucherBoundary).toContain('!companyIds.includes(voucher.empresa_id)')
  })

  it('rejects a company-B decision through context A before any mutation', () => {
    expect(() => assertApprovalDecisionCompanyScope('company-b', ['company-a']))
      .toThrowError(expect.objectContaining({
        code: 'APPROVAL_INSTANCE_NOT_FOUND',
        status: 404,
      }))
    expect(() => assertApprovalDecisionCompanyScope('company-a', ['company-a']))
      .not.toThrow()

    const approvalCore = source('lib/server/approval-service.ts')
    const decisionCore = approvalCore.slice(
      approvalCore.indexOf('export async function decideApprovalAssignment'),
      approvalCore.indexOf('export function assertApprovalDecisionCompanyScope'),
    )
    expect(decisionCore.indexOf('assertApprovalDecisionCompanyScope(instance.company_id'))
      .toBeLessThan(decisionCore.indexOf('insert into approval_decisions'))
    expect(source('lib/server/company-portal-approval-service.ts'))
      .toContain('{ allowedCompanyIds: companyIds }')
  })

  it('replays a committed decision after the first response is lost without another mutation', () => {
    const input = {
      decision: 'approved' as const,
      reason: 'Viagem autorizada',
      expectedStepVersion: 4,
      idempotencyKey: 'company-portal-replay-key',
      confirmation: true as const,
    }
    const actor = {
      actorUserId: 'user-approver',
      actingForUserId: null,
      source: 'human' as const,
      representation: null,
    }
    const committed = {
      assignment_id: 'assignment-1',
      decision: 'approved',
      reason: 'Viagem autorizada',
      decided_by_user_id: 'user-approver',
      acting_for_user_id: null,
      decision_source: 'human',
      impersonation_id: null,
      decision_snapshot: {
        expectedStepVersion: 4,
        confirmation: true,
        representationId: null,
      },
    }
    expect(approvalDecisionReplayMatches(committed, {
      assignmentId: 'assignment-1',
      input,
      actor,
    })).toBe(true)
    expect(approvalDecisionReplayMatches(committed, {
      assignmentId: 'assignment-1',
      input: { ...input, reason: 'Payload diferente' },
      actor,
    })).toBe(false)

    const approvalCore = source('lib/server/approval-service.ts')
    const decisionCore = approvalCore.slice(
      approvalCore.indexOf('export async function decideApprovalAssignment'),
      approvalCore.indexOf('export async function findApprovalDecisionReplayAssignmentId'),
    )
    const replayLookup = decisionCore.indexOf('from approval_decisions')
    expect(replayLookup).toBeGreaterThan(0)
    expect(replayLookup).toBeLessThan(decisionCore.indexOf('validateAndLockApprovalActionToken'))
    expect(replayLookup).toBeLessThan(decisionCore.indexOf("Number(step.version) !== input.expectedStepVersion"))
    expect(replayLookup).toBeLessThan(decisionCore.indexOf('insert into approval_decisions'))
    expect(decisionCore).toContain('if (!replayed)')

    const portalBoundary = source('lib/server/company-portal-approval-service.ts')
    expect(portalBoundary.indexOf('findApprovalDecisionReplayAssignmentId'))
      .toBeLessThan(portalBoundary.indexOf('findCorporateApprovalDecisionTarget(current'))
    expect(portalBoundary).toContain('const assignmentId = replayAssignmentId || target?.assignmentId')
  })

  it('sends the exact context through every BFF route and ignores stale UI responses', () => {
    for (const path of [
      'app/api/company-portal/approvals/route.ts',
      'app/api/company-portal/approvals/[id]/route.ts',
      'app/api/company-portal/approvals/[id]/decision/route.ts',
      'app/api/company-portal/vouchers/route.ts',
      'app/api/company-portal/vouchers/[id]/route.ts',
    ]) {
      const route = source(path)
      expect(route).toContain('scopeType')
      expect(route).toContain('scopeId')
      expect(route).toContain('Boolean(query.scopeType) === Boolean(query.scopeId)')
      expect(route).toContain('runInApiGuardContext')
    }

    const approvals = source('components/company-portal-lab/corporate-approvals-section.tsx')
    const approvalPanel = source('components/company-portal-lab/corporate-demand-approval-panel.tsx')
    const vouchers = source('components/company-portal-lab/corporate-vouchers-section.tsx')
    const voucherWorkspace = source('components/company-portal-lab/air-voucher-workspace.tsx')
    expect(approvals).toContain('contextKeyRef.current')
    expect(approvals).toContain('detailRequestSequence.current')
    expect(approvalPanel).toContain('requestSequence.current')
    expect(vouchers).toContain('contextKeyRef.current')
    expect(vouchers).toContain('controller.abort()')
    expect(voucherWorkspace).toContain('{ ...scope, companyId, demandId, limit: 20 }')
  })
})

function corporatePrincipal(accessOverrides: Partial<CorporateAccessSummary> = {}): RequestPrincipal {
  const access: CorporateAccessSummary = {
    tenantWide: false,
    companyIds: ['company-a', 'company-b', 'company-c'],
    groupIds: ['group-a', 'group-b'],
    companies: companyAccess(),
    groups: [
      { groupId: 'group-a', groupName: 'Grupo A', companyIds: ['company-a', 'company-b'], canViewConsolidated: true, accessModes: ['all_companies'], profiles: ['manager'] },
      { groupId: 'group-b', groupName: 'Grupo B', companyIds: ['company-c'], canViewConsolidated: true, accessModes: ['all_companies'], profiles: ['manager'] },
    ],
    contexts: [
      { type: 'group', id: 'group-a', label: 'Grupo A', groupId: 'group-a', companyIds: ['company-a', 'company-b'], canViewConsolidated: true },
      { type: 'group', id: 'group-b', label: 'Grupo B', groupId: 'group-b', companyIds: ['company-c'], canViewConsolidated: true },
      { type: 'company', id: 'company-a', label: 'Empresa A', groupId: 'group-a', companyIds: ['company-a'], canViewConsolidated: false },
      { type: 'company', id: 'company-b', label: 'Empresa B', groupId: 'group-a', companyIds: ['company-b'], canViewConsolidated: false },
      { type: 'company', id: 'company-c', label: 'Empresa C', groupId: 'group-b', companyIds: ['company-c'], canViewConsolidated: false },
    ],
    defaultContext: { type: 'group', id: 'group-a' },
    refreshedAt: '2026-08-17T12:00:00.000Z',
    ...accessOverrides,
  }
  const user: User = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'manager@example.com',
    name: 'Corporate manager',
    role: 'company_admin',
    role_key: 'company_admin',
    company_id: 'company-a',
    corporate_profile: 'manager',
    corporate_access: access,
  }
  return {
    tenantId: 'tenant-a',
    roleKey: 'company_admin',
    platformAdmin: false,
    corporateAccess: access,
    user,
  } as RequestPrincipal
}

function companyAccess(overrides: Record<string, Partial<Permissoes>> = {}) {
  return [
    ['company-a', 'Empresa A', 'group-a', 'Grupo A'],
    ['company-b', 'Empresa B', 'group-a', 'Grupo A'],
    ['company-c', 'Empresa C', 'group-b', 'Grupo B'],
  ].map(([companyId, companyName, groupId, groupName]) => ({
    companyId,
    companyName,
    groupId,
    groupName,
    sources: ['group_all' as const],
    profiles: ['manager' as const],
    permissions: permissionsForCorporateProfile('manager', {
      ver_aprovacoes: true,
      decidir_aprovacoes: true,
      ver_vouchers: true,
      ...overrides[companyId],
    }),
  }))
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

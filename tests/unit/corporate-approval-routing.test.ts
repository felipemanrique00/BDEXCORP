import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  approvalMatrixInputSchema,
  approvalMatrixTransitionSchema,
} from '@/lib/approvals/admin-schema'
import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  approvalMatrixRuleSlotKey,
  assertGenericApprovalWorkflowCodeAllowed,
  createApprovalAuthority,
  hasExplicitCorporateCompanyPermission,
  hasExplicitCorporateGroupAllPermission,
  isCorporateApprovalMembershipEligible,
  loadCanonicalApprovalSubjectContext,
  mergeCanonicalApprovalSubjectConflicts,
} from '@/lib/server/approval-service'
import { assertGenericPolicyCodeAllowed } from '@/lib/server/policy-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { CorporateAccessSummary } from '@/types'

const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`

function authority(level: 1 | 2, membershipId: string) {
  return {
    membershipId,
    approvalKind: level === 1 ? 'cost' as const : 'second_level' as const,
    companyId: 'company-a',
    approvalLevel: level,
    validFrom: '2026-08-26T12:00:00.000Z',
    justification: 'Parametrizacao corporativa revisada.',
  }
}

describe('corporate approval routing contract', () => {
  it('defines the corporate approver profile without agency operating permissions', () => {
    const permissions = permissionsForCorporateProfile('approver', {})
    expect(permissions.decidir_aprovacoes).toBe(true)
    expect(permissions.ver_aprovacoes).toBe(true)
    expect(permissions.operar_cotacoes).toBe(false)
    expect(permissions.operar_emissoes).toBe(false)
  })

  it.each(['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator'])(
    'rejects internal role %s even if an explicit corporate grant exists',
    (roleKey) => {
      expect(isCorporateApprovalMembershipEligible({
        roleKey,
        platformAdmin: false,
        tenantWide: false,
      })).toBe(false)
    },
  )

  it('rejects the same membership in level one and level two', () => {
    const membershipId = uuid('1')
    const parsed = approvalMatrixInputSchema.safeParse({
      scope: { type: 'company', companyId: 'company-a' },
      stage: 'cost',
      authorities: [authority(1, membershipId), authority(2, membershipId)],
      workflow: {
        name: 'Matriz de custo corporativa',
        description: 'Fluxo corporativo de autorizacao de custo.',
        changeSummary: 'Cria matriz com dois niveis.',
      },
    })
    expect(parsed.success).toBe(false)
  })

  it('reserves canonical matrix workflow and policy namespaces for governed services', () => {
    expect(() => assertGenericApprovalWorkflowCodeAllowed('travel.cost.default')).not.toThrow()
    expect(() => assertGenericPolicyCodeAllowed('travel.cost.trigger')).not.toThrow()
    expect(() => assertGenericApprovalWorkflowCodeAllowed('matrix.cost.company.abc')).toThrowError(
      expect.objectContaining({ code: 'APPROVAL_MATRIX_WORKFLOW_RESERVED', status: 409 }),
    )
    expect(() => assertGenericPolicyCodeAllowed('matrix.trigger.cost.company.abc')).toThrowError(
      expect.objectContaining({ code: 'POLICY_MATRIX_NAMESPACE_RESERVED', status: 409 }),
    )
  })

  it('keeps cap, membership and validity changes in the same governed rule slot', () => {
    const base = approvalMatrixInputSchema.parse({
      scope: { type: 'company', companyId: 'company-a' },
      stage: 'cost',
      authorities: [{
        ...authority(1, uuid('1')),
        maxAmount: 100_000,
        currency: 'brl',
        products: ['hotel', 'air'],
      }],
      workflow: {
        name: 'Matriz de custo corporativa',
        description: 'Fluxo corporativo de autorizacao de custo.',
        changeSummary: 'Cria regra inicial de custo.',
      },
    })
    const tightened = approvalMatrixInputSchema.parse({
      ...base,
      authorities: [{
        ...base.authorities[0],
        membershipId: uuid('2'),
        maxAmount: 10_000,
        validUntil: '2027-08-26T12:00:00.000Z',
        products: ['air', 'hotel'],
      }],
    })

    expect(approvalMatrixRuleSlotKey(tightened)).toBe(approvalMatrixRuleSlotKey(base))
  })

  it('keeps different organizational predicates in independent rule slots', () => {
    const base = {
      scope: { type: 'company' as const, companyId: 'company-a' },
      stage: 'cost' as const,
      workflow: {
        name: 'Matriz de custo corporativa',
        description: 'Fluxo corporativo de autorizacao de custo.',
        changeSummary: 'Cria regra segmentada de custo.',
      },
    }
    const inputs = [
      { costCenterId: uuid('2') },
      { projectId: uuid('3') },
      { department: 'Financeiro' },
      { audienceGroupId: uuid('4') },
    ].map((scope, index) => approvalMatrixInputSchema.parse({
      ...base,
      authorities: [{ ...authority(1, uuid(String(index + 5))), ...scope }],
    }))

    expect(new Set(inputs.map(approvalMatrixRuleSlotKey))).toHaveProperty('size', 4)
  })

  it('rejects packing different first-level predicates into one matrix draft', () => {
    const input = approvalMatrixInputSchema.parse({
      scope: { type: 'company', companyId: 'company-a' },
      stage: 'cost',
      authorities: [
        { ...authority(1, uuid('1')), costCenterId: uuid('2') },
        { ...authority(1, uuid('3')), costCenterId: uuid('4') },
      ],
      workflow: {
        name: 'Matriz de custo corporativa',
        description: 'Fluxo corporativo de autorizacao de custo.',
        changeSummary: 'Tenta combinar dois recortes.',
      },
    })

    expect(() => approvalMatrixRuleSlotKey(input)).toThrowError(expect.objectContaining({
      code: 'APPROVAL_MATRIX_MULTIPLE_RULE_SLOTS',
      status: 422,
    }))
  })

  it('accepts stage-bound level two and the legacy input alias', () => {
    const base = {
      scope: { type: 'company' as const, companyId: 'company-a' },
      stage: 'cost' as const,
      workflow: {
        name: 'Matriz de custo corporativa',
        description: 'Fluxo corporativo de autorizacao de custo.',
        changeSummary: 'Cria matriz com dois niveis.',
      },
    }
    expect(approvalMatrixInputSchema.safeParse({
      ...base,
      authorities: [authority(1, uuid('1')), { ...authority(2, uuid('2')), approvalKind: 'cost' }],
    }).success).toBe(true)
    expect(approvalMatrixInputSchema.safeParse({
      ...base,
      authorities: [authority(1, uuid('1')), authority(2, uuid('2'))],
    }).success).toBe(true)
  })

  it.each(['merit', 'cost'] as const)(
    'requires the governed matrix endpoint for direct %s authorities',
    async (approvalKind) => {
      await expect(createApprovalAuthority({} as RequestPrincipal, {
        ...authority(1, uuid('4')),
        approvalKind,
      })).rejects.toMatchObject({
        code: 'APPROVAL_MATRIX_REQUIRED_FOR_TRAVEL_AUTHORITY',
        status: 409,
      })
    },
  )

  it('requires selected companies and a maker-checker transition version', () => {
    expect(approvalMatrixInputSchema.safeParse({
      scope: { type: 'business_group', businessGroupId: 'group-a', mode: 'selected_companies', companyIds: [] },
      stage: 'cost',
      authorities: [authority(1, uuid('2'))],
      workflow: {
        name: 'Matriz de custo corporativa',
        description: 'Fluxo corporativo de autorizacao de custo.',
        changeSummary: 'Cria matriz para grupo.',
      },
    }).success).toBe(false)
    expect(approvalMatrixTransitionSchema.safeParse({
      action: 'approve',
      expectedVersion: 0,
      reason: 'Revisao independente da matriz.',
    }).success).toBe(false)
  })

  it('keeps migration compatibility, tenant isolation and draft activation gates', () => {
    const sql = fs.readFileSync(path.resolve(
      process.cwd(),
      'deploy/postgres/migrations/0085_corporate_approval_routing.sql',
    ), 'utf8')
    expect(sql).toContain("'approver'")
    expect(sql).toContain("status in ('draft', 'scheduled', 'active', 'suspended', 'revoked', 'expired')")
    expect(sql).toMatch(/set approval_level = 2\s+where approval_kind = 'second_level'/i)
    expect(sql).toContain('coalesce(max_amount, -1)')
    expect(sql).toContain('coalesce(accumulated_amount_limit, -1)')
    expect(sql).toContain('approval_approver_groups')
    expect(sql).toContain('approval_audience_groups')
    expect(sql).toContain('approval_matrices')
    expect(sql).toContain('rule_slot_key')
    expect(sql).toContain('approval_matrices_published_rule_slot_uidx')
    expect(sql).toContain('alter table approval_matrices force row level security')
    expect(sql).toContain('corporate_user_can_decide_for_company')
    expect(sql).toContain('corporate_user_has_company_access')
  })

  it('exposes atomic matrix, inherited rule, group and contextual candidate APIs', () => {
    const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')
    expect(read('app/api/approvals/matrices/route.ts')).toContain('createApprovalMatrixDraft')
    expect(read('app/api/approvals/matrices/[id]/transition/route.ts')).toContain('transitionApprovalMatrix')
    expect(read('app/api/approvals/authorities/route.ts')).toContain('includeInherited')
    expect(read('app/api/approvals/audience-groups/route.ts')).toContain('createApprovalAudienceGroup')
    expect(read('app/api/approvals/approver-groups/route.ts')).toContain('createApprovalApproverGroup')
    const candidatesRoute = read('app/api/approvals/candidates/route.ts')
    expect(candidatesRoute).toContain('listApprovalCandidates')
    expect(candidatesRoute).toContain('companyIds')
  })

  it('requires actor and approvers to cover every company in a group matrix', () => {
    const source = fs.readFileSync(path.resolve(
      process.cwd(),
      'lib/server/approval-service.ts',
    ), 'utf8')
    expect(source).toContain("requireCompanyAccess(principal, companyId, 'gerenciar_workflows')")
    expect(source).toContain('APPROVAL_MATRIX_APPROVER_SCOPE_INCOMPLETE')
    expect(source).toContain('nao aceita recorte oculto por autoridade')
  })

  it('does not treat current selected-company coverage as an all-companies grant', () => {
    const permissions = permissionsForCorporateProfile('approver', {})
    const access: CorporateAccessSummary = {
      tenantWide: false,
      companyIds: ['company-a', 'company-b'],
      groupIds: ['group-a'],
      companies: ['company-a', 'company-b'].map((companyId) => ({
        companyId,
        companyName: companyId,
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_selected'],
        profiles: ['approver'],
        permissions,
        delegationAuthorities: [{
          sourceId: 'selected-grant',
          source: 'group',
          profile: 'approver',
          permissions,
          companyIds: ['company-a', 'company-b'],
          accessMode: 'selected_companies',
          canViewConsolidated: false,
        }],
      })),
      groups: [{
        groupId: 'group-a',
        groupName: 'Grupo A',
        companyIds: ['company-a', 'company-b'],
        canViewConsolidated: false,
        accessModes: ['selected_companies'],
        profiles: ['approver'],
        delegationAuthorities: [{
          sourceId: 'selected-grant',
          source: 'group',
          profile: 'approver',
          permissions,
          companyIds: ['company-a', 'company-b'],
          accessMode: 'selected_companies',
          canViewConsolidated: false,
        }],
      }],
      contexts: [],
      defaultContext: null,
      refreshedAt: new Date(0).toISOString(),
    }

    expect(hasExplicitCorporateCompanyPermission(access, 'company-a', 'decidir_aprovacoes')).toBe(true)
    expect(hasExplicitCorporateGroupAllPermission(access, 'group-a', 'decidir_aprovacoes')).toBe(false)
    access.groups[0].delegationAuthorities![0].accessMode = 'all_companies'
    expect(hasExplicitCorporateGroupAllPermission(access, 'group-a', 'decidir_aprovacoes')).toBe(true)
  })

  it('unions canonical actors with caller exclusions instead of trusting omissions', () => {
    const merged = mergeCanonicalApprovalSubjectConflicts({
      conflictedUserIds: [uuid('1')],
      lastEditorUserId: uuid('2'),
      assistedActorUserId: uuid('3'),
    }, {
      realActorUserId: uuid('4'),
      representationActorUserId: uuid('5'),
      representationSubjectUserId: uuid('6'),
      demandCreatedByUserId: uuid('7'),
      demandUpdatedByUserId: uuid('8'),
      travelerUserIds: [uuid('9')],
    })

    expect(merged.lastEditorUserId).toBe(uuid('8'))
    expect(merged.assistedActorUserId).toBe(uuid('5'))
    expect(merged.conflictedUserIds).toEqual(expect.arrayContaining([
      uuid('1'), uuid('2'), uuid('3'), uuid('4'), uuid('5'), uuid('6'), uuid('7'), uuid('8'), uuid('9'),
    ]))
  })

  it('derives every linked demand traveler as a canonical conflict', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    expect(source).toContain('from demand_travelers traveler')
    expect(source).toContain('requester.employee_id = traveler_employee.employee_id')
    expect(source).toContain('travelerUserIds,')
  })

  it('includes an active secondary employee without requester or login in canonical audience groups', async () => {
    const primaryEmployeeId = 'employee-primary'
    const secondaryEmployeeId = 'employee-secondary'
    const primaryUserId = uuid('1')
    const audienceGroupId = uuid('2')
    const query = vi.fn(async (statement: string, values?: unknown[]) => {
      if (statement.includes('from demands demand')) {
        return { rowCount: 1, rows: [{
          employee_id: primaryEmployeeId,
          requester_id: 'requester-primary',
          employee_department: 'Financeiro',
          requester_department: null,
          demand_cost_center_id: null,
          employee_cost_center_id: null,
          requester_cost_center_id: null,
          requester_user_id: primaryUserId,
          demand_created_by: null,
          demand_updated_by: null,
        }] }
      }
      if (statement.includes('with traveler_employee_candidates')) {
        return { rowCount: 2, rows: [
          { employee_id: primaryEmployeeId, user_id: primaryUserId, is_primary: true },
          { employee_id: secondaryEmployeeId, user_id: null, is_primary: false },
        ] }
      }
      if (statement.includes('from approval_audience_groups audience_group')) {
        expect(values?.[2]).toEqual([primaryEmployeeId, secondaryEmployeeId])
        return { rowCount: 1, rows: [{ id: audienceGroupId }] }
      }
      throw new Error(`Consulta inesperada no teste: ${statement}`)
    })
    const principal = {
      tenantId: uuid('3'),
      user: { id: uuid('4') },
    } as unknown as RequestPrincipal

    const result = await loadCanonicalApprovalSubjectContext(
      { query } as never,
      principal,
      {
        workflowCode: 'matrix.cost.company.test',
        companyId: 'company-a',
        demandId: 'demand-a',
        instanceType: 'cost',
        subject: {},
        idempotencyKey: 'audience-secondary-employee',
      },
      {},
    )

    expect(result.audienceGroupIds).toEqual([audienceGroupId])
    expect(result.requesterUserId).toBe(primaryUserId)
    expect(result.travelerUserId).toBe(primaryUserId)
    expect(result.conflictedUserIds).toContain(primaryUserId)
  })

  it('passes an empty UUID array when a demand has no requester or traveler user', async () => {
    const employeeId = 'employee-without-login'
    const query = vi.fn(async (statement: string, values?: unknown[]) => {
      if (statement.includes('from demands demand')) {
        return { rowCount: 1, rows: [{
          employee_id: employeeId,
          requester_id: null,
          employee_department: null,
          requester_department: null,
          demand_cost_center_id: null,
          employee_cost_center_id: null,
          requester_cost_center_id: null,
          requester_user_id: null,
          demand_created_by: null,
          demand_updated_by: null,
        }] }
      }
      if (statement.includes('with traveler_employee_candidates')) {
        return { rowCount: 1, rows: [
          { employee_id: employeeId, user_id: null, is_primary: true },
        ] }
      }
      if (statement.includes('from approval_audience_groups audience_group')) {
        expect(values?.[4]).toEqual([])
        expect(values?.[4]).not.toContain('')
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Consulta inesperada no teste: ${statement}`)
    })
    const principal = {
      tenantId: uuid('3'),
      user: { id: uuid('4') },
    } as unknown as RequestPrincipal

    const result = await loadCanonicalApprovalSubjectContext(
      { query } as never,
      principal,
      {
        workflowCode: 'matrix.cost.company.test',
        companyId: 'company-a',
        demandId: 'demand-without-login',
        instanceType: 'cost',
        subject: {},
        idempotencyKey: 'audience-without-user',
      },
      {},
    )

    expect(result.audienceGroupIds).toEqual([])
    expect(result.requesterUserId).toBeUndefined()
    expect(result.travelerUserId).toBeUndefined()
  })

  it('locks and revalidates corporate targets before matrix publication', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    const migration = fs.readFileSync(path.resolve(
      process.cwd(),
      'deploy/postgres/migrations/0085_corporate_approval_routing.sql',
    ), 'utf8')
    expect(source).toContain('lockCorporateApprovalTargetGrants')
    expect(source).toContain("for update of membership, user_row")
    expect(source).toContain('APPROVAL_AUTHORITY_TARGET_INTERNAL')
    expect(source).toContain('requireDecisionInEveryCompany')
    expect(source).toContain('hasExplicitCorporateCompanyPermission')
    expect(migration).toContain('corporate_user_can_decide_for_group_all')
    expect(migration).toContain("role_row.role_key not in ('tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator')")
    expect(migration).toContain('update of membership_id, approval_kind, approval_level, company_id, group_id, audience_group_id, status')
  })

  it('keeps canonical group scope immutable after a matrix is archived', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    const start = source.indexOf('async function assertCompatibleCanonicalMatrixScope')
    const end = source.indexOf('function matrixWorkflowScopes', start)
    const helper = source.slice(start, end)
    expect(helper).not.toContain("status <> 'archived'")
    expect(helper).toContain('APPROVAL_MATRIX_SCOPE_VERSION_REQUIRED')
  })

  it('serializes publication and fails closed for a second published matrix in the same slot', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    expect(source).toContain('pg_advisory_xact_lock(hashtextextended($1, 0))')
    expect(source).toContain("rule_slot_key = $2 and id <> $3 and status = 'published'")
    expect(source).toContain('APPROVAL_MATRIX_REVISION_REQUIRED')
  })

  it('requires provenance and canonical shape before reusing reserved artifacts', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    expect(source).toContain('assertCanonicalMatrixWorkflowReuse')
    expect(source).toContain('APPROVAL_MATRIX_CANONICAL_WORKFLOW_COLLISION')
    expect(source).toContain('matrixWorkflowShapeHash')
    expect(source).toContain('assertCanonicalMatrixPolicyReuse')
    expect(source).toContain('APPROVAL_MATRIX_CANONICAL_POLICY_COLLISION')
    expect(source).toContain('matrix.workflow_definition_id = $2')
    expect(source).toContain('matrix.policy_definition_id = $2')
  })

  it('binds matrix level two to its stage and exposes all-companies candidate scope', () => {
    const service = fs.readFileSync(path.resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    const route = fs.readFileSync(path.resolve(process.cwd(), 'app/api/approvals/candidates/route.ts'), 'utf8')
    expect(service).toContain("? { ...template, approvalKind: input.stage }")
    expect(service).toContain("selectors: [{ type: 'authority', configuration: { level: 2 } }]")
    expect(route).toContain('businessGroupId')
    expect(route).toContain('allCompanies')
  })

  it('isolates matrix runtime authorities from ungoverned legacy rows', () => {
    const service = fs.readFileSync(path.resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    const migration = fs.readFileSync(path.resolve(
      process.cwd(),
      'deploy/postgres/migrations/0085_corporate_approval_routing.sql',
    ), 'utf8')
    expect(service).toContain("const matrixWorkflow = workflow.code.startsWith('matrix.')")
    expect(service).toContain('not $4::boolean')
    expect(service).toContain("matrix.status = 'published'")
    expect(service).toContain('matrix.stage = $3')
    expect(service).toContain('approval_authorities.id = any(matrix.authority_ids)')
    expect(service).toContain('APPROVAL_MATRIX_AUTHORITY_MANAGED')
    expect(migration).toContain("new.approval_kind in ('merit', 'cost')")
    expect(migration).toContain("matrix.status in ('approved', 'published')")
  })

  it('keeps governed group fallback outside a company cost-center override', () => {
    const service = fs.readFileSync(path.resolve(process.cwd(), 'lib/server/approval-service.ts'), 'utf8')
    expect(service).toContain("matrix.root_scope_type = 'company' and matrix.company_id = $5")
    expect(service).toContain("matrix.root_scope_type = 'business_group'")
    expect(service).toContain('matrix.business_group_id = $6')
    expect(service).toContain("matrix.access_mode = 'all_companies'")
    expect(service).toContain('$5 = any(matrix.selected_company_ids)')
    expect(service).toContain('.filter((authority) => authorityApplies(authority, subject))')
  })
})

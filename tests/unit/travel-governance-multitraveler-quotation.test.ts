import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PolicyEvaluationResult, PolicyResultItem } from '@/lib/policy'
import { policyResultsRequireSecondLevel } from '@/lib/approvals/policy-routing'

const mocks = vi.hoisted(() => ({
  createApprovalInstance: vi.fn(),
  evaluatePolicy: vi.fn(),
  persistTransition: vi.fn(),
  query: vi.fn(),
  requireCompanyAccess: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: async (
    _tenantId: string,
    operation: (client: { query: typeof mocks.query }) => unknown,
  ) => operation({ query: mocks.query }),
}))

vi.mock('@/lib/server/corporate-access-service', () => ({
  getAccessibleCompanyIds: vi.fn(),
  requireCompanyAccess: mocks.requireCompanyAccess,
  requireCompanySelectionAccess: vi.fn(),
  requireGroupAccess: vi.fn(),
}))

vi.mock('@/lib/server/approval-service', () => ({
  createApprovalInstance: mocks.createApprovalInstance,
  createTrustedApprovalInstance: mocks.createApprovalInstance,
}))

vi.mock('@/lib/server/policy-service', () => ({
  evaluateAndPersistPoliciesInTransaction: mocks.evaluatePolicy,
}))

vi.mock('@/lib/server/travel-lifecycle-persistence', () => ({
  persistTravelTransitionInTransaction: mocks.persistTransition,
}))

import {
  approvalPolicyIntentMatchesSnapshot,
  executeGovernedTravelQuote,
} from '@/lib/server/travel-governance-service'

describe('governed ground quotation policy coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCompanyAccess.mockResolvedValue(undefined)
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('from demands demand')) return { rows: [demand()] }
      if (sql.includes('from travel_provider_operations')) return { rows: [] }
      if (sql.includes('from policy_dependencies')) return { rows: [] }
      if (sql.includes('insert into travel_policy_justifications')) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected query: ${sql}`)
    })
  })

  it('blocks the bus quote when a secondary traveler is blocked at quotation', async () => {
    mocks.evaluatePolicy
      .mockResolvedValueOnce({ databaseEvaluationId: 'evaluation-primary', result: policyResult() })
      .mockResolvedValueOnce({
        databaseEvaluationId: 'evaluation-secondary',
        result: policyResult({
          passed: false,
          blocks: [policyItem({ policyCode: 'BUS-SECONDARY-BLOCK' })],
        }),
      })
    const provider = vi.fn()
    const loadPolicyTravelers = vi.fn().mockResolvedValue([
      traveler('traveler-primary', 'employee-primary', 'Compras', 'CC-1', 1),
      traveler('traveler-secondary', 'employee-secondary', 'Financeiro', 'CC-2', 2),
    ])

    await expect(executeGovernedTravelQuote(
      principal(),
      {
        demandId: 'demand-bus',
        empresaId: 'company-1',
        service: 'rodoviario',
        destino: 'Rio de Janeiro',
      },
      'bus-quotation-policy-1',
      provider,
      { provider: 'manual-offline', loadPolicyTravelers },
    )).rejects.toMatchObject({
      code: 'TRAVEL_POLICY_BLOCKED',
      status: 422,
      details: {
        blocks: [expect.objectContaining({ code: 'BUS-SECONDARY-BLOCK' })],
      },
    })

    expect(loadPolicyTravelers).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ query: mocks.query }),
      demand: expect.objectContaining({ id: 'demand-bus', company_id: 'company-1' }),
      request: expect.objectContaining({ service: 'rodoviario' }),
    }))
    expect(mocks.evaluatePolicy).toHaveBeenCalledTimes(2)
    expect(mocks.evaluatePolicy.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
      employeeId: 'employee-secondary',
      context: expect.objectContaining({
        scopes: expect.arrayContaining([
          { type: 'department', id: 'Financeiro' },
          { type: 'cost_center', id: 'CC-2' },
          { type: 'traveler', id: 'employee-secondary' },
        ]),
        facts: expect.objectContaining({
          employee: expect.objectContaining({ id: 'employee-secondary', department: 'Financeiro' }),
          traveler: expect.objectContaining({
            demandTravelerId: 'traveler-secondary',
            sequence: 2,
          }),
        }),
      }),
    }))
    expect(provider).not.toHaveBeenCalled()
  })

  it('persists every required justification and binds one approval to exact traveler coverage', async () => {
    const justification = policyItem({
      policyId: 'justification-policy',
      policyVersionId: 'justification-version',
      policyCode: 'BUS-JUSTIFY',
      action: 'require_justification',
    })
    const approval = policyItem({
      policyId: 'approval-policy',
      policyVersionId: 'approval-version',
      policyCode: 'BUS-SECONDARY-APPROVAL',
      action: 'request_approval',
      configuration: { workflow: 'bus-merit' },
    })
    mocks.evaluatePolicy
      .mockResolvedValueOnce({
        databaseEvaluationId: 'evaluation-primary',
        result: policyResult({ justificationsRequired: [justification] }),
      })
      .mockResolvedValueOnce({
        databaseEvaluationId: 'evaluation-secondary',
        result: policyResult({
          justificationsRequired: [{ ...justification, policyVersionId: 'justification-version-2' }],
          approvalsRequired: [approval],
        }),
      })
    mocks.createApprovalInstance.mockResolvedValue({ id: 'approval-1' })
    const travelers = [
      traveler('traveler-primary', 'employee-primary', 'Compras', 'CC-1', 1),
      traveler('traveler-secondary', 'employee-secondary', 'Financeiro', 'CC-2', 2),
    ]

    await expect(executeGovernedTravelQuote(
      principal(),
      {
        demandId: 'demand-bus',
        empresaId: 'company-1',
        service: 'rodoviario',
        policyJustification: 'Viagem essencial para ambos os passageiros.',
      },
      'bus-quotation-approval-1',
      vi.fn(),
      {
        provider: 'manual-offline',
        loadPolicyTravelers: async () => travelers,
      },
    )).rejects.toMatchObject({
      code: 'TRAVEL_APPROVAL_REQUIRED',
      status: 409,
      details: { approvalInstanceId: 'approval-1', workflowCode: 'bus-merit' },
    })

    const justificationWrites = mocks.query.mock.calls.filter(([sql]) => (
      String(sql).includes('insert into travel_policy_justifications')
    ))
    expect(justificationWrites).toHaveLength(2)
    expect(justificationWrites.map(([, values]) => (values as unknown[])[4])).toEqual([
      'evaluation-primary',
      'evaluation-secondary',
    ])
    expect(mocks.createApprovalInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workflowCode: 'bus-merit',
        subject: expect.objectContaining({
          offlinePolicyCoverageFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          offlinePolicyEvaluations: [
            expect.objectContaining({
              databaseEvaluationId: 'evaluation-primary',
              demandTravelerId: 'traveler-primary',
            }),
            expect.objectContaining({
              databaseEvaluationId: 'evaluation-secondary',
              demandTravelerId: 'traveler-secondary',
            }),
          ],
        }),
        idempotencyKey: expect.stringMatching(
          /^bus-quotation-approval-1:approval:bus-merit:[a-f0-9]{64}$/,
        ),
      }),
    )
  })

  it('supersedes stale coverage and rebinds the pending demand to a new approval', async () => {
    const approval = policyItem({
      policyId: 'approval-policy',
      policyVersionId: 'approval-version-new',
      policyCode: 'BUS-SECONDARY-APPROVAL',
      action: 'request_approval',
      configuration: { workflow: 'bus-merit' },
    })
    mocks.evaluatePolicy
      .mockResolvedValueOnce({ databaseEvaluationId: 'evaluation-primary-new', result: policyResult() })
      .mockResolvedValueOnce({
        databaseEvaluationId: 'evaluation-secondary-new',
        result: policyResult({ approvalsRequired: [approval] }),
      })
    mocks.createApprovalInstance.mockResolvedValue({ id: 'approval-new' })
    const state = { activeApprovalId: 'approval-old' as string | null }
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('from demands demand')) {
        return { rows: [{
          ...demand(),
          lifecycle_status: 'pending_merit_approval',
          active_approval_instance_id: state.activeApprovalId,
        }] }
      }
      if (sql.includes('from travel_provider_operations')) return { rows: [] }
      if (sql.includes('from approval_instances where tenant_id')) {
        return { rows: [{
          status: 'pending',
          instance_type: 'merit',
          demand_id: 'demand-bus',
          company_id: 'company-1',
          subject_snapshot: { offlinePolicyCoverageFingerprint: 'old-fingerprint' },
        }] }
      }
      if (sql.includes('update approval_instances set')) return { rows: [], rowCount: 1 }
      if (sql.includes('update approval_steps set')) return { rows: [], rowCount: 2 }
      if (sql.includes('update approval_assignments assignment')) return { rows: [], rowCount: 2 }
      if (sql.includes('update approval_escalations set')) return { rows: [], rowCount: 1 }
      if (sql.includes('update demands set active_approval_instance_id = null')) {
        state.activeApprovalId = null
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('insert into approval_events')) return { rows: [], rowCount: 1 }
      if (sql.includes('from policy_dependencies')) return { rows: [] }
      if (sql.includes('active_approval_instance_id = $3')) {
        state.activeApprovalId = String(values?.[2] || '')
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`Unexpected recovery query: ${sql}`)
    })

    await expect(executeGovernedTravelQuote(
      principal(),
      {
        demandId: 'demand-bus',
        empresaId: 'company-1',
        service: 'rodoviario',
      },
      'bus-quotation-recoverage-1',
      vi.fn(),
      {
        provider: 'manual-offline',
        loadPolicyTravelers: async () => [
          traveler('traveler-primary', 'employee-primary', 'Compras', 'CC-1', 1),
          traveler('traveler-secondary-new', 'employee-secondary', 'Financeiro', 'CC-2', 2),
        ],
      },
    )).rejects.toMatchObject({
      code: 'TRAVEL_APPROVAL_REQUIRED',
      details: { approvalInstanceId: 'approval-new' },
    })

    expect(state.activeApprovalId).toBe('approval-new')
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('update approval_steps set')))
      .toBe(true)
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('insert into approval_events')))
      .toBe(true)
    expect(mocks.createApprovalInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^bus-quotation-recoverage-1:approval:bus-merit:[a-f0-9]{64}$/,
        ),
      }),
    )
  })

  it('fails closed when stale approval supersession loses a concurrent race', async () => {
    const approval = policyItem({
      policyVersionId: 'approval-version-new',
      action: 'request_approval',
      configuration: { workflow: 'bus-merit' },
    })
    mocks.evaluatePolicy
      .mockResolvedValueOnce({ databaseEvaluationId: 'evaluation-primary', result: policyResult() })
      .mockResolvedValueOnce({
        databaseEvaluationId: 'evaluation-secondary',
        result: policyResult({ approvalsRequired: [approval] }),
      })
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('from demands demand')) {
        return { rows: [{
          ...demand(),
          lifecycle_status: 'pending_merit_approval',
          active_approval_instance_id: 'approval-old',
        }] }
      }
      if (sql.includes('from travel_provider_operations')) return { rows: [] }
      if (sql.includes('from approval_instances where tenant_id')) {
        return { rows: [{
          status: 'pending',
          instance_type: 'merit',
          demand_id: 'demand-bus',
          company_id: 'company-1',
          subject_snapshot: { offlinePolicyCoverageFingerprint: 'old-fingerprint' },
        }] }
      }
      if (sql.includes('update approval_instances set')) return { rows: [], rowCount: 0 }
      throw new Error(`Unexpected race query: ${sql}`)
    })
    const provider = vi.fn()

    await expect(executeGovernedTravelQuote(
      principal(),
      { demandId: 'demand-bus', empresaId: 'company-1', service: 'rodoviario' },
      'bus-quotation-recoverage-race-1',
      provider,
      {
        provider: 'manual-offline',
        loadPolicyTravelers: async () => [
          traveler('traveler-primary', 'employee-primary', 'Compras', 'CC-1', 1),
          traveler('traveler-secondary', 'employee-secondary', 'Financeiro', 'CC-2', 2),
        ],
      },
    )).rejects.toMatchObject({
      code: 'TRAVEL_APPROVAL_POLICY_COVERAGE_CHANGED',
      status: 409,
    })
    expect(mocks.createApprovalInstance).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })

  it('never accepts an approved merit instance linked to another demand', async () => {
    const approval = policyItem({
      policyVersionId: 'approval-version',
      action: 'request_approval',
      configuration: { workflow: 'bus-merit' },
    })
    mocks.evaluatePolicy
      .mockResolvedValueOnce({ databaseEvaluationId: 'evaluation-primary', result: policyResult() })
      .mockResolvedValueOnce({
        databaseEvaluationId: 'evaluation-secondary',
        result: policyResult({ approvalsRequired: [approval] }),
      })
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('from demands demand')) {
        return { rows: [{ ...demand(), active_approval_instance_id: 'approval-cross-demand' }] }
      }
      if (sql.includes('from travel_provider_operations')) return { rows: [] }
      if (sql.includes('from approval_instances where tenant_id')) {
        return { rows: [{
          status: 'approved',
          instance_type: 'merit',
          demand_id: 'another-demand',
          company_id: 'company-1',
          subject_snapshot: { offlinePolicyCoverageFingerprint: 'same-coverage-is-not-enough' },
        }] }
      }
      throw new Error(`Unexpected cross-demand query: ${sql}`)
    })
    const provider = vi.fn()

    await expect(executeGovernedTravelQuote(
      principal(),
      { demandId: 'demand-bus', empresaId: 'company-1', service: 'rodoviario' },
      'bus-quotation-cross-demand-1',
      provider,
      {
        provider: 'manual-offline',
        loadPolicyTravelers: async () => [
          traveler('traveler-primary', 'employee-primary', 'Compras', 'CC-1', 1),
          traveler('traveler-secondary', 'employee-secondary', 'Financeiro', 'CC-2', 2),
        ],
      },
    )).rejects.toMatchObject({
      code: 'TRAVEL_APPROVAL_SCOPE_MISMATCH',
      status: 409,
      details: { approvalInstanceId: 'approval-cross-demand' },
    })
    expect(mocks.createApprovalInstance).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })
})

describe('reservation approval intent reuse', () => {
  it('requires a new approval when the reservation now needs N2', () => {
    const reservationResult = policyResult({
      approvalsRequired: [policyItem({
        policyCode: 'matrix.trigger.cost.company.abc',
        action: 'request_approval',
      })],
      warnings: [policyItem({ policyCode: 'RESERVATION-EXCEPTION', action: 'warn' })],
    })
    const requiresSecondLevel = policyResultsRequireSecondLevel([reservationResult])
    expect(requiresSecondLevel).toBe(true)
    expect(approvalPolicyIntentMatchesSnapshot(
      { routing: { requiresSecondLevel: false } },
      'matrix.cost.company.abc',
      { workflowCode: 'matrix.cost.company.abc', requiresSecondLevel },
    )).toBe(false)
  })

  it('reuses an approval only for the same workflow and an equal-or-stronger level', () => {
    expect(approvalPolicyIntentMatchesSnapshot(
      { routing: { requiresSecondLevel: true } },
      'matrix.cost.company.abc',
      { workflowCode: 'matrix.cost.company.abc', requiresSecondLevel: false },
    )).toBe(true)
    expect(approvalPolicyIntentMatchesSnapshot(
      { routing: { requiresSecondLevel: true } },
      'matrix.cost.group.other',
      { workflowCode: 'matrix.cost.company.abc', requiresSecondLevel: true },
    )).toBe(false)
  })
})

function policyItem(overrides: Partial<PolicyResultItem> = {}): PolicyResultItem {
  return {
    policyId: 'policy-1',
    policyVersionId: 'policy-version-1',
    policyCode: 'POLICY-1',
    action: 'block',
    message: 'Operacao bloqueada.',
    configuration: {},
    ...overrides,
  }
}

function policyResult(overrides: Partial<PolicyEvaluationResult> = {}): PolicyEvaluationResult {
  return {
    passed: true,
    errors: [],
    warnings: [],
    justificationsRequired: [],
    approvalsRequired: [],
    blocks: [],
    requiredDocuments: [],
    requiredActions: [],
    applicablePolicies: [],
    policyVersions: [],
    alternatives: [],
    remediation: [],
    evaluationId: 'evaluation',
    factsHash: 'facts-hash',
    resultHash: 'result-hash',
    evaluatedAt: '2026-08-18T12:00:00.000Z',
    checkpoint: 'quotation',
    mode: 'enforce',
    decisions: [],
    ...overrides,
  }
}

function traveler(
  demandTravelerId: string,
  employeeId: string,
  department: string,
  costCenter: string,
  sequence: number,
) {
  return {
    demandTravelerId,
    employeeId,
    name: `Viajante ${sequence}`,
    document: `DOC-${sequence}`,
    email: `viajante${sequence}@example.com`,
    phone: null,
    jobTitle: null,
    department,
    costCenter,
    sequence,
  }
}

function demand() {
  return {
    id: 'demand-bus',
    tenant_id: 'tenant-1',
    company_id: 'company-1',
    group_id: 'group-1',
    company_name: 'Empresa Um',
    employee_id: 'employee-primary',
    requester_id: 'requester-1',
    assigned_to_user_id: null,
    demand_number: 'OS-2026-0001',
    service_type: 'rodoviario',
    passenger_name_snapshot: 'Viajante 1',
    status: 'pending',
    lifecycle_status: 'submitted',
    lifecycle_version: 1,
    last_policy_evaluation_id: null,
    active_approval_instance_id: null,
    priority: 'normal',
    travel_start_date: '2026-09-01',
    travel_end_date: '2026-09-01',
    destination: 'Rio de Janeiro',
    cost_center: 'CC-1',
    estimated_amount: 500,
    final_amount: 0,
    metadata: {},
    employee_name: 'Viajante 1',
    employee_document: 'DOC-1',
    employee_email: 'viajante1@example.com',
    employee_phone: null,
    employee_job_title: null,
    employee_department: 'Compras',
    employee_cost_center: 'CC-1',
  }
}

function principal() {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    tenantSlug: 'tenant-1',
    tenantStatus: 'active',
    membershipId: 'membership-1',
    roleKey: 'agent',
    platformAdmin: false,
    planKey: null,
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: 'user-1',
      name: 'Agente',
      email: 'agente@example.com',
      status: 'active',
    },
  } as never
}

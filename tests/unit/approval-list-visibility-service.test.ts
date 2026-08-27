import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

import {
  createApprovalInstance,
  decideApprovalAssignment,
  getApprovalInstanceDetail,
  listApprovalInstances,
} from '@/lib/server/approval-service'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const INSTANCE_ID = '22222222-2222-4222-8222-222222222222'
const STEP_ID = '33333333-3333-4333-8333-333333333333'
const ASSIGNMENT_ID = '44444444-4444-4444-8444-444444444444'

describe('approval list requester visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, callback: (client: { query: typeof mocks.query }) => unknown) => (
        callback({ query: mocks.query })
      ),
    )
  })

  it('adds ownership filtering to the requester queue', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] })

    await listApprovalInstances(principal('requester'))

    const countSql = String(mocks.query.mock.calls[0]?.[0])
    const listSql = String(mocks.query.mock.calls[1]?.[0])
    expect(countSql).toContain("subject_snapshot ->> 'requesterUserId'")
    expect(countSql).toContain('requester_owned_identity.user_id = $3::uuid')
    expect(countSql).toContain('requester_authoritative_identity.user_id is not null')
    expect(countSql).toMatch(/requesterUserId'[\s\S]+and not exists/)
    expect(listSql).toContain("subject_snapshot ->> 'requesterUserId'")
  })

  it('does not narrow internal approvers beyond their authorized company scope', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] })

    await listApprovalInstances(principal('agent'))

    expect(String(mocks.query.mock.calls[0]?.[0])).not.toContain("subject_snapshot ->> 'requesterUserId'")
  })

  it('rejects direct entity-bound creation before a forged requester snapshot reaches persistence', async () => {
    await expect(createApprovalInstance(principal('requester'), {
      workflowCode: 'hotel-cost',
      companyId: 'company-a',
      demandId: 'demand-from-another-requester',
      instanceType: 'cost',
      subject: { requesterUserId: USER_ID, amount: 500, currency: 'BRL' },
      idempotencyKey: 'forged-attempt-1',
    })).rejects.toMatchObject({
      code: 'APPROVAL_ENTITY_INSTANCE_DOMAIN_ORIGIN_REQUIRED',
      status: 403,
    })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('rejects ownerless approval creation from a requester', async () => {
    await expect(createApprovalInstance(principal('requester'), {
      workflowCode: 'hotel-cost',
      companyId: 'company-a',
      instanceType: 'cost',
      subject: { requesterUserId: USER_ID, amount: 500, currency: 'BRL' },
      idempotencyKey: 'ownerless-attempt-1',
    })).rejects.toMatchObject({
      code: 'APPROVAL_REQUESTER_DEMAND_REQUIRED',
      status: 403,
    })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it.each([
    {
      selector: { workflowCode: 'matrix.cost.company.deadbeef' },
      subject: { amount: 1, urgent: false, currency: 'BRL', product: 'air' },
    },
    {
      selector: { workflowDefinitionId: '99999999-9999-4999-8999-999999999999' },
      subject: { amount: 999_999, urgent: true, currency: 'BRL', destination: 'FOR' },
    },
  ])('rejects public matrix creation before trusting spoofed subject facts ($selector)', async ({ selector, subject }) => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ workflow_code: 'matrix.cost.company.deadbeef' }],
      rowCount: 1,
    })

    await expect(createApprovalInstance(principal('agent'), {
      ...selector,
      companyId: 'company-a',
      instanceType: 'cost',
      subject,
      idempotencyKey: `public-matrix-spoof-${subject.urgent ? 'urgent' : 'amount'}`,
    })).rejects.toMatchObject({
      code: 'APPROVAL_MATRIX_INSTANCE_DOMAIN_ORIGIN_REQUIRED',
      status: 403,
    })

    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain('from approval_workflow_definitions')
  })

  it.each([
    { demandId: 'demand-pending-merit' },
    { reservationId: 'reservation-a' },
    { employeeId: 'employee-a' },
  ])('rejects a public non-matrix entity binding without any database write (%o)', async (binding) => {
    await expect(createApprovalInstance(principal('agent'), {
      workflowCode: 'legacy-non-matrix-workflow',
      companyId: 'company-a',
      ...binding,
      instanceType: 'merit',
      subject: { amount: 1, urgent: false, currency: 'BRL', product: 'air' },
      idempotencyKey: `public-entity-spoof-${Object.keys(binding)[0]}`,
    })).rejects.toMatchObject({
      code: 'APPROVAL_ENTITY_INSTANCE_DOMAIN_ORIGIN_REQUIRED',
      status: 403,
    })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('denies a forged snapshot when another requester is the relational owner', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          id: INSTANCE_ID,
          company_id: 'company-a',
          workflow_definition_id: 'workflow-a',
          workflow_version_id: 'version-a',
          instance_type: 'merit',
          status: 'in_progress',
          version: 1,
          started_at: '2026-08-04T12:00:00.000Z',
          completed_at: null,
          demand_id: 'demand-from-another-requester',
          subject_snapshot: { requesterUserId: USER_ID },
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })

    await expect(getApprovalInstanceDetail(principal('requester'), INSTANCE_ID))
      .rejects.toMatchObject({
        code: 'APPROVAL_INSTANCE_ACCESS_DENIED',
        status: 403,
      })

    const ownershipSql = String(mocks.query.mock.calls[1]?.[0])
    expect(ownershipSql).toContain('requester_owned_identity.user_id = $3::uuid')
    expect(ownershipSql).toContain('requester_authoritative_identity.user_id is not null')
    expect(ownershipSql).toMatch(/requesterUserId'[\s\S]+and not exists/)
  })

  it('returns an allow-listed requester detail without technical approval data', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          id: INSTANCE_ID,
          company_id: 'company-a',
          company_name: 'Empresa A',
          workflow_definition_id: 'workflow-secret',
          workflow_version_id: 'workflow-version-secret',
          workflow_name: 'Aprovação de hospedagem',
          demand_id: 'demand-a',
          reservation_id: 'reservation-secret',
          employee_id: 'employee-secret',
          demand_number: 'OS-20260804-0010',
          demand_service_type: 'hotelaria',
          demand_passenger_name: 'Viajante A',
          requester_name: 'Solicitante A',
          demand_destination: 'Goiânia',
          demand_travel_start_date: '2026-08-20',
          demand_travel_end_date: '2026-08-22',
          instance_type: 'cost',
          status: 'in_progress',
          version: 7,
          started_at: '2026-08-04T12:00:00.000Z',
          completed_at: null,
          subject_snapshot: {
            tenantId: 'tenant-secret',
            companyId: 'company-secret',
            requesterUserId: USER_ID,
            quoteSnapshotHash: 'hash-secret',
            payload: { private: true },
            amount: 450,
            currency: 'BRL',
            product: 'hotelaria',
            destination: 'Goiânia',
          },
          workflow_snapshot: {
            contentHash: 'workflow-hash-secret',
            nodes: [{ id: 'node-secret' }],
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ allowed: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'step-secret',
          node_id: 'node-secret',
          node_name: 'Autorização de custo',
          approval_kind: 'cost',
          step_number: 1,
          status: 'pending',
          completion_mode: 'any',
          quorum: null,
          due_at: null,
          version: 3,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'assignment-secret',
          approval_step_id: 'step-secret',
          assignee_user_id: '33333333-3333-4333-8333-333333333333',
          assignee_name: 'Aprovadora A',
          assignee_email: 'aprovadora-secreta@example.com',
          status: 'pending',
          resolution_source: 'authority-secret',
          delegated_from_user_id: '44444444-4444-4444-8444-444444444444',
          assigned_at: '2026-08-04T12:01:00.000Z',
          responded_at: null,
        }],
      })

    const detail = await getApprovalInstanceDetail(principal('requester'), INSTANCE_ID)

    expect(detail.subject).toEqual({})
    expect(detail.workflow).toBeNull()
    expect(detail.presentation).toMatchObject({
      kind: 'business',
      business: {
        demandNumber: 'OS-20260804-0010',
        companyName: 'Empresa A',
        requesterName: 'Solicitante A',
        travelerName: 'Viajante A',
        service: 'Hotel',
        amount: 450,
      },
    })
    expect(detail).not.toHaveProperty('workflowId')
    expect(detail).not.toHaveProperty('workflowVersionId')
    expect(detail).not.toHaveProperty('reservationId')
    expect(detail.steps[0]).toEqual({
      nodeName: 'Autorização de custo',
      approvalKind: 'cost',
      stepNumber: 1,
      status: 'pending',
      completionMode: 'any',
      quorum: null,
      dueAt: null,
      assignments: [{
        userName: 'Aprovadora A',
        status: 'pending',
        assignedAt: '2026-08-04T12:01:00.000Z',
        respondedAt: null,
      }],
    })
    expect(detail.decisions).toEqual([])
    expect(detail.events).toEqual([])
    const serialized = JSON.stringify(detail)
    expect(serialized).not.toMatch(/tenant-secret|company-secret|hash-secret|workflow-hash-secret|node-secret/)
    expect(serialized).not.toMatch(/assignment-secret|aprovadora-secreta@example\.com|authority-secret|44444444/)
    const executedSql = mocks.query.mock.calls.map((call) => String(call[0])).join('\n')
    expect(executedSql).not.toContain('from approval_decisions')
    expect(executedSql).not.toContain('from approval_events')
  })

  it('keeps the complete detail contract for an authorized internal approver', async () => {
    const workflowSnapshot = {
      workflowId: '55555555-5555-4555-8555-555555555555',
      workflowVersionId: '66666666-6666-4666-8666-666666666666',
      version: 1,
      code: 'hotel-cost',
      name: 'Aprovação de hospedagem',
      contentHash: 'b'.repeat(64),
      nodes: [
        { id: 'start', key: 'start', name: 'Início', type: 'start' },
        { id: 'end', key: 'end', name: 'Fim', type: 'end' },
      ],
      edges: [{ id: 'edge', sourceNodeId: 'start', targetNodeId: 'end', sequence: 1 }],
    }
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          id: INSTANCE_ID,
          company_id: 'company-a',
          company_name: 'Empresa A',
          workflow_definition_id: workflowSnapshot.workflowId,
          workflow_version_id: workflowSnapshot.workflowVersionId,
          workflow_name: workflowSnapshot.name,
          demand_id: 'demand-a',
          reservation_id: null,
          employee_id: null,
          demand_number: 'OS-20260804-0011',
          instance_type: 'cost',
          status: 'in_progress',
          version: 1,
          started_at: '2026-08-04T12:00:00.000Z',
          completed_at: null,
          subject_snapshot: {
            tenantId: 'tenant-a',
            companyId: 'company-a',
            amount: 700,
            currency: 'BRL',
          },
          workflow_snapshot: workflowSnapshot,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'decision-internal', decidedByUserId: 'actor-internal', reason: 'Aprovado.' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'event-internal', actorUserId: 'actor-internal', payload: { technical: true } }],
      })

    const detail = await getApprovalInstanceDetail(principal('agent'), INSTANCE_ID)

    expect(detail.workflowId).toBe(workflowSnapshot.workflowId)
    expect(detail.workflow).toMatchObject({ contentHash: workflowSnapshot.contentHash })
    expect(detail.subject).toMatchObject({ tenantId: 'tenant-a', companyId: 'company-a' })
    expect(detail.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'decision-internal', decidedByUserId: 'actor-internal' }),
    ]))
    expect(detail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'event-internal', payload: { technical: true } }),
    ]))
  })

  it('returns the committed decision when the first response was lost without mutating again', async () => {
    const workflowSnapshot = {
      workflowId: '55555555-5555-4555-8555-555555555555',
      workflowVersionId: '66666666-6666-4666-8666-666666666666',
      version: 1,
      code: 'replay-cost',
      name: 'Aprovacao de custo',
      contentHash: 'c'.repeat(64),
      nodes: [
        { id: 'start', key: 'start', name: 'Inicio', type: 'start' },
        { id: 'end', key: 'end', name: 'Fim', type: 'end' },
      ],
      edges: [{ id: 'edge', sourceNodeId: 'start', targetNodeId: 'end', sequence: 1 }],
    }
    const instanceRow = {
      id: INSTANCE_ID,
      company_id: 'company-a',
      company_name: 'Empresa A',
      workflow_definition_id: workflowSnapshot.workflowId,
      workflow_version_id: workflowSnapshot.workflowVersionId,
      workflow_name: workflowSnapshot.name,
      demand_id: 'demand-a',
      reservation_id: null,
      employee_id: null,
      demand_number: 'OS-REPLAY-1',
      demand_service_type: 'air',
      demand_passenger_name: 'Viajante A',
      requester_name: 'Solicitante A',
      demand_destination: 'Sao Paulo',
      demand_travel_start_date: '2026-09-01',
      demand_travel_end_date: '2026-09-02',
      instance_type: 'cost',
      status: 'approved',
      version: 2,
      started_at: '2026-08-17T12:00:00.000Z',
      completed_at: '2026-08-17T12:01:00.000Z',
      subject_snapshot: { companyId: 'company-a', amount: 700, currency: 'BRL' },
      workflow_snapshot: workflowSnapshot,
    }
    const input = {
      decision: 'approved',
      reason: 'Viagem autorizada',
      expectedStepVersion: 4,
      idempotencyKey: 'approval-response-lost-replay',
      confirmation: true,
    }
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          id: ASSIGNMENT_ID,
          approval_step_id: STEP_ID,
          assignee_user_id: USER_ID,
          status: 'approved',
          delegated_from_user_id: null,
          source_reference: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: STEP_ID,
          approval_instance_id: INSTANCE_ID,
          node_id: 'approval-node',
          status: 'approved',
          version: 5,
        }],
      })
      .mockResolvedValueOnce({ rows: [instanceRow] })
      .mockResolvedValueOnce({
        rows: [{
          id: '77777777-7777-4777-8777-777777777777',
          assignment_id: ASSIGNMENT_ID,
          decision: 'approved',
          reason: 'Viagem autorizada',
          decided_by_user_id: USER_ID,
          acting_for_user_id: null,
          decision_source: 'human',
          impersonation_id: null,
          decision_snapshot: {
            expectedStepVersion: 4,
            confirmation: true,
            representationId: null,
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [instanceRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const detail = await decideApprovalAssignment(
      principal('agent'),
      ASSIGNMENT_ID,
      input,
      { allowedCompanyIds: ['company-a'] },
    )

    expect(detail).toMatchObject({ id: INSTANCE_ID, status: 'approved' })
    const sql = mocks.query.mock.calls.map((call) => String(call[0])).join('\n')
    expect(sql).toContain('from approval_decisions')
    expect(sql).not.toContain('insert into approval_decisions')
    expect(sql).not.toContain('update approval_assignments')
    expect(sql).not.toContain('insert into audit_logs')
  })
})

function principal(roleKey: 'requester' | 'agent'): RequestPrincipal {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    ver_aprovacoes: true,
    decidir_aprovacoes: roleKey === 'agent',
  }
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey,
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: USER_ID,
      email: 'usuario@tenant.invalid',
      name: 'Usuario',
      role: roleKey === 'requester' ? 'colaborador' : 'master',
      role_key: roleKey,
      company_id: 'company-a',
      corporate_profile: roleKey === 'requester' ? 'requester' : undefined,
      ativo: true,
      permissoes: permissions,
    },
    corporateAccess: {
      tenantWide: roleKey === 'agent',
      companyIds: ['company-a'],
      groupIds: [],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: null,
        groupName: null,
        profiles: [roleKey === 'requester' ? 'requester' : 'company_admin'],
        permissions,
        sources: ['direct'],
      }],
      groups: [],
      contexts: [],
      defaultContext: { type: 'company', id: 'company-a' },
      refreshedAt: '2026-08-04T12:00:00.000Z',
    },
  }
}

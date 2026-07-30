import { describe, expect, it } from 'vitest'

import {
  approvalAuthorityInputSchema,
  approvalDelegationInputSchema,
  approvalSlaInputSchema,
  approvalWorkflowDraftInputSchema,
  createApprovalInstanceSchema,
} from '@/lib/approvals/admin-schema'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

const workflowDraft = {
  workflowCode: 'travel.cost',
  name: 'Aprovacao de custo',
  description: 'Fluxo corporativo para aprovacao de custo de viagem.',
  workflowType: 'cost' as const,
  scopes: [{ type: 'tenant' as const, mode: 'include' as const, specificity: 0 }],
  nodes: [
    { id: 'start', key: 'start', name: 'Inicio', type: 'start' as const },
    { id: 'end', key: 'end', name: 'Fim', type: 'end' as const },
  ],
  edges: [{ id: 'start-end', sourceNodeId: 'start', targetNodeId: 'end', sequence: 1 }],
  rules: [],
  slas: [],
  changeSummary: 'Criacao inicial do fluxo.',
}

describe('approval administration schemas', () => {
  it('aceita um workflow versionado com escopo explicito', () => {
    expect(approvalWorkflowDraftInputSchema.parse(workflowDraft)).toMatchObject({
      workflowCode: 'travel.cost',
      workflowType: 'cost',
    })
  })

  it('rejeita regra ou SLA que referencia um no inexistente', () => {
    const parsed = approvalWorkflowDraftInputSchema.safeParse({
      ...workflowDraft,
      rules: [{
        nodeId: 'missing',
        type: 'entry',
        condition: { fact: 'travel.amount', operator: 'gt', value: 1_000 },
        configuration: {},
        priority: 100,
      }],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['rules', 0, 'nodeId'])
  })

  it('exige calendario para SLA em horario util e justificativa para aprovacao passiva', () => {
    expect(approvalSlaInputSchema.safeParse({
      durationMinutes: 480,
      businessTimeOnly: true,
      reminderMinutes: [120],
      expirationAction: 'notify',
      configuration: {},
    }).success).toBe(false)

    expect(approvalSlaInputSchema.safeParse({
      calendarId: UUID_A,
      durationMinutes: 480,
      businessTimeOnly: true,
      reminderMinutes: [120],
      expirationAction: 'passive_approve',
      configuration: {},
    }).success).toBe(false)
  })

  it('valida seletores e limites do escalonamento de SLA', () => {
    expect(approvalSlaInputSchema.safeParse({
      durationMinutes: 60,
      businessTimeOnly: false,
      reminderMinutes: [15],
      expirationAction: 'reassign',
      configuration: {
        escalationSelectors: [{ type: 'role', value: ['director'] }],
        minimumApprovers: 2,
        maximumApprovers: 1,
      },
    }).success).toBe(false)

    expect(approvalSlaInputSchema.safeParse({
      durationMinutes: 60,
      businessTimeOnly: false,
      reminderMinutes: [15],
      expirationAction: 'escalate',
      configuration: {
        escalationSelectors: [{ type: 'role', value: ['director'] }],
        minimumApprovers: 1,
        notificationTitle: 'Aprovacao vencida',
      },
    }).success).toBe(true)
  })

  it('impede delegacao sem escopo e aceita delegacao delimitada', () => {
    const base = {
      delegatorMembershipId: UUID_A,
      delegateMembershipId: UUID_B,
      validFrom: '2026-07-23T00:00:00.000Z',
      validUntil: '2026-07-30T00:00:00.000Z',
      companyIds: [],
      groupIds: [],
      modules: ['cost'],
      justification: 'Cobertura temporaria durante as ferias do aprovador.',
    }
    expect(approvalDelegationInputSchema.safeParse(base).success).toBe(false)
    expect(approvalDelegationInputSchema.safeParse({ ...base, companyIds: ['company-a'] }).success).toBe(true)
  })

  it('impede alcada com mais de um escopo organizacional e normaliza moeda', () => {
    const base = {
      membershipId: UUID_A,
      approvalKind: 'cost' as const,
      companyId: 'company-a',
      groupId: null,
      costCenterId: null,
      projectId: null,
      maxAmount: 50_000,
      accumulatedAmountLimit: 100_000,
      accumulationPeriodDays: 30,
      maxPercentageAboveLowest: 15,
      maxPercentageAboveAverage: 10,
      requiresBudgetAvailable: true,
      urgentAllowed: false,
      currency: 'brl',
      products: ['air'],
      destinations: [],
      riskLevels: [],
      validFrom: '2026-07-23T00:00:00.000Z',
      validUntil: null,
      justification: 'Alcada formal aprovada para o gestor financeiro.',
    }
    expect(approvalAuthorityInputSchema.parse(base).currency).toBe('BRL')
    expect(approvalAuthorityInputSchema.safeParse({ ...base, groupId: 'group-a' }).success).toBe(false)
    expect(approvalAuthorityInputSchema.safeParse({
      ...base,
      accumulatedAmountLimit: 100_000,
      accumulationPeriodDays: null,
    }).success).toBe(false)
  })

  it('exige exatamente uma referencia de workflow ao criar instancia', () => {
    const base = {
      companyId: 'company-a',
      instanceType: 'travel_request',
      subject: { amount: 1_000, currency: 'BRL' },
      idempotencyKey: 'travel-request-1001',
    }
    expect(createApprovalInstanceSchema.safeParse(base).success).toBe(false)
    expect(createApprovalInstanceSchema.safeParse({
      ...base,
      workflowDefinitionId: UUID_A,
      workflowCode: 'travel.cost',
    }).success).toBe(false)
    expect(createApprovalInstanceSchema.safeParse({ ...base, workflowCode: 'travel.cost' }).success).toBe(true)
  })
})

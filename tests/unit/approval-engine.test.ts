import { describe, expect, it } from 'vitest'

import {
  addBusinessMinutes,
  calculateApprovalStepOutcome,
  evaluateApprovalSla,
  resolveApprovers,
  resolveNextWorkflowNodes,
  validateApprovalDelegation,
  validateApprovalWorkflow,
  type ApprovalCandidate,
  type ApprovalDelegationCandidate,
  type ApprovalSubject,
  type ApprovalWorkflowSnapshot,
  type BusinessCalendarDefinition,
  type DelegationMembership,
} from '@/lib/approvals'

const workflow: ApprovalWorkflowSnapshot = {
  workflowId: 'workflow-cost',
  workflowVersionId: 'workflow-cost-v1',
  version: 1,
  code: 'cost-approval',
  name: 'Aprovacao de custo',
  contentHash: 'a'.repeat(64),
  nodes: [
    { id: 'start', key: 'start', name: 'Inicio', type: 'start' },
    {
      id: 'manager',
      key: 'manager',
      name: 'Gestor',
      type: 'approval',
      approvalKind: 'cost',
      completionMode: 'all',
      approverResolution: {
        selectors: [{ type: 'manager' }],
        combination: 'first_non_empty',
        minimumApprovers: 1,
        allowSelfApproval: false,
      },
    },
    { id: 'end', key: 'end', name: 'Fim', type: 'end' },
  ],
  edges: [
    { id: 'edge-start-manager', sourceNodeId: 'start', targetNodeId: 'manager', sequence: 1 },
    { id: 'edge-manager-end', sourceNodeId: 'manager', targetNodeId: 'end', sequence: 1 },
  ],
}

const subject: ApprovalSubject = {
  tenantId: 'tenant-a',
  companyId: 'company-a',
  groupId: 'group-a',
  requesterUserId: 'requester-a',
  travelerUserId: 'traveler-a',
  managerUserId: 'manager-a',
  amount: 8_000,
  currency: 'BRL',
  product: 'air',
  riskLevel: 'medium',
}

function candidate(overrides: Partial<ApprovalCandidate> = {}): ApprovalCandidate {
  return {
    userId: 'manager-a',
    membershipId: 'membership-manager-a',
    tenantId: 'tenant-a',
    active: true,
    roleKeys: ['manager'],
    companyIds: ['company-a'],
    groupIds: ['group-a'],
    approvalKinds: ['cost', 'merit'],
    authorityMatched: true,
    maxAmount: 10_000,
    currencies: ['BRL'],
    products: ['air'],
    riskLevels: ['medium'],
    ...overrides,
  }
}

describe('approval workflow graph', () => {
  it('valida um fluxo sequencial e produz ordem topologica', () => {
    const result = validateApprovalWorkflow(workflow)
    expect(result).toMatchObject({ valid: true, topologicalOrder: ['start', 'manager', 'end'] })
  })

  it('preserva um no second_level legado sem impor o contrato condicional da matriz', () => {
    const legacy: ApprovalWorkflowSnapshot = {
      ...workflow,
      nodes: workflow.nodes.map((node) => (
        node.id === 'manager' && node.type === 'approval'
          ? { ...node, approvalKind: 'second_level' as const }
          : node
      )),
    }
    expect(validateApprovalWorkflow(legacy).valid).toBe(true)
  })

  it('aplica SOD e roteamento ao nivel dois canonico identificado pelo seletor', () => {
    const canonicalWithoutGuards: ApprovalWorkflowSnapshot = {
      ...workflow,
      nodes: workflow.nodes.map((node) => (
        node.id === 'manager' && node.type === 'approval' && node.approverResolution
          ? {
              ...node,
              approverResolution: {
                ...node.approverResolution,
                selectors: [{ type: 'authority' as const, configuration: { level: 2 } }],
              },
            }
          : node
      )),
    }
    const result = validateApprovalWorkflow(canonicalWithoutGuards)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'SECOND_LEVEL_REQUIRES_PRIOR_APPROVER_SEPARATION',
      'SECOND_LEVEL_REQUIRES_ROUTING_CONDITION',
    ]))
  })

  it('detecta ciclo, no morto e no inalcancavel antes da publicacao', () => {
    const invalid: ApprovalWorkflowSnapshot = {
      ...workflow,
      nodes: [...workflow.nodes, { id: 'orphan', key: 'orphan', name: 'Orfao', type: 'notification' }],
      edges: [
        ...workflow.edges,
        { id: 'edge-cycle', sourceNodeId: 'manager', targetNodeId: 'start', sequence: 2 },
      ],
    }
    const result = validateApprovalWorkflow(invalid)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'START_HAS_INCOMING_EDGE',
      'DEAD_END_NODE',
      'WORKFLOW_CYCLE',
      'UNREACHABLE_NODES',
    ]))
  })

  it('resolve caminhos paralelos e condicionais sem efeitos colaterais', () => {
    const parallel: ApprovalWorkflowSnapshot = {
      ...workflow,
      nodes: [
        workflow.nodes[0],
        workflow.nodes[1],
        {
          ...workflow.nodes[1],
          id: 'finance',
          key: 'finance',
          name: 'Financeiro',
          approvalKind: 'financial',
        },
        workflow.nodes[2],
      ],
      edges: [
        { id: 'edge-manager', sourceNodeId: 'start', targetNodeId: 'manager', sequence: 1 },
        {
          id: 'edge-finance',
          sourceNodeId: 'start',
          targetNodeId: 'finance',
          sequence: 2,
          condition: { fact: 'finance.total', operator: 'gt', value: 5_000 },
        },
        { id: 'edge-manager-end', sourceNodeId: 'manager', targetNodeId: 'end', sequence: 1 },
        { id: 'edge-finance-end', sourceNodeId: 'finance', targetNodeId: 'end', sequence: 1 },
      ],
    }
    expect(resolveNextWorkflowNodes(parallel, 'start', { finance: { total: 8_000 } }).map((node) => node.id)).toEqual([
      'manager',
      'finance',
    ])
    expect(resolveNextWorkflowNodes(parallel, 'start', { finance: { total: 1_000 } }).map((node) => node.id)).toEqual(['manager'])
  })
})

describe('approver resolution', () => {
  it('resolve por gestor e explica a origem', () => {
    const result = resolveApprovers('cost', {
      selectors: [{ type: 'manager' }],
      combination: 'first_non_empty',
      minimumApprovers: 1,
      allowSelfApproval: false,
    }, subject, [candidate()])

    expect(result.approvers[0]).toMatchObject({ userId: 'manager-a', matchedSelectors: ['manager'] })
    expect(result.explanations[0]).toContain('manager')
  })

  it('usa alçada monetaria e fallback autorizado', () => {
    const director = candidate({ userId: 'director-a', membershipId: 'membership-director', maxAmount: 20_000 })
    const result = resolveApprovers('cost', {
      selectors: [{ type: 'role', value: 'missing-role' }],
      combination: 'first_non_empty',
      fallbackSelectors: [{ type: 'authority' }],
      minimumApprovers: 1,
      allowSelfApproval: false,
    }, subject, [candidate({ maxAmount: 5_000 }), director])

    expect(result.usedFallback).toBe(true)
    expect(result.approvers.map((item) => item.userId)).toEqual(['director-a'])
  })

  it('resolve filial, valor e moeda no mesmo candidato', () => {
    const branchSubject = { ...subject, branchId: 'branch-a', amount: 12_000, currency: 'BRL' }
    const result = resolveApprovers('cost', {
      selectors: [
        { type: 'branch', value: 'branch-a' },
        { type: 'amount', configuration: { currency: 'BRL' } },
        { type: 'currency', value: 'BRL' },
      ],
      combination: 'all',
      minimumApprovers: 1,
      allowSelfApproval: false,
    }, branchSubject, [
      candidate({ userId: 'limited', membershipId: 'limited', branchIds: ['branch-a'], maxAmount: 5_000 }),
      candidate({ userId: 'director', membershipId: 'director', branchIds: ['branch-a'], maxAmount: 20_000 }),
      candidate({ userId: 'other-branch', membershipId: 'other-branch', branchIds: ['branch-b'], maxAmount: 20_000 }),
    ])

    expect(result.approvers.map((item) => item.userId)).toEqual(['director'])
    expect(result.approvers[0]?.matchedSelectors).toEqual(['branch', 'amount', 'currency'])
  })

  it('nao combina limites de alcadas diferentes para formar uma autoridade maior', () => {
    const restrictedByProduct = candidate({
      userId: 'director', membershipId: 'director-air', maxAmount: 20_000, products: ['air'],
    })
    const restrictedByValue = candidate({
      userId: 'director', membershipId: 'director-hotel', maxAmount: 5_000, products: ['hotel'],
    })
    expect(() => resolveApprovers('cost', {
      selectors: [{ type: 'authority' }],
      combination: 'all',
      minimumApprovers: 1,
      allowSelfApproval: false,
    }, { ...subject, amount: 12_000, product: 'hotel' }, [restrictedByProduct, restrictedByValue]))
      .toThrowError(expect.objectContaining({ code: 'NO_APPROVER_AVAILABLE' }))
  })

  it('aplica limite acumulado, comparativos, orcamento e urgencia', () => {
    const authority = candidate({
      userId: 'director', membershipId: 'director', maxAmount: null,
      accumulatedAmountLimit: 50_000,
      maxPercentageAboveLowest: 12,
      maxPercentageAboveAverage: 8,
      requiresBudgetAvailable: true,
      urgentAllowed: false,
    })
    const spec = {
      selectors: [{ type: 'authority' as const }],
      combination: 'all' as const,
      minimumApprovers: 1,
      allowSelfApproval: false,
    }
    const approved = resolveApprovers('cost', spec, {
      ...subject,
      amount: 10_000,
      accumulatedAmount: 45_000,
      percentageAboveLowest: 10,
      percentageAboveAverage: 7,
      budgetAvailable: 15_000,
      urgent: false,
    }, [authority])
    expect(approved.approvers.map((item) => item.userId)).toEqual(['director'])
    expect(() => resolveApprovers('cost', spec, {
      ...subject,
      amount: 10_000,
      accumulatedAmount: 51_000,
      percentageAboveLowest: 10,
      percentageAboveAverage: 7,
      budgetAvailable: 15_000,
      urgent: false,
    }, [authority])).toThrowError(expect.objectContaining({ code: 'NO_APPROVER_AVAILABLE' }))
    expect(() => resolveApprovers('cost', spec, {
      ...subject,
      amount: 10_000,
      accumulatedAmount: 45_000,
      percentageAboveLowest: 10,
      percentageAboveAverage: 7,
      budgetAvailable: 15_000,
      urgent: true,
    }, [authority])).toThrowError(expect.objectContaining({ code: 'NO_APPROVER_AVAILABLE' }))
  })

  it('impede autoaprovacao, segregacao de funcoes e acesso entre tenants', () => {
    const requester = candidate({ userId: 'requester-a', membershipId: 'requester-membership' })
    const otherTenant = candidate({ userId: 'manager-b', membershipId: 'manager-b', tenantId: 'tenant-b' })
    expect(() => resolveApprovers('cost', {
      selectors: [{ type: 'role', value: 'manager' }],
      combination: 'union',
      minimumApprovers: 1,
      allowSelfApproval: false,
      separationOfDuties: ['requester'],
    }, subject, [requester, otherTenant])).toThrowError(expect.objectContaining({ code: 'NO_APPROVER_AVAILABLE' }))
  })

  it('impede que o agente que criou ou escolheu a cotacao seja resolvido como aprovador', () => {
    const supportAgent = candidate({ userId: 'support-agent', membershipId: 'support-agent-membership' })
    expect(() => resolveApprovers('cost', {
      selectors: [{ type: 'role', value: 'manager' }],
      combination: 'all',
      minimumApprovers: 1,
      allowSelfApproval: true,
    }, {
      ...subject,
      assistedActorUserId: 'support-agent',
      conflictedUserIds: ['demand-creator'],
    }, [supportAgent])).toThrowError(expect.objectContaining({ code: 'NO_APPROVER_AVAILABLE' }))

    expect(() => resolveApprovers('cost', {
      selectors: [{ type: 'role', value: 'manager' }],
      combination: 'all',
      minimumApprovers: 1,
      allowSelfApproval: true,
    }, {
      ...subject,
      conflictedUserIds: ['demand-creator'],
    }, [candidate({ userId: 'demand-creator', membershipId: 'creator-membership' })]))
      .toThrowError(expect.objectContaining({ code: 'NO_APPROVER_AVAILABLE' }))
  })

  it('nao aceita aprovador fora da empresa ou sem tipo de aprovacao', () => {
    expect(() => resolveApprovers('cost', {
      selectors: [{ type: 'role', value: 'manager' }],
      combination: 'all',
      minimumApprovers: 1,
      allowSelfApproval: true,
    }, subject, [candidate({ companyIds: ['company-b'], groupIds: [], approvalKinds: ['merit'] })]))
      .toThrowError(expect.objectContaining({ code: 'NO_APPROVER_AVAILABLE' }))
  })

  it('mantem o recorte mais especifico quando a alcada estoura e exige segundo nivel', () => {
    const result = resolveApprovers('cost', {
      selectors: [{ type: 'authority', configuration: { level: 1, onLimitExceeded: 'escalate' } }],
      combination: 'all',
      minimumApprovers: 1,
      maximumApprovers: 1,
      allowSelfApproval: false,
    }, { ...subject, costCenterId: '11111111-1111-4111-8111-111111111111', amount: 50_000 }, [
      candidate({
        userId: 'cost-center-approver', membershipId: 'cost-center-membership',
        maxAmount: 1_000, authorityLevel: 1, authoritySpecificity: 400,
      }),
      candidate({
        userId: 'company-approver', membershipId: 'company-membership',
        maxAmount: 100_000, authorityLevel: 1, authoritySpecificity: 200,
      }),
    ])

    expect(result.approvers.map((approver) => approver.userId)).toEqual(['cost-center-approver'])
    expect(result.requiresEscalation).toBe(true)
    expect(result.escalationReasons).toEqual(['authority_limit_exceeded'])
  })

  it('prioriza a autoridade do grupo-alvo sobre o fallback geral da empresa', () => {
    const audienceGroupId = '22222222-2222-4222-8222-222222222222'
    const result = resolveApprovers('cost', {
      selectors: [{ type: 'authority', configuration: { level: 1 } }],
      combination: 'all',
      minimumApprovers: 1,
      maximumApprovers: 1,
      allowSelfApproval: false,
    }, { ...subject, audienceGroupIds: [audienceGroupId] }, [
      candidate({
        userId: 'audience-approver',
        membershipId: 'audience-approver-membership',
        audienceGroupIds: [audienceGroupId],
        authorityLevel: 1,
        authoritySpecificity: 500,
      }),
      candidate({
        userId: 'company-approver',
        membershipId: 'company-approver-membership',
        authorityLevel: 1,
        authoritySpecificity: 200,
      }),
    ])

    expect(result.approvers.map((approver) => approver.userId)).toEqual(['audience-approver'])
  })

  it('impede que a mesma pessoa aprove o primeiro e o segundo nivel', () => {
    const result = resolveApprovers('second_level', {
      selectors: [{ type: 'authority', configuration: { level: 2 } }],
      combination: 'all',
      minimumApprovers: 1,
      maximumApprovers: 1,
      allowSelfApproval: false,
      separationOfDuties: ['prior_approver'],
    }, { ...subject, priorApproverUserIds: ['level-one-user'] }, [
      candidate({
        userId: 'level-one-user', membershipId: 'same-user-level-two',
        approvalKinds: ['second_level'], authorityLevel: 2, authoritySpecificity: 200,
      }),
      candidate({
        userId: 'distinct-level-two', membershipId: 'distinct-level-two-membership',
        approvalKinds: ['second_level'], authorityLevel: 2, authoritySpecificity: 200,
      }),
    ])

    expect(result.approvers.map((approver) => approver.userId)).toEqual(['distinct-level-two'])
  })
})

describe('approval completion modes', () => {
  const pending = [
    { assignmentId: 'a', assigneeUserId: 'user-a', status: 'approved' as const },
    { assignmentId: 'b', assigneeUserId: 'user-b', status: 'pending' as const },
    { assignmentId: 'c', assigneeUserId: 'user-c', status: 'pending' as const },
  ]

  it('suporta qualquer um, primeiro e todos', () => {
    expect(calculateApprovalStepOutcome('any', pending).status).toBe('approved')
    expect(calculateApprovalStepOutcome('first', pending)).toMatchObject({
      status: 'approved',
      cancelledAssignmentIds: ['b', 'c'],
    })
    expect(calculateApprovalStepOutcome('all', pending).status).toBe('pending')
    expect(calculateApprovalStepOutcome('all', [
      pending[0],
      { ...pending[1], status: 'rejected' },
      pending[2],
    ]).status).toBe('rejected')
  })

  it('suporta quorum e rejeita quando quorum se torna impossivel', () => {
    expect(calculateApprovalStepOutcome('quorum', [
      pending[0],
      { ...pending[1], status: 'approved' },
      pending[2],
    ], 2).status).toBe('approved')
    expect(calculateApprovalStepOutcome('quorum', [
      { ...pending[0], status: 'rejected' },
      { ...pending[1], status: 'rejected' },
      pending[2],
    ], 2).status).toBe('rejected')
  })

  it('ignora atribuicoes canceladas, expiradas ou substituidas no calculo', () => {
    expect(calculateApprovalStepOutcome('all', [
      { assignmentId: 'old', assigneeUserId: 'user-old', status: 'reassigned' },
      { assignmentId: 'new', assigneeUserId: 'user-new', status: 'approved' },
    ])).toMatchObject({ status: 'approved', approvals: 1, pending: 0 })

    expect(calculateApprovalStepOutcome('quorum', [
      { assignmentId: 'cancelled', assigneeUserId: 'user-old', status: 'cancelled' },
      { assignmentId: 'a', assigneeUserId: 'user-a', status: 'approved' },
      { assignmentId: 'b', assigneeUserId: 'user-b', status: 'pending' },
    ], 2)).toMatchObject({ status: 'pending', approvals: 1, pending: 1 })
  })
})

describe('approval delegation', () => {
  const memberships: DelegationMembership[] = [
    {
      membershipId: 'leader', tenantId: 'tenant-a', active: true, platformAdmin: false,
      companyIds: ['company-a', 'company-b'], groupIds: ['group-a'], delegableModules: ['cost', 'merit'], canReceiveDelegation: true,
    },
    {
      membershipId: 'delegate', tenantId: 'tenant-a', active: true, platformAdmin: false,
      companyIds: ['company-a'], groupIds: ['group-a'], delegableModules: ['cost'], canReceiveDelegation: true,
    },
    {
      membershipId: 'third', tenantId: 'tenant-a', active: true, platformAdmin: false,
      companyIds: ['company-a'], groupIds: ['group-a'], delegableModules: ['cost'], canReceiveDelegation: true,
    },
  ]
  const draft: ApprovalDelegationCandidate = {
    tenantId: 'tenant-a',
    delegatorMembershipId: 'leader',
    delegateMembershipId: 'delegate',
    validFrom: '2026-07-23T00:00:00.000Z',
    validUntil: '2026-07-30T00:00:00.000Z',
    companyIds: ['company-a'],
    groupIds: ['group-a'],
    modules: ['cost'],
    justification: 'Ferias programadas do aprovador.',
  }

  it('aceita delegacao futura dentro do escopo', () => {
    expect(validateApprovalDelegation(draft, memberships, [], '2026-07-22T00:00:00.000Z')).toMatchObject({ status: 'scheduled' })
  })

  it('impede autodelegacao, retroatividade e elevacao de privilegio', () => {
    expect(() => validateApprovalDelegation(
      { ...draft, delegateMembershipId: 'leader' }, memberships, [], '2026-07-22T00:00:00.000Z',
    )).toThrowError(expect.objectContaining({ code: 'SELF_DELEGATION' }))
    expect(() => validateApprovalDelegation(
      { ...draft, validFrom: '2026-07-21T00:00:00.000Z' }, memberships, [], '2026-07-22T00:00:00.000Z',
    )).toThrowError(expect.objectContaining({ code: 'RETROACTIVE_DELEGATION' }))
    expect(() => validateApprovalDelegation(
      { ...draft, modules: ['platform_admin'] }, memberships, [], '2026-07-22T00:00:00.000Z',
    )).toThrowError(expect.objectContaining({ code: 'DELEGATION_PRIVILEGE_ESCALATION' }))
  })

  it('impede ciclo e cadeia acima do limite', () => {
    const delegateToLeader: ApprovalDelegationCandidate = {
      ...draft,
      delegatorMembershipId: 'delegate',
      delegateMembershipId: 'leader',
      status: 'scheduled',
    }
    expect(() => validateApprovalDelegation(draft, memberships, [delegateToLeader], '2026-07-22T00:00:00.000Z'))
      .toThrowError(expect.objectContaining({ code: 'DELEGATION_CYCLE' }))

    const leaderToDelegate = { ...draft, status: 'scheduled' as const }
    const delegateToThird = {
      ...draft,
      delegatorMembershipId: 'delegate',
      delegateMembershipId: 'third',
      status: 'scheduled' as const,
    }
    expect(() => validateApprovalDelegation(
      { ...draft, delegatorMembershipId: 'third', delegateMembershipId: 'leader' },
      memberships,
      [leaderToDelegate, delegateToThird],
      '2026-07-22T00:00:00.000Z',
    )).toThrowError(expect.objectContaining({ code: 'DELEGATION_CYCLE' }))
  })
})

describe('approval SLA', () => {
  const calendar: BusinessCalendarDefinition = {
    timezone: 'America/Sao_Paulo',
    weeklySchedule: {
      1: [{ start: '09:00', end: '17:00' }],
      2: [{ start: '09:00', end: '17:00' }],
      3: [{ start: '09:00', end: '17:00' }],
      4: [{ start: '09:00', end: '17:00' }],
      5: [{ start: '09:00', end: '17:00' }],
    },
    holidays: [],
  }

  it('calcula prazo no fuso da empresa e pula fim de semana', () => {
    expect(addBusinessMinutes('2026-07-24T19:00:00.000Z', 120, calendar)).toBe('2026-07-27T13:00:00.000Z')
  })

  it('pula feriado e gera lembretes sem aprovar passivamente', () => {
    const withHoliday = { ...calendar, holidays: ['2026-07-27'] }
    const result = evaluateApprovalSla(
      '2026-07-24T19:00:00.000Z',
      120,
      [60],
      withHoliday,
      '2026-07-24T19:30:00.000Z',
    )
    expect(result.dueAt).toBe('2026-07-28T13:00:00.000Z')
    expect(result.reminderAt).toHaveLength(1)
    expect(result.status).toBe('on_time')
  })
})

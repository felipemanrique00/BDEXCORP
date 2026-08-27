import { describe, expect, it } from 'vitest'

import {
  allowedTravelCommands,
  assessTravelReapproval,
  nextTravelRecord,
  planTravelTransition,
  TravelLifecycleError,
  type TravelLifecycleRecord,
  type TravelTransitionInput,
} from '@/lib/travel-lifecycle'

const base: TravelLifecycleRecord = {
  demandId: 'demand-1',
  companyId: 'company-a',
  status: 'draft',
  version: 1,
}

function transition(overrides: Partial<TravelTransitionInput> = {}) {
  return planTravelTransition({
    current: base,
    command: 'submit',
    expectedVersion: 1,
    idempotencyKey: 'submit-demand-1',
    actorUserId: 'user-a',
    occurredAt: '2026-07-22T12:00:00.000Z',
    requirements: {
      companySelected: true,
      travelerSelected: true,
      policyEvaluationId: 'evaluation-a',
      policyPassed: true,
      policyHasBlocks: false,
    },
    ...overrides,
  })
}

describe('travel lifecycle machine', () => {
  it('planeja transicao valida com versao e auditoria', () => {
    const plan = transition()
    expect(plan).toMatchObject({
      fromStatus: 'draft',
      toStatus: 'submitted',
      previousVersion: 1,
      nextVersion: 2,
      policyEvaluationId: 'evaluation-a',
    })
    expect(nextTravelRecord(base, plan)).toMatchObject({ status: 'submitted', version: 2 })
  })

  it('bloqueia concorrencia otimista por versao antiga', () => {
    expect(() => transition({ expectedVersion: 2 })).toThrowError(
      expect.objectContaining({ code: 'STALE_LIFECYCLE_VERSION' }),
    )
  })

  it('bloqueia envio sem politica persistida ou com bloqueio', () => {
    expect(() => transition({ requirements: { companySelected: true, travelerSelected: true } })).toThrowError(
      expect.objectContaining({ code: 'POLICY_EVALUATION_REQUIRED' }),
    )
    expect(() => transition({
      requirements: {
        companySelected: true,
        travelerSelected: true,
        policyEvaluationId: 'evaluation-a',
        policyPassed: false,
        policyHasBlocks: true,
      },
    })).toThrowError(expect.objectContaining({ code: 'POLICY_BLOCKED' }))
  })

  it('nao permite saltar diretamente de rascunho para emissao', () => {
    expect(() => transition({ command: 'start_issuance' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_TRAVEL_TRANSITION' }),
    )
  })

  it('exige confirmacao humana, aprovacao e politica antes de reservar', () => {
    const approved: TravelLifecycleRecord = { ...base, status: 'approved', version: 8 }
    const input: Partial<TravelTransitionInput> = {
      current: approved,
      command: 'start_reservation',
      expectedVersion: 8,
      idempotencyKey: 'reserve-demand-1',
      requirements: {
        policyEvaluationId: 'evaluation-a',
        policyPassed: true,
        approvalsSatisfied: true,
        offerSelected: true,
        humanConfirmed: false,
      },
    }
    expect(() => transition(input)).toThrowError(expect.objectContaining({ code: 'HUMAN_CONFIRMATION_REQUIRED' }))
    const plan = transition({
      ...input,
      requirements: { ...input.requirements, humanConfirmed: true },
    })
    expect(plan.toStatus).toBe('reserving')
  })

  it('emissao exige documentos, pagamento, aprovacao e confirmacao do fornecedor', () => {
    const reserved: TravelLifecycleRecord = { ...base, status: 'reserved', version: 10 }
    const queued = transition({
      current: reserved,
      command: 'queue_issuance',
      expectedVersion: 10,
      idempotencyKey: 'queue-issue-demand-1',
      requirements: {
        policyEvaluationId: 'evaluation-a',
        policyPassed: true,
        requiredDocumentsSatisfied: true,
        paymentMethodSatisfied: true,
      },
    })
    expect(queued.toStatus).toBe('pending_issuance')

    const issuing: TravelLifecycleRecord = { ...nextTravelRecord(reserved, queued), status: 'issuing', version: 12 }
    expect(() => transition({
      current: issuing,
      command: 'complete_issuance',
      expectedVersion: 12,
      idempotencyKey: 'complete-issue-demand-1',
      requirements: { providerConfirmed: false },
    })).toThrowError(expect.objectContaining({ code: 'ISSUANCE_NOT_CONFIRMED' }))
  })

  it('inicia emissao somente com aprovacao e confirmacao humana', () => {
    const pending: TravelLifecycleRecord = { ...base, status: 'pending_issuance', version: 11 }
    const input: Partial<TravelTransitionInput> = {
      current: pending,
      command: 'start_issuance',
      expectedVersion: 11,
      idempotencyKey: 'start-issue-demand-1',
      requirements: {
        policyEvaluationId: 'evaluation-a',
        policyPassed: true,
        policyHasBlocks: false,
        approvalsSatisfied: true,
        humanConfirmed: false,
      },
    }
    expect(() => transition(input)).toThrowError(expect.objectContaining({ code: 'HUMAN_CONFIRMATION_REQUIRED' }))
    expect(transition({
      ...input,
      requirements: { ...input.requirements, humanConfirmed: true },
    }).toStatus).toBe('issuing')
  })

  it('cancelamento de bilhete segue para reembolso sem saltar estados', () => {
    const issued: TravelLifecycleRecord = { ...base, status: 'issued', version: 13 }
    expect(() => transition({
      current: issued,
      command: 'cancel',
      expectedVersion: 13,
      idempotencyKey: 'cancel-ticket-demand-1',
      requirements: { humanConfirmed: false },
    })).toThrowError(expect.objectContaining({ code: 'HUMAN_CONFIRMATION_REQUIRED' }))

    const cancellation = transition({
      current: issued,
      command: 'cancel',
      expectedVersion: 13,
      idempotencyKey: 'cancel-ticket-demand-1',
      requirements: { humanConfirmed: true },
    })
    const canceled = nextTravelRecord(issued, cancellation)
    const refund = transition({
      current: canceled,
      command: 'request_refund',
      expectedVersion: canceled.version,
      idempotencyKey: 'refund-ticket-demand-1',
      requirements: {
        policyEvaluationId: 'evaluation-cancellation',
        policyPassed: true,
        policyHasBlocks: false,
      },
    })
    expect(cancellation.toStatus).toBe('canceled')
    expect(refund.toStatus).toBe('pending_refund')

    const pendingRefund = nextTravelRecord(canceled, refund)
    expect(() => transition({
      current: pendingRefund,
      command: 'confirm_refund',
      expectedVersion: pendingRefund.version,
      idempotencyKey: 'confirm-refund-ticket-demand-1',
      requirements: { providerConfirmed: false },
    })).toThrowError(expect.objectContaining({ code: 'REFUND_NOT_CONFIRMED' }))

    expect(transition({
      current: pendingRefund,
      command: 'confirm_refund',
      expectedVersion: pendingRefund.version,
      idempotencyKey: 'confirm-refund-ticket-demand-1',
      requirements: { providerConfirmed: true },
    }).toStatus).toBe('refunded')
  })

  it('estado terminal nao aceita mudancas', () => {
    const closed: TravelLifecycleRecord = { ...base, status: 'closed', version: 20 }
    expect(allowedTravelCommands('closed')).toEqual([])
    expect(() => transition({
      current: closed,
      command: 'cancel',
      expectedVersion: 20,
      idempotencyKey: 'cancel-closed',
    })).toThrowError(expect.objectContaining({ code: 'TERMINAL_TRAVEL_STATE' }))
  })

  it('retorna erro de dominio com status HTTP utilizavel pelas APIs', () => {
    try {
      transition({ expectedVersion: 9 })
      throw new Error('esperava falha')
    } catch (error) {
      expect(error).toBeInstanceOf(TravelLifecycleError)
      expect((error as TravelLifecycleError).status).toBe(409)
    }
  })

  it('permite recotacao governada depois que a cotacao anterior chegou a escolha', () => {
    const pendingChoice: TravelLifecycleRecord = { ...base, status: 'pending_choice', version: 8 }
    const plan = transition({
      current: pendingChoice,
      command: 'start_quotation',
      expectedVersion: 8,
      idempotencyKey: 'quote-restart-001',
      requirements: {
        policyEvaluationId: 'policy-evaluation-1',
        policyPassed: true,
        policyHasBlocks: false,
      },
    })

    expect(plan).toMatchObject({ fromStatus: 'pending_choice', toStatus: 'quoting', nextVersion: 9 })
  })

  it('devolve escolha ou aprovacao de merito para ajuste somente com confirmacao humana', () => {
    for (const status of ['pending_merit_approval', 'pending_choice'] as const) {
      const current: TravelLifecycleRecord = { ...base, status, version: 9 }
      const input: Partial<TravelTransitionInput> = {
        current,
        command: 'return_for_adjustment',
        expectedVersion: 9,
        idempotencyKey: `return-adjustment-${status}`,
        requirements: { humanConfirmed: false },
      }
      expect(() => transition(input)).toThrowError(
        expect.objectContaining({ code: 'HUMAN_CONFIRMATION_REQUIRED' }),
      )
      expect(transition({
        ...input,
        requirements: { humanConfirmed: true },
      })).toMatchObject({ fromStatus: status, toStatus: 'submitted', nextVersion: 10 })
    }
  })
})

describe('travel reapproval', () => {
  it('ignora variacao de valor dentro da tolerancia e detecta fornecedor', () => {
    const previous = { amount: 1_000, supplierId: 'supplier-a', currency: 'BRL' }
    const within = assessTravelReapproval(previous, { ...previous, amount: 1_050 }, { amountPercentage: 5 })
    const changed = assessTravelReapproval(previous, { ...previous, supplierId: 'supplier-b' }, { amountPercentage: 5 })

    expect(within.required).toBe(false)
    expect(changed).toMatchObject({ required: true, changedFields: ['supplierId'] })
  })

  it('exige reaprovação quando valor excede tolerancia ou dados criticos mudam', () => {
    const previous = {
      amount: 1_000,
      route: 'GYN/CGH/GYN',
      travelerId: 'employee-1',
      paymentMethodId: 'card-1',
    }
    const assessment = assessTravelReapproval(previous, {
      ...previous,
      amount: 1_101,
      route: 'GYN/GRU/GYN',
    }, { amountPercentage: 10 })

    expect(assessment.required).toBe(true)
    expect(assessment.changedFields).toEqual(['amount', 'route'])
    expect(assessment.previousHash).not.toBe(assessment.currentHash)
  })
})

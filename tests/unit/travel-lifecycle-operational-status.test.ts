import { describe, expect, it } from 'vitest'

import { operationalStatusFromLifecycle } from '@/lib/travel-lifecycle/operational-status'
import type { TravelLifecycleStatus } from '@/lib/travel-lifecycle/types'

describe('travel lifecycle operational status projection', () => {
  it.each<[TravelLifecycleStatus, string]>([
    ['draft', 'pendente'],
    ['submitted', 'pendente'],
    ['pending_merit_approval', 'aguardando_cliente'],
    ['approved_for_quotation', 'em_andamento'],
    ['quoting', 'em_andamento'],
    ['pending_choice', 'aguardando_cliente'],
    ['pending_cost_approval', 'aguardando_cliente'],
    ['approved', 'em_andamento'],
    ['reserving', 'em_andamento'],
    ['reserved', 'em_andamento'],
    ['pending_issuance', 'em_andamento'],
    ['issuing', 'em_andamento'],
    ['issued', 'finalizado'],
    ['partially_issued', 'em_andamento'],
    ['rejected', 'cancelado'],
    ['canceled', 'cancelado'],
    ['expired', 'cancelado'],
    ['failed', 'em_andamento'],
    ['pending_refund', 'em_andamento'],
    ['refunded', 'finalizado'],
    ['closed', 'finalizado'],
  ])('projects %s to %s', (lifecycle, expected) => {
    expect(operationalStatusFromLifecycle(lifecycle)).toBe(expected)
  })

  it('normalizes external formatting and falls back safely', () => {
    expect(operationalStatusFromLifecycle('pending-issuance')).toBe('em_andamento')
    expect(operationalStatusFromLifecycle('unknown')).toBe('pendente')
  })
})

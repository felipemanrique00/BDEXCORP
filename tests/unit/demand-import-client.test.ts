import { describe, expect, it } from 'vitest'

import { createDemandImportBatchKey } from '@/lib/demands-client'
import type { Atendimento } from '@/types'

function demand(id: string, amount: number): Atendimento {
  return {
    id,
    empresa_id: 'company-a',
    funcionario_id: null,
    passageiro_nome: 'Aldo Fernandes Junior',
    tipo_servico: 'Hotel',
    valor_cotacao: amount,
    valor_final: amount,
    agente_user_id: 'user-a',
    status: 'finalizado',
    prioridade: 'media',
    observacoes: '',
    data_atendimento: '2026-07-20',
    created_at: '2026-07-20T10:00:00.000Z',
    updated_at: '2026-07-20T10:00:00.000Z',
  }
}

describe('demand import key', () => {
  it('permanece estavel quando apenas a ordem do lote muda', () => {
    const first = demand('demand-a', 100)
    const second = demand('demand-b', 200)

    expect(createDemandImportBatchKey('wintour', [first, second]))
      .toBe(createDemandImportBatchKey('wintour', [second, first]))
  })

  it('muda quando um dado de negocio relevante muda', () => {
    const current = demand('demand-a', 100)
    const changed = demand('demand-a', 120)

    expect(createDemandImportBatchKey('emissions', [current]))
      .not.toBe(createDemandImportBatchKey('emissions', [changed]))
  })
})

import { describe, expect, it } from 'vitest'

import {
  criarIndiceDuplicatas,
  detectarDuplicata,
  detectarDuplicataNoIndice,
  indexarAtendimentoDuplicado,
} from '@/lib/import-pipeline'
import type { Atendimento } from '@/types'

function demand(id: string, companyId: string, saleNumber: string): Atendimento {
  return {
    id,
    empresa_id: companyId,
    funcionario_id: null,
    passageiro_nome: 'Aldo Fernandes Junior',
    tipo_servico: 'Hotel',
    valor_cotacao: 100,
    valor_final: 100,
    agente_user_id: 'user-a',
    status: 'finalizado',
    prioridade: 'media',
    observacoes: '',
    data_atendimento: '2026-07-20',
    venda_numero: saleNumber,
    created_at: '2026-07-20T10:00:00.000Z',
    updated_at: '2026-07-20T10:00:00.000Z',
  }
}

describe('demand import duplicate index', () => {
  it('does not merge equal sale numbers from different companies', () => {
    const companyA = demand('demand-a', 'company-a', 'SALE-100')
    const companyB = demand('demand-b', 'company-b', 'SALE-100')
    const demands = [companyA, companyB]
    const index = criarIndiceDuplicatas(demands)

    expect(detectarDuplicata(demands, {
      empresa_id: 'company-b',
      venda_numero: 'sale-100',
    })?.id).toBe('demand-b')
    expect(detectarDuplicataNoIndice(index, {
      empresa_id: 'company-b',
      venda_numero: 'sale-100',
    })?.id).toBe('demand-b')
  })

  it('detects a duplicate added during the same import batch', () => {
    const index = criarIndiceDuplicatas([])
    const imported = demand('demand-new', 'company-a', 'SALE-200')
    indexarAtendimentoDuplicado(index, imported)

    expect(detectarDuplicataNoIndice(index, {
      empresa_id: 'company-a',
      venda_numero: ' sale-200 ',
    })?.id).toBe('demand-new')
  })
})

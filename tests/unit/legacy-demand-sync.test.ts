import { describe, expect, it } from 'vitest'

import {
  lifecycleFromLegacyStatus,
  parseLegacyDemands,
  relationalPriorityToLegacy,
} from '@/lib/travel/legacy-demand'

describe('legacy demand migration mapping', () => {
  it('preserves stable identifiers and maps operational fields without deleting history', () => {
    const result = parseLegacyDemands([{
      id: 'atd-100',
      serial_os: 'OS-20260722-0100',
      empresa_id: 'company-1',
      funcionario_id: 'employee-10',
      passageiro_nome: 'Aldo Fernandes Junior',
      tipo_servico: 'Aereo',
      status: 'pendente',
      prioridade: 'urgente',
      valor_cotacao: 1200.5,
      data_atendimento: '22/07/2026',
      detalhes_aereo: {
        origem: 'GYN',
        destino: 'GRU',
        data_ida: '2026-08-15',
        data_volta: '2026-08-18',
      },
    }])

    expect(result.failures).toEqual([])
    expect(result.demands).toHaveLength(1)
    expect(result.demands[0]).toMatchObject({
      id: 'atd-100',
      demandNumber: 'OS-20260722-0100',
      companyId: 'company-1',
      employeeId: 'employee-10',
      serviceType: 'air',
      lifecycleStatus: 'submitted',
      priority: 'urgent',
      travelStartDate: '2026-08-15',
      travelEndDate: '2026-08-18',
      destination: 'GRU',
      estimatedAmount: 1200.5,
      metadata: {
        legacySnapshot: expect.objectContaining({
          id: 'atd-100',
          passageiro_nome: 'Aldo Fernandes Junior',
        }),
      },
    })
  })

  it('reports malformed and duplicate records instead of silently replacing them', () => {
    const base = {
      id: 'atd-duplicate',
      empresa_id: 'company-1',
      passageiro_nome: 'Pessoa Teste',
      tipo_servico: 'Hotel',
      status: 'pendente',
    }
    const result = parseLegacyDemands([base, base, { empresa_id: 'company-1' }])

    expect(result.demands).toHaveLength(1)
    expect(result.failures).toHaveLength(2)
    expect(result.failures[0].issues).toContain('ID duplicado no lote de origem.')
  })

  it.each([
    ['finalizado', 'closed'],
    ['cancelado', 'canceled'],
    ['emitido', 'issued'],
    ['reservado', 'reserved'],
    ['aguardando_aprovacao', 'pending_merit_approval'],
    ['em_andamento', 'quoting'],
  ] as const)('maps status %s to %s', (source, expected) => {
    expect(lifecycleFromLegacyStatus(source)).toBe(expected)
  })

  it.each([
    ['low', 'baixa'],
    ['normal', 'media'],
    ['high', 'alta'],
    ['urgent', 'urgente'],
    ['media', 'media'],
  ] as const)('maps relational priority %s to legacy priority %s', (source, expected) => {
    expect(relationalPriorityToLegacy(source)).toBe(expected)
  })
})

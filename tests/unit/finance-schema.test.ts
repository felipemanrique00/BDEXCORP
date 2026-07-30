import { describe, expect, it } from 'vitest'

import {
  financialEntryCreateSchema,
  financialEntrySchema,
  financialStatusFromDatabase,
  financialStatusToDatabase,
  financialTypeFromDatabase,
  financialTypeToDatabase,
  normalizeLegacyFinancialEntry,
  recalculateFinancialStatus,
} from '@/lib/finance/schema'

function validEntry() {
  return {
    id: 'lan_01',
    tipo: 'receber' as const,
    atendimento_id: 'demand-01',
    empresa_id: 'company-01',
    valor: 1_250.5,
    valor_pago: 0,
    data_emissao: '2026-07-20',
    data_vencimento: '2026-08-20',
    descricao: 'Hospedagem corporativa',
    categoria: 'Hotel',
    forma_pagamento: 'Faturamento' as const,
    status: 'pendente' as const,
    created_at: '2026-07-20T12:00:00.000Z',
    version: 1,
  }
}

describe('financial entry schema', () => {
  it('normalizes numeric values and optional identifiers', () => {
    const result = financialEntrySchema.parse({
      ...validEntry(),
      atendimento_id: ' demand-01 ',
      valor: '1250.50',
      valor_pago: '250.25',
    })

    expect(result).toMatchObject({
      atendimento_id: 'demand-01',
      valor: 1_250.5,
      valor_pago: 250.25,
    })
  })

  it('does not accept server-managed fields in create requests', () => {
    const {
      id: _id,
      status: _status,
      valor_pago: _settled,
      created_at: _createdAt,
      version: _version,
      ...createPayload
    } = validEntry()

    expect(financialEntryCreateSchema.safeParse(createPayload).success).toBe(true)
    expect(financialEntryCreateSchema.safeParse({
      ...createPayload,
      status: 'pago',
    }).success).toBe(false)
    expect(financialEntryCreateSchema.safeParse({
      ...createPayload,
      valor_pago: 1_250.5,
    }).success).toBe(false)
  })

  it('rejects over-settlement and invalid date-only values', () => {
    expect(financialEntrySchema.safeParse({
      ...validEntry(),
      valor_pago: 1_251,
    }).success).toBe(false)
    expect(financialEntrySchema.safeParse({
      ...validEntry(),
      data_vencimento: '20/08/2026',
    }).success).toBe(false)
  })

  it('maps database values and recalculates the effective status', () => {
    expect(financialTypeToDatabase('pagar')).toBe('payable')
    expect(financialTypeFromDatabase('receivable')).toBe('receber')
    expect(financialStatusToDatabase('atrasado')).toBe('overdue')
    expect(financialStatusFromDatabase('partial')).toBe('parcial')
    expect(recalculateFinancialStatus({
      status: 'pendente',
      valor: 100,
      valor_pago: 0,
      data_vencimento: '2026-07-01',
    }, '2026-07-23')).toBe('atrasado')
    expect(recalculateFinancialStatus({
      status: 'pendente',
      valor: 100,
      valor_pago: 100,
      data_vencimento: '2026-08-01',
    }, '2026-07-23')).toBe('pago')
  })

  it('preserves a valid legacy identifier during normalization', () => {
    const result = normalizeLegacyFinancialEntry(validEntry())

    expect(result?.id).toBe('lan_01')
    expect(result?.atendimento_id).toBe('demand-01')
    expect(result?.version).toBe(1)
  })
})

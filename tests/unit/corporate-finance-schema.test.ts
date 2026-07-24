import { describe, expect, it } from 'vitest'

import {
  corporateCardCreateSchema,
  corporateFinanceStateSchema,
  corporateInvoiceGenerateSchema,
  corporateInvoiceSettleSchema,
  corporateWalletConfigSchema,
  corporateWalletMovementCreateSchema,
  normalizeLegacyCorporateFinanceState,
} from '@/lib/corporate-finance/schema'

const createdAt = '2026-07-23T12:00:00.000Z'

function validLegacyState() {
  return {
    carteiras: [{
      id: 'wallet-company-a',
      company_id: 'company-a',
      saldo_disponivel: 5_000,
      limite_credito: 2_000,
      limite_pix_diario: 1_000,
      limite_cartao_mensal: 3_000,
      status: 'ativa',
      pix_habilitado: true,
      cartao_habilitado: true,
      provedor: 'pendente',
      created_at: createdAt,
      version: 2,
    }],
    cartoes: [{
      id: 'card-company-a',
      carteira_id: 'wallet-company-a',
      company_id: 'company-a',
      tipo: 'virtual',
      apelido: 'Viagens',
      funcionario_id: null,
      ultimos4: '1234',
      bandeira: 'Visa',
      limite: 1_500,
      gasto_mes: 250,
      status: 'ativo',
      created_at: createdAt,
      version: 1,
    }],
    movimentos: [{
      id: 'movement-company-a',
      carteira_id: 'wallet-company-a',
      company_id: 'company-a',
      tipo: 'debito',
      origem: 'manual',
      valor: 250,
      descricao: 'Hospedagem corporativa',
      status: 'processado',
      created_at: createdAt,
      processado_em: createdAt,
    }],
    faturas: [{
      id: 'invoice-company-a',
      company_id: 'company-a',
      numero: 'FAT-202607-A',
      periodo_inicio: '2026-07-01',
      periodo_fim: '2026-07-31',
      vencimento: '2026-08-10',
      valor_total: 250,
      valor_pago: 0,
      status: 'aberta',
      lancamento_ids: [],
      atendimento_ids: [],
      created_at: createdAt,
      version: 1,
    }],
  }
}

describe('corporate finance schemas', () => {
  it('normalizes legacy state while preserving permanent identifiers and versions', () => {
    const normalized = normalizeLegacyCorporateFinanceState(validLegacyState())

    expect(normalized.unresolved).toEqual({
      carteiras: [],
      cartoes: [],
      movimentos: [],
      faturas: [],
    })
    expect(normalized.carteiras[0]).toMatchObject({
      id: 'wallet-company-a',
      company_id: 'company-a',
      version: 2,
    })
    expect(normalized.faturas[0]?.id).toBe('invoice-company-a')
  })

  it('keeps invalid legacy records unresolved instead of silently discarding them', () => {
    const state = validLegacyState()
    state.cartoes[0].ultimos4 = '12'

    const normalized = normalizeLegacyCorporateFinanceState(state)

    expect(normalized.cartoes).toHaveLength(0)
    expect(normalized.unresolved.cartoes).toHaveLength(1)
  })

  it('validates wallet limits and optimistic version without accepting unknown fields', () => {
    expect(corporateWalletConfigSchema.parse({
      company_id: 'company-a',
      limite_credito: '2500.50',
      pix_habilitado: true,
      observacoes: ' Controle interno ',
      expectedVersion: '2',
    })).toMatchObject({
      limite_credito: 2_500.5,
      observacoes: 'Controle interno',
      expectedVersion: 2,
    })
    expect(corporateWalletConfigSchema.safeParse({
      company_id: 'company-a',
      limite_credito: -1,
    }).success).toBe(false)
    expect(corporateWalletConfigSchema.safeParse({
      company_id: 'company-a',
      internalOnly: true,
    }).success).toBe(false)
  })

  it('stores only the four final card digits and requires a complete expiry', () => {
    expect(corporateCardCreateSchema.parse({
      company_id: 'company-a',
      tipo: 'virtual',
      apelido: 'Executivo',
      ultimos4: '**** 9876',
      bandeira: 'Mastercard',
      limite: '3000',
      validade_mes: '12',
      validade_ano: '2030',
    })).toMatchObject({
      ultimos4: '9876',
      validade_mes: 12,
      validade_ano: 2030,
    })
    expect(corporateCardCreateSchema.safeParse({
      company_id: 'company-a',
      tipo: 'virtual',
      apelido: 'Executivo',
      ultimos4: '9876',
      bandeira: 'Visa',
      limite: 3_000,
      validade_mes: 12,
    }).success).toBe(false)
  })

  it('requires explicit confirmation, idempotency and provider evidence', () => {
    const manual = {
      company_id: 'company-a',
      tipo: 'credito',
      origem: 'manual',
      valor: 500,
      descricao: 'Ajuste autorizado',
      idempotencyKey: 'movement-20260723-001',
      confirmed: true,
    }
    expect(corporateWalletMovementCreateSchema.safeParse(manual).success).toBe(true)
    expect(corporateWalletMovementCreateSchema.safeParse({
      ...manual,
      origem: 'integracao',
    }).success).toBe(false)
    expect(corporateWalletMovementCreateSchema.safeParse({
      ...manual,
      origem: 'integracao',
      external_reference: 'provider-transaction-01',
    }).success).toBe(true)
    expect(corporateWalletMovementCreateSchema.safeParse({
      ...manual,
      confirmed: false,
    }).success).toBe(false)
  })

  it('validates invoice periods and optimistic settlement', () => {
    const generation = {
      company_id: 'company-a',
      periodo_inicio: '2026-07-01',
      periodo_fim: '2026-07-31',
      vencimento: '2026-08-10',
      idempotencyKey: 'invoice-202607-company-a',
      confirmed: true,
    }
    expect(corporateInvoiceGenerateSchema.safeParse(generation).success).toBe(true)
    expect(corporateInvoiceGenerateSchema.safeParse({
      ...generation,
      periodo_fim: '2026-06-30',
    }).success).toBe(false)
    expect(corporateInvoiceSettleSchema.safeParse({
      valor_pago: '100.50',
      expectedVersion: '3',
      idempotencyKey: 'settlement-invoice-01',
      confirmed: true,
    }).success).toBe(true)
  })

  it('rejects a state whose balance exceeds its configured credit limit', () => {
    const state = validLegacyState()
    state.carteiras[0].saldo_disponivel = -2_001

    expect(corporateFinanceStateSchema.safeParse(state).success).toBe(false)
  })
})

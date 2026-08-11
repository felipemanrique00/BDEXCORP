import { describe, expect, it } from 'vitest'

import {
  assertVoucherStatusTransition,
  normalizeLegacyVoucher,
  voucherCreateSchema,
  voucherSchema,
  voucherStatusFromDatabase,
  voucherStatusToDatabase,
} from '@/lib/vouchers/schema'

function validVoucher() {
  return {
    id: 'H-26262',
    numero: '26262',
    tipo: 'Hotel' as const,
    status: 'emitido' as const,
    empresa_id: 'company-a',
    funcionario_id: null,
    passageiro_nome: 'Ana Souza',
    fornecedor_nome: 'Hotel Central',
    fornecedor_email: 'reservas@example.com',
    total: 1250.5,
    emitido_por_user_id: 'user-a',
    emitido_por_user_name: 'Operador',
    created_at: '2026-07-20T12:00:00.000Z',
  }
}

describe('voucher schema', () => {
  it('normalizes nullable identifiers, e-mail and numeric fields', () => {
    const result = voucherSchema.parse({
      ...validVoucher(),
      empresa_id: ' company-a ',
      funcionario_id: '',
      fornecedor_email: ' RESERVAS@EXAMPLE.COM ',
      noites: '3',
      total: '1250.50',
    })

    expect(result).toMatchObject({
      empresa_id: 'company-a',
      funcionario_id: null,
      fornecedor_email: 'reservas@example.com',
      noites: 3,
      total: 1250.5,
    })
  })

  it('rejects negative totals, malformed e-mails and unknown fields', () => {
    expect(voucherSchema.safeParse({
      ...validVoucher(),
      total: -1,
    }).success).toBe(false)
    expect(voucherSchema.safeParse({
      ...validVoucher(),
      fornecedor_email: 'invalid',
    }).success).toBe(false)
    expect(voucherCreateSchema.safeParse({
      ...validVoucher(),
      id: undefined,
      numero: undefined,
      created_at: undefined,
      emitido_por_user_id: undefined,
      emitido_por_user_name: undefined,
      unexpected: true,
    }).success).toBe(false)
  })

  it('accepts the structured fields generated for an issued air voucher', () => {
    const result = voucherSchema.parse({
      ...validVoucher(),
      id: 'A-26270',
      numero: '26270',
      tipo: 'Aéreo',
      fornecedor_nome: 'GOL',
      sistema_reserva: 'GOL',
      prazo_emissao: '2026-08-11T02:59:00.000Z',
      tarifa_referencia: 550,
      rav: 0,
      rac: 10,
      cambio: 1,
      milhagem: 0,
      trechos_aereos: [{
        sequencia: 1,
        companhia_codigo: 'G3',
        companhia_nome: 'GOL',
        numero_voo: '3399',
        classe_reserva: 'V',
        cabine: 'economy',
        bagagens: 0,
        origem_codigo: 'GYN',
        origem_nome: 'Santa Genoveva International Airport · Goiânia/GO',
        destino_codigo: 'CGH',
        destino_nome: 'Congonhas–Deputado Freitas Nobre Airport · São Paulo/SP',
        saida_em: '2026-09-01T13:00:00.000Z',
        chegada_em: '2026-09-01T14:50:00.000Z',
      }],
      bilhetes_aereos: [{
        passageiro_nome: 'Funcionário Teste Centro de Custo',
        passageiro_ordem: 1,
        passageiro_codigo: 'FUNC-CC-001',
        numero_bilhete: '01091000910',
        companhia_codigo: 'G3',
        companhia_nome: 'GOL',
      }],
    })

    expect(result).toMatchObject({
      id: 'A-26270',
      sistema_reserva: 'GOL',
      rac: 10,
      trechos_aereos: [{ origem_codigo: 'GYN', destino_codigo: 'CGH' }],
      bilhetes_aereos: [{ numero_bilhete: '01091000910' }],
    })
  })

  it('maps database statuses and blocks invalid transitions', () => {
    expect(voucherStatusToDatabase('confirmado')).toBe('confirmed')
    expect(voucherStatusFromDatabase('cancelled')).toBe('cancelado')
    expect(() => assertVoucherStatusTransition('emitido', 'confirmado')).not.toThrow()
    expect(() => assertVoucherStatusTransition('cancelado', 'emitido')).toThrow(
      'Transicao de voucher invalida',
    )
  })

  it('preserves the permanent id when importing a valid legacy voucher', () => {
    const voucher = normalizeLegacyVoucher(validVoucher())

    expect(voucher?.id).toBe('H-26262')
    expect(voucher?.numero).toBe('26262')
    expect(voucher?.created_at).toBe('2026-07-20T12:00:00.000Z')
  })
})

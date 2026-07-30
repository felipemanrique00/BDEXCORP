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

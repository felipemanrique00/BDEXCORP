import { describe, expect, it } from 'vitest'

import {
  canonicalizeVoucherEmailList,
  isSafeVoucherEmail,
  voucherEmailRecipients,
  voucherEmailSubject,
  voucherEmailText,
} from '@/lib/vouchers/email'
import type { VoucherEmitido } from '@/types'

function voucher(): VoucherEmitido {
  return {
    id: 'A-26270',
    numero: '26270',
    tipo: 'Aéreo',
    status: 'emitido',
    empresa_id: 'company-1',
    empresa_nome: 'Empresa Exemplo',
    passageiro_nome: 'Ana Viajante',
    solicitante_nome: 'Bia Solicitante',
    solicitante_email: 'BIA@EXAMPLE.COM',
    hospedes_detalhes: [
      { nome: 'Ana Viajante', email: 'ana@example.com', principal: true },
      { nome: 'Bia duplicada', email: 'bia@example.com' },
      { nome: 'Sem e-mail' },
    ],
    fornecedor_nome: 'GOL',
    cia_aerea: 'GOL',
    localizador: 'ABC123',
    total: 500,
    emitido_por_user_id: 'user-1',
    emitido_por_user_name: 'Operador',
    created_at: '2026-08-10T12:00:00.000Z',
  }
}

describe('voucher email', () => {
  it('deduplicates requester and traveler addresses case-insensitively', () => {
    expect(voucherEmailRecipients(voucher())).toEqual([
      { email: 'bia@example.com', name: 'Bia Solicitante', kind: 'requester' },
      { email: 'ana@example.com', name: 'Ana Viajante', kind: 'traveler' },
    ])
  })

  it('builds a useful subject and plain-text fallback', () => {
    expect(voucherEmailSubject(voucher())).toBe('Voucher A-26270 - Ana Viajante')
    expect(voucherEmailText(voucher())).toContain('Empresa: Empresa Exemplo')
    expect(voucherEmailText(voucher())).toContain('Localizador: ABC123')
  })

  it('canonicalizes and deduplicates linked and custom addresses together', () => {
    expect(canonicalizeVoucherEmailList([
      ' ANA@Example.com ',
      'custom@example.com',
      'ana@example.com',
    ])).toEqual(['ana@example.com', 'custom@example.com'])
  })

  it('rejects header injection and mailbox display-name syntax', () => {
    expect(isSafeVoucherEmail('external@example.com')).toBe(true)
    expect(isSafeVoucherEmail('external@example.com\r\nBcc: attacker@example.com')).toBe(false)
    expect(isSafeVoucherEmail('Pessoa <external@example.com>')).toBe(false)
    expect(isSafeVoucherEmail('external@example.com,attacker@example.com')).toBe(false)
  })

  it('removes line breaks from the generated message subject', () => {
    const unsafeVoucher = voucher()
    unsafeVoucher.passageiro_nome = 'Ana\r\nBcc: attacker@example.com'

    expect(voucherEmailSubject(unsafeVoucher)).toBe(
      'Voucher A-26270 - Ana Bcc: attacker@example.com',
    )
    expect(voucherEmailSubject(unsafeVoucher)).not.toMatch(/[\r\n]/)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS,
  MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS,
  mergeCustomVoucherEmailRecipients,
} from '@/components/vouchers/send-voucher-email-dialog'
import { sendVoucherEmailFromServer } from '@/lib/voucher-persistence-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('destinatários personalizados do voucher', () => {
  it('normaliza, separa por vírgula e remove duplicidades', () => {
    const result = mergeCustomVoucherEmailRecipients({
      rawValue: ' Financeiro@Empresa.com.br, financeiro@empresa.com.br;diretoria@empresa.com.br ',
      currentRecipients: [],
      linkedRecipients: [],
      selectedLinkedCount: 0,
    })

    expect(result).toEqual({
      recipients: ['financeiro@empresa.com.br', 'diretoria@empresa.com.br'],
      error: null,
    })
  })

  it('rejeita e-mail inválido com uma mensagem clara', () => {
    const result = mergeCustomVoucherEmailRecipients({
      rawValue: 'email-invalido',
      currentRecipients: [],
      linkedRecipients: [],
      selectedLinkedCount: 0,
    })

    expect(result.recipients).toEqual([])
    expect(result.error).toContain('não é válido')
  })

  it('impede duplicidade com solicitante ou viajante vinculado', () => {
    const result = mergeCustomVoucherEmailRecipients({
      rawValue: 'SOLICITANTE@EMPRESA.COM.BR',
      currentRecipients: [],
      linkedRecipients: ['solicitante@empresa.com.br'],
      selectedLinkedCount: 1,
    })

    expect(result.recipients).toEqual([])
    expect(result.error).toContain('já está nos destinatários vinculados')
  })

  it('aplica os limites de extras e do total do envio', () => {
    const tenCustomRecipients = Array.from(
      { length: MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS },
      (_, index) => `extra${index}@empresa.com.br`,
    )
    const customLimit = mergeCustomVoucherEmailRecipients({
      rawValue: 'maisum@empresa.com.br',
      currentRecipients: tenCustomRecipients,
      linkedRecipients: [],
      selectedLinkedCount: 0,
    })
    const totalLimit = mergeCustomVoucherEmailRecipients({
      rawValue: 'externo@empresa.com.br',
      currentRecipients: [],
      linkedRecipients: [],
      selectedLinkedCount: MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS,
    })

    expect(customLimit.error).toContain(`máximo ${MAX_CUSTOM_VOUCHER_EMAIL_RECIPIENTS}`)
    expect(totalLimit.error).toContain(`máximo ${MAX_TOTAL_VOUCHER_EMAIL_RECIPIENTS}`)
  })

  it('envia vinculados e personalizados em campos separados e preserva o resultado parcial', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        ok: true,
        recipients: ['solicitante@empresa.com.br'],
        acceptedRecipients: ['solicitante@empresa.com.br'],
        rejectedRecipients: ['externo@empresa.com.br'],
        sentAt: '2026-08-10T18:00:00.000Z',
        duplicate: false,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendVoucherEmailFromServer(
      'voucher-1',
      ['solicitante@empresa.com.br'],
      'voucher-email:key-123456',
      ['externo@empresa.com.br'],
      true,
    )

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      recipients: ['solicitante@empresa.com.br'],
      customRecipients: ['externo@empresa.com.br'],
      acknowledgeExternalDisclosure: true,
      idempotencyKey: 'voucher-email:key-123456',
    })
    expect(result.acceptedRecipients).toEqual(['solicitante@empresa.com.br'])
    expect(result.rejectedRecipients).toEqual(['externo@empresa.com.br'])
  })
})

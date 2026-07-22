import { describe, expect, it } from 'vitest'

import { validateCorporateCardRegistration } from '@/lib/corporate-finance'

describe('validateCorporateCardRegistration', () => {
  it('normaliza somente os quatro últimos dígitos informados', () => {
    const result = validateCorporateCardRegistration(
      { ultimos4: '1234', bandeira: 'Visa', validade_mes: 12, validade_ano: 2030 },
      2026,
    )

    expect(result).toEqual({
      valid: true,
      value: { ultimos4: '1234', bandeira: 'Visa', validade_mes: 12, validade_ano: 2030 },
    })
  })

  it.each(['', '123', '12345', '12 34 56'])('rejeita identificação inválida: %s', (ultimos4) => {
    expect(validateCorporateCardRegistration({ ultimos4, bandeira: 'Mastercard' }, 2026).valid).toBe(false)
  })

  it('rejeita validade inválida ou expirada', () => {
    expect(
      validateCorporateCardRegistration({ ultimos4: '9876', bandeira: 'Elo', validade_mes: 13 }, 2026).valid,
    ).toBe(false)
    expect(
      validateCorporateCardRegistration({ ultimos4: '9876', bandeira: 'Elo', validade_ano: 2025 }, 2026).valid,
    ).toBe(false)
  })
})

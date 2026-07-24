import { describe, expect, it } from 'vitest'

import {
  decodeBase32,
  encodeBase32,
  generateRecoveryCodes,
  generateTotp,
  normalizeRecoveryCode,
  verifyTotp,
} from '@/lib/security/totp'

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('TOTP RFC 6238', () => {
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
  ])('gera o vetor oficial para o instante %s', (timestampSeconds, expected) => {
    expect(generateTotp(RFC_SECRET, {
      digits: 8,
      timestampMs: timestampSeconds * 1_000,
    })).toBe(expected)
  })

  it('aceita a janela configurada e informa o passo utilizado', () => {
    const timestampMs = 1_234_567_890_000
    const previousCode = generateTotp(RFC_SECRET, {
      timestampMs: timestampMs - 30_000,
    })

    expect(verifyTotp(RFC_SECRET, previousCode, { timestampMs, window: 1 }))
      .toBe(Math.floor(timestampMs / 1_000 / 30) - 1)
    expect(verifyTotp(RFC_SECRET, previousCode, { timestampMs, window: 0 })).toBeNull()
  })

  it('faz roundtrip Base32 sem perder bytes', () => {
    const original = Buffer.from('BBT MFA production test')
    expect(decodeBase32(encodeBase32(original))).toEqual(original)
  })
})

describe('codigos de recuperacao', () => {
  it('gera codigos unicos, normalizaveis e com entropia suficiente', () => {
    const codes = generateRecoveryCodes(10)
    expect(new Set(codes).size).toBe(10)
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/)
      expect(normalizeRecoveryCode(code)).toHaveLength(16)
    }
  })
})

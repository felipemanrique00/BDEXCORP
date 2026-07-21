import { describe, expect, it } from 'vitest'

import { hashPassword, isPasswordHash, verifyPassword } from '@/lib/security/password'

describe('password security', () => {
  it('gera salt distinto e valida somente a senha correta', async () => {
    const first = await hashPassword('SenhaForte!2026')
    const second = await hashPassword('SenhaForte!2026')

    expect(isPasswordHash(first)).toBe(true)
    expect(first).not.toBe(second)
    await expect(verifyPassword('SenhaForte!2026', first)).resolves.toBe(true)
    await expect(verifyPassword('senha-incorreta', first)).resolves.toBe(false)
  })

  it('rejeita texto simples e parametros de custo adulterados', async () => {
    await expect(verifyPassword('qualquer', 'qualquer')).resolves.toBe(false)
    await expect(verifyPassword('SenhaForte!2026', 'scrypt$1$1$1$1$c2FsdA$aGFzaA')).resolves.toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { defaultRequesterLoginSelection } from '@/lib/requester-login-access'

describe('requester login access', () => {
  it('nao solicita convite quando o perfil so pode cadastrar o contato', () => {
    expect(defaultRequesterLoginSelection(false, null, false)).toBe(false)
  })

  it('seleciona convite para novo solicitante quando o perfil gerencia usuarios', () => {
    expect(defaultRequesterLoginSelection(true, null, false)).toBe(true)
  })

  it('sincroniza conta existente somente com permissao de gerenciar usuarios', () => {
    expect(defaultRequesterLoginSelection(true, 'linked-user', true)).toBe(true)
    expect(defaultRequesterLoginSelection(false, 'linked-user', true)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import {
  normalizeLegacyRequester,
  requesterPayloadSchema,
  requesterStatusFromDatabase,
  requesterStatusToDatabase,
} from '@/lib/requesters/schema'

describe('requester schema', () => {
  it('normalizes identity fields and preserves explicit portal permissions', () => {
    const result = requesterPayloadSchema.parse({
      company_id: ' company-a ',
      user_id: '',
      funcionario_id: ' employee-a ',
      nome: '  Ana Souza  ',
      email: ' ANA.SOUZA@EXAMPLE.COM ',
      telefone: ' ',
      status: 'pendente',
      pode_criar_demanda: 'false',
      pode_ver_vouchers: true,
      pode_ver_financeiro: false,
      limite_por_solicitacao: '1250.50',
    })

    expect(result).toMatchObject({
      company_id: 'company-a',
      user_id: null,
      funcionario_id: 'employee-a',
      nome: 'Ana Souza',
      email: 'ana.souza@example.com',
      telefone: undefined,
      status: 'pendente',
      pode_criar_demanda: false,
      pode_ver_vouchers: true,
      pode_ver_financeiro: false,
      limite_por_solicitacao: 1250.5,
    })
  })

  it('rejects invalid e-mail and negative request limits', () => {
    const result = requesterPayloadSchema.safeParse({
      company_id: 'company-a',
      nome: 'Ana Souza',
      email: 'invalid',
      limite_por_solicitacao: -1,
    })

    expect(result.success).toBe(false)
  })

  it('converts database statuses without exposing internal values to the UI', () => {
    expect(requesterStatusToDatabase('ativo')).toBe('active')
    expect(requesterStatusToDatabase('bloqueado')).toBe('blocked')
    expect(requesterStatusFromDatabase('inactive')).toBe('bloqueado')
    expect(requesterStatusFromDatabase('pending')).toBe('pendente')
  })

  it('accepts a valid legacy requester without changing its permanent id', () => {
    const requester = normalizeLegacyRequester({
      id: 'sol-permanent',
      company_id: 'company-a',
      nome: 'Ana Souza',
      email: 'ana@example.com',
      status: 'ativo',
      pode_criar_demanda: true,
      pode_ver_vouchers: false,
      pode_ver_financeiro: false,
      created_at: '2026-07-20T12:00:00.000Z',
    })

    expect(requester?.id).toBe('sol-permanent')
    expect(requester?.created_at).toBe('2026-07-20T12:00:00.000Z')
  })
})

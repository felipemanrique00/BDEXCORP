import { describe, expect, it } from 'vitest'

import {
  filterDemandsForOperationalAssignment,
  requesterOwnsDemand,
  scopeDemandsForRequester,
} from '@/lib/demands/requester-ownership'
import type { Atendimento, SolicitanteEmpresa, User } from '@/types'

const requester = {
  id: 'user-requester',
  role: 'colaborador',
  role_key: 'requester',
  corporate_profile: 'requester',
} as Pick<User, 'id' | 'role' | 'role_key' | 'corporate_profile'>

const directory: Array<Pick<SolicitanteEmpresa, 'id' | 'user_id' | 'status'>> = [
  { id: 'requester-own', user_id: requester.id, status: 'ativo' },
  { id: 'requester-other', user_id: 'user-other', status: 'ativo' },
  { id: 'requester-blocked', user_id: requester.id, status: 'bloqueado' },
]

function demand(id: string, requesterId?: string): Pick<Atendimento, 'id' | 'solicitante_id'> {
  return { id, solicitante_id: requesterId }
}

describe('requester demand ownership', () => {
  it('accepts only an active exact requester link', () => {
    expect(requesterOwnsDemand({
      user: requester,
      demand: demand('own', 'requester-own'),
      requesters: directory,
    })).toBe(true)
    expect(requesterOwnsDemand({
      user: requester,
      demand: demand('other', 'requester-other'),
      requesters: directory,
    })).toBe(false)
    expect(requesterOwnsDemand({
      user: requester,
      demand: demand('blocked', 'requester-blocked'),
      requesters: directory,
    })).toBe(false)
    expect(requesterOwnsDemand({
      user: requester,
      demand: demand('unowned'),
      requesters: directory,
    })).toBe(false)
  })

  it('trusts a server-scoped item only for the requester role key', () => {
    const trustedServerDemandIds = new Set(['server-own'])
    expect(requesterOwnsDemand({
      user: requester,
      demand: demand('server-own'),
      requesters: [],
      trustedServerDemandIds,
    })).toBe(true)

    expect(requesterOwnsDemand({
      user: { ...requester, role_key: 'company_admin' },
      demand: demand('server-own'),
      requesters: [],
      trustedServerDemandIds,
    })).toBe(false)
  })

  it('scopes the local queue without changing internal profiles', () => {
    const demands = [demand('own', 'requester-own'), demand('other', 'requester-other')]
    expect(scopeDemandsForRequester({ user: requester, demands, requesters: directory }))
      .toEqual([demands[0]])

    expect(scopeDemandsForRequester({
      user: { ...requester, role: 'master', role_key: 'agent', corporate_profile: undefined },
      demands,
      requesters: directory,
    })).toEqual(demands)
  })

  it('does not hide an owned requester demand after a consultant accepts it', () => {
    const demands = [
      { id: 'assigned-to-consultant', solicitante_id: 'requester-own', agente_user_id: 'consultant-user' },
      { id: 'unassigned', solicitante_id: 'requester-own', agente_user_id: '' },
    ]

    expect(filterDemandsForOperationalAssignment({
      demands,
      userId: requester.id,
      canViewAll: false,
      requesterView: true,
    })).toEqual(demands)

    expect(filterDemandsForOperationalAssignment({
      demands,
      userId: 'another-consultant',
      canViewAll: false,
      requesterView: false,
    })).toEqual([demands[1]])
  })
})

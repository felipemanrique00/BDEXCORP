import { describe, expect, it } from 'vitest'

import {
  createSingleFlightRunner,
  decideSessionUserRefresh,
  sessionAuthorizationFingerprint,
} from '@/lib/session-user-refresh'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { CorporateAccessSummary, User } from '@/types'

describe('session user refresh', () => {
  it('reloads when representation starts or changes', () => {
    const current = internalUser('supervisor')
    const represented = { id: 'imp-1', mode: 'operate', expiresAt: '2026-08-12T12:15:00.000Z' }
    expect(decideSessionUserRefresh(current, {
      reachable: true,
      user: current,
      representation: represented,
    })).toBe('reload')
    expect(decideSessionUserRefresh(current, {
      reachable: true,
      user: current,
      representation: represented,
    }, represented)).toBe('update')
  })
  it('compartilha a consulta em andamento e libera uma nova apos concluir', async () => {
    let calls = 0
    let finishFirstRequest: (() => void) | undefined
    const run = createSingleFlightRunner(async () => {
      calls += 1
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          finishFirstRequest = resolve
        })
      }
      return calls
    })

    const first = run()
    const concurrent = run()
    expect(concurrent).toBe(first)
    await Promise.resolve()
    expect(calls).toBe(1)

    finishFirstRequest!()
    await expect(first).resolves.toBe(1)
    await expect(run()).resolves.toBe(2)
    expect(calls).toBe(2)
  })

  it('recarrega ao promover ou rebaixar o perfil interno', () => {
    const operational = internalUser('operacional')
    const supervisor = internalUser('supervisor')

    expect(decideSessionUserRefresh(operational, {
      reachable: true,
      user: supervisor,
    })).toBe('reload')
    expect(decideSessionUserRefresh(supervisor, {
      reachable: true,
      user: operational,
    })).toBe('reload')
  })

  it('atualiza dados de apresentacao sem recarregar os escopos', () => {
    const current = internalUser('supervisor')
    const renamed = {
      ...current,
      name: 'Nome atualizado',
      email: 'novo-email@example.invalid',
      avatar: 'avatar-atualizado',
    }

    expect(sessionAuthorizationFingerprint(renamed)).toBe(
      sessionAuthorizationFingerprint(current),
    )
    expect(decideSessionUserRefresh(current, {
      reachable: true,
      user: renamed,
    })).toBe('update')
  })

  it('recarrega quando permissoes ou escopo corporativo mudam', () => {
    const current = corporateUser(['company-a'])
    const permissionChanged = corporateUser(['company-a'])
    permissionChanged.permissoes = {
      ...permissionChanged.permissoes!,
      gerenciar_solicitantes: true,
    }
    const scopeChanged = corporateUser(['company-a', 'company-b'])

    expect(decideSessionUserRefresh(current, {
      reachable: true,
      user: permissionChanged,
    })).toBe('reload')
    expect(decideSessionUserRefresh(current, {
      reachable: true,
      user: scopeChanged,
    })).toBe('reload')
  })

  it('ignora ordem e campos volateis do resumo corporativo', () => {
    const current = corporateUser(['company-a', 'company-b'])
    const reordered = corporateUser(['company-b', 'company-a'])
    reordered.corporate_access = {
      ...reordered.corporate_access!,
      refreshedAt: '2099-01-01T00:00:00.000Z',
      companies: [...reordered.corporate_access!.companies].reverse(),
    }

    expect(sessionAuthorizationFingerprint(reordered)).toBe(
      sessionAuthorizationFingerprint(current),
    )
  })

  it('redireciona sessao encerrada e preserva o estado durante indisponibilidade', () => {
    const current = internalUser('supervisor')

    expect(decideSessionUserRefresh(current, {
      reachable: true,
      user: null,
    })).toBe('redirect')
    expect(decideSessionUserRefresh(current, {
      reachable: false,
      user: null,
    })).toBe('keep')
  })
})

function internalUser(profile: 'operacional' | 'supervisor'): User {
  return {
    id: 'internal-user',
    email: 'internal@example.invalid',
    name: 'Internal User',
    role: 'master',
    tenant_id: 'tenant-a',
    membership_id: 'membership-a',
    role_key: profile === 'supervisor' ? 'supervisor' : 'operator',
    platform_admin: false,
    must_change_password: false,
    company_id: null,
    empresa_ids: ['company-a'],
    grupo_ids: [],
    perfil_bbt: profile,
    permissoes: { ...PERMISSOES_PADRAO_POR_PERFIL[profile] },
    ativo: true,
    status: 'active',
  }
}

function corporateUser(companyIds: string[]): User {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    ver_empresas: true,
  }
  const corporateAccess: CorporateAccessSummary = {
    tenantWide: false,
    companyIds,
    groupIds: [],
    companies: companyIds.map((companyId) => ({
      companyId,
      companyName: companyId,
      groupId: null,
      groupName: null,
      sources: ['direct'],
      profiles: ['viewer'],
      permissions,
    })),
    groups: [],
    contexts: companyIds.map((companyId) => ({
      type: 'company',
      id: companyId,
      label: companyId,
      groupId: null,
      companyIds: [companyId],
      canViewConsolidated: false,
    })),
    defaultContext: companyIds[0] ? { type: 'company', id: companyIds[0] } : null,
    refreshedAt: '2026-07-29T00:00:00.000Z',
  }
  return {
    id: 'corporate-user',
    email: 'corporate@example.invalid',
    name: 'Corporate User',
    role: 'company_admin',
    tenant_id: 'tenant-a',
    membership_id: 'membership-corporate',
    role_key: 'company_admin',
    platform_admin: false,
    must_change_password: false,
    company_id: companyIds[0] || null,
    empresa_ids: companyIds,
    grupo_ids: [],
    perfil_bbt: 'operacional',
    corporate_profile: 'viewer',
    corporate_access: corporateAccess,
    permissoes: permissions,
    ativo: true,
    status: 'active',
  }
}

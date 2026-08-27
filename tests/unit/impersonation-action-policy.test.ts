import { describe, expect, it } from 'vitest'

import {
  allowedImpersonationActions,
  type ImpersonationPermissionPrincipal,
} from '@/lib/impersonation-action-policy'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes } from '@/types'

describe('impersonation action policy', () => {
  it('requires the real consultant and represented user capabilities in the same company', () => {
    const actor = principal({
      'company-a': permissions({
        criar_demandas: true,
        operar_cotacoes: true,
        decidir_aprovacoes: true,
      }),
    })
    const target = principal({
      'company-a': permissions({
        criar_demandas: true,
        decidir_aprovacoes: true,
      }),
    })

    expect(allowedImpersonationActions(actor, target, ['company-a'])).toEqual([
      'demand.create',
      'demand.correct',
      'quote.select',
      'approval.decide',
    ])
  })

  it('uses the requester capability for selection and the quotation capability for the consultant', () => {
    const actor = principal({
      'company-a': permissions({ operar_cotacoes: true }),
    })
    const target = principal({
      'company-a': permissions({ criar_demandas: true }),
    })

    expect(allowedImpersonationActions(actor, target, ['company-a'])).toEqual(['quote.select'])
  })

  it('fails closed instead of combining crossed permissions from companies A and B', () => {
    const actor = principal({
      'company-a': permissions({
        criar_demandas: true,
        operar_cotacoes: true,
        decidir_aprovacoes: true,
      }),
      'company-b': permissions({}),
    })
    const target = principal({
      'company-a': permissions({}),
      'company-b': permissions({
        criar_demandas: true,
        decidir_aprovacoes: true,
      }),
    })

    expect(allowedImpersonationActions(actor, target, ['company-a', 'company-b'])).toEqual([])
  })

  it('requires the capability in every company represented by the session', () => {
    const actor = principal({
      'company-a': permissions({ operar_cotacoes: true }),
      'company-b': permissions({ operar_cotacoes: false }),
    })
    const target = principal({
      'company-a': permissions({ criar_demandas: true }),
      'company-b': permissions({ criar_demandas: true }),
    })

    expect(allowedImpersonationActions(actor, target, ['company-a', 'company-b'])).toEqual([])
    expect(allowedImpersonationActions(actor, target, ['company-a'])).toEqual(['quote.select'])
  })
})

function permissions(overrides: Partial<Permissoes>): Permissoes {
  return {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    ...Object.fromEntries(
      Object.keys(PERMISSOES_PADRAO_POR_PERFIL.operacional).map((key) => [key, false]),
    ) as unknown as Permissoes,
    ...overrides,
  }
}

function principal(
  companies: Record<string, Permissoes>,
): ImpersonationPermissionPrincipal {
  const companyIds = Object.keys(companies)
  return {
    user: {
      company_id: companyIds[0] || null,
      empresa_ids: companyIds,
      permissoes: permissions({}),
    },
    corporateAccess: {
      tenantWide: false,
      companyIds,
      groupIds: [],
      companies: Object.entries(companies).map(([companyId, companyPermissions]) => ({
        companyId,
        companyName: companyId,
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['requester'],
        permissions: companyPermissions,
      })),
      groups: [],
      contexts: [],
      defaultContext: null,
      refreshedAt: '2026-08-27T00:00:00.000Z',
    },
  }
}

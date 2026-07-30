import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

import { getNavigationSummary } from '@/lib/server/navigation-summary-service'

describe('navigation summary service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, callback: (client: { query: typeof mocks.query }) => unknown) =>
        callback({ query: mocks.query }),
    )
  })

  it('uses only company scopes with the corresponding server permission', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ unread_inbox: '2', new_demands: '4', active_alerts: '7' }],
    })

    const result = await getNavigationSummary(principal(), 'demand-last')

    expect(result).toEqual({
      unreadInbox: 2,
      newDemands: 4,
      activeAlerts: 7,
    })
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from demands demand'),
      ['tenant-a', ['company-demand'], ['company-voucher'], 'demand-last'],
    )
  })

  it('does not access the database without an authorized company scope', async () => {
    const withoutAccess = principal()
    withoutAccess.corporateAccess = {
      ...withoutAccess.corporateAccess!,
      companies: [],
      companyIds: [],
    }

    await expect(getNavigationSummary(withoutAccess, '')).resolves.toEqual({
      unreadInbox: 0,
      newDemands: 0,
      activeAlerts: 0,
    })
    expect(mocks.withTenantTransaction).not.toHaveBeenCalled()
  })
})

function principal(): RequestPrincipal {
  const deniedPermissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    ver_demandas: false,
    ver_vouchers: false,
  }
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: 'user-a',
      email: 'usuario@tenant.invalid',
      name: 'Usuario',
      role: 'company_admin',
      company_id: 'company-demand',
      ativo: true,
      permissoes: deniedPermissions,
    },
    corporateAccess: {
      tenantWide: false,
      companyIds: ['company-demand', 'company-voucher', 'company-denied'],
      groupIds: [],
      companies: [
        {
          companyId: 'company-demand',
          companyName: 'Demandas',
          groupId: null,
          groupName: null,
          profiles: ['viewer'],
          permissions: { ...deniedPermissions, ver_demandas: true },
          sources: ['group_selected'],
        },
        {
          companyId: 'company-voucher',
          companyName: 'Vouchers',
          groupId: null,
          groupName: null,
          profiles: ['viewer'],
          permissions: { ...deniedPermissions, ver_vouchers: true },
          sources: ['group_selected'],
        },
        {
          companyId: 'company-denied',
          companyName: 'Sem acesso aos modulos',
          groupId: null,
          groupName: null,
          profiles: ['viewer'],
          permissions: deniedPermissions,
          sources: ['group_selected'],
        },
      ],
      groups: [],
      contexts: [],
      defaultContext: null,
      refreshedAt: '2026-07-23T12:00:00.000Z',
    },
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  writeAuditEvent: vi.fn(),
  requireCompanyAccess: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccess: mocks.requireCompanyAccess,
}))

import {
  patchTravelerManagementConfiguration,
} from '@/lib/server/traveler-management-settings-service'

describe('traveler management settings service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.requireCompanyAccess.mockResolvedValue({ companyId: 'company-a' })
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('updates with optimistic locking and audits declared and effective values', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [settingRow({
          allow_requester_traveler_management: null,
          version: 2,
        })],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [settingRow({
          allow_requester_traveler_management: true,
          version: 3,
        })],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          company_id: 'company-a',
          group_id: 'group-a',
          company_allow_requester_traveler_management: true,
          group_allow_requester_traveler_management: false,
        }],
      })

    const configuration = await patchTravelerManagementConfiguration(
      principal(),
      'company',
      'company-a',
      {
        values: { allowRequesterTravelerManagement: true },
        expectedVersion: 2,
      },
    )

    expect(configuration).toMatchObject({
      declared: { allowRequesterTravelerManagement: true },
      effective: {
        allowRequesterTravelerManagement: true,
        sources: { allowRequesterTravelerManagement: 'company' },
      },
      version: 3,
    })
    expect(mocks.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('version = version + 1'),
      [principal().tenantId, 'setting-a', true, principal().user.id, 2],
    )
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'traveler.management_settings.update',
      entityType: 'traveler_management_settings',
      entityId: 'company:company-a',
      metadata: expect.objectContaining({
        before: { allowRequesterTravelerManagement: null },
        after: { allowRequesterTravelerManagement: true },
        version: 3,
      }),
    }))
  })

  it('rejects a stale expected version before writing or auditing', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [settingRow({ version: 4 })],
      })

    await expect(patchTravelerManagementConfiguration(
      principal(),
      'company',
      'company-a',
      {
        values: { allowRequesterTravelerManagement: false },
        expectedVersion: 3,
      },
    )).rejects.toMatchObject({
      code: 'TRAVELER_MANAGEMENT_VERSION_CONFLICT',
      status: 409,
    })

    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })
})

function principal(): RequestPrincipal {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    ver_funcionarios: true,
    alterar_configuracoes: true,
  }
  return {
    sessionId: 'session-a',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds: ['company-a'],
      groupIds: ['group-a'],
      companies: [],
      groups: [],
      contexts: [],
      defaultContext: { type: 'company', id: 'company-a' },
      refreshedAt: '2026-08-11T12:00:00.000Z',
    },
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'admin@test.invalid',
      name: 'Admin',
      role: 'company_admin',
      company_id: 'company-a',
      permissoes: permissions,
    },
  }
}

function settingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'setting-a',
    scope_type: 'company',
    business_group_id: null,
    company_id: 'company-a',
    allow_requester_traveler_management: false,
    version: 1,
    updated_at: '2026-08-11T12:00:00.000Z',
    ...overrides,
  }
}

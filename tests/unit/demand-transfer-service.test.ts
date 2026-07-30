import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  writeAuditEvent: vi.fn(),
  requireCompanyAccess: vi.fn(),
  getEffectiveCompanyAccess: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccess: mocks.requireCompanyAccess,
  getEffectiveCompanyAccess: mocks.getEffectiveCompanyAccess,
}))

import { decideDemandTransferRequest } from '@/lib/server/demand-transfer-service'

const TransferId = '33333333-3333-4333-8333-333333333333'
const SourceUserId = '44444444-4444-4444-8444-444444444444'
const DestinationUserId = '22222222-2222-4222-8222-222222222222'

describe('demand transfer service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.requireCompanyAccess.mockResolvedValue(undefined)
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('allows only the requested destination user to decide a transfer', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [lockedTransfer()] })
    const unauthorized = principal('55555555-5555-4555-8555-555555555555')

    await expect(decideDemandTransferRequest(
      unauthorized,
      TransferId,
      { action: 'accept' },
    )).rejects.toMatchObject({
      code: 'DEMAND_TRANSFER_DECISION_DENIED',
      status: 403,
    })

    expect(mocks.requireCompanyAccess).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('accepts atomically only while the demand version and assignee still match', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [lockedTransfer()] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [transferRow('accepted')] })

    const result = await decideDemandTransferRequest(
      principal(DestinationUserId),
      TransferId,
      { action: 'accept' },
    )

    expect(mocks.requireCompanyAccess).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '11111111-1111-4111-8111-111111111111' }),
      'company-a',
      'criar_demandas',
    )
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('where tenant_id = $1 and id = $2 and version = $3'),
      expect.arrayContaining([
        '11111111-1111-4111-8111-111111111111',
        'demand-a',
        7,
        DestinationUserId,
      ]),
    )
    expect(mocks.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("'transfer_request_accepted'"),
      [
        '11111111-1111-4111-8111-111111111111',
        'demand-a',
        DestinationUserId,
        expect.stringContaining(TransferId),
      ],
    )
    expect(result.status).toBe('accepted')
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'travel.demand.transfer.accept',
        entityId: TransferId,
      }),
    )
  })

  it('refuses an obsolete request without changing the demand', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [lockedTransfer({ demand_version: 8 })],
    })

    await expect(decideDemandTransferRequest(
      principal(DestinationUserId),
      TransferId,
      { action: 'accept' },
    )).rejects.toMatchObject({
      code: 'DEMAND_TRANSFER_DEMAND_CHANGED',
      status: 409,
    })

    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('keeps critical tenant and membership integrity in PostgreSQL', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'deploy/postgres/migrations/0035_demand_transfer_requests.sql'),
      'utf8',
    )

    expect(migration).toContain('foreign key (tenant_id, demand_id)')
    expect(migration).toContain('foreign key (tenant_id, source_user_id)')
    expect(migration).toContain('foreign key (tenant_id, destination_user_id)')
    expect(migration).toContain("where status = 'pending'")
    expect(migration).toContain("select tenant_rls_policy('demand_transfer_requests')")
  })
})

function principal(userId: string): RequestPrincipal {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    criar_demandas: true,
    ver_demandas: true,
  }
  return {
    sessionId: 'session-a',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'agent',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds: ['company-a'],
      groupIds: [],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['manager'],
        permissions,
      }],
      groups: [],
      contexts: [{
        type: 'company',
        id: 'company-a',
        label: 'Empresa A',
        groupId: null,
        companyIds: ['company-a'],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: 'company-a' },
      refreshedAt: '2026-07-23T12:00:00.000Z',
    },
    user: {
      id: userId,
      email: 'agente@empresa.test',
      name: 'Agente',
      role: 'master',
      company_id: 'company-a',
      ativo: true,
      permissoes: permissions,
    },
  }
}

function lockedTransfer(overrides: Record<string, unknown> = {}) {
  return {
    ...transferRow('pending'),
    demand_version: 7,
    assigned_to_user_id: SourceUserId,
    ...overrides,
  }
}

function transferRow(status: 'pending' | 'accepted') {
  return {
    id: TransferId,
    demand_id: 'demand-a',
    company_id: 'company-a',
    company_name: 'Empresa A',
    passenger_name: 'Passageiro',
    source_user_id: SourceUserId,
    source_user_name: 'Agente origem',
    destination_user_id: DestinationUserId,
    destination_user_name: 'Agente destino',
    reason: 'Redistribuicao por capacidade operacional',
    status,
    requested_demand_version: 7,
    response_reason: null,
    requested_at: '2026-07-23T12:00:00.000Z',
    responded_at: status === 'pending' ? null : '2026-07-23T12:05:00.000Z',
    expires_at: '2099-07-30T12:00:00.000Z',
  }
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  writeAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

import {
  getDomainRollout,
  updateDomainRollout,
} from '@/lib/server/domain-rollout-service'

describe('domain migration rollout service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('uses the explicit relational registry default without enabling automatic cutover', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] })

    const rollout = await getDomainRollout(principal(), 'finance')

    expect(rollout).toMatchObject({
      domainKey: 'finance',
      readMode: 'relational',
      writeMode: 'relational',
      status: 'active',
      metadata: {
        persisted: false,
        automaticCutover: false,
      },
    })
  })

  it('blocks relational cutover without a successful zero-discrepancy shadow run', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [rolloutRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })

    await expect(updateDomainRollout(principal(), {
      domainKey: 'demands',
      readMode: 'relational',
      writeMode: 'relational',
      status: 'active',
      pilotCompanyIds: [],
      expectedVersion: 1,
      reason: 'Cutover controlado depois da validacao do dominio.',
      confirmed: true,
    })).rejects.toMatchObject({
      code: 'DOMAIN_ROLLOUT_EVIDENCE_REQUIRED',
      status: 409,
    })

    expect(mocks.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("and mode = 'shadow'"),
      [principal().tenantId, 'demands'],
    )
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('allows an explicit rollback from relational read to shadow without deleting data', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [rolloutRow({ read_mode: 'relational', write_mode: 'relational', version: 4 })],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [rolloutRow({ read_mode: 'shadow', write_mode: 'dual', version: 5 })],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })

    const rollout = await updateDomainRollout(principal(), {
      domainKey: 'demands',
      readMode: 'shadow',
      writeMode: 'dual',
      status: 'active',
      pilotCompanyIds: [],
      expectedVersion: 4,
      reason: 'Rollback preventivo para investigar divergencia detectada.',
      confirmed: true,
    })

    expect(rollout).toMatchObject({
      readMode: 'shadow',
      writeMode: 'dual',
      version: 5,
    })
    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.stringContaining("and mode = 'shadow'"),
      expect.anything(),
    )
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.domain_rollout.update',
        metadata: expect.objectContaining({
          reason: 'Rollback preventivo para investigar divergencia detectada.',
        }),
      }),
    )
  })

  it('seeds every guarded compatibility domain for existing tenants', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'deploy/postgres/migrations/0039_seed_domain_rollouts.sql'),
      'utf8',
    )

    for (const domain of ['approvals', 'demands', 'emissions', 'finance', 'requesters', 'vouchers']) {
      expect(migration).toContain(`('${domain}')`)
    }
    expect(migration).toContain("'shadow'")
    expect(migration).toContain("'dual'")
    expect(migration).toContain("'automaticCutover', false")
    expect(migration).toContain('on conflict (tenant_id, domain_key) do nothing')
  })
})

function principal(): RequestPrincipal {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.lider,
  }
  return {
    sessionId: 'session-a',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'tenant_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: true,
      companyIds: [],
      groupIds: [],
      companies: [],
      groups: [],
      contexts: [],
      defaultContext: null,
      refreshedAt: '2026-07-23T12:00:00.000Z',
    },
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'admin@empresa.test',
      name: 'Administrador',
      role: 'master',
      perfil_bbt: 'lider',
      company_id: '',
      ativo: true,
      permissoes: permissions,
    },
  }
}

function rolloutRow(overrides: Record<string, unknown> = {}) {
  return {
    domain_key: 'demands',
    read_mode: 'shadow',
    write_mode: 'dual',
    status: 'active',
    version: 1,
    metadata: { automaticCutover: false },
    updated_at: '2026-07-23T12:00:00.000Z',
    pilot_company_ids: [],
    ...overrides,
  }
}

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
  createExecutiveReportSnapshot,
  deleteExecutiveReportSnapshot,
  listExecutiveReportSnapshots,
} from '@/lib/server/report-snapshot-service'

describe('executive report snapshot service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('lists only snapshots owned by the authenticated user', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        id: 'snapshot-a',
        payload: validSnapshot(),
        period_label: 'Julho de 2026',
        created_at: '2026-07-23T12:00:00.000Z',
      }],
    })

    const snapshots = await listExecutiveReportSnapshots(principal())

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({ id: 'snapshot-a', periodo: 'Julho de 2026' })
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('and owner_user_id = $2'),
      [principal().tenantId, principal().user.id, 30],
    )
  })

  it('creates the snapshot and trims only the current owner history', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'snapshot-created',
          payload: validSnapshot(),
          period_label: 'Julho de 2026',
          created_at: '2026-07-23T12:00:00.000Z',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })

    const created = await createExecutiveReportSnapshot(principal(), validSnapshot())

    expect(created.id).toBe('snapshot-created')
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('and owner_user_id = $2'),
      [principal().tenantId, principal().user.id, 30],
    )
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'report.snapshot.create',
        entityId: 'snapshot-created',
      }),
    )
  })

  it('does not accept invalid metrics even when called outside the HTTP route', async () => {
    await expect(createExecutiveReportSnapshot(principal(), {
      ...validSnapshot(),
      policyRate: 101,
    })).rejects.toMatchObject({
      code: 'REPORT_SNAPSHOT_INVALID',
      status: 400,
    })

    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('deletes only by tenant, owner and snapshot id', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await deleteExecutiveReportSnapshot(principal(), 'snapshot-a')

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('owner_user_id = $3'),
      [principal().tenantId, 'snapshot-a', principal().user.id],
    )
  })

  it('keeps owner integrity and RLS in PostgreSQL', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'deploy/postgres/migrations/0038_ai_settings_and_report_snapshots.sql'),
      'utf8',
    )

    expect(migration).toContain('foreign key (tenant_id, owner_user_id)')
    expect(migration).toContain("select tenant_rls_policy('report_snapshots')")
    expect(migration).toContain('report_snapshots_owner_idx')
  })
})

function principal(): RequestPrincipal {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    ver_relatorios: true,
    gerar_relatorios: true,
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
      companies: [],
      groups: [],
      contexts: [],
      defaultContext: null,
      refreshedAt: '2026-07-23T12:00:00.000Z',
    },
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'agente@empresa.test',
      name: 'Agente',
      role: 'master',
      perfil_bbt: 'operacional',
      company_id: 'company-a',
      ativo: true,
      permissoes: permissions,
    },
  }
}

function validSnapshot() {
  return {
    periodo: 'Julho de 2026',
    totalSpend: 1500,
    total_demandas: 5,
    por_tipo: { Aereo: 1000, Hotel: 500 },
    policyRate: 80,
    co2: 42.5,
    onlineAdoption: 60,
    faturamento_total: 1750,
    insights: ['Demanda estavel'],
    recomendacoes: ['Antecipar compras'],
    riscos: [],
  }
}

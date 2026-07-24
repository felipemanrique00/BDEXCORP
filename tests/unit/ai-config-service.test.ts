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
  getTenantAiConfig,
  updateTenantAiConfig,
} from '@/lib/server/ai-config-service'

describe('tenant AI configuration service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('reads the relational tenant configuration', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        config: {
          scope: 'restrito',
          permitirInternet: false,
          permitirCriarDemandas: false,
          permitirCadastrarHoteis: false,
          permitirReservasTech: false,
          permitirFinanceiro: false,
          exigirConfirmacaoExecucao: true,
          assuntosBloqueados: 'dados pessoais',
        },
      }],
    })

    const config = await getTenantAiConfig(principal())

    expect(config).toMatchObject({
      scope: 'restrito',
      permitirInternet: false,
      exigirConfirmacaoExecucao: true,
    })
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from tenant_ai_settings'),
      [principal().tenantId],
    )
  })

  it('imports the legacy value only when no relational setting exists', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          value: {
            scope: 'sistema_viagens',
            permitirInternet: true,
            permitirCriarDemandas: true,
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const config = await getTenantAiConfig(principal())

    expect(config.scope).toBe('sistema_viagens')
    expect(mocks.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('insert into tenant_ai_settings'),
      expect.arrayContaining([principal().tenantId, expect.any(String), principal().user.id]),
    )
  })

  it('rejects updates without an administrative permission', async () => {
    const unauthorized = principal()

    await expect(updateTenantAiConfig(unauthorized, validConfig()))
      .rejects.toMatchObject({
        code: 'AI_CONFIG_UPDATE_DENIED',
        status: 403,
      })

    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('updates and audits an authorized tenant setting', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const updated = await updateTenantAiConfig(
      principal({ alterar_configuracoes: true }),
      validConfig(),
    )

    expect(updated.scope).toBe('tudo')
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('on conflict (tenant_id) do update'),
      expect.arrayContaining([principal().tenantId, expect.any(String), principal().user.id]),
    )
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assistant.ai_config.update',
        entityType: 'tenant_ai_settings',
      }),
    )
  })

  it('keeps tenant membership integrity and RLS in PostgreSQL', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'deploy/postgres/migrations/0038_ai_settings_and_report_snapshots.sql'),
      'utf8',
    )

    expect(migration).toContain('references tenant_memberships(tenant_id, user_id)')
    expect(migration).toContain("select tenant_rls_policy('tenant_ai_settings')")
  })
})

function principal(extraPermissions: Record<string, boolean> = {}): RequestPrincipal {
  const permissions = {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    ...extraPermissions,
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
      email: 'agente@empresa.test',
      name: 'Agente',
      role: 'master',
      perfil_bbt: 'operacional',
      company_id: '',
      ativo: true,
      permissoes: permissions,
    },
  }
}

function validConfig() {
  return {
    scope: 'tudo' as const,
    permitirInternet: true,
    permitirCriarDemandas: true,
    permitirCadastrarHoteis: true,
    permitirReservasTech: true,
    permitirFinanceiro: false,
    exigirConfirmacaoExecucao: true,
    assuntosBloqueados: '',
  }
}

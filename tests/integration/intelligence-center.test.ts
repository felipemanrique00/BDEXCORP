import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  getIntelligenceOverview,
  transitionIntelligenceInsightState,
} from '@/lib/server/intelligence-service'
import { closeDatabasePool } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL intelligence center', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const companyA = `company-${randomUUID()}`
  const companyB = `company-${randomUUID()}`
  const principal = principalFor(tenantId, userId, [companyA, companyB])
  const filters = {
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    contextType: 'company' as const,
    contextId: companyA,
  }

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Intelligence Tenant', $2)`,
      [tenantId, `intelligence-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Intelligence Manager')`,
      [userId, `intelligence-${userId}@test.invalid`],
    )
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `insert into companies (id, tenant_id, legal_name)
       values
         ($1, $3, 'Intelligence Company A'),
         ($2, $3, 'Intelligence Company B')`,
      [companyA, companyB, tenantId],
    ))
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `insert into demands (
         id, tenant_id, company_id, demand_number, service_type,
         passenger_name_snapshot, status, lifecycle_status, priority,
         travel_start_date, cost_center, estimated_amount, final_amount,
         sla_due_at, metadata, created_at, updated_at
       ) values (
         $1, $2, $3, 'OS-INT-001', 'air',
         'ALDO FERNANDES JUNIOR', 'em_andamento', 'quoting', 'normal',
         '2026-06-11', null, 1300, 1000,
         '2026-06-12T12:00:00Z', $4::jsonb,
         '2026-06-10T10:00:00Z', '2026-06-10T10:00:00Z'
       )`,
      [
        `demand-${randomUUID()}`,
        tenantId,
        companyA,
        JSON.stringify({
          legacySnapshot: { valor_referencia_economia: 1500 },
          serviceDetails: { air: { cia_aerea: 'Companhia Teste' } },
        }),
      ],
    ))
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = $1', [userId])
    await pool.end()
  })

  it('calculates final customer values and deterministic opportunities in scope', async () => {
    const overview = await getIntelligenceOverview(principal, filters)

    expect(overview.scope.companyIds).toEqual([companyA])
    expect(overview.kpis.totalSpend).toBe(1000)
    expect(overview.kpis.verifiedSavings).toBe(500)
    expect(overview.kpis.transactions).toBe(1)
    expect(overview.kpis.urgentTransactions).toBe(1)
    expect(overview.kpis.overdueSla).toBe(1)
    expect(overview.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'air', total: 1000 }),
    ]))
    expect(overview.insights).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'late_purchase', status: 'open' }),
      expect.objectContaining({ type: 'overdue_sla', status: 'open' }),
    ]))
    expect(JSON.stringify(overview)).not.toMatch(/markup|margin|lucro/i)
  })

  it('persists an audited insight decision with optimistic concurrency', async () => {
    const overview = await getIntelligenceOverview(principal, filters)
    const insight = overview.insights.find((item) => item.type === 'overdue_sla')
    expect(insight).toBeDefined()

    const resolved = await transitionIntelligenceInsightState(
      principal,
      insight!.fingerprint,
      {
        ...filters,
        status: 'resolved',
        expectedVersion: insight!.version,
        note: 'Fila revisada e demanda redistribuida para tratamento.',
      },
    )
    expect(resolved.status).toBe('resolved')
    expect(resolved.version).toBe(insight!.version + 1)

    await expect(transitionIntelligenceInsightState(
      principal,
      insight!.fingerprint,
      {
        ...filters,
        status: 'open',
        expectedVersion: insight!.version,
        note: 'Tentativa concorrente com versao antiga do sinal.',
      },
    )).rejects.toMatchObject({ code: 'INTELLIGENCE_INSIGHT_CONFLICT' })

    const events = await tenantTransaction(pool, tenantId, (client) => client.query(
      `select action from intelligence_insight_events
       where tenant_id = $1
         and insight_state_id = (
           select id from intelligence_insight_states
           where tenant_id = $1 and fingerprint = $2
         )
       order by created_at`,
      [tenantId, insight!.fingerprint],
    ))
    expect(events.rows.map((row) => row.action)).toEqual(['detected', 'resolved'])
  })

  it('does not aggregate a different authorized company into the requested company', async () => {
    const overview = await getIntelligenceOverview(principal, {
      ...filters,
      contextId: companyB,
    })
    expect(overview.kpis.transactions).toBe(0)
    expect(overview.kpis.totalSpend).toBe(0)
    expect(overview.insights).toEqual([])
  })

  it('derives company, exact group and custom tenant scopes from company ids', async () => {
    const companyScope = await getIntelligenceOverview(principal, {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      companyIds: [companyA],
    })
    expect(companyScope.scope).toMatchObject({
      type: 'company',
      id: companyA,
      companyIds: [companyA],
    })

    const groupedPrincipal = principalFor(tenantId, userId, [companyA, companyB])
    groupedPrincipal.corporateAccess!.groups = [{
      groupId: 'group-intelligence',
      groupName: 'Intelligence Group',
      companyIds: [companyA, companyB],
      canViewConsolidated: true,
      accessModes: ['selected_companies'],
      profiles: ['manager'],
    }]
    const groupScope = await getIntelligenceOverview(groupedPrincipal, {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      companyIds: [companyB, companyA],
    })
    expect(groupScope.scope).toMatchObject({
      type: 'group',
      id: 'group-intelligence',
      companyIds: [companyB, companyA],
    })

    const tenantWidePrincipal = principalFor(tenantId, userId, [companyA, companyB])
    tenantWidePrincipal.corporateAccess!.tenantWide = true
    const customScope = await getIntelligenceOverview(tenantWidePrincipal, {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      companyIds: [companyA, companyB],
    })
    expect(customScope.scope).toMatchObject({
      type: 'tenant',
      id: null,
      companyIds: [companyA, companyB],
    })
    expect(customScope.scope.label).toContain('Selecao personalizada')
  })

  it('rejects company selections outside the effective intelligence scope', async () => {
    await expect(getIntelligenceOverview(principal, {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      companyIds: [companyA, 'company-not-authorized'],
    })).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' })
  })
})

function principalFor(
  tenantId: string,
  userId: string,
  companyIds: string[],
): RequestPrincipal {
  const permissions: Permissoes = {
    ...PERMISSOES_PADRAO_POR_PERFIL.lider,
    ver_inteligencia: true,
    gerenciar_ia: true,
    ver_politicas: true,
    ver_orcamentos: true,
    ver_financeiro: false,
  }
  return {
    sessionId: randomUUID(),
    tenantId,
    tenantSlug: `intelligence-${tenantId}`,
    tenantStatus: 'active',
    membershipId: randomUUID(),
    roleKey: 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds,
      groupIds: [],
      companies: companyIds.map((companyId) => ({
        companyId,
        companyName: companyId === companyIds[0]
          ? 'Intelligence Company A'
          : 'Intelligence Company B',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['company_admin'],
        permissions,
      })),
      groups: [],
      contexts: companyIds.map((companyId) => ({
        type: 'company' as const,
        id: companyId,
        label: companyId,
        groupId: null,
        companyIds: [companyId],
        canViewConsolidated: false,
      })),
      defaultContext: { type: 'company', id: companyIds[0] },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: userId,
      email: `intelligence-${userId}@test.invalid`,
      name: 'Intelligence Manager',
      role: 'company_admin',
      company_id: companyIds[0],
      empresa_ids: companyIds,
      perfil_bbt: 'lider',
      permissoes: permissions,
      ativo: true,
    },
  }
}

async function tenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await operation(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

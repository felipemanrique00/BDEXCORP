import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDatabasePool } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { searchUniversal } from '@/lib/server/universal-search-service'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL universal search authorization', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const membershipId = randomUUID()
  const roleId = randomUUID()
  const suffix = randomUUID()
  const allowedGroupId = `group-allowed-${suffix}`
  const deniedGroupId = `group-denied-${suffix}`
  const allowedCompanyId = `company-allowed-${suffix}`
  const deniedCompanyId = `company-denied-${suffix}`
  const allowedEmployeeId = `employee-allowed-${suffix}`
  const deniedEmployeeId = `employee-denied-${suffix}`

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Universal Search Tenant', $2)`,
      [tenantId, `universal-search-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Search Operator')`,
      [userId, `search-${userId}@test.invalid`],
    )
    await tenantQuery(
      `insert into roles (id, tenant_id, role_key, name)
       values ($1, $2, 'search_test_role', 'Search test role')`,
      [roleId, tenantId],
    )
    await tenantQuery(
      `insert into tenant_memberships (id, tenant_id, user_id, role_id)
       values ($1, $2, $3, $4)`,
      [membershipId, tenantId, userId, roleId],
    )
    await tenantQuery(
      `insert into business_groups (id, tenant_id, name)
       values ($1, $3, 'Grupo Autorizado'), ($2, $3, 'Grupo Restrito')`,
      [allowedGroupId, deniedGroupId, tenantId],
    )
    await tenantQuery(
      `insert into companies (id, tenant_id, group_id, legal_name, trade_name)
       values
         ($1, $3, $4, 'Alfa Autorizada S.A.', 'Alfa Autorizada'),
         ($2, $3, $5, 'Beta Sigilosa S.A.', 'Beta Sigilosa')`,
      [allowedCompanyId, deniedCompanyId, tenantId, allowedGroupId, deniedGroupId],
    )
    await tenantQuery(
      `insert into employees (
         id, tenant_id, company_id, identification_code, full_name, job_title
       ) values
         ($1, $3, $4, $5, 'Joao Alvares Colaborador', 'Analista'),
         ($2, $3, $6, $7, 'Joao Restrito Colaborador', 'Diretor')`,
      [
        allowedEmployeeId,
        deniedEmployeeId,
        tenantId,
        allowedCompanyId,
        `EMP-A-${suffix}`,
        deniedCompanyId,
        `EMP-B-${suffix}`,
      ],
    )
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantQuery('delete from tenants where id = $1', [tenantId])
    await pool.query('delete from users where id = $1', [userId])
    await pool.end()
  })

  it('returns relational records from an authorized company', async () => {
    const result = await searchUniversal(principal(), {
      query: 'joao alvares',
      types: ['employee'],
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      kind: 'employee',
      id: allowedEmployeeId,
      companyId: allowedCompanyId,
      companyName: 'Alfa Autorizada',
    })
  })

  it('does not leak records from another company in the same tenant', async () => {
    const result = await searchUniversal(principal(), {
      query: 'joao colaborador',
      types: ['employee'],
      limit: 20,
    })

    expect(result.items.map((item) => item.id)).toEqual([allowedEmployeeId])
    expect(result.items.some((item) => item.companyId === deniedCompanyId)).toBe(false)
  })

  it('does not trust tenant RLS as company authorization', async () => {
    const result = await searchUniversal(principal(), {
      query: 'beta sigilosa',
      types: ['company', 'group'],
    })

    expect(result.items).toEqual([])
  })

  function principal(): RequestPrincipal {
    const permissions = {
      ...PERMISSOES_PADRAO_POR_PERFIL.lider,
      usar_busca_global: true,
      ver_empresas: true,
      ver_funcionarios: true,
    }
    return {
      sessionId: `session-${userId}`,
      tenantId,
      tenantSlug: `universal-search-${tenantId}`,
      tenantStatus: 'active',
      membershipId,
      roleKey: 'search_test_role',
      platformAdmin: false,
      planKey: 'business',
      entitlements: {},
      limits: { users: null, storageBytes: null, monthlyOperations: null },
      corporateAccess: {
        tenantWide: false,
        companyIds: [allowedCompanyId],
        groupIds: [allowedGroupId],
        companies: [{
          companyId: allowedCompanyId,
          companyName: 'Alfa Autorizada',
          groupId: allowedGroupId,
          groupName: 'Grupo Autorizado',
          sources: ['group_selected'],
          profiles: ['manager'],
          permissions,
        }],
        groups: [{
          groupId: allowedGroupId,
          groupName: 'Grupo Autorizado',
          companyIds: [allowedCompanyId],
          canViewConsolidated: true,
          accessModes: ['selected_companies'],
          profiles: ['manager'],
        }],
        contexts: [{
          type: 'company',
          id: allowedCompanyId,
          label: 'Alfa Autorizada',
          groupId: allowedGroupId,
          companyIds: [allowedCompanyId],
          canViewConsolidated: false,
        }],
        defaultContext: { type: 'company', id: allowedCompanyId },
        refreshedAt: new Date().toISOString(),
      },
      user: {
        id: userId,
        email: `search-${userId}@test.invalid`,
        name: 'Search Operator',
        role: 'master',
        company_id: allowedCompanyId,
        ativo: true,
        permissoes: permissions,
      },
    }
  }

  async function tenantQuery(text: string, values: unknown[]) {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
      const result = await client.query(text, values)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }
})

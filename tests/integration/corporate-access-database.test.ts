import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL corporate access integrity', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const userA = randomUUID()
  const userB = randomUUID()
  const roleA = randomUUID()
  const roleB = randomUUID()
  const membershipA = randomUUID()
  const membershipB = randomUUID()
  const groupA = `group-${randomUUID()}`
  const otherGroupA = `group-${randomUUID()}`
  const groupB = `group-${randomUUID()}`
  const companyA = `company-${randomUUID()}`
  const otherCompanyA = `company-${randomUUID()}`
  const companyB = `company-${randomUUID()}`
  const selectedGrantA = randomUUID()
  const snapshotA = `snapshot-${randomUUID()}`
  const snapshotB = `snapshot-${randomUUID()}`

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Corporate Tenant A', $2), ($3, 'Corporate Tenant B', $4)`,
      [tenantA, `corporate-a-${tenantA}`, tenantB, `corporate-b-${tenantB}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Corporate User A'), ($3, $4, 'Corporate User B')`,
      [userA, `corporate-a-${userA}@test.invalid`, userB, `corporate-b-${userB}@test.invalid`],
    )
    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'company_admin', 'Company admin A')`,
        [roleA, tenantA],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id)
         values ($1, $2, $3, $4)`,
        [membershipA, tenantA, userA, roleA],
      )
      await client.query(
        `insert into business_groups (id, tenant_id, name)
         values ($1, $2, 'Group A'), ($3, $2, 'Other Group A')`,
        [groupA, tenantA, otherGroupA],
      )
      await client.query(
        `insert into companies (id, tenant_id, group_id, legal_name)
         values ($1, $2, $3, 'Company A'), ($4, $2, $5, 'Other Company A')`,
        [companyA, tenantA, groupA, otherCompanyA, otherGroupA],
      )
      await client.query(
        `insert into corporate_group_access_grants (
           id, tenant_id, membership_id, business_group_id, corporate_profile,
           access_mode, can_view_consolidated
         ) values ($1, $2, $3, $4, 'manager', 'selected_companies', true)`,
        [selectedGrantA, tenantA, membershipA, groupA],
      )
      await client.query(
        `insert into corporate_group_access_companies (tenant_id, group_access_grant_id, company_id)
         values ($1, $2, $3)`,
        [tenantA, selectedGrantA, companyA],
      )
      await client.query(
        `insert into corporate_company_access_grants (
           tenant_id, membership_id, company_id, corporate_profile
         ) values ($1, $2, $3, 'viewer')`,
        [tenantA, membershipA, otherCompanyA],
      )
      await client.query(
        `insert into tenant_ai_settings (tenant_id, config, updated_by_user_id)
         values ($1, '{"provider":"openai"}', $2)`,
        [tenantA, userA],
      )
      await client.query(
        `insert into report_snapshots (
           id, tenant_id, owner_user_id, period_label, payload
         ) values ($1, $2, $3, 'Periodo A', '{"owner":"A"}')`,
        [snapshotA, tenantA, userA],
      )
    })

    await tenantTransaction(pool, tenantB, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'company_admin', 'Company admin B')`,
        [roleB, tenantB],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id)
         values ($1, $2, $3, $4)`,
        [membershipB, tenantB, userB, roleB],
      )
      await client.query(
        `insert into business_groups (id, tenant_id, name) values ($1, $2, 'Group B')`,
        [groupB, tenantB],
      )
      await client.query(
        `insert into companies (id, tenant_id, group_id, legal_name)
         values ($1, $2, $3, 'Company B')`,
        [companyB, tenantB, groupB],
      )
      await client.query(
        `insert into corporate_company_access_grants (
           tenant_id, membership_id, company_id, corporate_profile
         ) values ($1, $2, $3, 'viewer')`,
        [tenantB, membershipB, companyB],
      )
      await client.query(
        `insert into tenant_ai_settings (tenant_id, config, updated_by_user_id)
         values ($1, '{"provider":"gemini"}', $2)`,
        [tenantB, userB],
      )
      await client.query(
        `insert into report_snapshots (
           id, tenant_id, owner_user_id, period_label, payload
         ) values ($1, $2, $3, 'Periodo B', '{"owner":"B"}')`,
        [snapshotB, tenantB, userB],
      )
    })
  })

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantA, tenantB]])
    await pool.query('delete from users where id = any($1::uuid[])', [[userA, userB]])
    await pool.end()
  })

  it('isola vinculos e empresas selecionadas por tenant com RLS', async () => {
    const visibleA = await tenantTransaction(pool, tenantA, async (client) => {
      const groupGrants = await client.query<{ business_group_id: string }>(
        'select business_group_id from corporate_group_access_grants',
      )
      const companyGrants = await client.query<{ company_id: string }>(
        'select company_id from corporate_company_access_grants',
      )
      const selected = await client.query<{ company_id: string }>(
        'select company_id from corporate_group_access_companies',
      )
      return {
        groupIds: groupGrants.rows.map((row) => row.business_group_id),
        companyIds: companyGrants.rows.map((row) => row.company_id),
        selectedIds: selected.rows.map((row) => row.company_id),
      }
    })

    expect(visibleA).toEqual({
      groupIds: [groupA],
      companyIds: [otherCompanyA],
      selectedIds: [companyA],
    })

    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into corporate_company_access_grants (
         tenant_id, membership_id, company_id, corporate_profile
       ) values ($1, $2, $3, 'viewer')`,
      [tenantB, membershipB, companyB],
    ))).rejects.toThrow()
  })

  it('isola configuracao de IA e snapshots de relatorio por tenant', async () => {
    const visibleA = await tenantTransaction(pool, tenantA, async (client) => {
      const settings = await client.query<{ tenant_id: string; config: { provider: string } }>(
        'select tenant_id, config from tenant_ai_settings',
      )
      const snapshots = await client.query<{ id: string; owner_user_id: string }>(
        'select id, owner_user_id from report_snapshots',
      )
      return {
        settings: settings.rows,
        snapshots: snapshots.rows,
      }
    })

    expect(visibleA).toEqual({
      settings: [{ tenant_id: tenantA, config: { provider: 'openai' } }],
      snapshots: [{ id: snapshotA, owner_user_id: userA }],
    })

    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into report_snapshots (
         id, tenant_id, owner_user_id, period_label, payload
       ) values ($1, $2, $3, 'Tenant cruzado', '{}')`,
      [`forbidden-${randomUUID()}`, tenantB, userB],
    ))).rejects.toThrow()
  })

  it('impede empresa de outro grupo e selected_companies sem selecao', async () => {
    await expect(tenantTransaction(pool, tenantA, async (client) => {
      const grantId = randomUUID()
      await client.query(
        `insert into corporate_group_access_grants (
           id, tenant_id, membership_id, business_group_id, corporate_profile, access_mode
         ) values ($1, $2, $3, $4, 'viewer', 'selected_companies')`,
        [grantId, tenantA, membershipA, otherGroupA],
      )
      await client.query(
        `insert into corporate_group_access_companies (tenant_id, group_access_grant_id, company_id)
         values ($1, $2, $3)`,
        [tenantA, grantId, companyA],
      )
    })).rejects.toThrow(/nao pertence ao grupo/i)

    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into corporate_group_access_grants (
         tenant_id, membership_id, business_group_id, corporate_profile, access_mode
       ) values ($1, $2, $3, 'viewer', 'selected_companies')`,
      [tenantA, membershipA, otherGroupA],
    ))).rejects.toThrow(/ao menos uma empresa/i)
  })

  it('impede selecao no modo all_companies e vinculo atual duplicado', async () => {
    await expect(tenantTransaction(pool, tenantA, async (client) => {
      const grantId = randomUUID()
      await client.query(
        `insert into corporate_group_access_grants (
           id, tenant_id, membership_id, business_group_id, corporate_profile, access_mode
         ) values ($1, $2, $3, $4, 'manager', 'all_companies')`,
        [grantId, tenantA, membershipA, otherGroupA],
      )
      await client.query(
        `insert into corporate_group_access_companies (tenant_id, group_access_grant_id, company_id)
         values ($1, $2, $3)`,
        [tenantA, grantId, otherCompanyA],
      )
    })).rejects.toThrow(/exigem access_mode selected_companies/i)

    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into corporate_company_access_grants (
         tenant_id, membership_id, company_id, corporate_profile
       ) values ($1, $2, $3, 'viewer')`,
      [tenantA, membershipA, otherCompanyA],
    ))).rejects.toThrow()
  })

  it('aceita somente contexto padrao coberto por vinculo corporativo ativo', async () => {
    await tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into membership_corporate_preferences (
         tenant_id, membership_id, default_context_type, default_group_id
       ) values ($1, $2, 'group', $3)`,
      [tenantA, membershipA, groupA],
    ))

    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `update membership_corporate_preferences
       set default_group_id = $3
       where tenant_id = $1 and membership_id = $2`,
      [tenantA, membershipA, otherGroupA],
    ))).rejects.toThrow(/escopo corporativo ativo/i)
  })
})

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

import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDatabasePool } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { resetTenantBusinessData } from '@/lib/server/system-reset-service'
import { TENANT_BUSINESS_RESET_TABLES } from '@/lib/system-reset-policy'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL tenant reset', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const roleId = randomUUID()
  const membershipId = randomUUID()
  const companyId = `company-${randomUUID()}`
  const workflowId = randomUUID()
  const workflowVersionId = randomUUID()
  const automationId = randomUUID()
  const automationVersionId = randomUUID()
  const principal = resetPrincipal({
    tenantId,
    userId,
    membershipId,
    companyId,
  })

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Tenant Reset Integration', $2)`,
      [tenantId, `tenant-reset-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Tenant Reset User')`,
      [userId, `tenant-reset-${userId}@test.invalid`],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'tenant_reset_test', 'Tenant reset test')`,
        [roleId, tenantId],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id)
         values ($1, $2, $3, $4)`,
        [membershipId, tenantId, userId, roleId],
      )
      await client.query(
        `insert into companies (id, tenant_id, legal_name)
         values ($1, $2, 'Tenant Reset Company')`,
        [companyId, tenantId],
      )
      await insertAutomationFixture(client)
      await client.query(
        `insert into ai_invocations (
           tenant_id, actor_user_id, task, provider, model, status,
           input_hash, input_characters, output_characters, latency_ms
         ) values (
           $1, $2, 'chat', 'local', 'reset-test', 'completed',
           $3, 10, 20, 5
         )`,
        [tenantId, userId, 'e'.repeat(64)],
      )
    })
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

  it('clears all business tables and preserves tenant identity records', async () => {
    const result = await resetTenantBusinessData(principal)
    expect(result.clearedTables).toBe(TENANT_BUSINESS_RESET_TABLES.length)
    expect(result.deletedRecords).toBeGreaterThanOrEqual(5)

    const state = await tenantTransaction(pool, tenantId, async (client) => {
      const businessData = await client.query<{
        companies: string
        automations: string
        ai_invocations: string
      }>(
        `select
           (select count(*) from companies where tenant_id = $1)::text as companies,
           (select count(*) from automation_definitions where tenant_id = $1)::text as automations,
           (select count(*) from ai_invocations where tenant_id = $1)::text as ai_invocations`,
        [tenantId],
      )
      const preservedData = await client.query<{
        memberships: string
        roles: string
        reset_metadata: string
      }>(
        `select
           (select count(*) from tenant_memberships where tenant_id = $1)::text as memberships,
           (select count(*) from roles where tenant_id = $1)::text as roles,
           (
             select count(*)
             from app_kv
             where tenant_id = $1 and key = 'bbt-system-meta-v1'
           )::text as reset_metadata`,
        [tenantId],
      )
      return {
        businessData: businessData.rows[0],
        preservedData: preservedData.rows[0],
      }
    })

    expect(state.businessData).toEqual({
      companies: '0',
      automations: '0',
      ai_invocations: '0',
    })
    expect(state.preservedData).toEqual({
      memberships: '1',
      roles: '1',
      reset_metadata: '1',
    })
  })

  async function insertAutomationFixture(client: PoolClient): Promise<void> {
    await client.query(
      `insert into enterprise_workflow_definitions (
         id, tenant_id, workflow_code, name, description, process_type,
         status, current_version, created_by
       ) values (
         $1, $2, $3, 'Reset workflow', 'Workflow used by the reset test.',
         'generic', 'draft', 1, $4
       )`,
      [workflowId, tenantId, `workflow.reset.${randomUUID()}`, userId],
    )
    await client.query(
      `insert into enterprise_workflow_versions (
         id, tenant_id, workflow_definition_id, version_number, status, source,
         graph_snapshot, content_hash, change_summary, created_by
       ) values (
         $1, $2, $3, 1, 'draft', 'manual', '{}'::jsonb, $4,
         'Reset workflow fixture.', $5
       )`,
      [workflowVersionId, tenantId, workflowId, 'f'.repeat(64), userId],
    )
    await client.query(
      `insert into automation_definitions (
         id, tenant_id, automation_code, name, description, status,
         current_version, created_by
       ) values (
         $1, $2, $3, 'Reset automation',
         'Automation used to validate the complete tenant reset.',
         'draft', 1, $4
       )`,
      [automationId, tenantId, `automation.reset.${randomUUID()}`, userId],
    )
    await client.query(
      `insert into automation_versions (
         id, tenant_id, automation_definition_id, version_number, status,
         event_type, workflow_definition_id, subject_type, company_id_path,
         subject_id_path, condition_ast, content_hash, change_summary, created_by
       ) values (
         $1, $2, $3, 1, 'draft',
         'test.reset.requested', $4, 'generic', 'companyId',
         'aggregateId', $5::jsonb, $6, 'Reset automation fixture.', $7
       )`,
      [
        automationVersionId,
        tenantId,
        automationId,
        workflowId,
        JSON.stringify({ fact: 'event.type', operator: 'exists' }),
        'a'.repeat(64),
        userId,
      ],
    )
    await client.query(
      `insert into automation_version_scopes (
         tenant_id, automation_version_id, scope_type, scope_id, mode, specificity
       ) values ($1, $2, 'company', $3, 'include', 80)`,
      [tenantId, automationVersionId, companyId],
    )
  }
})

function resetPrincipal(input: {
  tenantId: string
  userId: string
  membershipId: string
  companyId: string
}): RequestPrincipal {
  const permissions = { ...PERMISSOES_PADRAO_POR_PERFIL.lider }
  return {
    sessionId: randomUUID(),
    tenantId: input.tenantId,
    tenantSlug: `tenant-reset-${input.tenantId}`,
    tenantStatus: 'active',
    membershipId: input.membershipId,
    roleKey: 'tenant_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: true,
      companyIds: [input.companyId],
      groupIds: [],
      companies: [{
        companyId: input.companyId,
        companyName: 'Tenant Reset Company',
        groupId: null,
        groupName: null,
        sources: ['tenant_admin'],
        profiles: ['company_admin'],
        permissions,
      }],
      groups: [],
      contexts: [{
        type: 'company',
        id: input.companyId,
        label: 'Tenant Reset Company',
        groupId: null,
        companyIds: [input.companyId],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: input.companyId },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: input.userId,
      email: `tenant-reset-${input.userId}@test.invalid`,
      name: 'Tenant Reset User',
      role: 'company_admin',
      company_id: input.companyId,
      empresa_ids: [input.companyId],
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

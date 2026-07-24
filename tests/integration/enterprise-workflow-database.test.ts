import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL enterprise workflow integrity', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const userA = randomUUID()
  const userB = randomUUID()
  const companyA = `company-${randomUUID()}`
  const companyB = `company-${randomUUID()}`
  const groupA = `group-${randomUUID()}`
  const workflowA = randomUUID()
  const workflowB = randomUUID()
  const versionA = randomUUID()
  const versionB = randomUUID()
  const startNodeA = randomUUID()
  const endNodeA = randomUUID()

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Workflow Tenant A', $2), ($3, 'Workflow Tenant B', $4)`,
      [tenantA, `workflow-a-${tenantA}`, tenantB, `workflow-b-${tenantB}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Workflow User A'), ($3, $4, 'Workflow User B')`,
      [userA, `workflow-a-${userA}@test.invalid`, userB, `workflow-b-${userB}@test.invalid`],
    )
    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(
        `insert into business_groups (id, tenant_id, name) values ($1, $2, 'Workflow Group A')`,
        [groupA, tenantA],
      )
      await client.query(
        `insert into companies (id, tenant_id, group_id, legal_name)
         values ($1, $2, $3, 'Workflow Company A')`,
        [companyA, tenantA, groupA],
      )
      await insertWorkflowDefinition(client, {
        tenantId: tenantA,
        userId: userA,
        companyId: companyA,
        workflowId: workflowA,
        versionId: versionA,
        code: `workflow.a.${workflowA}`,
      })
    })
    await tenantTransaction(pool, tenantB, async (client) => {
      await client.query(
        `insert into companies (id, tenant_id, legal_name)
         values ($1, $2, 'Workflow Company B')`,
        [companyB, tenantB],
      )
      await insertWorkflowDefinition(client, {
        tenantId: tenantB,
        userId: userB,
        companyId: companyB,
        workflowId: workflowB,
        versionId: versionB,
        code: `workflow.b.${workflowB}`,
      })
    })
  })

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantA, tenantB]])
    await pool.query('delete from users where id = any($1::uuid[])', [[userA, userB]])
    await pool.end()
  })

  it('isola definições por tenant com RLS forçado', async () => {
    const visibleA = await tenantTransaction(pool, tenantA, (client) =>
      client.query<{ id: string; tenant_id: string }>(
        'select id, tenant_id from enterprise_workflow_definitions order by id',
      ),
    )
    expect(visibleA.rows).toEqual([{ id: workflowA, tenant_id: tenantA }])

    const mutation = await tenantTransaction(pool, tenantA, (client) =>
      client.query(
        `update enterprise_workflow_definitions set name = 'Forbidden'
         where tenant_id = $1 and id = $2`,
        [tenantB, workflowB],
      ),
    )
    expect(mutation.rowCount).toBe(0)
  })

  it('impede escopo de empresa pertencente a outro tenant', async () => {
    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into enterprise_workflow_scopes (
         tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity
       ) values ($1, $2, 'company', $3, 'include', 50)`,
      [tenantA, versionA, companyB],
    ))).rejects.toThrow()
  })

  it('torna nós e conexões imutáveis depois da submissão', async () => {
    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(
        `insert into enterprise_workflow_nodes (
           id, tenant_id, workflow_version_id, client_node_id, node_key,
           name, node_type, configuration
         ) values
           ($1, $2, $3, 'start', 'start', 'Início', 'start', '{}'::jsonb),
           ($4, $2, $3, 'end', 'end', 'Fim', 'end', '{}'::jsonb)`,
        [startNodeA, tenantA, versionA, endNodeA],
      )
      await client.query(
        `insert into enterprise_workflow_edges (
           tenant_id, workflow_version_id, client_edge_id, source_node_id,
           target_node_id, edge_kind, sequence
         ) values ($1, $2, 'start-end', $3, $4, 'success', 1)`,
        [tenantA, versionA, startNodeA, endNodeA],
      )
      await client.query(
        `update enterprise_workflow_versions
         set status = 'in_review', reviewed_by = $3, reviewed_at = now()
         where tenant_id = $1 and id = $2`,
        [tenantA, versionA, userA],
      )
    })

    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `update enterprise_workflow_nodes
       set name = 'Alteração indevida'
       where tenant_id = $1 and id = $2`,
      [tenantA, startNodeA],
    ))).rejects.toThrow(/rascunho/i)
  })

  it('impede execução com sujeito de empresa divergente', async () => {
    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into enterprise_workflow_executions (
         tenant_id, workflow_definition_id, workflow_version_id, company_id,
         subject_type, subject_id, workflow_snapshot, context, input_hash,
         idempotency_key, started_by
       ) values ($1, $2, $3, $4, 'company', $5, '{}'::jsonb, '{}'::jsonb,
                 $6, $7, $8)`,
      [
        tenantA,
        workflowA,
        versionA,
        companyA,
        companyB,
        'a'.repeat(64),
        `workflow-execution-${randomUUID()}`,
        userA,
      ],
    ))).rejects.toThrow(/coincidir/i)
  })
})

async function insertWorkflowDefinition(
  client: PoolClient,
  input: {
    tenantId: string
    userId: string
    companyId: string
    workflowId: string
    versionId: string
    code: string
  },
): Promise<void> {
  await client.query(
    `insert into enterprise_workflow_definitions (
       id, tenant_id, workflow_code, name, description, process_type,
       status, current_version, created_by
     ) values ($1, $2, $3, 'Workflow test', 'Workflow integration test.',
               'generic', 'draft', 1, $4)`,
    [input.workflowId, input.tenantId, input.code, input.userId],
  )
  await client.query(
    `insert into enterprise_workflow_versions (
       id, tenant_id, workflow_definition_id, version_number, status, source,
       graph_snapshot, content_hash, change_summary, created_by
     ) values ($1, $2, $3, 1, 'draft', 'manual', '{}'::jsonb,
               $4, 'Initial integration version.', $5)`,
    [input.versionId, input.tenantId, input.workflowId, 'a'.repeat(64), input.userId],
  )
  await client.query(
    `insert into enterprise_workflow_scopes (
       tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity
     ) values ($1, $2, 'company', $3, 'include', 50)`,
    [input.tenantId, input.versionId, input.companyId],
  )
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

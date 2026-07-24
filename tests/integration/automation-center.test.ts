import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createAutomationDraft,
  listAutomationRuns,
  simulateAutomation,
  transitionAutomation,
} from '@/lib/server/automation-service'
import { runAutomationWorkerCycle } from '@/lib/server/automation-worker'
import { closeDatabasePool } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { EnterpriseWorkflowGraph } from '@/lib/workflows'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL automation center', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const planId = randomUUID()
  const roleId = randomUUID()
  const membershipId = randomUUID()
  const workflowId = randomUUID()
  const workflowVersionId = randomUUID()
  const companyId = `company-${randomUUID()}`
  const inaccessibleCompanyId = `company-${randomUUID()}`
  const workflowCode = `workflow.automation.${randomUUID()}`
  const graph = automationWorkflowGraph(
    workflowId,
    workflowVersionId,
    workflowCode,
  )
  const principal = automationPrincipal({
    tenantId,
    userId,
    membershipId,
    companyId,
  })

  beforeAll(async () => {
    await pool.query(
      `insert into plans (id, plan_key, name)
       values ($1, $2, 'Automation Center Plan')`,
      [planId, `automation-center-${planId}`],
    )
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Automation Center Tenant', $2)`,
      [tenantId, `automation-center-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Automation Center User')`,
      [userId, `automation-center-${userId}@test.invalid`],
    )
    await pool.query(
      `insert into user_credentials (user_id, password_hash)
       values ($1, 'automation-worker-not-used-for-login')`,
      [userId],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into tenant_subscriptions (tenant_id, plan_id, status)
         values ($1, $2, 'active')`,
        [tenantId, planId],
      )
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'company_admin', 'Automation company administrator')`,
        [roleId, tenantId],
      )
      await client.query(
        `insert into tenant_memberships (
           id, tenant_id, user_id, role_id, profile_key, company_id, allowed_company_ids
         ) values ($1, $2, $3, $4, 'lider', $5, array[$5]::text[])`,
        [membershipId, tenantId, userId, roleId, companyId],
      )
      await client.query(
        `insert into companies (id, tenant_id, legal_name)
         values
           ($1, $3, 'Automation Company'),
           ($2, $3, 'Inaccessible Automation Company')`,
        [companyId, inaccessibleCompanyId, tenantId],
      )
      await insertPublishedWorkflow(client, {
        tenantId,
        userId,
        workflowId,
        workflowVersionId,
        companyId,
        workflowCode,
        graph,
      })
    })
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from automation_runs where tenant_id = $1', [tenantId])
      await client.query('delete from enterprise_workflow_executions where tenant_id = $1', [tenantId])
      await client.query('delete from automation_events where tenant_id = $1', [tenantId])
      await client.query('delete from automation_definitions where tenant_id = $1', [tenantId])
      await client.query('delete from domain_outbox where tenant_id = $1', [tenantId])
      await client.query('delete from enterprise_workflow_versions where tenant_id = $1', [tenantId])
      await client.query('delete from enterprise_workflow_definitions where tenant_id = $1', [tenantId])
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenant_subscriptions where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = $1', [userId])
    await pool.query('delete from plans where id = $1', [planId])
    await pool.end()
  })

  it('publishes, simulates and executes an automation idempotently', async () => {
    const draft = await createAutomationDraft(principal, {
      automationCode: `demand.high_value.${randomUUID()}`,
      name: 'High value demand automation',
      description: 'Starts the governed workflow for high value travel demands.',
      eventType: 'travel.demand.created',
      workflowId,
      subjectType: 'generic',
      companyIdPath: 'payload.companyId',
      subjectIdPath: 'aggregateId',
      condition: {
        all: [
          { fact: 'event.type', operator: 'eq', value: 'travel.demand.created' },
          { fact: 'payload.amount', operator: 'gte', value: 1_000 },
        ],
      },
      scopes: [{
        type: 'company',
        id: companyId,
        mode: 'include',
        specificity: 80,
      }],
      changeSummary: 'Initial governed automation version.',
    })

    const reviewed = await transitionAutomation(principal, draft.id, {
      versionId: draft.current.id,
      action: 'submit_review',
      reason: 'Configuration reviewed before approval.',
    })
    const approved = await transitionAutomation(principal, draft.id, {
      versionId: reviewed.current.id,
      action: 'approve',
      reason: 'Automation approved for controlled publication.',
    })
    const published = await transitionAutomation(principal, draft.id, {
      versionId: approved.current.id,
      action: 'publish',
      reason: 'Automation published after technical validation.',
      effectiveFrom: new Date(Date.now() - 5_000).toISOString(),
    })
    expect(published.status).toBe('published')
    expect(published.publishedVersion).toBe(1)
    expect(published.current.validFrom).not.toBeNull()

    const matchingSimulation = await simulateAutomation(principal, published.id, {
      eventType: 'travel.demand.created',
      aggregateType: 'demand',
      aggregateId: 'demand-simulation',
      payload: { companyId, amount: 2_500 },
    })
    expect(matchingSimulation).toMatchObject({
      matched: true,
      scopeMatched: true,
      companyId,
      wouldExecute: true,
    })

    const rejectedSimulation = await simulateAutomation(principal, published.id, {
      eventType: 'travel.demand.created',
      aggregateType: 'demand',
      aggregateId: 'demand-below-threshold',
      payload: { companyId, amount: 500 },
    })
    expect(rejectedSimulation).toMatchObject({
      matched: false,
      scopeMatched: true,
      wouldExecute: false,
    })

    const matchingEventId = randomUUID()
    const skippedEventId = randomUUID()
    const inaccessibleEventId = randomUUID()
    await tenantTransaction(pool, tenantId, async (client) => {
      await insertOutboxEvent(client, {
        id: matchingEventId,
        tenantId,
        userId,
        aggregateId: 'demand-matching',
        companyId,
        amount: 2_500,
      })
      await insertOutboxEvent(client, {
        id: skippedEventId,
        tenantId,
        userId,
        aggregateId: 'demand-skipped',
        companyId,
        amount: 500,
      })
      await insertOutboxEvent(client, {
        id: inaccessibleEventId,
        tenantId,
        userId,
        aggregateId: 'demand-inaccessible',
        companyId: inaccessibleCompanyId,
        amount: 8_000,
      })
    })

    const processed = await runAutomationWorkerCycle({
      tenantIds: [tenantId],
      limit: 20,
    })
    expect(processed).toMatchObject({
      tenants: 1,
      definitions: 1,
      claimed: 2,
      completed: 1,
      skipped: 1,
      failed: 0,
      errors: 0,
    })

    const replay = await runAutomationWorkerCycle({
      tenantIds: [tenantId],
      limit: 20,
    })
    expect(replay.claimed).toBe(0)

    const runs = await listAutomationRuns(principal, {
      automationId: published.id,
      limit: 20,
    })
    expect(runs.total).toBe(2)
    expect(runs.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceEventId: matchingEventId,
        status: 'waiting',
        companyId,
      }),
      expect.objectContaining({
        sourceEventId: skippedEventId,
        status: 'skipped',
        companyId,
      }),
    ]))
    expect(runs.items.some((run) => run.sourceEventId === inaccessibleEventId)).toBe(false)

    const databaseState = await tenantTransaction(pool, tenantId, async (client) => {
      const executions = await client.query<{ count: string }>(
        `select count(*)::text as count
         from enterprise_workflow_executions
         where tenant_id = $1`,
        [tenantId],
      )
      const inaccessibleRuns = await client.query<{ count: string }>(
        `select count(*)::text as count
         from automation_runs
         where tenant_id = $1 and source_outbox_event_id = $2`,
        [tenantId, inaccessibleEventId],
      )
      return {
        executions: Number(executions.rows[0].count),
        inaccessibleRuns: Number(inaccessibleRuns.rows[0].count),
      }
    })
    expect(databaseState).toEqual({ executions: 1, inaccessibleRuns: 0 })
  })

  it('enforces company authorization and tenant RLS', async () => {
    await expect(createAutomationDraft(principal, {
      automationCode: `denied.company.${randomUUID()}`,
      name: 'Denied company automation',
      description: 'Attempts to create an automation outside the allowed company.',
      eventType: 'travel.demand.created',
      workflowId,
      subjectType: 'generic',
      companyIdPath: 'payload.companyId',
      subjectIdPath: 'aggregateId',
      condition: { fact: 'event.type', operator: 'exists' },
      scopes: [{
        type: 'company',
        id: inaccessibleCompanyId,
        mode: 'include',
        specificity: 80,
      }],
      changeSummary: 'This configuration must be denied.',
    })).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' })

    const anotherTenantId = randomUUID()
    const hidden = await tenantTransaction(pool, anotherTenantId, (client) =>
      client.query('select id from automation_definitions'))
    expect(hidden.rows).toEqual([])
  })
})

function automationWorkflowGraph(
  workflowId: string,
  workflowVersionId: string,
  code: string,
): EnterpriseWorkflowGraph {
  return {
    workflowId,
    workflowVersionId,
    version: 1,
    code,
    name: 'Automation integration workflow',
    processType: 'generic',
    contentHash: 'd'.repeat(64),
    source: 'manual',
    nodes: [
      {
        id: 'start-node',
        key: 'start',
        name: 'Start',
        type: 'start',
        position: { x: 40, y: 120 },
        configuration: {},
      },
      {
        id: 'review-node',
        key: 'review',
        name: 'Human review',
        type: 'human_task',
        position: { x: 300, y: 120 },
        configuration: {
          assignment: { type: 'role', value: 'operator' },
          requiredPermission: 'executar_workflows',
        },
      },
      {
        id: 'end-node',
        key: 'end',
        name: 'End',
        type: 'end',
        position: { x: 560, y: 120 },
        configuration: {},
      },
    ],
    edges: [
      {
        id: 'start-review',
        sourceNodeId: 'start-node',
        targetNodeId: 'review-node',
        kind: 'success',
        sequence: 1,
      },
      {
        id: 'review-end',
        sourceNodeId: 'review-node',
        targetNodeId: 'end-node',
        kind: 'success',
        sequence: 2,
      },
    ],
  }
}

function automationPrincipal(input: {
  tenantId: string
  userId: string
  membershipId: string
  companyId: string
}): RequestPrincipal {
  const permissions = { ...PERMISSOES_PADRAO_POR_PERFIL.lider }
  return {
    sessionId: randomUUID(),
    tenantId: input.tenantId,
    tenantSlug: `automation-center-${input.tenantId}`,
    tenantStatus: 'active',
    membershipId: input.membershipId,
    roleKey: 'operator',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds: [input.companyId],
      groupIds: [],
      companies: [{
        companyId: input.companyId,
        companyName: 'Automation Company',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['company_admin'],
        permissions,
      }],
      groups: [],
      contexts: [{
        type: 'company',
        id: input.companyId,
        label: 'Automation Company',
        groupId: null,
        companyIds: [input.companyId],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: input.companyId },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: input.userId,
      email: `automation-center-${input.userId}@test.invalid`,
      name: 'Automation Center User',
      role: 'company_admin',
      company_id: input.companyId,
      empresa_ids: [input.companyId],
      perfil_bbt: 'lider',
      permissoes: permissions,
      ativo: true,
    },
  }
}

async function insertPublishedWorkflow(
  client: PoolClient,
  input: {
    tenantId: string
    userId: string
    workflowId: string
    workflowVersionId: string
    companyId: string
    workflowCode: string
    graph: EnterpriseWorkflowGraph
  },
): Promise<void> {
  await client.query(
    `insert into enterprise_workflow_definitions (
       id, tenant_id, workflow_code, name, description, process_type,
       status, current_version, created_by
     ) values (
       $1, $2, $3, $4, 'Automation integration workflow.', 'generic',
       'draft', 1, $5
     )`,
    [
      input.workflowId,
      input.tenantId,
      input.workflowCode,
      input.graph.name,
      input.userId,
    ],
  )
  await client.query(
    `insert into enterprise_workflow_versions (
       id, tenant_id, workflow_definition_id, version_number, status, source,
       graph_snapshot, content_hash, change_summary, created_by
     ) values (
       $1, $2, $3, 1, 'draft', 'manual', $4::jsonb, $5,
       'Initial automation test workflow.', $6
     )`,
    [
      input.workflowVersionId,
      input.tenantId,
      input.workflowId,
      JSON.stringify(input.graph),
      input.graph.contentHash,
      input.userId,
    ],
  )
  await client.query(
    `insert into enterprise_workflow_scopes (
       tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity
     ) values ($1, $2, 'company', $3, 'include', 80)`,
    [input.tenantId, input.workflowVersionId, input.companyId],
  )

  const nodeDatabaseIds = new Map<string, string>()
  for (const node of input.graph.nodes) {
    const databaseId = randomUUID()
    nodeDatabaseIds.set(node.id, databaseId)
    await client.query(
      `insert into enterprise_workflow_nodes (
         id, tenant_id, workflow_version_id, client_node_id, node_key,
         name, description, node_type, configuration, position_x, position_y
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
      [
        databaseId,
        input.tenantId,
        input.workflowVersionId,
        node.id,
        node.key,
        node.name,
        node.description || null,
        node.type,
        JSON.stringify(node.configuration),
        node.position.x,
        node.position.y,
      ],
    )
  }
  for (const edge of input.graph.edges) {
    await client.query(
      `insert into enterprise_workflow_edges (
         tenant_id, workflow_version_id, client_edge_id, source_node_id,
         target_node_id, edge_kind, sequence, label, condition_ast
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        input.tenantId,
        input.workflowVersionId,
        edge.id,
        nodeDatabaseIds.get(edge.sourceNodeId),
        nodeDatabaseIds.get(edge.targetNodeId),
        edge.kind,
        edge.sequence,
        edge.label || null,
        edge.condition ? JSON.stringify(edge.condition) : null,
      ],
    )
  }
  await client.query(
    `update enterprise_workflow_versions
     set status = 'published',
         reviewed_by = $3,
         reviewed_at = now(),
         approved_by = $3,
         approved_at = now(),
         published_by = $3,
         published_at = now()
     where tenant_id = $1 and id = $2`,
    [input.tenantId, input.workflowVersionId, input.userId],
  )
  await client.query(
    `update enterprise_workflow_definitions
     set status = 'published', published_version = 1
     where tenant_id = $1 and id = $2`,
    [input.tenantId, input.workflowId],
  )
}

async function insertOutboxEvent(
  client: PoolClient,
  input: {
    id: string
    tenantId: string
    userId: string
    aggregateId: string
    companyId: string
    amount: number
  },
): Promise<void> {
  await client.query(
    `insert into domain_outbox (
       id, tenant_id, aggregate_type, aggregate_id, event_type, payload,
       idempotency_key, created_by
     ) values ($1, $2, 'demand', $3, 'travel.demand.created', $4::jsonb, $5, $6)`,
    [
      input.id,
      input.tenantId,
      input.aggregateId,
      JSON.stringify({ companyId: input.companyId, amount: input.amount }),
      `automation-test:${input.id}`,
      input.userId,
    ],
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

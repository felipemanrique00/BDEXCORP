import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDatabasePool } from '@/lib/server/database'
import {
  completeEnterpriseWorkflowStep,
  reprocessEnterpriseWorkflowStep,
  startEnterpriseWorkflowExecution,
} from '@/lib/server/enterprise-workflow-runtime-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { EnterpriseWorkflowGraph } from '@/lib/workflows'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL enterprise workflow runtime', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const membershipId = randomUUID()
  const workflowId = randomUUID()
  const versionId = randomUUID()
  const companyId = `company-${randomUUID()}`
  const inaccessibleCompanyId = `company-${randomUUID()}`
  const workflowCode = `workflow.runtime.${randomUUID()}`
  const graph = runtimeGraph(workflowId, versionId, workflowCode)
  const principal = runtimePrincipal({
    tenantId,
    userId,
    membershipId,
    companyId,
  })

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Workflow Runtime Tenant', $2)`,
      [tenantId, `workflow-runtime-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Workflow Runtime User')`,
      [userId, `workflow-runtime-${userId}@test.invalid`],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into companies (id, tenant_id, legal_name)
         values
           ($1, $3, 'Workflow Runtime Company'),
           ($2, $3, 'Inaccessible Workflow Company')`,
        [companyId, inaccessibleCompanyId, tenantId],
      )
      await insertPublishedWorkflow(client, {
        tenantId,
        userId,
        workflowId,
        versionId,
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
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
    })
    await pool.query('delete from tenants where id = $1', [tenantId])
    await pool.query('delete from users where id = $1', [userId])
    await pool.end()
  })

  it('executes a published workflow and safely replays idempotent operations', async () => {
    const executionInput = {
      companyId,
      subjectType: 'generic' as const,
      subjectId: `subject-${randomUUID()}`,
      facts: { amount: 1250 },
      idempotencyKey: `start-${randomUUID()}`,
    }

    const started = await startEnterpriseWorkflowExecution(principal, workflowId, executionInput)
    expect(started.replayed).toBe(false)
    expect(started.status).toBe('waiting')
    expect(started.activeNodeKeys).toEqual(['review'])
    expect(started.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'start', status: 'completed' }),
      expect.objectContaining({ nodeKey: 'review', status: 'waiting', attempt: 1 }),
    ]))

    const startReplay = await startEnterpriseWorkflowExecution(principal, workflowId, executionInput)
    expect(startReplay.id).toBe(started.id)
    expect(startReplay.replayed).toBe(true)

    await expect(startEnterpriseWorkflowExecution(principal, workflowId, {
      ...executionInput,
      subjectId: `other-${randomUUID()}`,
    })).rejects.toMatchObject({ code: 'WORKFLOW_EXECUTION_IDEMPOTENCY_CONFLICT' })

    const completionInput = {
      nodeKey: 'review',
      outcome: 'completed' as const,
      output: { decision: 'continue' },
      reason: 'Etapa humana concluida.',
      idempotencyKey: `complete-${randomUUID()}`,
    }
    const completed = await completeEnterpriseWorkflowStep(
      principal,
      started.id,
      completionInput,
    )
    expect(completed.replayed).toBe(false)
    expect(completed.status).toBe('completed')
    expect(completed.completedNodeKeys).toEqual(
      expect.arrayContaining(['start', 'review', 'end']),
    )

    const completionReplay = await completeEnterpriseWorkflowStep(
      principal,
      started.id,
      completionInput,
    )
    expect(completionReplay.replayed).toBe(true)
    expect(completionReplay.status).toBe('completed')
  })

  it('records terminal failure and supports an audited retry', async () => {
    const started = await startEnterpriseWorkflowExecution(principal, workflowId, {
      companyId,
      subjectType: 'generic',
      subjectId: `failure-${randomUUID()}`,
      facts: {},
      idempotencyKey: `start-failure-${randomUUID()}`,
    })
    const failed = await completeEnterpriseWorkflowStep(principal, started.id, {
      nodeKey: 'review',
      outcome: 'failed',
      output: { providerResponse: 'unavailable' },
      reason: 'Falha externa controlada.',
      idempotencyKey: `fail-${randomUUID()}`,
    })
    expect(failed.status).toBe('failed')
    expect(failed.lastErrorCode).toBe('EXTERNAL_STEP_FAILED')
    expect(failed.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'review', status: 'failed', attempt: 1 }),
    ]))

    const reprocessed = await reprocessEnterpriseWorkflowStep(principal, failed.id, {
      nodeKey: 'review',
      reason: 'Reprocessamento autorizado apos correcao externa.',
      idempotencyKey: `retry-${randomUUID()}`,
    })
    expect(reprocessed.replayed).toBe(false)
    expect(reprocessed.status).toBe('waiting')
    expect(reprocessed.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'review', status: 'waiting', attempt: 2 }),
    ]))

    const completed = await completeEnterpriseWorkflowStep(principal, failed.id, {
      nodeKey: 'review',
      outcome: 'completed',
      output: { providerResponse: 'ok' },
      reason: 'Etapa concluida na segunda tentativa.',
      idempotencyKey: `complete-retry-${randomUUID()}`,
    })
    expect(completed.status).toBe('completed')
  })

  it('denies execution for a company outside the principal scope', async () => {
    await expect(startEnterpriseWorkflowExecution(principal, workflowId, {
      companyId: inaccessibleCompanyId,
      subjectType: 'generic',
      subjectId: `denied-${randomUUID()}`,
      facts: {},
      idempotencyKey: `denied-${randomUUID()}`,
    })).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' })
  })
})

function runtimeGraph(
  workflowId: string,
  workflowVersionId: string,
  code: string,
): EnterpriseWorkflowGraph {
  return {
    workflowId,
    workflowVersionId,
    version: 1,
    code,
    name: 'Workflow runtime integration test',
    processType: 'generic',
    contentHash: 'c'.repeat(64),
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
    validFrom: null,
    validUntil: null,
  }
}

function runtimePrincipal(input: {
  tenantId: string
  userId: string
  membershipId: string
  companyId: string
}): RequestPrincipal {
  const permissions = { ...PERMISSOES_PADRAO_POR_PERFIL.lider }
  return {
    sessionId: randomUUID(),
    tenantId: input.tenantId,
    tenantSlug: `workflow-runtime-${input.tenantId}`,
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
        companyName: 'Workflow Runtime Company',
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
        label: 'Workflow Runtime Company',
        groupId: null,
        companyIds: [input.companyId],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: input.companyId },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: input.userId,
      email: `workflow-runtime-${input.userId}@test.invalid`,
      name: 'Workflow Runtime User',
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
    versionId: string
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
       $1, $2, $3, $4, 'Workflow runtime integration test.', 'generic',
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
       'Initial runtime integration version.', $6
     )`,
    [
      input.versionId,
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
    [input.tenantId, input.versionId, input.companyId],
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
        input.versionId,
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
        input.versionId,
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
    [input.tenantId, input.versionId, input.userId],
  )
  await client.query(
    `update enterprise_workflow_definitions
     set status = 'published', published_version = 1
     where tenant_id = $1 and id = $2`,
    [input.tenantId, input.workflowId],
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

import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import { sha256 } from '@/lib/policy'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  requireCompanyAccess,
  requireGroupAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  assertValidEnterpriseWorkflow,
  enterpriseWorkflowDraftInputSchema,
  enterpriseWorkflowGraphSchema,
  enterpriseWorkflowRestoreVersionSchema,
  enterpriseWorkflowSimulationSchema,
  enterpriseWorkflowTransitionSchema,
  enterpriseWorkflowVersionInputSchema,
  EnterpriseWorkflowError,
  simulateEnterpriseWorkflow,
  type EnterpriseWorkflowDraftInput,
  type EnterpriseWorkflowGraph,
  type EnterpriseWorkflowProcessType,
  type EnterpriseWorkflowScope,
  type EnterpriseWorkflowSimulationResult,
  type EnterpriseWorkflowStatus,
  type EnterpriseWorkflowTransitionInput,
  type EnterpriseWorkflowVersionInput,
} from '@/lib/workflows'

interface WorkflowDefinitionRow extends QueryResultRow {
  id: string
  workflow_code: string
  name: string
  description: string
  process_type: EnterpriseWorkflowProcessType
  status: EnterpriseWorkflowStatus
  current_version: number
  published_version: number | null
  tags: string[]
  created_by: string
  created_at: string | Date
  updated_at: string | Date
}

interface WorkflowVersionRow extends QueryResultRow {
  id: string
  workflow_definition_id: string
  version_number: number
  status: EnterpriseWorkflowStatus
  source: 'manual' | 'ai_draft'
  graph_snapshot: unknown
  content_hash: string
  change_summary: string
  valid_from: string | Date | null
  valid_until: string | Date | null
  created_by: string
  reviewed_by: string | null
  reviewed_at: string | Date | null
  approved_by: string | null
  approved_at: string | Date | null
  published_by: string | null
  published_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

interface WorkflowScopeRow extends QueryResultRow {
  workflow_version_id: string
  scope_type: EnterpriseWorkflowScope['type']
  scope_id: string | null
  mode: EnterpriseWorkflowScope['mode']
  specificity: number
}

export interface EnterpriseWorkflowListItem {
  id: string
  code: string
  name: string
  description: string
  processType: EnterpriseWorkflowProcessType
  status: EnterpriseWorkflowStatus
  currentVersion: number
  publishedVersion: number | null
  tags: string[]
  scopes: EnterpriseWorkflowScope[]
  updatedAt: string
}

export interface EnterpriseWorkflowVersionSummary {
  id: string
  version: number
  status: EnterpriseWorkflowStatus
  source: 'manual' | 'ai_draft'
  contentHash: string
  changeSummary: string
  validFrom: string | null
  validUntil: string | null
  createdBy: string
  reviewedBy: string | null
  approvedBy: string | null
  publishedBy: string | null
  createdAt: string
  reviewedAt: string | null
  approvedAt: string | null
  publishedAt: string | null
}

export interface EnterpriseWorkflowDetail extends EnterpriseWorkflowListItem {
  createdBy: string
  current: EnterpriseWorkflowGraph
  versions: EnterpriseWorkflowVersionSummary[]
}

export class EnterpriseWorkflowServiceError extends EnterpriseWorkflowError {
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(code, message, status, details)
    this.name = 'EnterpriseWorkflowServiceError'
  }
}

export async function listEnterpriseWorkflows(
  principal: RequestPrincipal,
  filters: {
    status?: EnterpriseWorkflowStatus
    processType?: EnterpriseWorkflowProcessType
    search?: string
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: EnterpriseWorkflowListItem[]; total: number }> {
  const visible = visibleWorkflowScope(principal)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, visible.companyIds, visible.groupIds, visible.tenantWide]
    const clauses = [
      'definition.tenant_id = $1',
      `exists (
        select 1
        from enterprise_workflow_versions visible_version
        join enterprise_workflow_scopes visible_scope
          on visible_scope.tenant_id = visible_version.tenant_id
          and visible_scope.workflow_version_id = visible_version.id
        where visible_version.tenant_id = definition.tenant_id
          and visible_version.workflow_definition_id = definition.id
          and visible_version.version_number = definition.current_version
          and (
            $4::boolean
            or (visible_scope.scope_type = 'tenant' and definition.status = 'published')
            or (visible_scope.scope_type = 'company' and visible_scope.scope_id = any($2::text[]))
            or (visible_scope.scope_type = 'group' and visible_scope.scope_id = any($3::text[]))
          )
      )`,
    ]
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`definition.status = $${values.length}`)
    }
    if (filters.processType) {
      values.push(filters.processType)
      clauses.push(`definition.process_type = $${values.length}`)
    }
    if (filters.search?.trim()) {
      values.push(`%${filters.search.trim()}%`)
      clauses.push(`(
        definition.name ilike $${values.length}
        or definition.workflow_code ilike $${values.length}
        or definition.description ilike $${values.length}
      )`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total
       from enterprise_workflow_definitions definition
       where ${clauses.join(' and ')}`,
      values,
    )
    values.push(
      Math.min(200, Math.max(1, filters.limit || 50)),
      Math.max(0, filters.offset || 0),
    )
    const rows = await client.query<WorkflowDefinitionRow>(
      `select definition.*
       from enterprise_workflow_definitions definition
       where ${clauses.join(' and ')}
       order by definition.updated_at desc, definition.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    const scopes = await loadScopesForDefinitions(
      client,
      principal.tenantId,
      rows.rows.map((row) => row.id),
    )
    return {
      items: rows.rows.map((row) => mapDefinition(row, scopes.get(row.id) || [])),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function getEnterpriseWorkflowDetail(
  principal: RequestPrincipal,
  rawWorkflowId: string,
): Promise<EnterpriseWorkflowDetail> {
  const workflowId = assertUuid(rawWorkflowId, 'WORKFLOW_ID_INVALID')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinition(client, principal.tenantId, workflowId, false)
    const versions = await client.query<WorkflowVersionRow>(
      `select *
       from enterprise_workflow_versions
       where tenant_id = $1 and workflow_definition_id = $2
       order by version_number desc`,
      [principal.tenantId, workflowId],
    )
    const currentVersion = versions.rows.find((version) => (
      version.version_number === definition.current_version
    ))
    if (!currentVersion) {
      throw new EnterpriseWorkflowServiceError(
        'WORKFLOW_CURRENT_VERSION_NOT_FOUND',
        'A versão atual do workflow não foi encontrada.',
        409,
      )
    }
    const scopes = await loadVersionScopes(client, principal.tenantId, currentVersion.id)
    await assertCanViewScopes(principal, scopes, definition.status)
    return {
      ...mapDefinition(definition, scopes),
      createdBy: definition.created_by,
      current: enterpriseWorkflowGraphSchema.parse(currentVersion.graph_snapshot),
      versions: versions.rows.map(mapVersionSummary),
    }
  })
}

export async function getEnterpriseWorkflowVersionSnapshot(
  principal: RequestPrincipal,
  rawWorkflowId: string,
  rawVersionId: string,
): Promise<{
  workflow: EnterpriseWorkflowListItem
  version: EnterpriseWorkflowVersionSummary
  graph: EnterpriseWorkflowGraph
  scopes: EnterpriseWorkflowScope[]
}> {
  const workflowId = assertUuid(rawWorkflowId, 'WORKFLOW_ID_INVALID')
  const versionId = assertUuid(rawVersionId, 'WORKFLOW_VERSION_ID_INVALID')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinition(client, principal.tenantId, workflowId, false)
    const version = await loadVersion(client, principal.tenantId, workflowId, versionId, false)
    const scopes = await loadVersionScopes(client, principal.tenantId, version.id)
    await assertCanViewScopes(principal, scopes, definition.status)
    return {
      workflow: mapDefinition(definition, scopes),
      version: mapVersionSummary(version),
      graph: enterpriseWorkflowGraphSchema.parse(version.graph_snapshot),
      scopes,
    }
  })
}

export async function createEnterpriseWorkflowDraft(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<EnterpriseWorkflowDetail> {
  const input = enterpriseWorkflowDraftInputSchema.parse(rawInput)
  await assertCanManageScopes(principal, input.scopes)
  const workflowId = randomUUID()
  const versionId = randomUUID()
  const graph = prepareGraph(workflowId, versionId, 1, input.workflowCode, input)
  await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      `insert into enterprise_workflow_definitions (
         id, tenant_id, workflow_code, name, description, process_type,
         status, current_version, tags, created_by
       ) values ($1, $2, $3, $4, $5, $6, 'draft', 1, $7::text[], $8)`,
      [
        workflowId,
        principal.tenantId,
        input.workflowCode,
        input.name,
        input.description,
        input.processType,
        unique(input.tags),
        principal.user.id,
      ],
    )
    await insertVersion(client, principal, workflowId, graph, input.changeSummary)
    await insertVersionChildren(client, principal.tenantId, graph, input.scopes)
    await insertChangeAudit(
      client,
      principal,
      workflowId,
      versionId,
      'created',
      input.changeSummary,
      null,
      graph,
    )
  }).catch((error) => {
    if (isUniqueViolation(error)) {
      throw new EnterpriseWorkflowServiceError(
        'WORKFLOW_CODE_ALREADY_EXISTS',
        'Já existe um workflow com este código.',
        409,
      )
    }
    throw error
  })
  await auditWorkflowChange(principal, 'workflow.definition.created', workflowId, {
    code: input.workflowCode,
    version: 1,
    source: input.source,
  })
  return getEnterpriseWorkflowDetail(principal, workflowId)
}

export async function createEnterpriseWorkflowVersion(
  principal: RequestPrincipal,
  rawWorkflowId: string,
  rawInput: unknown,
): Promise<EnterpriseWorkflowDetail> {
  const workflowId = assertUuid(rawWorkflowId, 'WORKFLOW_ID_INVALID')
  const input = enterpriseWorkflowVersionInputSchema.parse(rawInput)
  await assertCanManageScopes(principal, input.scopes)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinition(client, principal.tenantId, workflowId, true)
    if (definition.current_version !== input.expectedCurrentVersion) {
      throw new EnterpriseWorkflowServiceError(
        'STALE_WORKFLOW_VERSION',
        'O workflow foi alterado por outra pessoa. Atualize antes de continuar.',
        409,
        { currentVersion: definition.current_version },
      )
    }
    const nextVersion = definition.current_version + 1
    const versionId = randomUUID()
    const graph = prepareGraph(
      workflowId,
      versionId,
      nextVersion,
      definition.workflow_code,
      input,
    )
    await insertVersion(client, principal, workflowId, graph, input.changeSummary)
    await insertVersionChildren(client, principal.tenantId, graph, input.scopes)
    await client.query(
      `update enterprise_workflow_definitions
       set name = $3,
           description = $4,
           process_type = $5,
           status = 'draft',
           current_version = $6,
           tags = $7::text[]
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        workflowId,
        input.name,
        input.description,
        input.processType,
        nextVersion,
        unique(input.tags),
      ],
    )
    await insertChangeAudit(
      client,
      principal,
      workflowId,
      versionId,
      'version_created',
      input.changeSummary,
      { currentVersion: definition.current_version },
      graph,
    )
  })
  await auditWorkflowChange(principal, 'workflow.version.created', workflowId, {
    expectedVersion: input.expectedCurrentVersion,
  })
  return getEnterpriseWorkflowDetail(principal, workflowId)
}

export async function transitionEnterpriseWorkflow(
  principal: RequestPrincipal,
  rawWorkflowId: string,
  rawInput: unknown,
): Promise<EnterpriseWorkflowDetail> {
  const workflowId = assertUuid(rawWorkflowId, 'WORKFLOW_ID_INVALID')
  const input = enterpriseWorkflowTransitionSchema.parse(rawInput)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinition(client, principal.tenantId, workflowId, true)
    const version = await loadVersion(
      client,
      principal.tenantId,
      workflowId,
      input.versionId,
      true,
    )
    if (version.version_number !== definition.current_version) {
      throw new EnterpriseWorkflowServiceError(
        'WORKFLOW_VERSION_NOT_CURRENT',
        'Somente a versão atual pode mudar de estado.',
        409,
      )
    }
    const scopes = await loadVersionScopes(client, principal.tenantId, version.id)
    await assertCanManageScopes(principal, scopes)
    assertTransition(version.status, input.action)
    if (['approve', 'publish'].includes(input.action) && version.created_by === principal.user.id) {
      throw new EnterpriseWorkflowServiceError(
        'WORKFLOW_SEPARATION_OF_DUTIES',
        'O autor da versão não pode aprovar nem publicar a própria alteração.',
        409,
      )
    }
    const graph = assertValidEnterpriseWorkflow(
      enterpriseWorkflowGraphSchema.parse(version.graph_snapshot),
    )
    if (input.action === 'submit_review') {
      await setStatus(client, principal.tenantId, workflowId, version.id, 'in_review')
    } else if (input.action === 'approve') {
      await client.query(
        `update enterprise_workflow_versions
         set status = 'approved',
             reviewed_by = $3,
             reviewed_at = now(),
             approved_by = $3,
             approved_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, version.id, principal.user.id],
      )
      await client.query(
        `update enterprise_workflow_definitions
         set status = 'approved'
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, workflowId],
      )
    } else if (input.action === 'publish') {
      if (!version.approved_by || !version.approved_at || !version.reviewed_by || !version.reviewed_at) {
        throw new EnterpriseWorkflowServiceError(
          'WORKFLOW_APPROVAL_REQUIRED',
          'A versão precisa de revisão humana e aprovação antes da publicação.',
          409,
        )
      }
      await client.query(
        `update enterprise_workflow_versions
         set status = 'suspended'
         where tenant_id = $1
           and workflow_definition_id = $2
           and status = 'published'
           and id <> $3`,
        [principal.tenantId, workflowId, version.id],
      )
      await client.query(
        `update enterprise_workflow_versions
         set status = 'published', published_by = $3, published_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, version.id, principal.user.id],
      )
      await client.query(
        `update enterprise_workflow_definitions
         set status = 'published', published_version = $3
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, workflowId, version.version_number],
      )
    } else if (input.action === 'suspend') {
      await client.query(
        `update enterprise_workflow_versions
         set status = 'suspended'
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, version.id],
      )
      await client.query(
        `update enterprise_workflow_definitions
         set status = 'suspended', published_version = null
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, workflowId],
      )
    } else {
      await setStatus(client, principal.tenantId, workflowId, version.id, 'archived')
      await client.query(
        `update enterprise_workflow_definitions
         set archived_at = now(), published_version = null
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, workflowId],
      )
    }
    await insertChangeAudit(
      client,
      principal,
      workflowId,
      version.id,
      input.action,
      input.reason,
      { status: version.status, contentHash: version.content_hash },
      { status: input.action, contentHash: graph.contentHash },
    )
  })
  await auditWorkflowChange(principal, `workflow.definition.${input.action}`, workflowId, {
    versionId: input.versionId,
    reason: input.reason,
  })
  return getEnterpriseWorkflowDetail(principal, workflowId)
}

export async function restoreEnterpriseWorkflowVersion(
  principal: RequestPrincipal,
  rawWorkflowId: string,
  rawInput: unknown,
): Promise<EnterpriseWorkflowDetail> {
  const workflowId = assertUuid(rawWorkflowId, 'WORKFLOW_ID_INVALID')
  const input = enterpriseWorkflowRestoreVersionSchema.parse(rawInput)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinition(client, principal.tenantId, workflowId, true)
    if (definition.current_version !== input.expectedCurrentVersion) {
      throw new EnterpriseWorkflowServiceError(
        'STALE_WORKFLOW_VERSION',
        'O workflow foi alterado por outra pessoa. Atualize antes de restaurar.',
        409,
        { currentVersion: definition.current_version },
      )
    }
    const source = await loadVersion(
      client,
      principal.tenantId,
      workflowId,
      input.versionId,
      false,
    )
    const sourceGraph = enterpriseWorkflowGraphSchema.parse(source.graph_snapshot)
    const sourceScopes = await loadVersionScopes(client, principal.tenantId, source.id)
    await assertCanManageScopes(principal, sourceScopes)
    const nextVersion = definition.current_version + 1
    const restoredGraph = prepareGraph(
      workflowId,
      randomUUID(),
      nextVersion,
      definition.workflow_code,
      {
        name: sourceGraph.name,
        processType: sourceGraph.processType,
        source: 'manual',
        nodes: sourceGraph.nodes,
        edges: sourceGraph.edges,
        validFrom: sourceGraph.validFrom,
        validUntil: sourceGraph.validUntil,
      },
    )
    await insertVersion(
      client,
      principal,
      workflowId,
      restoredGraph,
      `Restauração da versão ${source.version_number}: ${input.reason}`,
    )
    await insertVersionChildren(client, principal.tenantId, restoredGraph, sourceScopes)
    await client.query(
      `update enterprise_workflow_definitions
       set name = $3,
           process_type = $4,
           current_version = $5,
           status = 'draft'
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        workflowId,
        restoredGraph.name,
        restoredGraph.processType,
        nextVersion,
      ],
    )
    await insertChangeAudit(
      client,
      principal,
      workflowId,
      restoredGraph.workflowVersionId,
      'version_restored',
      input.reason,
      { restoredFromVersion: source.version_number, restoredFromHash: source.content_hash },
      restoredGraph,
    )
  })
  await auditWorkflowChange(principal, 'workflow.version.restored', workflowId, {
    sourceVersionId: input.versionId,
    expectedCurrentVersion: input.expectedCurrentVersion,
  })
  return getEnterpriseWorkflowDetail(principal, workflowId)
}

export async function simulateEnterpriseWorkflowDefinition(
  principal: RequestPrincipal,
  rawWorkflowId: string,
  rawInput: unknown,
): Promise<EnterpriseWorkflowSimulationResult & {
  workflowCode: string
  version: number
  persisted: boolean
}> {
  const workflowId = assertUuid(rawWorkflowId, 'WORKFLOW_ID_INVALID')
  const input = enterpriseWorkflowSimulationSchema.parse(rawInput)
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinition(client, principal.tenantId, workflowId, false)
    let graph: EnterpriseWorkflowGraph
    let scopes: EnterpriseWorkflowScope[]
    let persisted = true
    if (input.workflowVersionId) {
      const version = await loadVersion(
        client,
        principal.tenantId,
        workflowId,
        input.workflowVersionId,
        false,
      )
      graph = enterpriseWorkflowGraphSchema.parse(version.graph_snapshot)
      scopes = await loadVersionScopes(client, principal.tenantId, version.id)
    } else {
      if (!input.candidate) {
        throw new EnterpriseWorkflowServiceError(
          'WORKFLOW_SIMULATION_CANDIDATE_REQUIRED',
          'Informe uma versão ou um candidato para simular.',
          400,
        )
      }
      persisted = false
      graph = prepareGraph(
        workflowId,
        randomUUID(),
        definition.current_version + 1,
        definition.workflow_code,
        input.candidate,
      )
      scopes = input.candidate.scopes
    }
    await assertCanViewScopes(principal, scopes, definition.status)
    return {
      ...simulateEnterpriseWorkflow(graph, input.facts),
      workflowCode: graph.code,
      version: graph.version,
      persisted,
    }
  })
  await writeAuditEvent({
    action: 'workflow.simulation.executed',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'enterprise_workflow',
    entityId: workflowId,
    metadata: {
      version: result.version,
      persisted: result.persisted,
      reachedEnd: result.reachedEnd,
      visitedNodes: result.visitedNodeIds.length,
    },
  })
  return result
}

function prepareGraph(
  workflowId: string,
  workflowVersionId: string,
  version: number,
  workflowCode: string,
  input: Pick<
    EnterpriseWorkflowDraftInput | EnterpriseWorkflowVersionInput,
    'name' | 'processType' | 'source' | 'nodes' | 'edges' | 'validFrom' | 'validUntil'
  >,
): EnterpriseWorkflowGraph {
  const base = {
    workflowId,
    workflowVersionId,
    version,
    code: workflowCode,
    name: input.name,
    processType: input.processType,
    source: input.source,
    nodes: input.nodes,
    edges: input.edges,
    validFrom: input.validFrom || null,
    validUntil: input.validUntil || null,
  }
  return assertValidEnterpriseWorkflow(
    enterpriseWorkflowGraphSchema.parse({
      ...base,
      contentHash: sha256(base),
    }),
  )
}

async function insertVersion(
  client: PoolClient,
  principal: RequestPrincipal,
  workflowId: string,
  graph: EnterpriseWorkflowGraph,
  changeSummary: string,
): Promise<void> {
  await client.query(
    `insert into enterprise_workflow_versions (
       id, tenant_id, workflow_definition_id, version_number, status, source,
       graph_snapshot, content_hash, change_summary, valid_from, valid_until, created_by
     ) values (
       $1, $2, $3, $4, 'draft', $5, $6::jsonb, $7, $8, $9, $10, $11
     )`,
    [
      graph.workflowVersionId,
      principal.tenantId,
      workflowId,
      graph.version,
      graph.source,
      JSON.stringify(graph),
      graph.contentHash,
      changeSummary,
      graph.validFrom || null,
      graph.validUntil || null,
      principal.user.id,
    ],
  )
}

async function insertVersionChildren(
  client: PoolClient,
  tenantId: string,
  graph: EnterpriseWorkflowGraph,
  scopes: EnterpriseWorkflowScope[],
): Promise<void> {
  for (const scope of scopes) {
    await client.query(
      `insert into enterprise_workflow_scopes (
         tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity
       ) values ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        graph.workflowVersionId,
        scope.type,
        scope.id || null,
        scope.mode,
        scope.specificity,
      ],
    )
  }
  const nodeIds = new Map<string, string>()
  for (const node of graph.nodes) {
    const databaseId = randomUUID()
    nodeIds.set(node.id, databaseId)
    await client.query(
      `insert into enterprise_workflow_nodes (
         id, tenant_id, workflow_version_id, client_node_id, node_key, name,
         description, node_type, configuration, position_x, position_y
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
      [
        databaseId,
        tenantId,
        graph.workflowVersionId,
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
  for (const edge of graph.edges) {
    const sourceNodeId = nodeIds.get(edge.sourceNodeId)
    const targetNodeId = nodeIds.get(edge.targetNodeId)
    if (!sourceNodeId || !targetNodeId) {
      throw new EnterpriseWorkflowServiceError(
        'WORKFLOW_EDGE_NODE_NOT_FOUND',
        'Uma conexão referencia um nó inexistente.',
        422,
      )
    }
    await client.query(
      `insert into enterprise_workflow_edges (
         tenant_id, workflow_version_id, client_edge_id, source_node_id,
         target_node_id, edge_kind, sequence, label, condition_ast
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        tenantId,
        graph.workflowVersionId,
        edge.id,
        sourceNodeId,
        targetNodeId,
        edge.kind,
        edge.sequence,
        edge.label || null,
        edge.condition ? JSON.stringify(edge.condition) : null,
      ],
    )
  }
}

async function loadDefinition(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  lock: boolean,
): Promise<WorkflowDefinitionRow> {
  const result = await client.query<WorkflowDefinitionRow>(
    `select *
     from enterprise_workflow_definitions
     where tenant_id = $1 and id = $2${lock ? ' for update' : ''}`,
    [tenantId, workflowId],
  )
  if (!result.rows[0]) {
    throw new EnterpriseWorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow não encontrado.', 404)
  }
  return result.rows[0]
}

async function loadVersion(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  versionId: string,
  lock: boolean,
): Promise<WorkflowVersionRow> {
  const result = await client.query<WorkflowVersionRow>(
    `select *
     from enterprise_workflow_versions
     where tenant_id = $1 and id = $2 and workflow_definition_id = $3${lock ? ' for update' : ''}`,
    [tenantId, versionId, workflowId],
  )
  if (!result.rows[0]) {
    throw new EnterpriseWorkflowServiceError(
      'WORKFLOW_VERSION_NOT_FOUND',
      'Versão do workflow não encontrada.',
      404,
    )
  }
  return result.rows[0]
}

async function loadVersionScopes(
  client: PoolClient,
  tenantId: string,
  versionId: string,
): Promise<EnterpriseWorkflowScope[]> {
  const result = await client.query<WorkflowScopeRow>(
    `select workflow_version_id, scope_type, scope_id, mode, specificity
     from enterprise_workflow_scopes
     where tenant_id = $1 and workflow_version_id = $2
     order by specificity desc, id`,
    [tenantId, versionId],
  )
  return result.rows.map(mapScope)
}

async function loadScopesForDefinitions(
  client: PoolClient,
  tenantId: string,
  definitionIds: string[],
): Promise<Map<string, EnterpriseWorkflowScope[]>> {
  const result = new Map<string, EnterpriseWorkflowScope[]>()
  if (!definitionIds.length) return result
  const rows = await client.query<WorkflowScopeRow & { workflow_definition_id: string }>(
    `select version.workflow_definition_id, scope.workflow_version_id,
            scope.scope_type, scope.scope_id, scope.mode, scope.specificity
     from enterprise_workflow_versions version
     join enterprise_workflow_definitions definition
       on definition.tenant_id = version.tenant_id
       and definition.id = version.workflow_definition_id
     join enterprise_workflow_scopes scope
       on scope.tenant_id = version.tenant_id
       and scope.workflow_version_id = version.id
     where version.tenant_id = $1
       and version.workflow_definition_id = any($2::uuid[])
       and version.version_number = definition.current_version`,
    [tenantId, definitionIds],
  )
  for (const row of rows.rows) {
    result.set(
      row.workflow_definition_id,
      [...(result.get(row.workflow_definition_id) || []), mapScope(row)],
    )
  }
  return result
}

async function assertCanManageScopes(
  principal: RequestPrincipal,
  scopes: Array<{ type: EnterpriseWorkflowScope['type']; id?: string | null }>,
): Promise<void> {
  for (const scope of scopes) {
    if (scope.type === 'tenant') {
      if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
        throw new EnterpriseWorkflowServiceError(
          'TENANT_WORKFLOW_SCOPE_DENIED',
          'Somente administrador do tenant pode gerenciar workflow global.',
          403,
        )
      }
    } else if (scope.type === 'group' && scope.id) {
      await requireGroupAccess(principal, scope.id, 'gerenciar_workflows')
    } else if (scope.type === 'company' && scope.id) {
      await requireCompanyAccess(principal, scope.id, 'gerenciar_workflows')
    }
  }
}

async function assertCanViewScopes(
  principal: RequestPrincipal,
  scopes: EnterpriseWorkflowScope[],
  status: EnterpriseWorkflowStatus,
): Promise<void> {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return
  const visible = visibleWorkflowScope(principal)
  const includes = scopes.filter((scope) => scope.mode === 'include')
  const excludes = scopes.filter((scope) => scope.mode === 'exclude')
  const allowed = includes.some((scope) => (
    (scope.type === 'tenant' && status === 'published')
    || (scope.type === 'company' && Boolean(scope.id && visible.companyIds.includes(scope.id)))
    || (scope.type === 'group' && Boolean(scope.id && visible.groupIds.includes(scope.id)))
  ))
  const excluded = excludes.some((scope) => (
    (scope.type === 'company' && Boolean(scope.id && visible.companyIds.includes(scope.id)))
    || (scope.type === 'group' && Boolean(scope.id && visible.groupIds.includes(scope.id)))
  ))
  if (!allowed || excluded) {
    throw new EnterpriseWorkflowServiceError(
      'WORKFLOW_SCOPE_ACCESS_DENIED',
      'Workflow fora do escopo autorizado.',
      403,
    )
  }
}

function visibleWorkflowScope(principal: RequestPrincipal): {
  tenantWide: boolean
  companyIds: string[]
  groupIds: string[]
} {
  return {
    tenantWide: principal.platformAdmin || principal.roleKey === 'tenant_admin',
    companyIds: principal.corporateAccess?.companies
      .filter((company) => company.permissions.ver_workflows)
      .map((company) => company.companyId) || [],
    groupIds: principal.corporateAccess?.groups
      .filter((group) => group.companyIds.some((companyId) => (
        principal.corporateAccess?.companies.find((company) => (
          company.companyId === companyId
        ))?.permissions.ver_workflows
      )))
      .map((group) => group.groupId) || [],
  }
}

function assertTransition(
  status: EnterpriseWorkflowStatus,
  action: EnterpriseWorkflowTransitionInput['action'],
): void {
  const allowed: Record<EnterpriseWorkflowTransitionInput['action'], EnterpriseWorkflowStatus[]> = {
    submit_review: ['draft'],
    approve: ['in_review'],
    publish: ['approved'],
    suspend: ['published'],
    archive: ['draft', 'in_review', 'approved', 'suspended'],
  }
  if (!allowed[action].includes(status)) {
    throw new EnterpriseWorkflowServiceError(
      'INVALID_WORKFLOW_TRANSITION',
      `A ação ${action} não é permitida no status ${status}.`,
      409,
    )
  }
}

async function setStatus(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  versionId: string,
  status: EnterpriseWorkflowStatus,
): Promise<void> {
  await client.query(
    `update enterprise_workflow_versions
     set status = $3
     where tenant_id = $1 and id = $2`,
    [tenantId, versionId, status],
  )
  await client.query(
    `update enterprise_workflow_definitions
     set status = $3
     where tenant_id = $1 and id = $2`,
    [tenantId, workflowId, status],
  )
}

async function insertChangeAudit(
  client: PoolClient,
  principal: RequestPrincipal,
  workflowId: string,
  versionId: string | null,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await client.query(
    `insert into enterprise_workflow_change_audits (
       tenant_id, workflow_definition_id, workflow_version_id, action,
       actor_user_id, reason, before_snapshot, after_snapshot
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [
      principal.tenantId,
      workflowId,
      versionId,
      action,
      principal.user.id,
      reason,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ],
  )
}

async function auditWorkflowChange(
  principal: RequestPrincipal,
  action: string,
  workflowId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditEvent({
    action,
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'enterprise_workflow',
    entityId: workflowId,
    metadata,
  })
}

function mapDefinition(
  row: WorkflowDefinitionRow,
  scopes: EnterpriseWorkflowScope[],
): EnterpriseWorkflowListItem {
  return {
    id: row.id,
    code: row.workflow_code,
    name: row.name,
    description: row.description,
    processType: row.process_type,
    status: row.status,
    currentVersion: row.current_version,
    publishedVersion: row.published_version,
    tags: row.tags || [],
    scopes,
    updatedAt: iso(row.updated_at),
  }
}

function mapVersionSummary(row: WorkflowVersionRow): EnterpriseWorkflowVersionSummary {
  return {
    id: row.id,
    version: row.version_number,
    status: row.status,
    source: row.source,
    contentHash: row.content_hash,
    changeSummary: row.change_summary,
    validFrom: optionalIso(row.valid_from),
    validUntil: optionalIso(row.valid_until),
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    approvedBy: row.approved_by,
    publishedBy: row.published_by,
    createdAt: iso(row.created_at),
    reviewedAt: optionalIso(row.reviewed_at),
    approvedAt: optionalIso(row.approved_at),
    publishedAt: optionalIso(row.published_at),
  }
}

function mapScope(row: WorkflowScopeRow): EnterpriseWorkflowScope {
  return {
    type: row.scope_type,
    id: row.scope_id,
    mode: row.mode,
    specificity: row.specificity,
  }
}

function assertUuid(value: string, code: string): string {
  const normalized = value.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new EnterpriseWorkflowServiceError(code, 'Identificador inválido.', 400)
  }
  return normalized
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function iso(value: string | Date): string {
  return new Date(value).toISOString()
}

function optionalIso(value: string | Date | null): string | null {
  return value ? iso(value) : null
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === '23505',
  )
}

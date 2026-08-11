import { createHash, randomUUID } from 'node:crypto'

import pg from 'pg'

import {
  AIR_POLICY_CODE,
  AIR_WORKFLOW_CODE,
  HOTEL_POLICY_CODE,
  HOTEL_WORKFLOW_CODE,
  LOCAL_APPROVAL_SEED_DATABASE as LOCAL_DATABASE,
  LOCAL_APPROVAL_SEED_PORT as LOCAL_PORT,
  approvalActionsTargetWorkflow,
  conditionTargetsOnlyService,
  constrainSelectionCondition,
  retargetApprovalActions,
  scopeSignature,
  workflowApprovalSignature,
} from './lib/local-offline-approval-routing.mjs'

const LOCK_KEY = 'bdex:seed-local-offline-approval-routing:v1'

const host = String(process.env.PGHOST || '').trim().toLowerCase()
const port = Number(process.env.PGPORT || 0)
const database = String(process.env.PGDATABASE || '').trim()

if (process.env.BDEX_ALLOW_LOCAL_APPROVAL_SEED !== '1') {
  throw new Error('Defina BDEX_ALLOW_LOCAL_APPROVAL_SEED=1 para confirmar o seed local.')
}
if (!['127.0.0.1', 'localhost', '::1'].includes(host) || port !== LOCAL_PORT || database !== LOCAL_DATABASE) {
  throw new Error(`Seed recusado fora do PostgreSQL local esperado (${LOCAL_DATABASE} em 127.0.0.1:${LOCAL_PORT}).`)
}

const client = new pg.Client()
await client.connect()

try {
  const identity = await client.query(`
    select current_database() as database_name,
           inet_server_addr()::text as server_address,
           current_setting('data_directory') as data_directory
  `)
  const current = identity.rows[0]
  const dataDirectory = String(current?.data_directory || '').replaceAll('\\', '/').toLowerCase()
  if (current?.database_name !== LOCAL_DATABASE || !dataDirectory.includes('/.bdex-local-runtime/data')) {
    throw new Error('Seed recusado: a conexão não aponta para o banco embarcado local do BDEX.')
  }

  await client.query('begin')
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY])

  const bases = await client.query(`
    select policy.tenant_id,
           policy.id as policy_id,
           policy.current_version as policy_current_version,
           policy_version.id as policy_version_id,
           coalesce(
             policy_version.published_by,
             policy_version.approved_by,
             workflow_version.published_by,
             workflow_version.approved_by,
             policy_version.created_by,
             workflow_version.created_by,
             policy.created_by,
             workflow.created_by
           ) as actor_user_id,
           workflow.id as workflow_id,
           workflow.current_version as workflow_current_version,
           workflow_version.id as workflow_version_id,
           workflow_version.graph_snapshot
      from policy_definitions policy
      join policy_versions policy_version
        on policy_version.tenant_id = policy.tenant_id
       and policy_version.policy_definition_id = policy.id
       and policy_version.version_number = policy.current_version
      join approval_workflow_definitions workflow
        on workflow.tenant_id = policy.tenant_id
       and workflow.workflow_code = $2
      join approval_workflow_versions workflow_version
        on workflow_version.tenant_id = workflow.tenant_id
       and workflow_version.workflow_definition_id = workflow.id
       and workflow_version.version_number = workflow.current_version
     where policy.policy_code = $1
     order by policy.tenant_id
  `, [HOTEL_POLICY_CODE, HOTEL_WORKFLOW_CODE])

  if (!bases.rowCount) {
    throw new Error(`Fixture base ${HOTEL_POLICY_CODE}/${HOTEL_WORKFLOW_CODE} não encontrada.`)
  }

  const results = []
  for (const base of bases.rows) {
    const tenantId = base.tenant_id
    const actorUserId = base.actor_user_id
    if (!actorUserId) {
      throw new Error(`Fixture base do tenant ${tenantId} não possui um ator local válido.`)
    }
    const hotelPolicyChanged = await ensureHotelPolicyV2({ tenantId, actorUserId, policyId: base.policy_id })
    const airWorkflowChanged = await ensureAirWorkflow({
      tenantId,
      actorUserId,
      sourceWorkflowVersionId: base.workflow_version_id,
      sourceGraph: base.graph_snapshot,
    })
    const airPolicyChanged = await ensureAirPolicy({
      tenantId,
      actorUserId,
      sourcePolicyVersionId: base.policy_version_id,
    })
    await assertFinalRouting({
      tenantId,
      sourcePolicyVersionId: base.policy_version_id,
      sourceWorkflowVersionId: base.workflow_version_id,
      sourceGraph: base.graph_snapshot,
    })
    results.push({ tenantId, hotelPolicyChanged, airWorkflowChanged, airPolicyChanged })
  }

  await client.query('commit')
  process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`)
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  throw error
} finally {
  await client.end()
}

async function ensureHotelPolicyV2({ tenantId, actorUserId, policyId }) {
  const current = await client.query(`
    select version.*
      from policy_definitions definition
      join policy_versions version
        on version.tenant_id = definition.tenant_id
       and version.policy_definition_id = definition.id
       and version.version_number = definition.current_version
     where definition.tenant_id = $1 and definition.id = $2
     for update of definition
  `, [tenantId, policyId])
  const source = current.rows[0]
  if (!source) throw new Error(`Versão atual da política ${HOTEL_POLICY_CODE} não encontrada.`)
  if (
    conditionTargetsOnlyService(source.condition_ast, 'hotelaria')
    && approvalActionsTargetWorkflow(source.actions_ast, HOTEL_WORKFLOW_CODE)
  ) return false

  const versionId = randomUUID()
  const versionNumber = Number(source.version_number) + 1
  const condition = constrainSelectionCondition(source.condition_ast, 'hotelaria')
  const actions = retargetApprovalActions(source.actions_ast, HOTEL_WORKFLOW_CODE)
  const contentHash = sha256({ condition, actions, versionNumber })

  await client.query(`
    insert into policy_versions (
      id, tenant_id, policy_definition_id, version_number, status,
      name, description, category, priority, severity, inheritance_mode,
      overridable, condition_ast, actions_ast, exception_ast, timezone,
      valid_from, valid_until, tags, business_justification, content_hash,
      change_summary, created_by, checkpoints
    ) values (
      $1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10,
      $11, $12::jsonb, $13::jsonb, $14::jsonb, $15,
      $16, $17, $18::text[], $19, $20, $21, $22, array['selection']::text[]
    )
  `, [
    versionId, tenantId, policyId, versionNumber,
    source.name, source.description, source.category, source.priority, source.severity,
    source.inheritance_mode, source.overridable, JSON.stringify(condition), JSON.stringify(actions),
    JSON.stringify(source.exception_ast || []), source.timezone, source.valid_from, source.valid_until,
    source.tags || [], source.business_justification, contentHash,
    'Restringe a aprovação de hotel ao serviço de hotelaria.', actorUserId,
  ])
  await clonePolicyScopes(tenantId, source.id, versionId)
  await insertPolicyChildren(tenantId, versionId, condition, actions, HOTEL_WORKFLOW_CODE)
  await publishPolicyVersion({
    tenantId,
    actorUserId,
    policyId,
    versionId,
    versionNumber,
    reason: 'Correção local: política de hotel restrita ao serviço hotelaria.',
  })
  return true
}

async function ensureAirWorkflow({ tenantId, actorUserId, sourceWorkflowVersionId, sourceGraph }) {
  const existing = await client.query(`
    select definition.id, definition.status, version.id as version_id,
           version.status as version_status, version.graph_snapshot
      from approval_workflow_definitions definition
      left join approval_workflow_versions version
        on version.tenant_id = definition.tenant_id
       and version.workflow_definition_id = definition.id
       and version.version_number = definition.current_version
     where definition.tenant_id = $1 and definition.workflow_code = $2
     for update of definition
  `, [tenantId, AIR_WORKFLOW_CODE])
  if (existing.rowCount) {
    const row = existing.rows[0]
    if (row.status !== 'published' || row.version_status !== 'published') {
      throw new Error(`O workflow ${AIR_WORKFLOW_CODE} existe, mas não está publicado.`)
    }
    if (workflowApprovalSignature(row.graph_snapshot) !== workflowApprovalSignature(sourceGraph)) {
      throw new Error(`O workflow ${AIR_WORKFLOW_CODE} não preserva os aprovadores e a topologia do fixture de hotel.`)
    }
    await assertWorkflowScopesMatch(tenantId, sourceWorkflowVersionId, row.version_id)
    return false
  }

  const workflowId = randomUUID()
  const workflowVersionId = randomUUID()
  const nodeIds = new Map()
  const nodes = sourceGraph.nodes.map((node) => {
    const id = randomUUID()
    nodeIds.set(node.id, id)
    return {
      ...node,
      id,
      name: node.type === 'approval' ? 'Autorização da cotação aérea escolhida' : node.name,
    }
  })
  const edges = sourceGraph.edges.map((edge) => ({
    ...edge,
    id: randomUUID(),
    sourceNodeId: nodeIds.get(edge.sourceNodeId),
    targetNodeId: nodeIds.get(edge.targetNodeId),
  }))
  const graphBase = {
    workflowId,
    workflowVersionId,
    version: 1,
    code: AIR_WORKFLOW_CODE,
    name: 'Aprovação local de custo da cotação aérea',
    nodes,
    edges,
    validFrom: null,
    validUntil: null,
  }
  const graph = { ...graphBase, contentHash: sha256(graphBase) }

  await client.query(`
    insert into approval_workflow_definitions (
      id, tenant_id, workflow_code, name, description, workflow_type,
      status, current_version, created_by
    ) values ($1, $2, $3, $4, $5, 'cost', 'draft', 1, $6)
  `, [
    workflowId, tenantId, AIR_WORKFLOW_CODE,
    graph.name, 'Fluxo local para autorizar a cotação aérea escolhida pelo solicitante.', actorUserId,
  ])
  await client.query(`
    insert into approval_workflow_versions (
      id, tenant_id, workflow_definition_id, version_number, status,
      graph_snapshot, content_hash, change_summary, created_by
    ) values ($1, $2, $3, 1, 'draft', $4::jsonb, $5, $6, $7)
  `, [workflowVersionId, tenantId, workflowId, JSON.stringify(graph), graph.contentHash, 'Cria o fluxo aéreo local.', actorUserId])
  await cloneWorkflowScopes(tenantId, sourceWorkflowVersionId, workflowVersionId)

  for (const node of nodes) {
    await client.query(`
      insert into approval_nodes (
        id, tenant_id, workflow_version_id, node_key, name, node_type,
        approval_kind, completion_mode, quorum, approver_resolution, configuration
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
    `, [
      node.id, tenantId, workflowVersionId, node.key, node.name, node.type,
      node.approvalKind || null, node.completionMode || null, node.quorum || null,
      JSON.stringify(node.approverResolution || {}), JSON.stringify(node.configuration || {}),
    ])
  }
  for (const edge of edges) {
    await client.query(`
      insert into approval_edges (
        id, tenant_id, workflow_version_id, source_node_id, target_node_id,
        sequence, condition_ast, label
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `, [
      edge.id, tenantId, workflowVersionId, edge.sourceNodeId, edge.targetNodeId,
      edge.sequence || 0, edge.condition ? JSON.stringify(edge.condition) : null, edge.label || null,
    ])
  }

  await client.query(`
    update approval_workflow_versions
       set status = 'published', approved_by = $3, approved_at = now(),
           published_by = $3, published_at = now()
     where tenant_id = $1 and id = $2
  `, [tenantId, workflowVersionId, actorUserId])
  await client.query(`
    update approval_workflow_definitions
       set status = 'published', current_version = 1
     where tenant_id = $1 and id = $2
  `, [tenantId, workflowId])
  return true
}

async function ensureAirPolicy({ tenantId, actorUserId, sourcePolicyVersionId }) {
  const existing = await client.query(`
    select definition.id, definition.status, version.id as version_id,
           version.status as version_status, version.condition_ast,
           version.actions_ast
      from policy_definitions definition
      left join policy_versions version
        on version.tenant_id = definition.tenant_id
       and version.policy_definition_id = definition.id
       and version.version_number = definition.current_version
     where definition.tenant_id = $1 and definition.policy_code = $2
     for update of definition
  `, [tenantId, AIR_POLICY_CODE])
  if (existing.rowCount) {
    const row = existing.rows[0]
    if (
      row.status !== 'published'
      || row.version_status !== 'published'
      || !conditionTargetsOnlyService(row.condition_ast, 'aereo')
      || !approvalActionsTargetWorkflow(row.actions_ast, AIR_WORKFLOW_CODE)
    ) {
      throw new Error(`A política ${AIR_POLICY_CODE} existe, mas não está publicada ou está inconsistente.`)
    }
    await assertPolicyScopesMatch(tenantId, sourcePolicyVersionId, row.version_id)
    return false
  }

  const sourceResult = await client.query('select * from policy_versions where tenant_id = $1 and id = $2', [tenantId, sourcePolicyVersionId])
  const source = sourceResult.rows[0]
  if (!source) throw new Error(`Versão base da política ${HOTEL_POLICY_CODE} não encontrada.`)
  const policyId = randomUUID()
  const versionId = randomUUID()
  const condition = constrainSelectionCondition(source.condition_ast, 'aereo')
  const actions = [{
    type: 'request_approval',
    message: 'A cotação aérea escolhida deve ser autorizada antes da reserva.',
    configuration: { workflow: AIR_WORKFLOW_CODE },
  }]

  await client.query(`
    insert into policy_definitions (
      id, tenant_id, policy_code, name, description, category, status,
      priority, severity, inheritance_mode, overridable, business_justification,
      current_version, created_by, tags
    ) values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10, $11, 1, $12, $13::text[])
  `, [
    policyId, tenantId, AIR_POLICY_CODE, 'Aprovação da cotação aérea escolhida',
    'Exige autorização de custo após a escolha de uma cotação aérea offline.',
    source.category, source.priority, source.severity, source.inheritance_mode,
    source.overridable, 'Garante aprovação antes da reserva e emissão aérea offline.',
    actorUserId, source.tags || [],
  ])
  await client.query(`
    insert into policy_versions (
      id, tenant_id, policy_definition_id, version_number, status,
      name, description, category, priority, severity, inheritance_mode,
      overridable, condition_ast, actions_ast, exception_ast, timezone,
      tags, business_justification, content_hash, change_summary, created_by, checkpoints
    ) values (
      $1, $2, $3, 1, 'draft', $4, $5, $6, $7, $8, $9,
      $10, $11::jsonb, $12::jsonb, '[]'::jsonb, $13,
      $14::text[], $15, $16, $17, $18, array['selection']::text[]
    )
  `, [
    versionId, tenantId, policyId, 'Aprovação da cotação aérea escolhida',
    'Exige autorização de custo após a escolha de uma cotação aérea offline.',
    source.category, source.priority, source.severity, source.inheritance_mode,
    source.overridable, JSON.stringify(condition), JSON.stringify(actions), source.timezone,
    source.tags || [], 'Garante aprovação antes da reserva e emissão aérea offline.',
    sha256({ condition, actions, version: 1 }), 'Cria a política aérea local.', actorUserId,
  ])
  await clonePolicyScopes(tenantId, sourcePolicyVersionId, versionId)
  await insertPolicyChildren(tenantId, versionId, condition, actions, AIR_WORKFLOW_CODE)
  await publishPolicyVersion({
    tenantId,
    actorUserId,
    policyId,
    versionId,
    versionNumber: 1,
    reason: 'Criação da política local de aprovação de aéreo.',
  })
  return true
}

async function clonePolicyScopes(tenantId, sourceVersionId, targetVersionId) {
  await client.query(`
    insert into policy_scopes (tenant_id, policy_version_id, scope_type, scope_id, mode, specificity)
    select tenant_id, $3, scope_type, scope_id, mode, specificity
      from policy_scopes
     where tenant_id = $1 and policy_version_id = $2
  `, [tenantId, sourceVersionId, targetVersionId])
}

async function cloneWorkflowScopes(tenantId, sourceVersionId, targetVersionId) {
  await client.query(`
    insert into approval_workflow_scopes (tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity)
    select tenant_id, $3, scope_type, scope_id, mode, specificity
      from approval_workflow_scopes
     where tenant_id = $1 and workflow_version_id = $2
  `, [tenantId, sourceVersionId, targetVersionId])
}

async function insertPolicyChildren(tenantId, versionId, condition, actions, workflowCode) {
  const ruleSetId = randomUUID()
  await client.query(`
    insert into policy_rule_sets (id, tenant_id, policy_version_id, name, logical_operator, sequence, enabled)
    values ($1, $2, $3, 'Escopo por serviço', 'all', 0, true)
  `, [ruleSetId, tenantId, versionId])
  await client.query(`
    insert into policy_conditions (tenant_id, rule_set_id, sequence, condition_ast)
    values ($1, $2, 0, $3::jsonb)
  `, [tenantId, ruleSetId, JSON.stringify(condition)])
  for (const [sequence, action] of actions.entries()) {
    await client.query(`
      insert into policy_actions (tenant_id, policy_version_id, action_type, sequence, configuration, idempotency_scope)
      values ($1, $2, $3, $4, $5::jsonb, $6)
    `, [
      tenantId,
      versionId,
      action.type,
      sequence,
      JSON.stringify({
        message: action.message || null,
        remediation: action.remediation || null,
        ...(action.configuration || {}),
      }),
      'offline-selection',
    ])
  }
  await client.query(`
    insert into policy_dependencies (
      tenant_id, policy_version_id, dependency_type, dependency_key, required, configuration
    ) values ($1, $2, 'workflow', $3, true, '{}'::jsonb)
    on conflict (tenant_id, policy_version_id, dependency_type, dependency_key) do nothing
  `, [tenantId, versionId, workflowCode])
}

async function publishPolicyVersion({ tenantId, actorUserId, policyId, versionId, versionNumber, reason }) {
  await client.query(`
    update policy_versions
       set status = 'published', approved_by = $3, approved_at = now(),
           published_by = $3, published_at = now()
     where tenant_id = $1 and id = $2
  `, [tenantId, versionId, actorUserId])
  await client.query(`
    update policy_definitions
       set status = 'published', current_version = $3
     where tenant_id = $1 and id = $2
  `, [tenantId, policyId, versionNumber])
  await client.query(`
    update policy_publications
       set status = 'revoked', effective_until = greatest(now(), effective_from + interval '1 second')
     where tenant_id = $1 and policy_definition_id = $2 and status = 'active'
  `, [tenantId, policyId])
  await client.query(`
    insert into policy_publications (
      tenant_id, policy_definition_id, policy_version_id, status,
      effective_from, published_by, approved_by, publication_reason
    ) values ($1, $2, $3, 'active', now() - interval '1 second', $4, $4, $5)
  `, [tenantId, policyId, versionId, actorUserId, reason])
}

async function loadCurrentPolicy(tenantId, policyCode) {
  const result = await client.query(`
    select version.*
      from policy_definitions definition
      join policy_versions version
        on version.tenant_id = definition.tenant_id
       and version.policy_definition_id = definition.id
       and version.version_number = definition.current_version
     where definition.tenant_id = $1 and definition.policy_code = $2
  `, [tenantId, policyCode])
  if (!result.rows[0]) throw new Error(`Política ${policyCode} não encontrada após o seed.`)
  return result.rows[0]
}

async function loadScopes(table, versionColumn, tenantId, versionId) {
  if (!['policy_scopes', 'approval_workflow_scopes'].includes(table)) {
    throw new Error('Tabela de escopo inválida.')
  }
  if (!['policy_version_id', 'workflow_version_id'].includes(versionColumn)) {
    throw new Error('Coluna de escopo inválida.')
  }
  const result = await client.query(`
    select scope_type, scope_id, mode, specificity
      from ${table}
     where tenant_id = $1 and ${versionColumn} = $2
     order by scope_type, scope_id nulls first, mode, specificity
  `, [tenantId, versionId])
  return result.rows
}

async function assertPolicyScopesMatch(tenantId, sourceVersionId, targetVersionId) {
  const source = await loadScopes('policy_scopes', 'policy_version_id', tenantId, sourceVersionId)
  const target = await loadScopes('policy_scopes', 'policy_version_id', tenantId, targetVersionId)
  if (scopeSignature(source) !== scopeSignature(target)) {
    throw new Error('A política aérea não preserva o escopo da política de hotel.')
  }
}

async function assertWorkflowScopesMatch(tenantId, sourceVersionId, targetVersionId) {
  const source = await loadScopes('approval_workflow_scopes', 'workflow_version_id', tenantId, sourceVersionId)
  const target = await loadScopes('approval_workflow_scopes', 'workflow_version_id', tenantId, targetVersionId)
  if (scopeSignature(source) !== scopeSignature(target)) {
    throw new Error('O workflow aéreo não preserva o escopo do workflow de hotel.')
  }
}

async function assertFinalRouting({
  tenantId,
  sourcePolicyVersionId,
  sourceWorkflowVersionId,
  sourceGraph,
}) {
  const hotel = await loadCurrentPolicy(tenantId, HOTEL_POLICY_CODE)
  const air = await loadCurrentPolicy(tenantId, AIR_POLICY_CODE)
  const airWorkflow = await client.query(`
      select definition.status, version.id as version_id,
             version.status as version_status, version.graph_snapshot
        from approval_workflow_definitions definition
        join approval_workflow_versions version
          on version.tenant_id = definition.tenant_id
         and version.workflow_definition_id = definition.id
         and version.version_number = definition.current_version
       where definition.tenant_id = $1 and definition.workflow_code = $2
    `, [tenantId, AIR_WORKFLOW_CODE])
  const airWorkflowRow = airWorkflow.rows[0]
  if (
    hotel.status !== 'published'
    || !conditionTargetsOnlyService(hotel.condition_ast, 'hotelaria')
    || !approvalActionsTargetWorkflow(hotel.actions_ast, HOTEL_WORKFLOW_CODE)
  ) throw new Error(`Pós-condição inválida para ${HOTEL_POLICY_CODE}.`)
  if (
    air.status !== 'published'
    || !conditionTargetsOnlyService(air.condition_ast, 'aereo')
    || !approvalActionsTargetWorkflow(air.actions_ast, AIR_WORKFLOW_CODE)
  ) throw new Error(`Pós-condição inválida para ${AIR_POLICY_CODE}.`)
  if (
    !airWorkflowRow
    || airWorkflowRow.status !== 'published'
    || airWorkflowRow.version_status !== 'published'
    || workflowApprovalSignature(airWorkflowRow.graph_snapshot) !== workflowApprovalSignature(sourceGraph)
  ) throw new Error(`Pós-condição inválida para ${AIR_WORKFLOW_CODE}.`)
  await assertPolicyScopesMatch(tenantId, sourcePolicyVersionId, air.id)
  await assertWorkflowScopesMatch(tenantId, sourceWorkflowVersionId, airWorkflowRow.version_id)
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  analyzePolicyConflicts,
  buildPolicyTemplateCatalog,
  evaluatePolicies,
  executablePolicyVersionSchema,
  sha256,
  type ExecutablePolicyVersion,
  type PolicyEvaluationContext,
  type PolicyEvaluationResult,
  type PolicyScope,
  type PolicyTemplateConfiguration,
} from '@/lib/policy'
import {
  policyDraftInputSchema,
  policySimulationSchema,
  policyTemplateInstantiationSchema,
  policyTransitionSchema,
  policyVersionInputSchema,
  type PolicyDraftInput,
  type PolicySimulationInput,
  type PolicyTemplateInstantiationInput,
  type PolicyTransitionInput,
  type PolicyVersionInput,
} from '@/lib/policy/admin-schema'
import { requireCompanyAccess, requireGroupAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface PolicyDefinitionRow extends QueryResultRow {
  id: string
  policy_code: string
  name: string
  description: string
  category: string
  status: string
  priority: number
  severity: ExecutablePolicyVersion['severity']
  inheritance_mode: ExecutablePolicyVersion['inheritanceMode']
  overridable: boolean
  business_justification: string
  tags: string[]
  current_version: number | null
  created_by: string
  created_at: string
  updated_at: string
}

interface PolicyVersionRow extends QueryResultRow {
  id: string
  policy_definition_id: string
  policy_code?: string
  version_number: number
  status: string
  name: string
  description: string
  category: string
  priority: number
  severity: ExecutablePolicyVersion['severity']
  inheritance_mode: ExecutablePolicyVersion['inheritanceMode']
  overridable: boolean
  checkpoints: string[]
  condition_ast: unknown
  actions_ast: unknown
  exception_ast: unknown
  timezone: string
  valid_from: string | null
  valid_until: string | null
  content_hash: string
  business_justification: string
  change_summary: string
  created_by: string
  approved_by: string | null
  approved_at: string | null
  published_by: string | null
  published_at: string | null
  created_at: string
}

interface PolicyScopeRow extends QueryResultRow {
  policy_version_id: string
  scope_type: PolicyScope['type']
  scope_id: string | null
  mode: 'include' | 'exclude'
  specificity: number
}

interface PolicyDependencyRow extends QueryResultRow {
  policy_version_id: string
  dependency_type: string
  dependency_key: string
  required: boolean
}

export interface PolicyListItem {
  id: string
  code: string
  name: string
  description: string
  category: string
  status: string
  priority: number
  severity: string
  currentVersion: number | null
  scopes: PolicyScope[]
  updatedAt: string
}

export interface PolicyDetail extends PolicyListItem {
  businessJustification: string
  tags: string[]
  createdBy: string
  versions: Array<{
    id: string
    version: number
    status: string
    contentHash: string
    changeSummary: string
    createdAt: string
    approvedAt: string | null
    publishedAt: string | null
  }>
  current: ExecutablePolicyVersion | null
}

export interface PersistPolicyEvaluationInput {
  companyId: string
  employeeId?: string | null
  demandId?: string | null
  reservationId?: string | null
  context: PolicyEvaluationContext
}

export class PolicyServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message)
    this.name = 'PolicyServiceError'
  }
}

export function listBuiltInPolicyTemplates(filters: {
  category?: string
  segment?: string
  search?: string
  offset?: number
  limit?: number
} = {}): { items: PolicyTemplateConfiguration[]; total: number; families: number; categories: number } {
  const search = filters.search?.trim().toLocaleLowerCase('pt-BR')
  const filtered = buildPolicyTemplateCatalog().filter((template) => (
    (!filters.category || template.category === filters.category)
    && (!filters.segment || template.segment === filters.segment)
    && (!search || `${template.name} ${template.description} ${template.familyKey}`.toLocaleLowerCase('pt-BR').includes(search))
  ))
  const offset = Math.max(0, filters.offset || 0)
  const limit = Math.min(100, Math.max(1, filters.limit || 50))
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    families: new Set(filtered.map((template) => template.familyKey)).size,
    categories: new Set(filtered.map((template) => template.category)).size,
  }
}

export async function instantiateBuiltInPolicyTemplate(
  principal: RequestPrincipal,
  templateKey: string,
  rawInput: unknown,
): Promise<PolicyDetail> {
  const input: PolicyTemplateInstantiationInput = policyTemplateInstantiationSchema.parse(rawInput)
  const template = buildPolicyTemplateCatalog().find((item) => item.templateKey === templateKey)
  if (!template) {
    throw new PolicyServiceError('POLICY_TEMPLATE_NOT_FOUND', 'Modelo de politica nao encontrado.', 404)
  }
  const hardBlock = template.actions.some((action) => (
    action.type === 'block' || action.type === 'prevent_issuance' || action.type === 'block_supplier'
  ))
  const risks = template.risks.length
    ? ` Riscos controlados: ${template.risks.join(' ')}`
    : ''
  return createPolicyDraft(principal, {
    policyCode: input.policyCode || policyCodeFromTemplate(template, input),
    name: input.name || template.name,
    description: input.description || template.description,
    category: template.category,
    priority: input.priority,
    severity: input.severity || (hardBlock ? 'blocking' : 'warning'),
    inheritanceMode: input.inheritanceMode,
    overridable: input.overridable,
    businessJustification: `${template.description}${risks}`.slice(0, 4_000),
    changeSummary: `Criada a partir do modelo ${template.templateKey}.`,
    tags: unique(['template', template.familyKey, template.segment, ...input.tags]),
    checkpoints: template.checkpoints,
    timezone: 'America/Sao_Paulo',
    validFrom: input.validFrom || null,
    validUntil: input.validUntil || null,
    scopes: [input.scope],
    condition: template.condition,
    actions: template.actions,
    exceptions: [],
    dependencies: template.dependencies.map((dependency) => ({
      ...dependency,
      configuration: {},
    })),
  })
}

export async function listPolicies(
  principal: RequestPrincipal,
  filters: { status?: string; category?: string; search?: string; limit?: number; offset?: number } = {},
): Promise<{ items: PolicyListItem[]; total: number }> {
  const allowed = await visibleScope(principal)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, allowed.companyIds, allowed.groupIds, allowed.tenantWide]
    const clauses = [
      'definition.tenant_id = $1',
      `exists (
        select 1
        from policy_versions visible_version
        join policy_scopes visible_scope
          on visible_scope.tenant_id = visible_version.tenant_id
          and visible_scope.policy_version_id = visible_version.id
        where visible_version.tenant_id = definition.tenant_id
          and visible_version.policy_definition_id = definition.id
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
    if (filters.category) {
      values.push(filters.category)
      clauses.push(`definition.category = $${values.length}`)
    }
    if (filters.search?.trim()) {
      values.push(`%${filters.search.trim()}%`)
      clauses.push(`(definition.name ilike $${values.length} or definition.policy_code ilike $${values.length})`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from policy_definitions definition where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const rows = await client.query<PolicyDefinitionRow>(
      `select definition.*
       from policy_definitions definition
       where ${clauses.join(' and ')}
       order by definition.updated_at desc, definition.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    const scopes = await loadScopes(client, principal.tenantId, rows.rows.map((row) => row.id), true)
    return {
      items: rows.rows.map((row) => definitionListItem(row, scopes.get(row.id) || [])),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function getPolicyDetail(principal: RequestPrincipal, policyId: string): Promise<PolicyDetail> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinitionForUpdate(client, principal.tenantId, policyId, false)
    const versions = await client.query<PolicyVersionRow>(
      `select * from policy_versions
       where tenant_id = $1 and policy_definition_id = $2
       order by version_number desc`,
      [principal.tenantId, policyId],
    )
    const currentRow = versions.rows.find((row) => row.version_number === definition.current_version) || null
    const current = currentRow ? await hydrateExecutablePolicy(client, principal.tenantId, definition.policy_code, currentRow) : null
    if (current) await assertCanViewScopes(principal, current.scopes, definition.status)
    return {
      ...definitionListItem(definition, current?.scopes || []),
      businessJustification: definition.business_justification,
      tags: definition.tags || [],
      createdBy: definition.created_by,
      versions: versions.rows.map((version) => ({
        id: version.id,
        version: version.version_number,
        status: version.status,
        contentHash: version.content_hash,
        changeSummary: version.change_summary,
        createdAt: iso(version.created_at),
        approvedAt: optionalIso(version.approved_at),
        publishedAt: optionalIso(version.published_at),
      })),
      current,
    }
  })
}

export async function createPolicyDraft(principal: RequestPrincipal, rawInput: unknown): Promise<PolicyDetail> {
  const input = policyDraftInputSchema.parse(rawInput)
  assertGenericPolicyCodeAllowed(input.policyCode)
  await assertCanManageScopes(principal, input.scopes)
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const contentHash = policyContentHash(input)
    const definition = await client.query<{ id: string }>(
      `insert into policy_definitions (
         tenant_id, policy_code, name, description, category, status, priority,
         severity, inheritance_mode, overridable, business_justification, tags,
         current_version, created_by
       ) values ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, 1, $12)
       returning id`,
      [
        principal.tenantId, input.policyCode, input.name, input.description, input.category,
        input.priority, input.severity, input.inheritanceMode, input.overridable,
        input.businessJustification, unique(input.tags), principal.user.id,
      ],
    )
    const policyId = definition.rows[0].id
    const version = await insertPolicyVersion(client, principal, policyId, 1, input, contentHash)
    await insertPolicyChildren(client, principal.tenantId, version.id, input)
    await insertChangeAudit(client, principal, policyId, version.id, 'created', null, input, input.changeSummary)
    return policyId
  }).catch((error) => {
    if (isUniqueViolation(error)) throw new PolicyServiceError('POLICY_CODE_ALREADY_EXISTS', 'Ja existe uma politica com este codigo.', 409)
    throw error
  })
  return getPolicyDetail(principal, result)
}

export async function createPolicyVersion(
  principal: RequestPrincipal,
  policyId: string,
  rawInput: unknown,
): Promise<PolicyDetail> {
  const input = policyVersionInputSchema.parse(rawInput)
  await assertCanManageScopes(principal, input.scopes)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinitionForUpdate(client, principal.tenantId, policyId, true)
    assertGenericPolicyCodeAllowed(definition.policy_code)
    if (definition.current_version !== input.expectedCurrentVersion) {
      throw new PolicyServiceError('STALE_POLICY_VERSION', 'A politica foi alterada por outro usuario.', 409)
    }
    const nextVersion = (definition.current_version || 0) + 1
    const contentHash = policyContentHash({ ...input, policyCode: definition.policy_code })
    const version = await insertPolicyVersion(client, principal, policyId, nextVersion, input, contentHash)
    await insertPolicyChildren(client, principal.tenantId, version.id, input)
    await client.query(
      `update policy_definitions set
         name = $3, description = $4, category = $5, status = 'draft', priority = $6,
         severity = $7, inheritance_mode = $8, overridable = $9,
         business_justification = $10, tags = $11, current_version = $12
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId, policyId, input.name, input.description, input.category,
        input.priority, input.severity, input.inheritanceMode, input.overridable,
        input.businessJustification, unique(input.tags), nextVersion,
      ],
    )
    await insertChangeAudit(client, principal, policyId, version.id, 'version_created', definition, input, input.changeSummary)
  })
  return getPolicyDetail(principal, policyId)
}

export async function transitionPolicyVersion(
  principal: RequestPrincipal,
  policyId: string,
  rawInput: unknown,
): Promise<PolicyDetail> {
  const input = policyTransitionSchema.parse(rawInput)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinitionForUpdate(client, principal.tenantId, policyId, true)
    assertGenericPolicyCodeAllowed(definition.policy_code)
    const versionResult = await client.query<PolicyVersionRow>(
      `select * from policy_versions
       where tenant_id = $1 and id = $2 and policy_definition_id = $3
       for update`,
      [principal.tenantId, input.versionId, policyId],
    )
    const version = versionResult.rows[0]
    if (!version) throw new PolicyServiceError('POLICY_VERSION_NOT_FOUND', 'Versao da politica nao encontrada.', 404)
    const scopes = await loadVersionScopes(client, principal.tenantId, version.id)
    await assertCanManageScopes(principal, scopes, input.action === 'publish' ? 'publicar_politicas' : 'gerenciar_politicas')
    assertTransition(version.status, input.action)
    if (['approve', 'publish'].includes(input.action) && version.created_by === principal.user.id) {
      throw new PolicyServiceError('POLICY_SEPARATION_OF_DUTIES', 'O autor da versao nao pode aprovar ou publicar a propria alteracao.', 409)
    }
    if (input.action === 'approve' || input.action === 'publish') {
      await assertPolicyPublishable(client, principal, definition, version, scopes)
    }

    if (input.action === 'submit_review') {
      await setPolicyStatus(client, principal.tenantId, definition.id, version.id, 'in_review')
    } else if (input.action === 'approve') {
      await client.query(
        `update policy_versions set status = 'approved', approved_by = $3, approved_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, version.id, principal.user.id],
      )
      await client.query(`update policy_definitions set status = 'approved' where tenant_id = $1 and id = $2`, [principal.tenantId, policyId])
    } else if (input.action === 'publish') {
      if (!version.approved_by || !version.approved_at) {
        throw new PolicyServiceError('POLICY_APPROVAL_REQUIRED', 'A versao precisa ser aprovada antes da publicacao.', 409)
      }
      const effectiveFrom = input.effectiveFrom || new Date().toISOString()
      if (input.effectiveUntil && Date.parse(input.effectiveUntil) <= Date.parse(effectiveFrom)) {
        throw new PolicyServiceError('INVALID_PUBLICATION_PERIOD', 'Fim da publicacao deve ser posterior ao inicio.')
      }
      await client.query(
        `update policy_publications
         set effective_until = $4, status = case when $4 <= now() then 'expired' else status end
         where tenant_id = $1 and policy_definition_id = $2 and status in ('active', 'scheduled')
           and effective_from < $3
           and (effective_until is null or effective_until > $3)`,
        [principal.tenantId, policyId, effectiveFrom, effectiveFrom],
      )
      await client.query(
        `update policy_versions
         set status = 'published', published_by = $3, published_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, version.id, principal.user.id],
      )
      await client.query(
        `insert into policy_publications (
           tenant_id, policy_definition_id, policy_version_id, status,
           effective_from, effective_until, published_by, approved_by, publication_reason
         ) values ($1, $2, $3, case when $4 > now() then 'scheduled' else 'active' end, $4, $5, $6, $7, $8)`,
        [
          principal.tenantId, policyId, version.id, effectiveFrom, input.effectiveUntil || null,
          principal.user.id, version.approved_by, input.reason,
        ],
      )
      await client.query(`update policy_definitions set status = 'published' where tenant_id = $1 and id = $2`, [principal.tenantId, policyId])
    } else if (input.action === 'suspend') {
      await setPolicyStatus(client, principal.tenantId, definition.id, version.id, 'suspended')
      await client.query(
        `update policy_publications set status = 'suspended'
         where tenant_id = $1 and policy_version_id = $2 and status in ('active', 'scheduled')`,
        [principal.tenantId, version.id],
      )
    } else {
      await setPolicyStatus(client, principal.tenantId, definition.id, version.id, 'archived')
    }
    await insertChangeAudit(client, principal, policyId, version.id, input.action, version, { status: input.action }, input.reason)
  })
  return getPolicyDetail(principal, policyId)
}

export function assertGenericPolicyCodeAllowed(policyCode: string): void {
  if (!policyCode.startsWith('matrix.trigger.')) return
  throw new PolicyServiceError(
    'POLICY_MATRIX_NAMESPACE_RESERVED',
    'Politicas com prefixo matrix.trigger.* sao gerenciadas exclusivamente pela matriz corporativa.',
    409,
  )
}

export async function simulatePolicies(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<{ simulationId: string | null; result: PolicyEvaluationResult; conflicts: ReturnType<typeof analyzePolicyConflicts> }> {
  const input = policySimulationSchema.parse(rawInput)
  await assertCanViewScopes(principal, input.scopes, 'published')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const policies = input.policyVersionIds.length
      ? await loadPolicyVersionsByIds(client, principal.tenantId, input.policyVersionIds)
      : []
    if (input.candidate) policies.push(candidateExecutable(input.candidate))
    const conflicts = analyzePolicyConflicts(policies, await availableDependencies(client, principal))
    const result = evaluatePolicies(policies, {
      facts: input.facts,
      scopes: input.scopes.map((scope) => ({ type: scope.type, id: scope.id })),
      checkpoint: input.checkpoint,
      evaluatedAt: input.evaluatedAt,
      mode: 'simulation',
    })
    let simulationId: string | null = null
    if (input.persistResult) {
      const inserted = await client.query<{ id: string }>(
        `insert into policy_simulations (
           tenant_id, name, policy_version_ids, source_type, input_facts,
           candidate_result, impact_summary, created_by
         ) values ($1, $2, $3::uuid[], $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
         returning id`,
        [
          principal.tenantId, input.name, input.policyVersionIds, input.sourceType,
          JSON.stringify(input.facts), JSON.stringify(result),
          JSON.stringify(simulationImpact(result, conflicts)), principal.user.id,
        ],
      )
      simulationId = inserted.rows[0].id
    }
    return { simulationId, result, conflicts }
  })
}

export async function evaluateAndPersistPolicies(
  principal: RequestPrincipal,
  input: PersistPolicyEvaluationInput,
): Promise<{ databaseEvaluationId: string; result: PolicyEvaluationResult }> {
  await requireCompanyAccess(principal, input.companyId, 'ver_politicas')
  return withTenantTransaction(principal.tenantId, (client) => (
    evaluateAndPersistPoliciesInTransaction(client, principal, input)
  ))
}

export async function evaluateAndPersistPoliciesInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  input: PersistPolicyEvaluationInput,
): Promise<{ databaseEvaluationId: string; result: PolicyEvaluationResult }> {
  const startedAt = performance.now()
  const actorUserId = principal.actor?.user.id || principal.user.id
  await validateEntityOwnership(client, principal.tenantId, input)
  const policies = await loadPublishedPolicies(client, principal.tenantId, input.context)
  const result = evaluatePolicies(policies, { ...input.context, mode: input.context.mode || 'enforce' })
  const inserted = await client.query<{ id: string }>(
    `insert into policy_evaluations (
       tenant_id, demand_id, reservation_id, company_id, employee_id, checkpoint,
       mode, facts, facts_hash, result, result_hash, passed, has_blocks,
       evaluated_by, duration_ms, engine_version
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13, $14, $15, $16)
     returning id`,
    [
      principal.tenantId, input.demandId || null, input.reservationId || null,
      input.companyId, input.employeeId || null, input.context.checkpoint,
      input.context.mode || 'enforce', JSON.stringify(input.context.facts), result.factsHash,
      JSON.stringify(result), result.resultHash, result.passed, result.blocks.length > 0,
      actorUserId, Math.max(0, Math.round(performance.now() - startedAt)), '1.0.0',
    ],
  )
  const databaseEvaluationId = inserted.rows[0].id
  for (const decision of result.decisions) {
    const outcome = decision.evaluationError
      ? 'blocked'
      : decision.exceptionApplied
        ? 'exception'
        : decision.actions.some((action) => ['block', 'prevent_issuance', 'block_supplier'].includes(action.type))
          ? 'blocked'
          : decision.actions.some((action) => action.type.includes('approval'))
            ? 'approval'
            : decision.actions.some((action) => action.type.includes('justification'))
              ? 'justification'
              : decision.matched ? 'warning' : 'passed'
    await client.query(
      `insert into policy_decisions (
         tenant_id, evaluation_id, policy_version_id, outcome,
         condition_result, observed_values, explanation, remediation
       ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        principal.tenantId, databaseEvaluationId, decision.policyVersionId, outcome,
        JSON.stringify(decision.trace), JSON.stringify(observedValues(decision.trace)),
        decision.explanation, decision.actions.find((action) => action.remediation)?.remediation || null,
      ],
    )
  }
  return { databaseEvaluationId, result }
}

async function loadPublishedPolicies(
  client: PoolClient,
  tenantId: string,
  context: PolicyEvaluationContext,
): Promise<ExecutablePolicyVersion[]> {
  const scopePairs = context.scopes.map((scope) => `${scope.type}:${scope.id || ''}`)
  const versions = await client.query<PolicyVersionRow & { policy_code: string }>(
    `select distinct version.*, definition.policy_code
     from policy_versions version
     join policy_definitions definition
       on definition.tenant_id = version.tenant_id and definition.id = version.policy_definition_id
     join policy_publications publication
       on publication.tenant_id = version.tenant_id and publication.policy_version_id = version.id
     where version.tenant_id = $1
       and version.status = 'published'
       and publication.status in ('active', 'scheduled')
       and publication.effective_from <= $2::timestamptz
       and (publication.effective_until is null or publication.effective_until > $2::timestamptz)
       and exists (
         select 1 from policy_scopes scope
         where scope.tenant_id = version.tenant_id and scope.policy_version_id = version.id
           and scope.mode = 'include'
           and (scope.scope_type || ':' || coalesce(scope.scope_id, '')) = any($3::text[])
       )
     order by version.priority desc, version.id`,
    [tenantId, context.evaluatedAt, scopePairs],
  )
  const hydrated: ExecutablePolicyVersion[] = []
  // A PoolClient executes one query at a time. Hydrating in parallel on the
  // same client causes overlapping queries and will be rejected by pg 9.
  for (const version of versions.rows) {
    hydrated.push(await hydrateExecutablePolicy(client, tenantId, version.policy_code, version))
  }
  return hydrated
}

async function loadPolicyVersionsByIds(client: PoolClient, tenantId: string, ids: string[]): Promise<ExecutablePolicyVersion[]> {
  const rows = await client.query<PolicyVersionRow & { policy_code: string }>(
    `select version.*, definition.policy_code
     from policy_versions version
     join policy_definitions definition
       on definition.tenant_id = version.tenant_id and definition.id = version.policy_definition_id
     where version.tenant_id = $1 and version.id = any($2::uuid[])`,
    [tenantId, ids],
  )
  if (rows.rowCount !== new Set(ids).size) throw new PolicyServiceError('POLICY_VERSION_NOT_FOUND', 'Uma ou mais versoes nao foram encontradas.', 404)
  const hydrated: ExecutablePolicyVersion[] = []
  for (const row of rows.rows) {
    hydrated.push(await hydrateExecutablePolicy(client, tenantId, row.policy_code, row))
  }
  return hydrated
}

async function hydrateExecutablePolicy(
  client: PoolClient,
  tenantId: string,
  code: string,
  version: PolicyVersionRow,
): Promise<ExecutablePolicyVersion> {
  const scopes = await loadVersionScopes(client, tenantId, version.id)
  const dependencies = await client.query<PolicyDependencyRow>(
    `select policy_version_id, dependency_type, dependency_key, required
     from policy_dependencies where tenant_id = $1 and policy_version_id = $2`,
    [tenantId, version.id],
  )
  return executablePolicyVersionSchema.parse({
    policyId: version.policy_definition_id,
    versionId: version.id,
    code,
    version: version.version_number,
    name: version.name,
    description: version.description,
    category: version.category,
    priority: version.priority,
    severity: version.severity,
    inheritanceMode: version.inheritance_mode,
    overridable: version.overridable,
    checkpoints: version.checkpoints,
    scopes,
    condition: version.condition_ast,
    actions: version.actions_ast,
    exceptions: version.exception_ast,
    dependencies: dependencies.rows.map((dependency) => ({
      type: dependency.dependency_type,
      key: dependency.dependency_key,
      required: dependency.required,
    })),
    validFrom: optionalIso(version.valid_from),
    validUntil: optionalIso(version.valid_until),
    timezone: version.timezone,
    contentHash: version.content_hash,
  })
}

async function insertPolicyVersion(
  client: PoolClient,
  principal: RequestPrincipal,
  policyId: string,
  versionNumber: number,
  input: Omit<PolicyDraftInput, 'policyCode'> | PolicyDraftInput | PolicyVersionInput,
  contentHash: string,
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `insert into policy_versions (
       tenant_id, policy_definition_id, version_number, status, name, description,
       category, priority, severity, inheritance_mode, overridable, condition_ast,
       actions_ast, exception_ast, checkpoints, timezone, valid_from, valid_until, tags,
       business_justification, content_hash, change_summary, created_by
     ) values (
       $1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
       $12::jsonb, $13::jsonb, $14::text[], $15, $16, $17, $18, $19, $20, $21, $22
     ) returning id`,
    [
      principal.tenantId, policyId, versionNumber, input.name, input.description,
      input.category, input.priority, input.severity, input.inheritanceMode,
      input.overridable, JSON.stringify(input.condition), JSON.stringify(input.actions),
      JSON.stringify(input.exceptions), input.checkpoints, input.timezone, input.validFrom || null,
      input.validUntil || null, unique(input.tags), input.businessJustification,
      contentHash, input.changeSummary, principal.user.id,
    ],
  )
  return result.rows[0]
}

async function insertPolicyChildren(
  client: PoolClient,
  tenantId: string,
  versionId: string,
  input: Omit<PolicyDraftInput, 'policyCode'> | PolicyDraftInput | PolicyVersionInput,
): Promise<void> {
  for (const scope of input.scopes) {
    await client.query(
      `insert into policy_scopes (tenant_id, policy_version_id, scope_type, scope_id, mode, specificity)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenantId, versionId, scope.type, scope.id || null, scope.mode, scope.specificity],
    )
  }
  const ruleSet = await client.query<{ id: string }>(
    `insert into policy_rule_sets (tenant_id, policy_version_id, name, logical_operator)
     values ($1, $2, 'Regra principal', $3) returning id`,
    [tenantId, versionId, expressionOperator(input.condition)],
  )
  await client.query(
    `insert into policy_conditions (tenant_id, rule_set_id, sequence, condition_ast)
     values ($1, $2, 0, $3::jsonb)`,
    [tenantId, ruleSet.rows[0].id, JSON.stringify(input.condition)],
  )
  for (const [index, action] of input.actions.entries()) {
    await client.query(
      `insert into policy_actions (tenant_id, policy_version_id, action_type, sequence, configuration, idempotency_scope)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        tenantId, versionId, action.type, index,
        JSON.stringify({ message: action.message, remediation: action.remediation, ...(action.configuration || {}) }),
        `${versionId}:${index}`,
      ],
    )
  }
  for (const [index, exception] of input.exceptions.entries()) {
    await client.query(
      `insert into policy_exceptions (
         tenant_id, policy_version_id, name, condition_ast, justification
       ) values ($1, $2, $3, $4::jsonb, $5)`,
      [tenantId, versionId, `Excecao ${index + 1}`, JSON.stringify(exception), 'Excecao declarada e sujeita a auditoria.'],
    )
  }
  for (const dependency of input.dependencies) {
    await client.query(
      `insert into policy_dependencies (
         tenant_id, policy_version_id, dependency_type, dependency_key,
         required, minimum_version, configuration
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        tenantId, versionId, dependency.type, dependency.key, dependency.required,
        dependency.minimumVersion || null, JSON.stringify(dependency.configuration),
      ],
    )
  }
}

async function assertPolicyPublishable(
  client: PoolClient,
  principal: RequestPrincipal,
  definition: PolicyDefinitionRow,
  version: PolicyVersionRow,
  scopes: PolicyScope[],
  options: { skipScopePermission?: boolean } = {},
): Promise<void> {
  const executable = await hydrateExecutablePolicy(client, principal.tenantId, definition.policy_code, version)
  const available = await availableDependencies(client, principal)
  const current = await loadPolicyVersionsForConflict(client, principal.tenantId, version.id)
  const conflicts = analyzePolicyConflicts([
    ...current.filter((candidate) => candidate.policyId !== definition.id),
    executable,
  ], available)
  await client.query('delete from policy_conflicts where tenant_id = $1 and policy_version_id = $2 and status = $3', [principal.tenantId, version.id, 'open'])
  for (const conflict of conflicts) {
    const other = conflict.policyVersionIds.find((id) => id !== version.id)
    await client.query(
      `insert into policy_conflicts (
         tenant_id, policy_version_id, conflicting_policy_version_id,
         conflict_type, severity, explanation
       ) values ($1, $2, $3, $4, $5, $6)`,
      [principal.tenantId, version.id, isUuid(other) ? other : null, conflict.type, conflict.severity, conflict.explanation],
    )
  }
  const blocking = conflicts.filter((conflict) => conflict.severity === 'blocking')
  if (blocking.length) {
    throw new PolicyServiceError('POLICY_CONFLICTS_BLOCK_PUBLICATION', blocking.map((item) => item.explanation).join(' '), 409)
  }
  if (!options.skipScopePermission) {
    await assertCanManageScopes(principal, scopes, 'publicar_politicas')
  }
}

export async function assertPolicyVersionPublishableInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  policyId: string,
  versionId: string,
): Promise<void> {
  const definition = await loadDefinitionForUpdate(client, principal.tenantId, policyId, false)
  const version = await client.query<PolicyVersionRow>(
    `select * from policy_versions
     where tenant_id = $1 and id = $2 and policy_definition_id = $3`,
    [principal.tenantId, versionId, policyId],
  )
  if (!version.rows[0]) throw new PolicyServiceError('POLICY_VERSION_NOT_FOUND', 'Versao da politica nao encontrada.', 404)
  const scopes = await loadVersionScopes(client, principal.tenantId, versionId)
  await assertPolicyPublishable(client, principal, definition, version.rows[0], scopes, { skipScopePermission: true })
}

async function loadPolicyVersionsForConflict(
  client: PoolClient,
  tenantId: string,
  excludedVersionId: string,
): Promise<ExecutablePolicyVersion[]> {
  const rows = await client.query<PolicyVersionRow & { policy_code: string }>(
    `select version.*, definition.policy_code
     from policy_versions version
     join policy_definitions definition
       on definition.tenant_id = version.tenant_id and definition.id = version.policy_definition_id
     where version.tenant_id = $1 and version.id <> $2 and version.status in ('approved', 'published')`,
    [tenantId, excludedVersionId],
  )
  const hydrated: ExecutablePolicyVersion[] = []
  for (const row of rows.rows) {
    hydrated.push(await hydrateExecutablePolicy(client, tenantId, row.policy_code, row))
  }
  return hydrated
}

async function availableDependencies(client: PoolClient, principal: RequestPrincipal): Promise<Set<string>> {
  const result = new Set<string>()
  const policies = await client.query<{ policy_code: string }>(
    `select policy_code from policy_definitions where tenant_id = $1 and status = 'published'`,
    [principal.tenantId],
  )
  policies.rows.forEach((row) => result.add(`policy:${row.policy_code}`))
  const workflows = await client.query<{ workflow_code: string }>(
    `select distinct definition.workflow_code
     from approval_workflow_definitions definition
     join approval_workflow_versions version
       on version.tenant_id = definition.tenant_id and version.workflow_definition_id = definition.id
     where definition.tenant_id = $1 and version.status = 'published'`,
    [principal.tenantId],
  )
  workflows.rows.forEach((row) => result.add(`workflow:${row.workflow_code}`))
  const budget = await client.query('select 1 from budgets where tenant_id = $1 and status = $2 limit 1', [principal.tenantId, 'active'])
  if (budget.rowCount) result.add('budget:active-budget')
  const directoryTables: Array<[string, string]> = [
    ['cost-centers', 'cost_centers'], ['projects', 'projects'], ['preferred-hotels', 'hotels'],
  ]
  for (const [key, table] of directoryTables) {
    const rows = await client.query(`select 1 from ${table} where tenant_id = $1 limit 1`, [principal.tenantId])
    if (rows.rowCount) result.add(`directory:${key}`)
  }
  Object.entries(principal.entitlements).forEach(([key, enabled]) => { if (enabled) result.add(`feature:${key}`) })
  return result
}

async function assertCanManageScopes(
  principal: RequestPrincipal,
  scopes: Array<{ type: PolicyScope['type']; id?: string | null }>,
  permission: 'gerenciar_politicas' | 'publicar_politicas' = 'gerenciar_politicas',
): Promise<void> {
  for (const scope of scopes) {
    if (scope.type === 'tenant') {
      if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
        throw new PolicyServiceError('TENANT_POLICY_SCOPE_DENIED', 'Somente administrador do tenant pode gerenciar politica global.', 403)
      }
    } else if (scope.type === 'group' && scope.id) {
      await requireGroupAccess(principal, scope.id, permission)
    } else if (scope.type === 'company' && scope.id) {
      await requireCompanyAccess(principal, scope.id, permission)
    } else if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
      throw new PolicyServiceError(
        'ADVANCED_POLICY_SCOPE_REQUIRES_TENANT_ADMIN',
        `O escopo ${scope.type} exige administrador do tenant ate que seu diretorio corporativo esteja vinculado.`,
        403,
      )
    }
  }
}

async function assertCanViewScopes(
  principal: RequestPrincipal,
  scopes: Array<{ type: PolicyScope['type']; id?: string | null }>,
  status: string,
): Promise<void> {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return
  const allowedCompanies = new Set(
    principal.corporateAccess?.companies
      .filter((company) => company.permissions.ver_politicas)
      .map((company) => company.companyId) || [],
  )
  const allowedGroups = new Set(
    principal.corporateAccess?.groups
      .filter((group) => group.companyIds.some((companyId) => allowedCompanies.has(companyId)))
      .map((group) => group.groupId) || [],
  )
  let allowed = false
  for (const scope of scopes) {
    if (scope.type === 'tenant' && status === 'published') allowed = true
    else if (scope.type === 'group' && scope.id && allowedGroups.has(scope.id)) allowed = true
    else if (scope.type === 'company' && scope.id && allowedCompanies.has(scope.id)) allowed = true
  }
  if (!allowed) throw new PolicyServiceError('POLICY_SCOPE_ACCESS_DENIED', 'Politica fora do escopo autorizado.', 403)
}

async function visibleScope(principal: RequestPrincipal): Promise<{ tenantWide: boolean; companyIds: string[]; groupIds: string[] }> {
  return {
    tenantWide: principal.platformAdmin || principal.roleKey === 'tenant_admin',
    companyIds: principal.corporateAccess?.companies.filter((company) => company.permissions.ver_politicas).map((company) => company.companyId) || [],
    groupIds: principal.corporateAccess?.groups.filter((group) => group.companyIds.some((companyId) => (
      principal.corporateAccess?.companies.find((company) => company.companyId === companyId)?.permissions.ver_politicas
    ))).map((group) => group.groupId) || [],
  }
}

async function validateEntityOwnership(
  client: PoolClient,
  tenantId: string,
  input: PersistPolicyEvaluationInput,
): Promise<void> {
  const company = await client.query('select 1 from companies where tenant_id = $1 and id = $2 and deleted_at is null', [tenantId, input.companyId])
  if (!company.rowCount) throw new PolicyServiceError('COMPANY_NOT_FOUND', 'Empresa nao encontrada.', 404)
  if (input.employeeId) await assertEntityCompany(client, 'employees', input.employeeId, input.companyId, tenantId)
  if (input.demandId) await assertEntityCompany(client, 'demands', input.demandId, input.companyId, tenantId)
  if (input.reservationId) await assertEntityCompany(client, 'reservations', input.reservationId, input.companyId, tenantId)
}

async function assertEntityCompany(client: PoolClient, table: string, id: string, companyId: string, tenantId: string): Promise<void> {
  const result = await client.query(`select 1 from ${table} where tenant_id = $1 and id = $2 and company_id = $3`, [tenantId, id, companyId])
  if (!result.rowCount) throw new PolicyServiceError('POLICY_ENTITY_SCOPE_MISMATCH', 'Entidade nao pertence a empresa informada.', 409)
}

async function loadDefinitionForUpdate(
  client: PoolClient,
  tenantId: string,
  policyId: string,
  lock: boolean,
): Promise<PolicyDefinitionRow> {
  const result = await client.query<PolicyDefinitionRow>(
    `select * from policy_definitions where tenant_id = $1 and id = $2${lock ? ' for update' : ''}`,
    [tenantId, policyId],
  )
  if (!result.rowCount) throw new PolicyServiceError('POLICY_NOT_FOUND', 'Politica nao encontrada.', 404)
  return result.rows[0]
}

async function loadScopes(
  client: PoolClient,
  tenantId: string,
  definitionIds: string[],
  currentOnly: boolean,
): Promise<Map<string, PolicyScope[]>> {
  if (!definitionIds.length) return new Map()
  const rows = await client.query<PolicyScopeRow & { policy_definition_id: string }>(
    `select version.policy_definition_id, scope.*
     from policy_versions version
     join policy_definitions definition
       on definition.tenant_id = version.tenant_id and definition.id = version.policy_definition_id
     join policy_scopes scope
       on scope.tenant_id = version.tenant_id and scope.policy_version_id = version.id
     where version.tenant_id = $1 and version.policy_definition_id = any($2::uuid[])
       and ($3::boolean = false or version.version_number = definition.current_version)`,
    [tenantId, definitionIds, currentOnly],
  )
  const result = new Map<string, PolicyScope[]>()
  rows.rows.forEach((row) => result.set(row.policy_definition_id, [
    ...(result.get(row.policy_definition_id) || []),
    scopeFromRow(row),
  ]))
  return result
}

async function loadVersionScopes(client: PoolClient, tenantId: string, versionId: string): Promise<PolicyScope[]> {
  const rows = await client.query<PolicyScopeRow>(
    `select policy_version_id, scope_type, scope_id, mode, specificity
     from policy_scopes where tenant_id = $1 and policy_version_id = $2`,
    [tenantId, versionId],
  )
  return rows.rows.map(scopeFromRow)
}

function scopeFromRow(row: PolicyScopeRow): PolicyScope {
  return { type: row.scope_type, id: row.scope_id, mode: row.mode, specificity: row.specificity }
}

function definitionListItem(definition: PolicyDefinitionRow, scopes: PolicyScope[]): PolicyListItem {
  return {
    id: definition.id,
    code: definition.policy_code,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    status: definition.status,
    priority: definition.priority,
    severity: definition.severity,
    currentVersion: definition.current_version,
    scopes,
    updatedAt: iso(definition.updated_at),
  }
}

function candidateExecutable(input: PolicySimulationInput['candidate'] & {}): ExecutablePolicyVersion {
  if (!input) throw new PolicyServiceError('POLICY_CANDIDATE_REQUIRED', 'Politica candidata ausente.')
  const contentHash = policyContentHash(input)
  return executablePolicyVersionSchema.parse({
    policyId: `simulation-${contentHash.slice(0, 16)}`,
    versionId: `simulation-version-${contentHash.slice(0, 16)}`,
    code: input.policyCode,
    version: 1,
    name: input.name,
    description: input.description,
    category: input.category,
    priority: input.priority,
    severity: input.severity,
    inheritanceMode: input.inheritanceMode,
    overridable: input.overridable,
    checkpoints: input.checkpoints,
    scopes: input.scopes,
    condition: input.condition,
    actions: input.actions,
    exceptions: input.exceptions,
    dependencies: input.dependencies,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    timezone: input.timezone,
    contentHash,
  })
}

function policyContentHash(input: Omit<PolicyDraftInput, 'policyCode'> | PolicyDraftInput | PolicyVersionInput): string {
  return sha256({
    name: input.name, description: input.description, category: input.category,
    priority: input.priority, severity: input.severity, inheritanceMode: input.inheritanceMode,
    overridable: input.overridable, checkpoints: input.checkpoints, scopes: input.scopes, condition: input.condition,
    actions: input.actions, exceptions: input.exceptions, dependencies: input.dependencies,
    validFrom: input.validFrom || null, validUntil: input.validUntil || null, timezone: input.timezone,
  })
}

async function setPolicyStatus(
  client: PoolClient,
  tenantId: string,
  policyId: string,
  versionId: string,
  status: string,
): Promise<void> {
  await client.query('update policy_versions set status = $3 where tenant_id = $1 and id = $2', [tenantId, versionId, status])
  await client.query('update policy_definitions set status = $3 where tenant_id = $1 and id = $2', [tenantId, policyId, status])
}

async function insertChangeAudit(
  client: PoolClient,
  principal: RequestPrincipal,
  policyId: string,
  versionId: string,
  action: string,
  previousValue: unknown,
  nextValue: unknown,
  reason: string,
): Promise<void> {
  await client.query(
    `insert into policy_change_audits (
       tenant_id, policy_definition_id, policy_version_id, actor_user_id,
       action, previous_value, next_value, reason
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      principal.tenantId, policyId, versionId, principal.user.id, action,
      previousValue === null ? null : JSON.stringify(previousValue),
      nextValue === null ? null : JSON.stringify(nextValue), reason,
    ],
  )
}

function assertTransition(status: string, action: PolicyTransitionInput['action']): void {
  const allowed: Record<PolicyTransitionInput['action'], string[]> = {
    submit_review: ['draft'], approve: ['in_review'], publish: ['approved'],
    suspend: ['published'], archive: ['draft', 'in_review', 'approved', 'suspended'],
  }
  if (!allowed[action].includes(status)) {
    throw new PolicyServiceError('INVALID_POLICY_TRANSITION', `A acao ${action} nao e permitida no status ${status}.`, 409)
  }
}

function expressionOperator(expression: PolicyDraftInput['condition']): 'all' | 'any' | 'not' {
  if ('all' in expression) return 'all'
  if ('any' in expression) return 'any'
  if ('not' in expression) return 'not'
  return 'all'
}

function simulationImpact(result: PolicyEvaluationResult, conflicts: ReturnType<typeof analyzePolicyConflicts>) {
  return {
    blocks: result.blocks.length,
    approvals: result.approvalsRequired.length,
    justifications: result.justificationsRequired.length,
    warnings: result.warnings.length,
    conflicts: conflicts.length,
    unresolvedBlockingConflicts: conflicts.filter((conflict) => conflict.severity === 'blocking').length,
  }
}

function observedValues(trace: PolicyEvaluationResult['decisions'][number]['trace']): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const visit = (current: typeof trace) => {
    if (current.fact) values[current.fact] = current.observed
    current.children?.forEach(visit)
  }
  visit(trace)
  return values
}

function policyCodeFromTemplate(
  template: PolicyTemplateConfiguration,
  input: PolicyTemplateInstantiationInput,
): string {
  const scopeKey = input.scope.type === 'tenant' ? 'tenant' : input.scope.id || input.scope.type
  const base = `template.${template.familyKey}.${template.segment}.${input.scope.type}.${scopeKey}`
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[-_.]{2,}/g, '.')
    .replace(/^[-_.]+|[-_.]+$/g, '')
  if (base.length <= 100) return base
  return `${base.slice(0, 83).replace(/[-_.]+$/g, '')}.${sha256(base).slice(0, 16)}`
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
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

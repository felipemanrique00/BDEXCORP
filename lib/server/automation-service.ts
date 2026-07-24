import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  automationDraftInputSchema,
  automationSimulationSchema,
  automationTransitionSchema,
  automationVersionInputSchema,
  type AutomationDetail,
  type AutomationDraftInput,
  type AutomationListItem,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationScope,
  type AutomationSimulationInput,
  type AutomationSimulationResult,
  type AutomationStatus,
  type AutomationSubjectType,
  type AutomationTransitionInput,
  type AutomationVersion,
  type AutomationVersionInput,
} from '@/lib/automations'
import { evaluateExpression, sha256 } from '@/lib/policy'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { authorizeOrThrow } from '@/lib/server/authorization-service'
import {
  requireCompanyAccess,
  requireGroupAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  startEnterpriseWorkflowExecution,
} from '@/lib/server/enterprise-workflow-runtime-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface DefinitionRow extends QueryResultRow {
  id: string
  automation_code: string
  name: string
  description: string
  status: AutomationStatus
  current_version: string | number
  published_version: string | number | null
  event_type: string
  workflow_definition_id: string
  workflow_name: string
  workflow_status: string
  subject_type: AutomationSubjectType
  scopes: unknown
  run_count: string | number
  successful_runs: string | number
  failed_runs: string | number
  last_run_at: string | Date | null
  updated_at: string | Date
}

interface VersionRow extends QueryResultRow {
  id: string
  version_number: string | number
  status: AutomationStatus
  event_type: string
  workflow_definition_id: string
  workflow_name: string
  subject_type: AutomationSubjectType
  company_id_path: string
  subject_id_path: string
  condition_ast: unknown
  content_hash: string
  change_summary: string
  valid_from: string | Date | null
  valid_until: string | Date | null
  scopes: unknown
  created_by: string
  created_at: string | Date
  reviewed_by: string | null
  reviewed_at: string | Date | null
  approved_by: string | null
  approved_at: string | Date | null
  published_by: string | null
  published_at: string | Date | null
}

interface RunRow extends QueryResultRow {
  id: string
  automation_definition_id: string
  automation_name: string
  automation_version: string | number
  source_outbox_event_id: string
  event_type: string
  company_id: string | null
  company_name: string | null
  subject_type: AutomationSubjectType
  subject_id: string
  status: AutomationRunStatus
  condition_trace: unknown
  workflow_execution_id: string | null
  attempts: string | number
  error_code: string | null
  error_message: string | null
  started_at: string | Date | null
  completed_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

interface CandidateRow extends QueryResultRow {
  automation_id: string
  automation_name: string
  automation_version_id: string
  version_number: string | number
  workflow_definition_id: string
  subject_type: AutomationSubjectType
  company_id_path: string
  subject_id_path: string
  condition_ast: unknown
  scopes: unknown
  source_event_id: string
  aggregate_type: string
  aggregate_id: string
  event_type: string
  payload: unknown
  created_by: string | null
  event_created_at: string | Date
}

interface WorkflowRow extends QueryResultRow {
  id: string
  name: string
  status: string
  published_version: number | null
}

const TRANSITIONS: Record<
  AutomationTransitionInput['action'],
  { from: AutomationStatus[]; to: AutomationStatus }
> = {
  submit_review: { from: ['draft'], to: 'in_review' },
  approve: { from: ['in_review'], to: 'approved' },
  publish: { from: ['approved'], to: 'published' },
  suspend: { from: ['published'], to: 'suspended' },
  archive: { from: ['draft', 'in_review', 'approved', 'suspended'], to: 'archived' },
}

export class AutomationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AutomationServiceError'
  }
}

export async function listAutomations(
  principal: RequestPrincipal,
  filters: {
    status?: AutomationStatus
    eventType?: string
    search?: string
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: AutomationListItem[]; total: number }> {
  authorizeAutomation(principal, 'list', 'executar_automacoes')
  const visible = visibleScope(principal, 'executar_automacoes')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [
      principal.tenantId,
      visible.companyIds,
      visible.groupIds,
      visible.tenantWide,
    ]
    const clauses = [
      'definition.tenant_id = $1',
      visibleAutomationSql('version', values, '$2', '$3', '$4'),
    ]
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`definition.status = $${values.length}`)
    }
    if (filters.eventType) {
      values.push(filters.eventType)
      clauses.push(`version.event_type = $${values.length}`)
    }
    if (filters.search) {
      values.push(`%${filters.search.trim()}%`)
      clauses.push(`(definition.name ilike $${values.length} or definition.automation_code ilike $${values.length})`)
    }
    const count = await client.query<{ total: string }>(
      `${definitionFromSql()}
       where ${clauses.join(' and ')}
       )
       select count(*)::text as total from visible_definitions`,
      values,
    )
    values.push(
      Math.min(200, Math.max(1, filters.limit || 50)),
      Math.max(0, filters.offset || 0),
    )
    const rows = await client.query<DefinitionRow>(
      `${definitionFromSql()}
       where ${clauses.join(' and ')}
       )
       select * from visible_definitions
       order by updated_at desc, id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: rows.rows.map(mapDefinition),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function getAutomation(
  principal: RequestPrincipal,
  rawId: string,
): Promise<AutomationDetail> {
  authorizeAutomation(principal, 'read', 'executar_automacoes')
  const id = assertUuid(rawId, 'AUTOMATION_ID_INVALID')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const summary = await loadDefinitionSummary(client, principal, id)
    const versions = await loadVersions(client, principal.tenantId, id)
    const current = versions.find((version) => version.version === summary.currentVersion)
    if (!current) throw new AutomationServiceError('AUTOMATION_VERSION_NOT_FOUND', 'Versao atual nao encontrada.', 409)
    return { ...summary, current, versions }
  })
}

export async function createAutomationDraft(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<AutomationDetail> {
  authorizeAutomation(principal, 'create', 'gerenciar_automacoes')
  const input = automationDraftInputSchema.parse(rawInput)
  await assertManageScopes(principal, input.scopes)

  const definitionId = randomUUID()
  const versionId = randomUUID()
  await withTenantTransaction(principal.tenantId, async (client) => {
    await assertWorkflowExists(client, principal.tenantId, input.workflowId, false)
    const hash = automationHash(input, 1)
    await client.query(
      `insert into automation_definitions (
         id, tenant_id, automation_code, name, description, status,
         current_version, created_by
       ) values ($1, $2, $3, $4, $5, 'draft', 1, $6)`,
      [
        definitionId,
        principal.tenantId,
        input.automationCode,
        input.name,
        input.description,
        principal.user.id,
      ],
    )
    await insertVersion(client, principal, definitionId, versionId, 1, input)
    await insertScopes(client, principal.tenantId, versionId, input.scopes)
    await insertAutomationEvent(client, principal, {
      definitionId,
      versionId,
      type: 'automation.created',
      fromStatus: null,
      toStatus: 'draft',
      reason: input.changeSummary,
      payload: { contentHash: hash },
    })
  }).catch(handleUniqueAutomationError)

  await writeAutomationAudit(principal, 'automation.create', definitionId, {
    code: input.automationCode,
    eventType: input.eventType,
    workflowId: input.workflowId,
  })
  return getAutomation(principal, definitionId)
}

export async function updateAutomationDraft(
  principal: RequestPrincipal,
  rawId: string,
  rawInput: unknown,
): Promise<AutomationDetail> {
  authorizeAutomation(principal, 'update', 'gerenciar_automacoes')
  const id = assertUuid(rawId, 'AUTOMATION_ID_INVALID')
  const input = automationVersionInputSchema.parse(rawInput)
  await assertManageScopes(principal, input.scopes)

  await withTenantTransaction(principal.tenantId, async (client) => {
    const current = await loadDefinitionForUpdate(client, principal.tenantId, id)
    if (current.currentVersion !== input.expectedCurrentVersion) {
      throw new AutomationServiceError('AUTOMATION_VERSION_CONFLICT', 'A automacao foi alterada por outro usuario.', 409)
    }
    if (current.status !== 'draft') {
      throw new AutomationServiceError('AUTOMATION_DRAFT_REQUIRED', 'Somente rascunhos podem ser editados.', 409)
    }
    await assertWorkflowExists(client, principal.tenantId, input.workflowId, false)
    const version = await loadVersionForUpdate(client, principal.tenantId, id, current.currentVersion)
    const hash = automationHash(input, current.currentVersion)
    await client.query(
      `update automation_definitions
       set name = $3, description = $4, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, id, input.name, input.description],
    )
    await client.query(
      `update automation_versions set
         event_type = $3,
         workflow_definition_id = $4,
         subject_type = $5,
         company_id_path = $6,
         subject_id_path = $7,
         condition_ast = $8::jsonb,
         content_hash = $9,
         change_summary = $10,
         valid_from = $11,
         valid_until = $12,
         updated_at = now()
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        version.id,
        input.eventType,
        input.workflowId,
        input.subjectType,
        input.companyIdPath,
        input.subjectIdPath,
        JSON.stringify(input.condition),
        hash,
        input.changeSummary,
        input.validFrom || null,
        input.validUntil || null,
      ],
    )
    await client.query(
      `delete from automation_version_scopes
       where tenant_id = $1 and automation_version_id = $2`,
      [principal.tenantId, version.id],
    )
    await insertScopes(client, principal.tenantId, version.id, input.scopes)
    await insertAutomationEvent(client, principal, {
      definitionId: id,
      versionId: version.id,
      type: 'automation.draft_updated',
      fromStatus: 'draft',
      toStatus: 'draft',
      reason: input.changeSummary,
      payload: { contentHash: hash },
    })
  })
  await writeAutomationAudit(principal, 'automation.update', id, { version: input.expectedCurrentVersion })
  return getAutomation(principal, id)
}

export async function createAutomationVersion(
  principal: RequestPrincipal,
  rawId: string,
  rawInput: unknown,
): Promise<AutomationDetail> {
  authorizeAutomation(principal, 'update', 'gerenciar_automacoes')
  const id = assertUuid(rawId, 'AUTOMATION_ID_INVALID')
  const input = automationVersionInputSchema.parse(rawInput)
  await assertManageScopes(principal, input.scopes)

  await withTenantTransaction(principal.tenantId, async (client) => {
    const current = await loadDefinitionForUpdate(client, principal.tenantId, id)
    if (current.currentVersion !== input.expectedCurrentVersion) {
      throw new AutomationServiceError('AUTOMATION_VERSION_CONFLICT', 'A automacao foi alterada por outro usuario.', 409)
    }
    if (current.status === 'draft') {
      throw new AutomationServiceError(
        'AUTOMATION_DRAFT_EXISTS',
        'Edite o rascunho atual antes de criar outra versao.',
        409,
      )
    }
    if (current.status === 'archived') {
      throw new AutomationServiceError('AUTOMATION_ARCHIVED', 'Automacao arquivada nao recebe novas versoes.', 409)
    }
    await assertWorkflowExists(client, principal.tenantId, input.workflowId, false)
    const nextVersion = current.currentVersion + 1
    const versionId = randomUUID()
    await client.query(
      `update automation_definitions
       set name = $3, description = $4, status = 'draft',
           current_version = $5, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, id, input.name, input.description, nextVersion],
    )
    await insertVersion(client, principal, id, versionId, nextVersion, input)
    await insertScopes(client, principal.tenantId, versionId, input.scopes)
    await insertAutomationEvent(client, principal, {
      definitionId: id,
      versionId,
      type: 'automation.version_created',
      fromStatus: current.status,
      toStatus: 'draft',
      reason: input.changeSummary,
      payload: { version: nextVersion },
    })
  })
  await writeAutomationAudit(principal, 'automation.version.create', id, {
    previousVersion: input.expectedCurrentVersion,
  })
  return getAutomation(principal, id)
}

export async function transitionAutomation(
  principal: RequestPrincipal,
  rawId: string,
  rawInput: unknown,
): Promise<AutomationDetail> {
  authorizeAutomation(
    principal,
    rawTransitionAction(rawInput) === 'publish' ? 'publish' : 'update',
    'gerenciar_automacoes',
  )
  const id = assertUuid(rawId, 'AUTOMATION_ID_INVALID')
  const input = automationTransitionSchema.parse(rawInput)
  const transition = TRANSITIONS[input.action]

  await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadDefinitionForUpdate(client, principal.tenantId, id)
    const version = await loadVersionByIdForUpdate(client, principal.tenantId, id, input.versionId)
    if (version.version !== definition.currentVersion) {
      throw new AutomationServiceError('AUTOMATION_VERSION_NOT_CURRENT', 'A transicao exige a versao atual.', 409)
    }
    if (!transition.from.includes(version.status) || definition.status !== version.status) {
      throw new AutomationServiceError(
        'AUTOMATION_TRANSITION_INVALID',
        `Transicao ${input.action} nao permitida para ${version.status}.`,
        409,
      )
    }
    if (input.action === 'publish') {
      await assertWorkflowExists(client, principal.tenantId, version.workflowId, true)
      const scopes = await loadScopes(client, principal.tenantId, version.id)
      if (!scopes.length) {
        throw new AutomationServiceError('AUTOMATION_SCOPE_REQUIRED', 'Automacao sem escopo nao pode ser publicada.', 409)
      }
      await client.query(
        `update automation_versions
         set status = 'suspended', updated_at = now()
         where tenant_id = $1
           and automation_definition_id = $2
           and status = 'published'
           and id <> $3`,
        [principal.tenantId, id, version.id],
      )
    }

    const statusFields = transitionStatusFields(input.action, principal.user.id)
    await client.query(
      `update automation_versions
       set status = $3,
           reviewed_by = coalesce($4, reviewed_by),
           reviewed_at = coalesce($5, reviewed_at),
           approved_by = coalesce($6, approved_by),
           approved_at = coalesce($7, approved_at),
           published_by = coalesce($8, published_by),
           published_at = coalesce($9, published_at),
           valid_from = case
             when $3 = 'published' then coalesce($10::timestamptz, valid_from)
             else valid_from
           end,
           valid_until = case
             when $3 = 'published' and $11::boolean then $12::timestamptz
             else valid_until
           end,
           updated_at = now()
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        version.id,
        transition.to,
        statusFields.reviewedBy,
        statusFields.reviewedAt,
        statusFields.approvedBy,
        statusFields.approvedAt,
        statusFields.publishedBy,
        statusFields.publishedAt,
        input.effectiveFrom || null,
        input.effectiveUntil !== undefined,
        input.effectiveUntil || null,
      ],
    )
    await client.query(
      `update automation_definitions
       set status = $3,
           published_version = case when $3 = 'published' then $4 else published_version end,
           archived_at = case when $3 = 'archived' then now() else archived_at end,
           updated_at = now()
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, id, transition.to, version.version],
    )
    await insertAutomationEvent(client, principal, {
      definitionId: id,
      versionId: version.id,
      type: `automation.${input.action}`,
      fromStatus: version.status,
      toStatus: transition.to,
      reason: input.reason,
      payload: { version: version.version },
    })
  })
  await writeAutomationAudit(principal, `automation.${input.action}`, id, {
    versionId: input.versionId,
    reason: input.reason,
  })
  return getAutomation(principal, id)
}

export async function simulateAutomation(
  principal: RequestPrincipal,
  rawId: string,
  rawInput: unknown,
): Promise<AutomationSimulationResult> {
  authorizeAutomation(principal, 'execute', 'executar_automacoes')
  const id = assertUuid(rawId, 'AUTOMATION_ID_INVALID')
  const input = automationSimulationSchema.parse(rawInput)
  const detail = await getAutomation(principal, id)
  const envelope = eventEnvelope(input)
  const companyId = textAtPath(envelope, detail.current.companyIdPath)
  const subjectId = textAtPath(envelope, detail.current.subjectIdPath) || input.aggregateId
  const groupId = companyId ? await companyGroupId(principal.tenantId, companyId) : null
  if (companyId) await requireCompanyAccess(principal, companyId, 'executar_automacoes')
  const scopeMatched = automationScopeMatches(detail.current.scopes, companyId, groupId)
  const trace = evaluateExpression(detail.current.condition, envelope)
  const eventMatches = detail.current.eventType === input.eventType
  const matched = eventMatches && scopeMatched && trace.matched && !trace.error
  return {
    matched,
    scopeMatched,
    trace,
    companyId,
    subjectId,
    workflowId: detail.current.workflowId,
    wouldExecute: matched && Boolean(companyId),
    explanation: !eventMatches
      ? 'O tipo do evento nao corresponde ao gatilho.'
      : !scopeMatched
        ? 'O evento esta fora do escopo da automacao.'
        : trace.error
          ? `A condicao falhou: ${trace.error}`
          : !trace.matched
            ? 'A condicao foi avaliada como falsa.'
            : !companyId
              ? 'A condicao correspondeu, mas o evento nao informa uma empresa.'
              : 'A automacao iniciaria o workflow publicado.',
  }
}

export async function listAutomationRuns(
  principal: RequestPrincipal,
  filters: {
    automationId?: string
    status?: AutomationRunStatus
    companyId?: string
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: AutomationRun[]; total: number }> {
  authorizeAutomation(principal, 'list', 'executar_automacoes')
  const visible = visibleScope(principal, 'executar_automacoes')
  if (filters.companyId) await requireCompanyAccess(principal, filters.companyId, 'executar_automacoes')
  return withTenantTransaction(principal.tenantId, async (client) => {
    await reconcileAutomationRuns(client, principal.tenantId)
    const values: unknown[] = [principal.tenantId]
    const clauses = ['run.tenant_id = $1']
    if (!visible.tenantWide) {
      values.push(visible.companyIds)
      clauses.push(`run.company_id = any($${values.length}::text[])`)
    }
    if (filters.automationId) {
      values.push(assertUuid(filters.automationId, 'AUTOMATION_ID_INVALID'))
      clauses.push(`run.automation_definition_id = $${values.length}`)
    }
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`run.status = $${values.length}`)
    }
    if (filters.companyId) {
      values.push(filters.companyId)
      clauses.push(`run.company_id = $${values.length}`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total
       from automation_runs run
       where ${clauses.join(' and ')}`,
      values,
    )
    values.push(
      Math.min(200, Math.max(1, filters.limit || 50)),
      Math.max(0, filters.offset || 0),
    )
    const rows = await client.query<RunRow>(
      `${runSelect()}
       where ${clauses.join(' and ')}
       order by run.updated_at desc, run.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return { items: rows.rows.map(mapRun), total: Number(count.rows[0]?.total || 0) }
  })
}

export async function processAutomationEvents(
  principal: RequestPrincipal,
  limit = 25,
  options: { definitionId?: string } = {},
): Promise<{ claimed: number; completed: number; skipped: number; failed: number; runIds: string[] }> {
  authorizeAutomation(principal, 'execute', 'executar_automacoes')
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
  const visible = visibleScope(principal, 'executar_automacoes')
  const candidates = await withTenantTransaction(principal.tenantId, async (client) => {
    await reconcileAutomationRuns(client, principal.tenantId)
    return (await client.query<CandidateRow>(
      `select
         definition.id as automation_id,
         definition.name as automation_name,
         version.id as automation_version_id,
         version.version_number,
         version.workflow_definition_id,
         version.subject_type,
         version.company_id_path,
         version.subject_id_path,
         version.condition_ast,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'type', scope.scope_type,
             'id', scope.scope_id,
             'mode', scope.mode,
             'specificity', scope.specificity
           ) order by scope.specificity, scope.id)
           from automation_version_scopes scope
           where scope.tenant_id = version.tenant_id
             and scope.automation_version_id = version.id
         ), '[]'::jsonb) as scopes,
         source.id as source_event_id,
         source.aggregate_type,
         source.aggregate_id,
         source.event_type,
         source.payload,
         source.created_by,
         source.created_at as event_created_at
       from automation_definitions definition
       join automation_versions version
         on version.tenant_id = definition.tenant_id
        and version.automation_definition_id = definition.id
        and version.version_number = definition.published_version
       join domain_outbox source
         on source.tenant_id = definition.tenant_id
        and source.event_type = version.event_type
        and source.created_at >= coalesce(version.valid_from, version.published_at, version.created_at)
        and (version.valid_until is null or source.created_at < version.valid_until)
       where definition.tenant_id = $1
         and definition.status = 'published'
         and version.status = 'published'
         and ${visibleAutomationSql('version', [], '$2', '$3', '$4')}
         and not exists (
           select 1
           from automation_runs run
           where run.tenant_id = definition.tenant_id
             and run.automation_definition_id = definition.id
             and run.source_outbox_event_id = source.id
         )
         and ($6::uuid is null or definition.id = $6)
       order by source.created_at, definition.id
       limit $5`,
      [
        principal.tenantId,
        visible.companyIds,
        visible.groupIds,
        visible.tenantWide,
        boundedLimit,
        options.definitionId || null,
      ],
    )).rows
  })

  const runIds: string[] = []
  let completed = 0
  let skipped = 0
  let failed = 0
  const accessibleCompanies = new Set(visible.companyIds)
  for (const candidate of candidates) {
    const candidateEnvelope = eventEnvelope({
      eventType: candidate.event_type,
      aggregateType: candidate.aggregate_type,
      aggregateId: candidate.aggregate_id,
      payload: recordValue(candidate.payload),
    })
    const candidateCompanyId = textAtPath(candidateEnvelope, candidate.company_id_path)
    if (
      !visible.tenantWide
      && (!candidateCompanyId || !accessibleCompanies.has(candidateCompanyId))
    ) {
      continue
    }
    const runId = await claimAutomationRun(principal, candidate)
    if (!runId) continue
    runIds.push(runId)
    const result = await executeAutomationCandidate(principal, candidate, runId)
    if (result === 'skipped') skipped += 1
    else if (result === 'failed') failed += 1
    else completed += 1
  }
  return { claimed: runIds.length, completed, skipped, failed, runIds }
}

async function claimAutomationRun(
  principal: RequestPrincipal,
  candidate: CandidateRow,
): Promise<string | null> {
  const payload = recordValue(candidate.payload)
  const envelope = eventEnvelope({
    eventType: candidate.event_type,
    aggregateType: candidate.aggregate_type,
    aggregateId: candidate.aggregate_id,
    payload,
  })
  const companyId = textAtPath(envelope, candidate.company_id_path)
  const subjectId = textAtPath(envelope, candidate.subject_id_path) || candidate.aggregate_id
  const inputHash = sha256({
    automationId: candidate.automation_id,
    versionId: candidate.automation_version_id,
    sourceEventId: candidate.source_event_id,
    envelope,
  })
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into automation_runs (
         tenant_id, automation_definition_id, automation_version_id,
         source_outbox_event_id, company_id, subject_type, subject_id,
         status, input_hash, input_snapshot, started_by, started_at, attempts
       ) values (
         $1, $2, $3, $4, $5, $6, $7,
         'evaluating', $8, $9::jsonb, $10, now(), 1
       )
       on conflict (tenant_id, automation_definition_id, source_outbox_event_id)
       do nothing
       returning id`,
      [
        principal.tenantId,
        candidate.automation_id,
        candidate.automation_version_id,
        candidate.source_event_id,
        companyId || null,
        candidate.subject_type,
        subjectId,
        inputHash,
        JSON.stringify(envelope),
        principal.user.id,
      ],
    )
    return result.rows[0]?.id || null
  })
}

async function executeAutomationCandidate(
  principal: RequestPrincipal,
  candidate: CandidateRow,
  runId: string,
): Promise<'completed' | 'skipped' | 'failed'> {
  const envelope = eventEnvelope({
    eventType: candidate.event_type,
    aggregateType: candidate.aggregate_type,
    aggregateId: candidate.aggregate_id,
    payload: recordValue(candidate.payload),
  })
  const companyId = textAtPath(envelope, candidate.company_id_path)
  const subjectId = textAtPath(envelope, candidate.subject_id_path) || candidate.aggregate_id
  const condition = policyExpression(candidate.condition_ast)
  const trace = evaluateExpression(condition, envelope)

  try {
    const groupId = companyId ? await companyGroupId(principal.tenantId, companyId) : null
    const scopes = automationScopes(candidate.scopes)
    if (!automationScopeMatches(scopes, companyId, groupId)) {
      await finishRun(principal.tenantId, runId, 'skipped', {
        trace,
        errorCode: null,
        errorMessage: null,
      })
      return 'skipped'
    }
    if (trace.error) {
      throw new AutomationServiceError('AUTOMATION_CONDITION_ERROR', trace.error, 409)
    }
    if (!trace.matched) {
      await finishRun(principal.tenantId, runId, 'skipped', {
        trace,
        errorCode: null,
        errorMessage: null,
      })
      return 'skipped'
    }
    if (!companyId) {
      throw new AutomationServiceError(
        'AUTOMATION_COMPANY_REQUIRED',
        `O caminho ${candidate.company_id_path} nao resolveu uma empresa.`,
        409,
      )
    }
    await requireCompanyAccess(principal, companyId, 'executar_automacoes')
    const execution = await startEnterpriseWorkflowExecution(
      principal,
      candidate.workflow_definition_id,
      {
        companyId,
        subjectType: candidate.subject_type,
        subjectId,
        facts: envelope,
        idempotencyKey: `automation:${candidate.automation_id}:${candidate.source_event_id}`,
      },
    )
    const status = workflowToAutomationStatus(execution.status)
    await finishRun(principal.tenantId, runId, status, {
      trace,
      workflowExecutionId: execution.id,
    })
    await writeAutomationAudit(principal, 'automation.run', candidate.automation_id, {
      runId,
      sourceEventId: candidate.source_event_id,
      workflowExecutionId: execution.id,
      replayed: execution.replayed,
      status,
    })
    return 'completed'
  } catch (error) {
    const code = error instanceof AutomationServiceError ? error.code : 'AUTOMATION_EXECUTION_FAILED'
    const message = error instanceof Error ? error.message : 'Falha ao executar automacao.'
    await finishRun(principal.tenantId, runId, 'failed', {
      trace,
      errorCode: code,
      errorMessage: message,
    })
    return 'failed'
  }
}

async function finishRun(
  tenantId: string,
  runId: string,
  status: AutomationRunStatus,
  input: {
    trace: unknown
    workflowExecutionId?: string
    errorCode?: string | null
    errorMessage?: string | null
  },
): Promise<void> {
  await withTenantTransaction(tenantId, (client) => client.query(
    `update automation_runs
     set status = $3,
         condition_trace = $4::jsonb,
         workflow_execution_id = coalesce($5, workflow_execution_id),
         error_code = $6,
         error_message = $7,
         completed_at = case
           when $3 in ('completed', 'failed', 'cancelled', 'skipped') then now()
           else null
         end,
         updated_at = now()
     where tenant_id = $1 and id = $2`,
    [
      tenantId,
      runId,
      status,
      JSON.stringify(input.trace),
      input.workflowExecutionId || null,
      input.errorCode || null,
      input.errorMessage?.slice(0, 2_000) || null,
    ],
  ))
}

async function reconcileAutomationRuns(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `update automation_runs run
     set status = case execution.status
           when 'queued' then 'queued'
           when 'running' then 'running'
           when 'waiting' then 'waiting'
           when 'completed' then 'completed'
           when 'failed' then 'failed'
           when 'cancelled' then 'cancelled'
           else run.status
         end,
         completed_at = case
           when execution.status in ('completed', 'failed', 'cancelled')
             then coalesce(run.completed_at, execution.completed_at, execution.failed_at, now())
           else null
         end,
         error_code = coalesce(execution.last_error_code, run.error_code),
         error_message = coalesce(execution.last_error_message, run.error_message),
         updated_at = now()
     from enterprise_workflow_executions execution
     where run.tenant_id = $1
       and execution.tenant_id = run.tenant_id
       and execution.id = run.workflow_execution_id
       and run.status is distinct from case execution.status
         when 'queued' then 'queued'
         when 'running' then 'running'
         when 'waiting' then 'waiting'
         when 'completed' then 'completed'
         when 'failed' then 'failed'
         when 'cancelled' then 'cancelled'
         else run.status
       end`,
    [tenantId],
  )
}

async function loadDefinitionSummary(
  client: PoolClient,
  principal: RequestPrincipal,
  id: string,
): Promise<AutomationListItem> {
  const visible = visibleScope(principal, 'executar_automacoes')
  const result = await client.query<DefinitionRow>(
    `${definitionFromSql()}
     where definition.tenant_id = $1
       and definition.id = $2
       and ${visibleAutomationSql('version', [], '$3', '$4', '$5')}
     )
     select * from visible_definitions`,
    [principal.tenantId, id, visible.companyIds, visible.groupIds, visible.tenantWide],
  )
  if (!result.rows[0]) {
    throw new AutomationServiceError('AUTOMATION_NOT_FOUND', 'Automacao nao encontrada no escopo autorizado.', 404)
  }
  return mapDefinition(result.rows[0])
}

async function loadVersions(
  client: PoolClient,
  tenantId: string,
  definitionId: string,
): Promise<AutomationVersion[]> {
  const result = await client.query<VersionRow>(
    `${versionSelect()}
     where version.tenant_id = $1
       and version.automation_definition_id = $2
     order by version.version_number desc`,
    [tenantId, definitionId],
  )
  return result.rows.map(mapVersion)
}

async function loadScopes(
  client: PoolClient,
  tenantId: string,
  versionId: string,
): Promise<AutomationScope[]> {
  const result = await client.query<{
    scope_type: AutomationScope['type']
    scope_id: string | null
    mode: AutomationScope['mode']
    specificity: number
  }>(
    `select scope_type, scope_id, mode, specificity
     from automation_version_scopes
     where tenant_id = $1 and automation_version_id = $2
     order by specificity, id`,
    [tenantId, versionId],
  )
  return result.rows.map((scope) => ({
    type: scope.scope_type,
    id: scope.scope_id,
    mode: scope.mode,
    specificity: Number(scope.specificity),
  }))
}

async function insertVersion(
  client: PoolClient,
  principal: RequestPrincipal,
  definitionId: string,
  versionId: string,
  version: number,
  input: AutomationDraftInput | AutomationVersionInput,
): Promise<void> {
  await client.query(
    `insert into automation_versions (
       id, tenant_id, automation_definition_id, version_number, status,
       event_type, workflow_definition_id, subject_type, company_id_path,
       subject_id_path, condition_ast, content_hash, change_summary,
       valid_from, valid_until, created_by
     ) values (
       $1, $2, $3, $4, 'draft',
       $5, $6, $7, $8,
       $9, $10::jsonb, $11, $12,
       $13, $14, $15
     )`,
    [
      versionId,
      principal.tenantId,
      definitionId,
      version,
      input.eventType,
      input.workflowId,
      input.subjectType,
      input.companyIdPath,
      input.subjectIdPath,
      JSON.stringify(input.condition),
      automationHash(input, version),
      input.changeSummary,
      input.validFrom || null,
      input.validUntil || null,
      principal.user.id,
    ],
  )
}

async function insertScopes(
  client: PoolClient,
  tenantId: string,
  versionId: string,
  scopes: AutomationScope[],
): Promise<void> {
  for (const scope of scopes) {
    await client.query(
      `insert into automation_version_scopes (
         tenant_id, automation_version_id, scope_type, scope_id, mode, specificity
       ) values ($1, $2, $3, $4, $5, $6)`,
      [tenantId, versionId, scope.type, scope.id || null, scope.mode, scope.specificity],
    )
  }
}

async function assertManageScopes(
  principal: RequestPrincipal,
  scopes: AutomationScope[],
): Promise<void> {
  for (const scope of scopes) {
    if (scope.type === 'tenant') {
      if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
        throw new AutomationServiceError(
          'AUTOMATION_TENANT_SCOPE_DENIED',
          'Somente administrador do tenant pode publicar automacao de escopo global.',
          403,
        )
      }
    } else if (scope.type === 'group') {
      await requireGroupAccess(principal, scope.id!, 'gerenciar_automacoes')
    } else {
      await requireCompanyAccess(principal, scope.id!, 'gerenciar_automacoes')
    }
  }
}

async function assertWorkflowExists(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  published: boolean,
): Promise<WorkflowRow> {
  const result = await client.query<WorkflowRow>(
    `select id, name, status, published_version
     from enterprise_workflow_definitions
     where tenant_id = $1 and id = $2 and archived_at is null`,
    [tenantId, workflowId],
  )
  const row = result.rows[0]
  if (!row) throw new AutomationServiceError('AUTOMATION_WORKFLOW_NOT_FOUND', 'Workflow de destino nao encontrado.', 404)
  if (published && (row.status !== 'published' || !row.published_version)) {
    throw new AutomationServiceError(
      'AUTOMATION_WORKFLOW_NOT_PUBLISHED',
      'Publique o workflow de destino antes de ativar a automacao.',
      409,
    )
  }
  return row
}

async function companyGroupId(tenantId: string, companyId: string): Promise<string | null> {
  return withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<{ group_id: string | null }>(
      `select group_id
       from companies
       where tenant_id = $1 and id = $2 and deleted_at is null`,
      [tenantId, companyId],
    )
    return result.rows[0]?.group_id || null
  })
}

function automationScopeMatches(
  scopes: AutomationScope[],
  companyId: string | null,
  groupId: string | null,
): boolean {
  const matches = (scope: AutomationScope) => (
    scope.type === 'tenant'
    || (scope.type === 'company' && Boolean(companyId) && scope.id === companyId)
    || (scope.type === 'group' && Boolean(groupId) && scope.id === groupId)
  )
  if (scopes.some((scope) => scope.mode === 'exclude' && matches(scope))) return false
  return scopes.some((scope) => scope.mode === 'include' && matches(scope))
}

function visibleScope(
  principal: RequestPrincipal,
  permission: 'executar_automacoes' | 'gerenciar_automacoes',
): { companyIds: string[]; groupIds: string[]; tenantWide: boolean } {
  const companies = (principal.corporateAccess?.companies || [])
    .filter((company) => company.permissions[permission])
  return {
    companyIds: Array.from(new Set(companies.map((company) => company.companyId))),
    groupIds: Array.from(new Set(companies.map((company) => company.groupId).filter(Boolean) as string[])),
    tenantWide: principal.platformAdmin || principal.roleKey === 'tenant_admin',
  }
}

function authorizeAutomation(
  principal: RequestPrincipal,
  action: 'read' | 'list' | 'create' | 'update' | 'execute' | 'publish',
  permission: 'executar_automacoes' | 'gerenciar_automacoes',
): void {
  authorizeOrThrow(principal, {
    resource: 'automations',
    action,
    requiredPermission: permission,
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  })
}

function definitionFromSql(): string {
  return `with visible_definitions as (
    select
      definition.id,
      definition.automation_code,
      definition.name,
      definition.description,
      definition.status,
      definition.current_version,
      definition.published_version,
      version.event_type,
      version.workflow_definition_id,
      workflow.name as workflow_name,
      workflow.status as workflow_status,
      version.subject_type,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', scope.scope_type,
          'id', scope.scope_id,
          'mode', scope.mode,
          'specificity', scope.specificity
        ) order by scope.specificity, scope.id)
        from automation_version_scopes scope
        where scope.tenant_id = version.tenant_id
          and scope.automation_version_id = version.id
      ), '[]'::jsonb) as scopes,
      (select count(*) from automation_runs run
       where run.tenant_id = definition.tenant_id
         and run.automation_definition_id = definition.id)::text as run_count,
      (select count(*) from automation_runs run
       where run.tenant_id = definition.tenant_id
         and run.automation_definition_id = definition.id
         and run.status = 'completed')::text as successful_runs,
      (select count(*) from automation_runs run
       where run.tenant_id = definition.tenant_id
         and run.automation_definition_id = definition.id
         and run.status = 'failed')::text as failed_runs,
      (select max(run.created_at) from automation_runs run
       where run.tenant_id = definition.tenant_id
         and run.automation_definition_id = definition.id) as last_run_at,
      definition.updated_at
    from automation_definitions definition
    join automation_versions version
      on version.tenant_id = definition.tenant_id
     and version.automation_definition_id = definition.id
     and version.version_number = definition.current_version
    join enterprise_workflow_definitions workflow
      on workflow.tenant_id = version.tenant_id
     and workflow.id = version.workflow_definition_id`
}

function visibleAutomationSql(
  versionAlias: string,
  _values: unknown[],
  companyParam: string,
  groupParam: string,
  tenantWideParam: string,
): string {
  return `exists (
    select 1
    from automation_version_scopes visible_scope
    where visible_scope.tenant_id = ${versionAlias}.tenant_id
      and visible_scope.automation_version_id = ${versionAlias}.id
      and visible_scope.mode = 'include'
      and (
        (visible_scope.scope_type = 'tenant' and (
          ${tenantWideParam}::boolean or cardinality(${companyParam}::text[]) > 0
        ))
        or (visible_scope.scope_type = 'group' and visible_scope.scope_id = any(${groupParam}::text[]))
        or (visible_scope.scope_type = 'company' and visible_scope.scope_id = any(${companyParam}::text[]))
      )
  )`
}

function versionSelect(): string {
  return `select
    version.id,
    version.version_number,
    version.status,
    version.event_type,
    version.workflow_definition_id,
    workflow.name as workflow_name,
    version.subject_type,
    version.company_id_path,
    version.subject_id_path,
    version.condition_ast,
    version.content_hash,
    version.change_summary,
    version.valid_from,
    version.valid_until,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', scope.scope_type,
        'id', scope.scope_id,
        'mode', scope.mode,
        'specificity', scope.specificity
      ) order by scope.specificity, scope.id)
      from automation_version_scopes scope
      where scope.tenant_id = version.tenant_id
        and scope.automation_version_id = version.id
    ), '[]'::jsonb) as scopes,
    version.created_by,
    version.created_at,
    version.reviewed_by,
    version.reviewed_at,
    version.approved_by,
    version.approved_at,
    version.published_by,
    version.published_at
  from automation_versions version
  join enterprise_workflow_definitions workflow
    on workflow.tenant_id = version.tenant_id
   and workflow.id = version.workflow_definition_id`
}

function runSelect(): string {
  return `select
    run.id,
    run.automation_definition_id,
    definition.name as automation_name,
    version.version_number as automation_version,
    run.source_outbox_event_id,
    source.event_type,
    run.company_id,
    coalesce(nullif(company.trade_name, ''), company.legal_name) as company_name,
    run.subject_type,
    run.subject_id,
    run.status,
    run.condition_trace,
    run.workflow_execution_id,
    run.attempts,
    run.error_code,
    run.error_message,
    run.started_at,
    run.completed_at,
    run.created_at,
    run.updated_at
  from automation_runs run
  join automation_definitions definition
    on definition.tenant_id = run.tenant_id
   and definition.id = run.automation_definition_id
  join automation_versions version
    on version.tenant_id = run.tenant_id
   and version.id = run.automation_version_id
  join domain_outbox source
    on source.tenant_id = run.tenant_id
   and source.id = run.source_outbox_event_id
  left join companies company
    on company.tenant_id = run.tenant_id
   and company.id = run.company_id`
}

async function loadDefinitionForUpdate(
  client: PoolClient,
  tenantId: string,
  id: string,
): Promise<{ status: AutomationStatus; currentVersion: number }> {
  const result = await client.query<{ status: AutomationStatus; current_version: number }>(
    `select status, current_version
     from automation_definitions
     where tenant_id = $1 and id = $2
     for update`,
    [tenantId, id],
  )
  if (!result.rows[0]) throw new AutomationServiceError('AUTOMATION_NOT_FOUND', 'Automacao nao encontrada.', 404)
  return {
    status: result.rows[0].status,
    currentVersion: Number(result.rows[0].current_version),
  }
}

async function loadVersionForUpdate(
  client: PoolClient,
  tenantId: string,
  definitionId: string,
  version: number,
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `select id
     from automation_versions
     where tenant_id = $1 and automation_definition_id = $2 and version_number = $3
     for update`,
    [tenantId, definitionId, version],
  )
  if (!result.rows[0]) throw new AutomationServiceError('AUTOMATION_VERSION_NOT_FOUND', 'Versao nao encontrada.', 404)
  return result.rows[0]
}

async function loadVersionByIdForUpdate(
  client: PoolClient,
  tenantId: string,
  definitionId: string,
  versionId: string,
): Promise<{
  id: string
  version: number
  status: AutomationStatus
  workflowId: string
  validUntil: string | Date | null
}> {
  const result = await client.query<{
    id: string
    version_number: number
    status: AutomationStatus
    workflow_definition_id: string
    valid_until: string | Date | null
  }>(
    `select id, version_number, status, workflow_definition_id, valid_until
     from automation_versions
     where tenant_id = $1 and automation_definition_id = $2 and id = $3
     for update`,
    [tenantId, definitionId, versionId],
  )
  const row = result.rows[0]
  if (!row) throw new AutomationServiceError('AUTOMATION_VERSION_NOT_FOUND', 'Versao nao encontrada.', 404)
  return {
    id: row.id,
    version: Number(row.version_number),
    status: row.status,
    workflowId: row.workflow_definition_id,
    validUntil: row.valid_until,
  }
}

async function insertAutomationEvent(
  client: PoolClient,
  principal: RequestPrincipal,
  event: {
    definitionId: string
    versionId: string | null
    type: string
    fromStatus: string | null
    toStatus: string | null
    reason: string
    payload: Record<string, unknown>
  },
): Promise<void> {
  await client.query(
    `insert into automation_events (
       tenant_id, automation_definition_id, automation_version_id,
       event_type, from_status, to_status, reason, actor_user_id, payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      principal.tenantId,
      event.definitionId,
      event.versionId,
      event.type,
      event.fromStatus,
      event.toStatus,
      event.reason,
      principal.user.id,
      JSON.stringify(event.payload),
    ],
  )
}

function mapDefinition(row: DefinitionRow): AutomationListItem {
  return {
    id: row.id,
    code: row.automation_code,
    name: row.name,
    description: row.description,
    status: row.status,
    currentVersion: Number(row.current_version),
    publishedVersion: row.published_version === null ? null : Number(row.published_version),
    eventType: row.event_type,
    workflowId: row.workflow_definition_id,
    workflowName: row.workflow_name,
    workflowStatus: row.workflow_status,
    subjectType: row.subject_type,
    scopes: automationScopes(row.scopes),
    runCount: Number(row.run_count || 0),
    successfulRuns: Number(row.successful_runs || 0),
    failedRuns: Number(row.failed_runs || 0),
    lastRunAt: isoOrNull(row.last_run_at),
    updatedAt: iso(row.updated_at),
  }
}

function mapVersion(row: VersionRow): AutomationVersion {
  return {
    id: row.id,
    version: Number(row.version_number),
    status: row.status,
    eventType: row.event_type,
    workflowId: row.workflow_definition_id,
    workflowName: row.workflow_name,
    subjectType: row.subject_type,
    companyIdPath: row.company_id_path,
    subjectIdPath: row.subject_id_path,
    condition: policyExpression(row.condition_ast),
    contentHash: row.content_hash,
    changeSummary: row.change_summary,
    validFrom: isoOrNull(row.valid_from),
    validUntil: isoOrNull(row.valid_until),
    scopes: automationScopes(row.scopes),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    reviewedBy: row.reviewed_by,
    reviewedAt: isoOrNull(row.reviewed_at),
    approvedBy: row.approved_by,
    approvedAt: isoOrNull(row.approved_at),
    publishedBy: row.published_by,
    publishedAt: isoOrNull(row.published_at),
  }
}

function mapRun(row: RunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_definition_id,
    automationName: row.automation_name,
    automationVersion: Number(row.automation_version),
    sourceEventId: row.source_outbox_event_id,
    eventType: row.event_type,
    companyId: row.company_id,
    companyName: row.company_name,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    status: row.status,
    conditionTrace: row.condition_trace
      ? recordValue(row.condition_trace) as unknown as AutomationRun['conditionTrace']
      : null,
    workflowExecutionId: row.workflow_execution_id,
    attempts: Number(row.attempts),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: isoOrNull(row.started_at),
    completedAt: isoOrNull(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function automationHash(
  input: AutomationDraftInput | AutomationVersionInput,
  version: number,
): string {
  return sha256({
    version,
    name: input.name,
    description: input.description,
    eventType: input.eventType,
    workflowId: input.workflowId,
    subjectType: input.subjectType,
    companyIdPath: input.companyIdPath,
    subjectIdPath: input.subjectIdPath,
    condition: input.condition,
    scopes: input.scopes,
    validFrom: input.validFrom || null,
    validUntil: input.validUntil || null,
  })
}

function automationScopes(value: unknown): AutomationScope[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = recordValue(item)
    const type = row.type
    const mode = row.mode
    if (
      !['tenant', 'group', 'company'].includes(String(type))
      || !['include', 'exclude'].includes(String(mode))
    ) return []
    return [{
      type: type as AutomationScope['type'],
      id: typeof row.id === 'string' ? row.id : null,
      mode: mode as AutomationScope['mode'],
      specificity: Number(row.specificity || 0),
    }]
  })
}

function eventEnvelope(input: AutomationSimulationInput): Record<string, unknown> {
  return {
    ...input.payload,
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    eventType: input.eventType,
    event: {
      type: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
    },
    payload: input.payload,
  }
}

function textAtPath(root: Record<string, unknown>, path: string): string | null {
  let current: unknown = root
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[part]
  }
  if (typeof current !== 'string' && typeof current !== 'number') return null
  const value = String(current).trim()
  return value || null
}

function policyExpression(value: unknown) {
  const record = recordValue(value)
  if (!Object.keys(record).length) {
    throw new AutomationServiceError('AUTOMATION_CONDITION_INVALID', 'Condicao da automacao invalida.', 409)
  }
  return record as AutomationVersion['condition']
}

function workflowToAutomationStatus(status: string): AutomationRunStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'waiting') return 'waiting'
  if (status === 'running') return 'running'
  if (status === 'cancelled') return 'cancelled'
  return 'queued'
}

function transitionStatusFields(
  action: AutomationTransitionInput['action'],
  userId: string,
) {
  const now = new Date().toISOString()
  return {
    reviewedBy: action === 'submit_review' ? userId : null,
    reviewedAt: action === 'submit_review' ? now : null,
    approvedBy: action === 'approve' ? userId : null,
    approvedAt: action === 'approve' ? now : null,
    publishedBy: action === 'publish' ? userId : null,
    publishedAt: action === 'publish' ? now : null,
  }
}

function rawTransitionAction(value: unknown): string {
  return typeof value === 'object' && value && !Array.isArray(value)
    ? String((value as Record<string, unknown>).action || '')
    : ''
}

async function writeAutomationAudit(
  principal: RequestPrincipal,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditEvent({
    action,
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'automation',
    entityId,
    metadata,
  })
}

function handleUniqueAutomationError(error: unknown): never {
  if (typeof error === 'object' && error && (error as { code?: string }).code === '23505') {
    throw new AutomationServiceError('AUTOMATION_CODE_CONFLICT', 'Ja existe uma automacao com este codigo.', 409)
  }
  throw error
}

function assertUuid(value: string, code: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AutomationServiceError(code, 'Identificador invalido.', 400)
  }
  return value
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function isoOrNull(value: string | Date | null): string | null {
  return value ? iso(value) : null
}

import 'server-only'

import { randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  approvalAuthorityInputSchema,
  approvalActionTokenInputSchema,
  approvalDecisionInputSchema,
  approvalDelegationInputSchema,
  approvalSlaRuntimeConfigurationSchema,
  approvalSubjectInputSchema,
  approvalWorkflowDraftInputSchema,
  approvalWorkflowSnapshotSchema,
  approvalWorkflowTransitionSchema,
  approvalWorkflowVersionInputSchema,
  calculateApprovalStepOutcome,
  createApprovalInstanceSchema,
  evaluateApprovalSla,
  resolveApprovers,
  resolveNextWorkflowNodes,
  revokeApprovalDelegationSchema,
  validateApprovalDelegation,
  validateApprovalWorkflow,
  ApprovalWorkflowError,
  type ApprovalAuthorityInput,
  type ApprovalCandidate,
  type ApprovalDecisionInput,
  type ApprovalDelegationCandidate,
  type ApprovalDelegationInput,
  type ApprovalKind,
  type ApprovalSubject,
  type ApprovalWorkflowDraftInput,
  type ApprovalWorkflowNode,
  type ApprovalWorkflowSnapshot,
  type ApprovalWorkflowTransitionInput,
  type ApprovalWorkflowVersionInput,
  type ApproverSelector,
  type BusinessCalendarDefinition,
  type CreateApprovalInstanceInput,
  type DelegationMembership,
} from '@/lib/approvals'
import { sha256 } from '@/lib/policy'
import { approvalVisibilityMode } from '@/lib/approvals/visibility'
import {
  buildApprovalSubjectPresentation,
  type ApprovalPresentationContext,
  type ApprovalSubjectPresentation,
} from '@/lib/approvals/subject-presentation'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  normalizeMembershipPermissions,
  requireCompanyAccess,
  requireGroupAccess,
  resolveEffectiveCorporateAccessInTransaction,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import type { TravelLifecycleRecord, TravelLifecycleStatus } from '@/lib/travel-lifecycle'

type GovernanceStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'suspended' | 'archived'
type WorkflowScope = { type: 'tenant' | 'group' | 'company'; id?: string | null; mode: 'include' | 'exclude'; specificity: number }

interface WorkflowDefinitionRow extends QueryResultRow {
  id: string
  workflow_code: string
  name: string
  description: string
  workflow_type: string
  status: GovernanceStatus
  current_version: number | null
  created_by: string
  created_at: string | Date
  updated_at: string | Date
}

interface WorkflowVersionRow extends QueryResultRow {
  id: string
  workflow_definition_id: string
  version_number: number
  status: GovernanceStatus
  graph_snapshot: unknown
  content_hash: string
  change_summary: string
  valid_from: string | Date | null
  valid_until: string | Date | null
  created_by: string
  approved_by: string | null
  approved_at: string | Date | null
  published_by: string | null
  published_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

interface WorkflowScopeRow extends QueryResultRow {
  workflow_version_id: string
  scope_type: WorkflowScope['type']
  scope_id: string | null
  mode: WorkflowScope['mode']
  specificity: number
}

interface ApprovalInstanceRow extends QueryResultRow {
  id: string
  workflow_definition_id: string
  workflow_version_id: string
  demand_id: string | null
  reservation_id: string | null
  company_id: string
  employee_id: string | null
  instance_type: string
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'failed' | 'superseded'
  subject_snapshot: unknown
  workflow_snapshot: unknown
  input_hash: string
  version: string | number
  started_by: string | null
  started_at: string | Date
  completed_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
  company_name?: string
  workflow_name?: string
  demand_number?: string | null
  demand_service_type?: string | null
  demand_passenger_name?: string | null
  demand_travel_start_date?: string | Date | null
  demand_travel_end_date?: string | Date | null
  demand_destination?: string | null
  requester_name?: string | null
}

interface ApprovalStepRow extends QueryResultRow {
  id: string
  approval_instance_id: string
  node_id: string
  step_number: number
  status: 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped' | 'cancelled' | 'expired' | 'failed'
  completion_mode: 'any' | 'all' | 'quorum' | 'first'
  quorum: number | null
  due_at: string | Date | null
  activated_at: string | Date | null
  completed_at: string | Date | null
  version: string | number
  node_name?: string
  approval_kind?: ApprovalKind
}

interface ApprovalAssignmentRow extends QueryResultRow {
  id: string
  approval_step_id: string
  assignee_user_id: string | null
  assignee_role_key: string | null
  resolution_source: string
  source_reference: string | null
  delegated_from_user_id: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'reassigned'
  assigned_at: string | Date
  responded_at: string | Date | null
  assignee_name?: string | null
  assignee_email?: string | null
}

interface ApprovedQuoteSelectionProjectionRow extends QueryResultRow {
  selection_id: string
  selection_status: string
  snapshot_hash: string
  quote_id: string
  option_id: string
  demand_id: string
  company_id: string
  lifecycle_status: string
  lifecycle_version: string | number
  last_policy_evaluation_id: string | null
  active_approval_instance_id: string | null
}

type ApprovalSlaExpirationAction = 'escalate' | 'reassign' | 'expire' | 'notify' | 'passive_approve'

interface ApprovalEscalationRow extends QueryResultRow {
  id: string
  approval_instance_id: string
  approval_step_id: string
  escalation_type: 'reminder' | 'reassign' | 'manager' | 'fallback' | 'incident' | 'expiration'
  target_user_id: string | null
  target_role_key: string | null
  status: 'scheduled' | 'executed' | 'cancelled' | 'failed'
  scheduled_at: string | Date
  configuration: unknown
}

interface MembershipCandidateRow extends QueryResultRow {
  membership_id: string
  user_id: string
  membership_status: string
  profile_key: string | null
  role_key: string
  platform_admin: boolean
  company_id: string | null
  allowed_company_ids: string[] | null
  allowed_group_ids: string[] | null
  permissions: Record<string, unknown> | null
  user_metadata: Record<string, unknown> | null
}

interface AuthorityRow extends QueryResultRow {
  id: string
  membership_id: string
  approval_kind: ApprovalKind
  company_id: string | null
  group_id: string | null
  cost_center_id: string | null
  project_id: string | null
  max_amount: string | number | null
  accumulated_amount_limit: string | number | null
  accumulation_period_days: number | null
  max_percentage_above_lowest: string | number | null
  max_percentage_above_average: string | number | null
  requires_budget_available: boolean
  urgent_allowed: boolean
  currency: string | null
  products: string[]
  destinations: string[]
  risk_levels: string[]
  status: string
  valid_from: string | Date
  valid_until: string | Date | null
  justification: string
  created_at: string | Date
}

export interface ApprovalWorkflowListItem {
  id: string
  code: string
  name: string
  description: string
  type: string
  status: GovernanceStatus
  currentVersion: number | null
  scopes: WorkflowScope[]
  updatedAt: string
}

export interface ApprovalWorkflowDetail extends ApprovalWorkflowListItem {
  createdBy: string
  current: ApprovalWorkflowSnapshot | null
  versions: Array<{
    id: string
    version: number
    status: GovernanceStatus
    contentHash: string
    changeSummary: string
    validFrom: string | null
    validUntil: string | null
    createdAt: string
    approvedAt: string | null
    publishedAt: string | null
  }>
}

export interface ApprovalInstanceSummary {
  id: string
  workflowId: string
  workflowVersionId: string
  workflowName: string
  demandId: string | null
  reservationId: string | null
  companyId: string
  companyName: string
  employeeId: string | null
  demandNumber: string | null
  serviceType: string | null
  travelerName: string | null
  requesterName: string | null
  travelStartDate: string | null
  travelEndDate: string | null
  destination: string | null
  type: string
  status: ApprovalInstanceRow['status']
  version: number
  startedAt: string
  completedAt: string | null
  pendingSteps: number
  overdueSteps: number
  assignedToMe: boolean
}

export interface ApprovalInstanceDetail extends Omit<
  ApprovalInstanceSummary,
  'workflowId' | 'workflowVersionId' | 'reservationId' | 'companyId' | 'employeeId' | 'version'
> {
  workflowId?: string
  workflowVersionId?: string
  reservationId?: string | null
  companyId?: string
  employeeId?: string | null
  version?: number
  subject: Record<string, unknown>
  presentation?: ApprovalSubjectPresentation
  workflow: ApprovalWorkflowSnapshot | null
  steps: Array<{
    id?: string
    nodeId?: string
    nodeName: string
    approvalKind: ApprovalKind | null
    stepNumber: number
    status: ApprovalStepRow['status']
    completionMode: ApprovalStepRow['completion_mode']
    quorum: number | null
    dueAt: string | null
    version?: number
    assignments: Array<{
      id?: string
      userId?: string | null
      userName: string | null
      userEmail?: string | null
      status: ApprovalAssignmentRow['status']
      source?: string
      delegatedFromUserId?: string | null
      assignedAt: string
      respondedAt: string | null
    }>
  }>
  decisions: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
}

export interface ApprovalMaintenanceResult {
  activatedDelegations: number
  expiredDelegations: number
  activatedAuthorities: number
  expiredAuthorities: number
  claimed: number
  executed: number
  cancelled: number
  failed: number
  items: Array<{
    escalationId: string
    instanceId: string
    stepId: string
    status: 'executed' | 'cancelled' | 'failed'
    action: string
    code?: string
  }>
}

export class ApprovalServiceError extends ApprovalWorkflowError {
  constructor(code: string, message: string, status = 400) {
    super(code, message, status)
    this.name = 'ApprovalServiceError'
  }
}

export async function listApprovalWorkflows(
  principal: RequestPrincipal,
  filters: { status?: GovernanceStatus; type?: string; search?: string; limit?: number; offset?: number } = {},
): Promise<{ items: ApprovalWorkflowListItem[]; total: number }> {
  const visible = visibleWorkflowScope(principal)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, visible.companyIds, visible.groupIds, visible.tenantWide]
    const clauses = [
      'definition.tenant_id = $1',
      `exists (
        select 1
        from approval_workflow_versions visible_version
        join approval_workflow_scopes visible_scope
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
    if (filters.type) {
      values.push(filters.type)
      clauses.push(`definition.workflow_type = $${values.length}`)
    }
    if (filters.search?.trim()) {
      values.push(`%${filters.search.trim()}%`)
      clauses.push(`(definition.name ilike $${values.length} or definition.workflow_code ilike $${values.length})`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from approval_workflow_definitions definition where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const rows = await client.query<WorkflowDefinitionRow>(
      `select definition.* from approval_workflow_definitions definition
       where ${clauses.join(' and ')}
       order by definition.updated_at desc, definition.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    const scopes = await loadWorkflowScopesForDefinitions(client, principal.tenantId, rows.rows.map((row) => row.id))
    return {
      items: rows.rows.map((row) => workflowListItem(row, scopes.get(row.id) || [])),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function getApprovalWorkflowDetail(
  principal: RequestPrincipal,
  workflowId: string,
): Promise<ApprovalWorkflowDetail> {
  assertUuid(workflowId, 'WORKFLOW_ID_INVALID')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadWorkflowDefinition(client, principal.tenantId, workflowId, false)
    const versions = await client.query<WorkflowVersionRow>(
      `select * from approval_workflow_versions
       where tenant_id = $1 and workflow_definition_id = $2
       order by version_number desc`,
      [principal.tenantId, workflowId],
    )
    const currentRow = versions.rows.find((row) => row.version_number === definition.current_version) || null
    const current = currentRow ? approvalWorkflowSnapshotSchema.parse(currentRow.graph_snapshot) : null
    const scopes = currentRow ? await loadWorkflowScopes(client, principal.tenantId, currentRow.id) : []
    await assertCanViewWorkflowScopes(principal, scopes, definition.status)
    return {
      ...workflowListItem(definition, scopes),
      createdBy: definition.created_by,
      current,
      versions: versions.rows.map((version) => ({
        id: version.id,
        version: version.version_number,
        status: version.status,
        contentHash: version.content_hash,
        changeSummary: version.change_summary,
        validFrom: optionalIso(version.valid_from),
        validUntil: optionalIso(version.valid_until),
        createdAt: iso(version.created_at),
        approvedAt: optionalIso(version.approved_at),
        publishedAt: optionalIso(version.published_at),
      })),
    }
  })
}

export async function createApprovalWorkflowDraft(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<ApprovalWorkflowDetail> {
  const input = approvalWorkflowDraftInputSchema.parse(rawInput)
  await assertCanManageWorkflowScopes(principal, input.scopes)
  const workflowId = randomUUID()
  await withTenantTransaction(principal.tenantId, async (client) => {
    const prepared = prepareWorkflowSnapshot(workflowId, randomUUID(), 1, input)
    await client.query(
      `insert into approval_workflow_definitions (
         id, tenant_id, workflow_code, name, description, workflow_type,
         status, current_version, created_by
       ) values ($1, $2, $3, $4, $5, $6, 'draft', 1, $7)`,
      [workflowId, principal.tenantId, input.workflowCode, input.name, input.description, input.workflowType, principal.user.id],
    )
    await insertWorkflowVersion(client, principal, workflowId, prepared, input.changeSummary)
    await insertWorkflowChildren(client, principal.tenantId, prepared, input)
    await insertWorkflowChangeAudit(client, principal, workflowId, prepared.snapshot.workflowVersionId, 'created', input.changeSummary, null, prepared.snapshot)
  }).catch((error) => {
    if (isUniqueViolation(error)) throw new ApprovalServiceError('WORKFLOW_CODE_ALREADY_EXISTS', 'Ja existe um workflow com este codigo.', 409)
    throw error
  })
  await auditApprovalChange(principal, 'approval.workflow.created', workflowId, { code: input.workflowCode })
  return getApprovalWorkflowDetail(principal, workflowId)
}

export async function createApprovalWorkflowVersion(
  principal: RequestPrincipal,
  workflowId: string,
  rawInput: unknown,
): Promise<ApprovalWorkflowDetail> {
  assertUuid(workflowId, 'WORKFLOW_ID_INVALID')
  const input = approvalWorkflowVersionInputSchema.parse(rawInput)
  await assertCanManageWorkflowScopes(principal, input.scopes)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadWorkflowDefinition(client, principal.tenantId, workflowId, true)
    if (definition.current_version !== input.expectedCurrentVersion) {
      throw new ApprovalServiceError('STALE_WORKFLOW_VERSION', 'O workflow foi alterado por outro usuario.', 409)
    }
    const nextVersion = (definition.current_version || 0) + 1
    const prepared = prepareWorkflowSnapshot(workflowId, randomUUID(), nextVersion, {
      ...input,
      workflowCode: definition.workflow_code,
    })
    await insertWorkflowVersion(client, principal, workflowId, prepared, input.changeSummary)
    await insertWorkflowChildren(client, principal.tenantId, prepared, input)
    await client.query(
      `update approval_workflow_definitions
       set name = $3, description = $4, workflow_type = $5, status = 'draft', current_version = $6
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, workflowId, input.name, input.description, input.workflowType, nextVersion],
    )
    await insertWorkflowChangeAudit(client, principal, workflowId, prepared.snapshot.workflowVersionId, 'version_created', input.changeSummary, definition, prepared.snapshot)
  })
  await auditApprovalChange(principal, 'approval.workflow.version_created', workflowId, { expectedVersion: input.expectedCurrentVersion })
  return getApprovalWorkflowDetail(principal, workflowId)
}

export async function transitionApprovalWorkflow(
  principal: RequestPrincipal,
  workflowId: string,
  rawInput: unknown,
): Promise<ApprovalWorkflowDetail> {
  assertUuid(workflowId, 'WORKFLOW_ID_INVALID')
  const input = approvalWorkflowTransitionSchema.parse(rawInput)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const definition = await loadWorkflowDefinition(client, principal.tenantId, workflowId, true)
    const versionResult = await client.query<WorkflowVersionRow>(
      `select * from approval_workflow_versions
       where tenant_id = $1 and id = $2 and workflow_definition_id = $3
       for update`,
      [principal.tenantId, input.versionId, workflowId],
    )
    const version = versionResult.rows[0]
    if (!version) throw new ApprovalServiceError('WORKFLOW_VERSION_NOT_FOUND', 'Versao do workflow nao encontrada.', 404)
    const scopes = await loadWorkflowScopes(client, principal.tenantId, version.id)
    await assertCanManageWorkflowScopes(principal, scopes)
    assertWorkflowTransition(version.status, input.action)
    if (['approve', 'publish'].includes(input.action) && version.created_by === principal.user.id) {
      throw new ApprovalServiceError('WORKFLOW_SEPARATION_OF_DUTIES', 'O autor da versao nao pode aprovar ou publicar a propria alteracao.', 409)
    }
    const snapshot = approvalWorkflowSnapshotSchema.parse(version.graph_snapshot)
    if (['approve', 'publish'].includes(input.action)) assertWorkflowPublishable(snapshot)
    assertPublicationWindow(version, input)

    if (input.action === 'submit_review') {
      await setWorkflowStatus(client, principal.tenantId, workflowId, version.id, 'in_review')
    } else if (input.action === 'approve') {
      await client.query(
        `update approval_workflow_versions set status = 'approved', approved_by = $3, approved_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, version.id, principal.user.id],
      )
      await client.query(`update approval_workflow_definitions set status = 'approved' where tenant_id = $1 and id = $2`, [principal.tenantId, workflowId])
    } else if (input.action === 'publish') {
      if (!version.approved_by || !version.approved_at) {
        throw new ApprovalServiceError('WORKFLOW_APPROVAL_REQUIRED', 'A versao precisa ser aprovada antes da publicacao.', 409)
      }
      await client.query(
        `update approval_workflow_versions set status = 'published', published_by = $3, published_at = now()
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, version.id, principal.user.id],
      )
      await client.query(`update approval_workflow_definitions set status = 'published' where tenant_id = $1 and id = $2`, [principal.tenantId, workflowId])
    } else if (input.action === 'suspend') {
      await setWorkflowStatus(client, principal.tenantId, workflowId, version.id, 'suspended')
    } else {
      await setWorkflowStatus(client, principal.tenantId, workflowId, version.id, 'archived')
    }
    await insertWorkflowChangeAudit(client, principal, workflowId, version.id, input.action, input.reason, version, { status: input.action })
  })
  await auditApprovalChange(principal, `approval.workflow.${input.action}`, workflowId, { versionId: input.versionId })
  return getApprovalWorkflowDetail(principal, workflowId)
}

export async function listApprovalInstances(
  principal: RequestPrincipal,
  filters: {
    status?: ApprovalInstanceRow['status']
    companyId?: string
    assignedToMe?: boolean
    overdueOnly?: boolean
    search?: string
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: ApprovalInstanceSummary[]; total: number }> {
  const companyIds = accessibleApprovalCompanyIds(principal, 'ver_aprovacoes')
  if (filters.companyId) {
    await requireCompanyAccess(principal, filters.companyId, 'ver_aprovacoes')
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, companyIds, principal.user.id]
    const clauses = [
      'instance.tenant_id = $1',
      `(instance.company_id = any($2::text[]) or exists (
        select 1 from approval_steps delegated_step
        join approval_assignments delegated_assignment
          on delegated_assignment.tenant_id = delegated_step.tenant_id
          and delegated_assignment.approval_step_id = delegated_step.id
        where delegated_step.tenant_id = instance.tenant_id
          and delegated_step.approval_instance_id = instance.id
          and delegated_assignment.assignee_user_id = $3
      ))`,
    ]
    if (approvalVisibilityMode({
      roleKey: principal.roleKey,
      corporateProfile: principal.user.corporate_profile,
    }) === 'own_demands') {
      clauses.push(requesterApprovalOwnershipSql('instance', '$3'))
    }
    if (filters.companyId) {
      values.push(filters.companyId)
      clauses.push(`instance.company_id = $${values.length}`)
    }
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`instance.status = $${values.length}`)
    }
    if (filters.assignedToMe) {
      clauses.push(`exists (
        select 1 from approval_steps mine_step
        join approval_assignments mine_assignment
          on mine_assignment.tenant_id = mine_step.tenant_id
          and mine_assignment.approval_step_id = mine_step.id
        where mine_step.tenant_id = instance.tenant_id
          and mine_step.approval_instance_id = instance.id
          and mine_assignment.assignee_user_id = $3
          and mine_assignment.status = 'pending'
      )`)
    }
    if (filters.overdueOnly) {
      clauses.push(`exists (
        select 1 from approval_steps overdue_step
        where overdue_step.tenant_id = instance.tenant_id
          and overdue_step.approval_instance_id = instance.id
          and overdue_step.status = 'pending' and overdue_step.due_at < now()
      )`)
    }
    if (filters.search?.trim()) {
      values.push(`%${filters.search.trim()}%`)
      clauses.push(`(
        company.legal_name ilike $${values.length}
        or company.trade_name ilike $${values.length}
        or instance.demand_id ilike $${values.length}
        or instance.reservation_id ilike $${values.length}
      )`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total
       from approval_instances instance
       join companies company on company.tenant_id = instance.tenant_id and company.id = instance.company_id
       where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const rows = await client.query<ApprovalInstanceRow & { pending_steps: string; overdue_steps: string; assigned_to_me: boolean }>(
      `select instance.*, coalesce(company.trade_name, company.legal_name) as company_name,
              definition.name as workflow_name,
              demand.demand_number,
              demand.service_type as demand_service_type,
              demand.passenger_name_snapshot as demand_passenger_name,
              demand.travel_start_date as demand_travel_start_date,
              demand.travel_end_date as demand_travel_end_date,
              demand.destination as demand_destination,
              requester.name as requester_name,
              (select count(*)::text from approval_steps step
               where step.tenant_id = instance.tenant_id and step.approval_instance_id = instance.id
                 and step.status = 'pending') as pending_steps,
              (select count(*)::text from approval_steps step
               where step.tenant_id = instance.tenant_id and step.approval_instance_id = instance.id
                 and step.status = 'pending' and step.due_at < now()) as overdue_steps,
              exists (
                select 1 from approval_steps mine_step
                join approval_assignments mine_assignment
                  on mine_assignment.tenant_id = mine_step.tenant_id
                  and mine_assignment.approval_step_id = mine_step.id
                where mine_step.tenant_id = instance.tenant_id
                  and mine_step.approval_instance_id = instance.id
                  and mine_assignment.assignee_user_id = $3
                  and mine_assignment.status = 'pending'
              ) as assigned_to_me
       from approval_instances instance
       join companies company on company.tenant_id = instance.tenant_id and company.id = instance.company_id
       join approval_workflow_definitions definition
         on definition.tenant_id = instance.tenant_id and definition.id = instance.workflow_definition_id
       left join demands demand
         on demand.tenant_id = instance.tenant_id and demand.id = instance.demand_id
       left join requesters requester
         on requester.tenant_id = demand.tenant_id and requester.id = demand.requester_id
       where ${clauses.join(' and ')}
       order by instance.created_at desc, instance.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: rows.rows.map(mapApprovalInstanceSummary),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

export async function getApprovalInstanceDetail(
  principal: RequestPrincipal,
  instanceId: string,
): Promise<ApprovalInstanceDetail> {
  assertUuid(instanceId, 'APPROVAL_INSTANCE_ID_INVALID')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const instance = await loadApprovalInstance(client, principal.tenantId, instanceId, false)
    await assertCanViewApprovalInstance(client, principal, instance)
    return hydrateApprovalInstanceDetail(client, principal, instance)
  })
}

export async function createApprovalInstance(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<ApprovalInstanceDetail> {
  const input = createApprovalInstanceSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.companyId, 'criar_demandas')
  const inputHash = sha256({ ...input, tenantId: principal.tenantId })
  let instanceId = ''
  try {
    instanceId = await withTenantTransaction(principal.tenantId, async (client) => {
      await assertRequesterCanCreateApprovalInstance(client, principal, input)
      const existing = await client.query<ApprovalInstanceRow>(
        `select * from approval_instances
         where tenant_id = $1 and source_idempotency_key = $2 for update`,
        [principal.tenantId, input.idempotencyKey],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].input_hash !== inputHash) {
          throw new ApprovalServiceError('APPROVAL_IDEMPOTENCY_CONFLICT', 'A chave de idempotencia ja foi usada com outro conteudo.', 409)
        }
        return existing.rows[0].id
      }

      const company = await loadCompanyContext(client, principal.tenantId, input.companyId)
      await validateApprovalEntityOwnership(client, principal.tenantId, input)
      const selected = await loadPublishedWorkflowForCompany(client, principal.tenantId, input, company.groupId)
      const parsedSubject = approvalSubjectInputSchema.parse(input.subject)
      const subject: ApprovalSubject & Record<string, unknown> = {
        ...parsedSubject,
        tenantId: principal.tenantId,
        companyId: input.companyId,
        groupId: company.groupId,
      }
      const snapshot = approvalWorkflowSnapshotSchema.parse(selected.version.graph_snapshot)
      assertWorkflowPublishable(snapshot)
      const id = randomUUID()
      await client.query(
        `insert into approval_instances (
           id, tenant_id, workflow_definition_id, workflow_version_id, demand_id,
           reservation_id, company_id, employee_id, instance_type, status,
           subject_snapshot, workflow_snapshot, input_hash, source_idempotency_key, started_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'in_progress', $10::jsonb, $11::jsonb, $12, $13, $14)`,
        [
          id, principal.tenantId, selected.definition.id, selected.version.id,
          input.demandId || null, input.reservationId || null, input.companyId,
          input.employeeId || null, input.instanceType, JSON.stringify(subject),
          JSON.stringify(snapshot), inputHash, input.idempotencyKey, principal.user.id,
        ],
      )
      await insertApprovalEvent(client, principal, id, null, 'instance_started', {
        workflowVersionId: selected.version.id,
        inputHash,
      })
      const start = snapshot.nodes.find((node) => node.type === 'start')
      if (!start) throw new ApprovalServiceError('WORKFLOW_START_NODE_MISSING', 'Workflow publicado sem no inicial.', 409)
      const initialNodes = resolveNextWorkflowNodes(snapshot, start.id, subject)
      const instance = await loadApprovalInstance(client, principal.tenantId, id, true)
      await activateWorkflowNodes(client, principal, instance, snapshot, initialNodes)
      if (input.demandId) {
        await client.query(
          `update demands set active_approval_instance_id = $3, updated_by = $4
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, input.demandId, id, principal.user.id],
        )
      }
      return id
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApprovalServiceError('APPROVAL_IDEMPOTENCY_CONFLICT', 'A operacao concorrente utilizou a mesma chave de idempotencia.', 409)
    }
    throw error
  }
  await auditApprovalChange(principal, 'approval.instance.started', instanceId, { companyId: input.companyId, demandId: input.demandId || null })
  return getApprovalInstanceDetail(principal, instanceId)
}

export async function decideApprovalAssignment(
  principal: RequestPrincipal,
  assignmentId: string,
  rawInput: unknown,
): Promise<ApprovalInstanceDetail> {
  assertUuid(assignmentId, 'APPROVAL_ASSIGNMENT_ID_INVALID')
  const input = approvalDecisionInputSchema.parse(rawInput)
  let instanceId = ''
  await withTenantTransaction(principal.tenantId, async (client) => {
    const assignmentResult = await client.query<ApprovalAssignmentRow>(
      `select * from approval_assignments where tenant_id = $1 and id = $2 for update`,
      [principal.tenantId, assignmentId],
    )
    const assignment = assignmentResult.rows[0]
    if (!assignment) throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_NOT_FOUND', 'Atribuicao de aprovacao nao encontrada.', 404)
    if (assignment.assignee_user_id !== principal.user.id) {
      throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_ACCESS_DENIED', 'Esta decisao pertence a outro aprovador.', 403)
    }
    const actionTokenId = input.actionToken
      ? await validateAndLockApprovalActionToken(client, principal, assignment, input)
      : null
    const stepResult = await client.query<ApprovalStepRow>(
      `select * from approval_steps where tenant_id = $1 and id = $2 for update`,
      [principal.tenantId, assignment.approval_step_id],
    )
    const step = stepResult.rows[0]
    if (!step) throw new ApprovalServiceError('APPROVAL_STEP_NOT_FOUND', 'Etapa de aprovacao nao encontrada.', 404)
    const instance = await loadApprovalInstance(client, principal.tenantId, step.approval_instance_id, true)
    instanceId = instance.id
    if (Number(step.version) !== input.expectedStepVersion) {
      throw new ApprovalServiceError('STALE_APPROVAL_STEP', 'A etapa foi alterada por outra decisao. Atualize a tela.', 409)
    }
    const existingDecision = await client.query<{ id: string; assignment_id: string; decision: string; reason: string }>(
      `select id, assignment_id, decision, reason from approval_decisions
       where tenant_id = $1 and idempotency_key = $2`,
      [principal.tenantId, input.idempotencyKey],
    )
    if (existingDecision.rows[0]) {
      const existing = existingDecision.rows[0]
      if (existing.assignment_id !== assignmentId || existing.decision !== input.decision || existing.reason !== input.reason) {
        throw new ApprovalServiceError('APPROVAL_DECISION_IDEMPOTENCY_CONFLICT', 'A chave de idempotencia ja foi usada em outra decisao.', 409)
      }
      return
    }
    if (assignment.status !== 'pending' || step.status !== 'pending' || !['pending', 'in_progress'].includes(instance.status)) {
      throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_ALREADY_CLOSED', 'A atribuicao nao esta mais pendente.', 409)
    }

    const assignmentStatus = input.decision === 'approved' ? 'approved' : 'rejected'
    await client.query(
      `insert into approval_decisions (
         tenant_id, approval_instance_id, approval_step_id, assignment_id,
         decision, reason, decided_by_user_id, acting_for_user_id,
         idempotency_key, decision_snapshot
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        principal.tenantId, instance.id, step.id, assignment.id, input.decision,
        input.reason, principal.user.id, assignment.delegated_from_user_id,
        input.idempotencyKey, JSON.stringify({ expectedStepVersion: input.expectedStepVersion, confirmation: true }),
      ],
    )
    if (actionTokenId) {
      await client.query(
        `update approval_action_tokens set used_at = now(), used_by_user_id = $3
         where tenant_id = $1 and id = $2 and used_at is null`,
        [principal.tenantId, actionTokenId, principal.user.id],
      )
    }
    await client.query(
      `update approval_assignments set status = $3, responded_at = now()
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, assignment.id, assignmentStatus],
    )
    await applyApprovalStepOutcome(client, principal, instance, step, 'decision_recorded', {
      assignmentId,
      decision: input.decision,
    })
  })
  await auditApprovalChange(principal, 'approval.assignment.decided', assignmentId, { instanceId, decision: input.decision })
  return getApprovalInstanceDetail(principal, instanceId)
}

async function applyApprovalStepOutcome(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
  step: ApprovalStepRow,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const assignmentStates = await client.query<{ id: string; status: ApprovalAssignmentRow['status'] }>(
    `select id, status from approval_assignments
     where tenant_id = $1 and approval_step_id = $2 order by assigned_at, id`,
    [principal.tenantId, step.id],
  )
  const outcome = calculateApprovalStepOutcome(
    step.completion_mode,
    assignmentStates.rows.map((row) => ({ assignmentId: row.id, assigneeUserId: '', status: row.status })),
    step.quorum || undefined,
  )
  await insertApprovalEvent(client, principal, instance.id, step.id, eventType, { ...payload, outcome })
  if (outcome.status === 'pending') {
    await client.query(
      `update approval_steps set version = version + 1 where tenant_id = $1 and id = $2`,
      [principal.tenantId, step.id],
    )
    return
  }
  if (outcome.cancelledAssignmentIds.length) {
    await client.query(
      `update approval_assignments set status = 'cancelled', responded_at = now()
       where tenant_id = $1 and id = any($2::uuid[]) and status = 'pending'`,
      [principal.tenantId, outcome.cancelledAssignmentIds],
    )
  }
  await client.query(
    `update approval_steps set status = $3, completed_at = now(), version = version + 1
     where tenant_id = $1 and id = $2`,
    [principal.tenantId, step.id, outcome.status],
  )
  await client.query(
    `update approval_escalations set status = 'cancelled',
            result = jsonb_build_object('reason', 'step_closed', 'outcome', $3::text)
     where tenant_id = $1 and approval_step_id = $2 and status = 'scheduled'`,
    [principal.tenantId, step.id, outcome.status],
  )
  if (outcome.status === 'rejected') {
    await rejectApprovalInstance(client, principal, instance, step.id, outcome.explanation)
    return
  }
  const snapshot = approvalWorkflowSnapshotSchema.parse(instance.workflow_snapshot)
  const nextNodes = resolveNextWorkflowNodes(snapshot, step.node_id, asRecord(instance.subject_snapshot))
  await activateWorkflowNodes(client, principal, instance, snapshot, nextNodes)
}

export async function listApprovalDelegations(
  principal: RequestPrincipal,
  filters: { status?: string; membershipId?: string; limit?: number; offset?: number } = {},
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    await expireApprovalDelegations(client, principal.tenantId)
    const values: unknown[] = [principal.tenantId]
    const clauses = ['delegation.tenant_id = $1']
    if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
      values.push(principal.membershipId)
      clauses.push(`(delegation.delegator_membership_id = $${values.length} or delegation.delegate_membership_id = $${values.length})`)
    }
    if (filters.membershipId) {
      assertUuid(filters.membershipId, 'MEMBERSHIP_ID_INVALID')
      values.push(filters.membershipId)
      clauses.push(`(delegation.delegator_membership_id = $${values.length} or delegation.delegate_membership_id = $${values.length})`)
    }
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`delegation.status = $${values.length}`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from approval_delegations delegation where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const rows = await client.query<QueryResultRow>(
      `select delegation.id, delegation.delegator_membership_id as "delegatorMembershipId",
              delegator_user.name as "delegatorName", delegation.delegate_membership_id as "delegateMembershipId",
              delegate_user.name as "delegateName", delegation.valid_from as "validFrom",
              delegation.valid_until as "validUntil", delegation.company_ids as "companyIds",
              delegation.group_ids as "groupIds", delegation.modules, delegation.justification,
              delegation.status, delegation.created_at as "createdAt", delegation.revoked_at as "revokedAt",
              delegation.revocation_reason as "revocationReason"
       from approval_delegations delegation
       join tenant_memberships delegator
         on delegator.tenant_id = delegation.tenant_id and delegator.id = delegation.delegator_membership_id
       join users delegator_user on delegator_user.id = delegator.user_id
       join tenant_memberships delegate
         on delegate.tenant_id = delegation.tenant_id and delegate.id = delegation.delegate_membership_id
       join users delegate_user on delegate_user.id = delegate.user_id
       where ${clauses.join(' and ')}
       order by delegation.created_at desc, delegation.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return { items: rows.rows.map(normalizeDates), total: Number(count.rows[0]?.total || 0) }
  })
}

export async function createApprovalDelegation(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = approvalDelegationInputSchema.parse(rawInput)
  if (input.delegatorMembershipId !== principal.membershipId && !principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
    throw new ApprovalServiceError('DELEGATION_ACTOR_DENIED', 'Voce so pode criar delegacao para sua propria identidade.', 403)
  }
  const delegationId = await withTenantTransaction(principal.tenantId, async (client) => {
    await expireApprovalDelegations(client, principal.tenantId)
    const memberships = await loadDelegationMemberships(client, principal, [input.delegatorMembershipId, input.delegateMembershipId])
    const existingRows = await client.query<{
      id: string
      delegator_membership_id: string
      delegate_membership_id: string
      valid_from: string | Date
      valid_until: string | Date
      company_ids: string[]
      group_ids: string[]
      modules: string[]
      justification: string
      status: ApprovalDelegationCandidate['status']
    }>(
      `select id, delegator_membership_id, delegate_membership_id, valid_from, valid_until,
              company_ids, group_ids, modules, justification, status
       from approval_delegations
       where tenant_id = $1 and status in ('active', 'scheduled')`,
      [principal.tenantId],
    )
    const existing: ApprovalDelegationCandidate[] = existingRows.rows.map((row) => ({
      id: row.id,
      tenantId: principal.tenantId,
      delegatorMembershipId: row.delegator_membership_id,
      delegateMembershipId: row.delegate_membership_id,
      validFrom: iso(row.valid_from),
      validUntil: iso(row.valid_until),
      companyIds: row.company_ids,
      groupIds: row.group_ids,
      modules: row.modules,
      justification: row.justification,
      status: row.status,
    }))
    const validated = validateApprovalDelegation(
      {
        tenantId: principal.tenantId,
        delegatorMembershipId: input.delegatorMembershipId,
        delegateMembershipId: input.delegateMembershipId,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        companyIds: input.companyIds,
        groupIds: input.groupIds,
        modules: input.modules,
        justification: input.justification,
      },
      memberships,
      existing,
      new Date().toISOString(),
    )
    const inserted = await client.query<{ id: string }>(
      `insert into approval_delegations (
         tenant_id, delegator_membership_id, delegate_membership_id,
         valid_from, valid_until, scope, company_ids, group_ids, modules,
         justification, status, created_by_membership_id
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::text[], $8::text[], $9::text[], $10, $11, $12)
       returning id`,
      [
        principal.tenantId, validated.delegatorMembershipId, validated.delegateMembershipId,
        validated.validFrom, validated.validUntil,
        JSON.stringify({ companies: validated.companyIds, groups: validated.groupIds, modules: validated.modules }),
        validated.companyIds, validated.groupIds, validated.modules,
        validated.justification, validated.status, principal.membershipId,
      ],
    )
    const id = inserted.rows[0].id
    for (const companyId of validated.companyIds) {
      await client.query(
        `insert into approval_delegation_companies (tenant_id, delegation_id, company_id)
         values ($1, $2, $3)`,
        [principal.tenantId, id, companyId],
      )
    }
    for (const groupId of validated.groupIds) {
      await client.query(
        `insert into approval_delegation_groups (tenant_id, delegation_id, group_id)
         values ($1, $2, $3)`,
        [principal.tenantId, id, groupId],
      )
    }
    for (const moduleKey of validated.modules) {
      await client.query(
        `insert into approval_delegation_modules (tenant_id, delegation_id, module_key)
         values ($1, $2, $3)`,
        [principal.tenantId, id, moduleKey],
      )
    }
    return id
  })
  await auditApprovalChange(principal, 'approval.delegation.created', delegationId, {
    delegatorMembershipId: input.delegatorMembershipId,
    delegateMembershipId: input.delegateMembershipId,
  })
  const result = await listApprovalDelegations(principal, { membershipId: input.delegatorMembershipId, limit: 200 })
  return result.items.find((item) => item.id === delegationId) || { id: delegationId }
}

export async function revokeApprovalDelegation(
  principal: RequestPrincipal,
  delegationId: string,
  rawInput: unknown,
): Promise<void> {
  assertUuid(delegationId, 'DELEGATION_ID_INVALID')
  const input = revokeApprovalDelegationSchema.parse(rawInput)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ delegator_membership_id: string; status: string }>(
      `select delegator_membership_id, status from approval_delegations
       where tenant_id = $1 and id = $2 for update`,
      [principal.tenantId, delegationId],
    )
    const delegation = result.rows[0]
    if (!delegation) throw new ApprovalServiceError('DELEGATION_NOT_FOUND', 'Delegacao nao encontrada.', 404)
    if (delegation.delegator_membership_id !== principal.membershipId && !principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
      throw new ApprovalServiceError('DELEGATION_REVOKE_DENIED', 'Voce nao pode revogar esta delegacao.', 403)
    }
    if (!['active', 'scheduled'].includes(delegation.status)) {
      throw new ApprovalServiceError('DELEGATION_ALREADY_CLOSED', 'A delegacao ja esta encerrada.', 409)
    }
    await client.query(
      `update approval_delegations set status = 'revoked', revoked_by_membership_id = $3,
              revoked_at = now(), revocation_reason = $4
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, delegationId, principal.membershipId, input.reason],
    )
  })
  await auditApprovalChange(principal, 'approval.delegation.revoked', delegationId, {})
}

export async function listApprovalAuthorities(
  principal: RequestPrincipal,
  filters: { membershipId?: string; kind?: ApprovalKind; status?: string; limit?: number; offset?: number } = {},
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId]
    const clauses = ['authority.tenant_id = $1']
    if (filters.membershipId) {
      assertUuid(filters.membershipId, 'MEMBERSHIP_ID_INVALID')
      values.push(filters.membershipId)
      clauses.push(`authority.membership_id = $${values.length}`)
    }
    if (filters.kind) {
      values.push(filters.kind)
      clauses.push(`authority.approval_kind = $${values.length}`)
    }
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`authority.status = $${values.length}`)
    }
    if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
      values.push(principal.membershipId)
      const membershipParameter = values.length
      values.push(accessibleApprovalCompanyIds(principal, 'decidir_aprovacoes'))
      const companyParameter = values.length
      values.push(principal.corporateAccess?.groupIds || [])
      const groupParameter = values.length
      clauses.push(`(
        authority.membership_id = $${membershipParameter}::uuid
        or authority.company_id = any($${companyParameter}::text[])
        or authority.group_id = any($${groupParameter}::text[])
      )`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from approval_authorities authority where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const rows = await client.query<QueryResultRow>(
      `select authority.id, authority.membership_id as "membershipId", user_row.name as "memberName",
              authority.approval_kind as "approvalKind", authority.company_id as "companyId",
              authority.group_id as "groupId", authority.cost_center_id as "costCenterId",
              cost_center.code as "costCenterCode", cost_center.name as "costCenterName",
              authority.project_id as "projectId", authority.max_amount::float8 as "maxAmount",
              authority.accumulated_amount_limit::float8 as "accumulatedAmountLimit",
              authority.accumulation_period_days as "accumulationPeriodDays",
              authority.max_percentage_above_lowest::float8 as "maxPercentageAboveLowest",
              authority.max_percentage_above_average::float8 as "maxPercentageAboveAverage",
              authority.requires_budget_available as "requiresBudgetAvailable",
              authority.urgent_allowed as "urgentAllowed",
              authority.currency, authority.products, authority.destinations,
              authority.risk_levels as "riskLevels", authority.status,
              authority.valid_from as "validFrom", authority.valid_until as "validUntil",
              authority.justification, authority.created_at as "createdAt"
       from approval_authorities authority
       join tenant_memberships membership
         on membership.tenant_id = authority.tenant_id and membership.id = authority.membership_id
       join users user_row on user_row.id = membership.user_id
       left join cost_centers cost_center
         on cost_center.tenant_id = authority.tenant_id
        and cost_center.id = authority.cost_center_id
        and cost_center.deleted_at is null
       where ${clauses.join(' and ')}
       order by authority.created_at desc, authority.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return { items: rows.rows.map(normalizeDates), total: Number(count.rows[0]?.total || 0) }
  })
}

export async function createApprovalAuthority(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = approvalAuthorityInputSchema.parse(rawInput)
  const authorityId = await withTenantTransaction(principal.tenantId, async (client) => {
    const target = await loadMembershipCandidate(client, principal.tenantId, input.membershipId)
    const targetPermissions = normalizeMembershipPermissions(target.permissions, target.profile_key)
    if (target.platform_admin || !targetPermissions.decidir_aprovacoes) {
      throw new ApprovalServiceError('APPROVAL_AUTHORITY_TARGET_INELIGIBLE', 'O usuario nao esta apto a receber alcada de aprovacao.', 422)
    }
    const scopeCompanyId = await assertAuthorityScope(client, principal, input)
    const targetAccess = await resolveEffectiveCorporateAccessInTransaction(client, {
      tenantId: principal.tenantId,
      membershipId: target.membership_id,
      roleKey: target.role_key,
      platformAdmin: false,
      membershipPermissions: targetPermissions,
      legacyCompanyId: target.company_id,
      legacyCompanyIds: target.allowed_company_ids || [],
      legacyGroupIds: target.allowed_group_ids || [],
    })
    if (scopeCompanyId && !targetAccess.summary.companyIds.includes(scopeCompanyId)) {
      throw new ApprovalServiceError('APPROVAL_AUTHORITY_SCOPE_DENIED', 'O usuario nao possui acesso a empresa da alcada.', 409)
    }
    if (input.groupId && !targetAccess.summary.groupIds.includes(input.groupId)) {
      throw new ApprovalServiceError('APPROVAL_AUTHORITY_SCOPE_DENIED', 'O usuario nao possui acesso ao grupo da alcada.', 409)
    }
    await assertAuthorityCanBeGranted(client, principal, input)
    const inserted = await client.query<{ id: string }>(
      `insert into approval_authorities (
         tenant_id, membership_id, approval_kind, company_id, group_id,
         cost_center_id, project_id, max_amount, accumulated_amount_limit,
         accumulation_period_days, max_percentage_above_lowest,
         max_percentage_above_average, requires_budget_available, urgent_allowed,
         currency, products, destinations, risk_levels, valid_from, valid_until, justification,
         status, created_by_membership_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16::text[], $17::text[], $18::text[], $19, $20, $21,
                 case when $19 > now() then 'scheduled' else 'active' end, $22)
       returning id`,
      [
        principal.tenantId, input.membershipId, input.approvalKind,
        input.companyId || null, input.groupId || null, input.costCenterId || null,
        input.projectId || null, input.maxAmount ?? null,
        input.accumulatedAmountLimit ?? null, input.accumulationPeriodDays ?? null,
        input.maxPercentageAboveLowest ?? null, input.maxPercentageAboveAverage ?? null,
        input.requiresBudgetAvailable, input.urgentAllowed, input.currency || null,
        uniqueStrings(input.products), uniqueStrings(input.destinations),
        uniqueStrings(input.riskLevels), input.validFrom, input.validUntil || null,
        input.justification, principal.membershipId,
      ],
    )
    return inserted.rows[0].id
  }).catch((error) => {
    if (isUniqueViolation(error)) throw new ApprovalServiceError('APPROVAL_AUTHORITY_ALREADY_EXISTS', 'Ja existe uma alcada ativa equivalente.', 409)
    throw error
  })
  await auditApprovalChange(principal, 'approval.authority.created', authorityId, { membershipId: input.membershipId, kind: input.approvalKind })
  const result = await listApprovalAuthorities(principal, { membershipId: input.membershipId, limit: 200 })
  return result.items.find((item) => item.id === authorityId) || { id: authorityId }
}

export async function revokeApprovalAuthority(
  principal: RequestPrincipal,
  authorityId: string,
  rawInput: unknown,
): Promise<void> {
  assertUuid(authorityId, 'APPROVAL_AUTHORITY_ID_INVALID')
  const input = revokeApprovalDelegationSchema.parse(rawInput)
  await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<AuthorityRow>(
      `select * from approval_authorities where tenant_id = $1 and id = $2 for update`,
      [principal.tenantId, authorityId],
    )
    const authority = result.rows[0]
    if (!authority) throw new ApprovalServiceError('APPROVAL_AUTHORITY_NOT_FOUND', 'Alcada nao encontrada.', 404)
    await assertAuthorityCanBeGranted(client, principal, {
      membershipId: authority.membership_id,
      approvalKind: authority.approval_kind,
      companyId: authority.company_id,
      groupId: authority.group_id,
      costCenterId: authority.cost_center_id,
      projectId: authority.project_id,
      maxAmount: authority.max_amount === null ? null : Number(authority.max_amount),
      accumulatedAmountLimit: authority.accumulated_amount_limit === null ? null : Number(authority.accumulated_amount_limit),
      accumulationPeriodDays: authority.accumulation_period_days,
      maxPercentageAboveLowest: authority.max_percentage_above_lowest === null ? null : Number(authority.max_percentage_above_lowest),
      maxPercentageAboveAverage: authority.max_percentage_above_average === null ? null : Number(authority.max_percentage_above_average),
      requiresBudgetAvailable: authority.requires_budget_available,
      urgentAllowed: authority.urgent_allowed,
      currency: authority.currency,
      products: authority.products,
      destinations: authority.destinations,
      riskLevels: authority.risk_levels,
      validFrom: iso(authority.valid_from),
      validUntil: optionalIso(authority.valid_until),
      justification: authority.justification,
    })
    if (!['active', 'scheduled', 'suspended'].includes(authority.status)) {
      throw new ApprovalServiceError('APPROVAL_AUTHORITY_ALREADY_CLOSED', 'A alcada ja esta encerrada.', 409)
    }
    await client.query(
      `update approval_authorities set status = 'revoked', revoked_by_membership_id = $3,
              revoked_at = now(), revocation_reason = $4
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, authorityId, principal.membershipId, input.reason],
    )
  })
  await auditApprovalChange(principal, 'approval.authority.revoked', authorityId, {})
}

export async function issueApprovalActionToken(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<{ token: string; expiresAt: string; allowedAction: 'view' | 'approve' | 'reject' }> {
  const input = approvalActionTokenInputSchema.parse(rawInput)
  const token = randomBytes(32).toString('base64url')
  const tokenHash = sha256(token)
  const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
  await withTenantTransaction(principal.tenantId, async (client) => {
    const assignment = await client.query<ApprovalAssignmentRow>(
      `select * from approval_assignments where tenant_id = $1 and id = $2`,
      [principal.tenantId, input.assignmentId],
    )
    const row = assignment.rows[0]
    if (!row) throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_NOT_FOUND', 'Atribuicao nao encontrada.', 404)
    if (row.assignee_user_id !== principal.user.id && !principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
      throw new ApprovalServiceError('APPROVAL_TOKEN_ISSUE_DENIED', 'Voce nao pode emitir token para esta atribuicao.', 403)
    }
    if (input.allowedAction !== 'view' && row.status !== 'pending') {
      throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_ALREADY_CLOSED', 'A atribuicao nao esta pendente.', 409)
    }
    await client.query(
      `insert into approval_action_tokens (
         tenant_id, assignment_id, token_hash, allowed_action,
         requires_authentication, expires_at
       ) values ($1, $2, $3, $4, true, $5)`,
      [principal.tenantId, input.assignmentId, tokenHash, input.allowedAction, expiresAt],
    )
  })
  await auditApprovalChange(principal, 'approval.action_token.issued', input.assignmentId, { allowedAction: input.allowedAction, expiresAt })
  return { token, expiresAt, allowedAction: input.allowedAction }
}

export async function listApprovalNotifications(
  principal: RequestPrincipal,
  filters: { unreadOnly?: boolean; limit?: number; offset?: number } = {},
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, principal.user.id]
    const clauses = ['notification.tenant_id = $1', 'notification.recipient_user_id = $2']
    if (filters.unreadOnly) clauses.push(`notification.status = 'unread'`)
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from approval_notifications notification where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const rows = await client.query<QueryResultRow>(
      `select notification.id, notification.approval_instance_id as "instanceId",
              notification.approval_step_id as "stepId", notification.notification_type as type,
              notification.title, notification.message, notification.status,
              notification.payload, notification.read_at as "readAt",
              notification.created_at as "createdAt"
       from approval_notifications notification
       where ${clauses.join(' and ')}
       order by notification.created_at desc, notification.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return { items: rows.rows.map(normalizeDates), total: Number(count.rows[0]?.total || 0) }
  })
}

export async function markApprovalNotificationRead(
  principal: RequestPrincipal,
  notificationId: string,
): Promise<void> {
  assertUuid(notificationId, 'APPROVAL_NOTIFICATION_ID_INVALID')
  const updated = await withTenantTransaction(principal.tenantId, async (client) => client.query(
    `update approval_notifications set status = 'read', read_at = coalesce(read_at, now())
     where tenant_id = $1 and id = $2 and recipient_user_id = $3
     returning id`,
    [principal.tenantId, notificationId, principal.user.id],
  ))
  if (!updated.rowCount) throw new ApprovalServiceError('APPROVAL_NOTIFICATION_NOT_FOUND', 'Notificacao nao encontrada.', 404)
}

export async function processApprovalMaintenance(
  principal: RequestPrincipal,
  options: { limit?: number } = {},
): Promise<ApprovalMaintenanceResult> {
  const limit = Math.min(100, Math.max(1, options.limit || 25))
  const lifecycle = await withTenantTransaction(principal.tenantId, async (client) => {
    const activatedDelegations = await client.query(
      `update approval_delegations set status = 'active'
       where tenant_id = $1 and status = 'scheduled' and valid_from <= now() and valid_until > now()`,
      [principal.tenantId],
    )
    const expiredDelegations = await expireApprovalDelegations(client, principal.tenantId)
    const activatedAuthorities = await client.query(
      `update approval_authorities set status = 'active'
       where tenant_id = $1 and status = 'scheduled' and valid_from <= now()
         and (valid_until is null or valid_until > now())`,
      [principal.tenantId],
    )
    const expiredAuthorities = await client.query(
      `update approval_authorities set status = 'expired'
       where tenant_id = $1 and status in ('scheduled', 'active', 'suspended')
         and valid_until is not null and valid_until <= now()`,
      [principal.tenantId],
    )
    return {
      activatedDelegations: activatedDelegations.rowCount || 0,
      expiredDelegations,
      activatedAuthorities: activatedAuthorities.rowCount || 0,
      expiredAuthorities: expiredAuthorities.rowCount || 0,
    }
  })

  const items: ApprovalMaintenanceResult['items'] = []
  for (let index = 0; index < limit; index += 1) {
    const processed = await processNextApprovalEscalation(principal)
    if (!processed) break
    items.push(processed)
  }
  const result: ApprovalMaintenanceResult = {
    ...lifecycle,
    claimed: items.length,
    executed: items.filter((item) => item.status === 'executed').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
    failed: items.filter((item) => item.status === 'failed').length,
    items,
  }
  await auditApprovalChange(principal, 'approval.sla.maintenance_processed', principal.tenantId, {
    ...result,
    items: result.items.slice(0, 100),
  })
  return result
}

async function validateAndLockApprovalActionToken(
  client: PoolClient,
  principal: RequestPrincipal,
  assignment: ApprovalAssignmentRow,
  input: ApprovalDecisionInput,
): Promise<string> {
  const result = await client.query<{
    id: string
    assignment_id: string
    allowed_action: 'view' | 'approve' | 'reject'
    requires_authentication: boolean
    expires_at: string | Date
    used_at: string | Date | null
  }>(
    `select id, assignment_id, allowed_action, requires_authentication, expires_at, used_at
     from approval_action_tokens where tenant_id = $1 and token_hash = $2 for update`,
    [principal.tenantId, sha256(input.actionToken)],
  )
  const token = result.rows[0]
  const expectedAction = input.decision === 'approved' ? 'approve' : 'reject'
  if (!token || token.assignment_id !== assignment.id || token.allowed_action !== expectedAction) {
    throw new ApprovalServiceError('APPROVAL_ACTION_TOKEN_INVALID', 'Token de decisao invalido.', 403)
  }
  if (!token.requires_authentication) {
    throw new ApprovalServiceError('UNAUTHENTICATED_APPROVAL_TOKEN_FORBIDDEN', 'Token sem autenticacao nao e aceito.', 403)
  }
  if (token.used_at) throw new ApprovalServiceError('APPROVAL_ACTION_TOKEN_USED', 'Token de decisao ja utilizado.', 409)
  if (Date.parse(iso(token.expires_at)) <= Date.now()) throw new ApprovalServiceError('APPROVAL_ACTION_TOKEN_EXPIRED', 'Token de decisao expirado.', 410)
  return token.id
}

async function loadDelegationMemberships(
  client: PoolClient,
  principal: RequestPrincipal,
  membershipIds: string[],
): Promise<DelegationMembership[]> {
  const uniqueIds = uniqueStrings(membershipIds)
  const rows = await client.query<MembershipCandidateRow>(
    `select membership.id as membership_id, membership.user_id,
            membership.status as membership_status, membership.profile_key,
            role_row.role_key, user_row.platform_admin, membership.company_id,
            membership.allowed_company_ids, membership.allowed_group_ids,
            coalesce((
              select jsonb_object_agg(role_permission.permission_key, role_permission.allowed)
              from role_permissions role_permission where role_permission.role_id = role_row.id
            ), '{}'::jsonb) || membership.custom_permissions as permissions,
            user_row.metadata as user_metadata
     from tenant_memberships membership
     join users user_row on user_row.id = membership.user_id and user_row.deleted_at is null
     join roles role_row on role_row.id = membership.role_id
     where membership.tenant_id = $1 and membership.id = any($2::uuid[])`,
    [principal.tenantId, uniqueIds],
  )
  if (rows.rowCount !== uniqueIds.length) throw new ApprovalServiceError('DELEGATION_MEMBER_NOT_FOUND', 'Um dos membros da delegacao nao foi encontrado.', 404)
  const result: DelegationMembership[] = []
  for (const row of rows.rows) {
    const permissions = normalizeMembershipPermissions(row.permissions, row.profile_key)
    const access = await resolveEffectiveCorporateAccessInTransaction(client, {
      tenantId: principal.tenantId,
      membershipId: row.membership_id,
      roleKey: row.role_key,
      platformAdmin: row.platform_admin,
      membershipPermissions: permissions,
      legacyCompanyId: row.company_id,
      legacyCompanyIds: row.allowed_company_ids || [],
      legacyGroupIds: row.allowed_group_ids || [],
    })
    result.push({
      membershipId: row.membership_id,
      tenantId: principal.tenantId,
      active: row.membership_status === 'active',
      platformAdmin: row.platform_admin,
      companyIds: access.summary.companyIds,
      groupIds: access.summary.groupIds,
      delegableModules: [
        permissions.decidir_aprovacoes ? 'approvals' : '',
        permissions.gerenciar_workflows ? 'workflows' : '',
        permissions.gerenciar_politicas ? 'policies' : '',
        permissions.editar_financeiro ? 'finance' : '',
      ].filter(Boolean),
      canReceiveDelegation: row.membership_status === 'active' && !row.platform_admin && permissions.decidir_aprovacoes,
    })
  }
  return result
}

async function expireApprovalDelegations(client: PoolClient, tenantId: string): Promise<number> {
  const expired = await client.query(
    `update approval_delegations set status = 'expired'
     where tenant_id = $1 and status in ('active', 'scheduled') and valid_until <= now()`,
    [tenantId],
  )
  await client.query(
    `update approval_delegations set status = 'active'
     where tenant_id = $1 and status = 'scheduled' and valid_from <= now() and valid_until > now()`,
    [tenantId],
  )
  return expired.rowCount || 0
}

async function processNextApprovalEscalation(
  principal: RequestPrincipal,
): Promise<ApprovalMaintenanceResult['items'][number] | null> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const selected = await client.query<ApprovalEscalationRow>(
      `select * from approval_escalations
       where tenant_id = $1 and status = 'scheduled' and scheduled_at <= now()
       order by scheduled_at, id
       for update skip locked
       limit 1`,
      [principal.tenantId],
    )
    const escalation = selected.rows[0]
    if (!escalation) return null

    await client.query('savepoint approval_escalation_processing')
    try {
      const assignments = await client.query<ApprovalAssignmentRow>(
        `select * from approval_assignments
         where tenant_id = $1 and approval_step_id = $2
         order by assigned_at, id
         for update`,
        [principal.tenantId, escalation.approval_step_id],
      )
      const stepResult = await client.query<ApprovalStepRow>(
        `select * from approval_steps where tenant_id = $1 and id = $2 for update`,
        [principal.tenantId, escalation.approval_step_id],
      )
      const step = stepResult.rows[0]
      const instance = step
        ? await loadApprovalInstance(client, principal.tenantId, escalation.approval_instance_id, true)
        : null
      if (!step || !instance || step.status !== 'pending' || !['pending', 'in_progress'].includes(instance.status)) {
        await completeApprovalEscalation(client, principal.tenantId, escalation.id, 'cancelled', {
          reason: 'approval_already_closed',
        })
        await client.query('release savepoint approval_escalation_processing')
        return escalationResult(escalation, 'cancelled', 'closed')
      }

      if (escalation.escalation_type === 'reminder') {
        const assignment = assignments.rows.find((row) => (
          row.status === 'pending' && row.assignee_user_id === escalation.target_user_id
        ))
        if (!assignment?.assignee_user_id) {
          await completeApprovalEscalation(client, principal.tenantId, escalation.id, 'cancelled', {
            reason: 'assignment_no_longer_pending',
          })
          await client.query('release savepoint approval_escalation_processing')
          return escalationResult(escalation, 'cancelled', 'reminder')
        }
        await insertApprovalNotification(client, {
          tenantId: principal.tenantId,
          recipientUserId: assignment.assignee_user_id,
          instanceId: instance.id,
          stepId: step.id,
          sourceEscalationId: escalation.id,
          type: 'reminder',
          title: 'Prazo de aprovacao se aproximando',
          message: 'Existe uma solicitacao pendente que requer sua decisao.',
          payload: { dueAt: optionalIso(step.due_at), assignmentId: assignment.id },
        })
        await insertApprovalEvent(client, principal, instance.id, step.id, 'sla_reminder_sent', {
          escalationId: escalation.id,
          targetUserId: assignment.assignee_user_id,
          dueAt: optionalIso(step.due_at),
        })
        await completeApprovalEscalation(client, principal.tenantId, escalation.id, 'executed', {
          action: 'reminder',
          targetUserId: assignment.assignee_user_id,
        })
        await client.query('release savepoint approval_escalation_processing')
        return escalationResult(escalation, 'executed', 'reminder')
      }

      const rawConfiguration = asRecord(escalation.configuration)
      const action = resolveSlaExpirationAction(escalation, rawConfiguration)
      const configuration = approvalSlaRuntimeConfigurationSchema.parse(rawConfiguration)
      await processApprovalExpirationAction(
        client,
        principal,
        escalation,
        instance,
        step,
        assignments.rows,
        action,
        configuration,
        typeof rawConfiguration.passiveApprovalJustification === 'string'
          ? rawConfiguration.passiveApprovalJustification
          : null,
      )
      await completeApprovalEscalation(client, principal.tenantId, escalation.id, 'executed', { action })
      await client.query('release savepoint approval_escalation_processing')
      return escalationResult(escalation, 'executed', action)
    } catch (error) {
      await client.query('rollback to savepoint approval_escalation_processing')
      const code = approvalErrorCode(error)
      await completeApprovalEscalation(client, principal.tenantId, escalation.id, 'failed', {
        code,
        message: approvalErrorMessage(error),
      })
      if (escalation.escalation_type !== 'reminder') {
        await failApprovalOnSlaError(client, principal, escalation, code)
      }
      await client.query('release savepoint approval_escalation_processing')
      return { ...escalationResult(escalation, 'failed', escalation.escalation_type), code }
    }
  })
}

async function processApprovalExpirationAction(
  client: PoolClient,
  principal: RequestPrincipal,
  escalation: ApprovalEscalationRow,
  instance: ApprovalInstanceRow,
  step: ApprovalStepRow,
  assignments: ApprovalAssignmentRow[],
  action: ApprovalSlaExpirationAction,
  configuration: ReturnType<typeof approvalSlaRuntimeConfigurationSchema.parse>,
  passiveApprovalJustification: string | null,
): Promise<void> {
  if (action === 'expire') {
    await expireApprovalStep(client, principal, escalation, instance, step, assignments)
    return
  }
  if (action === 'notify') {
    await notifyPendingApprovers(client, principal, escalation, instance, step, assignments, configuration)
    return
  }
  if (action === 'passive_approve') {
    if (!passiveApprovalJustification || passiveApprovalJustification.trim().length < 10) {
      throw new ApprovalServiceError('PASSIVE_APPROVAL_JUSTIFICATION_REQUIRED', 'Aprovacao passiva sem justificativa empresarial valida.', 409)
    }
    await passivelyApproveStep(
      client,
      principal,
      escalation,
      instance,
      step,
      assignments,
      passiveApprovalJustification.trim(),
    )
    return
  }
  await escalateApprovalStep(client, principal, escalation, instance, step, assignments, action, configuration)
}

async function notifyPendingApprovers(
  client: PoolClient,
  principal: RequestPrincipal,
  escalation: ApprovalEscalationRow,
  instance: ApprovalInstanceRow,
  step: ApprovalStepRow,
  assignments: ApprovalAssignmentRow[],
  configuration: ReturnType<typeof approvalSlaRuntimeConfigurationSchema.parse>,
): Promise<void> {
  const recipients = uniqueStrings(assignments
    .filter((assignment) => assignment.status === 'pending' && assignment.assignee_user_id)
    .map((assignment) => assignment.assignee_user_id as string))
  if (!recipients.length) throw new ApprovalServiceError('APPROVAL_NOTIFICATION_RECIPIENT_REQUIRED', 'Etapa vencida sem destinatario ativo.', 409)
  for (const userId of recipients) {
    await insertApprovalNotification(client, {
      tenantId: principal.tenantId,
      recipientUserId: userId,
      instanceId: instance.id,
      stepId: step.id,
      sourceEscalationId: escalation.id,
      type: 'expiration',
      title: configuration.notificationTitle || 'Prazo de aprovacao vencido',
      message: configuration.notificationMessage || 'A solicitacao permanece pendente e requer tratamento imediato.',
      payload: { dueAt: optionalIso(step.due_at), action: 'notify' },
    })
  }
  await insertApprovalEvent(client, principal, instance.id, step.id, 'sla_expiration_notified', {
    escalationId: escalation.id,
    recipients,
    dueAt: optionalIso(step.due_at),
  })
}

async function expireApprovalStep(
  client: PoolClient,
  principal: RequestPrincipal,
  escalation: ApprovalEscalationRow,
  instance: ApprovalInstanceRow,
  step: ApprovalStepRow,
  assignments: ApprovalAssignmentRow[],
): Promise<void> {
  const recipients = uniqueStrings(assignments
    .filter((assignment) => assignment.status === 'pending' && assignment.assignee_user_id)
    .map((assignment) => assignment.assignee_user_id as string))
  await client.query(
    `update approval_assignments set status = 'expired', responded_at = now()
     where tenant_id = $1 and approval_step_id = $2 and status = 'pending'`,
    [principal.tenantId, step.id],
  )
  await client.query(
    `update approval_steps set status = 'expired', completed_at = now(), version = version + 1
     where tenant_id = $1 and id = $2 and status = 'pending'`,
    [principal.tenantId, step.id],
  )
  await client.query(
    `update approval_instances set status = 'expired', completed_at = now(), version = version + 1
     where tenant_id = $1 and id = $2 and status in ('pending', 'in_progress')`,
    [principal.tenantId, instance.id],
  )
  await client.query(
    `update approval_escalations set status = 'cancelled',
            result = jsonb_build_object('reason', 'instance_expired')
     where tenant_id = $1 and approval_instance_id = $2 and id <> $3 and status = 'scheduled'`,
    [principal.tenantId, instance.id, escalation.id],
  )
  for (const userId of recipients) {
    await insertApprovalNotification(client, {
      tenantId: principal.tenantId,
      recipientUserId: userId,
      instanceId: instance.id,
      stepId: step.id,
      sourceEscalationId: escalation.id,
      type: 'expiration',
      title: 'Solicitacao expirada',
      message: 'O prazo de decisao terminou e a solicitacao foi expirada.',
      payload: { dueAt: optionalIso(step.due_at), action: 'expire' },
    })
  }
  await insertApprovalEvent(client, principal, instance.id, step.id, 'sla_expired', {
    escalationId: escalation.id,
    dueAt: optionalIso(step.due_at),
  })
}

async function escalateApprovalStep(
  client: PoolClient,
  principal: RequestPrincipal,
  escalation: ApprovalEscalationRow,
  instance: ApprovalInstanceRow,
  step: ApprovalStepRow,
  assignments: ApprovalAssignmentRow[],
  action: 'escalate' | 'reassign',
  configuration: ReturnType<typeof approvalSlaRuntimeConfigurationSchema.parse>,
): Promise<void> {
  const snapshot = approvalWorkflowSnapshotSchema.parse(instance.workflow_snapshot)
  const node = snapshot.nodes.find((candidate) => candidate.id === step.node_id)
  if (!node || node.type !== 'approval' || !node.approvalKind || !node.approverResolution) {
    throw new ApprovalServiceError('APPROVAL_SLA_NODE_INVALID', 'Etapa vencida nao possui configuracao de aprovacao valida.', 409)
  }
  const configuredSelectors = (configuration.escalationSelectors || []) as ApproverSelector[]
  const selectors = configuredSelectors.length
    ? configuredSelectors
    : configuration.targetRoleKey
      ? [{ type: 'role', value: configuration.targetRoleKey } satisfies ApproverSelector]
      : node.approverResolution.fallbackSelectors || []
  if (!selectors.length) {
    throw new ApprovalServiceError('APPROVAL_ESCALATION_TARGET_REQUIRED', 'SLA vencido sem aprovador alternativo configurado.', 409)
  }

  const assignedUserIds = new Set(assignments.map((assignment) => assignment.assignee_user_id).filter(isString))
  const subject = asApprovalSubject(instance.subject_snapshot)
  const candidates = (await loadApprovalCandidates(client, principal, node.approvalKind, subject))
    .filter((candidate) => !assignedUserIds.has(candidate.userId))
  const resolved = resolveApprovers(node.approvalKind, {
    selectors,
    combination: 'first_non_empty',
    minimumApprovers: configuration.minimumApprovers,
    maximumApprovers: configuration.maximumApprovers,
    allowSelfApproval: node.approverResolution.allowSelfApproval,
    separationOfDuties: node.approverResolution.separationOfDuties,
  }, subject, candidates)

  const newAssignments: Array<{ userId: string; delegatedFromUserId: string | null }> = []
  const resolvedUsers = new Set<string>()
  for (const approver of resolved.approvers) {
    const delegated = await resolveDelegatedAssignment(client, principal.tenantId, approver, subject)
    if (assignedUserIds.has(delegated.userId) || resolvedUsers.has(delegated.userId)) continue
    resolvedUsers.add(delegated.userId)
    newAssignments.push({
      userId: delegated.userId,
      delegatedFromUserId: delegated.delegationId ? approver.userId : null,
    })
  }
  if (newAssignments.length < configuration.minimumApprovers) {
    throw new ApprovalServiceError(
      'NO_ESCALATION_APPROVER_AVAILABLE',
      `O SLA exige ${configuration.minimumApprovers} novo(s) aprovador(es), mas apenas ${newAssignments.length} foram resolvidos.`,
      422,
    )
  }

  if (action === 'reassign') {
    await client.query(
      `update approval_assignments set status = 'reassigned', responded_at = now()
       where tenant_id = $1 and approval_step_id = $2 and status = 'pending'`,
      [principal.tenantId, step.id],
    )
  }
  for (const assignment of newAssignments) {
    await client.query(
      `insert into approval_assignments (
         tenant_id, approval_step_id, assignee_user_id, resolution_source,
         source_reference, delegated_from_user_id
       ) values ($1, $2, $3, $4, $5, $6)`,
      [
        principal.tenantId,
        step.id,
        assignment.userId,
        action === 'reassign' ? 'sla_reassignment' : 'sla_escalation',
        escalation.id,
        assignment.delegatedFromUserId,
      ],
    )
    await insertApprovalNotification(client, {
      tenantId: principal.tenantId,
      recipientUserId: assignment.userId,
      instanceId: instance.id,
      stepId: step.id,
      sourceEscalationId: escalation.id,
      type: 'escalation',
      title: configuration.notificationTitle || 'Aprovacao escalonada',
      message: configuration.notificationMessage || 'Uma solicitacao vencida foi direcionada para sua decisao.',
      payload: { action, dueAt: optionalIso(step.due_at) },
    })
  }
  await client.query(
    `update approval_steps set version = version + 1 where tenant_id = $1 and id = $2`,
    [principal.tenantId, step.id],
  )
  await insertApprovalEvent(client, principal, instance.id, step.id, `sla_${action}`, {
    escalationId: escalation.id,
    previousAssignees: [...assignedUserIds],
    newAssignees: newAssignments.map((assignment) => assignment.userId),
    resolution: resolved.explanations,
  })
}

async function passivelyApproveStep(
  client: PoolClient,
  principal: RequestPrincipal,
  escalation: ApprovalEscalationRow,
  instance: ApprovalInstanceRow,
  step: ApprovalStepRow,
  assignments: ApprovalAssignmentRow[],
  justification: string,
): Promise<void> {
  const participants = assignments.filter((assignment) => ['pending', 'approved', 'rejected'].includes(assignment.status))
  const pending = participants.filter((assignment) => assignment.status === 'pending')
  const approvedCount = participants.filter((assignment) => assignment.status === 'approved').length
  let approvalsNeeded = 1
  if (step.completion_mode === 'all') approvalsNeeded = pending.length
  if (step.completion_mode === 'quorum') approvalsNeeded = Math.max(0, (step.quorum || 0) - approvedCount)
  if (['any', 'first'].includes(step.completion_mode) && approvedCount > 0) approvalsNeeded = 0
  if (approvalsNeeded > pending.length) {
    throw new ApprovalServiceError('PASSIVE_APPROVAL_QUORUM_UNREACHABLE', 'Aprovacao passiva nao consegue atender o quorum configurado.', 409)
  }
  const selected = pending.slice(0, approvalsNeeded)
  for (const assignment of selected) {
    await client.query(
      `insert into approval_decisions (
         tenant_id, approval_instance_id, approval_step_id, assignment_id,
         decision, reason, decided_by_user_id, acting_for_user_id,
         idempotency_key, decision_snapshot, decision_source
       ) values ($1, $2, $3, $4, 'approved', $5, null, null, $6, $7::jsonb, 'system_passive')`,
      [
        principal.tenantId,
        instance.id,
        step.id,
        assignment.id,
        justification,
        `sla-passive:${escalation.id}:${assignment.id}`,
        JSON.stringify({ escalationId: escalation.id, systemDecision: true, dueAt: optionalIso(step.due_at) }),
      ],
    )
    await client.query(
      `update approval_assignments set status = 'approved', responded_at = now()
       where tenant_id = $1 and id = $2 and status = 'pending'`,
      [principal.tenantId, assignment.id],
    )
    if (assignment.assignee_user_id) {
      await insertApprovalNotification(client, {
        tenantId: principal.tenantId,
        recipientUserId: assignment.assignee_user_id,
        instanceId: instance.id,
        stepId: step.id,
        sourceEscalationId: escalation.id,
        type: 'decision',
        title: 'Aprovacao passiva registrada',
        message: 'O SLA executou a decisao automatica prevista no workflow.',
        payload: { justification, escalationId: escalation.id },
      })
    }
  }
  await applyApprovalStepOutcome(client, principal, instance, step, 'sla_passive_approval_recorded', {
    escalationId: escalation.id,
    justification,
    assignmentIds: selected.map((assignment) => assignment.id),
  })
}

async function failApprovalOnSlaError(
  client: PoolClient,
  principal: RequestPrincipal,
  escalation: ApprovalEscalationRow,
  code: string,
): Promise<void> {
  await client.query(
    `update approval_assignments set status = 'expired', responded_at = now()
     where tenant_id = $1 and approval_step_id = $2 and status = 'pending'`,
    [principal.tenantId, escalation.approval_step_id],
  )
  await client.query(
    `update approval_steps set status = 'failed', completed_at = now(), version = version + 1
     where tenant_id = $1 and id = $2 and status = 'pending'`,
    [principal.tenantId, escalation.approval_step_id],
  )
  await client.query(
    `update approval_instances set status = 'failed', completed_at = now(), version = version + 1
     where tenant_id = $1 and id = $2 and status in ('pending', 'in_progress')`,
    [principal.tenantId, escalation.approval_instance_id],
  )
  await client.query(
    `update approval_escalations set status = 'cancelled',
            result = jsonb_build_object('reason', 'sla_processing_failed', 'code', $4::text)
     where tenant_id = $1 and approval_instance_id = $2 and id <> $3 and status = 'scheduled'`,
    [principal.tenantId, escalation.approval_instance_id, escalation.id, code],
  )
  await insertApprovalEvent(
    client,
    principal,
    escalation.approval_instance_id,
    escalation.approval_step_id,
    'sla_processing_failed',
    { escalationId: escalation.id, code },
  )
}

async function completeApprovalEscalation(
  client: PoolClient,
  tenantId: string,
  escalationId: string,
  status: 'executed' | 'cancelled' | 'failed',
  result: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `update approval_escalations set status = $3, executed_at = now(), result = $4::jsonb
     where tenant_id = $1 and id = $2 and status = 'scheduled'`,
    [tenantId, escalationId, status, JSON.stringify(result)],
  )
}

function resolveSlaExpirationAction(
  escalation: ApprovalEscalationRow,
  configuration: Record<string, unknown>,
): ApprovalSlaExpirationAction {
  if (escalation.escalation_type === 'reassign') return 'reassign'
  if (['manager', 'fallback'].includes(escalation.escalation_type)) return 'escalate'
  if (escalation.escalation_type === 'incident') return 'notify'
  const action = configuration.action
  if (['escalate', 'reassign', 'expire', 'notify', 'passive_approve'].includes(String(action))) {
    return action as ApprovalSlaExpirationAction
  }
  throw new ApprovalServiceError('APPROVAL_SLA_ACTION_INVALID', 'Acao de vencimento do SLA invalida.', 409)
}

function escalationResult(
  escalation: ApprovalEscalationRow,
  status: 'executed' | 'cancelled' | 'failed',
  action: string,
): ApprovalMaintenanceResult['items'][number] {
  return {
    escalationId: escalation.id,
    instanceId: escalation.approval_instance_id,
    stepId: escalation.approval_step_id,
    status,
    action,
  }
}

function approvalErrorCode(error: unknown): string {
  if (error instanceof ApprovalWorkflowError) return error.code
  return 'APPROVAL_SLA_PROCESSING_FAILED'
}

function approvalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Falha desconhecida no processamento do SLA.'
}

async function loadMembershipCandidate(client: PoolClient, tenantId: string, membershipId: string): Promise<MembershipCandidateRow> {
  const result = await client.query<MembershipCandidateRow>(
    `select membership.id as membership_id, membership.user_id,
            membership.status as membership_status, membership.profile_key,
            role_row.role_key, user_row.platform_admin, membership.company_id,
            membership.allowed_company_ids, membership.allowed_group_ids,
            coalesce((
              select jsonb_object_agg(role_permission.permission_key, role_permission.allowed)
              from role_permissions role_permission where role_permission.role_id = role_row.id
            ), '{}'::jsonb) || membership.custom_permissions as permissions,
            user_row.metadata as user_metadata
     from tenant_memberships membership
     join users user_row on user_row.id = membership.user_id and user_row.deleted_at is null
     join roles role_row on role_row.id = membership.role_id
     where membership.tenant_id = $1 and membership.id = $2 and membership.status = 'active'`,
    [tenantId, membershipId],
  )
  if (!result.rows[0]) throw new ApprovalServiceError('MEMBERSHIP_NOT_FOUND', 'Vinculo do usuario nao encontrado.', 404)
  return result.rows[0]
}

async function assertAuthorityScope(client: PoolClient, principal: RequestPrincipal, input: ApprovalAuthorityInput): Promise<string | null> {
  if (!input.companyId && !input.groupId && !input.costCenterId && !input.projectId) {
    if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
      throw new ApprovalServiceError('TENANT_APPROVAL_AUTHORITY_DENIED', 'Somente administrador do tenant pode criar alcada global.', 403)
    }
    return null
  }
  if (input.companyId) {
    await requireCompanyAccess(principal, input.companyId, 'gerenciar_workflows')
    await assertDatabaseEntity(client, principal.tenantId, 'companies', input.companyId)
    return input.companyId
  }
  if (input.groupId) {
    await requireGroupAccess(principal, input.groupId, 'gerenciar_workflows')
    await assertDatabaseEntity(client, principal.tenantId, 'business_groups', input.groupId)
    return null
  }
  const table = input.costCenterId ? 'cost_centers' : 'projects'
  const id = input.costCenterId || input.projectId as string
  const result = await client.query<{ company_id: string }>(
    `select company_id from ${table} where tenant_id = $1 and id = $2 and deleted_at is null`,
    [principal.tenantId, id],
  )
  if (!result.rows[0]) throw new ApprovalServiceError('APPROVAL_AUTHORITY_SCOPE_NOT_FOUND', 'Escopo da alcada nao encontrado.', 404)
  await requireCompanyAccess(principal, result.rows[0].company_id, 'gerenciar_workflows')
  return result.rows[0].company_id
}

async function assertAuthorityCanBeGranted(client: PoolClient, principal: RequestPrincipal, input: ApprovalAuthorityInput): Promise<void> {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return
  const result = await client.query<AuthorityRow>(
    `select * from approval_authorities
     where tenant_id = $1 and membership_id = $2 and approval_kind = $3
       and status in ('active', 'scheduled') and valid_from <= now()
       and (valid_until is null or valid_until > now())
       and company_id is not distinct from $4
       and group_id is not distinct from $5
       and cost_center_id is not distinct from $6
       and project_id is not distinct from $7
     order by max_amount desc nulls first limit 1`,
    [
      principal.tenantId, principal.membershipId, input.approvalKind,
      input.companyId || null, input.groupId || null, input.costCenterId || null, input.projectId || null,
    ],
  )
  const actor = result.rows[0]
  if (!actor) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', 'A alcada concedida excede a alcada do administrador.', 403)
  }
  assertGrantedLimit(input.maxAmount, actor.max_amount)
  assertGrantedLimit(input.accumulatedAmountLimit, actor.accumulated_amount_limit)
  assertGrantedLimit(input.maxPercentageAboveLowest, actor.max_percentage_above_lowest)
  assertGrantedLimit(input.maxPercentageAboveAverage, actor.max_percentage_above_average)
  if (input.accumulationPeriodDays && actor.accumulation_period_days && input.accumulationPeriodDays > actor.accumulation_period_days) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', 'O periodo acumulado concedido excede a alcada do administrador.', 403)
  }
  if (input.requiresBudgetAvailable === false && actor.requires_budget_available) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', 'Nao e permitido remover a exigencia de orcamento da alcada concedida.', 403)
  }
  if (input.urgentAllowed && !actor.urgent_allowed) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', 'A alcada do administrador nao permite operacoes urgentes.', 403)
  }
  if (input.currency && actor.currency && input.currency !== actor.currency) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', 'A moeda concedida nao pertence a alcada do administrador.', 403)
  }
  assertGrantedSubset(input.products, actor.products, 'produtos')
  assertGrantedSubset(input.destinations, actor.destinations, 'destinos')
  assertGrantedSubset(input.riskLevels, actor.risk_levels, 'niveis de risco')
  if (Date.parse(input.validFrom) < Date.parse(iso(actor.valid_from))) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', 'A vigencia concedida comeca antes da alcada do administrador.', 403)
  }
  if (actor.valid_until && (!input.validUntil || Date.parse(input.validUntil) > Date.parse(iso(actor.valid_until)))) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', 'A vigencia concedida termina depois da alcada do administrador.', 403)
  }
}

function assertGrantedLimit(requested: number | null | undefined, actorValue: string | number | null): void {
  if (actorValue === null) return
  const actorLimit = Number(actorValue)
  if (requested === null || requested === undefined || requested > actorLimit) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', 'A alcada concedida excede a alcada do administrador.', 403)
  }
}

function assertGrantedSubset(requested: string[], actorValues: string[], label: string): void {
  if (!actorValues.length) return
  const allowed = new Set(actorValues)
  if (requested.some((value) => !allowed.has(value))) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_ESCALATION', `A alcada concedida contem ${label} nao autorizados.`, 403)
  }
}

async function assertDatabaseEntity(client: PoolClient, tenantId: string, table: 'companies' | 'business_groups', id: string): Promise<void> {
  const result = await client.query(`select 1 from ${table} where tenant_id = $1 and id = $2 and deleted_at is null`, [tenantId, id])
  if (!result.rowCount) throw new ApprovalServiceError('APPROVAL_SCOPE_NOT_FOUND', 'Escopo de aprovacao nao encontrado.', 404)
}

async function loadPublishedWorkflowForCompany(
  client: PoolClient,
  tenantId: string,
  input: CreateApprovalInstanceInput,
  groupId: string | null,
): Promise<{ definition: WorkflowDefinitionRow; version: WorkflowVersionRow }> {
  const values: unknown[] = [tenantId]
  const selector = input.workflowDefinitionId
    ? (values.push(input.workflowDefinitionId), `definition.id = $${values.length}`)
    : (values.push(input.workflowCode), `definition.workflow_code = $${values.length}`)
  const result = await client.query<WorkflowDefinitionRow & WorkflowVersionRow>(
    `select definition.id, definition.workflow_code, definition.name, definition.description,
            definition.workflow_type, definition.status, definition.current_version,
            definition.created_by, definition.created_at, definition.updated_at,
            version.id as version_id, version.workflow_definition_id, version.version_number,
            version.status as version_status, version.graph_snapshot, version.content_hash,
            version.change_summary, version.valid_from, version.valid_until,
            version.created_by as version_created_by, version.approved_by, version.approved_at,
            version.published_by, version.published_at, version.created_at as version_created_at,
            version.updated_at as version_updated_at
     from approval_workflow_definitions definition
     join approval_workflow_versions version
       on version.tenant_id = definition.tenant_id and version.workflow_definition_id = definition.id
     where definition.tenant_id = $1 and ${selector}
       and version.status = 'published'
       and (version.valid_from is null or version.valid_from <= now())
       and (version.valid_until is null or version.valid_until > now())
     order by version.version_number desc`,
    values,
  )
  for (const row of result.rows) {
    const version = remapJoinedWorkflowVersion(row)
    const scopes = await loadWorkflowScopes(client, tenantId, version.id)
    if (workflowScopesApply(scopes, input.companyId, groupId)) {
      return { definition: row, version }
    }
  }
  throw new ApprovalServiceError('PUBLISHED_WORKFLOW_NOT_FOUND', 'Nenhum workflow publicado se aplica a empresa informada.', 422)
}

function remapJoinedWorkflowVersion(row: WorkflowDefinitionRow & WorkflowVersionRow & Record<string, unknown>): WorkflowVersionRow {
  return {
    id: String(row.version_id),
    workflow_definition_id: row.workflow_definition_id,
    version_number: row.version_number,
    status: row.version_status as GovernanceStatus,
    graph_snapshot: row.graph_snapshot,
    content_hash: row.content_hash,
    change_summary: row.change_summary,
    valid_from: row.valid_from,
    valid_until: row.valid_until,
    created_by: String(row.version_created_by),
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    published_by: row.published_by,
    published_at: row.published_at,
    created_at: row.version_created_at as string | Date,
    updated_at: row.version_updated_at as string | Date,
  }
}

function workflowScopesApply(scopes: WorkflowScope[], companyId: string, groupId: string | null): boolean {
  const matches = (scope: WorkflowScope) => (
    scope.type === 'tenant'
    || (scope.type === 'company' && scope.id === companyId)
    || (scope.type === 'group' && scope.id === groupId)
  )
  const included = scopes.filter((scope) => scope.mode === 'include' && matches(scope))
  const excluded = scopes.filter((scope) => scope.mode === 'exclude' && matches(scope))
  if (!included.length) return false
  const strongestInclude = Math.max(...included.map((scope) => scope.specificity))
  const strongestExclude = excluded.length ? Math.max(...excluded.map((scope) => scope.specificity)) : -1
  return strongestInclude > strongestExclude
}

async function assertRequesterCanCreateApprovalInstance(
  client: PoolClient,
  principal: RequestPrincipal,
  input: CreateApprovalInstanceInput,
): Promise<void> {
  if (approvalVisibilityMode({
    roleKey: principal.roleKey,
    corporateProfile: principal.user.corporate_profile,
  }) !== 'own_demands') return

  if (!input.demandId) {
    throw new ApprovalServiceError(
      'APPROVAL_REQUESTER_DEMAND_REQUIRED',
      'A aprovacao do solicitante precisa estar vinculada a uma demanda propria.',
      403,
    )
  }
  const ownership = await client.query(
    `select 1
     from demands requester_demand
     join requesters requester_identity
       on requester_identity.tenant_id = requester_demand.tenant_id
       and requester_identity.id = requester_demand.requester_id
     where requester_demand.tenant_id = $1
       and requester_demand.id = $2
       and requester_demand.company_id = $3
       and requester_demand.deleted_at is null
       and requester_identity.user_id = $4::uuid
       and requester_identity.status = 'active'
       and requester_identity.deleted_at is null
     limit 1`,
    [principal.tenantId, input.demandId, input.companyId, principal.user.id],
  )
  if (!ownership.rowCount) {
    throw new ApprovalServiceError(
      'APPROVAL_REQUESTER_DEMAND_ACCESS_DENIED',
      'A demanda informada nao pertence ao solicitante autenticado.',
      403,
    )
  }
}

async function validateApprovalEntityOwnership(
  client: PoolClient,
  tenantId: string,
  input: CreateApprovalInstanceInput,
): Promise<void> {
  if (input.demandId) await assertEntityCompany(client, 'demands', input.demandId, input.companyId, tenantId)
  if (input.reservationId) await assertEntityCompany(client, 'reservations', input.reservationId, input.companyId, tenantId)
  if (input.employeeId) await assertEntityCompany(client, 'employees', input.employeeId, input.companyId, tenantId)
  const subjectCostCenterId = typeof input.subject.costCenterId === 'string'
    ? input.subject.costCenterId
    : null
  if (subjectCostCenterId) {
    await assertEntityCompany(client, 'cost_centers', subjectCostCenterId, input.companyId, tenantId)
  }
}

async function assertEntityCompany(
  client: PoolClient,
  table: 'demands' | 'reservations' | 'employees' | 'cost_centers',
  id: string,
  companyId: string,
  tenantId: string,
): Promise<void> {
  // Reservations use terminal status/versioning and intentionally do not have
  // the soft-delete column shared by the other approval-owned entities.
  const activeEntityPredicate = table === 'reservations' ? '' : 'and deleted_at is null'
  const result = await client.query(
    `select 1 from ${table}
     where tenant_id = $1 and id = $2 and company_id = $3 ${activeEntityPredicate}`,
    [tenantId, id, companyId],
  )
  if (!result.rowCount) throw new ApprovalServiceError('APPROVAL_ENTITY_SCOPE_MISMATCH', 'Entidade nao pertence a empresa informada.', 409)
}

async function loadCompanyContext(client: PoolClient, tenantId: string, companyId: string): Promise<{ groupId: string | null }> {
  const result = await client.query<{ group_id: string | null }>(
    `select group_id from companies where tenant_id = $1 and id = $2 and deleted_at is null`,
    [tenantId, companyId],
  )
  if (!result.rows[0]) throw new ApprovalServiceError('COMPANY_NOT_FOUND', 'Empresa nao encontrada.', 404)
  return { groupId: result.rows[0].group_id }
}

async function activateWorkflowNodes(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
  snapshot: ApprovalWorkflowSnapshot,
  nodes: ApprovalWorkflowNode[],
): Promise<void> {
  let reachedEnd = false
  for (const node of nodes) {
    if (node.type === 'end') {
      reachedEnd = true
      continue
    }
    if (node.type !== 'approval' || !node.approvalKind || !node.completionMode || !node.approverResolution) continue
    if (!(await workflowNodePrerequisitesSatisfied(client, principal.tenantId, instance.id, snapshot, node.id))) continue
    const existingCount = await client.query<{ total: string }>(
      `select count(*)::text as total from approval_steps
       where tenant_id = $1 and approval_instance_id = $2`,
      [principal.tenantId, instance.id],
    )
    const stepId = randomUUID()
    const sla = await calculateNodeSla(client, principal.tenantId, instance.workflow_version_id, node.id, new Date().toISOString())
    const inserted = await client.query<{ id: string }>(
      `insert into approval_steps (
         id, tenant_id, approval_instance_id, node_id, step_number, status,
         completion_mode, quorum, due_at, activated_at
       ) values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, now())
       on conflict (tenant_id, approval_instance_id, node_id) do nothing
       returning id`,
      [
        stepId, principal.tenantId, instance.id, node.id,
        Number(existingCount.rows[0]?.total || 0) + 1, node.completionMode,
        node.quorum || null, sla?.dueAt || null,
      ],
    )
    if (!inserted.rowCount) continue
    const subject = asApprovalSubject(instance.subject_snapshot)
    const candidates = await loadApprovalCandidates(client, principal, node.approvalKind, subject)
    const resolved = resolveApprovers(node.approvalKind, node.approverResolution, subject, candidates)
    for (const approver of resolved.approvers) {
      const delegated = await resolveDelegatedAssignment(client, principal.tenantId, approver, subject)
      await client.query(
        `insert into approval_assignments (
           tenant_id, approval_step_id, assignee_user_id, resolution_source,
           source_reference, delegated_from_user_id
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          principal.tenantId, stepId, delegated.userId,
          delegated.delegationId ? 'delegation' : approver.source,
          delegated.delegationId || approver.explanation,
          delegated.delegationId ? approver.userId : null,
        ],
      )
      await insertApprovalNotification(client, {
        tenantId: principal.tenantId,
        recipientUserId: delegated.userId,
        instanceId: instance.id,
        stepId,
        sourceEscalationId: null,
        type: 'assignment',
        title: `Nova aprovacao: ${node.name}`,
        message: 'Uma nova solicitacao aguarda sua decisao.',
        payload: { nodeId: node.id, approvalKind: node.approvalKind },
      })
      for (const reminderAt of sla?.reminderAt || []) {
        await client.query(
          `insert into approval_escalations (
             tenant_id, approval_instance_id, approval_step_id, escalation_type,
             target_user_id, status, scheduled_at
           ) values ($1, $2, $3, 'reminder', $4, 'scheduled', $5)
           on conflict do nothing`,
          [principal.tenantId, instance.id, stepId, delegated.userId, reminderAt],
        )
      }
    }
    if (sla) {
      await client.query(
        `insert into approval_escalations (
           tenant_id, approval_instance_id, approval_step_id, escalation_type,
           status, scheduled_at, configuration
         ) values ($1, $2, $3, 'expiration', 'scheduled', $4, $5::jsonb)
         on conflict do nothing`,
        [
          principal.tenantId,
          instance.id,
          stepId,
          sla.dueAt,
          JSON.stringify({
            action: sla.expirationAction,
            passiveApprovalJustification: sla.passiveApprovalJustification,
            ...sla.configuration,
          }),
        ],
      )
    }
    await insertApprovalEvent(client, principal, instance.id, stepId, 'step_activated', {
      nodeId: node.id,
      approverCount: resolved.approvers.length,
      dueAt: sla?.dueAt || null,
      resolution: resolved.explanations,
    })
  }
  if (reachedEnd) await maybeCompleteApprovalInstance(client, principal, instance)
}

async function workflowNodePrerequisitesSatisfied(
  client: PoolClient,
  tenantId: string,
  instanceId: string,
  snapshot: ApprovalWorkflowSnapshot,
  targetNodeId: string,
): Promise<boolean> {
  const incomingApprovalNodeIds = snapshot.edges
    .filter((edge) => edge.targetNodeId === targetNodeId)
    .map((edge) => snapshot.nodes.find((node) => node.id === edge.sourceNodeId))
    .filter((node): node is ApprovalWorkflowNode => node?.type === 'approval')
    .map((node) => node.id)
  if (!incomingApprovalNodeIds.length) return true
  const result = await client.query<{ node_id: string; status: string }>(
    `select node_id, status from approval_steps
     where tenant_id = $1 and approval_instance_id = $2 and node_id = any($3::uuid[])`,
    [tenantId, instanceId, incomingApprovalNodeIds],
  )
  return result.rows.length === incomingApprovalNodeIds.length && result.rows.every((row) => row.status === 'approved')
}

async function maybeCompleteApprovalInstance(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
): Promise<void> {
  const pending = await client.query(
    `select 1 from approval_steps
     where tenant_id = $1 and approval_instance_id = $2 and status in ('waiting', 'pending') limit 1`,
    [principal.tenantId, instance.id],
  )
  if (pending.rowCount) return
  const completed = await client.query(
    `update approval_instances set status = 'approved', completed_at = now(), version = version + 1
     where tenant_id = $1 and id = $2 and status in ('pending', 'in_progress')`,
    [principal.tenantId, instance.id],
  )
  if (!completed.rowCount) return
  await insertApprovalEvent(client, principal, instance.id, null, 'instance_approved', {})
  await reconcileApprovedQuoteSelection(client, principal, instance)
}

async function reconcileApprovedQuoteSelection(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
): Promise<void> {
  if (instance.instance_type !== 'cost' || !instance.demand_id) return

  const selectionResult = await client.query<ApprovedQuoteSelectionProjectionRow>(
    `select selection.id as selection_id, selection.status as selection_status,
            selection.snapshot_hash, selection.quote_id, selection.option_id,
            demand.id as demand_id, demand.company_id, demand.lifecycle_status,
            demand.lifecycle_version, demand.last_policy_evaluation_id,
            demand.active_approval_instance_id
     from travel_quote_selections selection
     join demands demand
       on demand.tenant_id = selection.tenant_id and demand.id = selection.demand_id
     where selection.tenant_id = $1 and selection.approval_instance_id = $2
       and selection.status in ('pending_approval', 'approved')
     order by selection.chosen_at desc
     limit 1
     for update of selection, demand`,
    [principal.tenantId, instance.id],
  )
  const projection = selectionResult.rows[0]
  if (!projection) return
  if (projection.demand_id !== instance.demand_id) {
    throw new ApprovalServiceError(
      'APPROVAL_QUOTE_SELECTION_SCOPE_MISMATCH',
      'A escolha vinculada a aprovacao nao pertence a demanda aprovada.',
      409,
    )
  }
  if (
    projection.active_approval_instance_id
    && projection.active_approval_instance_id !== instance.id
  ) {
    throw new ApprovalServiceError(
      'APPROVAL_QUOTE_SELECTION_SUPERSEDED',
      'A demanda possui outra aprovacao ativa e nao pode concluir esta escolha.',
      409,
    )
  }

  if (projection.lifecycle_status === 'pending_cost_approval') {
    if (!projection.last_policy_evaluation_id) {
      throw new ApprovalServiceError(
        'APPROVAL_QUOTE_SELECTION_POLICY_MISSING',
        'A escolha aprovada nao possui a avaliacao de politica que originou a decisao.',
        409,
      )
    }
    const policyResult = await client.query<{
      passed: boolean
      has_blocks: boolean
      result: Record<string, unknown>
    }>(
      `select passed, has_blocks, result
       from policy_evaluations
       where tenant_id = $1 and id = $2 and demand_id = $3`,
      [principal.tenantId, projection.last_policy_evaluation_id, projection.demand_id],
    )
    const policy = policyResult.rows[0]
    if (!policy || !policy.passed || policy.has_blocks) {
      throw new ApprovalServiceError(
        'APPROVAL_QUOTE_SELECTION_POLICY_INVALID',
        'A avaliacao de politica da escolha aprovada nao esta valida.',
        409,
      )
    }
    const requiredActions = Array.isArray(asRecord(policy.result).requiredActions)
      ? asRecord(policy.result).requiredActions as unknown[]
      : []
    const budgetSatisfied = !requiredActions.some((item) => (
      asRecord(item).action === 'require_budget'
    ))

    // Quando a politica exige orcamento, a escolha fica aprovada, mas o
    // lifecycle somente avanca durante a reserva, depois da validacao do saldo.
    if (budgetSatisfied) {
      const current: TravelLifecycleRecord = {
        demandId: projection.demand_id,
        companyId: projection.company_id,
        status: projection.lifecycle_status as TravelLifecycleStatus,
        version: Number(projection.lifecycle_version),
        lastPolicyEvaluationId: projection.last_policy_evaluation_id,
        activeApprovalInstanceId: projection.active_approval_instance_id,
      }
      await persistTravelTransitionInTransaction(client, principal, current, 'approve_cost', {
        idempotencyKey: `approval:${instance.id}:quote-selection:approve-cost`,
        requirements: {
          policyEvaluationId: projection.last_policy_evaluation_id,
          policyPassed: true,
          policyHasBlocks: false,
          approvalInstanceId: instance.id,
          approvalsSatisfied: true,
          budgetSatisfied: true,
          offerSelected: true,
        },
        metadata: {
          channel: 'offline',
          source: 'approval_decision',
          selectionId: projection.selection_id,
          quoteId: projection.quote_id,
          quoteOptionId: projection.option_id,
          snapshotHash: projection.snapshot_hash,
          approvalInstanceId: instance.id,
        },
      })
    }
  } else if (projection.lifecycle_status !== 'approved') {
    throw new ApprovalServiceError(
      'APPROVAL_QUOTE_SELECTION_STATE_CONFLICT',
      `A demanda esta no estado ${projection.lifecycle_status} e nao pode concluir a escolha aprovada.`,
      409,
    )
  }

  await client.query(
    `update travel_quote_selections
     set status = 'approved', version = version + 1
     where tenant_id = $1 and id = $2 and status = 'pending_approval'`,
    [principal.tenantId, projection.selection_id],
  )
  await client.query(
    `insert into audit_logs (
       tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
     ) values ($1, $2, 'travel.quote.selection.approved', 'travel_quote_selection', $3, 'success', $4::jsonb)`,
    [
      principal.tenantId,
      principal.user.id,
      projection.selection_id,
      JSON.stringify({
        demandId: projection.demand_id,
        quoteId: projection.quote_id,
        quoteOptionId: projection.option_id,
        snapshotHash: projection.snapshot_hash,
        approvalInstanceId: instance.id,
      }),
    ],
  )
}

async function rejectApprovalInstance(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
  stepId: string,
  explanation: string,
): Promise<void> {
  await client.query(
    `update approval_instances set status = 'rejected', completed_at = now(), version = version + 1
     where tenant_id = $1 and id = $2`,
    [principal.tenantId, instance.id],
  )
  await client.query(
    `update approval_steps set status = 'cancelled', completed_at = now(), version = version + 1
     where tenant_id = $1 and approval_instance_id = $2 and id <> $3 and status in ('waiting', 'pending')`,
    [principal.tenantId, instance.id, stepId],
  )
  await client.query(
    `update approval_assignments assignment set status = 'cancelled', responded_at = now()
     from approval_steps step
     where assignment.tenant_id = $1 and step.tenant_id = assignment.tenant_id
       and step.id = assignment.approval_step_id and step.approval_instance_id = $2
       and assignment.status = 'pending'`,
    [principal.tenantId, instance.id],
  )
  await client.query(
    `update approval_escalations set status = 'cancelled',
            result = jsonb_build_object('reason', 'instance_rejected')
     where tenant_id = $1 and approval_instance_id = $2 and status = 'scheduled'`,
    [principal.tenantId, instance.id],
  )
  await insertApprovalEvent(client, principal, instance.id, stepId, 'instance_rejected', { explanation })
}

async function calculateNodeSla(
  client: PoolClient,
  tenantId: string,
  workflowVersionId: string,
  nodeId: string,
  startedAt: string,
): Promise<{
  dueAt: string
  reminderAt: string[]
  expirationAction: ApprovalSlaExpirationAction
  passiveApprovalJustification: string | null
  configuration: Record<string, unknown>
} | null> {
  const result = await client.query<{
    duration_minutes: number
    business_time_only: boolean
    reminder_minutes: number[]
    calendar_id: string | null
    expiration_action: ApprovalSlaExpirationAction
    passive_approval_justification: string | null
    configuration: unknown
  }>(
    `select duration_minutes, business_time_only, reminder_minutes, calendar_id,
            expiration_action, passive_approval_justification, configuration
     from approval_slas where tenant_id = $1 and workflow_version_id = $2
       and (node_id = $3 or node_id is null)
     order by case when node_id = $3 then 0 else 1 end, id limit 1`,
    [tenantId, workflowVersionId, nodeId],
  )
  const sla = result.rows[0]
  if (!sla) return null
  const configuration = approvalSlaRuntimeConfigurationSchema.parse(sla.configuration)
  if (!sla.business_time_only) {
    const dueAt = new Date(Date.parse(startedAt) + sla.duration_minutes * 60_000).toISOString()
    return {
      dueAt,
      reminderAt: uniqueNumbers(sla.reminder_minutes)
        .filter((minutes) => minutes < sla.duration_minutes)
        .map((minutes) => new Date(Date.parse(dueAt) - minutes * 60_000).toISOString()),
      expirationAction: sla.expiration_action,
      passiveApprovalJustification: sla.passive_approval_justification,
      configuration,
    }
  }
  if (!sla.calendar_id) throw new ApprovalServiceError('APPROVAL_SLA_CALENDAR_REQUIRED', 'SLA em horario util sem calendario configurado.', 409)
  const calendar = await loadBusinessCalendar(client, tenantId, sla.calendar_id)
  const calculated = evaluateApprovalSla(startedAt, sla.duration_minutes, sla.reminder_minutes, calendar, startedAt)
  return {
    dueAt: calculated.dueAt,
    reminderAt: calculated.reminderAt,
    expirationAction: sla.expiration_action,
    passiveApprovalJustification: sla.passive_approval_justification,
    configuration,
  }
}

async function loadBusinessCalendar(client: PoolClient, tenantId: string, calendarId: string): Promise<BusinessCalendarDefinition> {
  const result = await client.query<{
    timezone: string
    working_days: number[]
    workday_start: string
    workday_end: string
  }>(
    `select timezone, working_days, workday_start::text, workday_end::text
     from business_calendars where tenant_id = $1 and id = $2 and status = 'active'`,
    [tenantId, calendarId],
  )
  if (!result.rows[0]) throw new ApprovalServiceError('BUSINESS_CALENDAR_NOT_FOUND', 'Calendario corporativo do SLA nao encontrado.', 409)
  const row = result.rows[0]
  const holidays = await client.query<{ holiday_date: string | Date }>(
    `select holiday_date from calendar_holidays
     where tenant_id = $1 and calendar_id = $2 and partial_day = false`,
    [tenantId, calendarId],
  )
  const weeklySchedule: BusinessCalendarDefinition['weeklySchedule'] = {}
  for (const day of row.working_days) {
    if (day >= 0 && day <= 6) weeklySchedule[day as 0 | 1 | 2 | 3 | 4 | 5 | 6] = [{ start: row.workday_start.slice(0, 5), end: row.workday_end.slice(0, 5) }]
  }
  return {
    timezone: row.timezone,
    weeklySchedule,
    holidays: holidays.rows.map((holiday) => isoDate(holiday.holiday_date)),
  }
}

async function loadApprovalCandidates(
  client: PoolClient,
  principal: RequestPrincipal,
  kind: ApprovalKind,
  subject: ApprovalSubject,
): Promise<ApprovalCandidate[]> {
  const members = await client.query<MembershipCandidateRow>(
    `select membership.id as membership_id, membership.user_id,
            membership.status as membership_status, membership.profile_key,
            role_row.role_key, user_row.platform_admin, membership.company_id,
            membership.allowed_company_ids, membership.allowed_group_ids,
            coalesce((
              select jsonb_object_agg(role_permission.permission_key, role_permission.allowed)
              from role_permissions role_permission where role_permission.role_id = role_row.id
            ), '{}'::jsonb) || membership.custom_permissions as permissions,
            user_row.metadata as user_metadata
     from tenant_memberships membership
     join users user_row on user_row.id = membership.user_id and user_row.status = 'active' and user_row.deleted_at is null
     join roles role_row on role_row.id = membership.role_id
     where membership.tenant_id = $1 and membership.status = 'active'`,
    [principal.tenantId],
  )
  const memberIds = members.rows.map((member) => member.membership_id)
  const authorityRows = memberIds.length
    ? await client.query<AuthorityRow>(
        `select * from approval_authorities
         where tenant_id = $1 and membership_id = any($2::uuid[])
           and approval_kind = $3 and status in ('active', 'scheduled')
           and valid_from <= now() and (valid_until is null or valid_until > now())`,
        [principal.tenantId, memberIds, kind],
      )
    : { rows: [] as AuthorityRow[] }
  const authoritiesByMembership = new Map<string, AuthorityRow[]>()
  authorityRows.rows.forEach((authority) => authoritiesByMembership.set(
    authority.membership_id,
    [...(authoritiesByMembership.get(authority.membership_id) || []), authority],
  ))

  const candidates: ApprovalCandidate[] = []
  for (const member of members.rows) {
    if (member.platform_admin) continue
    const permissions = normalizeMembershipPermissions(member.permissions, member.profile_key)
    if (!permissions.decidir_aprovacoes) continue
    const access = await resolveEffectiveCorporateAccessInTransaction(client, {
      tenantId: principal.tenantId,
      membershipId: member.membership_id,
      roleKey: member.role_key,
      platformAdmin: false,
      membershipPermissions: permissions,
      legacyCompanyId: member.company_id,
      legacyCompanyIds: member.allowed_company_ids || [],
      legacyGroupIds: member.allowed_group_ids || [],
    })
    const accessibleCompanies = access.summary.companies
      .filter((company) => company.permissions.decidir_aprovacoes)
      .map((company) => company.companyId)
    if (!accessibleCompanies.includes(subject.companyId)) continue
    const applicableAuthorities = (authoritiesByMembership.get(member.membership_id) || [])
      .filter((authority) => authorityApplies(authority, subject))
    const baseCandidate: ApprovalCandidate = {
      userId: member.user_id,
      membershipId: member.membership_id,
      tenantId: principal.tenantId,
      active: true,
      roleKeys: [member.role_key, member.profile_key || ''].filter(Boolean),
      jobTitle: metadataString(member.user_metadata, 'jobTitle'),
      level: metadataString(member.user_metadata, 'level'),
      companyIds: accessibleCompanies,
      groupIds: access.summary.groupIds,
      branchIds: metadataStringArray(member.user_metadata, 'branchIds'),
      costCenterIds: [],
      projectIds: [],
      approvalKinds: ALL_APPROVAL_KINDS,
      policyViolationCodes: metadataStringArray(member.user_metadata, 'policyViolationCodes'),
    }
    if (!applicableAuthorities.length) {
      candidates.push({ ...baseCandidate, authorityMatched: false, maxAmount: null })
      continue
    }
    for (const authority of applicableAuthorities) {
      candidates.push({
        ...baseCandidate,
        authorityMatched: true,
        costCenterIds: authority.cost_center_id ? [authority.cost_center_id] : [],
        projectIds: authority.project_id ? [authority.project_id] : [],
        maxAmount: authority.max_amount === null ? null : Number(authority.max_amount),
        accumulatedAmountLimit: authority.accumulated_amount_limit === null ? null : Number(authority.accumulated_amount_limit),
        maxPercentageAboveLowest: authority.max_percentage_above_lowest === null ? null : Number(authority.max_percentage_above_lowest),
        maxPercentageAboveAverage: authority.max_percentage_above_average === null ? null : Number(authority.max_percentage_above_average),
        requiresBudgetAvailable: authority.requires_budget_available,
        urgentAllowed: authority.urgent_allowed,
        currencies: authority.currency ? [authority.currency.toUpperCase()] : [],
        products: uniqueStrings(authority.products || []),
        destinations: uniqueStrings(authority.destinations || []),
        riskLevels: uniqueStrings(authority.risk_levels || []),
      })
    }
  }
  return candidates
}

function authorityApplies(authority: AuthorityRow, subject: ApprovalSubject): boolean {
  if (authority.company_id && authority.company_id !== subject.companyId) return false
  if (authority.group_id && authority.group_id !== subject.groupId) return false
  if (authority.cost_center_id && authority.cost_center_id !== subject.costCenterId) return false
  if (authority.project_id && authority.project_id !== subject.projectId) return false
  return true
}

async function resolveDelegatedAssignment(
  client: PoolClient,
  tenantId: string,
  approver: { userId: string; membershipId: string },
  subject: ApprovalSubject,
): Promise<{ userId: string; membershipId: string; delegationId: string | null }> {
  const result = await client.query<{ delegation_id: string; membership_id: string; user_id: string }>(
    `select delegation.id as delegation_id, delegate.id as membership_id, delegate.user_id
     from approval_delegations delegation
     join tenant_memberships delegate
       on delegate.tenant_id = delegation.tenant_id
       and delegate.id = delegation.delegate_membership_id
       and delegate.status = 'active'
     join users delegate_user
       on delegate_user.id = delegate.user_id and delegate_user.status = 'active'
     where delegation.tenant_id = $1
       and delegation.delegator_membership_id = $2
       and delegation.status in ('active', 'scheduled')
       and delegation.valid_from <= now() and delegation.valid_until > now()
       and exists (
         select 1 from approval_delegation_modules module
         where module.tenant_id = delegation.tenant_id
           and module.delegation_id = delegation.id and module.module_key = 'approvals'
       )
       and (
         exists (
           select 1 from approval_delegation_companies company_scope
           where company_scope.tenant_id = delegation.tenant_id
             and company_scope.delegation_id = delegation.id
             and company_scope.company_id = $3
         )
         or ($4::text is not null and exists (
           select 1 from approval_delegation_groups group_scope
           where group_scope.tenant_id = delegation.tenant_id
             and group_scope.delegation_id = delegation.id
             and group_scope.group_id = $4
         ))
       )
     order by delegation.valid_from desc, delegation.id
     limit 1`,
    [tenantId, approver.membershipId, subject.companyId, subject.groupId || null],
  )
  const delegated = result.rows[0]
  return delegated
    ? { userId: delegated.user_id, membershipId: delegated.membership_id, delegationId: delegated.delegation_id }
    : { userId: approver.userId, membershipId: approver.membershipId, delegationId: null }
}

async function loadApprovalInstance(
  client: PoolClient,
  tenantId: string,
  instanceId: string,
  lock: boolean,
): Promise<ApprovalInstanceRow> {
  const result = await client.query<ApprovalInstanceRow>(
    `select instance.*, coalesce(company.trade_name, company.legal_name) as company_name,
            definition.name as workflow_name,
            demand.demand_number,
            demand.service_type as demand_service_type,
            demand.passenger_name_snapshot as demand_passenger_name,
            demand.travel_start_date as demand_travel_start_date,
            demand.travel_end_date as demand_travel_end_date,
            demand.destination as demand_destination,
            requester.name as requester_name
     from approval_instances instance
     join companies company on company.tenant_id = instance.tenant_id and company.id = instance.company_id
     join approval_workflow_definitions definition
       on definition.tenant_id = instance.tenant_id and definition.id = instance.workflow_definition_id
     left join demands demand
       on demand.tenant_id = instance.tenant_id and demand.id = instance.demand_id
     left join requesters requester
       on requester.tenant_id = demand.tenant_id and requester.id = demand.requester_id
     where instance.tenant_id = $1 and instance.id = $2${lock ? ' for update of instance' : ''}`,
    [tenantId, instanceId],
  )
  if (!result.rows[0]) throw new ApprovalServiceError('APPROVAL_INSTANCE_NOT_FOUND', 'Instancia de aprovacao nao encontrada.', 404)
  return result.rows[0]
}

async function assertCanViewApprovalInstance(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
): Promise<void> {
  if (approvalVisibilityMode({
    roleKey: principal.roleKey,
    corporateProfile: principal.user.corporate_profile,
  }) === 'own_demands') {
    const ownership = await client.query(
      `select 1
       from approval_instances requester_instance
       where requester_instance.tenant_id = $1
         and requester_instance.id = $2
         and ${requesterApprovalOwnershipSql('requester_instance', '$3')}
       limit 1`,
      [principal.tenantId, instance.id, principal.user.id],
    )
    if (ownership.rowCount) return
    throw new ApprovalServiceError('APPROVAL_INSTANCE_ACCESS_DENIED', 'Instancia fora do escopo autorizado.', 403)
  }
  const company = principal.corporateAccess?.companies.find((item) => item.companyId === instance.company_id)
  if (company?.permissions.ver_aprovacoes) return
  const assignment = await client.query(
    `select 1 from approval_steps step
     join approval_assignments assignment
       on assignment.tenant_id = step.tenant_id and assignment.approval_step_id = step.id
     where step.tenant_id = $1 and step.approval_instance_id = $2
       and assignment.assignee_user_id = $3 limit 1`,
    [principal.tenantId, instance.id, principal.user.id],
  )
  if (!assignment.rowCount) throw new ApprovalServiceError('APPROVAL_INSTANCE_ACCESS_DENIED', 'Instancia fora do escopo autorizado.', 403)
}

async function hydrateApprovalInstanceDetail(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
): Promise<ApprovalInstanceDetail> {
  const requesterDetail = approvalVisibilityMode({
    roleKey: principal.roleKey,
    corporateProfile: principal.user.corporate_profile,
  }) === 'own_demands'
  const steps = await client.query<ApprovalStepRow>(
    `select step.*, node.name as node_name, node.approval_kind
     from approval_steps step
     join approval_nodes node on node.tenant_id = step.tenant_id and node.id = step.node_id
     where step.tenant_id = $1 and step.approval_instance_id = $2
     order by step.step_number, step.id`,
    [principal.tenantId, instance.id],
  )
  const stepIds = steps.rows.map((step) => step.id)
  const assignments = stepIds.length
    ? await client.query<ApprovalAssignmentRow>(
        `select assignment.*, user_row.name as assignee_name, user_row.email::text as assignee_email
         from approval_assignments assignment
         left join users user_row on user_row.id = assignment.assignee_user_id
         where assignment.tenant_id = $1 and assignment.approval_step_id = any($2::uuid[])
         order by assignment.assigned_at, assignment.id`,
        [principal.tenantId, stepIds],
      )
    : { rows: [] as ApprovalAssignmentRow[] }
  const decisions = requesterDetail
    ? { rows: [] as QueryResultRow[] }
    : await client.query<QueryResultRow>(
        `select id, approval_step_id as "stepId", assignment_id as "assignmentId",
                decision, reason, decided_by_user_id as "decidedByUserId",
                acting_for_user_id as "actingForUserId", decided_at as "decidedAt"
         from approval_decisions where tenant_id = $1 and approval_instance_id = $2
         order by decided_at, id`,
        [principal.tenantId, instance.id],
      )
  const events = requesterDetail
    ? { rows: [] as QueryResultRow[] }
    : await client.query<QueryResultRow>(
        `select id, approval_step_id as "stepId", event_type as "type",
                actor_user_id as "actorUserId", payload, created_at as "createdAt"
         from approval_events where tenant_id = $1 and approval_instance_id = $2
         order by created_at, id`,
        [principal.tenantId, instance.id],
      )
  const pendingSteps = steps.rows.filter((step) => step.status === 'pending').length
  const overdueSteps = steps.rows.filter((step) => step.status === 'pending' && step.due_at && Date.parse(iso(step.due_at)) < Date.now()).length
  const assignedToMe = assignments.rows.some((assignment) => assignment.assignee_user_id === principal.user.id && assignment.status === 'pending')
  const summary = mapApprovalInstanceSummary({
    ...instance,
    pending_steps: String(pendingSteps),
    overdue_steps: String(overdueSteps),
    assigned_to_me: assignedToMe,
  })
  const subject = asApprovalSubject(instance.subject_snapshot)
  if (requesterDetail) {
    return requesterApprovalInstanceDetail(summary, subject, steps.rows, assignments.rows)
  }
  return {
    ...summary,
    subject,
    workflow: approvalWorkflowSnapshotSchema.parse(instance.workflow_snapshot),
    steps: steps.rows.map((step) => ({
      id: step.id,
      nodeId: step.node_id,
      nodeName: step.node_name || 'Etapa',
      approvalKind: step.approval_kind || null,
      stepNumber: step.step_number,
      status: step.status,
      completionMode: step.completion_mode,
      quorum: step.quorum,
      dueAt: optionalIso(step.due_at),
      version: Number(step.version),
      assignments: assignments.rows.filter((assignment) => assignment.approval_step_id === step.id).map((assignment) => ({
        id: assignment.id,
        userId: assignment.assignee_user_id,
        userName: assignment.assignee_name || null,
        userEmail: assignment.assignee_email || null,
        status: assignment.status,
        source: assignment.resolution_source,
        delegatedFromUserId: assignment.delegated_from_user_id,
        assignedAt: iso(assignment.assigned_at),
        respondedAt: optionalIso(assignment.responded_at),
      })),
    })),
    decisions: decisions.rows.map(normalizeDates),
    events: events.rows.map(normalizeDates),
  }
}

function requesterApprovalInstanceDetail(
  summary: ApprovalInstanceSummary,
  subject: Record<string, unknown>,
  steps: ApprovalStepRow[],
  assignments: ApprovalAssignmentRow[],
): ApprovalInstanceDetail {
  const context: ApprovalPresentationContext = {
    instanceType: summary.type,
    demandNumber: summary.demandNumber,
    companyName: summary.companyName,
    requesterName: summary.requesterName,
    travelerName: summary.travelerName,
    serviceType: summary.serviceType,
    destination: summary.destination,
    travelStartDate: summary.travelStartDate,
    travelEndDate: summary.travelEndDate,
  }
  return {
    id: summary.id,
    workflowName: summary.workflowName,
    demandId: summary.demandId,
    companyName: summary.companyName,
    demandNumber: summary.demandNumber,
    serviceType: summary.serviceType,
    travelerName: summary.travelerName,
    requesterName: summary.requesterName,
    travelStartDate: summary.travelStartDate,
    travelEndDate: summary.travelEndDate,
    destination: summary.destination,
    type: summary.type,
    status: summary.status,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
    pendingSteps: summary.pendingSteps,
    overdueSteps: summary.overdueSteps,
    assignedToMe: summary.assignedToMe,
    subject: {},
    presentation: buildApprovalSubjectPresentation(subject, context),
    workflow: null,
    steps: steps.map((step) => ({
      nodeName: step.node_name || 'Etapa',
      approvalKind: step.approval_kind || null,
      stepNumber: step.step_number,
      status: step.status,
      completionMode: step.completion_mode,
      quorum: step.quorum,
      dueAt: optionalIso(step.due_at),
      assignments: assignments
        .filter((assignment) => assignment.approval_step_id === step.id)
        .map((assignment) => ({
          userName: assignment.assignee_name || null,
          status: assignment.status,
          assignedAt: iso(assignment.assigned_at),
          respondedAt: optionalIso(assignment.responded_at),
        })),
    })),
    decisions: [],
    events: [],
  }
}

function mapApprovalInstanceSummary(
  row: ApprovalInstanceRow & { pending_steps?: string; overdue_steps?: string; assigned_to_me?: boolean },
): ApprovalInstanceSummary {
  return {
    id: row.id,
    workflowId: row.workflow_definition_id,
    workflowVersionId: row.workflow_version_id,
    workflowName: row.workflow_name || 'Workflow',
    demandId: row.demand_id,
    reservationId: row.reservation_id,
    companyId: row.company_id,
    companyName: row.company_name || row.company_id,
    employeeId: row.employee_id,
    demandNumber: row.demand_number || null,
    serviceType: row.demand_service_type || null,
    travelerName: row.demand_passenger_name || null,
    requesterName: row.requester_name || null,
    travelStartDate: optionalDate(row.demand_travel_start_date),
    travelEndDate: optionalDate(row.demand_travel_end_date),
    destination: row.demand_destination || null,
    type: row.instance_type,
    status: row.status,
    version: Number(row.version),
    startedAt: iso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    pendingSteps: Number(row.pending_steps || 0),
    overdueSteps: Number(row.overdue_steps || 0),
    assignedToMe: Boolean(row.assigned_to_me),
  }
}

async function insertApprovalEvent(
  client: PoolClient,
  principal: RequestPrincipal,
  instanceId: string,
  stepId: string | null,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into approval_events (
       tenant_id, approval_instance_id, approval_step_id, event_type, actor_user_id, payload
     ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [principal.tenantId, instanceId, stepId, type, principal.user.id, JSON.stringify(payload)],
  )
}

async function insertApprovalNotification(
  client: PoolClient,
  input: {
    tenantId: string
    recipientUserId: string
    instanceId: string
    stepId: string | null
    sourceEscalationId: string | null
    type: 'assignment' | 'reminder' | 'escalation' | 'expiration' | 'decision'
    title: string
    message: string
    payload: Record<string, unknown>
  },
): Promise<void> {
  await client.query(
    `insert into approval_notifications (
       tenant_id, recipient_user_id, approval_instance_id, approval_step_id,
       source_escalation_id, notification_type, title, message, payload
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     on conflict do nothing`,
    [
      input.tenantId,
      input.recipientUserId,
      input.instanceId,
      input.stepId,
      input.sourceEscalationId,
      input.type,
      input.title,
      input.message,
      JSON.stringify(input.payload),
    ],
  )
}

function accessibleApprovalCompanyIds(principal: RequestPrincipal, permission: 'ver_aprovacoes' | 'decidir_aprovacoes'): string[] {
  return principal.corporateAccess?.companies.filter((company) => company.permissions[permission]).map((company) => company.companyId) || []
}

function requesterApprovalOwnershipSql(instanceAlias: 'instance' | 'requester_instance', userParameter: '$3'): string {
  return `(
    exists (
      select 1
      from demands requester_owned_demand
      join requesters requester_owned_identity
        on requester_owned_identity.tenant_id = requester_owned_demand.tenant_id
        and requester_owned_identity.id = requester_owned_demand.requester_id
      where requester_owned_demand.tenant_id = ${instanceAlias}.tenant_id
        and requester_owned_demand.id = ${instanceAlias}.demand_id
        and requester_owned_identity.user_id = ${userParameter}::uuid
        and requester_owned_identity.status = 'active'
        and requester_owned_identity.deleted_at is null
    )
    or (
      ${instanceAlias}.subject_snapshot ->> 'requesterUserId' = (${userParameter}::uuid)::text
      and not exists (
        select 1
        from demands requester_authoritative_demand
        join requesters requester_authoritative_identity
          on requester_authoritative_identity.tenant_id = requester_authoritative_demand.tenant_id
          and requester_authoritative_identity.id = requester_authoritative_demand.requester_id
        where requester_authoritative_demand.tenant_id = ${instanceAlias}.tenant_id
          and requester_authoritative_demand.id = ${instanceAlias}.demand_id
          and requester_authoritative_identity.user_id is not null
      )
    )
  )`
}

function asApprovalSubject(value: unknown): ApprovalSubject & Record<string, unknown> {
  const record = asRecord(value)
  return record as ApprovalSubject & Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApprovalServiceError('INVALID_APPROVAL_SNAPSHOT', 'Snapshot de aprovacao invalido.', 500)
  }
  return value as Record<string, unknown>
}

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  return typeof metadata?.[key] === 'string' ? metadata[key] as string : null
}

function metadataStringArray(metadata: Record<string, unknown> | null, key: string): string[] {
  return Array.isArray(metadata?.[key]) ? (metadata?.[key] as unknown[]).filter(isString) : []
}

function normalizeDates(row: QueryResultRow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]))
}

function isoDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

const ALL_APPROVAL_KINDS: ApprovalKind[] = [
  'merit', 'cost', 'budget', 'operational', 'security', 'international',
  'financial', 'executive', 'cost_center', 'project', 'company', 'group',
  'traveler', 'debit', 'national', 'second_level', 'list', 'allocation_line',
]

interface PreparedWorkflow {
  snapshot: ApprovalWorkflowSnapshot
  nodeIdMap: Map<string, string>
  edgeIdMap: Map<string, string>
}

function prepareWorkflowSnapshot(
  workflowId: string,
  workflowVersionId: string,
  version: number,
  input: ApprovalWorkflowDraftInput | (ApprovalWorkflowVersionInput & { workflowCode: string }),
): PreparedWorkflow {
  const nodeIdMap = new Map(input.nodes.map((node) => [node.id, randomUUID()]))
  const edgeIdMap = new Map(input.edges.map((edge) => [edge.id, randomUUID()]))
  const nodes = input.nodes.map((node) => ({ ...node, id: nodeIdMap.get(node.id) as string }))
  const edges = input.edges.map((edge) => ({
    ...edge,
    id: edgeIdMap.get(edge.id) as string,
    sourceNodeId: nodeIdMap.get(edge.sourceNodeId) || edge.sourceNodeId,
    targetNodeId: nodeIdMap.get(edge.targetNodeId) || edge.targetNodeId,
  }))
  const snapshotBase = {
    workflowId,
    workflowVersionId,
    version,
    code: input.workflowCode,
    name: input.name,
    nodes,
    edges,
    validFrom: input.validFrom || null,
    validUntil: input.validUntil || null,
  }
  const snapshot = approvalWorkflowSnapshotSchema.parse({ ...snapshotBase, contentHash: sha256(snapshotBase) })
  assertWorkflowPublishable(snapshot)
  return { snapshot, nodeIdMap, edgeIdMap }
}

function assertWorkflowPublishable(snapshot: ApprovalWorkflowSnapshot): void {
  const validation = validateApprovalWorkflow(snapshot)
  if (!validation.valid) {
    throw new ApprovalServiceError(
      'INVALID_APPROVAL_WORKFLOW',
      validation.issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.message).join(' '),
      422,
    )
  }
}

async function insertWorkflowVersion(
  client: PoolClient,
  principal: RequestPrincipal,
  workflowId: string,
  prepared: PreparedWorkflow,
  changeSummary: string,
): Promise<void> {
  const snapshot = prepared.snapshot
  await client.query(
    `insert into approval_workflow_versions (
       id, tenant_id, workflow_definition_id, version_number, status,
       graph_snapshot, content_hash, change_summary, valid_from, valid_until, created_by
     ) values ($1, $2, $3, $4, 'draft', $5::jsonb, $6, $7, $8, $9, $10)`,
    [
      snapshot.workflowVersionId, principal.tenantId, workflowId, snapshot.version,
      JSON.stringify(snapshot), snapshot.contentHash, changeSummary,
      snapshot.validFrom || null, snapshot.validUntil || null, principal.user.id,
    ],
  )
}

async function insertWorkflowChildren(
  client: PoolClient,
  tenantId: string,
  prepared: PreparedWorkflow,
  input: ApprovalWorkflowDraftInput | ApprovalWorkflowVersionInput,
): Promise<void> {
  const versionId = prepared.snapshot.workflowVersionId
  for (const scope of input.scopes) {
    await client.query(
      `insert into approval_workflow_scopes (
         tenant_id, workflow_version_id, scope_type, scope_id, mode, specificity
       ) values ($1, $2, $3, $4, $5, $6)`,
      [tenantId, versionId, scope.type, scope.id || null, scope.mode, scope.specificity],
    )
  }
  for (const node of prepared.snapshot.nodes) {
    await client.query(
      `insert into approval_nodes (
         id, tenant_id, workflow_version_id, node_key, name, node_type,
         approval_kind, completion_mode, quorum, approver_resolution, configuration
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      [
        node.id, tenantId, versionId, node.key, node.name, node.type,
        node.approvalKind || null, node.completionMode || null, node.quorum || null,
        JSON.stringify(node.approverResolution || {}), JSON.stringify(node.configuration || {}),
      ],
    )
  }
  for (const edge of prepared.snapshot.edges) {
    await client.query(
      `insert into approval_edges (
         id, tenant_id, workflow_version_id, source_node_id, target_node_id,
         sequence, condition_ast, label
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        edge.id, tenantId, versionId, edge.sourceNodeId, edge.targetNodeId,
        edge.sequence, edge.condition ? JSON.stringify(edge.condition) : null, edge.label || null,
      ],
    )
  }
  for (const rule of input.rules) {
    await client.query(
      `insert into approval_rules (
         tenant_id, workflow_version_id, node_id, rule_type, condition_ast, configuration, priority
       ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        tenantId, versionId, rule.nodeId ? prepared.nodeIdMap.get(rule.nodeId) : null,
        rule.type, JSON.stringify(rule.condition), JSON.stringify(rule.configuration), rule.priority,
      ],
    )
  }
  for (const sla of input.slas) {
    await client.query(
      `insert into approval_slas (
         tenant_id, workflow_version_id, node_id, calendar_id, duration_minutes,
         business_time_only, reminder_minutes, expiration_action,
         passive_approval_justification, configuration
       ) values ($1, $2, $3, $4, $5, $6, $7::integer[], $8, $9, $10::jsonb)`,
      [
        tenantId, versionId, sla.nodeId ? prepared.nodeIdMap.get(sla.nodeId) : null,
        sla.calendarId || null, sla.durationMinutes, sla.businessTimeOnly,
        uniqueNumbers(sla.reminderMinutes), sla.expirationAction,
        sla.passiveApprovalJustification || null, JSON.stringify(sla.configuration),
      ],
    )
  }
}

async function loadWorkflowDefinition(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  lock: boolean,
): Promise<WorkflowDefinitionRow> {
  const result = await client.query<WorkflowDefinitionRow>(
    `select * from approval_workflow_definitions
     where tenant_id = $1 and id = $2${lock ? ' for update' : ''}`,
    [tenantId, workflowId],
  )
  if (!result.rows[0]) throw new ApprovalServiceError('WORKFLOW_NOT_FOUND', 'Workflow nao encontrado.', 404)
  return result.rows[0]
}

async function loadWorkflowScopes(client: PoolClient, tenantId: string, versionId: string): Promise<WorkflowScope[]> {
  const result = await client.query<WorkflowScopeRow>(
    `select workflow_version_id, scope_type, scope_id, mode, specificity
     from approval_workflow_scopes where tenant_id = $1 and workflow_version_id = $2
     order by specificity desc, id`,
    [tenantId, versionId],
  )
  return result.rows.map(mapWorkflowScope)
}

async function loadWorkflowScopesForDefinitions(
  client: PoolClient,
  tenantId: string,
  definitionIds: string[],
): Promise<Map<string, WorkflowScope[]>> {
  const map = new Map<string, WorkflowScope[]>()
  if (!definitionIds.length) return map
  const result = await client.query<WorkflowScopeRow & { workflow_definition_id: string }>(
    `select version.workflow_definition_id, scope.workflow_version_id, scope.scope_type, scope.scope_id,
            scope.mode, scope.specificity
     from approval_workflow_versions version
     join approval_workflow_definitions definition
       on definition.tenant_id = version.tenant_id and definition.id = version.workflow_definition_id
     join approval_workflow_scopes scope
       on scope.tenant_id = version.tenant_id and scope.workflow_version_id = version.id
     where version.tenant_id = $1 and version.workflow_definition_id = any($2::uuid[])
       and version.version_number = definition.current_version`,
    [tenantId, definitionIds],
  )
  for (const row of result.rows) map.set(row.workflow_definition_id, [...(map.get(row.workflow_definition_id) || []), mapWorkflowScope(row)])
  return map
}

function mapWorkflowScope(row: WorkflowScopeRow): WorkflowScope {
  return { type: row.scope_type, id: row.scope_id, mode: row.mode, specificity: row.specificity }
}

async function assertCanManageWorkflowScopes(principal: RequestPrincipal, scopes: Array<{ type: WorkflowScope['type']; id?: string | null }>): Promise<void> {
  for (const scope of scopes) {
    if (scope.type === 'tenant') {
      if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
        throw new ApprovalServiceError('TENANT_WORKFLOW_SCOPE_DENIED', 'Somente administrador do tenant pode gerenciar workflow global.', 403)
      }
    } else if (scope.type === 'group' && scope.id) {
      await requireGroupAccess(principal, scope.id, 'gerenciar_workflows')
    } else if (scope.type === 'company' && scope.id) {
      await requireCompanyAccess(principal, scope.id, 'gerenciar_workflows')
    }
  }
}

async function assertCanViewWorkflowScopes(principal: RequestPrincipal, scopes: WorkflowScope[], status: GovernanceStatus): Promise<void> {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return
  const visible = visibleWorkflowScope(principal)
  const allowed = scopes.some((scope) => (
    (scope.type === 'tenant' && status === 'published')
    || (scope.type === 'company' && Boolean(scope.id && visible.companyIds.includes(scope.id)))
    || (scope.type === 'group' && Boolean(scope.id && visible.groupIds.includes(scope.id)))
  ))
  if (!allowed) throw new ApprovalServiceError('WORKFLOW_SCOPE_ACCESS_DENIED', 'Workflow fora do escopo autorizado.', 403)
}

function visibleWorkflowScope(principal: RequestPrincipal): { tenantWide: boolean; companyIds: string[]; groupIds: string[] } {
  return {
    tenantWide: principal.platformAdmin || principal.roleKey === 'tenant_admin',
    companyIds: principal.corporateAccess?.companies
      .filter((company) => company.permissions.ver_aprovacoes)
      .map((company) => company.companyId) || [],
    groupIds: principal.corporateAccess?.groups
      .filter((group) => group.companyIds.some((companyId) => (
        principal.corporateAccess?.companies.find((company) => company.companyId === companyId)?.permissions.ver_aprovacoes
      )))
      .map((group) => group.groupId) || [],
  }
}

function assertWorkflowTransition(current: GovernanceStatus, action: ApprovalWorkflowTransitionInput['action']): void {
  const allowed: Record<ApprovalWorkflowTransitionInput['action'], GovernanceStatus[]> = {
    submit_review: ['draft'],
    approve: ['in_review'],
    publish: ['approved'],
    suspend: ['published'],
    archive: ['draft', 'in_review', 'approved', 'suspended'],
  }
  if (!allowed[action].includes(current)) {
    throw new ApprovalServiceError('INVALID_WORKFLOW_TRANSITION', `Nao e possivel executar ${action} a partir de ${current}.`, 409)
  }
}

function assertPublicationWindow(version: WorkflowVersionRow, input: ApprovalWorkflowTransitionInput): void {
  if (input.action !== 'publish') return
  const configuredFrom = optionalIso(version.valid_from)
  const configuredUntil = optionalIso(version.valid_until)
  if (input.effectiveFrom && configuredFrom !== input.effectiveFrom) {
    throw new ApprovalServiceError('WORKFLOW_PUBLICATION_WINDOW_MISMATCH', 'A vigencia deve ser definida na versao antes da aprovacao.', 409)
  }
  if (input.effectiveUntil !== undefined && (input.effectiveUntil || null) !== configuredUntil) {
    throw new ApprovalServiceError('WORKFLOW_PUBLICATION_WINDOW_MISMATCH', 'A vigencia deve ser definida na versao antes da aprovacao.', 409)
  }
}

async function setWorkflowStatus(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  versionId: string,
  status: GovernanceStatus,
): Promise<void> {
  await client.query(`update approval_workflow_versions set status = $3 where tenant_id = $1 and id = $2`, [tenantId, versionId, status])
  await client.query(`update approval_workflow_definitions set status = $3 where tenant_id = $1 and id = $2`, [tenantId, workflowId, status])
}

async function insertWorkflowChangeAudit(
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
    `insert into approval_workflow_change_audits (
       tenant_id, workflow_definition_id, workflow_version_id, action,
       actor_user_id, reason, before_snapshot, after_snapshot
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [
      principal.tenantId, workflowId, versionId, action, principal.user.id, reason,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
    ],
  )
}

function workflowListItem(row: WorkflowDefinitionRow, scopes: WorkflowScope[]): ApprovalWorkflowListItem {
  return {
    id: row.id,
    code: row.workflow_code,
    name: row.name,
    description: row.description,
    type: row.workflow_type,
    status: row.status,
    currentVersion: row.current_version,
    scopes,
    updatedAt: iso(row.updated_at),
  }
}

async function auditApprovalChange(
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
    entityType: 'approval',
    entityId,
    metadata,
  })
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505')
}

function assertUuid(value: string, code: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApprovalServiceError(code, 'Identificador invalido.', 400)
  }
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function optionalIso(value: string | Date | null | undefined): string | null {
  return value ? iso(value) : null
}

function optionalDate(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match?.[1] || null
}

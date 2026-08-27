import 'server-only'

import { randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  approvalAuthorityInputSchema,
  approvalMatrixInputSchema,
  approvalMatrixTransitionSchema,
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
  approverConflictsWithSubject,
  type ApprovalAuthorityInput,
  type ApprovalCandidate,
  type ApprovalDecisionInput,
  type ApprovalDelegationCandidate,
  type ApprovalDelegationInput,
  type ApprovalKind,
  type ApprovalMatrixInput,
  type ApprovalMatrixTransitionInput,
  type ApprovalRoutingFacts,
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
import { INTERNAL_AGENCY_DEMAND_ROLE_KEYS as INTERNAL_AGENCY_APPROVAL_ROLE_KEYS } from '@/lib/demands/agency-assistance'
import { createOpenDemandRequestAdjustment } from '@/lib/demands/request-adjustment'
import { policyResultsRequireSecondLevel } from '@/lib/approvals/policy-routing'
import { approvalVisibilityMode } from '@/lib/approvals/visibility'
import {
  buildApprovalSubjectPresentation,
  type ApprovalPresentationContext,
  type ApprovalSubjectPresentation,
} from '@/lib/approvals/subject-presentation'
import { writeAuditEvent, writeAuditEventInTransaction } from '@/lib/server/audit-log'
import {
  normalizeMembershipPermissions,
  requireCompanyAccess,
  requireGroupAccess,
  resolveEffectiveCorporateAccessInTransaction,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { assertPolicyVersionPublishableInTransaction } from '@/lib/server/policy-service'
import {
  realActorUserId,
  requireActiveOperateRepresentation,
  SupportRepresentationError,
  type OperateRepresentationContext,
} from '@/lib/server/support-representation-service'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import type { TravelLifecycleRecord, TravelLifecycleStatus } from '@/lib/travel-lifecycle'
import type { CorporateAccessSummary, Permissoes } from '@/types'

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

interface ApprovalDemandProjectionRow extends QueryResultRow {
  id: string
  company_id: string
  service_type: string
  lifecycle_status: TravelLifecycleStatus
  lifecycle_version: string | number
  last_policy_evaluation_id: string | null
  active_approval_instance_id: string | null
  metadata: Record<string, unknown>
}

interface RejectedQuoteSelectionProjectionRow extends QueryResultRow {
  selection_id: string
  selection_status: string
  snapshot_hash: string
  quote_id: string
  option_id: string
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
  department: string | null
  audience_group_id: string | null
  approval_level: 1 | 2
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

export function hasExplicitCorporateCompanyPermission(
  access: CorporateAccessSummary,
  companyId: string,
  permission: keyof Permissoes,
): boolean {
  const company = access.companies.find((candidate) => candidate.companyId === companyId)
  return Boolean(company?.delegationAuthorities?.some((authority) => (
    authority.companyIds.includes(companyId) && authority.permissions[permission]
  )))
}

export function isCorporateApprovalMembershipEligible(input: {
  roleKey: string | null | undefined
  platformAdmin: boolean
  tenantWide: boolean
}): boolean {
  return !input.platformAdmin
    && !input.tenantWide
    && !INTERNAL_AGENCY_APPROVAL_ROLE_KEYS.has(String(input.roleKey || '').trim())
}

export function hasExplicitCorporateGroupAllPermission(
  access: CorporateAccessSummary,
  groupId: string,
  permission: keyof Permissoes,
): boolean {
  const group = access.groups.find((candidate) => candidate.groupId === groupId)
  return Boolean(group?.delegationAuthorities?.some((authority) => (
    authority.source === 'group'
    && authority.accessMode === 'all_companies'
    && authority.permissions[permission]
  )))
}

export interface CanonicalApprovalConflictFacts {
  realActorUserId: string
  representationActorUserId?: string | null
  representationSubjectUserId?: string | null
  demandCreatedByUserId?: string | null
  demandUpdatedByUserId?: string | null
  travelerUserIds?: readonly string[]
}

export function mergeCanonicalApprovalSubjectConflicts(
  subject: Record<string, unknown>,
  facts: CanonicalApprovalConflictFacts,
): {
  lastEditorUserId: string
  assistedActorUserId: string | null
  conflictedUserIds: string[]
} {
  const callerConflictedUserIds = Array.isArray(subject.conflictedUserIds)
    ? subject.conflictedUserIds.filter(isString)
    : []
  const callerLastEditorUserId = isString(subject.lastEditorUserId) ? subject.lastEditorUserId : null
  const callerAssistedActorUserId = isString(subject.assistedActorUserId) ? subject.assistedActorUserId : null
  const lastEditorUserId = facts.demandUpdatedByUserId
    || facts.demandCreatedByUserId
    || facts.realActorUserId
  const assistedActorUserId = facts.representationActorUserId || null
  return {
    lastEditorUserId,
    assistedActorUserId,
    conflictedUserIds: uniqueStrings([
      ...callerConflictedUserIds,
      callerLastEditorUserId || '',
      callerAssistedActorUserId || '',
      facts.realActorUserId,
      facts.representationActorUserId || '',
      facts.representationSubjectUserId || '',
      facts.demandCreatedByUserId || '',
      facts.demandUpdatedByUserId || '',
      ...(facts.travelerUserIds || []),
    ]),
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
  assertGenericApprovalWorkflowCodeAllowed(input.workflowCode)
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
    assertGenericApprovalWorkflowCodeAllowed(definition.workflow_code)
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
    assertGenericApprovalWorkflowCodeAllowed(definition.workflow_code)
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

export function assertGenericApprovalWorkflowCodeAllowed(workflowCode: string): void {
  if (!workflowCode.startsWith('matrix.')) return
  throw new ApprovalServiceError(
    'APPROVAL_MATRIX_WORKFLOW_RESERVED',
    'Workflows com prefixo matrix.* sao gerenciados exclusivamente pela matriz corporativa.',
    409,
  )
}

export async function listApprovalInstances(
  principal: RequestPrincipal,
  filters: {
    status?: ApprovalInstanceRow['status']
    companyId?: string
    companyIds?: readonly string[]
    demandId?: string
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
  const scopedCompanyIds = filters.companyIds
    ? [...new Set(filters.companyIds.map((companyId) => companyId.trim()).filter(Boolean))]
    : null
  if (filters.companyIds && !scopedCompanyIds?.length) {
    throw new ApprovalServiceError(
      'APPROVAL_COMPANY_SCOPE_EMPTY',
      'Informe ao menos uma empresa autorizada para consultar aprovacoes.',
      403,
    )
  }
  for (const companyId of scopedCompanyIds || []) {
    await requireCompanyAccess(principal, companyId, 'ver_aprovacoes')
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
    if (scopedCompanyIds) {
      values.push(scopedCompanyIds)
      clauses.push(`instance.company_id = any($${values.length}::text[])`)
    }
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`instance.status = $${values.length}`)
    }
    if (filters.demandId) {
      values.push(filters.demandId)
      clauses.push(`instance.demand_id = $${values.length}`)
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
         on demand.tenant_id = instance.tenant_id
        and demand.id = instance.demand_id
        and demand.company_id = instance.company_id
       left join requesters requester
         on requester.tenant_id = demand.tenant_id
        and requester.id = demand.requester_id
        and requester.company_id = instance.company_id
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
  return createApprovalInstanceWithOrigin(principal, rawInput, 'public_api')
}

/**
 * Reserved for server-side domain services that derive the approval subject
 * from persisted demands, selections, reservations and policy evaluations.
 * A JSON caller cannot opt in to this origin.
 */
export async function createTrustedApprovalInstance(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<ApprovalInstanceDetail> {
  return createApprovalInstanceWithOrigin(principal, rawInput, 'trusted_domain')
}

async function createApprovalInstanceWithOrigin(
  principal: RequestPrincipal,
  rawInput: unknown,
  origin: 'public_api' | 'trusted_domain',
): Promise<ApprovalInstanceDetail> {
  const input = createApprovalInstanceSchema.parse(rawInput)
  assertApprovalInstanceEntityOrigin(input, origin)
  const actorUserId = realActorUserId(principal)
  await requireCompanyAccess(principal, input.companyId, 'criar_demandas')
  const inputHash = sha256({ ...input, tenantId: principal.tenantId })
  let instanceId = ''
  try {
    instanceId = await withTenantTransaction(principal.tenantId, async (client) => {
      await assertRequesterCanCreateApprovalInstance(client, principal, input)
      if (origin === 'public_api') {
        await assertPublicApprovalInstanceWorkflowAllowed(client, principal.tenantId, input)
      }
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
      assertApprovalInstanceWorkflowOrigin(selected.definition.workflow_code, origin)
      const parsedSubject = approvalSubjectInputSchema.parse(input.subject)
      const canonicalSubject = await loadCanonicalApprovalSubjectContext(client, principal, input, parsedSubject)
      const policyRouting = await loadPolicyApprovalRouting(
        client,
        principal.tenantId,
        input,
        { ...parsedSubject, ...canonicalSubject },
      )
      const baseSubject: ApprovalSubject & Record<string, unknown> = {
        ...parsedSubject,
        ...canonicalSubject,
        tenantId: principal.tenantId,
        companyId: input.companyId,
        groupId: company.groupId,
        priorApproverUserIds: [],
        routing: policyRouting,
      }
      const snapshot = approvalWorkflowSnapshotSchema.parse(selected.version.graph_snapshot)
      assertWorkflowPublishable(snapshot)
      const preparedRouting = await prepareApprovalRouting(
        client,
        principal,
        snapshot,
        baseSubject,
        policyRouting,
      )
      const subject = preparedRouting.subject
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
          JSON.stringify(snapshot), inputHash, input.idempotencyKey, actorUserId,
        ],
      )
      await insertApprovalEvent(client, principal, id, null, 'instance_started', {
        workflowVersionId: selected.version.id,
        inputHash,
        routing: subject.routing || null,
      })
      const start = snapshot.nodes.find((node) => node.type === 'start')
      if (!start) throw new ApprovalServiceError('WORKFLOW_START_NODE_MISSING', 'Workflow publicado sem no inicial.', 409)
      const instance = await loadApprovalInstance(client, principal.tenantId, id, true)
      await activateWorkflowNodes(client, principal, instance, snapshot, preparedRouting.initialNodes)
      if (input.demandId) {
        await client.query(
          `update demands set active_approval_instance_id = $3, updated_by = $4
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, input.demandId, id, actorUserId],
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

function assertApprovalInstanceEntityOrigin(
  input: CreateApprovalInstanceInput,
  origin: 'public_api' | 'trusted_domain',
): void {
  if (origin === 'trusted_domain' || !(input.demandId || input.reservationId || input.employeeId)) return
  throw new ApprovalServiceError(
    'APPROVAL_ENTITY_INSTANCE_DOMAIN_ORIGIN_REQUIRED',
    'Aprovacoes vinculadas a entidades de viagem so podem ser iniciadas pelo servico de dominio correspondente.',
    403,
  )
}

export function assertApprovalInstanceWorkflowOrigin(
  workflowCode: string,
  origin: 'public_api' | 'trusted_domain',
): void {
  if (origin === 'trusted_domain' || !workflowCode.startsWith('matrix.')) return
  throw new ApprovalServiceError(
    'APPROVAL_MATRIX_INSTANCE_DOMAIN_ORIGIN_REQUIRED',
    'Instancias da matriz corporativa so podem ser iniciadas pelo fluxo de dominio que valida os fatos persistidos.',
    403,
  )
}

async function assertPublicApprovalInstanceWorkflowAllowed(
  client: PoolClient,
  tenantId: string,
  input: CreateApprovalInstanceInput,
): Promise<void> {
  const values: unknown[] = [tenantId]
  const selector = input.workflowDefinitionId
    ? (values.push(input.workflowDefinitionId), `id = $${values.length}`)
    : (values.push(input.workflowCode), `workflow_code = $${values.length}`)
  const workflow = await client.query<{ workflow_code: string }>(
    `select workflow_code from approval_workflow_definitions
     where tenant_id = $1 and ${selector}`,
    values,
  )
  if (workflow.rows[0]) assertApprovalInstanceWorkflowOrigin(workflow.rows[0].workflow_code, 'public_api')
}

export async function decideApprovalAssignment(
  principal: RequestPrincipal,
  assignmentId: string,
  rawInput: unknown,
  options: { allowedCompanyIds?: readonly string[] } = {},
): Promise<ApprovalInstanceDetail> {
  assertUuid(assignmentId, 'APPROVAL_ASSIGNMENT_ID_INVALID')
  const input = approvalDecisionInputSchema.parse(rawInput)
  const allowedCompanyIds = options.allowedCompanyIds
    ? [...new Set(options.allowedCompanyIds.map((companyId) => companyId.trim()).filter(Boolean))]
    : null
  if (options.allowedCompanyIds && !allowedCompanyIds?.length) {
    throw new ApprovalServiceError(
      'APPROVAL_COMPANY_SCOPE_EMPTY',
      'Informe ao menos uma empresa autorizada para decidir aprovacoes.',
      403,
    )
  }
  let instanceId = ''
  let replayed = false
  await withTenantTransaction(principal.tenantId, async (client) => {
    const assignmentResult = await client.query<ApprovalAssignmentRow>(
      `select * from approval_assignments where tenant_id = $1 and id = $2 for update`,
      [principal.tenantId, assignmentId],
    )
    const assignment = assignmentResult.rows[0]
    if (!assignment) throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_NOT_FOUND', 'Atribuicao de aprovacao nao encontrada.', 404)
    const stepResult = await client.query<ApprovalStepRow>(
      `select * from approval_steps where tenant_id = $1 and id = $2 for update`,
      [principal.tenantId, assignment.approval_step_id],
    )
    const step = stepResult.rows[0]
    if (!step) throw new ApprovalServiceError('APPROVAL_STEP_NOT_FOUND', 'Etapa de aprovacao nao encontrada.', 404)
    const instance = await loadApprovalInstance(client, principal.tenantId, step.approval_instance_id, true)
    assertApprovalDecisionCompanyScope(instance.company_id, allowedCompanyIds)
    instanceId = instance.id
    await requireCompanyAccess(principal, instance.company_id, 'decidir_aprovacoes')
    const existingDecision = await client.query<{
      id: string
      assignment_id: string
      decision: string
      reason: string
      decided_by_user_id: string | null
      acting_for_user_id: string | null
      decision_source: string
      impersonation_id: string | null
      decision_snapshot: Record<string, unknown> | null
    }>(
      `select id, assignment_id, decision, reason, decided_by_user_id,
              acting_for_user_id, decision_source, impersonation_id,
              decision_snapshot
       from approval_decisions
       where tenant_id = $1 and idempotency_key = $2`,
      [principal.tenantId, input.idempotencyKey],
    )
    if (existingDecision.rows[0]) {
      const existing = existingDecision.rows[0]
      const replayActor = approvalDecisionActorIdentity(principal, assignment)
      if (!approvalDecisionReplayMatches(existing, {
        assignmentId,
        input,
        actor: replayActor,
      })) {
        throw new ApprovalServiceError('APPROVAL_DECISION_IDEMPOTENCY_CONFLICT', 'A chave de idempotencia ja foi usada em outra decisao.', 409)
      }
      replayed = true
      return
    }
    const decisionActor = await authorizeApprovalDecisionActor(client, principal, assignment, instance, step)
    const actionTokenId = input.actionToken && !decisionActor.representation
      ? await validateAndLockApprovalActionToken(client, principal, assignment, input)
      : null
    if (Number(step.version) !== input.expectedStepVersion) {
      throw new ApprovalServiceError('STALE_APPROVAL_STEP', 'A etapa foi alterada por outra decisao. Atualize a tela.', 409)
    }
    if (assignment.status !== 'pending' || step.status !== 'pending' || !['pending', 'in_progress'].includes(instance.status)) {
      throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_ALREADY_CLOSED', 'A atribuicao nao esta mais pendente.', 409)
    }

    const assignmentStatus = input.decision === 'approved' ? 'approved' : 'rejected'
    await client.query(
      `insert into approval_decisions (
         tenant_id, approval_instance_id, approval_step_id, assignment_id,
         decision, reason, decided_by_user_id, acting_for_user_id,
         idempotency_key, decision_snapshot, decision_source, impersonation_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
      [
        principal.tenantId, instance.id, step.id, assignment.id, input.decision,
        input.reason, decisionActor.actorUserId, decisionActor.actingForUserId,
        input.idempotencyKey, JSON.stringify({
          expectedStepVersion: input.expectedStepVersion,
          confirmation: true,
          representationId: decisionActor.representation?.id || null,
        }),
        decisionActor.source, decisionActor.representation?.id || null,
      ],
    )
    if (actionTokenId) {
      await client.query(
        `update approval_action_tokens set used_at = now(), used_by_user_id = $3
         where tenant_id = $1 and id = $2 and used_at is null`,
        [principal.tenantId, actionTokenId, decisionActor.actorUserId],
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
      actorUserId: decisionActor.actorUserId,
      actingForUserId: decisionActor.actingForUserId,
      decisionSource: decisionActor.source,
      impersonationId: decisionActor.representation?.id || null,
    })
  })
  if (!replayed) {
    await auditApprovalChange(principal, 'approval.assignment.decided', assignmentId, {
      instanceId,
      decision: input.decision,
      representationId: principal.representation?.id || null,
      representedUserId: principal.representation?.subject.id || null,
    })
  }
  return getApprovalInstanceDetail(principal, instanceId)
}

export async function findApprovalDecisionReplayAssignmentId(
  principal: RequestPrincipal,
  instanceId: string,
  idempotencyKey: string,
  allowedCompanyIds: readonly string[],
): Promise<string | null> {
  assertUuid(instanceId, 'APPROVAL_INSTANCE_ID_INVALID')
  const normalizedIdempotencyKey = idempotencyKey.trim()
  if (normalizedIdempotencyKey.length < 8 || normalizedIdempotencyKey.length > 200) {
    throw new ApprovalServiceError('APPROVAL_IDEMPOTENCY_KEY_INVALID', 'Chave de idempotencia invalida.', 400)
  }
  const companyIds = [...new Set(allowedCompanyIds.map((companyId) => companyId.trim()).filter(Boolean))]
  if (!companyIds.length) {
    throw new ApprovalServiceError(
      'APPROVAL_COMPANY_SCOPE_EMPTY',
      'Informe ao menos uma empresa autorizada para decidir aprovacoes.',
      403,
    )
  }
  for (const companyId of companyIds) {
    await requireCompanyAccess(principal, companyId, 'decidir_aprovacoes')
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ assignment_id: string }>(
      `select decision.assignment_id
       from approval_decisions decision
       join approval_instances instance
         on instance.tenant_id = decision.tenant_id
        and instance.id = decision.approval_instance_id
       where decision.tenant_id = $1
         and decision.approval_instance_id = $2
         and decision.idempotency_key = $3
         and instance.company_id = any($4::text[])
       limit 1`,
      [principal.tenantId, instanceId, normalizedIdempotencyKey, companyIds],
    )
    return result.rows[0]?.assignment_id || null
  })
}

export function assertApprovalDecisionCompanyScope(
  companyId: string,
  allowedCompanyIds: readonly string[] | null,
): void {
  if (allowedCompanyIds && !allowedCompanyIds.includes(companyId)) {
    throw new ApprovalServiceError(
      'APPROVAL_INSTANCE_NOT_FOUND',
      'Aprovacao nao encontrada.',
      404,
    )
  }
}

export interface ApprovalDecisionActorContext {
  actorUserId: string
  actingForUserId: string | null
  source: 'human' | 'delegated' | 'support_assisted'
  representation: OperateRepresentationContext | null
}

export interface ApprovalDecisionReplayRecord {
  assignment_id: string
  decision: string
  reason: string
  decided_by_user_id: string | null
  acting_for_user_id: string | null
  decision_source: string
  impersonation_id: string | null
  decision_snapshot: Record<string, unknown> | null
}

export function approvalDecisionReplayMatches(
  existing: ApprovalDecisionReplayRecord,
  expected: {
    assignmentId: string
    input: ApprovalDecisionInput
    actor: ApprovalDecisionActorContext
  },
): boolean {
  const snapshot = existing.decision_snapshot && typeof existing.decision_snapshot === 'object'
    ? existing.decision_snapshot
    : {}
  return existing.assignment_id === expected.assignmentId
    && existing.decision === expected.input.decision
    && existing.reason === expected.input.reason
    && existing.decided_by_user_id === expected.actor.actorUserId
    && existing.acting_for_user_id === expected.actor.actingForUserId
    && existing.decision_source === expected.actor.source
    && existing.impersonation_id === (expected.actor.representation?.id || null)
    && Number(snapshot.expectedStepVersion) === expected.input.expectedStepVersion
    && snapshot.confirmation === true
    && (snapshot.representationId || null) === (expected.actor.representation?.id || null)
}

function approvalDecisionActorIdentity(
  principal: RequestPrincipal,
  assignment: ApprovalAssignmentRow,
): ApprovalDecisionActorContext {
  if (!assignment.assignee_user_id) {
    throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_USER_REQUIRED', 'A atribuicao nao possui um aprovador individual.', 409)
  }
  if (principal.representation) {
    if (assignment.delegated_from_user_id) {
      throw new ApprovalServiceError(
        'APPROVAL_ASSISTED_DELEGATION_CONFLICT',
        'Uma atribuicao delegada nao pode ser decidida por personificacao.',
        409,
      )
    }
    const actorUserId = principal.actor?.user.id
    if (
      principal.representation.mode !== 'operate'
      || !actorUserId
      || assignment.assignee_user_id !== principal.representation.subject.id
      || principal.user.id !== principal.representation.subject.id
    ) {
      throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_ACCESS_DENIED', 'A atribuicao nao pertence ao autorizador representado.', 403)
    }
    return {
      actorUserId,
      actingForUserId: principal.representation.subject.id,
      source: 'support_assisted',
      representation: {
        id: principal.representation.id,
        actorUserId,
        targetUserId: principal.representation.subject.id,
      },
    }
  }
  if (assignment.assignee_user_id !== principal.user.id) {
    throw new ApprovalServiceError('APPROVAL_ASSIGNMENT_ACCESS_DENIED', 'Esta decisao pertence a outro aprovador.', 403)
  }
  return assignment.delegated_from_user_id
    ? {
        actorUserId: realActorUserId(principal),
        actingForUserId: assignment.delegated_from_user_id,
        source: 'delegated',
        representation: null,
      }
    : {
        actorUserId: realActorUserId(principal),
        actingForUserId: null,
        source: 'human',
        representation: null,
      }
}

async function authorizeApprovalDecisionActor(
  client: PoolClient,
  principal: RequestPrincipal,
  assignment: ApprovalAssignmentRow,
  instance: ApprovalInstanceRow,
  step: ApprovalStepRow,
): Promise<ApprovalDecisionActorContext> {
  const identity = approvalDecisionActorIdentity(principal, assignment)
  if (identity.representation) {
    try {
      const representation = await requireActiveOperateRepresentation(client, principal, {
        action: 'approval.decide',
        companyId: instance.company_id,
        targetUserId: identity.representation.targetUserId,
      })
      const subject = asApprovalSubject(instance.subject_snapshot)
      const node = approvalWorkflowSnapshotSchema.parse(instance.workflow_snapshot).nodes
        .find((candidate) => candidate.id === step.node_id)
      if (!node?.approverResolution) {
        throw new ApprovalServiceError(
          'APPROVAL_ASSISTED_NODE_INVALID',
          'A etapa representada nao possui regras de aprovador validas.',
          409,
        )
      }
      if (approverConflictsWithSubject(representation.actorUserId, subject, node.approverResolution)) {
        throw new ApprovalServiceError(
          'APPROVAL_ASSISTED_SOD_CONFLICT',
          'O operador real possui conflito de segregacao de funcoes e nao pode registrar esta decisao.',
          403,
        )
      }
      return {
        actorUserId: representation.actorUserId,
        actingForUserId: representation.targetUserId,
        source: 'support_assisted',
        representation,
      }
    } catch (error) {
      if (error instanceof SupportRepresentationError) {
        throw new ApprovalServiceError(error.code, error.message, error.status)
      }
      throw error
    }
  }
  if (assignment.delegated_from_user_id) {
    await assertActiveDelegatedAssignment(client, principal.tenantId, assignment, instance)
    return identity
  }
  return identity
}

async function assertActiveDelegatedAssignment(
  client: PoolClient,
  tenantId: string,
  assignment: ApprovalAssignmentRow,
  instance: ApprovalInstanceRow,
): Promise<void> {
  if (!assignment.source_reference || !assignment.delegated_from_user_id || !assignment.assignee_user_id) {
    throw new ApprovalServiceError('APPROVAL_DELEGATION_CONTEXT_MISSING', 'A atribuicao delegada perdeu sua referencia de origem.', 409)
  }
  const result = await client.query(
    `select 1
     from approval_delegations delegation
     join tenant_memberships delegator
       on delegator.tenant_id = delegation.tenant_id
      and delegator.id = delegation.delegator_membership_id
      and delegator.user_id = $4
      and delegator.status = 'active'
     join tenant_memberships delegate
       on delegate.tenant_id = delegation.tenant_id
      and delegate.id = delegation.delegate_membership_id
      and delegate.user_id = $5
      and delegate.status = 'active'
     where delegation.tenant_id = $1 and delegation.id::text = $2
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
         or exists (
           select 1 from approval_instances scoped_instance
           join approval_delegation_groups group_scope
             on group_scope.tenant_id = delegation.tenant_id
            and group_scope.delegation_id = delegation.id
           join companies company
             on company.tenant_id = scoped_instance.tenant_id
            and company.id = scoped_instance.company_id
            and company.group_id = group_scope.group_id
           where scoped_instance.tenant_id = delegation.tenant_id
             and scoped_instance.id = $6
         )
       )
     for share of delegation`,
    [
      tenantId,
      assignment.source_reference,
      instance.company_id,
      assignment.delegated_from_user_id,
      assignment.assignee_user_id,
      instance.id,
    ],
  )
  if (!result.rows[0]) {
    throw new ApprovalServiceError(
      'APPROVAL_DELEGATION_NO_LONGER_VALID',
      'A delegacao expirou, foi revogada ou nao cobre mais esta empresa. A atribuicao deve ser reavaliada.',
      409,
    )
  }
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
  const routingFacts = await persistApprovedStepRoutingContext(client, principal, instance, step)
  const nextNodes = resolveNextWorkflowNodes(snapshot, step.node_id, routingFacts)
  await activateWorkflowNodes(
    client,
    principal,
    { ...instance, subject_snapshot: routingFacts },
    snapshot,
    nextNodes,
  )
}

async function persistApprovedStepRoutingContext(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
  step: ApprovalStepRow,
): Promise<Record<string, unknown>> {
  const approved = await client.query<{ user_id: string }>(
    `select distinct approved_actor.user_id
     from (
       select assignment.assignee_user_id as user_id
       from approval_assignments assignment
       where assignment.tenant_id = $1 and assignment.approval_step_id = $2
         and assignment.status = 'approved' and assignment.assignee_user_id is not null
       union
       select decision.decided_by_user_id as user_id
       from approval_decisions decision
       where decision.tenant_id = $1 and decision.approval_step_id = $2
         and decision.decision = 'approved' and decision.decided_by_user_id is not null
       union
       select decision.acting_for_user_id as user_id
       from approval_decisions decision
       where decision.tenant_id = $1 and decision.approval_step_id = $2
         and decision.decision = 'approved' and decision.acting_for_user_id is not null
     ) approved_actor
     order by approved_actor.user_id`,
    [principal.tenantId, step.id],
  )
  const subject = asRecord(instance.subject_snapshot)
  const priorApproverUserIds = uniqueStrings([
    ...(Array.isArray(subject.priorApproverUserIds) ? subject.priorApproverUserIds.filter(isString) : []),
    ...approved.rows.map((row) => row.user_id),
  ])
  const updated: Record<string, unknown> = { ...subject, priorApproverUserIds }
  await client.query(
    `update approval_instances
     set subject_snapshot = $3::jsonb, version = version + 1
     where tenant_id = $1 and id = $2`,
    [principal.tenantId, instance.id, JSON.stringify(updated)],
  )
  await insertApprovalEvent(client, principal, instance.id, step.id, 'routing_context_updated', {
    priorApproverUserIds,
    routing: updated['routing'] || null,
  })
  return updated
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
  filters: { membershipId?: string; kind?: ApprovalKind; status?: string; companyId?: string; includeInherited?: boolean; approvalLevel?: 1 | 2; limit?: number; offset?: number } = {},
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
    if (filters.companyId) {
      values.push(filters.companyId)
      const companyParameter = values.length
      clauses.push(filters.includeInherited
        ? `(authority.company_id = $${companyParameter} or authority.group_id = (
             select company.group_id from companies company
             where company.tenant_id = authority.tenant_id and company.id = $${companyParameter}
               and company.deleted_at is null
           ))`
        : `authority.company_id = $${companyParameter}`)
    }
    if (filters.approvalLevel) {
      values.push(filters.approvalLevel)
      clauses.push(`authority.approval_level = $${values.length}`)
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
              authority.project_id as "projectId", authority.department,
              authority.audience_group_id as "audienceGroupId",
              audience_group.name as "audienceGroupName",
              authority.approval_level as "approvalLevel",
              authority.max_amount::float8 as "maxAmount",
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
       left join approval_audience_groups audience_group
         on audience_group.tenant_id = authority.tenant_id
        and audience_group.id = authority.audience_group_id
       where ${clauses.join(' and ')}
       order by authority.created_at desc, authority.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return { items: rows.rows.map(normalizeDates), total: Number(count.rows[0]?.total || 0) }
  })
}

export async function listApprovalCandidates(
  principal: RequestPrincipal,
  filters: {
    companyId?: string
    companyIds?: readonly string[]
    businessGroupId?: string
    allCompanies?: boolean
    search?: string
    limit?: number
    offset?: number
  },
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const companyIds = uniqueStrings([
    ...(filters.companyId ? [filters.companyId] : []),
    ...(filters.companyIds || []),
  ])
  if (
    !companyIds.length
    || companyIds.length > 100
    || (filters.companyId && filters.companyIds)
    || Boolean(filters.businessGroupId) !== Boolean(filters.allCompanies)
    || (filters.allCompanies && !filters.companyIds)
  ) {
    throw new ApprovalServiceError('APPROVAL_CANDIDATE_SCOPE_INVALID', 'Informe de uma a cem empresas em um unico modo de consulta.', 422)
  }
  const requireDecisionInEveryCompany = Boolean(filters.companyIds)
  if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
    for (const companyId of companyIds) {
      const companyAccess = principal.corporateAccess?.companies.find((company) => company.companyId === companyId)
      if (
        !companyAccess?.permissions.gerenciar_workflows
        && !companyAccess?.permissions.gerenciar_vinculos_acesso
        && !companyAccess?.permissions.gerenciar_usuarios
      ) {
        throw new ApprovalServiceError('APPROVAL_CANDIDATE_SCOPE_DENIED', 'Sem permissao para consultar candidatos em todas as empresas.', 403)
      }
    }
  }
  if (filters.allCompanies && filters.businessGroupId) {
    assertAllCompaniesMatrixActor(principal, filters.businessGroupId)
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, companyIds]
    let groupParameter: number | null = null
    if (filters.allCompanies && filters.businessGroupId) {
      const groupCompanies = await client.query<{ id: string }>(
        `select id from companies
         where tenant_id = $1 and group_id = $2 and deleted_at is null
         order by id`,
        [principal.tenantId, filters.businessGroupId],
      )
      const activeCompanyIds = groupCompanies.rows.map((company) => company.id).sort()
      const requestedCompanyIds = [...companyIds].sort()
      if (JSON.stringify(activeCompanyIds) !== JSON.stringify(requestedCompanyIds)) {
        throw new ApprovalServiceError(
          'APPROVAL_CANDIDATE_GROUP_COVERAGE_INVALID',
          'companyIds precisa corresponder a todas as empresas ativas do grupo.',
          422,
        )
      }
      values.push(filters.businessGroupId)
      groupParameter = values.length
    }
    const clauses = [
      'membership.tenant_id = $1',
      "membership.status = 'active'",
      "user_row.status = 'active'",
      'user_row.deleted_at is null',
      'not user_row.platform_admin',
      `not exists (
        select 1 from roles internal_role
        where internal_role.id = membership.role_id
          and internal_role.role_key = any(array['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator']::text[])
      )`,
      groupParameter
        ? `corporate_user_can_decide_for_group_all($1, membership.id, $${groupParameter})`
        : requireDecisionInEveryCompany
        ? `not exists (
            select 1 from unnest($2::text[]) requested_company(company_id)
            where not corporate_user_can_decide_for_company($1, membership.id, requested_company.company_id)
          )`
        : 'corporate_user_has_company_access($1, membership.id, ($2::text[])[1])',
    ]
    if (filters.search?.trim()) {
      values.push(`%${filters.search.trim()}%`)
      clauses.push(`(user_row.name ilike $${values.length} or user_row.email::text ilike $${values.length})`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total
       from tenant_memberships membership
       join users user_row on user_row.id = membership.user_id
       where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 100)), Math.max(0, filters.offset || 0))
    const rows = await client.query<MembershipCandidateRow & { name: string; email: string }>(
      `select membership.id as membership_id, membership.user_id,
              membership.status as membership_status, membership.profile_key,
              role_row.role_key, user_row.platform_admin, membership.company_id,
              membership.allowed_company_ids, membership.allowed_group_ids,
              coalesce((
                select jsonb_object_agg(role_permission.permission_key, role_permission.allowed)
                from role_permissions role_permission where role_permission.role_id = role_row.id
              ), '{}'::jsonb) || membership.custom_permissions as permissions,
              user_row.metadata as user_metadata, user_row.name, user_row.email::text
       from tenant_memberships membership
       join users user_row on user_row.id = membership.user_id
       join roles role_row on role_row.id = membership.role_id
       where ${clauses.join(' and ')}
       order by lower(user_row.name), membership.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    const items: Array<Record<string, unknown>> = []
    for (const row of rows.rows) {
      if (!isCorporateApprovalMembershipEligible({
        roleKey: row.role_key,
        platformAdmin: row.platform_admin,
        tenantWide: false,
      })) continue
      const access = await resolveEffectiveCorporateAccessInTransaction(client, {
        tenantId: principal.tenantId,
        membershipId: row.membership_id,
        roleKey: row.role_key,
        platformAdmin: false,
        membershipPermissions: normalizeMembershipPermissions(row.permissions, row.profile_key),
        legacyCompanyId: row.company_id,
        legacyCompanyIds: row.allowed_company_ids || [],
        legacyGroupIds: row.allowed_group_ids || [],
      })
      if (access.summary.tenantWide) continue
      const companies = companyIds.map((companyId) => (
        access.summary.companies.find((candidate) => candidate.companyId === companyId) || null
      ))
      if (companies.some((company) => !company)) continue
      const companyAccess = companies.filter((company): company is NonNullable<typeof company> => Boolean(company))
      if (requireDecisionInEveryCompany && companyAccess.some((company) => (
        !hasExplicitCorporateCompanyPermission(access.summary, company.companyId, 'decidir_aprovacoes')
      ))) continue
      if (filters.allCompanies && filters.businessGroupId && !hasExplicitCorporateGroupAllPermission(
        access.summary,
        filters.businessGroupId,
        'decidir_aprovacoes',
      )) continue
      const effectiveProfiles = uniqueStrings(companyAccess.flatMap((company) => company.profiles))
      const effectivePermissions = Object.fromEntries(
        Object.keys(companyAccess[0].permissions).map((permission) => [
          permission,
          companyAccess.every((company) => company.permissions[permission as keyof Permissoes]),
        ]),
      ) as unknown as Permissoes
      items.push({
        membershipId: row.membership_id,
        userId: row.user_id,
        name: row.name,
        email: row.email,
        companyIds,
        businessGroupId: filters.businessGroupId || null,
        accessMode: filters.allCompanies ? 'all_companies' : null,
        companyAccess: companyAccess.map((company) => ({
          companyId: company.companyId,
          effectiveProfiles: company.profiles,
          effectivePermissions: company.permissions,
        })),
        effectiveProfiles,
        effectivePermissions,
        active: true,
        canDecideApprovals: companyAccess.every((company) => company.permissions.decidir_aprovacoes),
      })
    }
    return { items, total: Number(count.rows[0]?.total || 0) }
  })
}

export async function createApprovalAuthority(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = approvalAuthorityInputSchema.parse(rawInput)
  if (input.approvalKind === 'merit' || input.approvalKind === 'cost') {
    throw new ApprovalServiceError(
      'APPROVAL_MATRIX_REQUIRED_FOR_TRAVEL_AUTHORITY',
      'Alcadas de merito e custo devem ser criadas pela matriz governada de aprovacao.',
      409,
    )
  }
  const authorityId = await withTenantTransaction(
    principal.tenantId,
    (client) => insertApprovalAuthorityInTransaction(client, principal, input, 'effective'),
  ).catch((error) => {
    if (isUniqueViolation(error)) throw new ApprovalServiceError('APPROVAL_AUTHORITY_ALREADY_EXISTS', 'Ja existe uma alcada ativa equivalente.', 409)
    throw error
  })
  await auditApprovalChange(principal, 'approval.authority.created', authorityId, { membershipId: input.membershipId, kind: input.approvalKind })
  const result = await listApprovalAuthorities(principal, { membershipId: input.membershipId, limit: 200 })
  return result.items.find((item) => item.id === authorityId) || { id: authorityId }
}

async function insertApprovalAuthorityInTransaction(
  client: PoolClient,
  principal: RequestPrincipal,
  input: ApprovalAuthorityInput,
  statusMode: 'draft' | 'effective',
): Promise<string> {
  const target = await loadMembershipCandidate(client, principal.tenantId, input.membershipId)
  const targetPermissions = normalizeMembershipPermissions(target.permissions, target.profile_key)
  if (target.platform_admin) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_TARGET_INELIGIBLE', 'O usuario nao esta apto a receber alcada de aprovacao.', 422)
  }
  const scopeCompanyId = await assertAuthorityScope(client, principal, input)
  const scopedInput: ApprovalAuthorityInput = {
    ...input,
    companyId: scopeCompanyId || input.companyId || null,
  }
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
  assertEligibleCorporateAuthorityTarget(target, targetAccess.summary, scopedInput)
  if (scopeCompanyId && !targetAccess.summary.companies.some((company) => (
    company.companyId === scopeCompanyId && company.permissions.decidir_aprovacoes
  ))) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_SCOPE_DENIED', 'O usuario nao possui acesso a empresa da alcada.', 409)
  }
  if (input.groupId && (
    !targetAccess.summary.groupIds.includes(input.groupId)
    || !targetAccess.summary.companies.some((company) => (
      company.groupId === input.groupId && company.permissions.decidir_aprovacoes
    ))
  )) {
    throw new ApprovalServiceError('APPROVAL_AUTHORITY_SCOPE_DENIED', 'O usuario nao possui acesso ao grupo da alcada.', 409)
  }
  if (statusMode === 'effective') {
    await assertAuthorityCanBeGranted(client, principal, scopedInput)
  }
  const inserted = await client.query<{ id: string }>(
    `insert into approval_authorities (
       tenant_id, membership_id, approval_kind, company_id, group_id,
       cost_center_id, project_id, department, audience_group_id, approval_level,
       max_amount, accumulated_amount_limit,
       accumulation_period_days, max_percentage_above_lowest,
       max_percentage_above_average, requires_budget_available, urgent_allowed,
       currency, products, destinations, risk_levels, valid_from, valid_until, justification,
       status, created_by_membership_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19::text[], $20::text[], $21::text[], $22, $23, $24,
               case when $25 = 'draft' then 'draft'
                    when $22 > now() then 'scheduled' else 'active' end, $26)
     returning id`,
    [
      principal.tenantId, input.membershipId, input.approvalKind,
      scopedInput.companyId || null, input.groupId || null, input.costCenterId || null,
      input.projectId || null, input.department || null, input.audienceGroupId || null,
      input.approvalLevel, input.maxAmount ?? null,
      input.accumulatedAmountLimit ?? null, input.accumulationPeriodDays ?? null,
      input.maxPercentageAboveLowest ?? null, input.maxPercentageAboveAverage ?? null,
      input.requiresBudgetAvailable, input.urgentAllowed, input.currency || null,
      uniqueStrings(input.products), uniqueStrings(input.destinations),
      uniqueStrings(input.riskLevels), input.validFrom, input.validUntil || null,
      input.justification, statusMode, principal.membershipId,
    ],
  )
  return inserted.rows[0].id
}

function assertEligibleCorporateAuthorityTarget(
  target: MembershipCandidateRow,
  access: CorporateAccessSummary,
  input: ApprovalAuthorityInput,
): void {
  if (!isCorporateApprovalMembershipEligible({
    roleKey: target.role_key,
    platformAdmin: target.platform_admin,
    tenantWide: access.tenantWide,
  })) {
    throw new ApprovalServiceError(
      'APPROVAL_AUTHORITY_TARGET_INTERNAL',
      'A alcada deve ser atribuida a um usuario corporativo com acesso explicito, nao a uma identidade interna global.',
      422,
    )
  }
  if (input.groupId) {
    if (!hasExplicitCorporateGroupAllPermission(access, input.groupId, 'decidir_aprovacoes')) {
      throw new ApprovalServiceError(
        'APPROVAL_AUTHORITY_GROUP_ALL_REQUIRED',
        'A alcada de grupo exige um grant corporativo all_companies com permissao para decidir aprovacoes.',
        409,
      )
    }
    return
  }
  if (input.companyId) {
    if (!hasExplicitCorporateCompanyPermission(access, input.companyId, 'decidir_aprovacoes')) {
      throw new ApprovalServiceError(
        'APPROVAL_AUTHORITY_SCOPE_DENIED',
        'O usuario nao possui grant corporativo explicito para decidir aprovacoes nesta empresa.',
        409,
      )
    }
    return
  }
  const hasExplicitDecisionGrant = access.companies.some((company) => (
    hasExplicitCorporateCompanyPermission(access, company.companyId, 'decidir_aprovacoes')
  ))
  if (!hasExplicitDecisionGrant) {
    throw new ApprovalServiceError(
      'APPROVAL_AUTHORITY_TARGET_EXPLICIT_ACCESS_REQUIRED',
      'O usuario precisa de ao menos um grant corporativo explicito para receber alcada.',
      409,
    )
  }
}

export interface ApprovalMatrixDraftResult {
  matrixId: string
  stage: 'merit' | 'cost'
  scope: ApprovalMatrixInput['scope']
  authorityIds: string[]
  version: 1
  workflow: { id: string; versionId: string; code: string; status: GovernanceStatus; reused: boolean }
  policy: { id: string; versionId: string; code: string; status: GovernanceStatus; reused: boolean }
  status: 'draft'
  bindingState: 'draft_not_active'
  nextAction: 'submit_review'
}

export async function createApprovalMatrixDraft(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<ApprovalMatrixDraftResult> {
  const input = approvalMatrixInputSchema.parse(rawInput)
  const ruleSlotKey = approvalMatrixRuleSlotKey(input)
  const workflowScopes = matrixWorkflowScopes(input.scope)
  await assertCanManageWorkflowScopes(principal, workflowScopes)
  const matrixId = randomUUID()
  return withTenantTransaction(principal.tenantId, async (client) => {
    await validateMatrixRootScope(client, principal, input)
    await assertCompatibleCanonicalMatrixScope(client, principal.tenantId, input)
    const materializedAuthorities = await materializeMatrixAuthorities(client, principal, input)
    const authorityIds: string[] = []
    for (const authority of materializedAuthorities) {
      authorityIds.push(await insertApprovalAuthorityInTransaction(client, principal, authority, 'draft'))
    }

    const key = canonicalMatrixKey(input.scope, input.stage)
    const workflow = await ensureCanonicalMatrixWorkflow(client, principal, input, key, workflowScopes)
    const policy = await ensureCanonicalMatrixPolicy(client, principal, input, key, workflow.code)
    await client.query(
      `insert into approval_matrices (
         id, tenant_id, root_scope_type, company_id, business_group_id,
         access_mode, selected_company_ids, stage, rule_slot_key, authority_ids,
         workflow_definition_id, workflow_version_id,
         policy_definition_id, policy_version_id, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10::uuid[], $11, $12, $13, $14, $15)`,
      [
        matrixId,
        principal.tenantId,
        input.scope.type,
        input.scope.type === 'company' ? input.scope.companyId : null,
        input.scope.type === 'business_group' ? input.scope.businessGroupId : null,
        input.scope.type === 'business_group' ? input.scope.mode : null,
        input.scope.type === 'business_group' ? uniqueStrings(input.scope.companyIds) : [],
        input.stage,
        ruleSlotKey,
        authorityIds,
        workflow.id,
        workflow.versionId,
        policy.id,
        policy.versionId,
        principal.user.id,
      ],
    )
    await writeAuditEventInTransaction(client, {
      action: 'approval.matrix.created',
      result: 'success',
      tenantId: principal.tenantId,
      actorUserId: realActorUserId(principal),
      entityType: 'approval_matrix',
      entityId: matrixId,
      metadata: {
        stage: input.stage,
        scope: input.scope,
        authorityIds,
        workflowId: workflow.id,
        policyId: policy.id,
        bindingState: 'draft_not_active',
      },
    })
    return {
      matrixId,
      stage: input.stage,
      scope: input.scope,
      authorityIds,
      version: 1 as const,
      workflow,
      policy,
      status: 'draft' as const,
      bindingState: 'draft_not_active' as const,
      nextAction: 'submit_review' as const,
    }
  }).catch((error) => {
    if (isUniqueViolation(error)) {
      throw new ApprovalServiceError('APPROVAL_MATRIX_CONFLICT', 'Ja existe uma regra equivalente nesta matriz.', 409)
    }
    throw error
  })
}

export function approvalMatrixRuleSlotKey(input: ApprovalMatrixInput): string {
  const root = input.scope.type === 'company'
    ? { type: 'company' as const, id: input.scope.companyId, mode: null, companyIds: [] as string[] }
    : {
        type: 'business_group' as const,
        id: input.scope.businessGroupId,
        mode: input.scope.mode,
        companyIds: uniqueStrings(input.scope.companyIds),
      }
  const levelOnePredicates = input.authorities
    .filter((authority) => authority.approvalLevel === 1)
    .map((authority) => sha256({
      root,
      stage: input.stage,
      organizationalScope: {
        costCenterId: authority.costCenterId || null,
        projectId: authority.projectId || null,
        department: authority.department ? normalizeOrganizationalLabel(authority.department) : null,
        audienceGroupId: authority.audienceGroupId || null,
      },
      applicability: {
        currency: authority.currency?.toUpperCase() || null,
        products: uniqueStrings(authority.products || []),
        destinations: uniqueStrings(authority.destinations || []),
        riskLevels: uniqueStrings(authority.riskLevels || []),
      },
    }))
  const distinctSlots = uniqueStrings(levelOnePredicates)
  if (distinctSlots.length !== 1) {
    throw new ApprovalServiceError(
      'APPROVAL_MATRIX_MULTIPLE_RULE_SLOTS',
      'Uma matriz deve representar um unico recorte de regra; crie outra regra para predicados diferentes.',
      422,
    )
  }
  return distinctSlots[0]
}

export async function listApprovalMatrices(
  principal: RequestPrincipal,
  filters: {
    companyId?: string
    businessGroupId?: string
    includeInherited?: boolean
    stage?: 'merit' | 'cost'
    status?: 'draft' | 'in_review' | 'approved' | 'published' | 'archived'
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  if (filters.companyId) await requireCompanyAccess(principal, filters.companyId, 'gerenciar_workflows')
  if (filters.businessGroupId) await requireGroupAccess(principal, filters.businessGroupId, 'gerenciar_workflows')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId]
    const clauses = ['matrix.tenant_id = $1']
    if (filters.companyId) {
      values.push(filters.companyId)
      const companyParameter = values.length
      clauses.push(filters.includeInherited
        ? `(matrix.company_id = $${companyParameter} or (
             matrix.business_group_id = (
               select company.group_id from companies company
               where company.tenant_id = matrix.tenant_id and company.id = $${companyParameter}
                 and company.deleted_at is null
             )
             and (matrix.access_mode = 'all_companies' or $${companyParameter} = any(matrix.selected_company_ids))
           ))`
        : `matrix.company_id = $${companyParameter}`)
    }
    if (filters.businessGroupId) {
      values.push(filters.businessGroupId)
      clauses.push(`matrix.business_group_id = $${values.length}`)
    }
    if (filters.stage) {
      values.push(filters.stage)
      clauses.push(`matrix.stage = $${values.length}`)
    }
    if (filters.status) {
      values.push(filters.status)
      clauses.push(`matrix.status = $${values.length}`)
    }
    if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin' && !filters.companyId && !filters.businessGroupId) {
      values.push(
        principal.corporateAccess?.companies
          .filter((company) => company.permissions.gerenciar_workflows)
          .map((company) => company.companyId) || [],
      )
      const companiesParameter = values.length
      values.push(principal.corporateAccess?.groupIds || [])
      clauses.push(`(matrix.company_id = any($${companiesParameter}::text[]) or matrix.business_group_id = any($${values.length}::text[]))`)
    }
    const count = await client.query<{ total: string }>(
      `select count(*)::text as total from approval_matrices matrix where ${clauses.join(' and ')}`,
      values,
    )
    values.push(Math.min(200, Math.max(1, filters.limit || 50)), Math.max(0, filters.offset || 0))
    const rows = await client.query<{
      id: string
      root_scope_type: 'company' | 'business_group'
      company_id: string | null
      business_group_id: string | null
      access_mode: 'all_companies' | 'selected_companies' | null
      selected_company_ids: string[]
      stage: 'merit' | 'cost'
      authority_ids: string[]
      status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived'
      version: string | number
      created_by: string
      creator_name: string
      created_at: string | Date
      updated_at: string | Date
      workflow_id: string
      workflow_version_id: string
      workflow_code: string
      workflow_status: GovernanceStatus
      policy_id: string
      policy_version_id: string
      policy_code: string
      policy_status: GovernanceStatus
    }>(
      `select matrix.id, matrix.root_scope_type, matrix.company_id, matrix.business_group_id,
              matrix.access_mode, matrix.selected_company_ids, matrix.stage, matrix.authority_ids,
              matrix.status, matrix.version, matrix.created_by, creator.name as creator_name,
              matrix.created_at, matrix.updated_at,
              workflow.id as workflow_id, matrix.workflow_version_id,
              workflow.workflow_code, workflow.status as workflow_status,
              policy.id as policy_id, matrix.policy_version_id,
              policy.policy_code, policy.status as policy_status
       from approval_matrices matrix
       join users creator on creator.id = matrix.created_by
       join approval_workflow_definitions workflow
         on workflow.tenant_id = matrix.tenant_id and workflow.id = matrix.workflow_definition_id
       join policy_definitions policy
         on policy.tenant_id = matrix.tenant_id and policy.id = matrix.policy_definition_id
       where ${clauses.join(' and ')}
       order by matrix.created_at desc, matrix.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: rows.rows.map((row) => ({
        matrixId: row.id,
        stage: row.stage,
        scope: row.root_scope_type === 'company'
          ? { type: 'company', companyId: row.company_id }
          : {
              type: 'business_group',
              businessGroupId: row.business_group_id,
              mode: row.access_mode,
              companyIds: row.selected_company_ids,
            },
        authorityIds: row.authority_ids,
        workflow: {
          id: row.workflow_id,
          versionId: row.workflow_version_id,
          code: row.workflow_code,
          status: row.workflow_status,
        },
        policy: {
          id: row.policy_id,
          versionId: row.policy_version_id,
          code: row.policy_code,
          status: row.policy_status,
        },
        status: row.status,
        version: Number(row.version),
        bindingState: row.status === 'published' ? 'active' : 'draft_not_active',
        nextAction: matrixNextAction(row.status),
        createdBy: { userId: row.created_by, name: row.creator_name },
        isCreator: row.created_by === principal.user.id,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
      total: Number(count.rows[0]?.total || 0),
    }
  })
}

function matrixNextAction(status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived') {
  if (status === 'draft') return 'submit_review'
  if (status === 'in_review') return 'approve'
  if (status === 'approved') return 'publish'
  return 'none'
}

async function materializeMatrixAuthorities(
  client: PoolClient,
  principal: RequestPrincipal,
  input: ApprovalMatrixInput,
): Promise<ApprovalAuthorityInput[]> {
  const result: ApprovalAuthorityInput[] = []
  for (const template of input.authorities) {
    const stageBoundTemplate: ApprovalAuthorityInput = template.approvalLevel === 2
      ? { ...template, approvalKind: input.stage }
      : template
    const hasExplicitScope = Boolean(
      stageBoundTemplate.companyId || stageBoundTemplate.groupId || stageBoundTemplate.costCenterId || stageBoundTemplate.projectId
      || stageBoundTemplate.department || stageBoundTemplate.audienceGroupId,
    )
    if (input.scope.type === 'business_group' && hasExplicitScope) {
      throw new ApprovalServiceError(
        'APPROVAL_MATRIX_SCOPE_MISMATCH',
        'A matriz de grupo empresarial materializa a mesma regra em todas as empresas abrangidas e nao aceita recorte oculto por autoridade.',
        422,
      )
    }
    const candidates: ApprovalAuthorityInput[] = input.scope.type === 'company'
      ? [{ ...stageBoundTemplate, companyId: stageBoundTemplate.companyId || input.scope.companyId, groupId: null }]
      : input.scope.mode === 'all_companies'
        ? [hasExplicitScope ? stageBoundTemplate : { ...stageBoundTemplate, companyId: null, groupId: input.scope.businessGroupId }]
        : hasExplicitScope
          ? [stageBoundTemplate]
          : uniqueStrings(input.scope.companyIds).map((companyId) => ({ ...stageBoundTemplate, companyId, groupId: null }))

    for (const candidate of candidates) {
      if (input.scope.type === 'company' && candidate.groupId) {
        throw new ApprovalServiceError('APPROVAL_MATRIX_SCOPE_MISMATCH', 'A regra da empresa nao pode usar escopo de grupo.', 422)
      }
      if (input.scope.type === 'business_group' && candidate.groupId && candidate.groupId !== input.scope.businessGroupId) {
        throw new ApprovalServiceError('APPROVAL_MATRIX_SCOPE_MISMATCH', 'A regra referencia outro grupo empresarial.', 422)
      }
      if (input.scope.type === 'business_group' && input.scope.mode === 'selected_companies' && candidate.groupId) {
        throw new ApprovalServiceError('APPROVAL_MATRIX_SCOPE_MISMATCH', 'Escopo de grupo inteiro nao e permitido no modo empresas selecionadas.', 422)
      }
      const companyId = await assertAuthorityScope(client, principal, candidate)
      const normalized = approvalAuthorityInputSchema.parse({
        ...candidate,
        companyId: companyId || candidate.companyId || null,
      })
      if (input.scope.type === 'company' && normalized.companyId !== input.scope.companyId) {
        throw new ApprovalServiceError('APPROVAL_MATRIX_SCOPE_MISMATCH', 'O recorte da regra pertence a outra empresa.', 422)
      }
      if (input.scope.type === 'business_group' && normalized.companyId) {
        const belongs = await client.query(
          `select 1 from companies
           where tenant_id = $1 and id = $2 and group_id = $3 and deleted_at is null`,
          [principal.tenantId, normalized.companyId, input.scope.businessGroupId],
        )
        if (!belongs.rowCount) {
          throw new ApprovalServiceError('APPROVAL_MATRIX_SCOPE_MISMATCH', 'A empresa da regra nao pertence ao grupo.', 422)
        }
        if (input.scope.mode === 'selected_companies' && !input.scope.companyIds.includes(normalized.companyId)) {
          throw new ApprovalServiceError('APPROVAL_MATRIX_SCOPE_MISMATCH', 'A empresa da regra nao esta entre as empresas selecionadas.', 422)
        }
      }
      result.push(normalized)
    }
  }
  return result
}

async function validateMatrixRootScope(
  client: PoolClient,
  principal: RequestPrincipal,
  input: ApprovalMatrixInput,
): Promise<void> {
  const { scope } = input
  if (scope.type === 'company') {
    await assertDatabaseEntity(client, principal.tenantId, 'companies', scope.companyId)
    return
  }
  await assertDatabaseEntity(client, principal.tenantId, 'business_groups', scope.businessGroupId)
  let coveredCompanyIds: string[]
  if (scope.mode === 'selected_companies') {
    const companyIds = uniqueStrings(scope.companyIds)
    const companies = await client.query<{ id: string }>(
      `select id from companies
       where tenant_id = $1 and id = any($2::text[]) and group_id = $3 and deleted_at is null`,
      [principal.tenantId, companyIds, scope.businessGroupId],
    )
    if (companies.rowCount !== companyIds.length) {
      throw new ApprovalServiceError('APPROVAL_MATRIX_SCOPE_MISMATCH', 'Uma empresa selecionada nao pertence ao grupo.', 422)
    }
    coveredCompanyIds = companies.rows.map((company) => company.id)
  } else {
    const companies = await client.query<{ id: string }>(
      `select id from companies
       where tenant_id = $1 and group_id = $2 and deleted_at is null
       order by id`,
      [principal.tenantId, scope.businessGroupId],
    )
    coveredCompanyIds = companies.rows.map((company) => company.id)
  }
  if (!coveredCompanyIds.length) {
    throw new ApprovalServiceError(
      'APPROVAL_MATRIX_GROUP_EMPTY',
      'O grupo empresarial nao possui empresas ativas para receber a matriz.',
      422,
    )
  }
  for (const companyId of coveredCompanyIds) {
    await requireCompanyAccess(principal, companyId, 'gerenciar_workflows')
  }
  if (scope.mode === 'all_companies') {
    assertAllCompaniesMatrixActor(principal, scope.businessGroupId)
  }

  for (const membershipId of uniqueStrings(input.authorities.map((authority) => authority.membershipId))) {
    await assertApprovalMatrixTargetCoverage(client, principal.tenantId, membershipId, {
      coveredCompanyIds,
      allCompaniesGroupId: scope.mode === 'all_companies' ? scope.businessGroupId : null,
      lock: false,
    })
  }
}

function assertAllCompaniesMatrixActor(principal: RequestPrincipal, groupId: string): void {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin' || principal.corporateAccess?.tenantWide) return
  if (principal.corporateAccess && hasExplicitCorporateGroupAllPermission(
    principal.corporateAccess,
    groupId,
    'gerenciar_workflows',
  )) return
  throw new ApprovalServiceError(
    'APPROVAL_MATRIX_ALL_COMPANIES_ACCESS_REQUIRED',
    'A matriz para todas as empresas exige grant corporativo all_companies com permissao para gerenciar workflows.',
    403,
  )
}

async function assertApprovalMatrixTargetCoverage(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  options: {
    coveredCompanyIds: string[]
    allCompaniesGroupId: string | null
    lock: boolean
  },
): Promise<void> {
  const target = await loadMembershipCandidate(client, tenantId, membershipId, options.lock)
  const access = await resolveEffectiveCorporateAccessInTransaction(client, {
    tenantId,
    membershipId: target.membership_id,
    roleKey: target.role_key,
    platformAdmin: false,
    membershipPermissions: normalizeMembershipPermissions(target.permissions, target.profile_key),
    legacyCompanyId: target.company_id,
    legacyCompanyIds: target.allowed_company_ids || [],
    legacyGroupIds: target.allowed_group_ids || [],
  })
  if (!isCorporateApprovalMembershipEligible({
    roleKey: target.role_key,
    platformAdmin: target.platform_admin,
    tenantWide: access.summary.tenantWide,
  })) {
    throw new ApprovalServiceError(
      'APPROVAL_AUTHORITY_TARGET_INTERNAL',
      'A matriz deve usar autorizadores corporativos com grants explicitos, nao identidades internas globais.',
      422,
    )
  }
  const complete = options.allCompaniesGroupId
    ? hasExplicitCorporateGroupAllPermission(access.summary, options.allCompaniesGroupId, 'decidir_aprovacoes')
    : options.coveredCompanyIds.every((companyId) => (
        hasExplicitCorporateCompanyPermission(access.summary, companyId, 'decidir_aprovacoes')
      ))
  if (!complete) {
    throw new ApprovalServiceError(
      'APPROVAL_MATRIX_APPROVER_SCOPE_INCOMPLETE',
      options.allCompaniesGroupId
        ? 'Cada autorizador precisa de grant corporativo all_companies para decidir inclusive em empresas futuras do grupo.'
        : 'Cada autorizador da matriz precisa de grant corporativo explicito para decidir em todas as empresas abrangidas.',
      409,
    )
  }
}

async function lockCorporateApprovalTargetGrants(
  client: PoolClient,
  tenantId: string,
  membershipIds: string[],
): Promise<void> {
  if (!membershipIds.length) return
  await client.query(
    `select id from corporate_group_access_grants
     where tenant_id = $1 and membership_id = any($2::uuid[])
     for share`,
    [tenantId, membershipIds],
  )
  await client.query(
    `select id from corporate_company_access_grants
     where tenant_id = $1 and membership_id = any($2::uuid[])
     for share`,
    [tenantId, membershipIds],
  )
  await client.query(
    `select selected.group_access_grant_id, selected.company_id
     from corporate_group_access_companies selected
     join corporate_group_access_grants grant_row
       on grant_row.tenant_id = selected.tenant_id
      and grant_row.id = selected.group_access_grant_id
     where selected.tenant_id = $1 and grant_row.membership_id = any($2::uuid[])
     for share of selected`,
    [tenantId, membershipIds],
  )
}

async function assertCompatibleCanonicalMatrixScope(
  client: PoolClient,
  tenantId: string,
  input: ApprovalMatrixInput,
): Promise<void> {
  if (input.scope.type !== 'business_group') return
  const existing = await client.query<{ access_mode: string; selected_company_ids: string[] }>(
    `select access_mode, selected_company_ids
     from approval_matrices
     where tenant_id = $1 and business_group_id = $2 and stage = $3
     order by created_at limit 1`,
    [tenantId, input.scope.businessGroupId, input.stage],
  )
  const row = existing.rows[0]
  if (!row) return
  const sameMode = row.access_mode === input.scope.mode
  const sameCompanies = JSON.stringify(uniqueStrings(row.selected_company_ids || []))
    === JSON.stringify(uniqueStrings(input.scope.companyIds))
  if (!sameMode || !sameCompanies) {
    throw new ApprovalServiceError(
      'APPROVAL_MATRIX_SCOPE_VERSION_REQUIRED',
      'A abrangencia do workflow-base deste grupo ja foi definida. Altere-a por uma nova versao revisada.',
      409,
    )
  }
}

function matrixWorkflowScopes(scope: ApprovalMatrixInput['scope']): WorkflowScope[] {
  if (scope.type === 'company') {
    return [{ type: 'company', id: scope.companyId, mode: 'include', specificity: 100 }]
  }
  return [{ type: 'group', id: scope.businessGroupId, mode: 'include', specificity: 50 }]
}

function canonicalMatrixKey(scope: ApprovalMatrixInput['scope'], stage: 'merit' | 'cost') {
  const rootId = scope.type === 'company' ? scope.companyId : scope.businessGroupId
  const rootType = scope.type === 'company' ? 'company' : 'group'
  const fingerprint = sha256({ rootType, rootId, stage }).slice(0, 20)
  return {
    workflowCode: `matrix.${stage}.${rootType}.${fingerprint}`,
    policyCode: `matrix.trigger.${stage}.${rootType}.${fingerprint}`,
  }
}

function generatedMatrixWorkflowInput(
  input: ApprovalMatrixInput,
  workflowCode: string,
  scopes: WorkflowScope[],
): ApprovalWorkflowDraftInput {
  return approvalWorkflowDraftInputSchema.parse({
    workflowCode,
    name: input.workflow.name,
    description: input.workflow.description,
    workflowType: input.stage,
    scopes,
    nodes: [
      { id: 'start', key: 'start', name: 'Inicio', type: 'start' },
      {
        id: 'level_1', key: 'level_1', name: 'Autorizacao de primeiro nivel', type: 'approval',
        approvalKind: input.stage, completionMode: 'any',
        approverResolution: {
          selectors: [{ type: 'authority', configuration: { level: 1, onLimitExceeded: 'escalate' } }],
          combination: 'all', minimumApprovers: 1, maximumApprovers: 1,
          allowSelfApproval: false, separationOfDuties: ['requester', 'traveler'],
        },
      },
      {
        id: 'level_2', key: 'level_2', name: 'Autorizacao de segundo nivel', type: 'approval',
        approvalKind: input.stage, completionMode: 'any',
        approverResolution: {
          selectors: [{ type: 'authority', configuration: { level: 2 } }],
          combination: 'all', minimumApprovers: 1, maximumApprovers: 1,
          allowSelfApproval: false, separationOfDuties: ['requester', 'traveler', 'prior_approver'],
        },
      },
      { id: 'end', key: 'end', name: 'Fim', type: 'end' },
    ],
    edges: [
      { id: 'start_l1', sourceNodeId: 'start', targetNodeId: 'level_1', sequence: 0 },
      {
        id: 'l1_l2', sourceNodeId: 'level_1', targetNodeId: 'level_2', sequence: 0,
        condition: { fact: 'routing.requiresSecondLevel', operator: 'eq', value: true },
      },
      {
        id: 'l1_end', sourceNodeId: 'level_1', targetNodeId: 'end', sequence: 1,
        condition: { fact: 'routing.requiresSecondLevel', operator: 'neq', value: true },
      },
      { id: 'l2_end', sourceNodeId: 'level_2', targetNodeId: 'end', sequence: 0 },
    ],
    rules: [],
    slas: [],
    changeSummary: input.workflow.changeSummary,
    validFrom: null,
    validUntil: null,
  })
}

async function ensureCanonicalMatrixWorkflow(
  client: PoolClient,
  principal: RequestPrincipal,
  input: ApprovalMatrixInput,
  key: { workflowCode: string },
  scopes: WorkflowScope[],
): Promise<{ id: string; versionId: string; code: string; status: GovernanceStatus; reused: boolean }> {
  const existing = await client.query<WorkflowDefinitionRow & { version_id: string; graph_snapshot: unknown }>(
    `select definition.*, version.id as version_id, version.graph_snapshot
     from approval_workflow_definitions definition
     join approval_workflow_versions version
       on version.tenant_id = definition.tenant_id
      and version.workflow_definition_id = definition.id
      and version.version_number = definition.current_version
     where definition.tenant_id = $1 and definition.workflow_code = $2`,
    [principal.tenantId, key.workflowCode],
  )
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'archived') {
      throw new ApprovalServiceError('APPROVAL_MATRIX_BASE_ARCHIVED', 'O workflow-base canonico esta arquivado.', 409)
    }
    await assertCanonicalMatrixWorkflowReuse(client, principal.tenantId, input, scopes, existing.rows[0])
    return {
      id: existing.rows[0].id,
      versionId: existing.rows[0].version_id,
      code: key.workflowCode,
      status: existing.rows[0].status,
      reused: true,
    }
  }
  const workflowId = randomUUID()
  const prepared = prepareWorkflowSnapshot(workflowId, randomUUID(), 1, generatedMatrixWorkflowInput(input, key.workflowCode, scopes))
  await client.query(
    `insert into approval_workflow_definitions (
       id, tenant_id, workflow_code, name, description, workflow_type,
       status, current_version, created_by
     ) values ($1, $2, $3, $4, $5, $6, 'draft', 1, $7)`,
    [workflowId, principal.tenantId, key.workflowCode, input.workflow.name, input.workflow.description, input.stage, principal.user.id],
  )
  const workflowInput = generatedMatrixWorkflowInput(input, key.workflowCode, scopes)
  await insertWorkflowVersion(client, principal, workflowId, prepared, input.workflow.changeSummary)
  await insertWorkflowChildren(client, principal.tenantId, prepared, workflowInput)
  await insertWorkflowChangeAudit(
    client, principal, workflowId, prepared.snapshot.workflowVersionId,
    'matrix_base_created', input.workflow.changeSummary, null, prepared.snapshot,
  )
  return {
    id: workflowId,
    versionId: prepared.snapshot.workflowVersionId,
    code: key.workflowCode,
    status: 'draft',
    reused: false,
  }
}

async function assertCanonicalMatrixWorkflowReuse(
  client: PoolClient,
  tenantId: string,
  input: ApprovalMatrixInput,
  scopes: WorkflowScope[],
  existing: WorkflowDefinitionRow & { version_id: string; graph_snapshot: unknown },
): Promise<void> {
  const provenance = await client.query(
    `select 1 from approval_matrices matrix
     where matrix.tenant_id = $1 and matrix.workflow_definition_id = $2 and matrix.stage = $3
       and (
         ($4 = 'company' and matrix.root_scope_type = 'company' and matrix.company_id = $5)
         or ($4 = 'business_group' and matrix.root_scope_type = 'business_group' and matrix.business_group_id = $5)
       )
     limit 1`,
    [
      tenantId,
      existing.id,
      input.stage,
      input.scope.type,
      input.scope.type === 'company' ? input.scope.companyId : input.scope.businessGroupId,
    ],
  )
  const actualScopes = await loadWorkflowScopes(client, tenantId, existing.version_id)
  const actualSnapshot = approvalWorkflowSnapshotSchema.safeParse(existing.graph_snapshot)
  const expectedInput = generatedMatrixWorkflowInput(input, existing.workflow_code, scopes)
  if (
    !provenance.rowCount
    || existing.workflow_type !== input.stage
    || !actualSnapshot.success
    || matrixWorkflowShapeHash(actualSnapshot.success ? actualSnapshot.data.nodes : [], actualSnapshot.success ? actualSnapshot.data.edges : [])
      !== matrixWorkflowShapeHash(expectedInput.nodes, expectedInput.edges)
    || sha256(normalizeWorkflowScopes(actualScopes)) !== sha256(normalizeWorkflowScopes(scopes))
  ) {
    throw new ApprovalServiceError(
      'APPROVAL_MATRIX_CANONICAL_WORKFLOW_COLLISION',
      'O codigo canonico da matriz ja existe sem proveniencia ou formato compativel.',
      409,
    )
  }
}

function matrixWorkflowShapeHash(
  nodes: ApprovalWorkflowDraftInput['nodes'],
  edges: ApprovalWorkflowDraftInput['edges'],
): string {
  const keyById = new Map(nodes.map((node) => [node.id, node.key]))
  return sha256({
    nodes: nodes.map(({ id: _id, ...node }) => node).sort((left, right) => left.key.localeCompare(right.key)),
    edges: edges.map(({ id: _id, sourceNodeId, targetNodeId, ...edge }) => ({
      ...edge,
      source: keyById.get(sourceNodeId) || sourceNodeId,
      target: keyById.get(targetNodeId) || targetNodeId,
    })).sort((left, right) => (
      left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.sequence - right.sequence
    )),
  })
}

function normalizeWorkflowScopes(scopes: WorkflowScope[]): WorkflowScope[] {
  return [...scopes].sort((left, right) => (
    left.type.localeCompare(right.type)
    || String(left.id || '').localeCompare(String(right.id || ''))
    || left.mode.localeCompare(right.mode)
    || left.specificity - right.specificity
  ))
}

async function ensureCanonicalMatrixPolicy(
  client: PoolClient,
  principal: RequestPrincipal,
  input: ApprovalMatrixInput,
  key: { policyCode: string },
  workflowCode: string,
): Promise<{ id: string; versionId: string; code: string; status: GovernanceStatus; reused: boolean }> {
  const existing = await client.query<{
    id: string
    status: GovernanceStatus
    version_id: string
    category: string
    condition_ast: unknown
    actions_ast: unknown
    checkpoints: string[]
  }>(
    `select definition.id, definition.status, definition.category,
            version.id as version_id, version.condition_ast, version.actions_ast, version.checkpoints
     from policy_definitions definition
     join policy_versions version
       on version.tenant_id = definition.tenant_id
      and version.policy_definition_id = definition.id
      and version.version_number = definition.current_version
     where definition.tenant_id = $1 and definition.policy_code = $2`,
    [principal.tenantId, key.policyCode],
  )
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'archived') {
      throw new ApprovalServiceError('APPROVAL_MATRIX_BASE_ARCHIVED', 'A politica-base canonica esta arquivada.', 409)
    }
    await assertCanonicalMatrixPolicyReuse(
      client,
      principal.tenantId,
      input,
      workflowCode,
      existing.rows[0],
    )
    return {
      id: existing.rows[0].id,
      versionId: existing.rows[0].version_id,
      code: key.policyCode,
      status: existing.rows[0].status,
      reused: true,
    }
  }
  const policyId = randomUUID()
  const versionId = randomUUID()
  const checkpoints = input.stage === 'merit' ? ['submission'] : ['selection', 'reservation']
  const condition = input.scope.type === 'business_group' && input.scope.mode === 'selected_companies'
    ? { all: [
        { fact: 'operation.checkpoint', operator: 'in', value: checkpoints },
        { fact: 'organization.companyId', operator: 'in', value: uniqueStrings(input.scope.companyIds) },
      ] }
    : { fact: 'operation.checkpoint', operator: 'in', value: checkpoints }
  const action = {
    type: 'request_approval',
    message: `Autorizacao ${input.stage === 'merit' ? 'de merito' : 'de custo'} obrigatoria.`,
    configuration: { workflow: workflowCode },
  }
  const scope = input.scope.type === 'company'
    ? { type: 'company', id: input.scope.companyId, specificity: 100 }
    : { type: 'group', id: input.scope.businessGroupId, specificity: 50 }
  const content = {
    code: key.policyCode,
    condition,
    actions: [action],
    checkpoints,
    scope,
    dependency: workflowCode,
  }
  await client.query(
    `insert into policy_definitions (
       id, tenant_id, policy_code, name, description, category, status, priority,
       severity, inheritance_mode, overridable, business_justification, tags,
       current_version, created_by
     ) values ($1, $2, $3, $4, $5, $6, 'draft', 100, 'warning', 'replace', true, $7, $8::text[], 1, $9)`,
    [
      policyId, principal.tenantId, key.policyCode,
      `Gatilho da matriz - ${input.workflow.name}`,
      `Politica-base canonica para encaminhar solicitacoes ao workflow ${workflowCode}.`,
      `approval_matrix_${input.stage}`,
      'Matriz de autorizacao corporativa parametrizada e sujeita a maker-checker.',
      ['approval_matrix', input.stage],
      principal.user.id,
    ],
  )
  await client.query(
    `insert into policy_versions (
       id, tenant_id, policy_definition_id, version_number, status, name, description,
       category, priority, severity, inheritance_mode, overridable, condition_ast,
       actions_ast, exception_ast, checkpoints, timezone, valid_from, valid_until, tags,
       business_justification, content_hash, change_summary, created_by
     ) values ($1, $2, $3, 1, 'draft', $4, $5, $6, 100, 'warning', 'replace', true,
               $7::jsonb, $8::jsonb, '[]'::jsonb, $9::text[], 'America/Sao_Paulo', null, null,
               $10::text[], $11, $12, $13, $14)`,
    [
      versionId, principal.tenantId, policyId,
      `Gatilho da matriz - ${input.workflow.name}`,
      `Politica-base canonica para encaminhar solicitacoes ao workflow ${workflowCode}.`,
      `approval_matrix_${input.stage}`,
      JSON.stringify(condition), JSON.stringify([action]), checkpoints,
      ['approval_matrix', input.stage],
      'Matriz de autorizacao corporativa parametrizada e sujeita a maker-checker.',
      sha256(content), input.workflow.changeSummary, principal.user.id,
    ],
  )
  await client.query(
    `insert into policy_scopes (
       tenant_id, policy_version_id, scope_type, scope_id, mode, specificity
     ) values ($1, $2, $3, $4, 'include', $5)`,
    [principal.tenantId, versionId, scope.type, scope.id, scope.specificity],
  )
  const ruleSet = await client.query<{ id: string }>(
    `insert into policy_rule_sets (tenant_id, policy_version_id, name, logical_operator)
     values ($1, $2, 'Gatilho da matriz', 'all') returning id`,
    [principal.tenantId, versionId],
  )
  await client.query(
    `insert into policy_conditions (tenant_id, rule_set_id, sequence, condition_ast)
     values ($1, $2, 0, $3::jsonb)`,
    [principal.tenantId, ruleSet.rows[0].id, JSON.stringify(condition)],
  )
  await client.query(
    `insert into policy_actions (
       tenant_id, policy_version_id, action_type, sequence, configuration, idempotency_scope
     ) values ($1, $2, 'request_approval', 0, $3::jsonb, $4)`,
    [
      principal.tenantId, versionId,
      JSON.stringify({ message: action.message, ...action.configuration }),
      `${versionId}:0`,
    ],
  )
  await client.query(
    `insert into policy_dependencies (
       tenant_id, policy_version_id, dependency_type, dependency_key, required, configuration
     ) values ($1, $2, 'workflow', $3, true, '{}'::jsonb)`,
    [principal.tenantId, versionId, workflowCode],
  )
  return { id: policyId, versionId, code: key.policyCode, status: 'draft', reused: false }
}

async function assertCanonicalMatrixPolicyReuse(
  client: PoolClient,
  tenantId: string,
  input: ApprovalMatrixInput,
  workflowCode: string,
  existing: {
    id: string
    version_id: string
    category: string
    condition_ast: unknown
    actions_ast: unknown
    checkpoints: string[]
  },
): Promise<void> {
  const rootId = input.scope.type === 'company' ? input.scope.companyId : input.scope.businessGroupId
  const provenance = await client.query(
    `select 1 from approval_matrices matrix
     where matrix.tenant_id = $1 and matrix.policy_definition_id = $2 and matrix.stage = $3
       and (
         ($4 = 'company' and matrix.root_scope_type = 'company' and matrix.company_id = $5)
         or ($4 = 'business_group' and matrix.root_scope_type = 'business_group' and matrix.business_group_id = $5)
       )
     limit 1`,
    [tenantId, existing.id, input.stage, input.scope.type, rootId],
  )
  const scopes = await client.query<{
    scope_type: string
    scope_id: string | null
    mode: string
    specificity: number
  }>(
    `select scope_type, scope_id, mode, specificity from policy_scopes
     where tenant_id = $1 and policy_version_id = $2`,
    [tenantId, existing.version_id],
  )
  const dependencies = await client.query<{ dependency_key: string }>(
    `select dependency_key from policy_dependencies
     where tenant_id = $1 and policy_version_id = $2 and dependency_type = 'workflow' and required
     order by dependency_key`,
    [tenantId, existing.version_id],
  )
  const checkpoints = input.stage === 'merit' ? ['submission'] : ['selection', 'reservation']
  const expectedCondition = input.scope.type === 'business_group' && input.scope.mode === 'selected_companies'
    ? { all: [
        { fact: 'operation.checkpoint', operator: 'in', value: checkpoints },
        { fact: 'organization.companyId', operator: 'in', value: uniqueStrings(input.scope.companyIds) },
      ] }
    : { fact: 'operation.checkpoint', operator: 'in', value: checkpoints }
  const expectedScope = input.scope.type === 'company'
    ? [{ scope_type: 'company', scope_id: input.scope.companyId, mode: 'include', specificity: 100 }]
    : [{ scope_type: 'group', scope_id: input.scope.businessGroupId, mode: 'include', specificity: 50 }]
  const actions = Array.isArray(existing.actions_ast) ? existing.actions_ast.map(asRecord) : []
  const canonicalAction = actions.length === 1
    && actions[0].type === 'request_approval'
    && asRecord(actions[0].configuration).workflow === workflowCode
  if (
    !provenance.rowCount
    || existing.category !== `approval_matrix_${input.stage}`
    || !canonicalAction
    || sha256(existing.condition_ast) !== sha256(expectedCondition)
    || sha256(uniqueStrings(existing.checkpoints || [])) !== sha256(uniqueStrings(checkpoints))
    || sha256(scopes.rows) !== sha256(expectedScope)
    || dependencies.rows.length !== 1
    || dependencies.rows[0].dependency_key !== workflowCode
  ) {
    throw new ApprovalServiceError(
      'APPROVAL_MATRIX_CANONICAL_POLICY_COLLISION',
      'O codigo canonico da politica ja existe sem proveniencia ou formato compativel.',
      409,
    )
  }
}

export async function transitionApprovalMatrix(
  principal: RequestPrincipal,
  matrixId: string,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  assertUuid(matrixId, 'APPROVAL_MATRIX_ID_INVALID')
  const input = approvalMatrixTransitionSchema.parse(rawInput)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{
      id: string
      root_scope_type: 'company' | 'business_group'
      company_id: string | null
      business_group_id: string | null
      access_mode: 'all_companies' | 'selected_companies' | null
      selected_company_ids: string[]
      stage: 'merit' | 'cost'
      rule_slot_key: string
      authority_ids: string[]
      workflow_definition_id: string
      workflow_version_id: string
      policy_definition_id: string
      policy_version_id: string
      status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived'
      version: string | number
      created_by: string
    }>(
      `select * from approval_matrices where tenant_id = $1 and id = $2 for update`,
      [principal.tenantId, matrixId],
    )
    const matrix = result.rows[0]
    if (!matrix) throw new ApprovalServiceError('APPROVAL_MATRIX_NOT_FOUND', 'Matriz de aprovacao nao encontrada.', 404)
    await assertCanManageWorkflowScopes(principal, [{
      type: matrix.root_scope_type === 'company' ? 'company' : 'group',
      id: matrix.company_id || matrix.business_group_id,
    }])
    let coveredCompanyIds = matrix.company_id ? [matrix.company_id] : []
    if (matrix.root_scope_type === 'business_group' && matrix.business_group_id) {
      const coveredCompanies = matrix.access_mode === 'selected_companies'
        ? await client.query<{ id: string }>(
            `select id from companies
             where tenant_id = $1 and group_id = $2 and id = any($3::text[]) and deleted_at is null
             order by id`,
            [principal.tenantId, matrix.business_group_id, uniqueStrings(matrix.selected_company_ids || [])],
          )
        : await client.query<{ id: string }>(
            `select id from companies
             where tenant_id = $1 and group_id = $2 and deleted_at is null
             order by id`,
            [principal.tenantId, matrix.business_group_id],
          )
      const expectedCoverage = matrix.access_mode === 'selected_companies'
        ? uniqueStrings(matrix.selected_company_ids || []).length
        : coveredCompanies.rowCount
      if (!coveredCompanies.rowCount || coveredCompanies.rowCount !== expectedCoverage) {
        throw new ApprovalServiceError(
          'APPROVAL_MATRIX_SCOPE_DRIFT',
          'A abrangencia empresarial da matriz mudou e precisa ser revisada antes da transicao.',
          409,
        )
      }
      for (const company of coveredCompanies.rows) {
        await requireCompanyAccess(principal, company.id, 'gerenciar_workflows')
      }
      coveredCompanyIds = coveredCompanies.rows.map((company) => company.id)
      if (matrix.access_mode === 'all_companies') {
        assertAllCompaniesMatrixActor(principal, matrix.business_group_id)
      }
    }
    if (Number(matrix.version) !== input.expectedVersion) {
      throw new ApprovalServiceError('STALE_APPROVAL_MATRIX', 'A matriz foi alterada por outro usuario.', 409)
    }
    const allowed: Record<ApprovalMatrixTransitionInput['action'], typeof matrix.status[]> = {
      submit_review: ['draft'],
      approve: ['in_review'],
      publish: ['approved'],
      archive: ['draft', 'in_review', 'approved'],
    }
    if (!allowed[input.action].includes(matrix.status)) {
      throw new ApprovalServiceError('INVALID_APPROVAL_MATRIX_TRANSITION', 'Transicao invalida para o estado atual da matriz.', 409)
    }
    if (['approve', 'publish'].includes(input.action) && matrix.created_by === principal.user.id) {
      throw new ApprovalServiceError(
        'APPROVAL_MATRIX_SEPARATION_OF_DUTIES',
        'O autor da matriz nao pode aprovar nem publicar a propria alteracao.',
        409,
      )
    }

    let nextStatus: typeof matrix.status
    let nextAction: string
    if (input.action === 'submit_review') {
      await client.query(
        `update approval_workflow_versions set status = 'in_review'
         where tenant_id = $1 and id = $2 and status = 'draft'`,
        [principal.tenantId, matrix.workflow_version_id],
      )
      await client.query(
        `update approval_workflow_definitions set status = 'in_review'
         where tenant_id = $1 and id = $2 and status = 'draft'`,
        [principal.tenantId, matrix.workflow_definition_id],
      )
      await client.query(
        `update policy_versions set status = 'in_review'
         where tenant_id = $1 and id = $2 and status = 'draft'`,
        [principal.tenantId, matrix.policy_version_id],
      )
      await client.query(
        `update policy_definitions set status = 'in_review'
         where tenant_id = $1 and id = $2 and status = 'draft'`,
        [principal.tenantId, matrix.policy_definition_id],
      )
      nextStatus = 'in_review'
      nextAction = 'approve'
    } else if (input.action === 'approve') {
      const workflowVersion = await client.query<WorkflowVersionRow>(
        `select * from approval_workflow_versions
         where tenant_id = $1 and id = $2 and workflow_definition_id = $3 for update`,
        [principal.tenantId, matrix.workflow_version_id, matrix.workflow_definition_id],
      )
      const workflowRow = workflowVersion.rows[0]
      if (!workflowRow) throw new ApprovalServiceError('WORKFLOW_VERSION_NOT_FOUND', 'Versao do workflow-base nao encontrada.', 404)
      if (workflowRow.status === 'in_review') {
        if (workflowRow.created_by === principal.user.id) {
          throw new ApprovalServiceError(
            'APPROVAL_MATRIX_DEPENDENCY_SEPARATION_OF_DUTIES',
            'O autor do workflow-base nao pode aprovar a propria versao por outra regra da matriz.',
            409,
          )
        }
        assertWorkflowPublishable(approvalWorkflowSnapshotSchema.parse(workflowRow.graph_snapshot))
        await client.query(
          `update approval_workflow_versions
           set status = 'approved', approved_by = $3, approved_at = now()
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, matrix.workflow_version_id, principal.user.id],
        )
        await client.query(
          `update approval_workflow_definitions set status = 'approved'
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, matrix.workflow_definition_id],
        )
      } else if (!['approved', 'published'].includes(workflowRow.status)) {
        throw new ApprovalServiceError('APPROVAL_MATRIX_DEPENDENCY_STATE_INVALID', 'O workflow-base nao esta em revisao.', 409)
      }

      const policyVersion = await client.query<{ status: GovernanceStatus; created_by: string }>(
        `select status, created_by from policy_versions
         where tenant_id = $1 and id = $2 and policy_definition_id = $3 for update`,
        [principal.tenantId, matrix.policy_version_id, matrix.policy_definition_id],
      )
      const policyStatus = policyVersion.rows[0]?.status
      if (policyStatus === 'in_review') {
        if (policyVersion.rows[0].created_by === principal.user.id) {
          throw new ApprovalServiceError(
            'APPROVAL_MATRIX_DEPENDENCY_SEPARATION_OF_DUTIES',
            'O autor da politica-base nao pode aprovar a propria versao por outra regra da matriz.',
            409,
          )
        }
        await client.query(
          `update policy_versions
           set status = 'approved', approved_by = $3, approved_at = now()
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, matrix.policy_version_id, principal.user.id],
        )
        await client.query(
          `update policy_definitions set status = 'approved'
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, matrix.policy_definition_id],
        )
      } else if (!policyStatus || !['approved', 'published'].includes(policyStatus)) {
        throw new ApprovalServiceError('APPROVAL_MATRIX_DEPENDENCY_STATE_INVALID', 'A politica-base nao esta em revisao.', 409)
      }
      nextStatus = 'approved'
      nextAction = 'publish'
    } else if (input.action === 'publish') {
      await assertApprovalMatrixRuleSlotAvailable(
        client,
        principal.tenantId,
        matrix.id,
        matrix.rule_slot_key,
      )
      const dependencies = await client.query<{
        workflow_status: GovernanceStatus
        workflow_approved_by: string | null
        workflow_created_by: string
        policy_status: GovernanceStatus
        policy_approved_by: string | null
        policy_created_by: string
      }>(
        `select workflow_version.status as workflow_status,
                workflow_version.approved_by as workflow_approved_by,
                workflow_version.created_by as workflow_created_by,
                policy_version.status as policy_status,
                policy_version.approved_by as policy_approved_by,
                policy_version.created_by as policy_created_by
         from approval_workflow_versions workflow_version, policy_versions policy_version
         where workflow_version.tenant_id = $1 and workflow_version.id = $2
           and workflow_version.workflow_definition_id = $3
           and policy_version.tenant_id = $1 and policy_version.id = $4
           and policy_version.policy_definition_id = $5
         for update`,
        [
          principal.tenantId,
          matrix.workflow_version_id,
          matrix.workflow_definition_id,
          matrix.policy_version_id,
          matrix.policy_definition_id,
        ],
      )
      const dependency = dependencies.rows[0]
      if (!dependency || !['approved', 'published'].includes(dependency.workflow_status)
        || !['approved', 'published'].includes(dependency.policy_status)) {
        throw new ApprovalServiceError(
          'APPROVAL_MATRIX_DEPENDENCIES_NOT_APPROVED',
          'O workflow-base e a politica de gatilho precisam estar aprovados antes da publicacao.',
          409,
        )
      }
      if (
        (dependency.workflow_status === 'approved' && dependency.workflow_created_by === principal.user.id)
        || (dependency.policy_status === 'approved' && dependency.policy_created_by === principal.user.id)
      ) {
        throw new ApprovalServiceError(
          'APPROVAL_MATRIX_DEPENDENCY_SEPARATION_OF_DUTIES',
          'O autor do workflow-base ou da politica-base nao pode publicar a propria versao.',
          409,
        )
      }
      if (dependency.workflow_status === 'approved') {
        await client.query(
          `update approval_workflow_versions
           set status = 'published', published_by = $3, published_at = now()
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, matrix.workflow_version_id, principal.user.id],
        )
        await client.query(
          `update approval_workflow_definitions set status = 'published'
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, matrix.workflow_definition_id],
        )
      }
      const expectedAuthorityIds = uniqueStrings(matrix.authority_ids)
      const draftAuthorities = await client.query<AuthorityRow>(
        `select * from approval_authorities
         where tenant_id = $1 and id = any($2::uuid[]) and status = 'draft'
         for update`,
        [principal.tenantId, expectedAuthorityIds],
      )
      if (draftAuthorities.rowCount !== expectedAuthorityIds.length) {
        throw new ApprovalServiceError(
          'APPROVAL_MATRIX_AUTHORITY_SET_INVALID',
          'O conjunto de alcadas em rascunho foi alterado e nao pode ser publicado.',
          409,
        )
      }
      const targetMembershipIds = uniqueStrings(draftAuthorities.rows.map((authority) => authority.membership_id))
      await lockCorporateApprovalTargetGrants(client, principal.tenantId, targetMembershipIds)
      for (const membershipId of targetMembershipIds) {
        await assertApprovalMatrixTargetCoverage(client, principal.tenantId, membershipId, {
          coveredCompanyIds,
          allCompaniesGroupId: matrix.root_scope_type === 'business_group'
            && matrix.access_mode === 'all_companies'
            ? matrix.business_group_id
            : null,
          lock: true,
        })
      }
      await replaceEquivalentAuthoritiesBeforeMatrixPublication(
        client,
        principal,
        expectedAuthorityIds,
        input.reason,
      )
      const activatedAuthorities = await client.query(
        `update approval_authorities
         set status = case
           when valid_until is not null and valid_until <= now() then 'expired'
           when valid_from > now() then 'scheduled'
           else 'active'
         end
         where tenant_id = $1 and id = any($2::uuid[]) and status = 'draft'`,
        [principal.tenantId, expectedAuthorityIds],
      )
      if (activatedAuthorities.rowCount !== expectedAuthorityIds.length) {
        throw new ApprovalServiceError(
          'APPROVAL_MATRIX_AUTHORITY_ACTIVATION_FAILED',
          'Nem todas as alcadas da matriz puderam ser ativadas.',
          409,
        )
      }
      if (dependency.policy_status === 'approved') {
        await assertPolicyVersionPublishableInTransaction(
          client,
          principal,
          matrix.policy_definition_id,
          matrix.policy_version_id,
        )
        await client.query(
          `update policy_publications
           set effective_until = case when effective_from < now() then now() else effective_until end,
               status = case when effective_from > now() then 'revoked' else 'expired' end
           where tenant_id = $1 and policy_definition_id = $2
             and status in ('active', 'scheduled')`,
          [principal.tenantId, matrix.policy_definition_id],
        )
        await client.query(
          `update policy_versions
           set status = 'published', published_by = $3, published_at = now()
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, matrix.policy_version_id, principal.user.id],
        )
        await client.query(
          `update policy_definitions set status = 'published'
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, matrix.policy_definition_id],
        )
        await client.query(
          `insert into policy_publications (
             tenant_id, policy_definition_id, policy_version_id, status,
             effective_from, effective_until, published_by, approved_by, publication_reason
           ) values ($1, $2, $3, 'active', now(), null, $4, $5, $6)`,
          [
            principal.tenantId,
            matrix.policy_definition_id,
            matrix.policy_version_id,
            principal.user.id,
            dependency.policy_approved_by,
            input.reason,
          ],
        )
      } else {
        const activePublication = await client.query(
          `select 1 from policy_publications
           where tenant_id = $1 and policy_definition_id = $2 and policy_version_id = $3
             and status = 'active' and effective_from <= now()
             and (effective_until is null or effective_until > now())
           limit 1`,
          [principal.tenantId, matrix.policy_definition_id, matrix.policy_version_id],
        )
        if (!activePublication.rowCount) {
          throw new ApprovalServiceError(
            'APPROVAL_MATRIX_POLICY_PUBLICATION_INACTIVE',
            'A versao publicada da politica-base nao possui uma publicacao ativa.',
            409,
          )
        }
      }
      nextStatus = 'published'
      nextAction = 'none'
    } else {
      await client.query(
        `update approval_authorities
         set status = 'revoked', revoked_by_membership_id = $3,
             revoked_at = now(), revocation_reason = $4
         where tenant_id = $1 and id = any($2::uuid[]) and status = 'draft'`,
        [principal.tenantId, matrix.authority_ids, principal.membershipId, input.reason],
      )
      nextStatus = 'archived'
      nextAction = 'none'
    }
    await client.query(
      `update approval_matrices
       set status = $3, version = version + 1,
           approved_by = case when $4 = 'approve' then $5 else approved_by end,
           approved_at = case when $4 = 'approve' then now() else approved_at end,
           published_by = case when $4 = 'publish' then $5 else published_by end,
           published_at = case when $4 = 'publish' then now() else published_at end
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, matrixId, nextStatus, input.action, principal.user.id],
    )
    await writeAuditEventInTransaction(client, {
      action: `approval.matrix.${input.action}`,
      result: 'success',
      tenantId: principal.tenantId,
      actorUserId: realActorUserId(principal),
      entityType: 'approval_matrix',
      entityId: matrixId,
      metadata: { fromStatus: matrix.status, toStatus: nextStatus, reason: input.reason },
    })
    return {
      matrixId,
      status: nextStatus,
      version: Number(matrix.version) + 1,
      authorityIds: matrix.authority_ids,
      workflowId: matrix.workflow_definition_id,
      workflowVersionId: matrix.workflow_version_id,
      policyId: matrix.policy_definition_id,
      policyVersionId: matrix.policy_version_id,
      bindingState: nextStatus === 'published' ? 'active' : 'draft_not_active',
      nextAction,
    }
  })
}

async function assertApprovalMatrixRuleSlotAvailable(
  client: PoolClient,
  tenantId: string,
  matrixId: string,
  ruleSlotKey: string,
): Promise<void> {
  await client.query(
    `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`approval-matrix-rule-slot:${tenantId}:${ruleSlotKey}`],
  )
  const conflict = await client.query<{ id: string }>(
    `select id from approval_matrices
     where tenant_id = $1 and rule_slot_key = $2 and id <> $3 and status = 'published'
     limit 1
     for update`,
    [tenantId, ruleSlotKey, matrixId],
  )
  if (conflict.rowCount) {
    throw new ApprovalServiceError(
      'APPROVAL_MATRIX_REVISION_REQUIRED',
      'Ja existe uma regra publicada para este mesmo recorte. Crie uma revisao governada da regra existente.',
      409,
    )
  }
}

async function replaceEquivalentAuthoritiesBeforeMatrixPublication(
  client: PoolClient,
  principal: RequestPrincipal,
  authorityIds: string[],
  reason: string,
): Promise<void> {
  await client.query(
    `update approval_authorities current_authority
     set status = 'revoked', revoked_by_membership_id = $3,
         revoked_at = now(), revocation_reason = $4
     from approval_authorities replacement
     where replacement.tenant_id = $1 and replacement.id = any($2::uuid[])
       and replacement.status = 'draft'
       and current_authority.tenant_id = replacement.tenant_id
       and current_authority.id <> replacement.id
       and current_authority.status in ('active', 'scheduled')
       and current_authority.membership_id = replacement.membership_id
       and current_authority.approval_kind = replacement.approval_kind
       and current_authority.approval_level = replacement.approval_level
       and current_authority.company_id is not distinct from replacement.company_id
       and current_authority.group_id is not distinct from replacement.group_id
       and current_authority.cost_center_id is not distinct from replacement.cost_center_id
       and current_authority.project_id is not distinct from replacement.project_id
       and current_authority.department is not distinct from replacement.department
       and current_authority.audience_group_id is not distinct from replacement.audience_group_id
       and current_authority.currency is not distinct from replacement.currency
       and current_authority.max_amount is not distinct from replacement.max_amount
       and current_authority.accumulated_amount_limit is not distinct from replacement.accumulated_amount_limit
       and current_authority.accumulation_period_days is not distinct from replacement.accumulation_period_days
       and current_authority.max_percentage_above_lowest is not distinct from replacement.max_percentage_above_lowest
       and current_authority.max_percentage_above_average is not distinct from replacement.max_percentage_above_average
       and current_authority.requires_budget_available = replacement.requires_budget_available
       and current_authority.urgent_allowed = replacement.urgent_allowed
       and current_authority.products = replacement.products
       and current_authority.destinations = replacement.destinations
       and current_authority.risk_levels = replacement.risk_levels`,
    [principal.tenantId, authorityIds, principal.membershipId, reason],
  )
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
    const matrixOwner = await client.query(
      `select id from approval_matrices
       where tenant_id = $1 and status = 'published' and $2::uuid = any(authority_ids)
       limit 1 for share`,
      [principal.tenantId, authorityId],
    )
    if (matrixOwner.rowCount) {
      throw new ApprovalServiceError(
        'APPROVAL_MATRIX_AUTHORITY_MANAGED',
        'A alcada pertence a uma matriz publicada e deve ser alterada por uma nova versao governada da matriz.',
        409,
      )
    }
    await assertAuthorityCanBeGranted(client, principal, {
      membershipId: authority.membership_id,
      approvalKind: authority.approval_kind,
      companyId: authority.company_id,
      groupId: authority.group_id,
      costCenterId: authority.cost_center_id,
      projectId: authority.project_id,
      department: authority.department,
      audienceGroupId: authority.audience_group_id,
      approvalLevel: authority.approval_level,
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
  const candidates = (await loadApprovalCandidates(client, principal, node.approvalKind, subject, snapshot))
    .filter((candidate) => !assignedUserIds.has(candidate.userId))
  const resolved = resolveApprovers(node.approvalKind, {
    selectors,
    combination: 'first_non_empty',
    minimumApprovers: configuration.minimumApprovers,
    maximumApprovers: configuration.maximumApprovers,
    allowSelfApproval: node.approverResolution.allowSelfApproval,
    separationOfDuties: node.approverResolution.separationOfDuties,
  }, subject, candidates)

  const newAssignments: Array<{
    userId: string
    delegatedFromUserId: string | null
    delegationId: string | null
  }> = []
  const resolvedUsers = new Set<string>()
  for (const approver of resolved.approvers) {
    const delegated = await resolveDelegatedAssignment(client, principal.tenantId, approver, subject)
    if (approverConflictsWithSubject(delegated.userId, subject, node.approverResolution)) continue
    if (assignedUserIds.has(delegated.userId) || resolvedUsers.has(delegated.userId)) continue
    resolvedUsers.add(delegated.userId)
    newAssignments.push({
      userId: delegated.userId,
      delegatedFromUserId: delegated.delegationId ? approver.userId : null,
      delegationId: delegated.delegationId,
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
        assignment.delegationId
          ? `sla_${action}_delegation`
          : action === 'reassign' ? 'sla_reassignment' : 'sla_escalation',
        assignment.delegationId || escalation.id,
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

async function loadMembershipCandidate(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  lock = false,
): Promise<MembershipCandidateRow> {
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
     join users user_row
       on user_row.id = membership.user_id
      and user_row.status = 'active'
      and user_row.deleted_at is null
     join roles role_row on role_row.id = membership.role_id
     where membership.tenant_id = $1 and membership.id = $2 and membership.status = 'active'
     ${lock ? 'for update of membership, user_row' : ''}`,
    [tenantId, membershipId],
  )
  if (!result.rows[0]) throw new ApprovalServiceError('MEMBERSHIP_NOT_FOUND', 'Vinculo do usuario nao encontrado.', 404)
  return result.rows[0]
}

async function assertAuthorityScope(client: PoolClient, principal: RequestPrincipal, input: ApprovalAuthorityInput): Promise<string | null> {
  if (!input.companyId && !input.groupId && !input.costCenterId && !input.projectId && !input.department && !input.audienceGroupId) {
    if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') {
      throw new ApprovalServiceError('TENANT_APPROVAL_AUTHORITY_DENIED', 'Somente administrador do tenant pode criar alcada global.', 403)
    }
    return null
  }
  if (input.groupId) {
    await requireGroupAccess(principal, input.groupId, 'gerenciar_workflows')
    await assertDatabaseEntity(client, principal.tenantId, 'business_groups', input.groupId)
    return null
  }
  let resolvedCompanyId = input.companyId || null
  if (input.costCenterId || input.projectId) {
    const table = input.costCenterId ? 'cost_centers' : 'projects'
    const id = input.costCenterId || input.projectId as string
    const result = await client.query<{ company_id: string }>(
      `select company_id from ${table} where tenant_id = $1 and id = $2 and deleted_at is null`,
      [principal.tenantId, id],
    )
    if (!result.rows[0]) throw new ApprovalServiceError('APPROVAL_AUTHORITY_SCOPE_NOT_FOUND', 'Escopo da alcada nao encontrado.', 404)
    if (resolvedCompanyId && resolvedCompanyId !== result.rows[0].company_id) {
      throw new ApprovalServiceError('APPROVAL_AUTHORITY_SCOPE_MISMATCH', 'O recorte da alcada pertence a outra empresa.', 409)
    }
    resolvedCompanyId = result.rows[0].company_id
  }
  if (input.audienceGroupId) {
    const result = await client.query<{ company_id: string }>(
      `select company_id from approval_audience_groups
       where tenant_id = $1 and id = $2 and status = 'active'`,
      [principal.tenantId, input.audienceGroupId],
    )
    if (!result.rows[0]) throw new ApprovalServiceError('APPROVAL_AUDIENCE_GROUP_NOT_FOUND', 'Grupo alvo de usuarios nao encontrado.', 404)
    if (resolvedCompanyId && resolvedCompanyId !== result.rows[0].company_id) {
      throw new ApprovalServiceError('APPROVAL_AUTHORITY_SCOPE_MISMATCH', 'O grupo alvo pertence a outra empresa.', 409)
    }
    resolvedCompanyId = result.rows[0].company_id
  }
  if (!resolvedCompanyId) throw new ApprovalServiceError('APPROVAL_AUTHORITY_COMPANY_REQUIRED', 'O recorte da alcada exige uma empresa.', 422)
  await requireCompanyAccess(principal, resolvedCompanyId, 'gerenciar_workflows')
  await assertDatabaseEntity(client, principal.tenantId, 'companies', resolvedCompanyId)
  return resolvedCompanyId
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
       and department is not distinct from $8
       and audience_group_id is not distinct from $9
       and approval_level = $10
     order by max_amount desc nulls first limit 1`,
    [
      principal.tenantId, principal.membershipId, input.approvalKind,
      input.companyId || null, input.groupId || null, input.costCenterId || null, input.projectId || null,
      input.department || null, input.audienceGroupId || null, input.approvalLevel,
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
       and requester_identity.company_id = requester_demand.company_id
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

export async function loadCanonicalApprovalSubjectContext(
  client: PoolClient,
  principal: RequestPrincipal,
  input: CreateApprovalInstanceInput,
  subject: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tenantId = principal.tenantId
  const result: Record<string, unknown> = {}
  let employeeId = input.employeeId || null
  let requesterId: string | null = null
  let requesterUserId: string | null = null
  let department: string | null = null
  let costCenterId: string | null = null
  let demandCreatedByUserId: string | null = null
  let demandUpdatedByUserId: string | null = null
  let audienceEmployeeIds: string[] = []
  let travelerUserIds: string[] = []
  let primaryTravelerUserId: string | null = null

  if (input.demandId) {
    const demand = await client.query<{
      employee_id: string | null
      requester_id: string | null
      employee_department: string | null
      requester_department: string | null
      demand_cost_center_id: string | null
      employee_cost_center_id: string | null
      requester_cost_center_id: string | null
      requester_user_id: string | null
      demand_created_by: string | null
      demand_updated_by: string | null
    }>(
      `select demand.employee_id, demand.requester_id,
              employee.department as employee_department,
              requester.department as requester_department,
              demand.cost_center_id as demand_cost_center_id,
              employee.cost_center_id as employee_cost_center_id,
              requester.cost_center_id as requester_cost_center_id,
              requester.user_id as requester_user_id,
              demand.created_by as demand_created_by,
              demand.updated_by as demand_updated_by
       from demands demand
       left join employees employee
         on employee.tenant_id = demand.tenant_id
        and employee.id = demand.employee_id
        and employee.company_id = demand.company_id
        and employee.deleted_at is null
       left join requesters requester
         on requester.tenant_id = demand.tenant_id
        and requester.id = demand.requester_id
        and requester.company_id = demand.company_id
        and requester.deleted_at is null
       where demand.tenant_id = $1 and demand.id = $2 and demand.company_id = $3
         and demand.deleted_at is null`,
      [tenantId, input.demandId, input.companyId],
    )
    const row = demand.rows[0]
    if (row) {
      employeeId = row.employee_id || employeeId
      requesterId = row.requester_id
      requesterUserId = row.requester_user_id
      department = row.employee_department || row.requester_department
      costCenterId = row.demand_cost_center_id || row.employee_cost_center_id || row.requester_cost_center_id
      demandCreatedByUserId = row.demand_created_by
      demandUpdatedByUserId = row.demand_updated_by
    }
    const travelers = await client.query<{ employee_id: string; user_id: string | null; is_primary: boolean }>(
      `with traveler_employee_candidates as (
         select traveler.employee_id, traveler.is_primary
         from demand_travelers traveler
         where traveler.tenant_id = $1
           and traveler.demand_id = $2
           and traveler.company_id = $3
           and traveler.employee_id is not null
           and traveler.deleted_at is null
         union all
         select $4::text, true
         where $4::text is not null
       ), traveler_employees as (
         select employee_id, bool_or(is_primary) as is_primary
         from traveler_employee_candidates
         where employee_id is not null
         group by employee_id
       )
       select distinct traveler_employee.employee_id, requester.user_id, traveler_employee.is_primary
       from traveler_employees traveler_employee
       join employees traveler_profile
         on traveler_profile.tenant_id = $1
        and traveler_profile.company_id = $3
        and traveler_profile.id = traveler_employee.employee_id
        and traveler_profile.status = 'active'
        and traveler_profile.deleted_at is null
       left join requesters requester
         on requester.tenant_id = $1
        and requester.company_id = $3
        and requester.employee_id = traveler_employee.employee_id
        and requester.status = 'active'
        and requester.deleted_at is null
        and requester.user_id is not null`,
      [tenantId, input.demandId, input.companyId, employeeId],
    )
    audienceEmployeeIds = uniqueStrings(travelers.rows.map((traveler) => traveler.employee_id))
    travelerUserIds = uniqueStrings(travelers.rows.flatMap((traveler) => traveler.user_id ? [traveler.user_id] : []))
    const primaryTravelerUserIds = uniqueStrings(
      travelers.rows.flatMap((traveler) => traveler.is_primary && traveler.user_id ? [traveler.user_id] : []),
    )
    primaryTravelerUserId = primaryTravelerUserIds.length === 1
      ? primaryTravelerUserIds[0]
      : travelerUserIds.length === 1 ? travelerUserIds[0] : null
  } else if (employeeId) {
    const employee = await client.query<{ department: string | null; cost_center_id: string | null }>(
      `select department, cost_center_id from employees
       where tenant_id = $1 and id = $2 and company_id = $3
         and status = 'active' and deleted_at is null`,
      [tenantId, employeeId, input.companyId],
    )
    department = employee.rows[0]?.department || null
    costCenterId = employee.rows[0]?.cost_center_id || null
    audienceEmployeeIds = employee.rows[0] ? [employeeId] : []
  }

  if (department) result.department = department
  if (costCenterId) result.costCenterId = costCenterId
  if (requesterUserId) result.requesterUserId = requesterUserId
  if (primaryTravelerUserId) result.travelerUserId = primaryTravelerUserId
  Object.assign(result, mergeCanonicalApprovalSubjectConflicts(subject, {
    realActorUserId: realActorUserId(principal),
    representationActorUserId: principal.representation?.actor.id || principal.actor?.user.id || null,
    representationSubjectUserId: principal.representation?.subject.id || null,
    demandCreatedByUserId,
    demandUpdatedByUserId,
    travelerUserIds,
  }))

  const subjectUserIds = uniqueStrings([
    ...(requesterUserId ? [requesterUserId] : []),
    ...travelerUserIds,
  ])
  const audienceGroups = await client.query<{ id: string }>(
    `select distinct audience_group.id
     from approval_audience_groups audience_group
     join approval_audience_group_members member
       on member.tenant_id = audience_group.tenant_id
      and member.audience_group_id = audience_group.id
      and member.status = 'active'
     where audience_group.tenant_id = $1
       and audience_group.company_id = $2
       and audience_group.status = 'active'
       and (
         (cardinality($3::text[]) > 0 and member.employee_id = any($3::text[]))
         or ($4::text is not null and member.requester_id = $4)
         or (cardinality($5::uuid[]) > 0 and member.user_id = any($5::uuid[]))
       )`,
    [tenantId, input.companyId, audienceEmployeeIds, requesterId, subjectUserIds],
  )
  result.audienceGroupIds = audienceGroups.rows.map((row) => row.id).sort()
  return result
}

async function loadPolicyApprovalRouting(
  client: PoolClient,
  tenantId: string,
  input: CreateApprovalInstanceInput,
  subject: Record<string, unknown>,
): Promise<ApprovalRoutingFacts> {
  const referencedEvaluationIds = extractApprovalPolicyEvaluationIds(subject)
  const domainEvaluationIds: string[] = []
  if (input.demandId) {
    const demand = await client.query<{ last_policy_evaluation_id: string | null }>(
      `select last_policy_evaluation_id from demands
       where tenant_id = $1 and id = $2 and company_id = $3 and deleted_at is null`,
      [tenantId, input.demandId, input.companyId],
    )
    if (demand.rows[0]?.last_policy_evaluation_id) domainEvaluationIds.push(demand.rows[0].last_policy_evaluation_id)
  }
  if (input.reservationId) {
    const reservation = await client.query<{ last_policy_evaluation_id: string | null }>(
      `select last_policy_evaluation_id from reservations
       where tenant_id = $1 and id = $2 and company_id = $3`,
      [tenantId, input.reservationId, input.companyId],
    )
    if (reservation.rows[0]?.last_policy_evaluation_id) domainEvaluationIds.push(reservation.rows[0].last_policy_evaluation_id)
  }
  const evaluationIds = uniqueStrings([...referencedEvaluationIds, ...domainEvaluationIds])
  if (!evaluationIds.length) {
    return { requiredLevel: 1, requiresSecondLevel: false, reasons: [], sourcePolicyEvaluationIds: [] }
  }
  const evaluations = await client.query<{ id: string; result: unknown }>(
    `select id, result from policy_evaluations
     where tenant_id = $1 and id = any($2::uuid[]) and company_id = $3
       and ($4::text is null or demand_id is null or demand_id = $4)
       and ($5::text is null or reservation_id is null or reservation_id = $5)`,
    [tenantId, evaluationIds, input.companyId, input.demandId || null, input.reservationId || null],
  )
  if (evaluations.rowCount !== evaluationIds.length) {
    throw new ApprovalServiceError(
      'APPROVAL_POLICY_ROUTING_CONTEXT_INVALID',
      'Uma avaliacao de politica informada nao pertence ao mesmo contexto da aprovacao.',
      409,
    )
  }
  const requiresSecondLevel = policyResultsRequireSecondLevel(
    evaluations.rows.map((evaluation) => evaluation.result),
  )
  return {
    requiredLevel: requiresSecondLevel ? 2 : 1,
    requiresSecondLevel,
    reasons: requiresSecondLevel ? ['policy_required_second_level'] : [],
    sourcePolicyEvaluationIds: evaluations.rows.map((evaluation) => evaluation.id).sort(),
  }
}

function extractApprovalPolicyEvaluationIds(subject: Record<string, unknown>): string[] {
  const explicit = Array.isArray(subject.policyEvaluationIds)
    ? subject.policyEvaluationIds.filter(isString)
    : []
  const offline = Array.isArray(subject.offlinePolicyEvaluations)
    ? subject.offlinePolicyEvaluations.flatMap((item) => {
        const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null
        return typeof record?.databaseEvaluationId === 'string' ? [record.databaseEvaluationId] : []
      })
    : []
  return uniqueStrings([...explicit, ...offline])
}

async function prepareApprovalRouting(
  client: PoolClient,
  principal: RequestPrincipal,
  snapshot: ApprovalWorkflowSnapshot,
  baseSubject: ApprovalSubject & Record<string, unknown>,
  policyRouting: ApprovalRoutingFacts,
): Promise<{
  subject: ApprovalSubject & Record<string, unknown>
  initialNodes: ApprovalWorkflowNode[]
}> {
  const start = snapshot.nodes.find((node) => node.type === 'start')
  if (!start) throw new ApprovalServiceError('WORKFLOW_START_NODE_MISSING', 'Workflow publicado sem no inicial.', 409)
  let subject: ApprovalSubject & Record<string, unknown> = { ...baseSubject, routing: policyRouting }
  let initialNodes = resolveNextWorkflowNodes(snapshot, start.id, subject)
  const preliminaryApproverUserIds = new Set<string>()
  let authorityOverflow = false

  for (const node of initialNodes) {
    if (node.type !== 'approval' || !node.approvalKind || !node.approverResolution) continue
    const candidates = await loadApprovalCandidates(client, principal, node.approvalKind, subject, snapshot)
    const resolution = resolveApprovers(node.approvalKind, node.approverResolution, subject, candidates)
    resolution.approvers.forEach((approver) => preliminaryApproverUserIds.add(approver.userId))
    authorityOverflow ||= resolution.requiresEscalation
  }

  const reasons = Array.from(new Set<ApprovalRoutingFacts['reasons'][number]>([
    ...policyRouting.reasons,
    ...(authorityOverflow ? ['authority_limit_exceeded' as const] : []),
  ]))
  const routing: ApprovalRoutingFacts = {
    requiredLevel: reasons.length ? 2 : 1,
    requiresSecondLevel: reasons.length > 0,
    reasons,
    sourcePolicyEvaluationIds: policyRouting.sourcePolicyEvaluationIds,
  }
  subject = { ...subject, routing }
  initialNodes = resolveNextWorkflowNodes(snapshot, start.id, subject)

  if (routing.requiresSecondLevel) {
    const secondLevelNodes = Array.from(new Map(initialNodes.flatMap((node) => (
      node.type === 'approval'
        ? resolveNextWorkflowNodes(snapshot, node.id, subject).filter((candidate) => (
            candidate.type === 'approval' && isSecondLevelApprovalNode(candidate)
          ))
        : []
    )).map((node) => [node.id, node])).values())
    if (!secondLevelNodes.length) {
      throw new ApprovalServiceError(
        'APPROVAL_SECOND_LEVEL_NOT_CONFIGURED',
        'A operacao exige segundo nivel, mas o workflow nao possui esse no.',
        422,
      )
    }
    const prevalidationSubject: ApprovalSubject = {
      ...subject,
      priorApproverUserIds: [...preliminaryApproverUserIds],
    }
    for (const node of secondLevelNodes) {
      if (!node.approverResolution || !node.approvalKind) continue
      const candidates = await loadApprovalCandidates(client, principal, node.approvalKind, prevalidationSubject, snapshot)
      resolveApprovers(node.approvalKind, node.approverResolution, prevalidationSubject, candidates)
    }
  }
  return { subject, initialNodes }
}

function isSecondLevelApprovalNode(node: ApprovalWorkflowNode): boolean {
  return Boolean(node.approverResolution?.selectors.some((selector) => (
    selector.type === 'authority' && Number(selector.configuration?.level) === 2
  )))
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
    const candidates = await loadApprovalCandidates(client, principal, node.approvalKind, subject, snapshot)
    const resolved = resolveApprovers(node.approvalKind, node.approverResolution, subject, candidates)
    let assignmentCount = 0
    for (const approver of resolved.approvers) {
      const delegated = await resolveDelegatedAssignment(client, principal.tenantId, approver, subject)
      if (approverConflictsWithSubject(delegated.userId, subject, node.approverResolution)) continue
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
      assignmentCount += 1
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
    if (assignmentCount < node.approverResolution.minimumApprovers) {
      throw new ApprovalServiceError(
        'NO_APPROVER_AVAILABLE_AFTER_DELEGATION',
        'A delegacao resultou em conflito de segregacao de funcoes e nao ha aprovadores suficientes.',
        422,
      )
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
  await reconcileApprovedMeritApproval(client, principal, instance)
  await reconcileApprovedQuoteSelection(client, principal, instance)
}

async function reconcileApprovedMeritApproval(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
): Promise<void> {
  if (instance.instance_type !== 'merit' || !instance.demand_id) return

  const demandResult = await client.query<ApprovalDemandProjectionRow>(
    `select id, company_id, service_type, lifecycle_status, lifecycle_version,
            last_policy_evaluation_id, active_approval_instance_id, metadata
     from demands
     where tenant_id = $1 and id = $2 and deleted_at is null
     for update`,
    [principal.tenantId, instance.demand_id],
  )
  const demand = demandResult.rows[0]
  if (!demand) {
    throw new ApprovalServiceError(
      'APPROVAL_MERIT_DEMAND_NOT_FOUND',
      'A demanda vinculada a aprovacao de merito nao foi encontrada.',
      409,
    )
  }
  const approvalStep = await client.query(
    `select 1 from approval_steps
     where tenant_id = $1 and approval_instance_id = $2
     limit 1`,
    [principal.tenantId, instance.id],
  )
  if (shouldDeferOfflineMeritReconciliation({
    instanceType: instance.instance_type,
    subject: instance.subject_snapshot,
    lifecycleStatus: demand.lifecycle_status,
    activeApprovalInstanceId: demand.active_approval_instance_id,
    hasApprovalSteps: Boolean(approvalStep.rowCount),
  })) {
    return
  }
  if (demand.active_approval_instance_id !== instance.id) {
    throw new ApprovalServiceError(
      'APPROVAL_MERIT_DEMAND_SUPERSEDED',
      'A demanda nao possui mais esta aprovacao de merito como instancia ativa.',
      409,
    )
  }
  if (demand.lifecycle_status !== 'pending_merit_approval') {
    throw new ApprovalServiceError(
      'APPROVAL_MERIT_DEMAND_STATE_CONFLICT',
      `A demanda esta no estado ${demand.lifecycle_status} e nao pode concluir a aprovacao de merito.`,
      409,
    )
  }
  if (!demand.last_policy_evaluation_id) {
    throw new ApprovalServiceError(
      'APPROVAL_MERIT_POLICY_MISSING',
      'A demanda aprovada nao possui a avaliacao de politica que originou a decisao.',
      409,
    )
  }
  const policyResult = await client.query<{ passed: boolean; has_blocks: boolean }>(
    `select passed, has_blocks
     from policy_evaluations
     where tenant_id = $1 and id = $2 and demand_id = $3`,
    [principal.tenantId, demand.last_policy_evaluation_id, demand.id],
  )
  const policy = policyResult.rows[0]
  if (!policy || !policy.passed || policy.has_blocks) {
    throw new ApprovalServiceError(
      'APPROVAL_MERIT_POLICY_INVALID',
      'A avaliacao de politica da demanda aprovada nao esta valida.',
      409,
    )
  }

  await persistTravelTransitionInTransaction(
    client,
    principal,
    approvalDemandLifecycleRecord(demand),
    'approve_merit',
    {
      idempotencyKey: `approval:${instance.id}:merit-approved`,
      requirements: {
        policyEvaluationId: demand.last_policy_evaluation_id,
        policyPassed: true,
        policyHasBlocks: false,
        approvalInstanceId: instance.id,
        approvalsSatisfied: true,
      },
      metadata: {
        channel: 'offline',
        source: 'approval_decision',
        outcome: 'approved',
        approvalInstanceId: instance.id,
      },
    },
  )
  await writeAuditEventInTransaction(client, {
    action: 'travel.approval.merit.approved_reconciled',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: realActorUserId(principal),
    entityType: 'demand',
    entityId: demand.id,
    metadata: {
      approvalInstanceId: instance.id,
      policyEvaluationId: demand.last_policy_evaluation_id,
      fromLifecycleStatus: 'pending_merit_approval',
      toLifecycleStatus: 'approved_for_quotation',
    },
  })
}

export function shouldDeferOfflineMeritReconciliation(input: {
  instanceType: string
  subject: unknown
  lifecycleStatus: string
  activeApprovalInstanceId: string | null
  hasApprovalSteps: boolean
}): boolean {
  const subject = asRecord(input.subject)
  return input.instanceType === 'merit'
    && subject.offlineOperation === true
    && subject.offlineCheckpoint === 'merit'
    && input.activeApprovalInstanceId === null
    && !input.hasApprovalSteps
    && ['draft', 'submitted'].includes(input.lifecycleStatus)
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
  await writeAuditEventInTransaction(client, {
    action: 'travel.quote.selection.approved',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: realActorUserId(principal),
    entityType: 'travel_quote_selection',
    entityId: projection.selection_id,
    metadata: {
      demandId: projection.demand_id,
      quoteId: projection.quote_id,
      quoteOptionId: projection.option_id,
      snapshotHash: projection.snapshot_hash,
      approvalInstanceId: instance.id,
      representationId: principal.representation?.id || null,
      representedUserId: principal.representation?.subject.id || null,
    },
  })
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
  await reconcileRejectedApproval(client, principal, instance, explanation)
}

async function reconcileRejectedApproval(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
  explanation: string,
): Promise<void> {
  if (!instance.demand_id || !['merit', 'cost'].includes(instance.instance_type)) return

  const demandResult = await client.query<ApprovalDemandProjectionRow>(
    `select id, company_id, service_type, lifecycle_status, lifecycle_version,
            last_policy_evaluation_id, active_approval_instance_id, metadata
     from demands
     where tenant_id = $1 and id = $2 and deleted_at is null
     for update`,
    [principal.tenantId, instance.demand_id],
  )
  const demand = demandResult.rows[0]
  if (!demand) return
  if (
    demand.active_approval_instance_id
    && demand.active_approval_instance_id !== instance.id
  ) {
    throw new ApprovalServiceError(
      'APPROVAL_REJECTION_DEMAND_SUPERSEDED',
      'A demanda possui outra aprovacao ativa e nao pode receber esta rejeicao.',
      409,
    )
  }

  if (instance.instance_type === 'cost') {
    await reconcileRejectedCostApproval(client, principal, instance, demand, explanation)
    return
  }
  await reconcileRejectedMeritApproval(client, principal, instance, demand, explanation)
}

async function reconcileRejectedCostApproval(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
  demand: ApprovalDemandProjectionRow,
  explanation: string,
): Promise<void> {
  const selectionResult = await client.query<RejectedQuoteSelectionProjectionRow>(
    `select selection.id as selection_id, selection.status as selection_status,
            selection.snapshot_hash, selection.quote_id, selection.option_id
     from travel_quote_selections selection
     where selection.tenant_id = $1 and selection.demand_id = $2
       and selection.approval_instance_id = $3
       and selection.status in ('pending_approval', 'rejected')
     order by selection.chosen_at desc
     limit 1
     for update`,
    [principal.tenantId, demand.id, instance.id],
  )
  const selection = selectionResult.rows[0] || null

  if (demand.lifecycle_status === 'pending_cost_approval') {
    await persistTravelTransitionInTransaction(
      client,
      principal,
      approvalDemandLifecycleRecord(demand),
      'return_to_choice',
      {
        idempotencyKey: `approval:${instance.id}:cost-rejected:return-to-choice`,
        requirements: {
          approvalInstanceId: instance.id,
          humanConfirmed: true,
        },
        metadata: {
          source: 'approval_decision',
          outcome: 'rejected',
          approvalInstanceId: instance.id,
          reason: explanation,
          selectionId: selection?.selection_id || null,
        },
      },
    )
  } else if (demand.lifecycle_status !== 'pending_choice') {
    throw new ApprovalServiceError(
      'APPROVAL_REJECTION_DEMAND_STATE_CONFLICT',
      `A demanda esta no estado ${demand.lifecycle_status} e nao pode voltar para escolha.`,
      409,
    )
  }

  if (selection?.selection_status === 'pending_approval') {
    await client.query(
      `update travel_quote_selections
       set status = 'rejected', version = version + 1
       where tenant_id = $1 and id = $2 and status = 'pending_approval'`,
      [principal.tenantId, selection.selection_id],
    )
  }
  if (selection) {
    await client.query(
      `update travel_quotes
       set status = 'completed', updated_at = now()
       where tenant_id = $1 and id = $2 and status = 'selected'`,
      [principal.tenantId, selection.quote_id],
    )
  }

  const adjustment = createOpenDemandRequestAdjustment({
    source: 'cost_approval_rejected',
    reason: explanation,
    approvalInstanceId: instance.id,
    allowedActions: ['choose_another_option', 'edit_request'],
    requestedAt: new Date().toISOString(),
    requestedBy: realActorUserId(principal),
  })
  await client.query(
    `update demands
     set final_amount = null,
         metadata = coalesce(metadata, '{}'::jsonb)
           || jsonb_build_object('requestAdjustment', $3::jsonb),
         version = version + 1,
         updated_by = $4,
         updated_at = now()
     where tenant_id = $1 and id = $2`,
    [principal.tenantId, demand.id, JSON.stringify(adjustment), realActorUserId(principal)],
  )
  await writeAuditEventInTransaction(client, {
    action: 'travel.approval.cost.rejected_reconciled',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: realActorUserId(principal),
    entityType: 'demand',
    entityId: demand.id,
    metadata: {
      approvalInstanceId: instance.id,
      selectionId: selection?.selection_id || null,
      quoteId: selection?.quote_id || null,
      quoteOptionId: selection?.option_id || null,
      snapshotHash: selection?.snapshot_hash || null,
      reason: explanation,
      allowedActions: adjustment.allowedActions,
    },
  })
}

async function reconcileRejectedMeritApproval(
  client: PoolClient,
  principal: RequestPrincipal,
  instance: ApprovalInstanceRow,
  demand: ApprovalDemandProjectionRow,
  explanation: string,
): Promise<void> {
  if (demand.lifecycle_status === 'pending_merit_approval') {
    await persistTravelTransitionInTransaction(
      client,
      principal,
      approvalDemandLifecycleRecord(demand),
      'return_for_adjustment',
      {
        idempotencyKey: `approval:${instance.id}:merit-rejected:return-for-adjustment`,
        requirements: {
          approvalInstanceId: instance.id,
          humanConfirmed: true,
        },
        metadata: {
          source: 'approval_decision',
          outcome: 'rejected',
          approvalInstanceId: instance.id,
          reason: explanation,
        },
      },
    )
  } else if (demand.lifecycle_status !== 'submitted') {
    throw new ApprovalServiceError(
      'APPROVAL_REJECTION_DEMAND_STATE_CONFLICT',
      `A demanda esta no estado ${demand.lifecycle_status} e nao pode voltar para ajuste.`,
      409,
    )
  }

  const adjustment = createOpenDemandRequestAdjustment({
    source: 'merit_approval_rejected',
    reason: explanation,
    approvalInstanceId: instance.id,
    allowedActions: ['edit_request'],
    requestedAt: new Date().toISOString(),
    requestedBy: realActorUserId(principal),
  })
  await client.query(
    `update demands
     set metadata = coalesce(metadata, '{}'::jsonb)
           || jsonb_build_object('requestAdjustment', $3::jsonb),
         version = version + 1,
         updated_by = $4,
         updated_at = now()
     where tenant_id = $1 and id = $2`,
    [principal.tenantId, demand.id, JSON.stringify(adjustment), realActorUserId(principal)],
  )
  await writeAuditEventInTransaction(client, {
    action: 'travel.approval.merit.rejected_returned_for_adjustment',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: realActorUserId(principal),
    entityType: 'demand',
    entityId: demand.id,
    metadata: {
      approvalInstanceId: instance.id,
      reason: explanation,
      allowedActions: adjustment.allowedActions,
    },
  })
}

function approvalDemandLifecycleRecord(
  demand: ApprovalDemandProjectionRow,
): TravelLifecycleRecord {
  return {
    demandId: demand.id,
    companyId: demand.company_id,
    status: demand.lifecycle_status,
    version: Number(demand.lifecycle_version),
    lastPolicyEvaluationId: demand.last_policy_evaluation_id,
    activeApprovalInstanceId: demand.active_approval_instance_id,
  }
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
  workflow: Pick<ApprovalWorkflowSnapshot, 'code'>,
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
  const matrixWorkflow = workflow.code.startsWith('matrix.')
  const authorityRows = memberIds.length
    ? await client.query<AuthorityRow>(
        `select * from approval_authorities
         where tenant_id = $1 and membership_id = any($2::uuid[])
           and approval_kind = $3 and status in ('active', 'scheduled')
           and valid_from <= now() and (valid_until is null or valid_until > now())
           and (
             not $4::boolean
             or exists (
               select 1 from approval_matrices matrix
               where matrix.tenant_id = approval_authorities.tenant_id
                 and matrix.status = 'published'
                 and matrix.stage = $3
                 and approval_authorities.id = any(matrix.authority_ids)
                 and (
                   (matrix.root_scope_type = 'company' and matrix.company_id = $5)
                   or (
                     matrix.root_scope_type = 'business_group'
                     and matrix.business_group_id = $6
                     and (
                       matrix.access_mode = 'all_companies'
                       or $5 = any(matrix.selected_company_ids)
                     )
                   )
                 )
             )
           )`,
        [principal.tenantId, memberIds, kind, matrixWorkflow, subject.companyId, subject.groupId || null],
      )
    : { rows: [] as AuthorityRow[] }
  const authoritiesByMembership = new Map<string, AuthorityRow[]>()
  authorityRows.rows.forEach((authority) => authoritiesByMembership.set(
    authority.membership_id,
    [...(authoritiesByMembership.get(authority.membership_id) || []), authority],
  ))
  const approverGroups = memberIds.length
    ? await client.query<{ membership_id: string; group_ids: string[] }>(
        `select group_member.membership_id, array_agg(approver_group.id::text order by approver_group.id)::text[] as group_ids
         from approval_approver_group_members group_member
         join approval_approver_groups approver_group
           on approver_group.tenant_id = group_member.tenant_id
          and approver_group.id = group_member.approver_group_id
          and approver_group.status = 'active'
         where group_member.tenant_id = $1
           and group_member.membership_id = any($2::uuid[])
           and group_member.status = 'active'
           and (
             approver_group.company_id = $3
             or ($4::text is not null and approver_group.business_group_id = $4)
           )
         group by group_member.membership_id`,
        [principal.tenantId, memberIds, subject.companyId, subject.groupId || null],
      )
    : { rows: [] as Array<{ membership_id: string; group_ids: string[] }> }
  const approverGroupsByMembership = new Map(approverGroups.rows.map((row) => [row.membership_id, row.group_ids]))

  const candidates: ApprovalCandidate[] = []
  for (const member of members.rows) {
    if (!isCorporateApprovalMembershipEligible({
      roleKey: member.role_key,
      platformAdmin: member.platform_admin,
      tenantWide: false,
    })) continue
    const permissions = normalizeMembershipPermissions(member.permissions, member.profile_key)
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
      departments: [],
      audienceGroupIds: [],
      approverGroupIds: approverGroupsByMembership.get(member.membership_id) || [],
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
        departments: authority.department ? [authority.department] : [],
        audienceGroupIds: authority.audience_group_id ? [authority.audience_group_id] : [],
        authorityLevel: authority.approval_level,
        authoritySpecificity: authoritySpecificity(authority),
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
  if (authority.department && normalizeOrganizationalLabel(authority.department) !== normalizeOrganizationalLabel(subject.department || '')) return false
  if (authority.audience_group_id && !(subject.audienceGroupIds || []).includes(authority.audience_group_id)) return false
  return true
}

function authoritySpecificity(authority: AuthorityRow): number {
  if (authority.audience_group_id) return 500
  if (authority.project_id) return 450
  if (authority.cost_center_id) return 400
  if (authority.department) return 300
  if (authority.company_id) return 200
  if (authority.group_id) return 100
  return 0
}

function normalizeOrganizationalLabel(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR')
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
       on demand.tenant_id = instance.tenant_id
      and demand.id = instance.demand_id
      and demand.company_id = instance.company_id
     left join requesters requester
       on requester.tenant_id = demand.tenant_id
      and requester.id = demand.requester_id
      and requester.company_id = instance.company_id
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
                acting_for_user_id as "actingForUserId", decision_source as "decisionSource",
                impersonation_id as "impersonationId", decided_at as "decidedAt"
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
    [principal.tenantId, instanceId, stepId, type, realActorUserId(principal), JSON.stringify(payload)],
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
        and requester_owned_demand.company_id = ${instanceAlias}.company_id
        and requester_owned_demand.deleted_at is null
        and requester_owned_identity.company_id = ${instanceAlias}.company_id
        and requester_owned_identity.user_id = ${userParameter}::uuid
        and requester_owned_identity.status = 'active'
        and requester_owned_identity.deleted_at is null
    )
    or (
      ${instanceAlias}.subject_snapshot ->> 'requesterUserId' = (${userParameter}::uuid)::text
      and ${instanceAlias}.subject_snapshot ->> 'companyId' = ${instanceAlias}.company_id
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
    actorUserId: realActorUserId(principal),
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

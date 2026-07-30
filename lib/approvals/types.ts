import type { PolicyExpression } from '@/lib/policy'

export type ApprovalNodeType = 'start' | 'approval' | 'automatic' | 'condition' | 'notification' | 'end'
export type ApprovalCompletionMode = 'any' | 'all' | 'quorum' | 'first'
export type ApprovalKind =
  | 'merit'
  | 'cost'
  | 'budget'
  | 'operational'
  | 'security'
  | 'international'
  | 'financial'
  | 'executive'
  | 'cost_center'
  | 'project'
  | 'company'
  | 'group'
  | 'traveler'
  | 'debit'
  | 'national'
  | 'second_level'
  | 'list'
  | 'allocation_line'

export type ApproverSelectorType =
  | 'person'
  | 'role'
  | 'job_title'
  | 'level'
  | 'group'
  | 'company'
  | 'branch'
  | 'cost_center'
  | 'project'
  | 'account'
  | 'requester'
  | 'traveler'
  | 'manager'
  | 'authority'
  | 'amount'
  | 'currency'
  | 'product'
  | 'destination'
  | 'policy_violation'
  | 'budget'
  | 'risk'

export interface ApproverSelector {
  type: ApproverSelectorType
  value?: string | string[] | number | boolean
  configuration?: Record<string, unknown>
}

export interface ApproverResolutionSpec {
  selectors: ApproverSelector[]
  combination: 'all' | 'union' | 'first_non_empty'
  fallbackSelectors?: ApproverSelector[]
  minimumApprovers: number
  maximumApprovers?: number
  allowSelfApproval: boolean
  separationOfDuties?: Array<'requester' | 'traveler' | 'last_editor' | 'financial_executor'>
}

export interface ApprovalWorkflowNode {
  id: string
  key: string
  name: string
  type: ApprovalNodeType
  approvalKind?: ApprovalKind
  completionMode?: ApprovalCompletionMode
  quorum?: number
  approverResolution?: ApproverResolutionSpec
  configuration?: Record<string, unknown>
}

export interface ApprovalWorkflowEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  sequence: number
  condition?: PolicyExpression
  label?: string
}

export interface ApprovalWorkflowSnapshot {
  workflowId: string
  workflowVersionId: string
  version: number
  code: string
  name: string
  nodes: ApprovalWorkflowNode[]
  edges: ApprovalWorkflowEdge[]
  validFrom?: string | null
  validUntil?: string | null
  contentHash: string
}

export interface WorkflowValidationIssue {
  code: string
  severity: 'warning' | 'blocking'
  message: string
  nodeIds?: string[]
  edgeIds?: string[]
}

export interface WorkflowValidationResult {
  valid: boolean
  issues: WorkflowValidationIssue[]
  topologicalOrder: string[]
}

export interface ApprovalSubject {
  tenantId: string
  companyId: string
  groupId?: string | null
  branchId?: string | null
  requesterUserId?: string | null
  travelerUserId?: string | null
  managerUserId?: string | null
  lastEditorUserId?: string | null
  financialExecutorUserId?: string | null
  costCenterId?: string | null
  projectId?: string | null
  accountId?: string | null
  budgetId?: string | null
  amount?: number | null
  accumulatedAmount?: number | null
  percentageAboveLowest?: number | null
  percentageAboveAverage?: number | null
  budgetAvailable?: number | null
  urgent?: boolean | null
  currency?: string | null
  product?: string | null
  destination?: string | null
  policyViolationCodes?: string[]
  riskLevel?: string | null
}

export interface ApprovalCandidate {
  userId: string
  membershipId: string
  tenantId: string
  active: boolean
  roleKeys: string[]
  jobTitle?: string | null
  level?: string | null
  companyIds: string[]
  groupIds: string[]
  branchIds?: string[]
  costCenterIds?: string[]
  projectIds?: string[]
  accountIds?: string[]
  budgetIds?: string[]
  approvalKinds: ApprovalKind[]
  authorityMatched?: boolean
  maxAmount?: number | null
  accumulatedAmountLimit?: number | null
  maxPercentageAboveLowest?: number | null
  maxPercentageAboveAverage?: number | null
  requiresBudgetAvailable?: boolean
  urgentAllowed?: boolean
  currencies?: string[]
  products?: string[]
  destinations?: string[]
  policyViolationCodes?: string[]
  riskLevels?: string[]
}

export interface ResolvedApprover {
  userId: string
  membershipId: string
  source: 'primary' | 'fallback'
  matchedSelectors: ApproverSelectorType[]
  explanation: string
}

export interface ApproverResolutionResult {
  approvers: ResolvedApprover[]
  usedFallback: boolean
  explanations: string[]
}

export type ApprovalAssignmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'reassigned'

export interface ApprovalAssignmentState {
  assignmentId: string
  assigneeUserId: string
  status: ApprovalAssignmentStatus
}

export interface ApprovalStepOutcome {
  status: 'pending' | 'approved' | 'rejected'
  approvals: number
  rejections: number
  pending: number
  completedAssignmentIds: string[]
  cancelledAssignmentIds: string[]
  explanation: string
}

export interface ApprovalDelegationCandidate {
  id?: string
  tenantId: string
  delegatorMembershipId: string
  delegateMembershipId: string
  validFrom: string
  validUntil: string
  companyIds: string[]
  groupIds: string[]
  modules: string[]
  justification: string
  status?: 'scheduled' | 'active' | 'revoked' | 'expired'
}

export interface DelegationMembership {
  membershipId: string
  tenantId: string
  active: boolean
  platformAdmin: boolean
  companyIds: string[]
  groupIds: string[]
  delegableModules: string[]
  canReceiveDelegation: boolean
}

export interface BusinessCalendarDefinition {
  timezone: string
  weeklySchedule: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, Array<{ start: string; end: string }>>>
  holidays: string[]
}

export interface ApprovalSlaResult {
  dueAt: string
  reminderAt: string[]
  status: 'on_time' | 'due_soon' | 'overdue'
  remainingMinutes: number
}

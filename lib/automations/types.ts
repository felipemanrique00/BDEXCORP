import type { ConditionTrace, PolicyExpression } from '@/lib/policy'

export type AutomationStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'published'
  | 'suspended'
  | 'archived'

export type AutomationRunStatus =
  | 'evaluating'
  | 'skipped'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AutomationSubjectType =
  | 'demand'
  | 'reservation'
  | 'employee'
  | 'company'
  | 'integration'
  | 'workflow_execution'
  | 'generic'

export interface AutomationScope {
  type: 'tenant' | 'group' | 'company'
  id?: string | null
  mode: 'include' | 'exclude'
  specificity: number
}

export interface AutomationListItem {
  id: string
  code: string
  name: string
  description: string
  status: AutomationStatus
  currentVersion: number
  publishedVersion: number | null
  eventType: string
  workflowId: string
  workflowName: string
  workflowStatus: string
  subjectType: AutomationSubjectType
  scopes: AutomationScope[]
  runCount: number
  successfulRuns: number
  failedRuns: number
  lastRunAt: string | null
  updatedAt: string
}

export interface AutomationVersion {
  id: string
  version: number
  status: AutomationStatus
  eventType: string
  workflowId: string
  workflowName: string
  subjectType: AutomationSubjectType
  companyIdPath: string
  subjectIdPath: string
  condition: PolicyExpression
  contentHash: string
  changeSummary: string
  validFrom: string | null
  validUntil: string | null
  scopes: AutomationScope[]
  createdBy: string
  createdAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  publishedBy: string | null
  publishedAt: string | null
}

export interface AutomationDetail extends AutomationListItem {
  current: AutomationVersion
  versions: AutomationVersion[]
}

export interface AutomationRun {
  id: string
  automationId: string
  automationName: string
  automationVersion: number
  sourceEventId: string
  eventType: string
  companyId: string | null
  companyName: string | null
  subjectType: AutomationSubjectType
  subjectId: string
  status: AutomationRunStatus
  conditionTrace: ConditionTrace | null
  workflowExecutionId: string | null
  attempts: number
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationSimulationResult {
  matched: boolean
  scopeMatched: boolean
  trace: ConditionTrace
  companyId: string | null
  subjectId: string
  workflowId: string
  wouldExecute: boolean
  explanation: string
}

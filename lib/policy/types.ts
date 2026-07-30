export type PolicyScalar = string | number | boolean | null
export type PolicyValue = PolicyScalar | PolicyScalar[] | Record<string, unknown>

export type PolicyOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'exists'
  | 'not_exists'
  | 'before'
  | 'after'
  | 'date_between'
  | 'time_between'
  | 'day_of_week'
  | 'matches_safe_pattern'
  | 'within_percentage'
  | 'outside_percentage'
  | 'distance_greater_than'
  | 'duration_greater_than'
  | 'currency_compare'

export interface PolicyCondition {
  fact: string
  operator: PolicyOperator
  value?: unknown
  valueFrom?: string
  options?: Record<string, unknown>
}

export type PolicyExpression =
  | PolicyCondition
  | { all: PolicyExpression[] }
  | { any: PolicyExpression[] }
  | { not: PolicyExpression }

export type PolicyActionType =
  | 'allow'
  | 'warn'
  | 'block'
  | 'require_justification'
  | 'require_predefined_justification'
  | 'require_attachment'
  | 'require_acceptance'
  | 'require_document'
  | 'require_insurance'
  | 'require_budget'
  | 'require_cost_allocation'
  | 'require_cost_center'
  | 'require_project'
  | 'require_account'
  | 'auto_approve'
  | 'request_approval'
  | 'add_approval_level'
  | 'replace_approver'
  | 'require_parallel_approval'
  | 'require_sequential_approval'
  | 'set_approval_quorum'
  | 'route_to_merit_approval'
  | 'route_to_cost_approval'
  | 'escalate'
  | 'notify'
  | 'create_task'
  | 'register_occurrence'
  | 'restrict_search'
  | 'hide_offer'
  | 'rank_offer'
  | 'force_preferred_supplier'
  | 'block_supplier'
  | 'enforce_class'
  | 'enforce_value_limit'
  | 'enforce_advance_notice'
  | 'enforce_payment_method'
  | 'require_reapproval'
  | 'hold_booking'
  | 'prevent_issuance'
  | 'cancel_on_expiration'
  | 'release_budget'
  | 'commit_budget'
  | 'require_manual_review'

export interface PolicyAction {
  type: PolicyActionType
  message: string
  remediation?: string
  configuration?: Record<string, unknown>
}

export type PolicyScopeType =
  | 'tenant'
  | 'group'
  | 'company'
  | 'branch'
  | 'unit'
  | 'department'
  | 'cost_center'
  | 'project'
  | 'job_title'
  | 'traveler'
  | 'requester'

export interface PolicyScope {
  type: PolicyScopeType
  id?: string | null
  mode?: 'include' | 'exclude'
  specificity: number
}

export type PolicySeverity = 'info' | 'warning' | 'blocking' | 'critical'
export type PolicyInheritanceMode = 'inherit' | 'merge' | 'override' | 'replace' | 'disable' | 'stop_inheritance'

export interface ExecutablePolicyVersion {
  policyId: string
  versionId: string
  code: string
  version: number
  name: string
  description: string
  category: string
  priority: number
  severity: PolicySeverity
  inheritanceMode: PolicyInheritanceMode
  overridable: boolean
  checkpoints: string[]
  scopes: PolicyScope[]
  condition: PolicyExpression
  actions: PolicyAction[]
  exceptions?: PolicyExpression[]
  dependencies?: Array<{ type: string; key: string; required: boolean }>
  validFrom?: string | null
  validUntil?: string | null
  timezone: string
  contentHash: string
}

export interface PolicyScopeContext {
  type: PolicyScopeType
  id?: string | null
}

export interface PolicyEvaluationContext {
  facts: Record<string, unknown>
  scopes: PolicyScopeContext[]
  checkpoint: string
  evaluatedAt: string
  mode?: 'enforce' | 'shadow' | 'simulation'
}

export interface ConditionTrace {
  kind: 'condition' | 'all' | 'any' | 'not'
  matched: boolean
  fact?: string
  operator?: PolicyOperator
  observed?: unknown
  expected?: unknown
  error?: string
  children?: ConditionTrace[]
}

export interface PolicyDecisionExplanation {
  policyId: string
  policyVersionId: string
  policyCode: string
  policyName: string
  version: number
  category: string
  priority: number
  severity: PolicySeverity
  matched: boolean
  exceptionApplied: boolean
  scopeSpecificity: number
  trace: ConditionTrace
  exceptionTraces?: ConditionTrace[]
  evaluationError?: string
  actions: PolicyAction[]
  explanation: string
}

export interface PolicyResultItem {
  policyId: string
  policyVersionId: string
  policyCode: string
  action: PolicyActionType
  message: string
  remediation?: string
  configuration: Record<string, unknown>
}

export interface PolicyEvaluationResult {
  passed: boolean
  errors: PolicyResultItem[]
  warnings: PolicyResultItem[]
  justificationsRequired: PolicyResultItem[]
  approvalsRequired: PolicyResultItem[]
  blocks: PolicyResultItem[]
  requiredDocuments: PolicyResultItem[]
  requiredActions: PolicyResultItem[]
  applicablePolicies: string[]
  policyVersions: string[]
  alternatives: string[]
  remediation: string[]
  evaluationId: string
  factsHash: string
  resultHash: string
  evaluatedAt: string
  checkpoint: string
  mode: 'enforce' | 'shadow' | 'simulation'
  decisions: PolicyDecisionExplanation[]
}

export interface PolicyConflict {
  type:
    | 'duplicate'
    | 'contradictory_actions'
    | 'missing_dependency'
    | 'dependency_cycle'
    | 'missing_scope'
    | 'missing_action'
    | 'overlapping_versions'
    | 'shadowed'
  severity: 'info' | 'warning' | 'blocking'
  policyVersionIds: string[]
  explanation: string
}

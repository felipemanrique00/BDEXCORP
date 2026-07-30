import type { PolicyExpression } from '@/lib/policy/types'

export type EnterpriseWorkflowStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'published'
  | 'suspended'
  | 'archived'

export type EnterpriseWorkflowProcessType =
  | 'travel_request'
  | 'quotation'
  | 'choice'
  | 'approval'
  | 'reservation'
  | 'issuance'
  | 'change'
  | 'cancellation'
  | 'refund'
  | 'advance'
  | 'expense_report'
  | 'reconciliation'
  | 'onboarding'
  | 'support'
  | 'incident'
  | 'integration'
  | 'administrative'
  | 'generic'

export type EnterpriseWorkflowNodeType =
  | 'start'
  | 'sequence'
  | 'human_task'
  | 'automatic_task'
  | 'condition'
  | 'decision'
  | 'domain_command'
  | 'service_call'
  | 'integration_call'
  | 'timer'
  | 'wait'
  | 'parallel_split'
  | 'parallel_join'
  | 'quorum'
  | 'sla'
  | 'escalation'
  | 'fallback'
  | 'retry'
  | 'compensation'
  | 'subworkflow'
  | 'approval'
  | 'fault_handler'
  | 'end'

export type EnterpriseWorkflowEdgeKind =
  | 'success'
  | 'condition'
  | 'default'
  | 'failure'
  | 'timeout'
  | 'parallel'
  | 'compensation'

export interface EnterpriseWorkflowScope {
  type: 'tenant' | 'group' | 'company'
  id?: string | null
  mode: 'include' | 'exclude'
  specificity: number
}

export interface EnterpriseWorkflowNode {
  id: string
  key: string
  name: string
  description?: string | null
  type: EnterpriseWorkflowNodeType
  position: {
    x: number
    y: number
  }
  configuration: Record<string, unknown>
}

export interface EnterpriseWorkflowEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  kind: EnterpriseWorkflowEdgeKind
  sequence: number
  label?: string | null
  condition?: PolicyExpression | null
}

export interface EnterpriseWorkflowGraph {
  workflowId: string
  workflowVersionId: string
  version: number
  code: string
  name: string
  processType: EnterpriseWorkflowProcessType
  contentHash: string
  source: 'manual' | 'ai_draft'
  nodes: EnterpriseWorkflowNode[]
  edges: EnterpriseWorkflowEdge[]
  validFrom?: string | null
  validUntil?: string | null
}

export interface EnterpriseWorkflowValidationIssue {
  code: string
  severity: 'blocking' | 'warning'
  message: string
  nodeIds?: string[]
  edgeIds?: string[]
}

export interface EnterpriseWorkflowValidationResult {
  valid: boolean
  issues: EnterpriseWorkflowValidationIssue[]
  topologicalOrder: string[]
}

export interface EnterpriseWorkflowSimulationStep {
  sequence: number
  nodeId: string
  nodeKey: string
  nodeName: string
  nodeType: EnterpriseWorkflowNodeType
  outcome: 'traversed' | 'waiting' | 'skipped'
  selectedEdgeIds: string[]
  explanation: string
}

export interface EnterpriseWorkflowSimulationResult {
  valid: boolean
  reachedEnd: boolean
  steps: EnterpriseWorkflowSimulationStep[]
  issues: EnterpriseWorkflowValidationIssue[]
  visitedNodeIds: string[]
}

export type EnterpriseWorkflowExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type EnterpriseWorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'

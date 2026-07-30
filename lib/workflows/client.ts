import { governanceJsonBody, requestGovernanceJson } from '@/lib/governance-client'
import type {
  EnterpriseWorkflowExecutionStatus,
  EnterpriseWorkflowGraph,
  EnterpriseWorkflowProcessType,
  EnterpriseWorkflowScope,
  EnterpriseWorkflowSimulationResult,
  EnterpriseWorkflowStatus,
  EnterpriseWorkflowStepStatus,
} from '@/lib/workflows/types'

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

export interface EnterpriseWorkflowExecutionSummary {
  id: string
  workflowId: string
  workflowVersionId: string
  workflowCode: string
  workflowName: string
  companyId: string
  companyName: string
  subjectType: string
  subjectId: string
  status: EnterpriseWorkflowExecutionStatus
  activeNodeKeys: string[]
  version: number
  startedBy: string
  startedAt: string
  completedAt: string | null
  failedAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  updatedAt: string
}

export interface EnterpriseWorkflowExecutionDetail extends EnterpriseWorkflowExecutionSummary {
  graph: EnterpriseWorkflowGraph
  context: {
    facts: Record<string, unknown>
    subject: { type: string; id: string; companyId: string }
    variables: Record<string, unknown>
    outputs: Record<string, Record<string, unknown>>
  }
  completedNodeKeys: string[]
  steps: Array<{
    id: string
    nodeKey: string
    nodeName: string
    nodeType: EnterpriseWorkflowGraph['nodes'][number]['type']
    attempt: number
    status: EnterpriseWorkflowStepStatus
    input: Record<string, unknown>
    output: Record<string, unknown>
    errorCode: string | null
    errorMessage: string | null
    assignedUserId: string | null
    assignedRoleKey: string | null
    dueAt: string | null
    startedAt: string | null
    completedAt: string | null
  }>
  commands: Array<{
    id: string
    stepId: string
    commandKey: string
    status: string
    result: Record<string, unknown>
    errorCode: string | null
    errorMessage: string | null
    startedAt: string | null
    completedAt: string | null
  }>
  events: Array<{
    id: string
    sequence: number
    type: string
    stepId: string | null
    actorUserId: string | null
    payload: Record<string, unknown>
    createdAt: string
  }>
  replayed?: boolean
}

export interface EnterpriseWorkflowEditorInput {
  name: string
  description: string
  processType: EnterpriseWorkflowProcessType
  source: 'manual' | 'ai_draft'
  scopes: EnterpriseWorkflowScope[]
  nodes: EnterpriseWorkflowGraph['nodes']
  edges: EnterpriseWorkflowGraph['edges']
  tags: string[]
  changeSummary: string
  validFrom?: string | null
  validUntil?: string | null
}

export async function fetchEnterpriseWorkflows(filters: {
  status?: EnterpriseWorkflowStatus
  processType?: EnterpriseWorkflowProcessType
  search?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: EnterpriseWorkflowListItem[]; total: number }> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: EnterpriseWorkflowListItem[]
    total: number
  }>(`/api/workflows${queryString(filters)}`)
  return { items: payload.items, total: payload.total }
}

export async function fetchEnterpriseWorkflow(
  workflowId: string,
): Promise<EnterpriseWorkflowDetail> {
  const payload = await requestGovernanceJson<{ ok: true; workflow: EnterpriseWorkflowDetail }>(
    `/api/workflows/${encodeURIComponent(workflowId)}`,
  )
  return payload.workflow
}

export async function createEnterpriseWorkflow(
  input: EnterpriseWorkflowEditorInput & { workflowCode: string },
): Promise<EnterpriseWorkflowDetail> {
  const payload = await requestGovernanceJson<{ ok: true; workflow: EnterpriseWorkflowDetail }>(
    '/api/workflows',
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.workflow
}

export async function createEnterpriseWorkflowVersion(
  workflowId: string,
  input: EnterpriseWorkflowEditorInput & { expectedCurrentVersion: number },
): Promise<EnterpriseWorkflowDetail> {
  const payload = await requestGovernanceJson<{ ok: true; workflow: EnterpriseWorkflowDetail }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/versions`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.workflow
}

export async function fetchEnterpriseWorkflowVersion(
  workflowId: string,
  versionId: string,
): Promise<{
  workflow: EnterpriseWorkflowListItem
  version: EnterpriseWorkflowVersionSummary
  graph: EnterpriseWorkflowGraph
  scopes: EnterpriseWorkflowScope[]
}> {
  const payload = await requestGovernanceJson<{
    ok: true
    workflow: EnterpriseWorkflowListItem
    version: EnterpriseWorkflowVersionSummary
    graph: EnterpriseWorkflowGraph
    scopes: EnterpriseWorkflowScope[]
  }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`,
  )
  return payload
}

export async function transitionEnterpriseWorkflow(
  workflowId: string,
  input: {
    versionId: string
    action: 'submit_review' | 'approve' | 'publish' | 'suspend' | 'archive'
    reason: string
  },
): Promise<EnterpriseWorkflowDetail> {
  const payload = await requestGovernanceJson<{ ok: true; workflow: EnterpriseWorkflowDetail }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/transition`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.workflow
}

export async function restoreEnterpriseWorkflowVersion(
  workflowId: string,
  input: { versionId: string; expectedCurrentVersion: number; reason: string },
): Promise<EnterpriseWorkflowDetail> {
  const payload = await requestGovernanceJson<{ ok: true; workflow: EnterpriseWorkflowDetail }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/restore`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.workflow
}

export async function simulateEnterpriseWorkflow(
  workflowId: string,
  input: {
    workflowVersionId?: string
    candidate?: Omit<EnterpriseWorkflowEditorInput, 'changeSummary'>
      & { workflowCode: string }
    facts: Record<string, unknown>
  },
): Promise<EnterpriseWorkflowSimulationResult & {
  workflowCode: string
  version: number
  persisted: boolean
}> {
  const payload = await requestGovernanceJson<{
    ok: true
    simulation: EnterpriseWorkflowSimulationResult & {
      workflowCode: string
      version: number
      persisted: boolean
    }
  }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/simulate`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.simulation
}

export async function fetchEnterpriseWorkflowExecutions(filters: {
  workflowId?: string
  companyId?: string
  status?: EnterpriseWorkflowExecutionStatus
  subjectType?: string
  subjectId?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: EnterpriseWorkflowExecutionSummary[]; total: number }> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: EnterpriseWorkflowExecutionSummary[]
    total: number
  }>(`/api/workflows/executions${queryString(filters)}`)
  return { items: payload.items, total: payload.total }
}

export async function fetchEnterpriseWorkflowExecution(
  executionId: string,
): Promise<EnterpriseWorkflowExecutionDetail> {
  const payload = await requestGovernanceJson<{
    ok: true
    execution: EnterpriseWorkflowExecutionDetail
  }>(`/api/workflows/executions/${encodeURIComponent(executionId)}`)
  return payload.execution
}

export async function startEnterpriseWorkflow(
  workflowId: string,
  input: {
    companyId: string
    subjectType: 'demand' | 'reservation' | 'employee' | 'company' | 'integration'
      | 'workflow_execution' | 'generic'
    subjectId: string
    facts: Record<string, unknown>
    idempotencyKey: string
  },
): Promise<EnterpriseWorkflowExecutionDetail> {
  const payload = await requestGovernanceJson<{
    ok: true
    execution: EnterpriseWorkflowExecutionDetail
  }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/executions`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.execution
}

export async function completeEnterpriseWorkflowStep(
  executionId: string,
  input: {
    nodeKey: string
    outcome: 'completed' | 'approved' | 'rejected' | 'failed' | 'timeout'
    output: Record<string, unknown>
    reason: string
    idempotencyKey: string
  },
): Promise<EnterpriseWorkflowExecutionDetail> {
  const payload = await requestGovernanceJson<{
    ok: true
    execution: EnterpriseWorkflowExecutionDetail
  }>(
    `/api/workflows/executions/${encodeURIComponent(executionId)}/complete`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.execution
}

export async function reprocessEnterpriseWorkflowStep(
  executionId: string,
  input: { nodeKey: string; reason: string; idempotencyKey: string },
): Promise<EnterpriseWorkflowExecutionDetail> {
  const payload = await requestGovernanceJson<{
    ok: true
    execution: EnterpriseWorkflowExecutionDetail
  }>(
    `/api/workflows/executions/${encodeURIComponent(executionId)}/reprocess`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.execution
}

function queryString(filters: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

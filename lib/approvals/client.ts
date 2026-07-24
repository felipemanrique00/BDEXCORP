import { governanceJsonBody, requestGovernanceJson } from '@/lib/governance-client'
import type { ApprovalWorkflowSnapshot } from '@/lib/approvals/types'

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
  type: string
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'failed' | 'superseded'
  version: number
  startedAt: string
  completedAt: string | null
  pendingSteps: number
  overdueSteps: number
  assignedToMe: boolean
}

export interface ApprovalAssignmentDetail {
  id: string
  userId: string | null
  userName: string | null
  userEmail: string | null
  status: string
  source: string
  delegatedFromUserId: string | null
  assignedAt: string
  respondedAt: string | null
}

export interface ApprovalInstanceDetail extends ApprovalInstanceSummary {
  subject: Record<string, unknown>
  workflow: ApprovalWorkflowSnapshot
  steps: Array<{
    id: string
    nodeId: string
    nodeName: string
    approvalKind: string | null
    stepNumber: number
    status: string
    completionMode: string
    quorum: number | null
    dueAt: string | null
    version: number
    assignments: ApprovalAssignmentDetail[]
  }>
  decisions: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
}

export interface ApprovalWorkflowListItem {
  id: string
  code: string
  name: string
  description: string
  type: string
  status: 'draft' | 'in_review' | 'approved' | 'published' | 'suspended' | 'archived'
  currentVersion: number | null
  scopes: Array<{ type: string; id?: string | null; mode: string; specificity: number }>
  updatedAt: string
}

export interface ApprovalWorkflowDetail extends ApprovalWorkflowListItem {
  createdBy: string
  current: ApprovalWorkflowSnapshot | null
  versions: Array<{
    id: string
    version: number
    status: string
    contentHash: string
    changeSummary: string
    validFrom: string | null
    validUntil: string | null
    createdAt: string
    approvedAt: string | null
    publishedAt: string | null
  }>
}

export async function fetchApprovalInstances(filters: {
  status?: string
  companyId?: string
  assignedToMe?: boolean
  overdueOnly?: boolean
  search?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: ApprovalInstanceSummary[]; total: number }> {
  const payload = await requestGovernanceJson<{ ok: true; items: ApprovalInstanceSummary[]; total: number }>(
    `/api/approvals/instances${queryString(filters)}`,
  )
  return { items: payload.items, total: payload.total }
}

export async function fetchApprovalInstance(instanceId: string): Promise<ApprovalInstanceDetail> {
  const payload = await requestGovernanceJson<{ ok: true; instance: ApprovalInstanceDetail }>(
    `/api/approvals/instances/${encodeURIComponent(instanceId)}`,
  )
  return payload.instance
}

export async function decideApproval(
  assignmentId: string,
  input: {
    decision: 'approved' | 'rejected' | 'abstained'
    reason: string
    expectedStepVersion: number
    idempotencyKey: string
    confirmation: true
  },
): Promise<ApprovalInstanceDetail> {
  const payload = await requestGovernanceJson<{ ok: true; instance: ApprovalInstanceDetail }>(
    `/api/approvals/assignments/${encodeURIComponent(assignmentId)}/decision`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.instance
}

export async function fetchApprovalWorkflows(filters: {
  status?: string
  type?: string
  search?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: ApprovalWorkflowListItem[]; total: number }> {
  const payload = await requestGovernanceJson<{ ok: true; items: ApprovalWorkflowListItem[]; total: number }>(
    `/api/approvals/workflows${queryString(filters)}`,
  )
  return { items: payload.items, total: payload.total }
}

export async function fetchApprovalWorkflow(workflowId: string): Promise<ApprovalWorkflowDetail> {
  const payload = await requestGovernanceJson<{ ok: true; workflow: ApprovalWorkflowDetail }>(
    `/api/approvals/workflows/${encodeURIComponent(workflowId)}`,
  )
  return payload.workflow
}

export async function transitionApprovalWorkflow(
  workflowId: string,
  input: {
    versionId: string
    action: 'submit_review' | 'approve' | 'publish' | 'suspend' | 'archive'
    reason: string
  },
): Promise<ApprovalWorkflowDetail> {
  const payload = await requestGovernanceJson<{ ok: true; workflow: ApprovalWorkflowDetail }>(
    `/api/approvals/workflows/${encodeURIComponent(workflowId)}/transition`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.workflow
}

export async function fetchApprovalDelegations(): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const payload = await requestGovernanceJson<{ ok: true; items: Array<Record<string, unknown>>; total: number }>(
    '/api/approvals/delegations?limit=200',
  )
  return { items: payload.items, total: payload.total }
}

export async function fetchApprovalAuthorities(): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const payload = await requestGovernanceJson<{ ok: true; items: Array<Record<string, unknown>>; total: number }>(
    '/api/approvals/authorities?limit=200',
  )
  return { items: payload.items, total: payload.total }
}

function queryString(filters: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

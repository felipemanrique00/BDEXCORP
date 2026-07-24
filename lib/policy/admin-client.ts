import { governanceJsonBody, requestGovernanceJson } from '@/lib/governance-client'
import type {
  ExecutablePolicyVersion,
  PolicyAction,
  PolicyConflict,
  PolicyEvaluationResult,
  PolicyExpression,
  PolicyScope,
} from '@/lib/policy/types'
import type { PolicyTemplateConfiguration } from '@/lib/policy/templates/types'

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

export interface PolicyScopeInput {
  type: PolicyScope['type']
  id?: string | null
  mode: 'include' | 'exclude'
  specificity: number
}

export interface PolicyTemplateInstantiationInput {
  scope: PolicyScopeInput
  policyCode?: string
  name?: string
  description?: string
  priority?: number
  severity?: 'info' | 'warning' | 'blocking' | 'critical'
  inheritanceMode?: 'inherit' | 'merge' | 'override' | 'replace'
  overridable?: boolean
  validFrom?: string | null
  validUntil?: string | null
  tags?: string[]
}

export interface PolicySimulationInput {
  name: string
  sourceType: 'manual' | 'historical' | 'comparison'
  policyVersionIds: string[]
  facts: Record<string, unknown>
  scopes: PolicyScopeInput[]
  checkpoint: string
  evaluatedAt: string
  persistResult: boolean
}

export interface PolicyDraftPayload {
  policyCode: string
  name: string
  description: string
  category: string
  priority: number
  severity: 'info' | 'warning' | 'blocking' | 'critical'
  inheritanceMode: 'inherit' | 'merge' | 'override' | 'replace' | 'disable' | 'stop_inheritance'
  overridable: boolean
  businessJustification: string
  changeSummary: string
  tags: string[]
  checkpoints: string[]
  timezone: string
  validFrom?: string | null
  validUntil?: string | null
  scopes: PolicyScopeInput[]
  condition: PolicyExpression
  actions: PolicyAction[]
  exceptions: PolicyExpression[]
  dependencies: Array<{
    type: 'policy' | 'workflow' | 'budget' | 'directory' | 'integration' | 'feature'
    key: string
    required: boolean
    minimumVersion?: string
    configuration: Record<string, unknown>
  }>
}

export type PolicyVersionPayload = Omit<PolicyDraftPayload, 'policyCode'> & {
  expectedCurrentVersion: number
}

export async function fetchPolicies(filters: {
  status?: string
  category?: string
  search?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: PolicyListItem[]; total: number }> {
  const query = queryString(filters)
  const payload = await requestGovernanceJson<{ ok: true; items: PolicyListItem[]; total: number }>(
    `/api/policies${query}`,
  )
  return { items: payload.items, total: payload.total }
}

export async function fetchPolicyDetail(policyId: string): Promise<PolicyDetail> {
  const payload = await requestGovernanceJson<{ ok: true; policy: PolicyDetail }>(
    `/api/policies/${encodeURIComponent(policyId)}`,
  )
  return payload.policy
}

export async function createPolicyDraft(input: PolicyDraftPayload): Promise<PolicyDetail> {
  const payload = await requestGovernanceJson<{ ok: true; policy: PolicyDetail }>(
    '/api/policies',
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.policy
}

export async function createPolicyVersion(
  policyId: string,
  input: PolicyVersionPayload,
): Promise<PolicyDetail> {
  const payload = await requestGovernanceJson<{ ok: true; policy: PolicyDetail }>(
    `/api/policies/${encodeURIComponent(policyId)}/versions`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.policy
}

export async function fetchPolicyTemplates(filters: {
  category?: string
  segment?: string
  search?: string
  limit?: number
  offset?: number
} = {}): Promise<{
  items: PolicyTemplateConfiguration[]
  total: number
  families: number
  categories: number
}> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: PolicyTemplateConfiguration[]
    total: number
    families: number
    categories: number
  }>(`/api/policies/templates${queryString(filters)}`)
  return payload
}

export async function instantiatePolicyTemplate(
  templateKey: string,
  input: PolicyTemplateInstantiationInput,
): Promise<PolicyDetail> {
  const payload = await requestGovernanceJson<{ ok: true; policy: PolicyDetail }>(
    `/api/policies/templates/${encodeURIComponent(templateKey)}/instantiate`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.policy
}

export async function transitionPolicy(
  policyId: string,
  input: {
    versionId: string
    action: 'submit_review' | 'approve' | 'publish' | 'suspend' | 'archive'
    reason: string
  },
): Promise<PolicyDetail> {
  const payload = await requestGovernanceJson<{ ok: true; policy: PolicyDetail }>(
    `/api/policies/${encodeURIComponent(policyId)}/transition`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.policy
}

export async function simulatePolicySet(input: PolicySimulationInput): Promise<{
  simulationId: string | null
  result: PolicyEvaluationResult
  conflicts: PolicyConflict[]
}> {
  const payload = await requestGovernanceJson<{
    ok: true
    simulationId: string | null
    result: PolicyEvaluationResult
    conflicts: PolicyConflict[]
  }>('/api/policies/simulate', { method: 'POST', ...governanceJsonBody(input) })
  return payload
}

function queryString(filters: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

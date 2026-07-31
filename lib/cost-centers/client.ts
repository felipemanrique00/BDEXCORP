import { governanceJsonBody, requestGovernanceJson } from '@/lib/governance-client'
import type {
  ActivateCostCenterPlanInput,
  DeactivateCostCenterInput,
  CreateCostCenterInput,
  CreateCostCenterPlanInput,
  UpdateCostCenterInput,
} from '@/lib/cost-centers/schema'
import type {
  CostCenter,
  CostCenterListResult,
  CostCenterPlan,
  CostCenterPlanListResult,
} from '@/lib/cost-centers/types'

export async function fetchCostCenters(filters: {
  companyId?: string
  planId?: string
  search?: string
  includeInactive?: boolean
  limit?: number
  offset?: number
} = {}): Promise<CostCenterListResult> {
  const payload = await requestGovernanceJson<
    { ok: true } & CostCenterListResult & Record<string, unknown>
  >(
    `/api/cost-centers${queryString(filters)}`,
  )
  return payload
}

export async function fetchCostCenter(
  id: string,
  companyId?: string,
): Promise<CostCenter> {
  const payload = await requestGovernanceJson<{ ok: true; item: CostCenter }>(
    `/api/cost-centers/${encodeURIComponent(id)}${queryString({ companyId })}`,
  )
  return payload.item
}

export async function createCostCenterClient(input: CreateCostCenterInput): Promise<CostCenter> {
  const payload = await requestGovernanceJson<{ ok: true; item: CostCenter }>(
    '/api/cost-centers',
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.item
}

export async function updateCostCenterClient(
  id: string,
  input: UpdateCostCenterInput,
): Promise<CostCenter> {
  const payload = await requestGovernanceJson<{ ok: true; item: CostCenter }>(
    `/api/cost-centers/${encodeURIComponent(id)}`,
    { method: 'PATCH', ...governanceJsonBody(input) },
  )
  return payload.item
}

export async function deactivateCostCenterClient(
  id: string,
  input: DeactivateCostCenterInput,
): Promise<CostCenter> {
  const payload = await requestGovernanceJson<{ ok: true; item: CostCenter }>(
    `/api/cost-centers/${encodeURIComponent(id)}`,
    { method: 'DELETE', ...governanceJsonBody(input) },
  )
  return payload.item
}

export async function fetchCostCenterPlans(filters: {
  companyId?: string
  groupId?: string
  search?: string
  includeInactive?: boolean
  limit?: number
  offset?: number
} = {}): Promise<CostCenterPlanListResult> {
  const payload = await requestGovernanceJson<
    { ok: true } & CostCenterPlanListResult & Record<string, unknown>
  >(
    `/api/cost-center-plans${queryString(filters)}`,
  )
  return payload
}

export async function createCostCenterPlanClient(
  input: CreateCostCenterPlanInput,
): Promise<CostCenterPlan> {
  const payload = await requestGovernanceJson<{ ok: true; plan: CostCenterPlan }>(
    '/api/cost-center-plans',
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.plan
}

export async function activateCostCenterPlanClient(
  id: string,
  input: ActivateCostCenterPlanInput,
): Promise<CostCenterPlan> {
  const payload = await requestGovernanceJson<{ ok: true; plan: CostCenterPlan }>(
    `/api/cost-center-plans/${encodeURIComponent(id)}/activate`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.plan
}

function queryString(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

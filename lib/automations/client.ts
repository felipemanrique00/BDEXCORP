import type {
  AutomationDetail,
  AutomationDraftInput,
  AutomationListItem,
  AutomationRun,
  AutomationRunStatus,
  AutomationSimulationInput,
  AutomationSimulationResult,
  AutomationStatus,
  AutomationTransitionInput,
  AutomationVersionInput,
} from '@/lib/automations'
import {
  governanceJsonBody,
  requestGovernanceJson,
} from '@/lib/governance-client'

export async function fetchAutomations(filters: {
  status?: AutomationStatus
  eventType?: string
  search?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: AutomationListItem[]; total: number }> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: AutomationListItem[]
    total: number
  }>(`/api/automations${queryString(filters)}`)
  return { items: payload.items, total: payload.total }
}

export async function fetchAutomation(id: string): Promise<AutomationDetail> {
  const payload = await requestGovernanceJson<{ ok: true; automation: AutomationDetail }>(
    `/api/automations/${encodeURIComponent(id)}`,
  )
  return payload.automation
}

export async function createAutomation(
  input: AutomationDraftInput,
): Promise<AutomationDetail> {
  const payload = await requestGovernanceJson<{ ok: true; automation: AutomationDetail }>(
    '/api/automations',
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.automation
}

export async function updateAutomation(
  id: string,
  input: AutomationVersionInput,
): Promise<AutomationDetail> {
  const payload = await requestGovernanceJson<{ ok: true; automation: AutomationDetail }>(
    `/api/automations/${encodeURIComponent(id)}`,
    { method: 'PATCH', ...governanceJsonBody(input) },
  )
  return payload.automation
}

export async function createAutomationVersion(
  id: string,
  input: AutomationVersionInput,
): Promise<AutomationDetail> {
  const payload = await requestGovernanceJson<{ ok: true; automation: AutomationDetail }>(
    `/api/automations/${encodeURIComponent(id)}/versions`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.automation
}

export async function transitionAutomationClient(
  id: string,
  input: AutomationTransitionInput,
): Promise<AutomationDetail> {
  const payload = await requestGovernanceJson<{ ok: true; automation: AutomationDetail }>(
    `/api/automations/${encodeURIComponent(id)}/transition`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.automation
}

export async function simulateAutomationClient(
  id: string,
  input: AutomationSimulationInput,
): Promise<AutomationSimulationResult> {
  const payload = await requestGovernanceJson<{
    ok: true
    simulation: AutomationSimulationResult
  }>(
    `/api/automations/${encodeURIComponent(id)}/simulate`,
    { method: 'POST', ...governanceJsonBody(input) },
  )
  return payload.simulation
}

export async function fetchAutomationRuns(filters: {
  automationId?: string
  status?: AutomationRunStatus
  companyId?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: AutomationRun[]; total: number }> {
  const payload = await requestGovernanceJson<{
    ok: true
    items: AutomationRun[]
    total: number
  }>(`/api/automations/runs${queryString(filters)}`)
  return { items: payload.items, total: payload.total }
}

export async function processAutomations(
  limit = 25,
): Promise<{ claimed: number; completed: number; skipped: number; failed: number; runIds: string[] }> {
  return requestGovernanceJson<{
    ok: true
    claimed: number
    completed: number
    skipped: number
    failed: number
    runIds: string[]
  }>(
    '/api/automations/process',
    { method: 'POST', ...governanceJsonBody({ limit }) },
  )
}

function queryString(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    query.set(key, String(value))
  })
  const value = query.toString()
  return value ? `?${value}` : ''
}

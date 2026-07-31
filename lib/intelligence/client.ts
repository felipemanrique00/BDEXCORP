import type {
  IntelligenceFilters,
  IntelligenceInsight,
  IntelligenceInsightTransitionInput,
  IntelligenceOverview,
} from '@/lib/intelligence'
import { appendCompanyIdsQuery } from '@/lib/company-selection-query'
import {
  governanceJsonBody,
  requestGovernanceJson,
} from '@/lib/governance-client'

export async function fetchIntelligenceOverview(
  filters: IntelligenceFilters,
): Promise<IntelligenceOverview> {
  const payload = await requestGovernanceJson<{
    ok: true
    overview: IntelligenceOverview
  }>(`/api/intelligence/overview${queryString(filters)}`)
  return payload.overview
}

export async function transitionIntelligenceInsight(
  fingerprint: string,
  input: IntelligenceInsightTransitionInput,
): Promise<IntelligenceInsight> {
  const payload = await requestGovernanceJson<{
    ok: true
    insight: IntelligenceInsight
  }>(`/api/intelligence/insights/${encodeURIComponent(fingerprint)}`, {
    method: 'PATCH',
    ...governanceJsonBody(input),
  })
  return payload.insight
}

function queryString(filters: IntelligenceFilters): string {
  const query = new URLSearchParams()
  query.set('startDate', filters.startDate)
  query.set('endDate', filters.endDate)
  if (filters.contextType) query.set('contextType', filters.contextType)
  if (filters.contextId) query.set('contextId', filters.contextId)
  appendCompanyIdsQuery(query, filters.companyIds)
  return `?${query.toString()}`
}

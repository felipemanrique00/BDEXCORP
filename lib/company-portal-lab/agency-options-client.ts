import { requestGovernanceJson } from '@/lib/governance-client'
import type { AirTravelerProfileIssue } from '@/lib/travelers/air-profile'

export interface AgencyDemandRequesterOption {
  id: string
  employeeId: string | null
  name: string
  email: string
  department: string | null
  costCenter: string | null
  hasActivePortalAccess: boolean
}

export interface AgencyDemandTravelerOption {
  id: string
  identificationCode: string
  name: string
  email: string | null
  department: string | null
  jobTitle: string | null
  costCenterId: string | null
  costCenter: string | null
  profileIssues: AirTravelerProfileIssue[]
}

export interface AgencyDemandOptionsFilters {
  requesterQ?: string
  travelerQ?: string
  participant?: 'all' | 'requesters' | 'travelers'
  limit?: number
}

export interface AgencyDemandOptionsResult {
  companyId: string
  requesters: AgencyDemandRequesterOption[]
  requesterTotal: number
  travelers: AgencyDemandTravelerOption[]
  travelerTotal: number
  limit: number
}

export async function listCompanyPortalAgencyDemandOptions(
  companyId: string,
  filters: AgencyDemandOptionsFilters = {},
): Promise<AgencyDemandOptionsResult> {
  const search = new URLSearchParams({
    companyId,
    participant: filters.participant || 'all',
    limit: String(Math.min(100, Math.max(1, Math.trunc(filters.limit ?? 50)))),
  })
  if (filters.requesterQ?.trim()) search.set('requesterQ', filters.requesterQ.trim())
  if (filters.travelerQ?.trim()) search.set('travelerQ', filters.travelerQ.trim())
  return requestGovernanceJson<Record<string, unknown> & { ok: true } & AgencyDemandOptionsResult>(
    `/api/company-portal/demands/agency-options?${search}`,
  )
}

import 'server-only'

import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { canCreateAgencyAssistedDemand } from '@/lib/demands/agency-assistance'
import {
  CorporateAccessDeniedError,
  requireCompanyAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  airTravelerBirthDateFromMetadata,
  assessAirTravelerProfile,
  type AirTravelerProfileIssue,
} from '@/lib/travelers/air-profile'

const agencyDemandOptionsQuerySchema = z.object({
  companyId: z.string().trim().min(1).max(200),
  requesterQ: z.string().trim().max(160).optional(),
  travelerQ: z.string().trim().max(160).optional(),
  participant: z.enum(['all', 'requesters', 'travelers']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()

interface RequesterOptionRow extends QueryResultRow {
  id: string
  employee_id: string | null
  name: string
  email: string
  department: string | null
  cost_center: string | null
  total_count: string | number
}

interface TravelerOptionRow extends QueryResultRow {
  id: string
  identification_code: string
  full_name: string
  email: string | null
  department: string | null
  job_title: string | null
  cost_center_id: string | null
  cost_center: string | null
  document_number: string | null
  metadata: Record<string, unknown> | null
  total_count: string | number
}

export interface AgencyDemandRequesterOption {
  id: string
  employeeId: string | null
  name: string
  email: string
  department: string | null
  costCenter: string | null
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

export interface AgencyDemandOptionsResult {
  companyId: string
  requesters: AgencyDemandRequesterOption[]
  requesterTotal: number
  travelers: AgencyDemandTravelerOption[]
  travelerTotal: number
  limit: number
}

export async function listAgencyDemandOptions(
  principal: RequestPrincipal,
  rawQuery: unknown,
): Promise<AgencyDemandOptionsResult> {
  const query = agencyDemandOptionsQuerySchema.parse(rawQuery)
  if (!canCreateAgencyAssistedDemand(principal)) {
    throw new CorporateAccessDeniedError(
      'AGENCY_ASSISTED_DEMAND_DENIED',
      'Somente a equipe interna da agencia pode consultar participantes para uma demanda assistida.',
    )
  }
  await requireCompanyAccess(principal, query.companyId, 'criar_demandas')

  return withTenantTransaction(principal.tenantId, async (client) => {
    let requesterRows: RequesterOptionRow[] = []
    if (query.participant !== 'travelers') {
      const requesterValues: unknown[] = [principal.tenantId, query.companyId]
      const requesterClauses = [
        'requester.tenant_id = $1',
        'requester.company_id = $2',
        `requester.status = 'active'`,
        'requester.deleted_at is null',
      ]
      if (query.requesterQ) {
        requesterValues.push(`%${query.requesterQ.toLowerCase()}%`)
        requesterClauses.push(`(
          lower(requester.name) like $${requesterValues.length}
          or lower(requester.email::text) like $${requesterValues.length}
          or lower(coalesce(requester.department, '')) like $${requesterValues.length}
          or lower(coalesce(requester.cost_center, '')) like $${requesterValues.length}
        )`)
      }
      requesterValues.push(query.limit)
      const requesterResult = await client.query<RequesterOptionRow>(
        `select requester.id, requester.employee_id, requester.name,
                requester.email::text, requester.department, requester.cost_center,
                count(*) over() as total_count
         from requesters requester
         where ${requesterClauses.join(' and ')}
         order by lower(requester.name), requester.id
         limit $${requesterValues.length}`,
        requesterValues,
      )
      requesterRows = requesterResult.rows
    }

    let travelerRows: TravelerOptionRow[] = []
    if (query.participant !== 'requesters') {
      const travelerValues: unknown[] = [principal.tenantId, query.companyId]
      const travelerClauses = [
        'employee.tenant_id = $1',
        'employee.company_id = $2',
        `employee.status = 'active'`,
        'employee.deleted_at is null',
      ]
      if (query.travelerQ) {
        travelerValues.push(`%${query.travelerQ.toLowerCase()}%`)
        travelerClauses.push(`(
          lower(employee.full_name) like $${travelerValues.length}
          or lower(employee.identification_code) like $${travelerValues.length}
          or lower(coalesce(employee.registration_code, '')) like $${travelerValues.length}
          or lower(coalesce(employee.email::text, '')) like $${travelerValues.length}
        )`)
      }
      travelerValues.push(query.limit)
      const travelerResult = await client.query<TravelerOptionRow>(
        `select employee.id, employee.identification_code, employee.full_name,
                employee.email::text, employee.department, employee.job_title,
                employee.cost_center_id, employee.cost_center,
                employee.document_number, employee.metadata,
                count(*) over() as total_count
         from employees employee
         where ${travelerClauses.join(' and ')}
         order by lower(employee.full_name), employee.id
         limit $${travelerValues.length}`,
        travelerValues,
      )
      travelerRows = travelerResult.rows
    }

    return {
      companyId: query.companyId,
      requesters: requesterRows.map((row) => ({
        id: row.id,
        employeeId: row.employee_id,
        name: row.name,
        email: row.email,
        department: row.department,
        costCenter: row.cost_center,
      })),
      requesterTotal: requesterRows[0] ? Number(requesterRows[0].total_count) : 0,
      travelers: travelerRows.map((row) => ({
        id: row.id,
        identificationCode: row.identification_code,
        name: row.full_name,
        email: row.email,
        department: row.department,
        jobTitle: row.job_title,
        costCenterId: row.cost_center_id,
        costCenter: row.cost_center,
        profileIssues: assessAirTravelerProfile({
          name: row.full_name,
          documentNumber: row.document_number,
          birthDate: airTravelerBirthDateFromMetadata(row.metadata),
        }).profileIssues,
      })),
      travelerTotal: travelerRows[0] ? Number(travelerRows[0].total_count) : 0,
      limit: query.limit,
    }
  })
}

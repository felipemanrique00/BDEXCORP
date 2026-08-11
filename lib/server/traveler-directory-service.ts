import 'server-only'

import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import type { TravelerDirectoryItem } from '@/lib/travelers/types'
import {
  airTravelerBirthDateFromMetadata,
  assessAirTravelerProfile,
} from '@/lib/travelers/air-profile'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const travelerQuerySchema = z.object({
  companyId: z.string().trim().min(1).max(200),
  q: z.string().trim().max(160).optional(),
  ids: z.string().trim().max(20_099).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

interface TravelerRow extends QueryResultRow {
  id: string
  company_id: string
  identification_code: string
  full_name: string
  email: string | null
  phone: string | null
  job_title: string | null
  department: string | null
  cost_center_id: string | null
  cost_center: string | null
  registration_code: string | null
  document_number: string | null
  metadata: Record<string, unknown> | null
  total_count: string | number
}

export async function listTravelerDirectory(
  principal: RequestPrincipal,
  rawQuery: unknown,
): Promise<{ items: TravelerDirectoryItem[]; total: number }> {
  const query = travelerQuerySchema.parse(rawQuery)
  await requireCompanyAccess(principal, query.companyId, 'criar_demandas')
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId, query.companyId]
    const clauses = [
      'employee.tenant_id = $1',
      'employee.company_id = $2',
      `employee.status = 'active'`,
      'employee.deleted_at is null',
    ]
    const employeeIds = travelerIds(query.ids)
    if (employeeIds.length) {
      values.push(employeeIds)
      clauses.push(`employee.id = any($${values.length}::text[])`)
    }
    if (query.q) {
      values.push(`%${query.q.toLowerCase()}%`)
      clauses.push(`(
        lower(employee.full_name) like $${values.length}
        or lower(employee.identification_code) like $${values.length}
        or lower(coalesce(employee.registration_code, '')) like $${values.length}
        or lower(coalesce(employee.email::text, '')) like $${values.length}
      )`)
    }
    values.push(query.limit, query.offset)
    const result = await client.query<TravelerRow>(
      `select employee.*, count(*) over() as total_count
       from employees employee
       where ${clauses.join(' and ')}
       order by lower(employee.full_name)
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        companyId: row.company_id,
        identificationCode: row.identification_code,
        name: row.full_name,
        email: row.email,
        phone: row.phone,
        jobTitle: row.job_title,
        department: row.department,
        costCenterId: row.cost_center_id,
        costCenter: row.cost_center,
        registrationCode: row.registration_code,
        profileIssues: assessAirTravelerProfile({
          name: row.full_name,
          documentNumber: row.document_number,
          birthDate: airTravelerBirthDateFromMetadata(row.metadata),
        }).profileIssues,
      })),
      total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    }
  })
}

function travelerIds(value: string | undefined): string[] {
  if (!value) return []
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 100)
}

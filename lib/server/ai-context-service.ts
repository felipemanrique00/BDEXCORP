import 'server-only'

import { createHash } from 'node:crypto'

import { getAccessibleCompanyIds } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { retrieveAuthorizedKnowledgeInTransaction } from '@/lib/server/knowledge-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { Permissoes } from '@/types'

export interface AuthorizedAiContext {
  companyIds: string[]
  prompt: string
  internalSources: Array<{ title: string }>
  summary: {
    companies: number
    employees: number
    demands: number
    vouchers: number
    policies: number
    knowledgeChunks: number
    includesFinance: boolean
    queryHash: string
  }
}

interface CompanyRow {
  id: string
  name: string
  group_name: string | null
}

interface EmployeeRow {
  id: string
  identification_code: string
  full_name: string
  job_title: string | null
  department: string | null
  cost_center: string | null
  company_name: string
}

interface DemandRow {
  id: string
  demand_number: string
  service_type: string
  passenger_name_snapshot: string
  status: string
  priority: string
  travel_start_date: string | null
  company_name: string
}

interface VoucherRow {
  id: string
  voucher_code: string
  status: string
  issued_at: string | null
  passenger_name: string | null
  company_name: string
}

interface PolicyRow {
  policy_code: string
  name: string
  category: string
  status: string
}

interface FinanceRow {
  total_amount: string | number
  open_amount: string | number
  entry_count: string | number
}

const MaximumQueryLength = 600

export async function buildAuthorizedAiContext(
  principal: RequestPrincipal,
  rawQuery: string,
): Promise<AuthorizedAiContext> {
  const query = normalizeQuery(rawQuery)
  const queryHash = createHash('sha256').update(query).digest('hex')
  const companyIds = accessibleCompanyIdsFor(principal, 'usar_ia')

  if (!companyIds.length) {
    return {
      companyIds: [],
      prompt: 'Nenhuma empresa esta disponivel no escopo autorizado desta sessao.',
      internalSources: [],
      summary: {
        companies: 0,
        employees: 0,
        demands: 0,
        vouchers: 0,
        policies: 0,
        knowledgeChunks: 0,
        includesFinance: false,
        queryHash,
      },
    }
  }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const companies = await client.query<CompanyRow>(
      `select company.id,
              coalesce(company.trade_name, company.legal_name) as name,
              business_group.name as group_name
       from companies company
       left join business_groups business_group
         on business_group.tenant_id = company.tenant_id
        and business_group.id = company.group_id
        and business_group.deleted_at is null
       where company.tenant_id = $1
         and company.id = any($2::text[])
         and company.status = 'active'
         and company.deleted_at is null
       order by name
       limit 60`,
      [principal.tenantId, companyIds],
    )

    const employees = principal.user.permissoes?.ver_funcionarios
      ? await client.query<EmployeeRow>(
          `select employee.id, employee.identification_code, employee.full_name,
                  employee.job_title, employee.department, employee.cost_center,
                  coalesce(company.trade_name, company.legal_name) as company_name
           from employees employee
           join companies company
             on company.tenant_id = employee.tenant_id
            and company.id = employee.company_id
           where employee.tenant_id = $1
             and employee.company_id = any($2::text[])
             and employee.deleted_at is null
             and employee.status = 'active'
             and (
               $3 = ''
               or employee.full_name ilike $4
               or employee.identification_code ilike $4
               or coalesce(employee.job_title, '') ilike $4
               or coalesce(employee.department, '') ilike $4
               or coalesce(employee.cost_center, '') ilike $4
             )
           order by employee.updated_at desc
           limit 12`,
          [principal.tenantId, companyIds, query, likeQuery(query)],
        )
      : { rows: [] as EmployeeRow[] }

    const demands = principal.user.permissoes?.ver_demandas
      ? await client.query<DemandRow>(
          `select demand.id, demand.demand_number, demand.service_type,
                  demand.passenger_name_snapshot, demand.status, demand.priority,
                  demand.travel_start_date,
                  coalesce(company.trade_name, company.legal_name) as company_name
           from demands demand
           join companies company
             on company.tenant_id = demand.tenant_id
            and company.id = demand.company_id
           where demand.tenant_id = $1
             and demand.company_id = any($2::text[])
             and (
               $3 = ''
               or demand.demand_number ilike $4
               or demand.passenger_name_snapshot ilike $4
               or demand.service_type ilike $4
               or demand.status ilike $4
             )
           order by demand.updated_at desc
           limit 16`,
          [principal.tenantId, companyIds, query, likeQuery(query)],
        )
      : { rows: [] as DemandRow[] }

    const vouchers = principal.user.permissoes?.ver_vouchers
      ? await client.query<VoucherRow>(
          `select voucher.id, voucher.voucher_code, voucher.status,
                  voucher.issued_at,
                  demand.passenger_name_snapshot as passenger_name,
                  coalesce(company.trade_name, company.legal_name) as company_name
           from vouchers voucher
           join companies company
             on company.tenant_id = voucher.tenant_id
            and company.id = voucher.company_id
           left join demands demand
             on demand.tenant_id = voucher.tenant_id
            and demand.id = voucher.demand_id
           where voucher.tenant_id = $1
             and voucher.company_id = any($2::text[])
             and (
               $3 = ''
               or voucher.voucher_code ilike $4
               or voucher.status ilike $4
               or coalesce(demand.passenger_name_snapshot, '') ilike $4
             )
           order by voucher.updated_at desc
           limit 12`,
          [principal.tenantId, companyIds, query, likeQuery(query)],
        )
      : { rows: [] as VoucherRow[] }

    const policies = principal.user.permissoes?.ver_politicas
      ? await client.query<PolicyRow>(
          `select policy_code, name, category, status
           from policy_definitions
           where tenant_id = $1
             and status in ('published', 'approved', 'in_review')
             and (
               $2 = ''
               or policy_code ilike $3
               or name ilike $3
               or category ilike $3
             )
           order by priority desc, updated_at desc
           limit 12`,
          [principal.tenantId, query, likeQuery(query)],
        )
      : { rows: [] as PolicyRow[] }

    const knowledge = await retrieveAuthorizedKnowledgeInTransaction(
      client,
      principal,
      query,
      8,
    )
    const includesFinance = Boolean(principal.user.permissoes?.ver_financeiro)
    const finance = includesFinance
      ? await client.query<FinanceRow>(
          `select coalesce(sum(amount), 0)::text as total_amount,
                  coalesce(sum(amount) filter (
                    where status not in ('settled', 'paid', 'cancelled', 'canceled')
                  ), 0)::text as open_amount,
                  count(*)::text as entry_count
           from financial_entries
           where tenant_id = $1
             and company_id = any($2::text[])`,
          [principal.tenantId, companyIds],
        )
      : { rows: [] as FinanceRow[] }

    return {
      companyIds,
      prompt: serializeContext({
        companies: companies.rows,
        employees: employees.rows,
        demands: demands.rows,
        vouchers: vouchers.rows,
        policies: policies.rows,
        knowledge,
        finance: finance.rows[0] || null,
      }),
      internalSources: Array.from(new Set(
        knowledge.map((item) => `[${item.documentCode}] ${item.title}`),
      )).map((title) => ({ title })),
      summary: {
        companies: companies.rows.length,
        employees: employees.rows.length,
        demands: demands.rows.length,
        vouchers: vouchers.rows.length,
        policies: policies.rows.length,
        knowledgeChunks: knowledge.length,
        includesFinance,
        queryHash,
      },
    }
  })
}

function accessibleCompanyIdsFor(
  principal: RequestPrincipal,
  permission: keyof Permissoes,
): string[] {
  const companyAccess = principal.corporateAccess?.companies
  if (companyAccess?.length) {
    return companyAccess
      .filter((company) => company.permissions[permission])
      .map((company) => company.companyId)
  }
  return principal.user.permissoes?.[permission]
    ? getAccessibleCompanyIds(principal)
    : []
}

function normalizeQuery(value: string): string {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MaximumQueryLength)
}

function likeQuery(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`)
  return `%${escaped}%`
}

function serializeContext(value: {
  companies: CompanyRow[]
  employees: EmployeeRow[]
  demands: DemandRow[]
  vouchers: VoucherRow[]
  policies: PolicyRow[]
  knowledge: Awaited<ReturnType<typeof retrieveAuthorizedKnowledgeInTransaction>>
  finance: FinanceRow | null
}): string {
  const payload = {
    companies: value.companies.map((company) => ({
      id: company.id,
      name: company.name,
      group: company.group_name,
    })),
    employees: value.employees.map((employee) => ({
      id: employee.identification_code,
      name: employee.full_name,
      jobTitle: employee.job_title,
      department: employee.department,
      costCenter: employee.cost_center,
      company: employee.company_name,
    })),
    demands: value.demands.map((demand) => ({
      number: demand.demand_number,
      passenger: demand.passenger_name_snapshot,
      service: demand.service_type,
      status: demand.status,
      priority: demand.priority,
      travelStart: demand.travel_start_date,
      company: demand.company_name,
    })),
    vouchers: value.vouchers.map((voucher) => ({
      code: voucher.voucher_code,
      passenger: voucher.passenger_name,
      status: voucher.status,
      issuedAt: voucher.issued_at,
      company: voucher.company_name,
    })),
    policies: value.policies.map((policy) => ({
      code: policy.policy_code,
      name: policy.name,
      category: policy.category,
      status: policy.status,
    })),
    knowledge: value.knowledge.map((item) => ({
      citation: `[${item.documentCode}:${item.chunkIndex + 1}]`,
      title: item.title,
      classification: item.classification,
      excerpt: item.excerpt,
    })),
    finance: value.finance
      ? {
          total: Number(value.finance.total_amount || 0),
          open: Number(value.finance.open_amount || 0),
          entries: Number(value.finance.entry_count || 0),
        }
      : 'not_authorized',
  }

  return JSON.stringify(payload)
}

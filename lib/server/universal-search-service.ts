import 'server-only'

import {
  authorizeOrThrow,
  evaluateAuthorization,
  type AuthorizationAction,
  type AuthorizationResource,
} from '@/lib/server/authorization-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  UNIVERSAL_SEARCH_KINDS,
  type UniversalSearchItem,
  type UniversalSearchKind,
  type UniversalSearchResult,
} from '@/lib/universal-search-contract'
import type { Permissoes } from '@/types'

interface UniversalSearchInput {
  query: string
  limit?: number
  types?: UniversalSearchKind[]
}

interface SearchRow {
  kind: UniversalSearchKind
  id: string
  title: string
  subtitle: string
  detail: string | null
  href: string
  company_id: string | null
  company_name: string | null
  group_id: string | null
  group_name: string | null
}

const SEARCH_TRANSLATE_FROM = 'áàâãäåéèêëíìîïóòôõöúùûüçñ'
const SEARCH_TRANSLATE_TO = 'aaaaaaeeeeiiiiooooouuuucn'

export async function searchUniversal(
  principal: RequestPrincipal,
  input: UniversalSearchInput,
): Promise<UniversalSearchResult> {
  authorizeOrThrow(principal, {
    action: 'use',
    resource: 'search',
    requiredPermission: 'usar_busca_global',
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  })

  const query = normalizeSearch(input.query)
  const limit = Math.min(Math.max(Math.trunc(input.limit || 12), 1), 30)
  const requestedTypes = Array.from(new Set(
    (input.types?.length ? input.types : [...UNIVERSAL_SEARCH_KINDS])
      .filter((kind): kind is UniversalSearchKind => UNIVERSAL_SEARCH_KINDS.includes(kind)),
  ))
  const tokens = query.split(' ').filter(Boolean).slice(0, 8).map((token) => `%${token}%`)

  const companyIds = effectiveCompanyIds(principal, 'companies', 'list', 'ver_empresas')
  const employeeCompanyIds = effectiveCompanyIds(principal, 'employees', 'list', 'ver_funcionarios')
  const demandCompanyIds = effectiveCompanyIds(principal, 'demands', 'list', 'ver_demandas')
  const reservationCompanyIds = effectiveCompanyIds(principal, 'reservations', 'list', 'ver_reservas')
  const emissionCompanyIds = effectiveCompanyIds(principal, 'emissions', 'list', 'ver_emissoes')
  const voucherCompanyIds = effectiveCompanyIds(principal, 'vouchers', 'list', 'ver_vouchers')
  const groupIds = Array.from(new Set(
    (principal.corporateAccess?.companies || [])
      .filter((company) => companyIds.includes(company.companyId) && company.groupId)
      .map((company) => company.groupId!),
  ))
  const canSearchPolicies = hasScopedPermission(principal, 'policies', 'list', 'ver_politicas')
  const canSearchWorkflows = hasScopedPermission(principal, 'workflows', 'list', 'ver_workflows')

  if (!tokens.length || !requestedTypes.length) {
    return { query: input.query.trim(), items: [], total: 0 }
  }

  const result = await withTenantTransaction(principal.tenantId, (client) =>
    client.query<SearchRow>(
      `with candidates as (
         select
           'group'::text as kind,
           bg.id::text as id,
           bg.name as title,
           concat_ws(' | ', nullif(bg.code, ''), nullif(bg.document_number, '')) as subtitle,
           nullif(bg.description, '') as detail,
           '/dashboard/grupos'::text as href,
           null::text as company_id,
           null::text as company_name,
           bg.id::text as group_id,
           bg.name as group_name,
           concat_ws(' ', bg.name, bg.code, bg.document_number, bg.description) as searchable,
           bg.updated_at as sort_at
         from business_groups bg
         where bg.tenant_id = $1
           and bg.deleted_at is null
           and bg.id = any($4::text[])
           and 'group' = any($3::text[])

         union all

         select
           'company', c.id::text, coalesce(nullif(c.trade_name, ''), c.legal_name),
           concat_ws(' | ', c.legal_name, nullif(c.document_number, ''), nullif(c.customer_code, '')),
           nullif(c.contact_name, ''),
           '/dashboard/empresas/' || c.id,
           c.id::text, coalesce(nullif(c.trade_name, ''), c.legal_name),
           c.group_id::text, bg.name,
           concat_ws(' ', c.trade_name, c.legal_name, c.document_number, c.customer_code, c.contact_name, c.contact_email),
           c.updated_at
         from companies c
         left join business_groups bg on bg.tenant_id = c.tenant_id and bg.id = c.group_id
         where c.tenant_id = $1
           and c.deleted_at is null
           and c.id = any($5::text[])
           and 'company' = any($3::text[])

         union all

         select
           'employee', e.id::text, e.full_name,
           concat_ws(' | ', e.identification_code, nullif(e.job_title, ''), nullif(e.department, '')),
           concat_ws(' | ', c.trade_name, c.legal_name, nullif(e.cost_center, '')),
           '/dashboard/funcionarios/' || e.id,
           e.company_id::text, coalesce(nullif(c.trade_name, ''), c.legal_name),
           c.group_id::text, bg.name,
           concat_ws(' ', e.full_name, e.identification_code, e.document_number, e.email, e.phone,
                     e.job_title, e.department, e.cost_center, e.registration_code, c.trade_name, c.legal_name),
           e.updated_at
         from employees e
         join companies c on c.tenant_id = e.tenant_id and c.id = e.company_id
         left join business_groups bg on bg.tenant_id = c.tenant_id and bg.id = c.group_id
         where e.tenant_id = $1
           and e.deleted_at is null
           and c.deleted_at is null
           and e.company_id = any($6::text[])
           and 'employee' = any($3::text[])

         union all

         select
           'hotel', h.id::text, h.name,
           concat_ws(' | ', nullif(h.city, ''), nullif(h.state, ''), nullif(h.country, '')),
           nullif(h.category, ''),
           '/dashboard/hoteis/' || h.id,
           null::text, null::text, null::text, null::text,
           concat_ws(' ', h.name, h.city, h.state, h.country, h.phone, h.email, h.address, h.category),
           h.updated_at
         from hotels h
         where h.tenant_id = $1
           and h.deleted_at is null
           and 'hotel' = any($3::text[])

         union all

         select
           'demand', d.id::text,
           concat_ws(' | ', d.demand_number, d.passenger_name_snapshot),
           concat_ws(' | ', d.service_type, nullif(d.destination, ''), d.status),
           coalesce(nullif(c.trade_name, ''), c.legal_name),
           '/dashboard/demandas?id=' || d.id,
           d.company_id::text, coalesce(nullif(c.trade_name, ''), c.legal_name),
           c.group_id::text, bg.name,
           concat_ws(' ', d.demand_number, d.passenger_name_snapshot, d.service_type, d.destination,
                     d.status, d.priority, d.cost_center, c.trade_name, c.legal_name),
           d.updated_at
         from demands d
         join companies c on c.tenant_id = d.tenant_id and c.id = d.company_id
         left join business_groups bg on bg.tenant_id = c.tenant_id and bg.id = c.group_id
         where d.tenant_id = $1
           and d.deleted_at is null
           and (d.travel_order_id is null or exists (
             select 1 from company_portal_travel_orders visible_order
             where visible_order.tenant_id = d.tenant_id
               and visible_order.id = d.travel_order_id
               and visible_order.status = 'submitted'
           ))
           and d.company_id = any($7::text[])
           and 'demand' = any($3::text[])

         union all

         select
           'reservation', r.id::text,
           concat_ws(' | ', coalesce(nullif(r.provider_reference, ''), r.id), r.passenger_name_snapshot),
           concat_ws(' | ', r.service_type, r.provider, r.status),
           coalesce(nullif(c.trade_name, ''), c.legal_name),
           '/dashboard/reservas?atendimento=' || coalesce(r.demand_id, ''),
           r.company_id::text, coalesce(nullif(c.trade_name, ''), c.legal_name),
           c.group_id::text, bg.name,
           concat_ws(' ', r.id, r.provider_reference, r.passenger_name_snapshot, r.service_type,
                     r.provider, r.status, c.trade_name, c.legal_name),
           r.updated_at
         from reservations r
         join companies c on c.tenant_id = r.tenant_id and c.id = r.company_id
         left join business_groups bg on bg.tenant_id = c.tenant_id and bg.id = c.group_id
         where r.tenant_id = $1
           and r.company_id = any($8::text[])
           and 'reservation' = any($3::text[])

         union all

         select
           'emission', e.id::text,
           concat_ws(' | ', coalesce(nullif(e.ticket_number, ''), e.provider_emission_id), e.provider),
           concat_ws(' | ', e.status, to_char(e.issued_at, 'DD/MM/YYYY')),
           coalesce(nullif(c.trade_name, ''), c.legal_name),
           '/dashboard/emissoes',
           e.company_id::text, coalesce(nullif(c.trade_name, ''), c.legal_name),
           c.group_id::text, bg.name,
           concat_ws(' ', e.id, e.ticket_number, e.provider_emission_id, e.provider, e.status,
                     c.trade_name, c.legal_name),
           e.updated_at
         from travel_emissions e
         join companies c on c.tenant_id = e.tenant_id and c.id = e.company_id
         left join business_groups bg on bg.tenant_id = c.tenant_id and bg.id = c.group_id
         where e.tenant_id = $1
           and e.company_id = any($9::text[])
           and 'emission' = any($3::text[])

         union all

         select
           'voucher', v.id::text,
           concat_ws(' | ', v.voucher_code, coalesce(d.passenger_name_snapshot, e.full_name)),
           concat_ws(' | ', v.status, to_char(v.issued_at, 'DD/MM/YYYY')),
           coalesce(nullif(c.trade_name, ''), c.legal_name),
           '/dashboard/vouchers/' || v.id,
           v.company_id::text, coalesce(nullif(c.trade_name, ''), c.legal_name),
           c.group_id::text, bg.name,
           concat_ws(' ', v.id, v.voucher_code, v.status, d.passenger_name_snapshot, e.full_name,
                     c.trade_name, c.legal_name),
           v.updated_at
         from vouchers v
         join companies c on c.tenant_id = v.tenant_id and c.id = v.company_id
         left join demands d on d.tenant_id = v.tenant_id and d.id = v.demand_id
         left join employees e on e.tenant_id = v.tenant_id and e.id = v.employee_id
         left join business_groups bg on bg.tenant_id = c.tenant_id and bg.id = c.group_id
         where v.tenant_id = $1
           and v.company_id = any($10::text[])
           and 'voucher' = any($3::text[])

         union all

         select
           'policy', p.id::text, p.name,
           concat_ws(' | ', p.policy_code, p.category, p.status),
           nullif(p.description, ''),
           '/dashboard/politicas',
           null::text, null::text, null::text, null::text,
           concat_ws(' ', p.name, p.policy_code, p.category, p.status, p.description, array_to_string(p.tags, ' ')),
           p.updated_at
         from policy_definitions p
         where p.tenant_id = $1
           and p.archived_at is null
           and $11::boolean
           and 'policy' = any($3::text[])

         union all

         select
           'workflow', w.id::text, w.name,
           concat_ws(' | ', w.workflow_code, w.process_type, w.status),
           nullif(w.description, ''),
           '/dashboard/workflows',
           null::text, null::text, null::text, null::text,
           concat_ws(' ', w.name, w.workflow_code, w.process_type, w.status, w.description, array_to_string(w.tags, ' ')),
           w.updated_at
         from enterprise_workflow_definitions w
         where w.tenant_id = $1
           and w.archived_at is null
           and $12::boolean
           and 'workflow' = any($3::text[])
       ),
       normalized as (
         select *,
           translate(lower(searchable), $13, $14) as normalized_search,
           translate(lower(title), $13, $14) as normalized_title
         from candidates
       )
       select
         kind, id, title, coalesce(subtitle, '') as subtitle, detail, href,
         company_id, company_name, group_id, group_name
       from normalized
       where normalized_search like all($2::text[])
       order by
         case
           when normalized_title = $15 then 0
           when normalized_title like $15 || '%' then 1
           when normalized_title like '%' || $15 || '%' then 2
           else 3
         end,
         sort_at desc,
         title asc
       limit $16`,
      [
        principal.tenantId,
        tokens,
        requestedTypes,
        groupIds,
        companyIds,
        employeeCompanyIds,
        demandCompanyIds,
        reservationCompanyIds,
        emissionCompanyIds,
        voucherCompanyIds,
        canSearchPolicies,
        canSearchWorkflows,
        SEARCH_TRANSLATE_FROM,
        SEARCH_TRANSLATE_TO,
        query,
        limit,
      ],
    ),
  )

  const items: UniversalSearchItem[] = result.rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    detail: row.detail,
    href: row.href,
    companyId: row.company_id,
    companyName: row.company_name,
    groupId: row.group_id,
    groupName: row.group_name,
  }))
  return { query: input.query.trim(), items, total: items.length }
}

function effectiveCompanyIds(
  principal: RequestPrincipal,
  resource: AuthorizationResource,
  action: AuthorizationAction,
  requiredPermission: keyof Permissoes,
): string[] {
  return Array.from(new Set(
    (principal.corporateAccess?.companies || [])
      .filter((company) => evaluateAuthorization(principal, {
        action,
        resource,
        requiredPermission,
        scope: {
          tenantId: principal.tenantId,
          groupId: company.groupId,
          companyId: company.companyId,
        },
      }).allowed)
      .map((company) => company.companyId),
  ))
}

function hasScopedPermission(
  principal: RequestPrincipal,
  resource: AuthorizationResource,
  action: AuthorizationAction,
  requiredPermission: keyof Permissoes,
): boolean {
  const companyIds = effectiveCompanyIds(principal, resource, action, requiredPermission)
  if (companyIds.length) return true
  return principal.platformAdmin && evaluateAuthorization(principal, {
    action,
    resource,
    requiredPermission,
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  }).allowed
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

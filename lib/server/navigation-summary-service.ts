import 'server-only'

import type { QueryResultRow } from 'pg'

import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface NavigationSummaryRow extends QueryResultRow {
  unread_inbox: string | number
  new_demands: string | number
  active_alerts: string | number
}

export interface NavigationSummary {
  unreadInbox: number
  newDemands: number
  activeAlerts: number
}

export async function getNavigationSummary(
  principal: RequestPrincipal,
  lastSeenDemandId: string,
): Promise<NavigationSummary> {
  const demandCompanyIds = permissionCompanyIds(principal, 'ver_demandas')
  const voucherCompanyIds = permissionCompanyIds(principal, 'ver_vouchers')
  const lastSeen = lastSeenDemandId.trim().slice(0, 160)

  if (!demandCompanyIds.length && !voucherCompanyIds.length) {
    return { unreadInbox: 0, newDemands: 0, activeAlerts: 0 }
  }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<NavigationSummaryRow>(
      `with
       visible_demands as (
         select
           demand.id,
           demand.assigned_to_user_id,
           demand.service_type,
           demand.status,
           demand.travel_start_date,
           demand.travel_end_date,
           demand.created_at
         from demands demand
         where demand.tenant_id = $1
           and demand.company_id = any($2::text[])
           and demand.deleted_at is null
           and demand.status not in ('cancelado', 'finalizado', 'cancelled', 'closed')
       ),
       open_demands as (
         select *
         from visible_demands
         where status in ('pendente', 'em_andamento', 'aguardando_cliente', 'open', 'in_progress')
       ),
       last_seen as (
         select created_at, id
         from open_demands
         where id = nullif($4, '')
         limit 1
       ),
       voucher_values as (
         select
           coalesce(
             voucher.metadata->>'data_checkin',
             voucher.metadata->>'data_ida',
             voucher.metadata->>'retirada_data'
           ) as start_raw,
           coalesce(
             voucher.metadata->>'data_checkout',
             voucher.metadata->>'data_volta',
             voucher.metadata->>'devolucao_data'
           ) as end_raw
         from vouchers voucher
         where voucher.tenant_id = $1
           and voucher.company_id = any($3::text[])
           and voucher.deleted_at is null
           and voucher.status not in ('cancelled', 'cancelado')
       ),
       voucher_dates as (
         select
           case when start_raw ~ '^\\d{4}-\\d{2}-\\d{2}$' then start_raw::date end as start_date,
           case when end_raw ~ '^\\d{4}-\\d{2}-\\d{2}$' then end_raw::date end as end_date
         from voucher_values
       )
       select
         (
           select count(*)
           from open_demands
           where assigned_to_user_id is null
         )::bigint as unread_inbox,
         (
           select case
             when $4 = '' then 0
             when exists (select 1 from last_seen) then count(*) filter (
               where (created_at, id) > (
                 select created_at, id
                 from last_seen
               )
             )
             else count(*)
           end
           from open_demands
         )::bigint as new_demands,
         (
           coalesce((
             select sum(
               (case when assigned_to_user_id is null then 1 else 0 end)
               + (case
                   when lower(service_type) in ('hotel', 'hospedagem')
                     and travel_start_date is null
                   then 1 else 0
                 end)
               + (case when travel_start_date = current_date then 1 else 0 end)
               + (case
                   when lower(service_type) in ('aereo', 'aéreo')
                     and travel_start_date = current_date + 1
                   then 1 else 0
                 end)
               + (case when travel_end_date = current_date then 1 else 0 end)
               + (case when travel_start_date < current_date then 1 else 0 end)
             )
             from visible_demands
           ), 0)
           + coalesce((
             select sum(
               (case when start_date = current_date then 1 else 0 end)
               + (case when start_date = current_date + 1 then 1 else 0 end)
               + (case when end_date = current_date then 1 else 0 end)
             )
             from voucher_dates
           ), 0)
         )::bigint as active_alerts`,
      [
        principal.tenantId,
        demandCompanyIds,
        voucherCompanyIds,
        lastSeen,
      ],
    )
    const row = result.rows[0]
    return {
      unreadInbox: nonNegativeInteger(row?.unread_inbox),
      newDemands: nonNegativeInteger(row?.new_demands),
      activeAlerts: nonNegativeInteger(row?.active_alerts),
    }
  })
}

function permissionCompanyIds(
  principal: RequestPrincipal,
  permission: 'ver_demandas' | 'ver_vouchers',
): string[] {
  return Array.from(new Set(
    (principal.corporateAccess?.companies || [])
      .filter((company) => company.permissions[permission])
      .map((company) => company.companyId),
  ))
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

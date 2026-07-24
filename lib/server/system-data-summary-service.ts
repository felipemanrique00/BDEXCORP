import 'server-only'

import type { QueryResultRow } from 'pg'

import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface TenantDataSummaryRow extends QueryResultRow {
  companies: string | number
  employees: string | number
  hotels: string | number
  demands: string | number
  financial_entries: string | number
  audit_events: string | number
  import_jobs: string | number
  integration_providers: string | number
  reservations: string | number
  travel_quotes: string | number
  vouchers: string | number
  travel_emissions: string | number
  approval_instances: string | number
  legacy_storage_keys: string | number
  legacy_storage_bytes: string | number
}

export interface TenantDataSummary {
  companies: number
  employees: number
  hotels: number
  demands: number
  financialEntries: number
  auditEvents: number
  importJobs: number
  integrationProviders: number
  reservations: number
  travelQuotes: number
  vouchers: number
  travelEmissions: number
  approvalInstances: number
  legacyStorageKeys: number
  legacyStorageBytes: number
}

export async function getTenantDataSummary(
  principal: RequestPrincipal,
): Promise<TenantDataSummary> {
  const row = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<TenantDataSummaryRow>(
      `select
         (select count(*) from companies where tenant_id = $1 and deleted_at is null) as companies,
         (select count(*) from employees where tenant_id = $1 and deleted_at is null) as employees,
         (select count(*) from hotels where tenant_id = $1 and deleted_at is null) as hotels,
         (select count(*) from demands where tenant_id = $1 and deleted_at is null) as demands,
         (select count(*) from financial_entries where tenant_id = $1 and deleted_at is null) as financial_entries,
         (select count(*) from audit_logs where tenant_id = $1) as audit_events,
         (select count(*) from import_jobs where tenant_id = $1) as import_jobs,
         (select count(*) from integration_providers where tenant_id = $1 and deleted_at is null) as integration_providers,
         (select count(*) from reservations where tenant_id = $1) as reservations,
         (select count(*) from travel_quotes where tenant_id = $1) as travel_quotes,
         (select count(*) from vouchers where tenant_id = $1 and deleted_at is null) as vouchers,
         (select count(*) from travel_emissions where tenant_id = $1) as travel_emissions,
         (select count(*) from approval_instances where tenant_id = $1) as approval_instances,
         (
           select count(*)
           from app_kv
           where tenant_id = $1 and key <> 'bbt-system-meta-v1'
         ) as legacy_storage_keys,
         (
           select coalesce(sum(pg_column_size(value)), 0)
           from app_kv
           where tenant_id = $1 and key <> 'bbt-system-meta-v1'
         ) as legacy_storage_bytes`,
      [principal.tenantId],
    )
    return result.rows[0]
  })

  return {
    companies: count(row.companies),
    employees: count(row.employees),
    hotels: count(row.hotels),
    demands: count(row.demands),
    financialEntries: count(row.financial_entries),
    auditEvents: count(row.audit_events),
    importJobs: count(row.import_jobs),
    integrationProviders: count(row.integration_providers),
    reservations: count(row.reservations),
    travelQuotes: count(row.travel_quotes),
    vouchers: count(row.vouchers),
    travelEmissions: count(row.travel_emissions),
    approvalInstances: count(row.approval_instances),
    legacyStorageKeys: count(row.legacy_storage_keys),
    legacyStorageBytes: count(row.legacy_storage_bytes),
  }
}

function count(value: string | number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

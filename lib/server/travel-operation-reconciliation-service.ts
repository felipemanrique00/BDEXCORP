import 'server-only'

import type { QueryResultRow } from 'pg'

import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface ProviderOperationRow extends QueryResultRow {
  id: string
  demand_id: string
  company_id: string
  reservation_id: string | null
  provider: string
  operation_type: string
  idempotency_key: string
  status: string
  attempt_count: number
  provider_reference: string | null
  error_code: string | null
  error_message: string | null
  lease_expires_at: string
  started_at: string
  completed_at: string | null
}

export interface TravelProviderOperationSummary {
  id: string
  demandId: string
  companyId: string
  reservationId: string | null
  provider: string
  operationType: string
  idempotencyKey: string
  status: string
  attemptCount: number
  providerReference: string | null
  errorCode: string | null
  errorMessage: string | null
  leaseExpiresAt: string
  startedAt: string
  completedAt: string | null
}

export class TravelOperationReconciliationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message)
    this.name = 'TravelOperationReconciliationError'
  }
}

export async function listTravelProviderOperations(
  principal: RequestPrincipal,
  filters: { status?: string; limit: number; offset: number },
): Promise<{ items: TravelProviderOperationSummary[]; total: number }> {
  const companyIds = integrationCompanyIds(principal)
  if (!companyIds.length) return { items: [], total: 0 }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const parameters: unknown[] = [principal.tenantId, companyIds]
    const statusClause = filters.status
      ? `and status = $${parameters.push(filters.status)}`
      : ''
    const total = await client.query<{ total: string }>(
      `select count(*)::bigint as total
       from travel_provider_operations
       where tenant_id = $1 and company_id = any($2::text[]) ${statusClause}`,
      parameters,
    )
    parameters.push(filters.limit, filters.offset)
    const rows = await client.query<ProviderOperationRow>(
      `select id, demand_id, company_id, reservation_id, provider, operation_type,
              idempotency_key, status, attempt_count, provider_reference,
              error_code, error_message, lease_expires_at, started_at, completed_at
       from travel_provider_operations
       where tenant_id = $1 and company_id = any($2::text[]) ${statusClause}
       order by started_at desc
       limit $${parameters.length - 1} offset $${parameters.length}`,
      parameters,
    )
    return {
      items: rows.rows.map(toSummary),
      total: Number(total.rows[0]?.total || 0),
    }
  })
}

export async function quarantineExpiredProviderOperations(
  principal: RequestPrincipal,
  limit: number,
): Promise<{ quarantined: TravelProviderOperationSummary[] }> {
  const companyIds = integrationCompanyIds(principal)
  if (!companyIds.length) {
    throw new TravelOperationReconciliationError(
      'INTEGRATION_SCOPE_EMPTY',
      'Nenhuma empresa autorizada para reconciliacao de integracoes.',
      403,
    )
  }

  const quarantined = await withTenantTransaction(principal.tenantId, async (client) => {
    const stale = await client.query<ProviderOperationRow>(
      `select id, demand_id, company_id, reservation_id, provider, operation_type,
              idempotency_key, status, attempt_count, provider_reference,
              error_code, error_message, lease_expires_at, started_at, completed_at
       from travel_provider_operations
       where tenant_id = $1
         and company_id = any($2::text[])
         and status = 'pending'
         and lease_expires_at <= now()
       order by lease_expires_at
       for update skip locked
       limit $3`,
      [principal.tenantId, companyIds, limit],
    )
    const results: TravelProviderOperationSummary[] = []
    for (const operation of stale.rows) {
      const updated = await client.query<ProviderOperationRow>(
        `update travel_provider_operations set
           status = 'requires_reconciliation',
           error_code = 'LEASE_EXPIRED_UNCERTAIN',
           error_message = 'A confirmacao do fornecedor nao foi concluida antes do vencimento da operacao.',
           completed_at = now()
         where tenant_id = $1 and id = $2 and status = 'pending'
         returning id, demand_id, company_id, reservation_id, provider, operation_type,
                   idempotency_key, status, attempt_count, provider_reference,
                   error_code, error_message, lease_expires_at, started_at, completed_at`,
        [principal.tenantId, operation.id],
      )
      if (!updated.rows[0]) continue
      const summary = toSummary(updated.rows[0])
      results.push(summary)
      await client.query(
        `insert into domain_outbox (
           tenant_id, aggregate_type, aggregate_id, event_type, payload,
           idempotency_key, created_by
         ) values ($1, 'travel_provider_operation', $2, 'travel.provider.reconcile',
                   $3::jsonb, $4, $5)
         on conflict (tenant_id, idempotency_key) do nothing`,
        [
          principal.tenantId,
          summary.id,
          JSON.stringify(summary),
          `${summary.id}:travel.provider.reconcile`,
          principal.user.id,
        ],
      )
    }
    return results
  })

  if (quarantined.length) {
    await writeAuditEvent({
      action: 'travel.provider_operations.quarantine_stale',
      result: 'success',
      entityType: 'travel_provider_operation',
      metadata: {
        count: quarantined.length,
        operationIds: quarantined.map((operation) => operation.id),
      },
    })
  }
  return { quarantined }
}

function integrationCompanyIds(principal: RequestPrincipal): string[] {
  return principal.corporateAccess?.companies
    .filter((company) => company.permissions.gerenciar_integracoes)
    .map((company) => company.companyId) || []
}

function toSummary(row: ProviderOperationRow): TravelProviderOperationSummary {
  return {
    id: row.id,
    demandId: row.demand_id,
    companyId: row.company_id,
    reservationId: row.reservation_id,
    provider: row.provider,
    operationType: row.operation_type,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    providerReference: row.provider_reference,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
    startedAt: new Date(row.started_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  }
}

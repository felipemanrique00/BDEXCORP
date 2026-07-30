import 'server-only'

import { randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'

import { addDaysISODate, todayISODate } from '@/lib/date'
import {
  financialDemandSyncSchema,
  financialEntryCreateSchema,
  financialEntryIdentifierSchema,
  financialEntrySchema,
  financialEntrySettlementSchema,
  financialStatusFromDatabase,
  financialStatusToDatabase,
  financialTypeFromDatabase,
  financialTypeToDatabase,
  normalizeLegacyFinancialEntry,
  recalculateFinancialStatus,
  type FinancialEntryCreatePayload,
} from '@/lib/finance/schema'
import type { LancamentoFinanceiro } from '@/lib/financeiro'
import { sha256 } from '@/lib/policy'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { hasServerPermission } from '@/lib/security/api-guard'
import {
  getAccessibleCompanyIds,
  requireCompanyAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  domainRolloutAppliesToCompany,
  domainRolloutIsFullyRelational,
  getDomainRolloutInTransaction,
} from '@/lib/server/domain-rollout-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

const FINANCE_STORAGE_KEY = 'bbt-financeiro'
const FINANCE_SYNC_SOURCE = 'financial_demand_sync'

interface FinancialEntryRow extends QueryResultRow {
  id: string
  company_id: string
  demand_id: string | null
  reservation_id: string | null
  entry_type: string
  status: string
  amount: string | number
  settled_amount: string | number
  currency: string
  issued_on: Date | string | null
  due_date: Date | string | null
  settled_at: Date | string | null
  description: string | null
  metadata: Record<string, unknown>
  fingerprint: string | null
  version: string | number
  created_by: string | null
  created_at: Date | string
  updated_at: Date | string
}

interface DemandFinanceRow extends QueryResultRow {
  id: string
  company_id: string
  demand_number: string
  service_type: string
  passenger_name_snapshot: string
  status: string
  estimated_amount: string | number
  final_amount: string | number
  metadata: Record<string, unknown>
  created_at: Date | string
}

interface LegacyFinanceBootstrap {
  unresolved: unknown[]
  migratedCount: number
}

export class FinanceServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'FinanceServiceError'
  }
}

export async function listFinancialEntries(
  principal: RequestPrincipal,
  filters: {
    companyId?: string
    type?: 'pagar' | 'receber'
    status?: LancamentoFinanceiro['status']
    dueFrom?: string
    dueTo?: string
    limit?: number
    offset?: number
  } = {},
): Promise<{ items: LancamentoFinanceiro[]; total: number }> {
  if (filters.companyId) {
    await requireCompanyAccess(principal, filters.companyId, 'ver_financeiro')
  }
  const companyIds = filters.companyId
    ? [filters.companyId]
    : financialCompanyIds(principal)
  if (!companyIds.length) return { items: [], total: 0 }

  const limit = Math.max(1, Math.min(500, Number(filters.limit || 100)))
  const offset = Math.max(0, Number(filters.offset || 0))
  return withTenantTransaction(principal.tenantId, async (client) => {
    const bootstrap = await bootstrapLegacyFinancialEntries(client, principal)
    const result = await client.query<FinancialEntryRow & { total_count: string }>(
      `select entry.*, count(*) over()::text as total_count
       from financial_entries entry
       where entry.tenant_id = $1
         and entry.company_id = any($2::text[])
         and entry.deleted_at is null
         and ($3::text is null or entry.entry_type = $3)
         and (
           $4::text is null
           or (
             $4 = 'overdue'
             and (entry.status = 'overdue' or (entry.status = 'pending' and entry.due_date < current_date))
           )
           or (
             $4 = 'pending'
             and entry.status = 'pending'
             and (entry.due_date is null or entry.due_date >= current_date)
           )
           or ($4 not in ('pending', 'overdue') and entry.status = $4)
         )
         and ($5::date is null or entry.due_date >= $5)
         and ($6::date is null or entry.due_date <= $6)
       order by entry.due_date asc nulls last, entry.created_at desc, entry.id
       limit $7 offset $8`,
      [
        principal.tenantId,
        companyIds,
        filters.type ? financialTypeToDatabase(filters.type) : null,
        filters.status ? financialStatusToDatabase(filters.status) : null,
        filters.dueFrom || null,
        filters.dueTo || null,
        limit,
        offset,
      ],
    )
    if (bootstrap.migratedCount > 0) {
      await syncFinancialCompatibilityProjection(client, principal, bootstrap.unresolved)
    }
    return {
      items: result.rows.map(mapFinancialEntryRow),
      total: Number(result.rows[0]?.total_count || 0),
    }
  })
}

export async function getFinancialOverview(
  principal: RequestPrincipal,
  filters: { companyId?: string } = {},
): Promise<{
  entries: number
  payableAmount: number
  receivableAmount: number
  settledAmount: number
  outstandingAmount: number
  overdueEntries: number
  currency: string
}> {
  if (filters.companyId) {
    await requireCompanyAccess(principal, filters.companyId, 'ver_financeiro')
  }
  const companyIds = filters.companyId
    ? [filters.companyId]
    : financialCompanyIds(principal)
  if (!companyIds.length) {
    return {
      entries: 0,
      payableAmount: 0,
      receivableAmount: 0,
      settledAmount: 0,
      outstandingAmount: 0,
      overdueEntries: 0,
      currency: 'BRL',
    }
  }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{
      entries: string | number
      payable_amount: string | number
      receivable_amount: string | number
      settled_amount: string | number
      outstanding_amount: string | number
      overdue_entries: string | number
    }>(
      `select
         count(*)::bigint as entries,
         coalesce(sum(amount) filter (where entry_type = 'payable'), 0)::numeric as payable_amount,
         coalesce(sum(amount) filter (where entry_type = 'receivable'), 0)::numeric as receivable_amount,
         coalesce(sum(settled_amount), 0)::numeric as settled_amount,
         coalesce(sum(greatest(amount - settled_amount, 0)), 0)::numeric as outstanding_amount,
         count(*) filter (
           where status = 'overdue'
              or (status = 'pending' and due_date < current_date)
         )::bigint as overdue_entries
       from financial_entries
       where tenant_id = $1
         and company_id = any($2::text[])
         and deleted_at is null`,
      [principal.tenantId, companyIds],
    )
    const row = result.rows[0]
    return {
      entries: safeCount(row.entries),
      payableAmount: moneyValue(row.payable_amount),
      receivableAmount: moneyValue(row.receivable_amount),
      settledAmount: moneyValue(row.settled_amount),
      outstandingAmount: moneyValue(row.outstanding_amount),
      overdueEntries: safeCount(row.overdue_entries),
      currency: 'BRL',
    }
  })
}

export async function createFinancialEntry(
  principal: RequestPrincipal,
  rawInput: unknown,
  rawIdempotencyKey: string,
): Promise<{ entry: LancamentoFinanceiro; reused: boolean }> {
  const input = financialEntryCreateSchema.parse(rawInput)
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey)
  await requireCompanyAccess(principal, input.empresa_id, 'editar_financeiro')
  const requestHash = sha256({ tenantId: principal.tenantId, input })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertFinanceRelationalWriteEnabled(client, principal.tenantId, input.empresa_id)
    const operation = 'finance.entry.create'
    const replay = await loadIdempotentFinancialEntry(
      client,
      principal.tenantId,
      operation,
      idempotencyKey,
      requestHash,
    )
    if (replay) return { entry: replay, reused: true }

    await startIdempotentOperation(
      client,
      principal.tenantId,
      operation,
      idempotencyKey,
      requestHash,
    )
    const bootstrap = await bootstrapLegacyFinancialEntries(client, principal)
    await assertFinancialEntryReferences(client, principal.tenantId, input)
    const complete = completeCreatedEntry(input, principal.user.id)
    const row = await insertFinancialEntry(client, principal, complete)
    const entry = mapFinancialEntryRow(row)
    await completeIdempotentOperation(
      client,
      principal.tenantId,
      operation,
      idempotencyKey,
      { entryId: entry.id },
    )
    await syncFinancialCompatibilityProjection(client, principal, bootstrap.unresolved)
    return { entry, reused: false }
  })

  await writeAuditEvent({
    action: result.reused ? 'finance.entry.create_reused' : 'finance.entry.create',
    result: 'success',
    entityType: 'financial_entry',
    entityId: result.entry.id,
    metadata: {
      companyId: result.entry.empresa_id,
      type: result.entry.tipo,
      amount: result.entry.valor,
    },
  })
  return result
}

export async function syncFinancialEntriesFromDemands(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<{
  entries: LancamentoFinanceiro[]
  inserted: number
  updated: number
  reused: boolean
  jobId: string
}> {
  const input = financialDemandSyncSchema.parse(rawInput)
  const uniqueDemandIds = Array.from(new Set(input.demandIds))
  const inputHash = sha256({
    tenantId: principal.tenantId,
    demandIds: [...uniqueDemandIds].sort(),
  })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [principal.tenantId, `${FINANCE_SYNC_SOURCE}:${input.idempotencyKey}`],
    )

    const demands = await client.query<DemandFinanceRow>(
      `select id, company_id, demand_number, service_type,
              passenger_name_snapshot, status, estimated_amount,
              final_amount, metadata, created_at
       from demands
       where tenant_id = $1 and id = any($2::text[]) and deleted_at is null
       for update`,
      [principal.tenantId, uniqueDemandIds],
    )
    const foundIds = new Set(demands.rows.map((row) => row.id))
    const missingIds = uniqueDemandIds.filter((id) => !foundIds.has(id))
    if (missingIds.length) {
      throw new FinanceServiceError(
        'FINANCE_DEMAND_NOT_FOUND',
        'Uma ou mais demandas nao foram encontradas.',
        404,
        { demandIds: missingIds },
      )
    }

    const companyIds = Array.from(new Set(demands.rows.map((row) => row.company_id)))
    for (const companyId of companyIds) {
      const syncPermission = financialSyncPermission(principal, companyId)
      await requireCompanyAccess(principal, companyId, syncPermission)
      await assertFinanceRelationalWriteEnabled(client, principal.tenantId, companyId)
    }

    const existingJob = await client.query<{
      id: string
      status: string
      summary: Record<string, unknown>
    }>(
      `select id, status, summary
       from import_jobs
       where tenant_id = $1 and source = $2 and idempotency_key = $3
       for update`,
      [principal.tenantId, FINANCE_SYNC_SOURCE, input.idempotencyKey],
    )
    if (existingJob.rows[0]) {
      const existingHash = String(existingJob.rows[0].summary?.inputHash || '')
      if (existingHash && existingHash !== inputHash) {
        throw new FinanceServiceError(
          'FINANCE_IDEMPOTENCY_CONFLICT',
          'A chave de idempotencia ja foi usada com outro conjunto de demandas.',
          409,
        )
      }
      if (existingJob.rows[0].status === 'completed') {
        const ids = Array.isArray(existingJob.rows[0].summary?.entryIds)
          ? existingJob.rows[0].summary.entryIds.map(String)
          : []
        const rows = ids.length
          ? await client.query<FinancialEntryRow>(
              `select *
               from financial_entries
               where tenant_id = $1 and id = any($2::text[]) and deleted_at is null`,
              [principal.tenantId, ids],
            )
          : { rows: [] as FinancialEntryRow[] }
        return {
          entries: rows.rows.map(mapFinancialEntryRow),
          inserted: 0,
          updated: 0,
          reused: true,
          jobId: existingJob.rows[0].id,
        }
      }
      throw new FinanceServiceError(
        'FINANCE_SYNC_IN_PROGRESS',
        'A sincronizacao financeira deste lote ainda esta em processamento.',
        409,
      )
    }

    const jobId = randomUUID()
    await client.query(
      `insert into import_jobs (
         id, tenant_id, requested_by, source, status, idempotency_key,
         total_rows, summary, started_at
       ) values ($1, $2, $3, $4, 'processing', $5, $6, $7::jsonb, now())`,
      [
        jobId,
        principal.tenantId,
        principal.user.id,
        FINANCE_SYNC_SOURCE,
        input.idempotencyKey,
        uniqueDemandIds.length,
        JSON.stringify({ inputHash }),
      ],
    )

    const bootstrap = await bootstrapLegacyFinancialEntries(client, principal)
    const generated = demands.rows.flatMap((demand) => generatedEntriesForDemand(demand, principal.user.id))
    await assertGeneratedAmountsDoNotUnderrunSettlements(
      client,
      principal.tenantId,
      generated,
    )
    const existing = await client.query<{ demand_id: string; entry_type: string }>(
      `select demand_id, entry_type
       from financial_entries
       where tenant_id = $1
         and demand_id = any($2::text[])
         and deleted_at is null`,
      [principal.tenantId, uniqueDemandIds],
    )
    const existingKeys = new Set(
      existing.rows.map((row) => `${row.demand_id}:${row.entry_type}`),
    )
    const saved = generated.length
      ? await persistGeneratedFinancialEntries(client, principal, generated)
      : []
    const inserted = generated.filter(
      (entry) => !existingKeys.has(`${entry.atendimento_id}:${financialTypeToDatabase(entry.tipo)}`),
    ).length
    const updated = Math.max(0, generated.length - inserted)
    await syncFinancialCompatibilityProjection(client, principal, bootstrap.unresolved)
    await client.query(
      `update import_jobs
       set status = 'completed',
           processed_rows = $3,
           summary = $4::jsonb,
           finished_at = now()
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        jobId,
        uniqueDemandIds.length,
        JSON.stringify({
          inputHash,
          entryIds: saved.map((entry) => entry.id),
          inserted,
          updated,
        }),
      ],
    )
    return { entries: saved, inserted, updated, reused: false, jobId }
  })

  await writeAuditEvent({
    action: result.reused ? 'finance.demand_sync_reused' : 'finance.demand_sync',
    result: 'success',
    entityType: 'import_job',
    entityId: result.jobId,
    metadata: {
      entryCount: result.entries.length,
      inserted: result.inserted,
      updated: result.updated,
    },
  })
  return result
}

export async function settleFinancialEntry(
  principal: RequestPrincipal,
  rawEntryId: string,
  rawInput: unknown,
): Promise<{ entry: LancamentoFinanceiro; reused: boolean }> {
  const entryId = financialEntryIdentifierSchema.parse(rawEntryId)
  const input = financialEntrySettlementSchema.parse(rawInput)
  const requestHash = sha256({ tenantId: principal.tenantId, entryId, input })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const operation = `finance.entry.settle:${entryId}`
    const current = await loadFinancialEntryForUpdate(
      client,
      principal.tenantId,
      entryId,
    )
    await requireCompanyAccess(principal, current.company_id, 'editar_financeiro')
    await assertFinanceRelationalWriteEnabled(client, principal.tenantId, current.company_id)

    const replay = await loadIdempotentFinancialEntry(
      client,
      principal.tenantId,
      operation,
      input.idempotencyKey,
      requestHash,
    )
    if (replay) return { entry: replay, reused: true }

    if (Number(current.version) !== input.expectedVersion) {
      throw new FinanceServiceError(
        'FINANCE_VERSION_CONFLICT',
        'O lancamento foi alterado por outra pessoa. Recarregue antes de liquidar.',
        409,
      )
    }
    if (current.status === 'cancelled') {
      throw new FinanceServiceError(
        'FINANCE_ENTRY_CANCELLED',
        'Um lancamento cancelado nao pode ser liquidado.',
        409,
      )
    }
    const remaining = Number(current.amount) - Number(current.settled_amount)
    if (input.valor > remaining + 0.009) {
      throw new FinanceServiceError(
        'FINANCE_SETTLEMENT_EXCEEDS_REMAINING',
        'O valor informado supera o saldo restante do lancamento.',
        409,
        { remaining },
      )
    }

    await startIdempotentOperation(
      client,
      principal.tenantId,
      operation,
      input.idempotencyKey,
      requestHash,
    )
    const bootstrap = await bootstrapLegacyFinancialEntries(client, principal)
    const nextSettled = roundMoney(Number(current.settled_amount) + input.valor)
    const nextStatus = nextSettled >= Number(current.amount) - 0.009 ? 'paid' : 'partial'
    const metadata = {
      ...objectValue(current.metadata),
      forma_pagamento: input.forma_pagamento,
      data_pagamento: input.data_pagamento,
      settlementHistory: [
        ...arrayValue(objectValue(current.metadata).settlementHistory),
        {
          amount: input.valor,
          paidOn: input.data_pagamento,
          method: input.forma_pagamento,
          actorUserId: principal.user.id,
          idempotencyKey: input.idempotencyKey,
          recordedAt: new Date().toISOString(),
        },
      ].slice(-500),
    }
    const updated = await client.query<FinancialEntryRow>(
      `update financial_entries
       set settled_amount = $4,
           status = $5,
           settled_at = $6::date::timestamptz,
           metadata = $7::jsonb,
           updated_by = $8,
           version = version + 1,
           updated_at = now()
       where tenant_id = $1 and company_id = $2 and id = $3
         and deleted_at is null and version = $9
       returning *`,
      [
        principal.tenantId,
        current.company_id,
        entryId,
        nextSettled,
        nextStatus,
        input.data_pagamento,
        JSON.stringify(metadata),
        principal.user.id,
        input.expectedVersion,
      ],
    )
    if (!updated.rowCount) {
      throw new FinanceServiceError(
        'FINANCE_VERSION_CONFLICT',
        'O lancamento foi alterado por outra pessoa. Recarregue antes de liquidar.',
        409,
      )
    }
    const entry = mapFinancialEntryRow(updated.rows[0])
    await completeIdempotentOperation(
      client,
      principal.tenantId,
      operation,
      input.idempotencyKey,
      { entryId: entry.id },
    )
    await syncFinancialCompatibilityProjection(client, principal, bootstrap.unresolved)
    return { entry, reused: false }
  })

  await writeAuditEvent({
    action: result.reused ? 'finance.entry.settle_reused' : 'finance.entry.settle',
    result: 'success',
    entityType: 'financial_entry',
    entityId: result.entry.id,
    metadata: {
      companyId: result.entry.empresa_id,
      settledAmount: result.entry.valor_pago,
      status: result.entry.status,
    },
  })
  return result
}

async function assertFinanceRelationalWriteEnabled(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, tenantId, 'finance')
  if (!domainRolloutAppliesToCompany(rollout, companyId) || rollout.writeMode === 'legacy') {
    throw new FinanceServiceError(
      'FINANCE_RELATIONAL_WRITE_DISABLED',
      'A gravacao relacional do financeiro ainda nao esta habilitada para esta empresa.',
      409,
    )
  }
}

async function insertFinancialEntry(
  client: PoolClient,
  principal: RequestPrincipal,
  entry: LancamentoFinanceiro,
): Promise<FinancialEntryRow> {
  const metadata = financialMetadata(entry)
  const result = await client.query<FinancialEntryRow>(
    `insert into financial_entries (
       id, tenant_id, company_id, demand_id, entry_type, status,
       amount, settled_amount, currency, issued_on, due_date,
       settled_at, description, metadata, fingerprint,
       created_by, updated_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6,
       $7, $8, 'BRL', $9::date, $10::date,
       $11::date::timestamptz, $12, $13::jsonb, $14,
       $15, $15, $16::timestamptz, $16::timestamptz
     )
     returning *`,
    [
      entry.id,
      principal.tenantId,
      entry.empresa_id,
      entry.atendimento_id || null,
      financialTypeToDatabase(entry.tipo),
      financialStatusToDatabase(entry.status),
      entry.valor,
      entry.valor_pago,
      entry.data_emissao,
      entry.data_vencimento,
      entry.data_pagamento || null,
      entry.descricao,
      JSON.stringify(metadata),
      entry.atendimento_id ? `finance:${entry.atendimento_id}:${entry.tipo}` : `finance:${entry.id}`,
      principal.user.id,
      entry.created_at,
    ],
  )
  return result.rows[0]
}

async function persistGeneratedFinancialEntries(
  client: PoolClient,
  principal: RequestPrincipal,
  entries: LancamentoFinanceiro[],
): Promise<LancamentoFinanceiro[]> {
  const payload = entries.map((entry) => ({
    id: entry.id,
    company_id: entry.empresa_id,
    demand_id: entry.atendimento_id,
    entry_type: financialTypeToDatabase(entry.tipo),
    amount: entry.valor,
    issued_on: entry.data_emissao,
    due_date: entry.data_vencimento,
    description: entry.descricao,
    metadata: financialMetadata(entry),
    fingerprint: `finance:${entry.atendimento_id}:${entry.tipo}`,
    created_at: entry.created_at,
  }))
  await client.query(
    `with input as (
       select *
       from jsonb_to_recordset($2::jsonb) as item(
         id text,
         company_id text,
         demand_id text,
         entry_type text,
         amount numeric,
         issued_on date,
         due_date date,
         description text,
         metadata jsonb,
         fingerprint text,
         created_at timestamptz
       )
     )
     insert into financial_entries (
       id, tenant_id, company_id, demand_id, entry_type, status,
       amount, settled_amount, currency, issued_on, due_date,
       description, metadata, fingerprint, created_by, updated_by,
       created_at, updated_at
     )
     select
       input.id, $1, input.company_id, input.demand_id, input.entry_type,
       case when input.due_date < current_date then 'overdue' else 'pending' end,
       input.amount, 0, 'BRL', input.issued_on, input.due_date,
       input.description, input.metadata, input.fingerprint, $3, $3,
       input.created_at, now()
     from input
     on conflict (tenant_id, demand_id, entry_type)
       where demand_id is not null and deleted_at is null
     do update set
       amount = excluded.amount,
       issued_on = excluded.issued_on,
       due_date = excluded.due_date,
       description = excluded.description,
       metadata = financial_entries.metadata || excluded.metadata,
       fingerprint = excluded.fingerprint,
       status = case
         when financial_entries.status = 'cancelled' then 'cancelled'
         when financial_entries.settled_amount >= excluded.amount - 0.01 then 'paid'
         when financial_entries.settled_amount > 0 then 'partial'
         when excluded.due_date < current_date then 'overdue'
         else 'pending'
       end,
       updated_by = excluded.updated_by,
       version = financial_entries.version + 1,
       updated_at = now()`,
    [principal.tenantId, JSON.stringify(payload), principal.user.id],
  )
  const rows = await client.query<FinancialEntryRow>(
    `select *
     from financial_entries
     where tenant_id = $1
       and demand_id = any($2::text[])
       and deleted_at is null`,
    [
      principal.tenantId,
      Array.from(new Set(entries.map((entry) => entry.atendimento_id).filter(Boolean))),
    ],
  )
  return rows.rows.map(mapFinancialEntryRow)
}

async function assertGeneratedAmountsDoNotUnderrunSettlements(
  client: PoolClient,
  tenantId: string,
  generated: LancamentoFinanceiro[],
): Promise<void> {
  if (!generated.length) return
  const demandIds = Array.from(new Set(
    generated.map((entry) => entry.atendimento_id).filter(Boolean) as string[],
  ))
  const existing = await client.query<{
    demand_id: string
    entry_type: string
    settled_amount: string | number
  }>(
    `select demand_id, entry_type, settled_amount
     from financial_entries
     where tenant_id = $1
       and demand_id = any($2::text[])
       and deleted_at is null
       and settled_amount > 0`,
    [tenantId, demandIds],
  )
  const settledByKey = new Map(
    existing.rows.map((entry) => [
      `${entry.demand_id}:${entry.entry_type}`,
      Number(entry.settled_amount),
    ]),
  )
  const invalid = generated.find((entry) => (
    (settledByKey.get(
      `${entry.atendimento_id}:${financialTypeToDatabase(entry.tipo)}`,
    ) || 0) > entry.valor + 0.009
  ))
  if (invalid) {
    throw new FinanceServiceError(
      'FINANCE_AMOUNT_BELOW_SETTLED',
      'O novo valor da demanda e menor que o total ja liquidado.',
      409,
      { demandId: invalid.atendimento_id, type: invalid.tipo },
    )
  }
}

function generatedEntriesForDemand(
  demand: DemandFinanceRow,
  actorUserId: string,
): LancamentoFinanceiro[] {
  if (!['finalizado', 'em_andamento', 'aguardando_cliente'].includes(demand.status)) {
    return []
  }
  const legacy = objectValue(objectValue(demand.metadata).legacySnapshot)
  const saleAmount = firstPositiveNumber(
    legacy.valor_venda,
    legacy.valor_final,
    demand.final_amount,
    legacy.valor_cotacao,
    demand.estimated_amount,
  )
  const costAmount = firstPositiveNumber(legacy.valor_custo)
  const issuedOn = dateOnly(legacy.data_atendimento) || dateOnly(demand.created_at) || todayISODate()
  const createdAt = toIso(demand.created_at)
  const entries: LancamentoFinanceiro[] = []

  if (saleAmount > 0) {
    entries.push({
      id: `lan_${randomUUID()}`,
      tipo: 'receber',
      atendimento_id: demand.id,
      empresa_id: demand.company_id,
      valor: saleAmount,
      valor_pago: 0,
      data_emissao: issuedOn,
      data_vencimento: addDaysISODate(todayISODate(), 30),
      descricao: `${demand.service_type} - ${demand.passenger_name_snapshot}${demand.demand_number ? ` - ${demand.demand_number}` : ''}`,
      categoria: demand.service_type,
      numero_documento: textValue(legacy.venda_numero) || demand.demand_number,
      status: 'pendente',
      created_at: createdAt,
      created_by: actorUserId,
    })
  }

  if (costAmount > 0) {
    const provider = demandProviderName(legacy)
    entries.push({
      id: `lan_${randomUUID()}`,
      tipo: 'pagar',
      atendimento_id: demand.id,
      empresa_id: demand.company_id,
      fornecedor_nome: provider,
      valor: costAmount,
      valor_pago: 0,
      data_emissao: issuedOn,
      data_vencimento: addDaysISODate(todayISODate(), 7),
      descricao: `${demand.service_type} - ${provider} - ${demand.passenger_name_snapshot}`,
      categoria: demand.service_type,
      numero_documento: textValue(legacy.venda_numero) || demand.demand_number,
      status: 'pendente',
      created_at: createdAt,
      created_by: actorUserId,
    })
  }
  return entries
}

function completeCreatedEntry(
  input: FinancialEntryCreatePayload,
  actorUserId: string,
): LancamentoFinanceiro {
  const now = new Date().toISOString()
  const initial = {
    ...input,
    id: `lan_${randomUUID()}`,
    valor_pago: 0,
    status: 'pendente' as const,
    created_at: now,
    created_by: actorUserId,
  }
  return financialEntrySchema.parse({
    ...initial,
    status: recalculateFinancialStatus(initial, todayISODate()),
    version: 1,
  }) as LancamentoFinanceiro
}

async function assertFinancialEntryReferences(
  client: PoolClient,
  tenantId: string,
  entry: Pick<FinancialEntryCreatePayload, 'empresa_id' | 'atendimento_id'>,
): Promise<void> {
  const company = await client.query(
    `select 1
     from companies
     where tenant_id = $1 and id = $2 and status = 'active' and deleted_at is null`,
    [tenantId, entry.empresa_id],
  )
  if (!company.rowCount) {
    throw new FinanceServiceError(
      'FINANCE_COMPANY_NOT_FOUND',
      'Empresa nao encontrada ou inativa.',
      404,
    )
  }
  if (!entry.atendimento_id) return
  const demand = await client.query(
    `select 1
     from demands
     where tenant_id = $1 and company_id = $2 and id = $3 and deleted_at is null`,
    [tenantId, entry.empresa_id, entry.atendimento_id],
  )
  if (!demand.rowCount) {
    throw new FinanceServiceError(
      'FINANCE_DEMAND_SCOPE_INVALID',
      'A demanda informada nao pertence a empresa.',
      409,
    )
  }
}

async function bootstrapLegacyFinancialEntries(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<LegacyFinanceBootstrap> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'finance')
  if (domainRolloutIsFullyRelational(rollout)) {
    return { unresolved: [], migratedCount: 0 }
  }
  await client.query(
    'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [principal.tenantId, FINANCE_STORAGE_KEY],
  )
  const storage = await client.query<{ value: unknown }>(
    `select value
     from app_kv
     where tenant_id = $1 and key = $2
     for update`,
    [principal.tenantId, FINANCE_STORAGE_KEY],
  )
  const legacyItems = Array.isArray(storage.rows[0]?.value)
    ? storage.rows[0].value as unknown[]
    : []
  if (!legacyItems.length) return { unresolved: [], migratedCount: 0 }

  const companies = await client.query<{ id: string }>(
    'select id from companies where tenant_id = $1 and deleted_at is null',
    [principal.tenantId],
  )
  const companyIds = new Set(companies.rows.map((row) => row.id))
  const demands = await client.query<{ id: string; company_id: string }>(
    'select id, company_id from demands where tenant_id = $1 and deleted_at is null',
    [principal.tenantId],
  )
  const demandCompanies = new Map(demands.rows.map((row) => [row.id, row.company_id]))
  const existing = await client.query<{
    id: string
    demand_id: string | null
    entry_type: string
    fingerprint: string | null
  }>(
    `select id, demand_id, entry_type, fingerprint
     from financial_entries
     where tenant_id = $1`,
    [principal.tenantId],
  )
  const existingIds = new Set(existing.rows.map((row) => row.id))
  const existingDemandTypes = new Set(
    existing.rows
      .filter((row) => row.demand_id)
      .map((row) => `${row.demand_id}:${row.entry_type}`),
  )
  const existingFingerprints = new Set(
    existing.rows.map((row) => row.fingerprint).filter(Boolean),
  )
  const pending: Array<Record<string, unknown>> = []
  const unresolved: unknown[] = []

  for (const value of legacyItems) {
    const entry = normalizeLegacyFinancialEntry(value)
    if (!entry?.empresa_id || !companyIds.has(entry.empresa_id)) {
      unresolved.push(value)
      continue
    }
    if (
      entry.atendimento_id
      && demandCompanies.get(entry.atendimento_id) !== entry.empresa_id
    ) {
      unresolved.push(value)
      continue
    }
    if (existingIds.has(entry.id)) continue
    const entryType = financialTypeToDatabase(entry.tipo)
    const fingerprint = entry.atendimento_id
      ? `finance:${entry.atendimento_id}:${entry.tipo}`
      : `finance:${entry.id}`
    const demandTypeKey = entry.atendimento_id
      ? `${entry.atendimento_id}:${entryType}`
      : null
    if (
      (demandTypeKey && existingDemandTypes.has(demandTypeKey))
      || existingFingerprints.has(fingerprint)
    ) {
      unresolved.push(value)
      continue
    }
    pending.push({
      id: entry.id,
      company_id: entry.empresa_id,
      demand_id: entry.atendimento_id || null,
      entry_type: entryType,
      status: financialStatusToDatabase(
        recalculateFinancialStatus(entry, todayISODate()),
      ),
      amount: entry.valor,
      settled_amount: entry.valor_pago,
      issued_on: entry.data_emissao,
      due_date: entry.data_vencimento,
      settled_at: entry.data_pagamento || null,
      description: entry.descricao,
      metadata: financialMetadata(entry),
      fingerprint,
      created_at: entry.created_at,
      updated_at: entry.updated_at || entry.created_at,
    })
    existingIds.add(entry.id)
    if (demandTypeKey) existingDemandTypes.add(demandTypeKey)
    existingFingerprints.add(fingerprint)
  }

  if (pending.length) {
    await client.query(
      `with input as (
         select *
         from jsonb_to_recordset($2::jsonb) as item(
           id text,
           company_id text,
           demand_id text,
           entry_type text,
           status text,
           amount numeric,
           settled_amount numeric,
           issued_on date,
           due_date date,
           settled_at date,
           description text,
           metadata jsonb,
           fingerprint text,
           created_at timestamptz,
           updated_at timestamptz
         )
       )
       insert into financial_entries (
         id, tenant_id, company_id, demand_id, entry_type, status,
         amount, settled_amount, currency, issued_on, due_date,
         settled_at, description, metadata, fingerprint,
         created_by, updated_by, created_at, updated_at
       )
       select
         input.id, $1, input.company_id, input.demand_id, input.entry_type,
         input.status, input.amount, input.settled_amount, 'BRL',
         input.issued_on, input.due_date, input.settled_at::timestamptz,
         input.description, input.metadata, input.fingerprint,
         $3, $3, input.created_at, input.updated_at
       from input
       on conflict do nothing`,
      [principal.tenantId, JSON.stringify(pending), principal.user.id],
    )
  }
  return { unresolved, migratedCount: pending.length }
}

async function syncFinancialCompatibilityProjection(
  client: PoolClient,
  principal: RequestPrincipal,
  unresolved: unknown[],
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'finance')
  if (domainRolloutIsFullyRelational(rollout)) return
  const rows = await client.query<FinancialEntryRow>(
    `select *
     from financial_entries
     where tenant_id = $1 and deleted_at is null
     order by created_at desc`,
    [principal.tenantId],
  )
  const relational = rows.rows.map(mapFinancialEntryRow)
  const ids = new Set(relational.map((entry) => entry.id))
  const preserved = unresolved.filter((value) => {
    const entry = normalizeLegacyFinancialEntry(value)
    return !entry || !ids.has(entry.id)
  })
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, $2, $3::jsonb, $4)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [
      principal.tenantId,
      FINANCE_STORAGE_KEY,
      JSON.stringify([...relational, ...preserved]),
      principal.user.id,
    ],
  )
}

async function loadFinancialEntryForUpdate(
  client: PoolClient,
  tenantId: string,
  entryId: string,
): Promise<FinancialEntryRow> {
  const result = await client.query<FinancialEntryRow>(
    `select *
     from financial_entries
     where tenant_id = $1 and id = $2 and deleted_at is null
     for update`,
    [tenantId, entryId],
  )
  if (!result.rowCount) {
    throw new FinanceServiceError(
      'FINANCE_ENTRY_NOT_FOUND',
      'Lancamento financeiro nao encontrado.',
      404,
    )
  }
  return result.rows[0]
}

async function loadIdempotentFinancialEntry(
  client: PoolClient,
  tenantId: string,
  operation: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<LancamentoFinanceiro | null> {
  await client.query(
    'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [tenantId, `${operation}:${idempotencyKey}`],
  )
  const result = await client.query<{
    request_hash: string
    status: string
    response_body: Record<string, unknown> | null
  }>(
    `select request_hash, status, response_body
     from idempotency_keys
     where tenant_id = $1 and operation = $2 and idempotency_key = $3
     for update`,
    [tenantId, operation, idempotencyKey],
  )
  const existing = result.rows[0]
  if (!existing) return null
  if (existing.request_hash !== requestHash) {
    throw new FinanceServiceError(
      'FINANCE_IDEMPOTENCY_CONFLICT',
      'A chave de idempotencia ja foi usada com outro conteudo.',
      409,
    )
  }
  if (existing.status !== 'completed') {
    throw new FinanceServiceError(
      'FINANCE_OPERATION_IN_PROGRESS',
      'A operacao financeira ainda esta em processamento.',
      409,
    )
  }
  const entryId = textValue(existing.response_body?.entryId)
  if (!entryId) {
    throw new FinanceServiceError(
      'FINANCE_IDEMPOTENCY_RESULT_INVALID',
      'O resultado idempotente da operacao esta incompleto.',
      500,
    )
  }
  return mapFinancialEntryRow(
    await loadFinancialEntryForUpdate(client, tenantId, entryId),
  )
}

async function startIdempotentOperation(
  client: PoolClient,
  tenantId: string,
  operation: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<void> {
  await client.query(
    `insert into idempotency_keys (
       tenant_id, operation, idempotency_key, request_hash, status,
       locked_until, expires_at
     ) values (
       $1, $2, $3, $4, 'processing', now() + interval '5 minutes', now() + interval '30 days'
     )`,
    [tenantId, operation, idempotencyKey, requestHash],
  )
}

async function completeIdempotentOperation(
  client: PoolClient,
  tenantId: string,
  operation: string,
  idempotencyKey: string,
  response: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `update idempotency_keys
     set status = 'completed',
         response_status = 200,
         response_body = $4::jsonb,
         locked_until = null
     where tenant_id = $1 and operation = $2 and idempotency_key = $3`,
    [tenantId, operation, idempotencyKey, JSON.stringify(response)],
  )
}

function mapFinancialEntryRow(row: FinancialEntryRow): LancamentoFinanceiro {
  const metadata = objectValue(row.metadata)
  const status = recalculateFinancialStatus({
    status: financialStatusFromDatabase(row.status),
    valor: Number(row.amount),
    valor_pago: Number(row.settled_amount),
    data_vencimento: dateOnly(row.due_date) || todayISODate(),
  }, todayISODate())
  return financialEntrySchema.parse({
    id: row.id,
    tipo: financialTypeFromDatabase(row.entry_type),
    atendimento_id: row.demand_id || undefined,
    empresa_id: row.company_id,
    fornecedor_nome: metadata.fornecedor_nome,
    valor: Number(row.amount),
    valor_pago: Number(row.settled_amount),
    data_emissao: dateOnly(row.issued_on) || dateOnly(row.created_at) || todayISODate(),
    data_vencimento: dateOnly(row.due_date) || todayISODate(),
    data_pagamento: dateOnly(metadata.data_pagamento) || dateOnly(row.settled_at) || undefined,
    descricao: row.description || textValue(metadata.descricao) || 'Lancamento financeiro',
    categoria: metadata.categoria,
    forma_pagamento: paymentMethod(metadata.forma_pagamento),
    status,
    observacoes: metadata.observacoes,
    numero_documento: metadata.numero_documento,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    created_by: row.created_by || undefined,
    version: Number(row.version),
  }) as LancamentoFinanceiro
}

function financialMetadata(entry: LancamentoFinanceiro): Record<string, unknown> {
  return {
    fornecedor_nome: entry.fornecedor_nome || null,
    categoria: entry.categoria || null,
    forma_pagamento: entry.forma_pagamento || null,
    observacoes: entry.observacoes || null,
    numero_documento: entry.numero_documento || null,
    data_pagamento: entry.data_pagamento || null,
    legacySnapshot: entry,
  }
}

function financialCompanyIds(principal: RequestPrincipal): string[] {
  const permissionScoped = principal.corporateAccess?.companies
    .filter((company) => company.permissions.ver_financeiro)
    .map((company) => company.companyId)
  return permissionScoped || getAccessibleCompanyIds(principal)
}

function safeCount(value: unknown): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function moneyValue(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

function financialSyncPermission(
  principal: RequestPrincipal,
  companyId: string,
): 'editar_financeiro' | 'operar_reservas' | 'importar_planilhas' {
  const companyAccess = principal.corporateAccess?.companies.find(
    (company) => company.companyId === companyId,
  )
  const candidates = [
    'editar_financeiro',
    'operar_reservas',
    'importar_planilhas',
  ] as const
  const permission = candidates.find((candidate) =>
    hasServerPermission(principal.user, candidate)
    && companyAccess?.permissions[candidate] === true
  )
  if (permission) return permission
  throw new FinanceServiceError(
    'FINANCE_SYNC_FORBIDDEN',
    'Permissao insuficiente para sincronizar lancamentos financeiros.',
    403,
  )
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = String(value || '').trim()
  if (normalized.length < 8 || normalized.length > 200) {
    throw new FinanceServiceError(
      'FINANCE_IDEMPOTENCY_KEY_INVALID',
      'A chave de idempotencia deve ter entre 8 e 200 caracteres.',
      400,
    )
  }
  return normalized
}

function demandProviderName(legacy: Record<string, unknown>): string {
  const hotel = objectValue(legacy.detalhes_hotel)
  const air = objectValue(legacy.detalhes_aereo)
  const car = objectValue(legacy.detalhes_carro)
  const bundle = objectValue(legacy.detalhes_pacote)
  return textValue(hotel.hotel_nome)
    || textValue(air.cia_aerea)
    || textValue(car.locadora)
    || textValue(bundle.descricao)
    || 'Fornecedor'
}

function firstPositiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return roundMoney(parsed)
  }
  return 0
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function paymentMethod(value: unknown): LancamentoFinanceiro['forma_pagamento'] {
  const normalized = String(value || '')
  return [
    'PIX',
    'Boleto',
    'TED',
    'Cartão',
    'Dinheiro',
    'Faturamento',
    'Outro',
  ].includes(normalized)
    ? normalized as LancamentoFinanceiro['forma_pagamento']
    : undefined
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const iso = normalized.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  const brazilian = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : null
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

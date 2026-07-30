import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'
import { z } from 'zod'

import { sha256 } from '@/lib/policy'
import { mergeStorageValues } from '@/lib/storage-merge'
import { parseLegacyDemands } from '@/lib/travel/legacy-demand'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  domainRolloutAppliesToCompany,
  getDomainRolloutInTransaction,
} from '@/lib/server/domain-rollout-service'
import { DemandServiceError } from '@/lib/server/demand-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  syncTravelDemandsFromStorage,
  type TravelDemandSyncResult,
} from '@/lib/server/travel-demand-sync'
import {
  aggregateWintourImportHistory,
  type WintourImportHistoryRow,
  type WintourImportRun,
} from '@/lib/wintour-import-history'

const importMetadataSchema = z.object({
  batchKey: z.string().trim().min(8).max(200),
  chunkIndex: z.number().int().min(1).max(10_000),
  chunkCount: z.number().int().min(1).max(10_000),
  fileName: z.string().trim().min(1).max(255).optional(),
  sourceFormat: z.enum(['xml', 'xlsx', 'csv', 'pdf']).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  totalRecords: z.number().int().min(0).max(5_000_000).optional(),
  totalValue: z.number().finite().optional(),
  totalCost: z.number().finite().optional(),
  totalMarkup: z.number().finite().optional(),
}).strict().superRefine((value, context) => {
  if (value.chunkIndex > value.chunkCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chunkIndex'],
      message: 'Indice do lote maior que a quantidade de lotes.',
    })
  }
  if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['periodEnd'],
      message: 'Periodo final anterior ao inicial.',
    })
  }
})

const demandImportSchema = z.object({
  source: z.enum(['wintour', 'tech_travel', 'emissions', 'company_import', 'voucher', 'generic']),
  idempotencyKey: z.string().trim().min(8).max(200),
  demands: z.array(z.record(z.unknown())).min(1).max(500),
  confirmed: z.literal(true),
  metadata: importMetadataSchema.optional(),
}).strict()

interface ImportJobRow extends QueryResultRow {
  id: string
  status: string
  summary: Record<string, unknown>
}

interface ImportedDemandRow extends QueryResultRow {
  id: string
  company_id: string
  employee_id: string | null
  demand_number: string
  status: string
  lifecycle_status: string
  lifecycle_version: string | number
  version: string | number
  metadata: Record<string, unknown>
  updated_at: string | Date
}

interface DemandImportSnapshotRow extends QueryResultRow {
  id: string
  version: string | number
  data: Record<string, unknown>
}

interface ImportHistoryRow extends QueryResultRow, WintourImportHistoryRow {}

interface ImportRollbackJobRow extends QueryResultRow {
  id: string
  source: string
  status: string
}

interface ImportRollbackSnapshotRow extends QueryResultRow {
  id: string
  entity_id: string
  operation: 'insert' | 'update'
  before_version: string | number | null
  after_version: string | number
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown>
  rolled_back_at: string | Date | null
}

export interface DemandImportBatchResult {
  jobId: string
  source: string
  replayed: boolean
  sourceCount: number
  synchronized: number
  inserted: number
  updated: number
  skipped: number
  failures: TravelDemandSyncResult['failures']
  demands: Array<Record<string, unknown>>
}

export async function importDemandBatch(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<DemandImportBatchResult> {
  const input = demandImportSchema.parse(rawInput)
  const parsed = parseLegacyDemands(input.demands)
  if (!parsed.demands.length) {
    throw new DemandServiceError(
      'DEMAND_IMPORT_EMPTY',
      'O lote nao possui nenhuma demanda valida.',
      422,
      { failures: parsed.failures },
    )
  }
  const companyIds = Array.from(new Set(parsed.demands.map((demand) => demand.companyId)))
  for (const companyId of companyIds) {
    await requireCompanyAccess(principal, companyId, 'criar_demandas')
  }
  const inputHash = sha256({
    tenantId: principal.tenantId,
    source: input.source,
    demands: input.demands,
  })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    for (const companyId of companyIds) {
      const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'demands')
      if (!domainRolloutAppliesToCompany(rollout, companyId) || rollout.writeMode === 'legacy') {
        throw new DemandServiceError(
          'DEMAND_RELATIONAL_WRITE_DISABLED',
          'Uma das empresas do lote permanece no modo legado de demandas.',
          409,
          { companyId, writeMode: rollout.writeMode, rolloutStatus: rollout.status },
        )
      }
    }

    const existing = await client.query<ImportJobRow>(
      `select id, status, summary
       from import_jobs
       where tenant_id = $1 and source = $2 and idempotency_key = $3
       for update`,
      [principal.tenantId, input.source, input.idempotencyKey],
    )
    if (existing.rows[0]) {
      const summary = recordValue(existing.rows[0].summary)
      if (summary.inputHash !== inputHash) {
        throw new DemandServiceError(
          'DEMAND_IMPORT_IDEMPOTENCY_CONFLICT',
          'A chave do lote ja foi usada com outro conteudo.',
          409,
        )
      }
      if (existing.rows[0].status === 'completed') {
        return replayImportBatch(
          client,
          principal.tenantId,
          existing.rows[0],
          input.source,
        )
      }
      throw new DemandServiceError(
        'DEMAND_IMPORT_IN_PROGRESS',
        'Este lote ja esta em processamento ou precisa de reconciliacao.',
        409,
        { jobId: existing.rows[0].id, status: existing.rows[0].status },
      )
    }

    const job = await client.query<{ id: string }>(
      `insert into import_jobs (
         tenant_id, requested_by, source, status, idempotency_key,
         total_rows, started_at, summary
       ) values ($1, $2, $3, 'processing', $4, $5, now(), $6::jsonb)
       returning id`,
      [
        principal.tenantId,
        principal.user.id,
        input.source,
        input.idempotencyKey,
        input.demands.length,
        JSON.stringify({ inputHash, companyIds, metadata: input.metadata || null }),
      ],
    )
    const jobId = job.rows[0].id
    const demandIds = parsed.demands.map((demand) => demand.id)
    const beforeRows = await loadDemandRowsForSnapshot(client, principal.tenantId, demandIds)
    const synchronized = await syncTravelDemandsFromStorage(
      client,
      principal.tenantId,
      input.demands,
      principal.user.id,
    )
    const afterRows = await loadDemandRowsForSnapshot(client, principal.tenantId, demandIds)
    await persistImportSnapshots(
      client,
      principal.tenantId,
      jobId,
      beforeRows,
      afterRows,
    )
    const demands = await loadImportedDemandProjections(client, principal.tenantId, demandIds)
    await persistImportedDemandCompatibility(client, principal, demands)
    await registerImportedOperationUsage(client, principal, synchronized.inserted)

    for (const demand of demands) {
      const demandId = String(demand.id)
      await client.query(
        `insert into demand_events (
           tenant_id, demand_id, actor_user_id, event_type, data,
           idempotency_key, input_hash
         ) values ($1, $2, $3, 'demand_imported', $4::jsonb, $5, $6)
         on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing`,
        [
          principal.tenantId,
          demandId,
          principal.user.id,
          JSON.stringify({ source: input.source, jobId }),
          `demand:import:${sha256({
            tenantId: principal.tenantId,
            source: input.source,
            idempotencyKey: input.idempotencyKey,
            demandId,
          }).slice(0, 48)}`,
          sha256({ inputHash, demandId }),
        ],
      )
    }

    const summary = {
      inputHash,
      companyIds,
      demandIds: demands.map((demand) => demand.id),
      sourceCount: synchronized.sourceCount,
      synchronized: synchronized.synchronized,
      inserted: synchronized.inserted,
      updated: synchronized.updated,
      skipped: synchronized.skipped,
      failures: synchronized.failures,
      metadata: input.metadata || null,
    }
    await client.query(
      `update import_jobs set
         status = 'completed',
         processed_rows = $3,
         failed_rows = $4,
         summary = $5::jsonb,
         finished_at = now()
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        jobId,
        synchronized.synchronized,
        synchronized.skipped,
        JSON.stringify(summary),
      ],
    )
    return {
      jobId,
      source: input.source,
      replayed: false,
      ...synchronized,
      demands,
    }
  })

  await writeAuditEvent({
    action: 'travel.demand.batch_import',
    result: 'success',
    entityType: 'import_job',
    entityId: result.jobId,
    metadata: {
      source: result.source,
      sourceCount: result.sourceCount,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      replayed: result.replayed,
    },
  })
  return result
}

export async function listDemandImportHistory(
  principal: RequestPrincipal,
  input: { source: string; limit: number },
): Promise<WintourImportRun[]> {
  const companyIds = principal.corporateAccess
    ? principal.corporateAccess.companies
      .filter((company) => company.permissions.importar_planilhas)
      .map((company) => company.companyId)
    : (principal.user.permissoes?.importar_planilhas ? principal.user.empresa_ids || [] : [])
  if (!companyIds.length) return []

  const rows = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<ImportHistoryRow>(
      `select job.id, job.requested_by, users.name as requested_by_name,
              job.source, job.status, job.total_rows, job.processed_rows,
              job.failed_rows, job.summary, job.created_at, job.finished_at
       from import_jobs job
       left join users on users.id = job.requested_by
       where job.tenant_id = $1
         and job.source = $2
         and jsonb_typeof(job.summary->'companyIds') = 'array'
         and not exists (
           select 1
           from jsonb_array_elements_text(job.summary->'companyIds') company_id
           where not (company_id = any($3::text[]))
         )
       order by job.created_at desc, job.id desc
       limit $4`,
      [principal.tenantId, input.source, companyIds, input.limit],
    )
    return result.rows
  })

  return aggregateWintourImportHistory(rows)
}

export async function rollbackDemandImportBatch(
  principal: RequestPrincipal,
  rawJobId: string,
  rawReason: unknown,
): Promise<{
  jobId: string
  source: string
  replayed: boolean
  restored: number
  removed: number
  removedDemandIds: string[]
  demands: Array<Record<string, unknown>>
}> {
  const jobId = z.string().uuid().parse(rawJobId)
  const reason = z.string().trim().min(5).max(2_000).parse(rawReason)
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const jobResult = await client.query<ImportRollbackJobRow>(
      `select id, source, status
       from import_jobs
       where tenant_id = $1 and id = $2
       for update`,
      [principal.tenantId, jobId],
    )
    const job = jobResult.rows[0]
    if (!job) throw new DemandServiceError('DEMAND_IMPORT_JOB_NOT_FOUND', 'Lote de importacao nao encontrado.', 404)
    if (job.status === 'cancelled') {
      return {
        jobId,
        source: job.source,
        replayed: true,
        restored: 0,
        removed: 0,
        removedDemandIds: [] as string[],
        demands: [] as Array<Record<string, unknown>>,
      }
    }
    if (job.status !== 'completed') {
      throw new DemandServiceError(
        'DEMAND_IMPORT_ROLLBACK_INVALID_STATUS',
        'Somente um lote concluido pode ser revertido.',
        409,
        { status: job.status },
      )
    }
    const snapshotsResult = await client.query<ImportRollbackSnapshotRow>(
      `select id, entity_id, operation, before_version, after_version,
              before_data, after_data, rolled_back_at
       from import_job_entity_snapshots
       where tenant_id = $1 and import_job_id = $2 and entity_type = 'demand'
       order by created_at desc, id
       for update`,
      [principal.tenantId, jobId],
    )
    if (!snapshotsResult.rows.length) {
      throw new DemandServiceError(
        'DEMAND_IMPORT_ROLLBACK_SNAPSHOT_MISSING',
        'O lote nao possui snapshots seguros para reversao.',
        409,
      )
    }
    const companyIds = Array.from(new Set(snapshotsResult.rows.map((snapshot) => (
      String(recordValue(snapshot.after_data).company_id || '')
    )).filter(Boolean)))
    for (const companyId of companyIds) {
      await requireCompanyAccess(principal, companyId, 'criar_demandas')
    }

    let restored = 0
    let removed = 0
    const removedDemandIds: string[] = []
    for (const snapshot of snapshotsResult.rows) {
      const current = await client.query<{
        id: string
        version: string | number
        active_approval_instance_id: string | null
      }>(
        `select id, version, active_approval_instance_id
         from demands
         where tenant_id = $1 and id = $2 and deleted_at is null
         for update`,
        [principal.tenantId, snapshot.entity_id],
      )
      const demand = current.rows[0]
      if (!demand || Number(demand.version) !== Number(snapshot.after_version)) {
        throw new DemandServiceError(
          'DEMAND_IMPORT_ROLLBACK_CONFLICT',
          'Uma demanda do lote foi alterada depois da importacao. A reversao foi cancelada integralmente.',
          409,
          {
            demandId: snapshot.entity_id,
            expectedVersion: Number(snapshot.after_version),
            currentVersion: demand ? Number(demand.version) : null,
          },
        )
      }
      if (demand.active_approval_instance_id) {
        throw new DemandServiceError(
          'DEMAND_IMPORT_ROLLBACK_APPROVAL_ACTIVE',
          'Uma demanda do lote possui aprovacao ativa e nao pode ser revertida.',
          409,
          { demandId: snapshot.entity_id },
        )
      }

      if (snapshot.operation === 'insert') {
        await cancelUnsettledFinancialEntriesForDemand(
          client,
          principal.tenantId,
          snapshot.entity_id,
          principal.user.id,
          jobId,
        )
        await assertImportedDemandHasNoDependencies(client, principal.tenantId, snapshot.entity_id)
        await client.query(
          `update demands set
             status = 'cancelado',
             lifecycle_status = 'canceled',
             lifecycle_version = lifecycle_version + 1,
             last_transition_at = now(),
             version = version + 1,
             updated_by = $3,
             updated_at = now(),
             deleted_at = now()
           where tenant_id = $1 and id = $2`,
          [principal.tenantId, snapshot.entity_id, principal.user.id],
        )
        removed += 1
        removedDemandIds.push(snapshot.entity_id)
      } else {
        if (!snapshot.before_data) {
          throw new DemandServiceError(
            'DEMAND_IMPORT_ROLLBACK_SNAPSHOT_INVALID',
            'Snapshot anterior ausente para uma demanda atualizada.',
            409,
            { demandId: snapshot.entity_id },
          )
        }
        await client.query(
          `with previous as (
             select (jsonb_populate_record(null::demands, $4::jsonb)).*
           )
           update demands current set
             company_id = previous.company_id,
             requester_id = previous.requester_id,
             employee_id = previous.employee_id,
             employee_match_status = previous.employee_match_status,
             employee_match_confidence = previous.employee_match_confidence,
             assigned_to_user_id = previous.assigned_to_user_id,
             demand_number = previous.demand_number,
             service_type = previous.service_type,
             passenger_name_snapshot = previous.passenger_name_snapshot,
             status = previous.status,
             lifecycle_status = previous.lifecycle_status,
             lifecycle_version = current.lifecycle_version + 1,
             last_transition_at = now(),
             last_policy_evaluation_id = previous.last_policy_evaluation_id,
             active_approval_instance_id = previous.active_approval_instance_id,
             priority = previous.priority,
             travel_start_date = previous.travel_start_date,
             travel_end_date = previous.travel_end_date,
             destination = previous.destination,
             cost_center = previous.cost_center,
             estimated_amount = previous.estimated_amount,
             final_amount = previous.final_amount,
             observations = previous.observations,
             internal_notes = previous.internal_notes,
             sla_due_at = previous.sla_due_at,
             metadata = previous.metadata,
             submitted_at = previous.submitted_at,
             version = current.version + 1,
             updated_by = $3,
             updated_at = now(),
             deleted_at = previous.deleted_at
           from previous
           where current.tenant_id = $1 and current.id = $2`,
          [
            principal.tenantId,
            snapshot.entity_id,
            principal.user.id,
            JSON.stringify(snapshot.before_data),
          ],
        )
        restored += 1
      }
      await client.query(
        `insert into demand_events (
           tenant_id, demand_id, actor_user_id, event_type, data
         ) values ($1, $2, $3, 'demand_import_rolled_back', $4::jsonb)`,
        [
          principal.tenantId,
          snapshot.entity_id,
          principal.user.id,
          JSON.stringify({ jobId, reason, operation: snapshot.operation }),
        ],
      )
    }

    const affectedIds = snapshotsResult.rows.map((snapshot) => snapshot.entity_id)
    const demands = await loadImportedDemandProjections(client, principal.tenantId, affectedIds)
    await replaceImportedDemandCompatibility(
      client,
      principal,
      affectedIds,
      demands,
    )
    await client.query(
      `update import_job_entity_snapshots
       set rolled_back_at = now(), rolled_back_by = $3
       where tenant_id = $1 and import_job_id = $2 and rolled_back_at is null`,
      [principal.tenantId, jobId, principal.user.id],
    )
    await client.query(
      `update import_jobs
       set status = 'cancelled',
           summary = summary || $3::jsonb,
           finished_at = now()
       where tenant_id = $1 and id = $2`,
      [
        principal.tenantId,
        jobId,
        JSON.stringify({
          rollback: {
            reason,
            restored,
            removed,
            rolledBackBy: principal.user.id,
            rolledBackAt: new Date().toISOString(),
          },
        }),
      ],
    )
    return {
      jobId,
      source: job.source,
      replayed: false,
      restored,
      removed,
      removedDemandIds,
      demands,
    }
  })

  await writeAuditEvent({
    action: 'travel.demand.batch_import.rollback',
    result: 'success',
    entityType: 'import_job',
    entityId: result.jobId,
    metadata: {
      source: result.source,
      reason,
      restored: result.restored,
      removed: result.removed,
      removedDemandIds: result.removedDemandIds,
      replayed: result.replayed,
    },
  })
  return result
}

async function loadDemandRowsForSnapshot(
  client: PoolClient,
  tenantId: string,
  demandIds: string[],
): Promise<Map<string, DemandImportSnapshotRow>> {
  if (!demandIds.length) return new Map()
  const result = await client.query<DemandImportSnapshotRow>(
    `select id, version, to_jsonb(demands.*) as data
     from demands
     where tenant_id = $1 and id = any($2::text[])`,
    [tenantId, demandIds],
  )
  return new Map(result.rows.map((row) => [row.id, row]))
}

async function persistImportSnapshots(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  beforeRows: Map<string, DemandImportSnapshotRow>,
  afterRows: Map<string, DemandImportSnapshotRow>,
): Promise<void> {
  for (const [demandId, after] of afterRows) {
    const before = beforeRows.get(demandId) || null
    if (before && Number(before.version) === Number(after.version)) continue
    await client.query(
      `insert into import_job_entity_snapshots (
         tenant_id, import_job_id, entity_type, entity_id, operation,
         before_version, after_version, before_data, after_data
       ) values ($1, $2, 'demand', $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        tenantId,
        jobId,
        demandId,
        before ? 'update' : 'insert',
        before ? Number(before.version) : null,
        Number(after.version),
        before ? JSON.stringify(before.data) : null,
        JSON.stringify(after.data),
      ],
    )
  }
}

async function replayImportBatch(
  client: PoolClient,
  tenantId: string,
  job: ImportJobRow,
  source: string,
): Promise<DemandImportBatchResult> {
  const summary = recordValue(job.summary)
  const demandIds = stringArray(summary.demandIds)
  return {
    jobId: job.id,
    source,
    replayed: true,
    sourceCount: numberValue(summary.sourceCount),
    synchronized: numberValue(summary.synchronized),
    inserted: numberValue(summary.inserted),
    updated: numberValue(summary.updated),
    skipped: numberValue(summary.skipped),
    failures: Array.isArray(summary.failures)
      ? summary.failures as TravelDemandSyncResult['failures']
      : [],
    demands: await loadImportedDemandProjections(client, tenantId, demandIds),
  }
}

async function loadImportedDemandProjections(
  client: PoolClient,
  tenantId: string,
  demandIds: string[],
): Promise<Array<Record<string, unknown>>> {
  if (!demandIds.length) return []
  const result = await client.query<ImportedDemandRow>(
    `select id, company_id, employee_id, demand_number, status,
            lifecycle_status, lifecycle_version, version, metadata, updated_at
     from demands
     where tenant_id = $1 and id = any($2::text[]) and deleted_at is null
     order by updated_at, id`,
    [tenantId, demandIds],
  )
  return result.rows.map((row) => ({
    ...recordValue(recordValue(row.metadata).legacySnapshot),
    id: row.id,
    serial_os: row.demand_number,
    empresa_id: row.company_id,
    funcionario_id: row.employee_id,
    status: row.status,
    relational_version: Number(row.version),
    relational_lifecycle_status: row.lifecycle_status,
    relational_lifecycle_version: Number(row.lifecycle_version),
    updated_at: isoDate(row.updated_at),
  }))
}

async function persistImportedDemandCompatibility(
  client: PoolClient,
  principal: RequestPrincipal,
  demands: Array<Record<string, unknown>>,
): Promise<void> {
  if (!demands.length) return
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext('bbt-atendimentos'))`,
    [principal.tenantId],
  )
  const current = await client.query<{ value: unknown }>(
    `select value from app_kv
     where tenant_id = $1 and key = 'bbt-atendimentos'
     for update`,
    [principal.tenantId],
  )
  const merged = mergeStorageValues('bbt-atendimentos', current.rows[0]?.value, demands)
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, 'bbt-atendimentos', $2::jsonb, $3)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [principal.tenantId, JSON.stringify(merged), principal.user.id],
  )
}

async function replaceImportedDemandCompatibility(
  client: PoolClient,
  principal: RequestPrincipal,
  affectedDemandIds: string[],
  restoredDemands: Array<Record<string, unknown>>,
): Promise<void> {
  const affected = new Set(affectedDemandIds)
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext('bbt-atendimentos'))`,
    [principal.tenantId],
  )
  const current = await client.query<{ value: unknown }>(
    `select value from app_kv
     where tenant_id = $1 and key = 'bbt-atendimentos'
     for update`,
    [principal.tenantId],
  )
  const currentItems = Array.isArray(current.rows[0]?.value)
    ? current.rows[0].value as Array<Record<string, unknown>>
    : []
  const value = [
    ...currentItems.filter((item) => !affected.has(String(recordValue(item).id || ''))),
    ...restoredDemands,
  ]
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, 'bbt-atendimentos', $2::jsonb, $3)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [principal.tenantId, JSON.stringify(value), principal.user.id],
  )
}

async function assertImportedDemandHasNoDependencies(
  client: PoolClient,
  tenantId: string,
  demandId: string,
): Promise<void> {
  const dependency = await client.query<{ source: string }>(
    `select source
     from (
       select 'travel_quote'::text as source
       from travel_quotes where tenant_id = $1 and demand_id = $2
       union all
       select 'reservation'::text
       from reservations where tenant_id = $1 and demand_id = $2
       union all
       select 'voucher'::text
       from vouchers where tenant_id = $1 and demand_id = $2
       union all
       select 'financial_entry'::text
       from financial_entries
       where tenant_id = $1 and demand_id = $2 and deleted_at is null
       union all
       select 'approval_instance'::text
       from approval_instances where tenant_id = $1 and demand_id = $2
     ) dependencies
     limit 1`,
    [tenantId, demandId],
  )
  if (dependency.rows[0]) {
    throw new DemandServiceError(
      'DEMAND_IMPORT_ROLLBACK_HAS_DEPENDENCIES',
      'Uma demanda importada ja possui registros dependentes e nao pode ser removida.',
      409,
      { demandId, dependency: dependency.rows[0].source },
    )
  }
}

async function cancelUnsettledFinancialEntriesForDemand(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  actorUserId: string,
  importJobId: string,
): Promise<void> {
  const entries = await client.query<{
    id: string
    status: string
    settled_amount: string | number
  }>(
    `select id, status, settled_amount
     from financial_entries
     where tenant_id = $1 and demand_id = $2 and deleted_at is null
     for update`,
    [tenantId, demandId],
  )
  const settled = entries.rows.filter((entry) =>
    Number(entry.settled_amount) > 0
    || ['paid', 'partial'].includes(entry.status)
  )
  if (settled.length) {
    throw new DemandServiceError(
      'DEMAND_IMPORT_ROLLBACK_FINANCE_SETTLED',
      'Uma demanda do lote possui lancamento pago ou parcialmente pago e nao pode ser removida.',
      409,
      { demandId, financialEntryIds: settled.map((entry) => entry.id) },
    )
  }
  if (!entries.rowCount) return

  await client.query(
    `update financial_entries
     set status = 'cancelled',
         deleted_at = now(),
         updated_by = $3,
         updated_at = now(),
         version = version + 1,
         metadata = metadata || jsonb_build_object(
           'rollback',
           jsonb_build_object(
             'reason', 'demand_import_rollback',
             'importJobId', $4,
             'rolledBackBy', $3,
             'rolledBackAt', now()
           )
         )
     where tenant_id = $1 and demand_id = $2 and deleted_at is null`,
    [tenantId, demandId, actorUserId, importJobId],
  )
  await client.query(
    `update app_kv
     set value = coalesce(
           (
             select jsonb_agg(item)
             from jsonb_array_elements(value) item
             where item->>'atendimento_id' is distinct from $3
           ),
           '[]'::jsonb
         ),
         version = version + 1,
         updated_by = $4,
         updated_at = now()
     where tenant_id = $1
       and key = $2
       and jsonb_typeof(value) = 'array'`,
    [tenantId, 'bbt-financeiro', demandId, actorUserId],
  )
}

async function registerImportedOperationUsage(
  client: PoolClient,
  principal: RequestPrincipal,
  inserted: number,
): Promise<void> {
  if (inserted <= 0) return
  const usage = await client.query<{ operations_created: string | number }>(
    `insert into tenant_usage_monthly (tenant_id, month_start, operations_created)
     values ($1, date_trunc('month', current_date)::date, $2)
     on conflict (tenant_id, month_start) do update set
       operations_created = tenant_usage_monthly.operations_created + excluded.operations_created,
       updated_at = now()
     returning operations_created`,
    [principal.tenantId, inserted],
  )
  const total = Number(usage.rows[0]?.operations_created || 0)
  if (principal.limits.monthlyOperations && total > principal.limits.monthlyOperations) {
    throw new DemandServiceError(
      'MONTHLY_OPERATION_LIMIT_EXCEEDED',
      'Limite mensal de novas demandas do plano atingido.',
      409,
    )
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : []
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isoDate(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

import 'server-only'

import { randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'

import { sha256 } from '@/lib/policy'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { getAccessibleCompanyIds, requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  domainRolloutAppliesToCompany,
  domainRolloutIsFullyRelational,
  getDomainRolloutInTransaction,
} from '@/lib/server/domain-rollout-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  isRequesterReadPrincipal,
  requesterOwnVoucherExistsSql,
} from '@/lib/server/requester-read-scope'
import { enrichVouchersFromDatabase } from '@/lib/server/voucher-enrichment-service'
import { attachVoucherPresentationSettings } from '@/lib/server/voucher-presentation-service'
import {
  assertVoucherStatusTransition,
  normalizeLegacyVoucher,
  voucherBatchSchema,
  voucherCreateSchema,
  voucherIdentifierSchema,
  voucherPatchSchema,
  voucherSchema,
  voucherStatusFromDatabase,
  voucherStatusToDatabase,
} from '@/lib/vouchers/schema'
import { VOUCHER_PREFIX, type VoucherEmitido } from '@/types'

const VOUCHERS_STORAGE_KEY = 'bbt-vouchers-emitidos'
const VOUCHER_SEQUENCE_STORAGE_KEY = 'bbt-vouchers-last-numero'
const VOUCHER_SEQUENCE_KEY = 'voucher-number'
const VOUCHER_SEQUENCE_BASE = 26_261

interface VoucherRow extends QueryResultRow {
  id: string
  reservation_id: string | null
  demand_id: string | null
  company_id: string
  employee_id: string | null
  voucher_code: string
  status: string
  file_id: string | null
  issued_at: Date | string | null
  metadata: Record<string, unknown>
  fingerprint: string | null
  version: string | number
  created_at: Date | string
  updated_at: Date | string
}

interface LegacyVoucherBootstrap {
  unresolved: unknown[]
}

export class VoucherServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export async function listVouchers(
  principal: RequestPrincipal,
  filters: { companyId?: string; search?: string; limit?: number; offset?: number } = {},
): Promise<{ items: VoucherEmitido[]; total: number }> {
  const allowedCompanyIds = voucherCompanyIds(principal)
  if (filters.companyId) {
    await requireCompanyAccess(principal, filters.companyId, 'ver_vouchers')
  }
  const companyIds = filters.companyId ? [filters.companyId] : allowedCompanyIds
  const limit = Math.max(1, Math.min(500, Number(filters.limit || 100)))
  const offset = Math.max(0, Number(filters.offset || 0))
  const search = filters.search?.trim()
    ? `%${filters.search.trim().slice(0, 200)}%`
    : null
  if (!companyIds.length) return { items: [], total: 0 }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const bootstrap = await bootstrapLegacyVouchers(client, principal)
    const parameters: unknown[] = [principal.tenantId, companyIds]
    const clauses = [
      'voucher.tenant_id = $1',
      'voucher.company_id = any($2::text[])',
      'voucher.deleted_at is null',
    ]
    if (isRequesterReadPrincipal(principal)) {
      parameters.push(principal.user.id, principal.user.email)
      clauses.push(requesterOwnVoucherExistsSql(
        'voucher',
        `$${parameters.length - 1}`,
        `$${parameters.length}`,
      ))
    }
    if (search) {
      parameters.push(search)
      const searchParameter = `$${parameters.length}`
      clauses.push(`(
        voucher.id ilike ${searchParameter}
        or voucher.voucher_code ilike ${searchParameter}
        or coalesce(voucher.metadata->>'numero', '') ilike ${searchParameter}
        or coalesce(voucher.metadata->>'localizador', '') ilike ${searchParameter}
        or coalesce(voucher.metadata->>'numero_confirmacao', '') ilike ${searchParameter}
        or coalesce(voucher.metadata->>'passageiro_nome', '') ilike ${searchParameter}
        or coalesce(voucher.metadata->>'cpf', '') ilike ${searchParameter}
      )`)
    }
    parameters.push(limit, offset)
    const result = await client.query<VoucherRow & { total_count: string }>(
      `select voucher.*, count(*) over()::text as total_count
       from vouchers voucher
       where ${clauses.join(' and ')}
       order by voucher.created_at desc, voucher.id desc
       limit $${parameters.length - 1} offset $${parameters.length}`,
      parameters,
    )
    await syncVoucherCompatibilityProjection(client, principal, bootstrap.unresolved)
    const enrichedItems = await enrichVouchersFromDatabase(
      client,
      principal.tenantId,
      result.rows.map(mapVoucherRow),
    )
    const presentedItems = await attachVoucherPresentationSettings(
      client,
      principal.tenantId,
      enrichedItems,
    )
    return {
      items: presentedItems.map(withExternalReservationConfirmation),
      total: Number(result.rows[0]?.total_count || 0),
    }
  })
}

export async function getVoucher(
  principal: RequestPrincipal,
  rawVoucherId: string,
): Promise<VoucherEmitido> {
  const voucherId = voucherIdentifierSchema.parse(rawVoucherId)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const bootstrap = await bootstrapLegacyVouchers(client, principal)
    const row = await loadVoucherForUpdate(client, principal.tenantId, voucherId, false)
    await requireCompanyAccess(principal, row.company_id, 'ver_vouchers')
    await requireRequesterVoucherReadAccess(client, principal, row.id)
    await syncVoucherCompatibilityProjection(client, principal, bootstrap.unresolved)
    const voucher = mapVoucherRow(row)
    const [enriched] = await enrichVouchersFromDatabase(client, principal.tenantId, [voucher])
    const [presented] = await attachVoucherPresentationSettings(
      client,
      principal.tenantId,
      [enriched || voucher],
    )
    return withExternalReservationConfirmation(presented || enriched || voucher)
  })
}

async function requireRequesterVoucherReadAccess(
  client: PoolClient,
  principal: RequestPrincipal,
  voucherId: string,
): Promise<void> {
  if (!isRequesterReadPrincipal(principal)) return
  const parameters = [
    principal.tenantId,
    voucherId,
    principal.user.id,
    principal.user.email,
  ]
  const result = await client.query(
    `select 1
     from vouchers voucher
     where voucher.tenant_id = $1
       and voucher.id = $2
       and voucher.deleted_at is null
       and ${requesterOwnVoucherExistsSql('voucher', '$3', '$4')}`,
    parameters,
  )
  if (!result.rowCount) {
    // A 404 avoids confirming the existence of another requester's voucher.
    throw new VoucherServiceError('VOUCHER_NOT_FOUND', 'Voucher nao encontrado.', 404)
  }
}

export async function createVoucher(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<VoucherEmitido> {
  const input = voucherCreateSchema.parse(rawInput)
  await requireCompanyAccess(principal, input.empresa_id, 'operar_reservas')

  const voucher = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertVoucherRelationalWriteEnabled(client, principal.tenantId, input.empresa_id)
    const bootstrap = await bootstrapLegacyVouchers(client, principal)
    await assertVoucherReferences(client, principal.tenantId, input)
    const number = await nextVoucherNumber(client, principal.tenantId)
    const voucherId = `${VOUCHER_PREFIX[input.tipo]}-${number}`
    const now = new Date().toISOString()
    const complete = voucherSchema.parse({
      ...input,
      id: voucherId,
      numero: String(number),
      emitido_por_user_id: principal.user.id,
      emitido_por_user_name: principal.user.name,
      created_at: now,
      version: 1,
    })
    const row = await insertVoucher(client, principal, complete)
    await syncVoucherCompatibilityProjection(client, principal, bootstrap.unresolved)
    const mapped = mapVoucherRow(row)
    const [presented] = await attachVoucherPresentationSettings(
      client,
      principal.tenantId,
      [mapped],
    )
    return presented || mapped
  })

  await writeAuditEvent({
    action: 'voucher.create',
    result: 'success',
    entityType: 'voucher',
    entityId: voucher.id,
    metadata: { companyId: voucher.empresa_id, demandId: voucher.atendimento_id || null },
  })
  return voucher
}

export async function upsertVoucherBatch(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<{ vouchers: VoucherEmitido[]; reused: boolean; jobId: string }> {
  const input = voucherBatchSchema.parse(rawInput)
  for (const companyId of new Set(input.vouchers.map((voucher) => voucher.empresa_id))) {
    await requireCompanyAccess(principal, companyId, 'importar_planilhas')
  }

  const inputHash = sha256({ tenantId: principal.tenantId, vouchers: input.vouchers })
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [principal.tenantId, `voucher-batch:${input.idempotencyKey}`],
    )
    for (const companyId of new Set(input.vouchers.map((voucher) => voucher.empresa_id))) {
      await assertVoucherRelationalWriteEnabled(client, principal.tenantId, companyId)
    }
    const existingJob = await client.query<{
      id: string
      status: string
      summary: Record<string, unknown>
    }>(
      `select id, status, summary
       from import_jobs
       where tenant_id = $1 and source = 'voucher_batch' and idempotency_key = $2
       for update`,
      [principal.tenantId, input.idempotencyKey],
    )
    if (existingJob.rows[0]) {
      const summaryHash = String(existingJob.rows[0].summary?.inputHash || '')
      if (summaryHash && summaryHash !== inputHash) {
        throw new VoucherServiceError(
          'VOUCHER_IDEMPOTENCY_CONFLICT',
          'A chave de idempotencia ja foi usada com outro conteudo.',
          409,
        )
      }
      if (existingJob.rows[0].status === 'completed') {
        const ids = Array.isArray(existingJob.rows[0].summary?.voucherIds)
          ? existingJob.rows[0].summary.voucherIds.map(String)
          : []
        const reusedRows = ids.length
          ? await client.query<VoucherRow>(
              `select *
               from vouchers
               where tenant_id = $1 and id = any($2::text[]) and deleted_at is null`,
              [principal.tenantId, ids],
            )
          : { rows: [] as VoucherRow[] }
        return {
          vouchers: await attachVoucherPresentationSettings(
            client,
            principal.tenantId,
            reusedRows.rows.map(mapVoucherRow),
          ),
          reused: true,
          jobId: existingJob.rows[0].id,
        }
      }
      throw new VoucherServiceError(
        'VOUCHER_IMPORT_IN_PROGRESS',
        'Este lote de vouchers ainda esta em processamento.',
        409,
      )
    }

    const jobId = randomUUID()
    await client.query(
      `insert into import_jobs (
         id, tenant_id, requested_by, source, status, idempotency_key,
         total_rows, summary, started_at
       ) values ($1, $2, $3, 'voucher_batch', 'processing', $4, $5, $6::jsonb, now())`,
      [
        jobId,
        principal.tenantId,
        principal.user.id,
        input.idempotencyKey,
        input.vouchers.length,
        JSON.stringify({ inputHash }),
      ],
    )

    const bootstrap = await bootstrapLegacyVouchers(client, principal)
    await assertVoucherBatchReferences(client, principal.tenantId, input.vouchers)
    const saved = await persistVoucherBatch(client, principal, input.vouchers)
    await syncVoucherCompatibilityProjection(client, principal, bootstrap.unresolved)
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
        saved.length,
        JSON.stringify({ inputHash, voucherIds: saved.map((voucher) => voucher.id) }),
      ],
    )
    return {
      vouchers: await attachVoucherPresentationSettings(
        client,
        principal.tenantId,
        saved,
      ),
      reused: false,
      jobId,
    }
  })

  await writeAuditEvent({
    action: result.reused ? 'voucher.batch_reused' : 'voucher.batch_upsert',
    result: 'success',
    entityType: 'import_job',
    entityId: result.jobId,
    metadata: { count: result.vouchers.length },
  })
  return result
}

export async function updateVoucher(
  principal: RequestPrincipal,
  rawVoucherId: string,
  rawPatch: unknown,
  rawExpectedVersion?: unknown,
): Promise<VoucherEmitido> {
  const voucherId = voucherIdentifierSchema.parse(rawVoucherId)
  const patch = voucherPatchSchema.parse(rawPatch)
  const expectedVersion = rawExpectedVersion === undefined
    ? null
    : Number(rawExpectedVersion)
  if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
    throw new VoucherServiceError('VOUCHER_VERSION_INVALID', 'Versao do voucher invalida.', 400)
  }

  const voucher = await withTenantTransaction(principal.tenantId, async (client) => {
    const bootstrap = await bootstrapLegacyVouchers(client, principal)
    const currentRow = await loadVoucherForUpdate(client, principal.tenantId, voucherId, true)
    await assertVoucherRelationalWriteEnabled(client, principal.tenantId, currentRow.company_id)
    await requireCompanyAccess(principal, currentRow.company_id, 'operar_reservas')
    const current = mapVoucherRow(currentRow)
    const next = voucherSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      numero: current.numero,
      empresa_id: current.empresa_id,
      emitido_por_user_id: current.emitido_por_user_id,
      emitido_por_user_name: current.emitido_por_user_name,
      created_at: current.created_at,
      version: Number(currentRow.version),
    })
    try {
      assertVoucherStatusTransition(current.status, next.status)
    } catch {
      throw new VoucherServiceError(
        'VOUCHER_STATUS_TRANSITION_INVALID',
        `Nao e permitido alterar o voucher de ${current.status} para ${next.status}.`,
        409,
      )
    }
    await assertVoucherReferences(client, principal.tenantId, next)

    const result = await client.query<VoucherRow>(
      `update vouchers
       set demand_id = $4,
           employee_id = $5,
           status = $6,
           issued_at = case when $6 in ('issued', 'confirmed') then coalesce(issued_at, now()) else issued_at end,
           metadata = $7::jsonb,
           fingerprint = $8,
           updated_by = $9,
           version = version + 1
       where tenant_id = $1
         and company_id = $2
         and id = $3
         and deleted_at is null
         and ($10::bigint is null or version = $10)
       returning *`,
      [
        principal.tenantId,
        current.empresa_id,
        voucherId,
        next.atendimento_id || null,
        next.funcionario_id || null,
        voucherStatusToDatabase(next.status),
        JSON.stringify(next),
        next.fingerprint || null,
        principal.user.id,
        expectedVersion,
      ],
    )
    if (!result.rowCount) {
      throw new VoucherServiceError(
        'VOUCHER_VERSION_CONFLICT',
        'O voucher foi alterado por outra pessoa. Recarregue antes de salvar.',
        409,
      )
    }
    await syncVoucherCompatibilityProjection(client, principal, bootstrap.unresolved)
    const mapped = mapVoucherRow(result.rows[0])
    const [presented] = await attachVoucherPresentationSettings(
      client,
      principal.tenantId,
      [mapped],
    )
    return presented || mapped
  })

  await writeAuditEvent({
    action: 'voucher.update',
    result: 'success',
    entityType: 'voucher',
    entityId: voucher.id,
    metadata: { companyId: voucher.empresa_id, status: voucher.status },
  })
  return voucher
}

export async function removeVoucher(
  principal: RequestPrincipal,
  rawVoucherId: string,
): Promise<{ removedId: string; companyId: string }> {
  const voucherId = voucherIdentifierSchema.parse(rawVoucherId)
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const bootstrap = await bootstrapLegacyVouchers(client, principal)
    const current = await loadVoucherForUpdate(client, principal.tenantId, voucherId, true)
    await assertVoucherRelationalWriteEnabled(client, principal.tenantId, current.company_id)
    await requireCompanyAccess(principal, current.company_id, 'operar_cancelamentos')
    await client.query(
      `update vouchers
       set status = 'cancelled',
           deleted_at = now(),
           updated_by = $3,
           version = version + 1
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, voucherId, principal.user.id],
    )
    await syncVoucherCompatibilityProjection(client, principal, bootstrap.unresolved)
    return { removedId: voucherId, companyId: current.company_id }
  })

  await writeAuditEvent({
    action: 'voucher.remove',
    result: 'success',
    entityType: 'voucher',
    entityId: voucherId,
    metadata: { companyId: result.companyId },
  })
  return result
}

async function assertVoucherRelationalWriteEnabled(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, tenantId, 'vouchers')
  if (!domainRolloutAppliesToCompany(rollout, companyId) || rollout.writeMode === 'legacy') {
    throw new VoucherServiceError(
      'VOUCHER_RELATIONAL_WRITE_DISABLED',
      'A gravacao relacional de vouchers ainda nao esta habilitada para esta empresa.',
      409,
    )
  }
}

async function insertVoucher(
  client: PoolClient,
  principal: RequestPrincipal,
  voucher: VoucherEmitido,
): Promise<VoucherRow> {
  const result = await client.query<VoucherRow>(
    `insert into vouchers (
       id, tenant_id, demand_id, company_id, employee_id, voucher_code, status,
       issued_at, metadata, fingerprint, created_by, updated_by
     ) values (
       $1, $2, $3, $4, $5, $6, $7,
       case when $7 in ('issued', 'confirmed') then now() else null end,
       $8::jsonb, $9, $10, $10
     )
     returning *`,
    [
      voucher.id,
      principal.tenantId,
      voucher.atendimento_id || null,
      voucher.empresa_id,
      voucher.funcionario_id || null,
      voucher.id,
      voucherStatusToDatabase(voucher.status),
      JSON.stringify(voucher),
      voucher.fingerprint || null,
      principal.user.id,
    ],
  )
  return result.rows[0]
}

async function persistVoucherBatch(
  client: PoolClient,
  principal: RequestPrincipal,
  vouchers: VoucherEmitido[],
): Promise<VoucherEmitido[]> {
  const ids = vouchers.map((voucher) => voucher.id)
  const codes = vouchers.map((voucher) => voucher.id)
  const fingerprints = vouchers.map((voucher) => voucher.fingerprint).filter(Boolean) as string[]
  const existing = await client.query<{
    id: string
    voucher_code: string
    fingerprint: string | null
  }>(
    `select id, voucher_code, fingerprint
     from vouchers
     where tenant_id = $1
       and (
         id = any($2::text[])
         or voucher_code = any($3::text[])
         or (cardinality($4::text[]) > 0 and fingerprint = any($4::text[]))
       )`,
    [principal.tenantId, ids, codes, fingerprints],
  )
  const byId = new Map(existing.rows.map((row) => [row.id, row.id]))
  const byCode = new Map(existing.rows.map((row) => [row.voucher_code, row.id]))
  const byFingerprint = new Map(
    existing.rows.filter((row) => row.fingerprint).map((row) => [row.fingerprint as string, row.id]),
  )
  const normalized = new Map<string, VoucherEmitido>()
  for (const input of vouchers) {
    const targetId = byId.get(input.id)
      || byCode.get(input.id)
      || (input.fingerprint ? byFingerprint.get(input.fingerprint) : null)
      || input.id
    normalized.set(targetId, voucherSchema.parse({
      ...input,
      id: targetId,
      emitido_por_user_id: principal.user.id,
      emitido_por_user_name: principal.user.name,
      created_at: input.created_at || new Date().toISOString(),
    }))
  }
  const payload = [...normalized.values()].map((voucher) => ({
    id: voucher.id,
    demand_id: voucher.atendimento_id || null,
    company_id: voucher.empresa_id,
    employee_id: voucher.funcionario_id || null,
    voucher_code: voucher.id,
    status: voucherStatusToDatabase(voucher.status),
    issued_at: voucher.status === 'rascunho' ? null : voucher.created_at || new Date().toISOString(),
    metadata: voucher,
    fingerprint: voucher.fingerprint || null,
    created_at: voucher.created_at || new Date().toISOString(),
    updated_at: voucher.updated_at || new Date().toISOString(),
  }))

  await client.query(
    `with input as (
       select *
       from jsonb_to_recordset($2::jsonb) as item(
         id text,
         demand_id text,
         company_id text,
         employee_id text,
         voucher_code text,
         status text,
         issued_at timestamptz,
         metadata jsonb,
         fingerprint text,
         created_at timestamptz,
         updated_at timestamptz
       )
     )
     insert into vouchers (
       id, tenant_id, demand_id, company_id, employee_id, voucher_code, status,
       issued_at, metadata, fingerprint, created_by, updated_by, created_at, updated_at
     )
     select
       input.id, $1, input.demand_id, input.company_id, input.employee_id,
       input.voucher_code, input.status, input.issued_at, input.metadata,
       input.fingerprint, $3, $3, input.created_at, input.updated_at
     from input
     on conflict (tenant_id, id) do update set
       demand_id = excluded.demand_id,
       employee_id = excluded.employee_id,
       status = excluded.status,
       issued_at = excluded.issued_at,
       metadata = excluded.metadata,
       fingerprint = excluded.fingerprint,
       updated_by = excluded.updated_by,
       updated_at = now(),
       version = vouchers.version + 1`,
    [principal.tenantId, JSON.stringify(payload), principal.user.id],
  )

  const maxNumber = Math.max(VOUCHER_SEQUENCE_BASE, ...payload.map((item) => numericVoucherNumber(item.voucher_code)))
  await ensureVoucherSequence(client, principal.tenantId, maxNumber)
  const saved = await client.query<VoucherRow>(
    `select *
     from vouchers
     where tenant_id = $1 and id = any($2::text[]) and deleted_at is null`,
    [principal.tenantId, payload.map((item) => item.id)],
  )
  const savedById = new Map(saved.rows.map((row) => [row.id, mapVoucherRow(row)]))
  return payload.flatMap((item) => savedById.get(item.id) || [])
}

async function assertVoucherReferences(
  client: PoolClient,
  tenantId: string,
  voucher: Pick<VoucherEmitido, 'empresa_id' | 'funcionario_id' | 'atendimento_id'>,
): Promise<void> {
  const company = await client.query(
    `select 1 from companies where tenant_id = $1 and id = $2 and deleted_at is null`,
    [tenantId, voucher.empresa_id],
  )
  if (!company.rowCount) throw new VoucherServiceError('VOUCHER_COMPANY_NOT_FOUND', 'Empresa nao encontrada.', 404)

  if (voucher.funcionario_id) {
    const employee = await client.query(
      `select 1
       from employees
       where tenant_id = $1 and company_id = $2 and id = $3 and deleted_at is null`,
      [tenantId, voucher.empresa_id, voucher.funcionario_id],
    )
    if (!employee.rowCount) {
      throw new VoucherServiceError(
        'VOUCHER_EMPLOYEE_SCOPE_INVALID',
        'O funcionario do voucher nao pertence a empresa.',
        409,
      )
    }
  }
  if (voucher.atendimento_id) {
    const demand = await client.query(
      `select 1
       from demands
       where tenant_id = $1 and company_id = $2 and id = $3 and deleted_at is null`,
      [tenantId, voucher.empresa_id, voucher.atendimento_id],
    )
    if (!demand.rowCount) {
      throw new VoucherServiceError(
        'VOUCHER_DEMAND_SCOPE_INVALID',
        'A demanda do voucher nao pertence a empresa.',
        409,
      )
    }
  }
}

async function assertVoucherBatchReferences(
  client: PoolClient,
  tenantId: string,
  vouchers: VoucherEmitido[],
): Promise<void> {
  const employeeIds = vouchers.map((voucher) => voucher.funcionario_id).filter(Boolean) as string[]
  const demandIds = vouchers.map((voucher) => voucher.atendimento_id).filter(Boolean) as string[]
  const employees = employeeIds.length
    ? await client.query<{ id: string; company_id: string }>(
        `select id, company_id
         from employees
         where tenant_id = $1 and id = any($2::text[]) and deleted_at is null`,
        [tenantId, employeeIds],
      )
    : { rows: [] as Array<{ id: string; company_id: string }> }
  const demands = demandIds.length
    ? await client.query<{ id: string; company_id: string }>(
        `select id, company_id
         from demands
         where tenant_id = $1 and id = any($2::text[]) and deleted_at is null`,
        [tenantId, demandIds],
      )
    : { rows: [] as Array<{ id: string; company_id: string }> }
  const employeeCompanies = new Map(employees.rows.map((row) => [row.id, row.company_id]))
  const demandCompanies = new Map(demands.rows.map((row) => [row.id, row.company_id]))
  for (const voucher of vouchers) {
    if (voucher.funcionario_id && employeeCompanies.get(voucher.funcionario_id) !== voucher.empresa_id) {
      throw new VoucherServiceError(
        'VOUCHER_EMPLOYEE_SCOPE_INVALID',
        `Funcionario invalido no voucher ${voucher.id}.`,
        409,
      )
    }
    if (voucher.atendimento_id && demandCompanies.get(voucher.atendimento_id) !== voucher.empresa_id) {
      throw new VoucherServiceError(
        'VOUCHER_DEMAND_SCOPE_INVALID',
        `Demanda invalida no voucher ${voucher.id}.`,
        409,
      )
    }
  }
}

async function bootstrapLegacyVouchers(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<LegacyVoucherBootstrap> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'vouchers')
  if (domainRolloutIsFullyRelational(rollout)) {
    await ensureVoucherSequence(client, principal.tenantId, VOUCHER_SEQUENCE_BASE)
    return { unresolved: [] }
  }
  await client.query(
    `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [principal.tenantId, VOUCHERS_STORAGE_KEY],
  )
  const storage = await client.query<{ value: unknown }>(
    `select value
     from app_kv
     where tenant_id = $1 and key = $2
     for update`,
    [principal.tenantId, VOUCHERS_STORAGE_KEY],
  )
  const legacyItems = Array.isArray(storage.rows[0]?.value) ? storage.rows[0].value as unknown[] : []
  if (!legacyItems.length) {
    await ensureVoucherSequence(client, principal.tenantId, VOUCHER_SEQUENCE_BASE)
    return { unresolved: [] }
  }

  const companies = await client.query<{ id: string }>(
    `select id from companies where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const companyIds = new Set(companies.rows.map((row) => row.id))
  const employees = await client.query<{ id: string; company_id: string }>(
    `select id, company_id from employees where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const employeeKeys = new Set(employees.rows.map((row) => `${row.company_id}:${row.id}`))
  const demands = await client.query<{ id: string; company_id: string }>(
    `select id, company_id from demands where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const demandKeys = new Set(demands.rows.map((row) => `${row.company_id}:${row.id}`))
  const existing = await client.query<{ id: string; voucher_code: string; fingerprint: string | null }>(
    `select id, voucher_code, fingerprint from vouchers where tenant_id = $1`,
    [principal.tenantId],
  )
  const existingIds = new Set(existing.rows.map((row) => row.id))
  const existingCodes = new Set(existing.rows.map((row) => row.voucher_code))
  const existingFingerprints = new Set(existing.rows.map((row) => row.fingerprint).filter(Boolean))
  const unresolved: unknown[] = []
  const pending: Array<Record<string, unknown>> = []
  let maxNumber = VOUCHER_SEQUENCE_BASE

  for (const value of legacyItems) {
    const voucher = normalizeLegacyVoucher(value)
    if (!voucher || !companyIds.has(voucher.empresa_id)) {
      unresolved.push(value)
      continue
    }
    maxNumber = Math.max(maxNumber, numericVoucherNumber(voucher.numero), numericVoucherNumber(voucher.id))
    if (
      existingIds.has(voucher.id)
      || existingCodes.has(voucher.id)
      || (voucher.fingerprint && existingFingerprints.has(voucher.fingerprint))
    ) {
      continue
    }
    pending.push({
      id: voucher.id,
      demand_id: voucher.atendimento_id
        && demandKeys.has(`${voucher.empresa_id}:${voucher.atendimento_id}`)
        ? voucher.atendimento_id
        : null,
      company_id: voucher.empresa_id,
      employee_id: voucher.funcionario_id
        && employeeKeys.has(`${voucher.empresa_id}:${voucher.funcionario_id}`)
        ? voucher.funcionario_id
        : null,
      voucher_code: voucher.id,
      status: voucherStatusToDatabase(voucher.status),
      issued_at: voucher.status === 'rascunho' ? null : voucher.created_at,
      metadata: voucher,
      fingerprint: voucher.fingerprint || null,
      created_at: voucher.created_at || new Date().toISOString(),
      updated_at: voucher.updated_at || voucher.created_at || new Date().toISOString(),
    })
    existingIds.add(voucher.id)
    existingCodes.add(voucher.id)
    if (voucher.fingerprint) existingFingerprints.add(voucher.fingerprint)
  }

  if (pending.length) {
    await client.query(
      `with input as (
         select *
         from jsonb_to_recordset($2::jsonb) as item(
           id text,
           demand_id text,
           company_id text,
           employee_id text,
           voucher_code text,
           status text,
           issued_at timestamptz,
           metadata jsonb,
           fingerprint text,
           created_at timestamptz,
           updated_at timestamptz
         )
       )
       insert into vouchers (
         id, tenant_id, demand_id, company_id, employee_id, voucher_code, status,
         issued_at, metadata, fingerprint, created_by, updated_by, created_at, updated_at
       )
       select
         input.id, $1, input.demand_id, input.company_id, input.employee_id,
         input.voucher_code, input.status, input.issued_at, input.metadata,
         input.fingerprint, $3, $3, input.created_at, input.updated_at
       from input
       on conflict do nothing`,
      [principal.tenantId, JSON.stringify(pending), principal.user.id],
    )
  }
  await ensureVoucherSequence(client, principal.tenantId, maxNumber)
  return { unresolved }
}

async function syncVoucherCompatibilityProjection(
  client: PoolClient,
  principal: RequestPrincipal,
  unresolved: unknown[],
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'vouchers')
  if (domainRolloutIsFullyRelational(rollout)) return
  const rows = await client.query<VoucherRow>(
    `select *
     from vouchers
     where tenant_id = $1 and deleted_at is null
     order by created_at desc`,
    [principal.tenantId],
  )
  const relational = rows.rows.map(mapVoucherRow)
  const identities = new Set(relational.flatMap((voucher) => [
    `id:${voucher.id}`,
    ...(voucher.fingerprint ? [`fingerprint:${voucher.fingerprint}`] : []),
  ]))
  const preserved = unresolved.filter((value) => {
    const voucher = normalizeLegacyVoucher(value)
    if (!voucher) return true
    return !identities.has(`id:${voucher.id}`)
      && (!voucher.fingerprint || !identities.has(`fingerprint:${voucher.fingerprint}`))
  })
  const maxNumber = Math.max(
    VOUCHER_SEQUENCE_BASE,
    ...relational.map((voucher) => numericVoucherNumber(voucher.numero)),
  )
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, $2, $3::jsonb, $4)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [principal.tenantId, VOUCHERS_STORAGE_KEY, JSON.stringify([...relational, ...preserved]), principal.user.id],
  )
  await client.query(
    `insert into app_kv (tenant_id, key, value, updated_by)
     values ($1, $2, to_jsonb($3::text), $4)
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by`,
    [principal.tenantId, VOUCHER_SEQUENCE_STORAGE_KEY, String(maxNumber), principal.user.id],
  )
}

async function loadVoucherForUpdate(
  client: PoolClient,
  tenantId: string,
  voucherId: string,
  lock: boolean,
): Promise<VoucherRow> {
  const result = await client.query<VoucherRow>(
    `select *
     from vouchers
     where tenant_id = $1 and id = $2 and deleted_at is null
     ${lock ? 'for update' : ''}`,
    [tenantId, voucherId],
  )
  if (!result.rowCount) {
    throw new VoucherServiceError('VOUCHER_NOT_FOUND', 'Voucher nao encontrado.', 404)
  }
  return result.rows[0]
}

async function nextVoucherNumber(client: PoolClient, tenantId: string): Promise<number> {
  const result = await client.query<{ current_value: string | number }>(
    `insert into tenant_number_sequences (tenant_id, sequence_key, current_value)
     values ($1, $2, $3)
     on conflict (tenant_id, sequence_key) do update set
       current_value = tenant_number_sequences.current_value + 1,
       updated_at = now()
     returning current_value`,
    [tenantId, VOUCHER_SEQUENCE_KEY, VOUCHER_SEQUENCE_BASE + 1],
  )
  const value = Number(result.rows[0]?.current_value)
  if (!Number.isSafeInteger(value) || value <= VOUCHER_SEQUENCE_BASE) {
    throw new VoucherServiceError('VOUCHER_SEQUENCE_INVALID', 'Falha ao gerar numero do voucher.', 500)
  }
  return value
}

async function ensureVoucherSequence(
  client: PoolClient,
  tenantId: string,
  value: number,
): Promise<void> {
  await client.query(
    `insert into tenant_number_sequences (tenant_id, sequence_key, current_value)
     values ($1, $2, $3)
     on conflict (tenant_id, sequence_key) do update set
       current_value = greatest(tenant_number_sequences.current_value, excluded.current_value),
       updated_at = now()`,
    [tenantId, VOUCHER_SEQUENCE_KEY, Math.max(VOUCHER_SEQUENCE_BASE, value)],
  )
}

function mapVoucherRow(row: VoucherRow): VoucherEmitido {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  return voucherSchema.parse({
    ...metadata,
    id: row.id,
    numero: String(metadata.numero || numericVoucherNumber(row.voucher_code)),
    empresa_id: row.company_id,
    funcionario_id: row.employee_id,
    atendimento_id: row.demand_id || undefined,
    status: voucherStatusFromDatabase(row.status),
    fingerprint: row.fingerprint || metadata.fingerprint || undefined,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    version: Number(row.version),
  }) as VoucherEmitido
}

function withExternalReservationConfirmation(voucher: VoucherEmitido): VoucherEmitido {
  if (!voucher.reserva_id || !voucher.localizador) return voucher
  return voucher.numero_confirmacao === voucher.localizador
    ? voucher
    : { ...voucher, numero_confirmacao: voucher.localizador }
}

function voucherCompanyIds(principal: RequestPrincipal): string[] {
  const permissionScoped = principal.corporateAccess?.companies
    .filter((company) => company.permissions.ver_vouchers)
    .map((company) => company.companyId)
  return permissionScoped || getAccessibleCompanyIds(principal)
}

function numericVoucherNumber(value: unknown): number {
  const digits = String(value || '').replace(/\D/g, '')
  const number = Number(digits)
  return Number.isSafeInteger(number) ? number : 0
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

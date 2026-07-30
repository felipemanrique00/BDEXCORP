import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import type {
  ExecutiveReportSnapshot,
  NewExecutiveReportSnapshot,
} from '@/lib/report-snapshot'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const LegacyStorageKey = 'bbt-resumos-executivos-v12'
const MaximumSnapshots = 30

interface SnapshotRow {
  id: string
  payload: unknown
  period_label: string
  created_at: Date | string
}

export class ReportSnapshotError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ReportSnapshotError'
  }
}

export async function listExecutiveReportSnapshots(
  principal: RequestPrincipal,
): Promise<ExecutiveReportSnapshot[]> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    await bootstrapLegacySnapshots(client, principal)
    const result = await client.query<SnapshotRow>(
      `select id, payload, period_label, created_at
       from report_snapshots
       where tenant_id = $1
         and owner_user_id = $2
         and snapshot_type = 'executive_dashboard'
       order by created_at desc, id
       limit $3`,
      [principal.tenantId, principal.user.id, MaximumSnapshots],
    )
    return result.rows
      .map(mapSnapshot)
      .filter((snapshot): snapshot is ExecutiveReportSnapshot => Boolean(snapshot))
  })
}

export async function createExecutiveReportSnapshot(
  principal: RequestPrincipal,
  input: NewExecutiveReportSnapshot,
): Promise<ExecutiveReportSnapshot> {
  const payload = normalizePayload(input)
  const id = `snapshot-${randomUUID()}`
  const created = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<SnapshotRow>(
      `insert into report_snapshots (
         id, tenant_id, owner_user_id, snapshot_type, period_label, payload, source
       ) values ($1, $2, $3, 'executive_dashboard', $4, $5::jsonb, 'dashboard')
       returning id, payload, period_label, created_at`,
      [
        id,
        principal.tenantId,
        principal.user.id,
        payload.periodo,
        JSON.stringify(payload),
      ],
    )
    await trimSnapshots(client, principal)
    const snapshot = result.rows[0] ? mapSnapshot(result.rows[0]) : null
    if (!snapshot) {
      throw new ReportSnapshotError(
        'REPORT_SNAPSHOT_CREATE_FAILED',
        'Nao foi possivel salvar o resumo executivo.',
        500,
      )
    }
    return snapshot
  })
  await writeAuditEvent({
    action: 'report.snapshot.create',
    result: 'success',
    entityType: 'report_snapshot',
    entityId: created.id,
  })
  return created
}

export async function deleteExecutiveReportSnapshot(
  principal: RequestPrincipal,
  snapshotId: string,
): Promise<void> {
  await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query(
      `delete from report_snapshots
       where tenant_id = $1 and id = $2 and owner_user_id = $3`,
      [principal.tenantId, normalizeId(snapshotId), principal.user.id],
    )
    if ((result.rowCount || 0) !== 1) {
      throw new ReportSnapshotError(
        'REPORT_SNAPSHOT_NOT_FOUND',
        'Resumo executivo nao encontrado.',
        404,
      )
    }
  })
  await writeAuditEvent({
    action: 'report.snapshot.delete',
    result: 'success',
    entityType: 'report_snapshot',
    entityId: snapshotId,
  })
}

async function bootstrapLegacySnapshots(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<void> {
  if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') return
  const source = await client.query<{ value: unknown }>(
    'select value from app_kv where tenant_id = $1 and key = $2',
    [principal.tenantId, LegacyStorageKey],
  )
  if (!Array.isArray(source.rows[0]?.value)) return

  for (const raw of source.rows[0].value.slice(0, MaximumSnapshots)) {
    const item = parseLegacySnapshot(raw)
    if (!item) continue
    await client.query(
      `insert into report_snapshots (
         id, tenant_id, owner_user_id, snapshot_type, period_label,
         payload, source, legacy_source_id, created_at
       ) values (
         $1, $2, $3, 'executive_dashboard', $4, $5::jsonb,
         'legacy_import', $1, $6
       )
       on conflict do nothing`,
      [
        item.id,
        principal.tenantId,
        principal.user.id,
        item.periodo,
        JSON.stringify({ ...item, id: undefined, created_at: undefined }),
        item.created_at,
      ],
    )
  }
}

async function trimSnapshots(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<void> {
  await client.query(
    `delete from report_snapshots
     where tenant_id = $1
       and owner_user_id = $2
       and id in (
         select id
         from report_snapshots
         where tenant_id = $1 and owner_user_id = $2
         order by created_at desc, id
         offset $3
       )`,
    [principal.tenantId, principal.user.id, MaximumSnapshots],
  )
}

function mapSnapshot(row: SnapshotRow): ExecutiveReportSnapshot | null {
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : null
  if (!payload) return null
  try {
    const normalized = normalizePayload({
      periodo: row.period_label,
      totalSpend: Number(payload.totalSpend),
      total_demandas: Number(payload.total_demandas),
      por_tipo: numberRecord(payload.por_tipo),
      policyRate: Number(payload.policyRate),
      co2: Number(payload.co2),
      onlineAdoption: optionalNumber(payload.onlineAdoption),
      faturamento_total: optionalNumber(payload.faturamento_total),
      insights: optionalStringArray(payload.insights),
      recomendacoes: optionalStringArray(payload.recomendacoes),
      riscos: optionalStringArray(payload.riscos),
    })
    return {
      id: row.id,
      created_at: new Date(row.created_at).toISOString(),
      ...normalized,
    }
  } catch {
    return null
  }
}

function parseLegacySnapshot(value: unknown): ExecutiveReportSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id.trim().slice(0, 200) : ''
  const createdAt = validDate(item.created_at)
  if (!validId(id) || !createdAt) return null
  try {
    return {
      id,
      created_at: createdAt,
      ...normalizePayload({
        periodo: String(item.periodo || ''),
        totalSpend: Number(item.totalSpend),
        total_demandas: Number(item.total_demandas),
        por_tipo: numberRecord(item.por_tipo),
        policyRate: Number(item.policyRate),
        co2: Number(item.co2),
        onlineAdoption: optionalNumber(item.onlineAdoption),
        faturamento_total: optionalNumber(item.faturamento_total),
        insights: optionalStringArray(item.insights),
        recomendacoes: optionalStringArray(item.recomendacoes),
        riscos: optionalStringArray(item.riscos),
      }),
    }
  } catch {
    return null
  }
}

function normalizePayload(input: NewExecutiveReportSnapshot): NewExecutiveReportSnapshot {
  const periodo = input.periodo.trim().slice(0, 200)
  if (!periodo) throw invalidSnapshot()
  const requiredNumbers = [
    input.totalSpend,
    input.total_demandas,
    input.policyRate,
    input.co2,
  ]
  if (requiredNumbers.some((value) => !Number.isFinite(value) || value < 0)) throw invalidSnapshot()
  if (
    !Number.isInteger(input.total_demandas)
    || input.policyRate > 100
    || invalidOptionalRate(input.onlineAdoption)
    || invalidOptionalAmount(input.faturamento_total)
  ) {
    throw invalidSnapshot()
  }
  return {
    periodo,
    totalSpend: round(input.totalSpend),
    total_demandas: Math.round(input.total_demandas),
    por_tipo: Object.fromEntries(
      Object.entries(input.por_tipo || {})
        .slice(0, 30)
        .flatMap(([key, value]) => (
          key.trim() && Number.isFinite(value) && value >= 0
            ? [[key.trim().slice(0, 100), round(value)]]
            : []
        )),
    ),
    policyRate: round(input.policyRate),
    co2: round(input.co2),
    ...(input.onlineAdoption !== undefined ? { onlineAdoption: round(input.onlineAdoption) } : {}),
    ...(input.faturamento_total !== undefined ? { faturamento_total: round(input.faturamento_total) } : {}),
    ...(input.insights ? { insights: boundedStrings(input.insights) } : {}),
    ...(input.recomendacoes ? { recomendacoes: boundedStrings(input.recomendacoes) } : {}),
    ...(input.riscos ? { riscos: boundedStrings(input.riscos) } : {}),
  }
}

function invalidSnapshot(): ReportSnapshotError {
  return new ReportSnapshotError(
    'REPORT_SNAPSHOT_INVALID',
    'Resumo executivo invalido.',
    400,
  )
}

function normalizeId(value: string): string {
  const id = value.trim().slice(0, 200)
  if (!validId(id)) throw invalidSnapshot()
  return id
}

function validId(value: string): boolean {
  return value.length >= 2 && !/[\u0000-\u001f\u007f]/.test(value)
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => Number.isFinite(Number(item)) ? [[key, Number(item)]] : []),
  )
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function invalidOptionalRate(value: number | undefined): boolean {
  return value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)
}

function invalidOptionalAmount(value: number | undefined): boolean {
  return value !== undefined && (!Number.isFinite(value) || value < 0)
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? boundedStrings(value) : undefined
}

function boundedStrings(values: unknown[]): string[] {
  return values
    .slice(0, 30)
    .flatMap((value) => typeof value === 'string' && value.trim()
      ? [value.trim().slice(0, 1_000)]
      : [])
}

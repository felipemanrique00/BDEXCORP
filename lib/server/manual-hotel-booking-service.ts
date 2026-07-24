import 'server-only'

import { randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  manualHotelBookingCreateSchema,
  manualHotelBookingSchema,
  normalizeLegacyManualHotelBooking,
} from '@/lib/emissions/manual-hotel-schema'
import type { Emissao } from '@/lib/emissoes-storage'
import { sha256 } from '@/lib/policy'
import { writeAuditEvent } from '@/lib/server/audit-log'
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

const STORAGE_KEY = 'bbt-emissoes'
const PROVIDER = 'manual_hotel'

interface ManualHotelBookingRow extends QueryResultRow {
  id: string
  company_id: string
  employee_id: string | null
  hotel_id: string
  passenger_name_snapshot: string
  checkin_date: Date | string
  checkout_date: Date | string
  total_amount: string | number
  observations: string | null
  version: string | number
  created_at: Date | string
  updated_at: Date | string
}

interface LegacyBootstrapResult {
  unresolved: unknown[]
  migratedCount: number
}

export class ManualHotelBookingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ManualHotelBookingError'
  }
}

export async function listManualHotelBookings(
  principal: RequestPrincipal,
  filters: { companyId?: string; limit?: number; offset?: number } = {},
): Promise<{ items: Emissao[]; total: number }> {
  if (filters.companyId) {
    await requireCompanyAccess(principal, filters.companyId, 'ver_emissoes')
  }
  const companyIds = filters.companyId
    ? [filters.companyId]
    : manualHotelBookingCompanyIds(principal, 'ver_emissoes')
  if (!companyIds.length) return { items: [], total: 0 }

  const limit = Math.max(1, Math.min(500, Number(filters.limit || 100)))
  const offset = Math.max(0, Number(filters.offset || 0))
  return withTenantTransaction(principal.tenantId, async (client) => {
    const bootstrap = await bootstrapLegacyBookings(client, principal)
    const result = await client.query<ManualHotelBookingRow & { total_count: string }>(
      `select booking.*, count(*) over()::text as total_count
       from manual_hotel_bookings booking
       where booking.tenant_id = $1
         and booking.company_id = any($2::text[])
         and booking.deleted_at is null
       order by booking.checkin_date desc, booking.created_at desc, booking.id
       limit $3 offset $4`,
      [principal.tenantId, companyIds, limit, offset],
    )
    if (bootstrap.migratedCount > 0) {
      await syncCompatibilityProjection(client, principal, bootstrap.unresolved)
    }
    return {
      items: result.rows.map(mapBookingRow),
      total: Number(result.rows[0]?.total_count || 0),
    }
  })
}

export async function createManualHotelBooking(
  principal: RequestPrincipal,
  rawInput: unknown,
  rawIdempotencyKey: string,
): Promise<{ booking: Emissao; reused: boolean }> {
  const input = manualHotelBookingCreateSchema.parse(rawInput)
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey)
  await requireCompanyAccess(principal, input.empresa_id, 'operar_emissoes')
  const requestHash = sha256({ tenantId: principal.tenantId, input })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await assertRelationalWriteEnabled(client, principal.tenantId, input.empresa_id)
    await client.query(
      'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [principal.tenantId, `${PROVIDER}:${idempotencyKey}`],
    )
    const existing = await client.query<ManualHotelBookingRow & {
      request_hash: string | null
    }>(
      `select *
       from manual_hotel_bookings
       where tenant_id = $1 and idempotency_key = $2
       for update`,
      [principal.tenantId, idempotencyKey],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) {
        throw new ManualHotelBookingError(
          'MANUAL_HOTEL_IDEMPOTENCY_CONFLICT',
          'A chave de idempotencia ja foi usada com outros dados.',
          409,
        )
      }
      await requireCompanyAccess(
        principal,
        existing.rows[0].company_id,
        'operar_emissoes',
      )
      return { booking: mapBookingRow(existing.rows[0]), reused: true }
    }

    const bootstrap = await bootstrapLegacyBookings(client, principal)
    const references = await client.query<{
      employee_name: string
      hotel_name: string
      hotel_city: string | null
      hotel_state: string | null
    }>(
      `select employee.full_name as employee_name,
              hotel.name as hotel_name,
              hotel.city as hotel_city,
              hotel.state as hotel_state
       from employees employee
       join hotels hotel
         on hotel.tenant_id = employee.tenant_id
        and hotel.id = $4
        and hotel.status = 'active'
        and hotel.deleted_at is null
       join companies company
         on company.tenant_id = employee.tenant_id
        and company.id = employee.company_id
        and company.status = 'active'
        and company.deleted_at is null
       where employee.tenant_id = $1
         and employee.id = $2
         and employee.company_id = $3
         and employee.status = 'active'
         and employee.deleted_at is null`,
      [
        principal.tenantId,
        input.funcionario_id,
        input.empresa_id,
        String(input.hotel_id),
      ],
    )
    if (!references.rows[0]) {
      throw new ManualHotelBookingError(
        'MANUAL_HOTEL_REFERENCE_INVALID',
        'Funcionario, empresa ou hotel nao encontrado no mesmo escopo ativo.',
        409,
      )
    }

    const id = `mhb_${randomUUID()}`
    const row = await client.query<ManualHotelBookingRow>(
      `insert into manual_hotel_bookings (
         id, tenant_id, company_id, employee_id, hotel_id,
         passenger_name_snapshot, identity_status, status,
         checkin_date, checkout_date, total_amount, currency,
         observations, idempotency_key, request_hash, metadata,
         created_by, updated_by
       ) values (
         $1, $2, $3, $4, $5, $6, 'matched', 'recorded',
         $7, $8, $9, 'BRL', $10, $11, $12, $13::jsonb, $14, $14
       )
       returning *`,
      [
        id,
        principal.tenantId,
        input.empresa_id,
        input.funcionario_id,
        String(input.hotel_id),
        references.rows[0].employee_name,
        input.data_checkin,
        input.data_checkout,
        input.valor_total,
        input.observacoes,
        idempotencyKey,
        requestHash,
        JSON.stringify({
          source: 'manual_hotel_booking',
          hotelName: references.rows[0].hotel_name,
          hotelCity: references.rows[0].hotel_city,
          hotelState: references.rows[0].hotel_state,
        }),
        principal.user.id,
      ],
    )
    const booking = mapBookingRow(row.rows[0])
    await syncCompatibilityProjection(client, principal, bootstrap.unresolved)
    return { booking, reused: false }
  })

  await writeAuditEvent({
    action: result.reused
      ? 'manual_hotel_booking.create_reused'
      : 'manual_hotel_booking.create',
    result: 'success',
    entityType: 'manual_hotel_booking',
    entityId: result.booking.id,
    metadata: {
      companyId: result.booking.empresa_id,
      employeeId: result.booking.funcionario_id,
      hotelId: result.booking.hotel_id,
      amount: result.booking.valor_total,
    },
  })
  return result
}

async function bootstrapLegacyBookings(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<LegacyBootstrapResult> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'emissions')
  if (domainRolloutIsFullyRelational(rollout)) return { unresolved: [], migratedCount: 0 }
  await client.query(
    'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [principal.tenantId, STORAGE_KEY],
  )
  const storage = await client.query<{ value: unknown }>(
    `select value
     from app_kv
     where tenant_id = $1 and key = $2
     for update`,
    [principal.tenantId, STORAGE_KEY],
  )
  const legacyItems = Array.isArray(storage.rows[0]?.value)
    ? storage.rows[0].value as unknown[]
    : []
  if (!legacyItems.length) return { unresolved: [], migratedCount: 0 }

  const companies = await client.query<{ id: string }>(
    `select id from companies
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const hotels = await client.query<{ id: string }>(
    `select id from hotels
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const employees = await client.query<{
    id: string
    company_id: string
    full_name: string
  }>(
    `select id, company_id, full_name
     from employees
     where tenant_id = $1 and deleted_at is null`,
    [principal.tenantId],
  )
  const existing = await client.query<{ id: string }>(
    'select id from manual_hotel_bookings where tenant_id = $1',
    [principal.tenantId],
  )
  const companyIds = new Set(companies.rows.map((row) => row.id))
  const hotelIds = new Set(hotels.rows.map((row) => row.id))
  const existingIds = new Set(existing.rows.map((row) => row.id))
  const employeesById = new Map(employees.rows.map((row) => [row.id, row]))
  const employeesByName = new Map<string, typeof employees.rows>()
  for (const employee of employees.rows) {
    const key = `${employee.company_id}:${normalizeName(employee.full_name)}`
    employeesByName.set(key, [...(employeesByName.get(key) || []), employee])
  }

  const pending: Array<Record<string, unknown>> = []
  const unresolved: unknown[] = []
  for (const value of legacyItems) {
    const booking = normalizeLegacyManualHotelBooking(value)
    if (
      !booking
      || !companyIds.has(booking.empresa_id)
      || !hotelIds.has(String(booking.hotel_id))
    ) {
      unresolved.push(value)
      continue
    }
    if (existingIds.has(booking.id)) continue

    const explicitEmployee = booking.funcionario_id
      ? employeesById.get(booking.funcionario_id)
      : null
    const exactMatches = employeesByName.get(
      `${booking.empresa_id}:${normalizeName(booking.funcionario_nome)}`,
    ) || []
    const matchedEmployee = explicitEmployee?.company_id === booking.empresa_id
      ? explicitEmployee
      : exactMatches.length === 1
        ? exactMatches[0]
        : null
    pending.push({
      id: booking.id,
      company_id: booking.empresa_id,
      employee_id: matchedEmployee?.id || null,
      hotel_id: String(booking.hotel_id),
      passenger_name_snapshot: matchedEmployee?.full_name || booking.funcionario_nome,
      identity_status: matchedEmployee ? 'matched' : 'legacy_unresolved',
      checkin_date: booking.data_checkin,
      checkout_date: booking.data_checkout,
      total_amount: booking.valor_total,
      observations: booking.observacoes,
      metadata: {
        source: 'legacy_app_kv',
        legacySnapshot: booking,
      },
      created_at: booking.created_at,
      updated_at: booking.updated_at || booking.created_at,
    })
    existingIds.add(booking.id)
  }

  if (pending.length) {
    await client.query(
      `with input as (
         select *
         from jsonb_to_recordset($2::jsonb) as item(
           id text,
           company_id text,
           employee_id text,
           hotel_id text,
           passenger_name_snapshot text,
           identity_status text,
           checkin_date date,
           checkout_date date,
           total_amount numeric,
           observations text,
           metadata jsonb,
           created_at timestamptz,
           updated_at timestamptz
         )
       )
       insert into manual_hotel_bookings (
         id, tenant_id, company_id, employee_id, hotel_id,
         passenger_name_snapshot, identity_status, status,
         checkin_date, checkout_date, total_amount, currency,
         observations, metadata, created_by, updated_by,
         created_at, updated_at
       )
       select
         input.id, $1, input.company_id, input.employee_id, input.hotel_id,
         input.passenger_name_snapshot, input.identity_status, 'recorded',
         input.checkin_date, input.checkout_date, input.total_amount, 'BRL',
         input.observations, input.metadata, $3, $3,
         input.created_at, input.updated_at
       from input
       on conflict do nothing`,
      [principal.tenantId, JSON.stringify(pending), principal.user.id],
    )
  }
  return { unresolved, migratedCount: pending.length }
}

async function syncCompatibilityProjection(
  client: PoolClient,
  principal: RequestPrincipal,
  unresolved: unknown[],
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, principal.tenantId, 'emissions')
  if (domainRolloutIsFullyRelational(rollout)) return
  const rows = await client.query<ManualHotelBookingRow>(
    `select *
     from manual_hotel_bookings
     where tenant_id = $1 and deleted_at is null
     order by created_at desc`,
    [principal.tenantId],
  )
  const relational = rows.rows.map(mapBookingRow)
  const relationalIds = new Set(relational.map((booking) => booking.id))
  const preserved = unresolved.filter((value) => {
    const booking = normalizeLegacyManualHotelBooking(value)
    return !booking || !relationalIds.has(booking.id)
  })
  await client.query(
    `insert into app_kv (
       tenant_id, key, value, version, updated_by, updated_at
     ) values ($1, $2, $3::jsonb, 1, $4, now())
     on conflict (tenant_id, key) do update set
       value = excluded.value,
       version = app_kv.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [
      principal.tenantId,
      STORAGE_KEY,
      JSON.stringify([...relational, ...preserved]),
      principal.user.id,
    ],
  )
}

async function assertRelationalWriteEnabled(
  client: PoolClient,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const rollout = await getDomainRolloutInTransaction(client, tenantId, 'emissions')
  if (
    !domainRolloutAppliesToCompany(rollout, companyId)
    || rollout.writeMode === 'legacy'
  ) {
    throw new ManualHotelBookingError(
      'MANUAL_HOTEL_RELATIONAL_WRITE_DISABLED',
      'A gravacao relacional de hospedagens ainda nao esta habilitada para esta empresa.',
      409,
    )
  }
}

function mapBookingRow(row: ManualHotelBookingRow): Emissao {
  const hotelId = Number(row.hotel_id)
  return manualHotelBookingSchema.parse({
    id: row.id,
    hotel_id: hotelId,
    empresa_id: row.company_id,
    funcionario_id: row.employee_id,
    funcionario_nome: row.passenger_name_snapshot,
    data_checkin: dateOnly(row.checkin_date),
    data_checkout: dateOnly(row.checkout_date),
    valor_total: Number(row.total_amount),
    observacoes: row.observations || '',
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    version: Number(row.version),
  }) as Emissao
}

function manualHotelBookingCompanyIds(
  principal: RequestPrincipal,
  permission: 'ver_emissoes' | 'operar_emissoes',
): string[] {
  return principal.corporateAccess?.companies
    .filter((company) => company.permissions[permission])
    .map((company) => company.companyId)
    || getAccessibleCompanyIds(principal)
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = String(value || '').trim()
  if (normalized.length < 8 || normalized.length > 200) {
    throw new ManualHotelBookingError(
      'MANUAL_HOTEL_IDEMPOTENCY_KEY_INVALID',
      'A chave de idempotencia deve ter entre 8 e 200 caracteres.',
      400,
    )
  }
  return normalized
}

function normalizeName(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

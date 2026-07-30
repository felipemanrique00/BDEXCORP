import 'server-only'

import type { PoolClient } from 'pg'

import { getAccessibleCompanyIds } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type {
  TravelerPortalOverview,
  TravelerProfile,
  TravelerReservation,
  TravelerSupportContact,
  TravelerTrip,
  TravelerTripUpdate,
  TravelerVoucher,
} from '@/lib/traveler/types'

interface EmployeeRow {
  id: string
  identification_code: string
  full_name: string
  document_number: string | null
  email: string | null
  phone: string | null
  job_title: string | null
  department: string | null
  cost_center: string | null
  company_id: string
  company_name: string
  requester_match: boolean
}

interface DemandRow {
  id: string
  demand_number: string
  company_id: string
  company_name: string
  destination: string | null
  travel_start_date: string | Date | null
  travel_end_date: string | Date | null
  status: string
  service_type: string
  updated_at: Date
}

interface ReservationRow {
  id: string
  demand_id: string | null
  company_id: string
  company_name: string
  provider: string
  provider_reference: string | null
  status: string
  service_type: string
  start_at: Date | null
  end_at: Date | null
  metadata: Record<string, unknown> | null
  updated_at: Date
}

interface VoucherRow {
  id: string
  demand_id: string | null
  reservation_id: string | null
  company_id: string
  company_name: string
  voucher_code: string
  status: string
  file_id: string | null
  issued_at: Date | null
}

interface EventRow {
  id: string
  demand_id: string
  event_type: string
  from_status: string | null
  to_status: string | null
  created_at: Date
}

interface SupportRow {
  tenant_name: string
  tenant_settings: Record<string, unknown> | null
  contact_email: string | null
  contact_phone: string | null
}

export async function getTravelerPortalOverview(
  principal: RequestPrincipal,
): Promise<TravelerPortalOverview> {
  const companyIds = getAccessibleCompanyIds(principal)
  if (!companyIds.length) return emptyOverview()

  return withTenantTransaction(principal.tenantId, async (client) => {
    const employees = await loadTravelerEmployees(client, principal, companyIds)
    const profiles = employees.map(toProfile)
    const support = await loadSupportContact(client, principal.tenantId, companyIds)
    if (!employees.length) {
      return {
        generatedAt: new Date().toISOString(),
        identitySource: 'unlinked',
        profiles: [],
        upcomingTrips: [],
        pastTrips: [],
        support,
      }
    }

    const employeeIds = employees.map((employee) => employee.id)
    const demands = await loadDemands(client, principal.tenantId, companyIds, employeeIds)
    const demandIds = demands.map((demand) => demand.id)
    const reservations = await loadReservations(
      client,
      principal.tenantId,
      companyIds,
      employeeIds,
      demandIds,
    )
    const reservationIds = reservations.map((reservation) => reservation.id)
    const vouchers = await loadVouchers(
      client,
      principal.tenantId,
      companyIds,
      employeeIds,
      demandIds,
      reservationIds,
    )
    const events = await loadEvents(client, principal.tenantId, demandIds)
    const trips = assembleTrips(demands, reservations, vouchers, events)
    const upcomingTrips = trips.filter(isUpcomingTrip)
    const pastTrips = trips.filter((trip) => !isUpcomingTrip(trip))

    return {
      generatedAt: new Date().toISOString(),
      identitySource: employees.some((employee) => employee.requester_match)
        ? 'requester'
        : 'verified_email',
      profiles,
      upcomingTrips: sortUpcoming(upcomingTrips),
      pastTrips: sortPast(pastTrips),
      support,
    }
  })
}

export async function getTravelerVoucherFileId(
  principal: RequestPrincipal,
  voucherId: string,
): Promise<string | null> {
  const companyIds = getAccessibleCompanyIds(principal)
  if (!companyIds.length) return null

  return withTenantTransaction(principal.tenantId, async (client) => {
    const employees = await loadTravelerEmployees(client, principal, companyIds)
    if (!employees.length) return null
    const result = await client.query<{ file_id: string | null }>(
      `select v.file_id
       from vouchers v
       left join reservations r
         on r.tenant_id = v.tenant_id and r.id = v.reservation_id
       left join demands d
         on d.tenant_id = v.tenant_id and d.id = v.demand_id
       where v.tenant_id = $1
         and v.id = $2
         and v.company_id = any($3::text[])
         and v.deleted_at is null
         and coalesce(v.employee_id, r.employee_id, d.employee_id) = any($4::text[])
       limit 1`,
      [
        principal.tenantId,
        voucherId,
        companyIds,
        employees.map((employee) => employee.id),
      ],
    )
    return result.rows[0]?.file_id || null
  })
}

async function loadTravelerEmployees(
  client: PoolClient,
  principal: RequestPrincipal,
  companyIds: string[],
): Promise<EmployeeRow[]> {
  const linked = await client.query<EmployeeRow>(
    `select distinct
       e.id,
       e.identification_code,
       e.full_name,
       e.document_number,
       e.email::text,
       e.phone,
       e.job_title,
       e.department,
       e.cost_center,
       e.company_id,
       coalesce(c.trade_name, c.legal_name) as company_name,
       true as requester_match
     from employees e
     join companies c
       on c.tenant_id = e.tenant_id and c.id = e.company_id
     join requesters requester
       on requester.tenant_id = e.tenant_id
      and requester.employee_id = e.id
      and requester.user_id = $2
      and requester.status = 'active'
      and requester.deleted_at is null
     where e.tenant_id = $1
       and e.company_id = any($3::text[])
       and e.status = 'active'
       and e.deleted_at is null
     order by e.full_name, e.company_id`,
    [principal.tenantId, principal.user.id, companyIds],
  )
  if (linked.rows.length) return linked.rows

  const verifiedEmail = await client.query<EmployeeRow>(
    `select
       e.id,
       e.identification_code,
       e.full_name,
       e.document_number,
       e.email::text,
       e.phone,
       e.job_title,
       e.department,
       e.cost_center,
       e.company_id,
       coalesce(c.trade_name, c.legal_name) as company_name,
       false as requester_match
     from employees e
     join companies c
       on c.tenant_id = e.tenant_id and c.id = e.company_id
     join users u
       on u.id = $2
      and u.email_verified_at is not null
      and lower(u.email::text) = lower($4)
     where e.tenant_id = $1
       and e.company_id = any($3::text[])
       and e.status = 'active'
       and e.deleted_at is null
       and e.email is not null
       and lower(e.email::text) = lower($4)
     order by e.full_name, e.company_id`,
    [principal.tenantId, principal.user.id, companyIds, principal.user.email],
  )

  // Shared mailboxes are not a safe identity proof. An administrator must link
  // ambiguous records explicitly through the requester directory.
  return verifiedEmail.rows.length === 1 ? verifiedEmail.rows : []
}

async function loadDemands(
  client: PoolClient,
  tenantId: string,
  companyIds: string[],
  employeeIds: string[],
): Promise<DemandRow[]> {
  const result = await client.query<DemandRow>(
    `select
       d.id,
       d.demand_number,
       d.company_id,
       coalesce(c.trade_name, c.legal_name) as company_name,
       d.destination,
       d.travel_start_date,
       d.travel_end_date,
       d.status,
       d.service_type,
       d.updated_at
     from demands d
     join companies c on c.tenant_id = d.tenant_id and c.id = d.company_id
     where d.tenant_id = $1
       and d.company_id = any($2::text[])
       and d.employee_id = any($3::text[])
       and d.deleted_at is null
     order by coalesce(d.travel_start_date, d.created_at::date) desc, d.updated_at desc
     limit 200`,
    [tenantId, companyIds, employeeIds],
  )
  return result.rows
}

async function loadReservations(
  client: PoolClient,
  tenantId: string,
  companyIds: string[],
  employeeIds: string[],
  demandIds: string[],
): Promise<ReservationRow[]> {
  const result = await client.query<ReservationRow>(
    `select
       r.id,
       r.demand_id,
       r.company_id,
       coalesce(c.trade_name, c.legal_name) as company_name,
       r.provider,
       r.provider_reference,
       r.status,
       r.service_type,
       r.start_at,
       r.end_at,
       r.metadata,
       r.updated_at
     from reservations r
     join companies c on c.tenant_id = r.tenant_id and c.id = r.company_id
      where r.tenant_id = $1
        and r.company_id = any($2::text[])
        and (
         r.employee_id = any($3::text[])
         or (cardinality($4::text[]) > 0 and r.demand_id = any($4::text[]))
       )
     order by coalesce(r.start_at, r.created_at) desc
     limit 300`,
    [tenantId, companyIds, employeeIds, demandIds],
  )
  return result.rows
}

async function loadVouchers(
  client: PoolClient,
  tenantId: string,
  companyIds: string[],
  employeeIds: string[],
  demandIds: string[],
  reservationIds: string[],
): Promise<VoucherRow[]> {
  const result = await client.query<VoucherRow>(
    `select
       v.id,
       v.demand_id,
       v.reservation_id,
       v.company_id,
       coalesce(c.trade_name, c.legal_name) as company_name,
       v.voucher_code,
       v.status,
       v.file_id,
       v.issued_at
     from vouchers v
     join companies c on c.tenant_id = v.tenant_id and c.id = v.company_id
     where v.tenant_id = $1
       and v.company_id = any($2::text[])
       and v.deleted_at is null
       and (
         v.employee_id = any($3::text[])
         or (cardinality($4::text[]) > 0 and v.demand_id = any($4::text[]))
         or (cardinality($5::text[]) > 0 and v.reservation_id = any($5::text[]))
       )
     order by coalesce(v.issued_at, v.created_at) desc
     limit 300`,
    [tenantId, companyIds, employeeIds, demandIds, reservationIds],
  )
  return result.rows
}

async function loadEvents(
  client: PoolClient,
  tenantId: string,
  demandIds: string[],
): Promise<EventRow[]> {
  if (!demandIds.length) return []
  const result = await client.query<EventRow>(
    `select id::text, demand_id, event_type, from_status, to_status, created_at
     from demand_events
     where tenant_id = $1 and demand_id = any($2::text[])
     order by created_at desc
     limit 500`,
    [tenantId, demandIds],
  )
  return result.rows
}

async function loadSupportContact(
  client: PoolClient,
  tenantId: string,
  companyIds: string[],
): Promise<TravelerSupportContact> {
  const result = await client.query<SupportRow>(
    `select
       t.name as tenant_name,
       t.settings as tenant_settings,
       min(c.contact_email::text) filter (where c.contact_email is not null) as contact_email,
       min(c.contact_phone) filter (where c.contact_phone is not null) as contact_phone
     from tenants t
     left join companies c
       on c.tenant_id = t.id and c.id = any($2::text[])
     where t.id = $1
     group by t.id`,
    [tenantId, companyIds],
  )
  const row = result.rows[0]
  const metadata = asRecord(row?.tenant_settings)
  return {
    label: textValue(metadata.supportLabel) || row?.tenant_name || 'Suporte corporativo',
    phone: phoneValue(metadata.supportPhone) || row?.contact_phone || null,
    email: emailValue(metadata.supportEmail) || row?.contact_email || null,
    emergencyPhone: phoneValue(metadata.emergencyPhone) || phoneValue(metadata.supportPhone) || row?.contact_phone || null,
  }
}

function assembleTrips(
  demands: DemandRow[],
  reservations: ReservationRow[],
  vouchers: VoucherRow[],
  events: EventRow[],
): TravelerTrip[] {
  const trips = new Map<string, TravelerTrip>()
  for (const demand of demands) {
    trips.set(`demand:${demand.id}`, {
      id: `demand:${demand.id}`,
      demandId: demand.id,
      demandNumber: demand.demand_number,
      companyId: demand.company_id,
      companyName: demand.company_name,
      destination: demand.destination,
      startDate: dateOnly(demand.travel_start_date),
      endDate: dateOnly(demand.travel_end_date),
      status: demand.status,
      serviceType: demand.service_type,
      reservations: [],
      vouchers: [],
      updates: [],
      updatedAt: demand.updated_at.toISOString(),
    })
  }

  for (const reservation of reservations) {
    const key = reservation.demand_id && trips.has(`demand:${reservation.demand_id}`)
      ? `demand:${reservation.demand_id}`
      : `reservation:${reservation.id}`
    const trip = trips.get(key) || {
      id: key,
      demandId: reservation.demand_id,
      demandNumber: null,
      companyId: reservation.company_id,
      companyName: reservation.company_name,
      destination: metadataText(reservation.metadata, ['destination', 'destino', 'city', 'cidade']),
      startDate: dateOnly(reservation.start_at),
      endDate: dateOnly(reservation.end_at),
      status: reservation.status,
      serviceType: reservation.service_type,
      reservations: [],
      vouchers: [],
      updates: [],
      updatedAt: reservation.updated_at.toISOString(),
    }
    trip.reservations.push(toReservation(reservation))
    trip.startDate ||= dateOnly(reservation.start_at)
    trip.endDate ||= dateOnly(reservation.end_at)
    trip.destination ||= metadataText(reservation.metadata, ['destination', 'destino', 'city', 'cidade'])
    if (reservation.updated_at.toISOString() > trip.updatedAt) trip.updatedAt = reservation.updated_at.toISOString()
    trips.set(key, trip)
  }

  for (const voucher of vouchers) {
    const key = voucher.demand_id && trips.has(`demand:${voucher.demand_id}`)
      ? `demand:${voucher.demand_id}`
      : voucher.reservation_id && trips.has(`reservation:${voucher.reservation_id}`)
        ? `reservation:${voucher.reservation_id}`
        : `voucher:${voucher.id}`
    const trip = trips.get(key) || {
      id: key,
      demandId: voucher.demand_id,
      demandNumber: null,
      companyId: voucher.company_id,
      companyName: voucher.company_name,
      destination: null,
      startDate: dateOnly(voucher.issued_at),
      endDate: dateOnly(voucher.issued_at),
      status: voucher.status,
      serviceType: 'voucher',
      reservations: [],
      vouchers: [],
      updates: [],
      updatedAt: voucher.issued_at?.toISOString() || new Date(0).toISOString(),
    }
    trip.vouchers.push(toVoucher(voucher))
    trips.set(key, trip)
  }

  for (const event of events) {
    const trip = trips.get(`demand:${event.demand_id}`)
    if (!trip || trip.updates.length >= 8) continue
    trip.updates.push(toUpdate(event))
  }
  return [...trips.values()]
}

function toProfile(row: EmployeeRow): TravelerProfile {
  return {
    id: row.id,
    identificationCode: row.identification_code,
    name: row.full_name,
    documentMasked: maskDocument(row.document_number),
    email: row.email,
    phone: row.phone,
    jobTitle: row.job_title,
    department: row.department,
    costCenter: row.cost_center,
    companyId: row.company_id,
    companyName: row.company_name,
  }
}

function toReservation(row: ReservationRow): TravelerReservation {
  return {
    id: row.id,
    serviceType: row.service_type,
    provider: row.provider,
    reference: row.provider_reference,
    status: row.status,
    startAt: row.start_at?.toISOString() || null,
    endAt: row.end_at?.toISOString() || null,
    origin: metadataText(row.metadata, ['origin', 'origem']),
    destination: metadataText(row.metadata, ['destination', 'destino', 'city', 'cidade']),
    flightNumber: metadataText(row.metadata, ['flightNumber', 'flight_number', 'numeroVoo', 'numero_voo', 'voo']),
    terminal: metadataText(row.metadata, ['terminal']),
    gate: metadataText(row.metadata, ['gate', 'portao']),
    hotelName: metadataText(row.metadata, ['hotelName', 'hotel_name', 'hotel_nome', 'hotel']),
    address: metadataText(row.metadata, ['address', 'endereco']),
    checkInUrl: safeHttpsUrl(metadataText(row.metadata, ['checkInUrl', 'check_in_url', 'checkin_url'])),
  }
}

function toVoucher(row: VoucherRow): TravelerVoucher {
  return {
    id: row.id,
    code: row.voucher_code,
    status: row.status,
    issuedAt: row.issued_at?.toISOString() || null,
    hasFile: Boolean(row.file_id),
    downloadUrl: row.file_id ? `/api/traveler/vouchers/${encodeURIComponent(row.id)}/download` : null,
  }
}

function toUpdate(row: EventRow): TravelerTripUpdate {
  return {
    id: row.id,
    type: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    createdAt: row.created_at.toISOString(),
  }
}

function isUpcomingTrip(trip: TravelerTrip): boolean {
  if (/cancel/i.test(trip.status)) return false
  const end = trip.endDate || trip.startDate
  if (!end) return !/final|conclu|encerr|cancel/i.test(trip.status)
  const yesterday = new Date()
  yesterday.setHours(0, 0, 0, 0)
  yesterday.setDate(yesterday.getDate() - 1)
  return new Date(`${end.slice(0, 10)}T23:59:59`).getTime() >= yesterday.getTime()
}

function sortUpcoming(trips: TravelerTrip[]): TravelerTrip[] {
  return [...trips].sort((left, right) =>
    sortableDate(left.startDate, Number.MAX_SAFE_INTEGER) - sortableDate(right.startDate, Number.MAX_SAFE_INTEGER))
}

function sortPast(trips: TravelerTrip[]): TravelerTrip[] {
  return [...trips].sort((left, right) =>
    sortableDate(right.endDate || right.startDate, 0) - sortableDate(left.endDate || left.startDate, 0))
}

function sortableDate(value: string | null, fallback: number): number {
  if (!value) return fallback
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : fallback
}

function dateOnly(value: string | Date | null): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function maskDocument(value: string | null): string | null {
  const digits = value?.replace(/\D/g, '') || ''
  if (digits.length < 5) return value ? '***' : null
  return `${'*'.repeat(Math.max(3, digits.length - 4))}${digits.slice(-4)}`
}

function metadataText(metadata: Record<string, unknown> | null, keys: string[]): string | null {
  const sources = collectMetadataRecords(metadata)
  for (const source of sources) {
    for (const key of keys) {
      const value = textValue(source[key])
      if (value) return value
    }
  }
  return null
}

function collectMetadataRecords(metadata: Record<string, unknown> | null): Record<string, unknown>[] {
  const root = asRecord(metadata)
  return [
    root,
    asRecord(root.details),
    asRecord(root.serviceDetails),
    asRecord(root.air),
    asRecord(root.hotel),
    asRecord(asRecord(root.serviceDetails).air),
    asRecord(asRecord(root.serviceDetails).hotel),
  ]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null
}

function phoneValue(value: unknown): string | null {
  const text = textValue(value)
  return text && /^[+()\d\s.-]{6,30}$/.test(text) ? text : null
}

function emailValue(value: unknown): string | null {
  const text = textValue(value)
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null
}

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function emptyOverview(): TravelerPortalOverview {
  return {
    generatedAt: new Date().toISOString(),
    identitySource: 'unlinked',
    profiles: [],
    upcomingTrips: [],
    pastTrips: [],
    support: {
      label: 'Suporte corporativo',
      phone: null,
      email: null,
      emergencyPhone: null,
    },
  }
}

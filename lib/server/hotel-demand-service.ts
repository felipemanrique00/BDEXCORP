import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  hotelDemandDetailsSchema,
  type HotelDemandDetailsInput,
} from '@/lib/hotel-demand/model'
import { hotelDemandPreferredHotelIds } from '@/lib/hotel-demand/preferences'

interface GeographyRow extends QueryResultRow {
  city_name: string
}

interface EmployeeRow extends QueryResultRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

interface ExistingRoomRow extends QueryResultRow {
  id: string
  room_sequence: number
  deleted_at: string | Date | null
  has_dependencies: boolean
}

interface ExistingTravelerRow extends QueryResultRow {
  id: string
  employee_id: string | null
  is_external: boolean
  name_snapshot: string
  email_snapshot: string | null
  room_id: string | null
  slot_index: number | null
  deleted_at: string | Date | null
  has_dependencies: boolean
}

interface RoomAssignment {
  id: string
  sequence: number
}

export interface PersistHotelDemandDetailsInput {
  tenantId: string
  demandId: string
  companyId: string
  actorUserId: string
  details: unknown
}

export interface PersistedHotelDemandDetails {
  details: HotelDemandDetailsInput
  canonicalCityName: string
  roomIds: string[]
  travelerIds: string[]
}

export class HotelDemandServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'HotelDemandServiceError'
  }
}

export async function hasPersistedHotelDemandDetailsInTransaction(
  client: PoolClient,
  tenantId: string,
  demandId: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1 from hotel_demand_details where tenant_id = $1 and demand_id = $2`,
    [tenantId, demandId],
  )
  return Boolean(result.rows[0])
}

/**
 * Sincroniza a parte relacional da necessidade hoteleira dentro da mesma
 * transacao usada pela demanda. IDs ja usados por cotacoes e vouchers sao
 * preservados; registros removidos sao inativados, nao apagados.
 */
export async function persistHotelDemandDetailsInTransaction(
  client: PoolClient,
  input: PersistHotelDemandDetailsInput,
): Promise<PersistedHotelDemandDetails> {
  const details = hotelDemandDetailsSchema.parse(input.details)
  await requireDemandScope(client, input)
  const canonicalCityName = await requireGeography(client, details)
  const preferredHotelIds = hotelDemandPreferredHotelIds(details)
  await requirePreferredHotels(client, input.tenantId, details.city_id, preferredHotelIds)
  const employees = await loadEmployees(client, input, details)

  await client.query(
    `insert into hotel_demand_details (
       tenant_id, demand_id, country_id, subdivision_id, city_id,
       preferred_hotel_id, check_in, check_out, purpose,
       accessibility_notes, preferences, needs_review, created_by, updated_by
     ) values (
       $1, $2, $3::uuid, $4::uuid, $5::uuid,
       $6, $7::date, $8::date, $9, $10, $11::jsonb, $12, $13, $13
     )
     on conflict (tenant_id, demand_id) do update set
       country_id = excluded.country_id,
       subdivision_id = excluded.subdivision_id,
       city_id = excluded.city_id,
       preferred_hotel_id = excluded.preferred_hotel_id,
       check_in = excluded.check_in,
       check_out = excluded.check_out,
       purpose = excluded.purpose,
       accessibility_notes = excluded.accessibility_notes,
       preferences = excluded.preferences,
       needs_review = excluded.needs_review,
       version = hotel_demand_details.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [
      input.tenantId,
      input.demandId,
      details.country_id,
      details.subdivision_id,
      details.city_id,
      preferredHotelIds[0] || null,
      details.data_checkin,
      details.data_checkout,
      details.purpose || null,
      details.accessibility_notes || null,
      JSON.stringify(details.preferences || {}),
      details.needs_review,
      input.actorUserId,
    ],
  )

  await syncPreferredHotels(client, input, preferredHotelIds)

  const existingRooms = await loadExistingRooms(client, input)
  const existingTravelers = await loadExistingTravelers(client, input)

  await client.query(
    `delete from hotel_demand_room_guests where tenant_id = $1 and demand_id = $2`,
    [input.tenantId, input.demandId],
  )
  await client.query(
    `update demand_travelers set
       is_primary = false,
       deleted_at = coalesce(deleted_at, now()),
       updated_by = $3,
       updated_at = now()
     where tenant_id = $1 and demand_id = $2`,
    [input.tenantId, input.demandId, input.actorUserId],
  )

  const roomAssignments = await syncRooms(client, input, details, existingRooms)
  const travelerIds = await syncTravelers(
    client,
    input,
    details,
    roomAssignments,
    existingTravelers,
    employees,
  )

  return {
    details,
    canonicalCityName,
    roomIds: roomAssignments.map((room) => room.id),
    travelerIds,
  }
}

async function requireDemandScope(
  client: PoolClient,
  input: Pick<PersistHotelDemandDetailsInput, 'tenantId' | 'demandId' | 'companyId'>,
): Promise<void> {
  const result = await client.query(
    `select 1
     from demands
     where tenant_id = $1 and id = $2 and company_id = $3 and deleted_at is null`,
    [input.tenantId, input.demandId, input.companyId],
  )
  if (!result.rows[0]) {
    throw new HotelDemandServiceError(
      'HOTEL_DEMAND_SCOPE_MISMATCH',
      'A demanda hoteleira nao pertence a empresa informada.',
      409,
    )
  }
}

async function requireGeography(
  client: PoolClient,
  details: HotelDemandDetailsInput,
): Promise<string> {
  const result = await client.query<GeographyRow>(
    `select city.name as city_name
     from geo_countries country
     join geo_subdivisions subdivision
       on subdivision.id = $2::uuid
      and subdivision.country_id = country.id
      and subdivision.is_active
     join geo_cities city
       on city.id = $3::uuid
      and city.country_id = country.id
      and city.subdivision_id = subdivision.id
      and city.is_active
     where country.id = $1::uuid and country.is_active`,
    [details.country_id, details.subdivision_id, details.city_id],
  )
  if (!result.rows[0]) {
    throw new HotelDemandServiceError(
      'HOTEL_DEMAND_GEOGRAPHY_INVALID',
      'Pais, estado e cidade devem formar uma localidade ativa do catalogo geografico.',
    )
  }
  return result.rows[0].city_name
}

async function requirePreferredHotels(
  client: PoolClient,
  tenantId: string,
  cityId: string,
  preferredHotelIds: readonly string[],
): Promise<void> {
  if (!preferredHotelIds.length) return
  const result = await client.query<{ id: string }>(
    `select hotel.id
     from hotels hotel
     where hotel.tenant_id = $1 and hotel.id = any($2::text[]) and hotel.city_id = $3::uuid
       and hotel.status = 'active' and hotel.deleted_at is null
       and exists (
         select 1
         from hotel_suppliers link
         join commercial_suppliers supplier
           on supplier.tenant_id = link.tenant_id
          and supplier.id = link.supplier_id
         where link.tenant_id = hotel.tenant_id
           and link.hotel_id = hotel.id
           and link.is_active
           and link.ended_at is null
           and supplier.status = 'active'
           and supplier.deleted_at is null
           and supplier.service_types @> array['hotel']::text[]
       )`,
    [tenantId, preferredHotelIds, cityId],
  )
  const validIds = new Set(result.rows.map((row) => row.id))
  const invalidIds = preferredHotelIds.filter((id) => !validIds.has(id))
  if (invalidIds.length) {
    throw new HotelDemandServiceError(
      'HOTEL_DEMAND_PREFERRED_HOTEL_INVALID',
      'Todos os hoteis preferenciais devem estar ativos, cotaveis e pertencer a cidade escolhida.',
      422,
      { hotelIds: invalidIds },
    )
  }
}

async function syncPreferredHotels(
  client: PoolClient,
  input: Pick<PersistHotelDemandDetailsInput, 'tenantId' | 'demandId' | 'actorUserId'>,
  preferredHotelIds: readonly string[],
): Promise<void> {
  await client.query(
    `delete from hotel_demand_preferred_hotels
     where tenant_id = $1 and demand_id = $2`,
    [input.tenantId, input.demandId],
  )
  for (let index = 0; index < preferredHotelIds.length; index += 1) {
    await client.query(
      `insert into hotel_demand_preferred_hotels (
         tenant_id, demand_id, hotel_id, preference_order, created_by
       ) values ($1, $2, $3, $4, $5)`,
      [input.tenantId, input.demandId, preferredHotelIds[index], index + 1, input.actorUserId],
    )
  }
}

async function loadEmployees(
  client: PoolClient,
  input: Pick<PersistHotelDemandDetailsInput, 'tenantId' | 'companyId'>,
  details: HotelDemandDetailsInput,
): Promise<Map<string, EmployeeRow>> {
  const employeeIds = Array.from(new Set(details.rooms.flatMap((room) => (
    room.guests.flatMap((guest) => guest.employee_id ? [guest.employee_id] : [])
  ))))
  if (!employeeIds.length) return new Map()
  const result = await client.query<EmployeeRow>(
    `select id, full_name, email::text, phone
     from employees
     where tenant_id = $1 and company_id = $2 and id = any($3::text[])
       and status = 'active' and deleted_at is null`,
    [input.tenantId, input.companyId, employeeIds],
  )
  const employees = new Map(result.rows.map((row) => [row.id, row]))
  const missingIds = employeeIds.filter((id) => !employees.has(id))
  if (missingIds.length) {
    throw new HotelDemandServiceError(
      'HOTEL_DEMAND_TRAVELER_INVALID',
      'Um ou mais hospedes nao estao ativos na base de viajantes da empresa.',
      422,
      { employeeIds: missingIds },
    )
  }
  return employees
}

async function loadExistingRooms(
  client: PoolClient,
  input: Pick<PersistHotelDemandDetailsInput, 'tenantId' | 'demandId'>,
): Promise<ExistingRoomRow[]> {
  const result = await client.query<ExistingRoomRow>(
    `select room.id, room.room_sequence, room.deleted_at,
            exists (
              select 1 from hotel_quote_room_rates rate
              where rate.tenant_id = room.tenant_id and rate.demand_room_id = room.id
            ) as has_dependencies
     from hotel_demand_rooms room
     where room.tenant_id = $1 and room.demand_id = $2
     order by room.room_sequence
     for update of room`,
    [input.tenantId, input.demandId],
  )
  return result.rows
}

async function loadExistingTravelers(
  client: PoolClient,
  input: Pick<PersistHotelDemandDetailsInput, 'tenantId' | 'demandId'>,
): Promise<ExistingTravelerRow[]> {
  const result = await client.query<ExistingTravelerRow>(
    `select traveler.id, traveler.employee_id, traveler.is_external,
            traveler.name_snapshot, traveler.email_snapshot::text,
            guest.room_id, guest.slot_index, traveler.deleted_at,
            false as has_dependencies
     from demand_travelers traveler
     left join hotel_demand_room_guests guest
       on guest.tenant_id = traveler.tenant_id
      and guest.demand_id = traveler.demand_id
      and guest.traveler_id = traveler.id
     where traveler.tenant_id = $1 and traveler.demand_id = $2
     order by (traveler.deleted_at is null) desc, traveler.created_at
     for update of traveler`,
    [input.tenantId, input.demandId],
  )
  return result.rows
}

async function syncRooms(
  client: PoolClient,
  input: PersistHotelDemandDetailsInput,
  details: HotelDemandDetailsInput,
  existingRooms: ExistingRoomRow[],
): Promise<RoomAssignment[]> {
  const existingById = new Map(existingRooms.map((room) => [room.id, room]))
  const claimed = new Set<string>()
  const assignments: Array<RoomAssignment | undefined> = new Array(details.rooms.length)

  details.rooms.forEach((room, index) => {
    const stableId = roomDatabaseId(input, room.client_id)
    const existing = existingById.get(stableId)
      || (isUuid(room.client_id) ? existingById.get(room.client_id) : undefined)
    if (!existing) return
    assignments[index] = { id: existing.id, sequence: Number(existing.room_sequence) }
    claimed.add(existing.id)
  })

  for (let index = 0; index < details.rooms.length; index += 1) {
    if (assignments[index]) continue
    const requested = details.rooms[index]
    const sameSequence = existingRooms.find((room) => (
      !claimed.has(room.id)
      && Number(room.room_sequence) === index + 1
      && !room.has_dependencies
    ))
    const reusable = sameSequence || existingRooms.find((room) => (
      !claimed.has(room.id) && !room.has_dependencies
    ))
    if (reusable) {
      assignments[index] = { id: reusable.id, sequence: Number(reusable.room_sequence) }
      claimed.add(reusable.id)
      continue
    }

    const occupiedSequences = new Set(existingRooms.map((room) => Number(room.room_sequence)))
    const sequence = firstAvailableSequence(occupiedSequences)
    const id = roomDatabaseId(input, requested.client_id)
    await client.query(
      `insert into hotel_demand_rooms (
         id, tenant_id, demand_id, room_sequence, occupancy_code,
         notes, created_by, updated_by
       ) values ($1::uuid, $2, $3, $4, $5, $6, $7, $7)`,
      [id, input.tenantId, input.demandId, sequence, requested.occupancy_code, requested.notes || null, input.actorUserId],
    )
    const inserted: ExistingRoomRow = {
      id,
      room_sequence: sequence,
      deleted_at: null,
      has_dependencies: false,
    }
    existingRooms.push(inserted)
    existingById.set(id, inserted)
    claimed.add(id)
    assignments[index] = { id, sequence }
  }

  for (let index = 0; index < details.rooms.length; index += 1) {
    const assignment = assignments[index]
    if (!assignment) {
      throw new HotelDemandServiceError('HOTEL_DEMAND_ROOM_SYNC_FAILED', 'Nao foi possivel sincronizar os quartos.', 409)
    }
    const room = details.rooms[index]
    if (existingById.has(assignment.id)) {
      await client.query(
        `update hotel_demand_rooms set
           occupancy_code = $4,
           notes = $5,
           deleted_at = null,
           version = version + 1,
           updated_by = $6,
           updated_at = now()
         where tenant_id = $1 and demand_id = $2 and id = $3::uuid`,
        [input.tenantId, input.demandId, assignment.id, room.occupancy_code, room.notes || null, input.actorUserId],
      )
    }
  }

  const inactiveIds = existingRooms.filter((room) => !claimed.has(room.id)).map((room) => room.id)
  if (inactiveIds.length) {
    await client.query(
      `update hotel_demand_rooms set
         deleted_at = coalesce(deleted_at, now()),
         version = version + 1,
         updated_by = $3,
         updated_at = now()
       where tenant_id = $1 and demand_id = $2 and id = any($4::uuid[])`,
      [input.tenantId, input.demandId, input.actorUserId, inactiveIds],
    )
  }

  return assignments as RoomAssignment[]
}

async function syncTravelers(
  client: PoolClient,
  input: PersistHotelDemandDetailsInput,
  details: HotelDemandDetailsInput,
  roomAssignments: RoomAssignment[],
  existingTravelers: ExistingTravelerRow[],
  employees: Map<string, EmployeeRow>,
): Promise<string[]> {
  const claimed = new Set<string>()
  const travelerIds: string[] = []
  let primaryAssigned = false

  for (let roomIndex = 0; roomIndex < details.rooms.length; roomIndex += 1) {
    const room = details.rooms[roomIndex]
    const roomId = roomAssignments[roomIndex].id
    for (const guest of room.guests) {
      const employee = guest.employee_id ? employees.get(guest.employee_id) : undefined
      const canonicalName = employee?.full_name || guest.name
      const canonicalEmail = employee?.email || guest.email || null
      const canonicalPhone = employee?.phone || guest.phone || null
      const mapped = existingTravelers.find((traveler) => (
        !claimed.has(traveler.id)
        && traveler.room_id === roomId
        && Number(traveler.slot_index) === guest.slot_index
        && (guest.employee_id
          ? traveler.employee_id === guest.employee_id
          : traveler.is_external && externalIdentityUnchanged(traveler, canonicalName, canonicalEmail))
      ))
      const byEmployee = guest.employee_id
        ? existingTravelers.find((traveler) => !claimed.has(traveler.id) && traveler.employee_id === guest.employee_id)
        : undefined
      const reusableExternal = guest.is_external
        ? existingTravelers.find((traveler) => (
            !claimed.has(traveler.id) && traveler.is_external && !traveler.has_dependencies
          ))
        : undefined
      const existing = mapped || byEmployee || reusableExternal
      const travelerId = existing?.id || randomUUID()
      const isPrimary = !primaryAssigned && guest.role === 'responsible'
      if (isPrimary) primaryAssigned = true
      claimed.add(travelerId)

      if (existing) {
        await client.query(
          `update demand_travelers set
             company_id = $4,
             employee_id = $5,
             traveler_role = $6,
             is_primary = $7,
             is_external = $8,
             name_snapshot = $9,
             email_snapshot = $10,
             phone_snapshot = $11,
             metadata = coalesce(metadata, '{}'::jsonb) || $12::jsonb,
             deleted_at = null,
             updated_by = $13,
             updated_at = now()
           where tenant_id = $1 and demand_id = $2 and id = $3::uuid`,
          [
            input.tenantId,
            input.demandId,
            travelerId,
            input.companyId,
            guest.employee_id || null,
            guest.role,
            isPrimary,
            guest.is_external,
            canonicalName,
            canonicalEmail,
            canonicalPhone,
            JSON.stringify({ source: 'hotel_demand', roomClientId: room.client_id, slotIndex: guest.slot_index }),
            input.actorUserId,
          ],
        )
      } else {
        await client.query(
          `insert into demand_travelers (
             id, tenant_id, demand_id, company_id, employee_id, traveler_role,
             is_primary, is_external, name_snapshot, email_snapshot, phone_snapshot,
             metadata, created_by, updated_by
           ) values (
             $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $13
           )`,
          [
            travelerId,
            input.tenantId,
            input.demandId,
            input.companyId,
            guest.employee_id || null,
            guest.role,
            isPrimary,
            guest.is_external,
            canonicalName,
            canonicalEmail,
            canonicalPhone,
            JSON.stringify({ source: 'hotel_demand', roomClientId: room.client_id, slotIndex: guest.slot_index }),
            input.actorUserId,
          ],
        )
      }

      await client.query(
        `insert into hotel_demand_room_guests (
           tenant_id, demand_id, room_id, traveler_id, slot_index, created_by
         ) values ($1, $2, $3::uuid, $4::uuid, $5, $6)`,
        [input.tenantId, input.demandId, roomId, travelerId, guest.slot_index, input.actorUserId],
      )
      travelerIds.push(travelerId)
    }
  }

  return travelerIds
}

function firstAvailableSequence(occupied: Set<number>): number {
  for (let sequence = 1; sequence <= 99; sequence += 1) {
    if (!occupied.has(sequence)) return sequence
  }
  throw new HotelDemandServiceError(
    'HOTEL_DEMAND_ROOM_CAPACITY_EXHAUSTED',
    'A demanda atingiu o limite historico de quartos. Crie uma nova demanda.',
    409,
  )
}

function externalIdentityUnchanged(
  traveler: Pick<ExistingTravelerRow, 'name_snapshot' | 'email_snapshot' | 'has_dependencies'>,
  name: string,
  email: string | null,
): boolean {
  if (!traveler.has_dependencies) return true
  return normalizeIdentity(traveler.name_snapshot) === normalizeIdentity(name)
    && normalizeIdentity(traveler.email_snapshot || '') === normalizeIdentity(email || '')
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function roomDatabaseId(
  input: Pick<PersistHotelDemandDetailsInput, 'tenantId' | 'demandId'>,
  clientId: string,
): string {
  const hash = createHash('sha256')
    .update(`${input.tenantId}\u0000${input.demandId}\u0000${clientId}`)
    .digest('hex')
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

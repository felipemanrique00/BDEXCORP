import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import type {
  PortalBusRequestDetails,
  PortalCarRequestDetails,
} from '@/lib/offline-ground/request-model'
import {
  parsePortalBusRequestDetails,
  parsePortalCarRequestDetails,
} from '@/lib/offline-ground/request-model'

export class OfflineGroundDemandServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'OfflineGroundDemandServiceError'
  }
}

interface EmployeeRow extends QueryResultRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

interface ExistingTravelerRow extends QueryResultRow {
  id: string
  employee_id: string | null
}

interface CanonicalRentalLocationRow extends QueryResultRow {
  id: string
  supplier_id: string
  supplier_name: string
  name: string
  city_id: string | null
  city_name: string | null
}

interface CanonicalBusTerminalRow extends QueryResultRow {
  id: string
  city_id: string
  name: string
  city_name: string
}

/**
 * Rebuilds every identity/catalog snapshot used by a corporate ground demand.
 * Dates and travel preferences remain user intent; names, companies, cities
 * and catalog labels always come from the tenant database.
 */
export async function canonicalizePortalGroundDemandInTransaction(
  client: PoolClient,
  input: {
    tenantId: string
    companyId: string
    service: 'car' | 'bus'
    demand: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  if (input.service === 'car') {
    const details = parsePortalCarRequestDetails(asRecord(input.demand.detalhes_carro))
    if (!details) {
      throw new OfflineGroundDemandServiceError(
        'GROUND_CAR_REQUEST_INVALID',
        'Revise os dados da locacao antes de adicionar o servico.',
      )
    }
    const employee = await loadCanonicalEmployees(
      client,
      input.tenantId,
      input.companyId,
      [details.primary_driver.employee_id],
    )
    const pickupId = details.ground.pickupLocationId
    const returnId = details.ground.returnLocationId
    if (!pickupId || !returnId) {
      throw new OfflineGroundDemandServiceError(
        'GROUND_RENTAL_LOCATION_REQUIRED',
        'Selecione lojas aprovadas para retirada e devolucao.',
      )
    }
    const locations = await client.query<CanonicalRentalLocationRow>(
      `select location.id, location.supplier_id,
              coalesce(supplier.trade_name, supplier.legal_name) as supplier_name,
              location.name, location.city_id, city.name as city_name
       from rental_locations location
       join commercial_suppliers supplier
         on supplier.tenant_id = location.tenant_id and supplier.id = location.supplier_id
       left join geo_cities city on city.id = location.city_id
       where location.tenant_id = $1 and location.id = any($2::uuid[])
         and location.status = 'active' and location.deleted_at is null
         and location.review_status = 'verified'
         and supplier.status = 'active' and supplier.deleted_at is null
         and supplier.service_types @> array['car']::text[]`,
      [input.tenantId, [pickupId, returnId]],
    )
    const locationById = new Map(locations.rows.map((location) => [location.id, location]))
    const pickup = locationById.get(pickupId)
    const returning = locationById.get(returnId)
    if (!pickup || !returning) {
      throw new OfflineGroundDemandServiceError(
        'GROUND_RENTAL_LOCATION_NOT_VERIFIED',
        'Uma das lojas escolhidas nao esta ativa e aprovada no catalogo offline.',
      )
    }
    if (pickup.supplier_id !== returning.supplier_id) {
      throw new OfflineGroundDemandServiceError(
        'GROUND_RENTAL_SUPPLIER_MISMATCH',
        'Retirada e devolucao precisam pertencer a mesma locadora.',
      )
    }
    const driver = employee[0]!
    const pickupLabel = rentalLocationLabel(pickup)
    const returnLabel = rentalLocationLabel(returning)
    return {
      ...input.demand,
      funcionario_id: driver.id,
      passageiro_nome: driver.full_name,
      detalhes_carro: {
        ...details,
        ground: {
          ...details.ground,
          pickupLocationText: pickupLabel,
          returnLocationText: returnLabel,
          preferences: {},
        },
        primary_driver: canonicalTraveler(driver),
        pickup_location_name: pickupLabel,
        return_location_name: returnLabel,
        supplier_name: pickup.supplier_name,
        locadora: pickup.supplier_name,
        cidade_retirada: pickup.city_name || undefined,
        data_retirada: details.ground.pickupAt.slice(0, 10),
        data_devolucao: details.ground.returnAt.slice(0, 10),
      },
    }
  }

  const details = parsePortalBusRequestDetails(asRecord(input.demand.detalhes_rodoviario))
  if (!details) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_BUS_REQUEST_INVALID',
      'Revise os dados rodoviarios antes de adicionar o servico.',
    )
  }
  const employees = await loadCanonicalEmployees(
    client,
    input.tenantId,
    input.companyId,
    details.travelers.map((traveler) => traveler.employee_id),
  )
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]))
  const terminalIds = Array.from(new Set(details.ground.legs.flatMap((leg) => [
    leg.originTerminalId,
    leg.destinationTerminalId,
  ].filter((id): id is string => Boolean(id)))))
  if (terminalIds.length < 2 || details.ground.legs.some((leg) => (
    !leg.originTerminalId || !leg.destinationTerminalId
  ))) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_BUS_TERMINALS_REQUIRED',
      'Selecione terminais aprovados de origem e destino para cada trecho.',
    )
  }
  const terminals = await client.query<CanonicalBusTerminalRow>(
    `select terminal.id, terminal.city_id, terminal.name, city.name as city_name
     from bus_terminals terminal
     join geo_cities city on city.id = terminal.city_id
     where terminal.tenant_id = $1 and terminal.id = any($2::uuid[])
       and terminal.status = 'active' and terminal.deleted_at is null
       and terminal.review_status = 'verified'`,
    [input.tenantId, terminalIds],
  )
  const terminalById = new Map(terminals.rows.map((terminal) => [terminal.id, terminal]))
  if (terminalById.size !== terminalIds.length) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_BUS_TERMINAL_NOT_VERIFIED',
      'Um dos terminais escolhidos nao esta ativo e aprovado no catalogo offline.',
    )
  }
  const legSnapshots = details.ground.legs.map((leg) => {
    const origin = terminalById.get(leg.originTerminalId!)!
    const destination = terminalById.get(leg.destinationTerminalId!)!
    if (origin.city_id !== leg.originCityId || destination.city_id !== leg.destinationCityId) {
      throw new OfflineGroundDemandServiceError(
        'GROUND_BUS_TERMINAL_CITY_MISMATCH',
        'O terminal selecionado nao pertence a cidade informada no trecho.',
      )
    }
    return {
      origin_city_name: origin.city_name,
      destination_city_name: destination.city_name,
      origin_terminal_name: origin.name,
      destination_terminal_name: destination.name,
    }
  })
  const travelers = details.travelers.map((traveler) => canonicalTraveler(
    employeeById.get(traveler.employee_id)!,
  ))
  return {
    ...input.demand,
    funcionario_id: travelers[0]!.employee_id,
    passageiro_nome: travelers[0]!.name,
    detalhes_rodoviario: {
      ...details,
      ground: { ...details.ground, preferences: {} },
      travelers,
      leg_snapshots: legSnapshots,
    },
  }
}

export async function hasPersistedGroundDemandDetailsInTransaction(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  service: 'car' | 'bus',
): Promise<boolean> {
  const table = service === 'car' ? 'car_demand_details' : 'bus_demand_details'
  const result = await client.query(
    `select 1 from ${table} where tenant_id = $1 and demand_id = $2 limit 1`,
    [tenantId, demandId],
  )
  return Boolean(result.rowCount)
}

export async function persistGroundDemandDetailsInTransaction(
  client: PoolClient,
  input: {
    tenantId: string
    demandId: string
    companyId: string
    actorUserId: string
    service: 'car'
    details: PortalCarRequestDetails
  } | {
    tenantId: string
    demandId: string
    companyId: string
    actorUserId: string
    service: 'bus'
    details: PortalBusRequestDetails
  },
): Promise<void> {
  await requireDemandScope(client, input)
  if (input.service === 'car') {
    const travelerIds = await synchronizeTravelers(client, input, [input.details.primary_driver])
    await requireVerifiedRentalLocations(client, input, input.details.ground.pickupLocationId, input.details.ground.returnLocationId)
    await client.query(
      `insert into car_demand_details (
         tenant_id, demand_id, pickup_location_id, return_location_id,
         pickup_location_text, return_location_text, pickup_at, return_at,
         primary_driver_traveler_id, desired_category, automatic_transmission,
         air_conditioning, unlimited_mileage, preferences, notes, created_by, updated_by
       ) values (
         $1, $2, $3::uuid, $4::uuid, $5, $6, $7::timestamptz, $8::timestamptz,
         $9::uuid, $10, $11, $12, $13, $14::jsonb, $15, $16, $16
       )
       on conflict (tenant_id, demand_id) do update set
         pickup_location_id = excluded.pickup_location_id,
         return_location_id = excluded.return_location_id,
         pickup_location_text = excluded.pickup_location_text,
         return_location_text = excluded.return_location_text,
         pickup_at = excluded.pickup_at,
         return_at = excluded.return_at,
         primary_driver_traveler_id = excluded.primary_driver_traveler_id,
         desired_category = excluded.desired_category,
         automatic_transmission = excluded.automatic_transmission,
         air_conditioning = excluded.air_conditioning,
         unlimited_mileage = excluded.unlimited_mileage,
         preferences = excluded.preferences,
         notes = excluded.notes,
         version = car_demand_details.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()`,
      [
        input.tenantId,
        input.demandId,
        input.details.ground.pickupLocationId || null,
        input.details.ground.returnLocationId || null,
        input.details.ground.pickupLocationText || null,
        input.details.ground.returnLocationText || null,
        input.details.ground.pickupAt,
        input.details.ground.returnAt,
        travelerIds[0],
        input.details.ground.desiredCategory || null,
        input.details.ground.automaticTransmission ?? null,
        input.details.ground.airConditioning ?? null,
        input.details.ground.unlimitedMileage ?? null,
        JSON.stringify(input.details.ground.preferences || {}),
        input.details.ground.notes || null,
        input.actorUserId,
      ],
    )
    return
  }

  await synchronizeTravelers(client, input, input.details.travelers)
  await requireVerifiedBusTerminals(client, input, input.details)
  await client.query(
    `insert into bus_demand_details (
       tenant_id, demand_id, trip_type, preferred_class, seat_preference,
       accessibility_required, preferences, notes, created_by, updated_by
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $9)
     on conflict (tenant_id, demand_id) do update set
       trip_type = excluded.trip_type,
       preferred_class = excluded.preferred_class,
       seat_preference = excluded.seat_preference,
       accessibility_required = excluded.accessibility_required,
       preferences = excluded.preferences,
       notes = excluded.notes,
       version = bus_demand_details.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [
      input.tenantId,
      input.demandId,
      input.details.ground.tripType,
      input.details.ground.preferredClass || null,
      input.details.ground.seatPreference || null,
      input.details.ground.accessibilityRequired,
      JSON.stringify(input.details.ground.preferences || {}),
      input.details.ground.notes || null,
      input.actorUserId,
    ],
  )
  const retainedIds: string[] = []
  for (let index = 0; index < input.details.ground.legs.length; index += 1) {
    const leg = input.details.ground.legs[index]!
    const existing = await client.query<{ id: string }>(
      `select id from bus_demand_legs
       where tenant_id = $1 and demand_id = $2 and sequence = $3`,
      [input.tenantId, input.demandId, index + 1],
    )
    const legId = existing.rows[0]?.id || randomUUID()
    retainedIds.push(legId)
    await client.query(
      `insert into bus_demand_legs (
         id, tenant_id, demand_id, sequence, origin_city_id, destination_city_id,
         origin_terminal_id, destination_terminal_id, departure_date,
         earliest_departure, latest_departure, created_by, updated_by
       ) values (
         $1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
         $9::date, $10::time, $11::time, $12, $12
       )
       on conflict (tenant_id, demand_id, sequence) do update set
         origin_city_id = excluded.origin_city_id,
         destination_city_id = excluded.destination_city_id,
         origin_terminal_id = excluded.origin_terminal_id,
         destination_terminal_id = excluded.destination_terminal_id,
         departure_date = excluded.departure_date,
         earliest_departure = excluded.earliest_departure,
         latest_departure = excluded.latest_departure,
         updated_by = excluded.updated_by,
         updated_at = now()`,
      [
        legId,
        input.tenantId,
        input.demandId,
        index + 1,
        leg.originCityId,
        leg.destinationCityId,
        leg.originTerminalId || null,
        leg.destinationTerminalId || null,
        leg.departureDate,
        leg.earliestDeparture || null,
        leg.latestDeparture || null,
        input.actorUserId,
      ],
    )
  }
  await client.query(
    `update bus_quote_segments segment set demand_leg_id = null, updated_at = now()
     where segment.tenant_id = $1
       and segment.demand_leg_id in (
         select leg.id from bus_demand_legs leg
         where leg.tenant_id = $1 and leg.demand_id = $2
           and not (leg.id = any($3::uuid[]))
       )`,
    [input.tenantId, input.demandId, retainedIds],
  )
  await client.query(
    `delete from bus_demand_legs
     where tenant_id = $1 and demand_id = $2 and not (id = any($3::uuid[]))`,
    [input.tenantId, input.demandId, retainedIds],
  )
}

async function requireDemandScope(
  client: PoolClient,
  input: { tenantId: string; demandId: string; companyId: string; service: 'car' | 'bus' },
) {
  const result = await client.query<{ service_type: string }>(
    `select service_type from demands
     where tenant_id = $1 and id = $2 and company_id = $3 and deleted_at is null`,
    [input.tenantId, input.demandId, input.companyId],
  )
  if (result.rows[0]?.service_type !== input.service) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_DEMAND_SCOPE_INVALID',
      'Os detalhes terrestres nao correspondem a demanda e a empresa informadas.',
      409,
    )
  }
}

async function loadCanonicalEmployees(
  client: PoolClient,
  tenantId: string,
  companyId: string,
  employeeIds: string[],
): Promise<EmployeeRow[]> {
  const uniqueIds = [...new Set(employeeIds)]
  if (!uniqueIds.length || uniqueIds.length !== employeeIds.length) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_DEMAND_TRAVELER_SCOPE_INVALID',
      'Selecione viajantes distintos, ativos e pertencentes a empresa do pedido.',
    )
  }
  const result = await client.query<EmployeeRow>(
    `select id, full_name, email::text, phone
     from employees
     where tenant_id = $1 and company_id = $2 and id = any($3::text[])
       and status = 'active' and deleted_at is null`,
    [tenantId, companyId, uniqueIds],
  )
  const byId = new Map(result.rows.map((employee) => [employee.id, employee]))
  if (byId.size !== uniqueIds.length) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_DEMAND_TRAVELER_SCOPE_INVALID',
      'Selecione somente viajantes ativos e pertencentes a empresa do pedido.',
    )
  }
  return employeeIds.map((employeeId) => byId.get(employeeId)!)
}

function canonicalTraveler(employee: EmployeeRow): { employee_id: string; name: string; email?: string } {
  return {
    employee_id: employee.id,
    name: employee.full_name,
    ...(employee.email ? { email: employee.email } : {}),
  }
}

function rentalLocationLabel(location: CanonicalRentalLocationRow): string {
  return [location.supplier_name, location.name, location.city_name].filter(Boolean).join(' · ')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function synchronizeTravelers(
  client: PoolClient,
  input: { tenantId: string; demandId: string; companyId: string; actorUserId: string },
  snapshots: Array<{ employee_id: string; name: string; email?: string }>,
): Promise<string[]> {
  const employeeIds = snapshots.map((traveler) => traveler.employee_id)
  const employees = await client.query<EmployeeRow>(
    `select id, full_name, email::text, phone
     from employees
     where tenant_id = $1 and company_id = $2 and id = any($3::text[])
       and status = 'active' and deleted_at is null`,
    [input.tenantId, input.companyId, employeeIds],
  )
  const employeeById = new Map(employees.rows.map((employee) => [employee.id, employee]))
  if (employeeById.size !== new Set(employeeIds).size) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_DEMAND_TRAVELER_SCOPE_INVALID',
      'Selecione somente viajantes ativos e pertencentes a empresa do pedido.',
    )
  }
  const existing = await client.query<ExistingTravelerRow>(
    `select id, employee_id from demand_travelers
     where tenant_id = $1 and demand_id = $2 and deleted_at is null`,
    [input.tenantId, input.demandId],
  )
  await client.query(
    `update demand_travelers set is_primary = false, updated_by = $3, updated_at = now()
     where tenant_id = $1 and demand_id = $2 and deleted_at is null`,
    [input.tenantId, input.demandId, input.actorUserId],
  )
  const ids: string[] = []
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index]!
    const employee = employeeById.get(snapshot.employee_id)!
    const current = existing.rows.find((row) => row.employee_id === employee.id)
    const travelerId = current?.id || randomUUID()
    ids.push(travelerId)
    await client.query(
      `insert into demand_travelers (
         id, tenant_id, demand_id, company_id, employee_id, traveler_role,
         is_primary, traveler_sequence, is_external, name_snapshot,
         email_snapshot, phone_snapshot, metadata, created_by, updated_by
       ) values (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, false, $9, $10, $11,
         $12::jsonb, $13, $13
       )
       on conflict (id) do update set
         company_id = excluded.company_id,
         employee_id = excluded.employee_id,
         traveler_role = excluded.traveler_role,
         is_primary = excluded.is_primary,
         traveler_sequence = excluded.traveler_sequence,
         is_external = false,
         name_snapshot = excluded.name_snapshot,
         email_snapshot = excluded.email_snapshot,
         phone_snapshot = excluded.phone_snapshot,
         metadata = excluded.metadata,
         deleted_at = null,
         updated_by = excluded.updated_by,
         updated_at = now()`,
      [
        travelerId,
        input.tenantId,
        input.demandId,
        input.companyId,
        employee.id,
        index === 0 ? 'responsible' : 'guest',
        index === 0,
        index + 1,
        employee.full_name,
        employee.email,
        employee.phone,
        JSON.stringify({ source: 'company_portal_ground_demand', sequence: index + 1 }),
        input.actorUserId,
      ],
    )
  }
  await client.query(
    `update demand_travelers set deleted_at = now(), updated_by = $3, updated_at = now()
     where tenant_id = $1 and demand_id = $2 and deleted_at is null
       and not (id = any($4::uuid[]))`,
    [input.tenantId, input.demandId, input.actorUserId, ids],
  )
  return ids
}

async function requireVerifiedRentalLocations(
  client: PoolClient,
  input: { tenantId: string },
  pickupId?: string,
  returnId?: string,
) {
  if (!pickupId || !returnId) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_RENTAL_LOCATION_REQUIRED',
      'Selecione lojas aprovadas para retirada e devolucao.',
    )
  }
  const result = await client.query<{ id: string; supplier_id: string }>(
    `select location.id, location.supplier_id
     from rental_locations location
     join commercial_suppliers supplier
       on supplier.tenant_id = location.tenant_id and supplier.id = location.supplier_id
     where location.tenant_id = $1 and location.id = any($2::uuid[])
       and location.status = 'active' and location.deleted_at is null
       and location.review_status = 'verified'
       and supplier.status = 'active' and supplier.deleted_at is null
       and supplier.service_types @> array['car']::text[]`,
    [input.tenantId, [pickupId, returnId]],
  )
  const byId = new Map(result.rows.map((row) => [row.id, row]))
  if (!byId.has(pickupId) || !byId.has(returnId)) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_RENTAL_LOCATION_NOT_VERIFIED',
      'Uma das lojas escolhidas nao esta ativa e aprovada no catalogo offline.',
    )
  }
  if (byId.get(pickupId)!.supplier_id !== byId.get(returnId)!.supplier_id) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_RENTAL_SUPPLIER_MISMATCH',
      'Retirada e devolucao precisam pertencer a mesma locadora.',
    )
  }
}

async function requireVerifiedBusTerminals(
  client: PoolClient,
  input: { tenantId: string },
  details: PortalBusRequestDetails,
) {
  const terminalIds = Array.from(new Set(details.ground.legs.flatMap((leg) => [
    leg.originTerminalId,
    leg.destinationTerminalId,
  ].filter((id): id is string => Boolean(id)))))
  if (details.ground.legs.some((leg) => !leg.originTerminalId || !leg.destinationTerminalId)) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_BUS_TERMINALS_REQUIRED',
      'Selecione terminais aprovados de origem e destino para cada trecho.',
    )
  }
  const result = await client.query<{ id: string; city_id: string }>(
    `select id, city_id from bus_terminals
     where tenant_id = $1 and id = any($2::uuid[])
       and status = 'active' and deleted_at is null and review_status = 'verified'`,
    [input.tenantId, terminalIds],
  )
  if (result.rows.length !== terminalIds.length) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_BUS_TERMINAL_NOT_VERIFIED',
      'Um dos terminais escolhidos nao esta ativo e aprovado no catalogo offline.',
    )
  }
  const terminalById = new Map(result.rows.map((terminal) => [terminal.id, terminal]))
  if (details.ground.legs.some((leg) => (
    terminalById.get(leg.originTerminalId!)?.city_id !== leg.originCityId
    || terminalById.get(leg.destinationTerminalId!)?.city_id !== leg.destinationCityId
  ))) {
    throw new OfflineGroundDemandServiceError(
      'GROUND_BUS_TERMINAL_CITY_MISMATCH',
      'O terminal selecionado nao pertence a cidade informada no trecho.',
    )
  }
}

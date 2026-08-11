import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import type { AirDemandDetailsInput } from '@/lib/air-demand/model'
import {
  airTravelerBirthDateFromMetadata,
  assessAirTravelerProfile,
  type AirTravelerProfileAssessment,
} from '@/lib/travelers/air-profile'

interface AirEmployeeRow extends QueryResultRow {
  id: string
  full_name: string
  document_number: string | null
  email: string | null
  phone: string | null
  metadata: Record<string, unknown> | null
}

interface ExistingAirTravelerRow extends QueryResultRow {
  id: string
  employee_id: string | null
  deleted_at: string | Date | null
}

export interface PersistAirDemandDetailsInput {
  tenantId: string
  demandId: string
  companyId: string
  actorUserId: string
  details: AirDemandDetailsInput
}

export class AirDemandServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'AirDemandServiceError'
  }
}

export async function hasPersistedAirDemandDetailsInTransaction(
  client: PoolClient,
  tenantId: string,
  demandId: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1 from air_demand_details where tenant_id = $1 and demand_id = $2`,
    [tenantId, demandId],
  )
  return Boolean(result.rows[0])
}

/**
 * Mantem a necessidade aerea e seus trechos no mesmo commit da demanda.
 * A edicao normal e bloqueada assim que a cotacao comeca, portanto os trechos
 * podem ser substituidos integralmente sem invalidar uma opcao ja publicada.
 */
export async function persistAirDemandDetailsInTransaction(
  client: PoolClient,
  input: PersistAirDemandDetailsInput,
): Promise<void> {
  await requireDemandScope(client, input)

  await client.query(
    `insert into air_demand_details (
       tenant_id, demand_id, trip_type, cabin_class, fare_family,
       preferred_airline_codes, direct_only, baggage_required,
       preferences, notes, created_by, updated_by
     ) values (
       $1, $2, $3, $4, null, $5::text[], $6, $7, $8::jsonb, null, $9, $9
     )
     on conflict (tenant_id, demand_id) do update set
       trip_type = excluded.trip_type,
       cabin_class = excluded.cabin_class,
       fare_family = excluded.fare_family,
       preferred_airline_codes = excluded.preferred_airline_codes,
       direct_only = excluded.direct_only,
       baggage_required = excluded.baggage_required,
       preferences = excluded.preferences,
       notes = excluded.notes,
       version = air_demand_details.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [
      input.tenantId,
      input.demandId,
      input.details.tripType,
      input.details.cabinClass,
      input.details.preferredAirlineCodes,
      input.details.directOnly,
      input.details.baggageRequired,
      JSON.stringify(input.details.preferences),
      input.actorUserId,
    ],
  )

  await client.query(
    `delete from air_demand_legs where tenant_id = $1 and demand_id = $2`,
    [input.tenantId, input.demandId],
  )
  for (const leg of input.details.legs) {
    await client.query(
      `insert into air_demand_legs (
         tenant_id, demand_id, sequence, origin_code, origin_name,
         destination_code, destination_name, departure_date,
         earliest_departure, latest_departure, created_by, updated_by
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8::date, $9::time, $10::time, $11, $11
       )`,
      [
        input.tenantId,
        input.demandId,
        leg.sequence,
        leg.originCode,
        leg.originName,
        leg.destinationCode,
        leg.destinationName,
        leg.departureDate,
        leg.earliestDeparture,
        leg.latestDeparture,
        input.actorUserId,
      ],
    )
  }

  if (input.details.passengers) {
    await syncAirTravelers(client, input)
  }
}

async function syncAirTravelers(
  client: PoolClient,
  input: PersistAirDemandDetailsInput,
): Promise<void> {
  const passengers = input.details.passengers || []
  const employeeIds = passengers.map((passenger) => passenger.employeeId)
  const employeeResult = await client.query<AirEmployeeRow>(
    `select employee.id, employee.full_name, employee.document_number,
            employee.email::text, employee.phone, employee.metadata
     from employees employee
     where employee.tenant_id = $1 and employee.company_id = $2
       and employee.id = any($3::text[])
       and employee.status = 'active' and employee.deleted_at is null
     for share of employee`,
    [input.tenantId, input.companyId, employeeIds],
  )
  const employees = new Map(employeeResult.rows.map((employee) => [employee.id, employee]))
  const missingEmployeeIds = employeeIds.filter((employeeId) => !employees.has(employeeId))
  if (missingEmployeeIds.length) {
    throw new AirDemandServiceError(
      'AIR_DEMAND_PASSENGER_INVALID',
      'Um ou mais passageiros nao estao ativos na base de viajantes da empresa.',
      422,
      { employeeIds: missingEmployeeIds },
    )
  }

  const assessed = passengers.map((passenger) => {
    const employee = employees.get(passenger.employeeId)!
    if (normalizeName(passenger.name) !== normalizeName(employee.full_name)) {
      throw new AirDemandServiceError(
        'AIR_DEMAND_PASSENGER_NAME_MISMATCH',
        'O nome do passageiro mudou no cadastro. Atualize a selecao antes de enviar a demanda.',
        409,
        { employeeId: passenger.employeeId },
      )
    }
    return {
      employee,
      profile: assessAirTravelerProfile({
        name: employee.full_name,
        documentNumber: employee.document_number,
        birthDate: airTravelerBirthDateFromMetadata(employee.metadata),
      }),
    }
  })
  const incompleteProfiles = assessed.flatMap(({ employee, profile }) => (
    profile.profileIssues.length
      ? [{ employeeId: employee.id, name: employee.full_name, fields: profile.profileIssues }]
      : []
  ))
  if (incompleteProfiles.length) {
    throw new AirDemandServiceError(
      'AIR_DEMAND_PASSENGER_PROFILE_INCOMPLETE',
      'Corrija CPF, data de nascimento, primeiro nome e sobrenome dos passageiros antes de criar a demanda aerea.',
      422,
      { passengers: incompleteProfiles },
    )
  }

  const existingResult = await client.query<ExistingAirTravelerRow>(
    `select traveler.id, traveler.employee_id, traveler.deleted_at
     from demand_travelers traveler
     where traveler.tenant_id = $1 and traveler.demand_id = $2
       and traveler.deleted_at is null
     order by traveler.traveler_sequence nulls last, traveler.created_at, traveler.id
     for update of traveler`,
    [input.tenantId, input.demandId],
  )
  const existingByEmployee = new Map<string, ExistingAirTravelerRow>()
  for (const traveler of existingResult.rows) {
    if (traveler.employee_id && !existingByEmployee.has(traveler.employee_id)) {
      existingByEmployee.set(traveler.employee_id, traveler)
    }
  }

  await client.query(
    `update demand_travelers set
       is_primary = false,
       deleted_at = coalesce(deleted_at, now()),
       updated_by = $3,
       updated_at = now()
     where tenant_id = $1 and demand_id = $2`,
    [input.tenantId, input.demandId, input.actorUserId],
  )

  for (const [index, item] of assessed.entries()) {
    const existing = existingByEmployee.get(item.employee.id)
    if (existing) {
      await updateAirTraveler(client, input, existing.id, item.employee, item.profile, index)
    } else {
      await insertAirTraveler(client, input, item.employee, item.profile, index)
    }
  }
}

async function updateAirTraveler(
  client: PoolClient,
  input: PersistAirDemandDetailsInput,
  travelerId: string,
  employee: AirEmployeeRow,
  profile: AirTravelerProfileAssessment,
  index: number,
): Promise<void> {
  await client.query(
    `update demand_travelers set
       company_id = $4,
       employee_id = $5,
       traveler_role = $6,
       is_primary = $7,
       traveler_sequence = $8,
       is_external = false,
       name_snapshot = $9,
       first_name_snapshot = $10,
       last_name_snapshot = $11,
       document_number_snapshot = $12,
       birth_date_snapshot = $13::date,
       email_snapshot = $14,
       phone_snapshot = $15,
       metadata = coalesce(metadata, '{}'::jsonb) || $16::jsonb,
       deleted_at = null,
       updated_by = $17,
       updated_at = now()
     where tenant_id = $1 and demand_id = $2 and id = $3::uuid`,
    [
      input.tenantId,
      input.demandId,
      travelerId,
      input.companyId,
      employee.id,
      index === 0 ? 'responsible' : 'guest',
      index === 0,
      index + 1,
      employee.full_name,
      profile.firstName,
      profile.lastName,
      profile.cpf,
      profile.birthDate,
      employee.email,
      employee.phone,
      JSON.stringify({
        source: 'air_demand',
        profileVersion: 1,
        passengerSequence: index + 1,
        pnrName: profile.pnrName,
      }),
      input.actorUserId,
    ],
  )
}

async function insertAirTraveler(
  client: PoolClient,
  input: PersistAirDemandDetailsInput,
  employee: AirEmployeeRow,
  profile: AirTravelerProfileAssessment,
  index: number,
): Promise<void> {
  await client.query(
    `insert into demand_travelers (
       id, tenant_id, demand_id, company_id, employee_id, traveler_role,
       is_primary, traveler_sequence, is_external, name_snapshot, first_name_snapshot,
       last_name_snapshot, document_number_snapshot, birth_date_snapshot,
       email_snapshot, phone_snapshot, metadata, created_by, updated_by
     ) values (
       $1::uuid, $2, $3, $4, $5, $6,
       $7, $8, false, $9, $10,
       $11, $12, $13::date,
       $14, $15, $16::jsonb, $17, $17
     )`,
    [
      randomUUID(),
      input.tenantId,
      input.demandId,
      input.companyId,
      employee.id,
      index === 0 ? 'responsible' : 'guest',
      index === 0,
      index + 1,
      employee.full_name,
      profile.firstName,
      profile.lastName,
      profile.cpf,
      profile.birthDate,
      employee.email,
      employee.phone,
      JSON.stringify({
        source: 'air_demand',
        profileVersion: 1,
        passengerSequence: index + 1,
        pnrName: profile.pnrName,
      }),
      input.actorUserId,
    ],
  )
}

function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

async function requireDemandScope(
  client: PoolClient,
  input: Pick<PersistAirDemandDetailsInput, 'tenantId' | 'demandId' | 'companyId'>,
): Promise<void> {
  const result = await client.query(
    `select 1
     from demands
     where tenant_id = $1 and id = $2 and company_id = $3 and deleted_at is null`,
    [input.tenantId, input.demandId, input.companyId],
  )
  if (!result.rows[0]) {
    throw new AirDemandServiceError(
      'AIR_DEMAND_SCOPE_MISMATCH',
      'A demanda aerea nao pertence a empresa informada.',
      409,
    )
  }
}

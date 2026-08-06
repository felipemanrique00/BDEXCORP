import 'server-only'

import type { PoolClient } from 'pg'

import type { AirDemandDetailsInput } from '@/lib/air-demand/model'

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

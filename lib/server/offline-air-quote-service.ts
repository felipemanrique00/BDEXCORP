import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import type { TravelQuote, TravelQuoteOption, TravelQuoteRequest } from '@/lib/integrations/types'
import { offlineServiceMatchesDemand } from '@/lib/offline-travel/schema'
import { minorUnitsToMoney, moneyToMinorUnits } from '@/lib/offline-travel/money'
import { calculateAirQuotePricing, type AirQuotePricing } from '@/lib/offline-travel/services/air/pricing'
import type {
  OfflineAirQuoteListReadModel,
  OfflineAirDemandPassengerReadModel,
  OfflineAirQuoteOptionReadModel,
  OfflineAirQuoteReadModel,
  OfflineAirQuoteSegmentReadModel,
} from '@/lib/offline-travel/services/air/read-model'
import {
  offlineAirQuoteCreateSchema,
  type OfflineAirQuoteCreateInput,
  type OfflineAirQuoteOptionInput,
  type OfflineAirQuoteSegmentInput,
} from '@/lib/offline-travel/services/air/schema'
import { sha256 } from '@/lib/policy'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  executeGovernedTravelQuote,
  TravelGovernanceError,
} from '@/lib/server/travel-governance-service'

const PROVIDER = 'manual-offline' as const

interface AirDemandRow extends QueryResultRow {
  id: string
  company_id: string
  demand_number: string
  service_type: string
  lifecycle_status: string
  lifecycle_version: string | number
  requester_id: string | null
  employee_id: string | null
  passenger_name_snapshot: string
  trip_type: string
  cabin_class: string
  preferred_airline_codes: string[] | null
  direct_only: boolean
  baggage_required: boolean
  passenger_count: string | number
}

interface AirDemandLegRow extends QueryResultRow {
  sequence: string | number
  origin_code: string
  origin_name: string | null
  destination_code: string
  destination_name: string | null
  departure_date: string | Date
}

interface AirDemandPassengerRow extends QueryResultRow {
  id: string
  employee_id: string | null
  name_snapshot: string
  traveler_sequence: string | number | null
  identification_code: string | null
}

interface PreparedAirOption {
  input: OfflineAirQuoteOptionInput
  providerOptionId: string
  pricing: AirQuotePricing
  startsAt: string
  endsAt: string
}

interface PreparedAirQuote {
  demand: AirDemandRow
  legs: AirDemandLegRow[]
  options: PreparedAirOption[]
  expiresAt: string | undefined
}

interface AirQuoteRow extends QueryResultRow {
  quote_id: string
  demand_id: string
  demand_number: string
  lifecycle_status: string
  lifecycle_version: string | number
  quote_status: string
  expires_at: string | Date | null
  quote_created_at: string | Date
  quote_updated_at: string | Date
  option_id: string
  provider_option_id: string
  option_metadata: Record<string, unknown> | null
  refundable: boolean | null
  reservation_system: string
  locator: string | null
  validating_airline_code: string
  validating_airline_name: string
  cabin_class: string
  fare_family: string | null
  baggage_pieces: string | number
  issuance_deadline: string | Date | null
  exchange_rate: string | number
  mileage: string | number
  reference_fare_minor: string | number
  fare_amount_minor: string | number
  tax_amount_minor: string | number
  rav_amount_minor: string | number
  rac_amount_minor: string | number
  total_amount_minor: string | number
  currency: string
  change_policy: string | null
  cancellation_policy: string | null
  detail_metadata: Record<string, unknown> | null
  detail_notes: string | null
  segment_id: string
  segment_sequence: string | number
  segment_airline_code: string
  segment_airline_name: string
  flight_number: string
  booking_class: string
  segment_cabin_class: string
  segment_baggage_pieces: string | number
  origin_code: string
  origin_name: string | null
  destination_code: string
  destination_name: string | null
  departs_at: string | Date
  arrives_at: string | Date
  equipment: string | null
  selection_id: string | null
  selection_status: string | null
  selection_chosen_at: string | Date | null
  approval_instance_id: string | null
  approval_status: string | null
  approval_completed_at: string | Date | null
}

export interface OfflineAirQuoteCreationResult {
  item: OfflineAirQuoteReadModel
  replayed: boolean
}

export async function createOfflineAirQuote(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<OfflineAirQuoteCreationResult> {
  const input = offlineAirQuoteCreateSchema.parse(rawInput)
  const prepared = await prepareAirQuote(principal, input)
  const createdAt = new Date().toISOString()
  const providerQuoteId = `offline-air-quote:${sha256({
    tenantId: principal.tenantId,
    demandId: prepared.demand.id,
    idempotencyKey: input.idempotencyKey,
  }).slice(0, 48)}`
  const firstDemandLeg = prepared.legs[0]
  const lastDemandLeg = prepared.legs[prepared.legs.length - 1]
  const request: TravelQuoteRequest = {
    demandId: prepared.demand.id,
    expectedLifecycleVersion: input.expectedLifecycleVersion,
    idempotencyKey: input.idempotencyKey,
    policyJustification: input.policyJustification,
    service: 'aereo',
    empresaId: prepared.demand.company_id,
    origem: firstDemandLeg.origin_name || firstDemandLeg.origin_code,
    destino: lastDemandLeg.destination_name || lastDemandLeg.destination_code,
    origemIata: firstDemandLeg.origin_code,
    destinoIata: lastDemandLeg.destination_code,
    dataInicio: dateOnly(firstDemandLeg.departure_date),
    dataFim: prepared.legs.length > 1 ? dateOnly(lastDemandLeg.departure_date) : null,
    adultos: Number(prepared.demand.passenger_count),
    apenasVoosDiretos: prepared.demand.direct_only,
    apenasTarifasComBagagem: prepared.demand.baggage_required,
    raw: {
      channel: 'offline',
      manualOffline: true,
      tripType: prepared.demand.trip_type,
      cabinClass: prepared.demand.cabin_class,
      preferredAirlineCodes: prepared.demand.preferred_airline_codes || [],
      offlineOptionCount: prepared.options.length,
      serial_os: prepared.demand.demand_number,
    },
  }
  const quoteOptions: TravelQuoteOption[] = prepared.options.map((option) => {
    const offlineAir = airOptionMetadata(option)
    return {
      id: option.providerOptionId,
      provider: PROVIDER,
      service: 'aereo',
      supplierName: option.input.airlineName,
      title: `${option.input.airlineName} - ${routeLabel(option.input.segments)}`,
      subtitle: [option.input.fareFamily, cabinClassLabel(option.input.cabinClass)]
        .filter(Boolean)
        .join(' - '),
      price: option.pricing.total,
      currency: option.input.currency,
      refundable: option.input.refundable,
      policyStatus: 'respeitada',
      startsAt: option.startsAt,
      endsAt: option.endsAt,
      city: option.input.segments[option.input.segments.length - 1].destinationName
        || option.input.segments[option.input.segments.length - 1].destinationCode,
      metadata: { offlineAir },
      raw: { source: PROVIDER, offlineAir },
    }
  })

  const execution = await executeGovernedTravelQuote(
    principal,
    request,
    input.idempotencyKey,
    async (providerRequest): Promise<TravelQuote> => ({
      id: providerQuoteId,
      provider: PROVIDER,
      service: 'aereo',
      request: providerRequest,
      options: quoteOptions,
      raw: { source: PROVIDER, optionCount: quoteOptions.length },
      createdAt,
      expiresAt: prepared.expiresAt,
      warnings: [],
    }),
    {
      provider: PROVIDER,
      persistOptionDetails: async (context) => {
        await persistAirOptionDetails(
          context.client,
          principal,
          prepared,
          context.optionIdsByProviderId,
        )
      },
    },
  )
  const item = await loadOfflineAirQuoteById(
    principal,
    execution.demandId,
    execution.databaseQuoteId,
  )
  if (!item) {
    throw new TravelGovernanceError(
      'OFFLINE_AIR_QUOTE_READ_MODEL_NOT_FOUND',
      'A cotacao aerea foi publicada, mas nao pode ser relida.',
      500,
    )
  }
  return { item, replayed: execution.replayed }
}

export async function listOfflineAirQuotes(
  principal: RequestPrincipal,
  demandId: string,
): Promise<OfflineAirQuoteListReadModel> {
  const normalizedDemandId = String(demandId || '').trim()
  if (!normalizedDemandId) {
    throw new TravelGovernanceError(
      'OFFLINE_AIR_QUOTE_DEMAND_REQUIRED',
      'Informe a demanda para consultar cotacoes aereas.',
      400,
    )
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demandResult = await client.query<Pick<AirDemandRow,
      'company_id' | 'requester_id' | 'lifecycle_status' | 'lifecycle_version'
    >>(
      `select company_id, requester_id, lifecycle_status, lifecycle_version
       from demands
       where tenant_id = $1 and id = $2 and deleted_at is null`,
      [principal.tenantId, normalizedDemandId],
    )
    const demand = demandResult.rows[0]
    if (!demand) {
      throw new TravelGovernanceError('TRAVEL_DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
    }
    await requireCompanyAccess(principal, demand.company_id, 'ver_reservas')
    await assertRequesterOwnsDemand(client, principal, demand)
    const [rows, passengers] = await Promise.all([
      loadAirQuoteRows(client, principal.tenantId, normalizedDemandId),
      loadAirDemandPassengers(client, principal.tenantId, normalizedDemandId),
    ])
    return {
      demandId: normalizedDemandId,
      lifecycleStatus: demand.lifecycle_status,
      lifecycleVersion: Number(demand.lifecycle_version),
      passengers,
      quotes: mapAirQuoteRows(rows),
    }
  })
}

async function loadAirDemandPassengers(
  client: PoolClient,
  tenantId: string,
  demandId: string,
): Promise<OfflineAirDemandPassengerReadModel[]> {
  const result = await client.query<AirDemandPassengerRow>(
    `select traveler.id, traveler.employee_id, traveler.name_snapshot,
            traveler.traveler_sequence,
            coalesce(nullif(employee.identification_code, ''), nullif(employee.registration_code, ''))
              as identification_code
     from demand_travelers traveler
     left join employees employee
       on employee.tenant_id = traveler.tenant_id
      and employee.id = traveler.employee_id
      and employee.company_id = traveler.company_id
     where traveler.tenant_id = $1 and traveler.demand_id = $2
       and traveler.deleted_at is null
     order by traveler.traveler_sequence nulls last,
              traveler.is_primary desc, traveler.created_at, traveler.id`,
    [tenantId, demandId],
  )
  return result.rows.map((passenger, index) => ({
    demandTravelerId: passenger.id,
    employeeId: passenger.employee_id,
    name: passenger.name_snapshot,
    sequence: Number(passenger.traveler_sequence) || index + 1,
    identificationCode: passenger.identification_code,
  }))
}

async function prepareAirQuote(
  principal: RequestPrincipal,
  input: OfflineAirQuoteCreateInput,
): Promise<PreparedAirQuote> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demandResult = await client.query<AirDemandRow>(
      `select demand.id, demand.company_id, demand.demand_number,
              demand.service_type, demand.lifecycle_status, demand.lifecycle_version,
              demand.requester_id, demand.employee_id, demand.passenger_name_snapshot,
              detail.trip_type, detail.cabin_class, detail.preferred_airline_codes,
              detail.direct_only, detail.baggage_required,
              greatest(1, (
                select count(*) from demand_travelers traveler
                where traveler.tenant_id = demand.tenant_id
                  and traveler.demand_id = demand.id and traveler.deleted_at is null
              )) as passenger_count
       from demands demand
       join air_demand_details detail
         on detail.tenant_id = demand.tenant_id and detail.demand_id = demand.id
       where demand.tenant_id = $1 and demand.id = $2 and demand.deleted_at is null`,
      [principal.tenantId, input.demandId],
    )
    const demand = demandResult.rows[0]
    if (!demand) {
      throw new TravelGovernanceError(
        'OFFLINE_AIR_QUOTE_DEMAND_NOT_FOUND',
        'Demanda aerea nao encontrada ou ainda sem dados de voo.',
        404,
      )
    }
    await requireCompanyAccess(principal, demand.company_id, 'operar_cotacoes')
    if (!offlineServiceMatchesDemand(demand.service_type, 'aereo')) {
      throw new TravelGovernanceError(
        'OFFLINE_AIR_QUOTE_SERVICE_MISMATCH',
        'A demanda selecionada nao e de transporte aereo.',
        422,
      )
    }
    const legs = (await client.query<AirDemandLegRow>(
      `select sequence, origin_code, origin_name, destination_code,
              destination_name, departure_date
       from air_demand_legs
       where tenant_id = $1 and demand_id = $2
       order by sequence`,
      [principal.tenantId, demand.id],
    )).rows
    if (!legs.length) {
      throw new TravelGovernanceError(
        'OFFLINE_AIR_QUOTE_LEGS_REQUIRED',
        'A demanda nao possui trechos aereos para cotacao.',
        422,
      )
    }

    const options = input.options.map((option): PreparedAirOption => {
      validateItineraryAgainstDemand(option.segments, legs)
      if (option.cabinClass !== demand.cabin_class) {
        throw new TravelGovernanceError(
          'OFFLINE_AIR_QUOTE_CABIN_MISMATCH',
          'A classe da opcao nao corresponde a classe solicitada na demanda.',
          422,
          { optionClientId: option.clientId },
        )
      }
      if (demand.direct_only && option.segments.length !== legs.length) {
        throw new TravelGovernanceError(
          'OFFLINE_AIR_QUOTE_DIRECT_REQUIRED',
          'A demanda aceita somente voos diretos.',
          422,
          { optionClientId: option.clientId },
        )
      }
      if (demand.baggage_required
        && option.segments.some((segment) => segment.baggagePieces < 1)) {
        throw new TravelGovernanceError(
          'OFFLINE_AIR_QUOTE_BAGGAGE_REQUIRED',
          'Todos os trechos devem incluir a bagagem solicitada.',
          422,
          { optionClientId: option.clientId },
        )
      }
      if (option.issuanceDeadline && Date.parse(option.issuanceDeadline) <= Date.now()) {
        throw new TravelGovernanceError(
          'OFFLINE_AIR_QUOTE_TICKETING_DEADLINE_EXPIRED',
          'O prazo de emissao da opcao ja expirou.',
          422,
          { optionClientId: option.clientId },
        )
      }
      const orderedSegments = [...option.segments].sort((left, right) => left.sequence - right.sequence)
      return {
        input: { ...option, segments: orderedSegments },
        providerOptionId: `offline-air-option:${option.clientId}`,
        pricing: calculateAirQuotePricing(option),
        startsAt: orderedSegments[0].departsAt,
        endsAt: orderedSegments[orderedSegments.length - 1].arrivesAt,
      }
    })
    return {
      demand,
      legs,
      options,
      expiresAt: normalizeExpiry(input.expiresAt, options),
    }
  })
}

function validateItineraryAgainstDemand(
  segments: OfflineAirQuoteSegmentInput[],
  legs: AirDemandLegRow[],
): void {
  const ordered = [...segments].sort((left, right) => left.sequence - right.sequence)
  let cursor = 0
  for (const leg of legs) {
    const first = ordered[cursor]
    if (!first || first.originCode !== leg.origin_code
      || first.departsAt.slice(0, 10) !== dateOnly(leg.departure_date)) {
      throw new TravelGovernanceError(
        'OFFLINE_AIR_QUOTE_ROUTE_MISMATCH',
        'A opcao nao atende a origem ou a data de um trecho solicitado.',
        422,
        { demandLegSequence: Number(leg.sequence) },
      )
    }
    let reachedDestination = false
    while (cursor < ordered.length) {
      const segment = ordered[cursor]
      cursor += 1
      if (segment.destinationCode === leg.destination_code) {
        reachedDestination = true
        break
      }
    }
    if (!reachedDestination) {
      throw new TravelGovernanceError(
        'OFFLINE_AIR_QUOTE_ROUTE_MISMATCH',
        'A opcao nao chega ao destino de um trecho solicitado.',
        422,
        { demandLegSequence: Number(leg.sequence) },
      )
    }
  }
  if (cursor !== ordered.length) {
    throw new TravelGovernanceError(
      'OFFLINE_AIR_QUOTE_ROUTE_MISMATCH',
      'A opcao possui trechos que nao pertencem ao itinerario solicitado.',
      422,
    )
  }
}

async function persistAirOptionDetails(
  client: PoolClient,
  principal: RequestPrincipal,
  prepared: PreparedAirQuote,
  optionIdsByProviderId: ReadonlyMap<string, string>,
): Promise<void> {
  for (const option of prepared.options) {
    const quoteOptionId = optionIdsByProviderId.get(option.providerOptionId)
    if (!quoteOptionId) {
      throw new TravelGovernanceError(
        'OFFLINE_AIR_QUOTE_OPTION_PERSISTENCE_FAILED',
        'A opcao aerea publicada nao foi localizada.',
        409,
      )
    }
    const metadata = airOptionMetadata(option)
    await client.query(
      `insert into air_quote_option_details (
         tenant_id, quote_option_id, reservation_system, locator,
         validating_airline_code, validating_airline_name, cabin_class,
         fare_family, baggage_pieces, issuance_deadline, exchange_rate,
         mileage, reference_fare_minor, fare_amount_minor, tax_amount_minor,
         rav_amount_minor, rac_amount_minor, total_amount_minor, currency,
         refundable, change_policy, cancellation_policy, notes, metadata
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb
       )
       on conflict (tenant_id, quote_option_id) do update set
         reservation_system = excluded.reservation_system,
         locator = excluded.locator,
         validating_airline_code = excluded.validating_airline_code,
         validating_airline_name = excluded.validating_airline_name,
         cabin_class = excluded.cabin_class,
         fare_family = excluded.fare_family,
         baggage_pieces = excluded.baggage_pieces,
         issuance_deadline = excluded.issuance_deadline,
         exchange_rate = excluded.exchange_rate,
         mileage = excluded.mileage,
         reference_fare_minor = excluded.reference_fare_minor,
         fare_amount_minor = excluded.fare_amount_minor,
         tax_amount_minor = excluded.tax_amount_minor,
         rav_amount_minor = excluded.rav_amount_minor,
         rac_amount_minor = excluded.rac_amount_minor,
         total_amount_minor = excluded.total_amount_minor,
         currency = excluded.currency,
         refundable = excluded.refundable,
         change_policy = excluded.change_policy,
         cancellation_policy = excluded.cancellation_policy,
         notes = excluded.notes,
         metadata = excluded.metadata,
         updated_at = now()`,
      [
        principal.tenantId,
        quoteOptionId,
        option.input.reservationSystem,
        option.input.locator || null,
        option.input.airlineCode,
        option.input.airlineName,
        option.input.cabinClass,
        option.input.fareFamily || null,
        option.input.baggagePieces,
        option.input.issuanceDeadline || null,
        option.input.exchangeRate,
        option.input.mileage,
        moneyToMinorUnits(option.input.referenceFare),
        option.pricing.fareMinor,
        option.pricing.taxesMinor,
        option.pricing.ravMinor,
        option.pricing.racMinor,
        option.pricing.totalMinor,
        option.input.currency,
        option.input.refundable ?? null,
        option.input.changePolicy || null,
        option.input.cancellationPolicy || null,
        option.input.notes || null,
        JSON.stringify(metadata),
      ],
    )
    for (const segment of option.input.segments) {
      await client.query(
        `insert into air_quote_segments (
           tenant_id, quote_option_id, sequence, airline_code, airline_name,
           flight_number, booking_class, cabin_class, baggage_pieces,
           origin_code, origin_name, destination_code, destination_name,
           departs_at, arrives_at, equipment, metadata
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, '{}'::jsonb
         )
         on conflict (tenant_id, quote_option_id, sequence) do update set
           airline_code = excluded.airline_code,
           airline_name = excluded.airline_name,
           flight_number = excluded.flight_number,
           booking_class = excluded.booking_class,
           cabin_class = excluded.cabin_class,
           baggage_pieces = excluded.baggage_pieces,
           origin_code = excluded.origin_code,
           origin_name = excluded.origin_name,
           destination_code = excluded.destination_code,
           destination_name = excluded.destination_name,
           departs_at = excluded.departs_at,
           arrives_at = excluded.arrives_at,
           equipment = excluded.equipment,
           updated_at = now()`,
        [
          principal.tenantId,
          quoteOptionId,
          segment.sequence,
          segment.airlineCode,
          segment.airlineName,
          segment.flightNumber,
          segment.bookingClass,
          segment.cabinClass,
          segment.baggagePieces,
          segment.originCode,
          segment.originName || null,
          segment.destinationCode,
          segment.destinationName || null,
          segment.departsAt,
          segment.arrivesAt,
          segment.equipment || null,
        ],
      )
    }
  }
}

async function loadOfflineAirQuoteById(
  principal: RequestPrincipal,
  demandId: string,
  quoteId: string,
): Promise<OfflineAirQuoteReadModel | null> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const rows = await loadAirQuoteRows(client, principal.tenantId, demandId, quoteId)
    return mapAirQuoteRows(rows)[0] || null
  })
}

async function loadAirQuoteRows(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  quoteId: string | null = null,
): Promise<AirQuoteRow[]> {
  const result = await client.query<AirQuoteRow>(
    `select quote.id as quote_id, quote.demand_id, demand.demand_number,
            demand.lifecycle_status, demand.lifecycle_version,
            quote.status as quote_status, quote.expires_at,
            quote.created_at as quote_created_at,
            quote.updated_at as quote_updated_at,
            option_row.id as option_id, option_row.provider_option_id,
            option_row.metadata as option_metadata, option_row.refundable,
            detail.reservation_system, detail.locator,
            detail.validating_airline_code, detail.validating_airline_name,
            detail.cabin_class, detail.fare_family, detail.baggage_pieces,
            detail.issuance_deadline, detail.exchange_rate, detail.mileage,
            detail.reference_fare_minor, detail.fare_amount_minor,
            detail.tax_amount_minor, detail.rav_amount_minor,
            detail.rac_amount_minor, detail.total_amount_minor, detail.currency,
            detail.change_policy, detail.cancellation_policy,
            detail.metadata as detail_metadata, detail.notes as detail_notes,
            segment.id as segment_id, segment.sequence as segment_sequence,
            segment.airline_code as segment_airline_code,
            segment.airline_name as segment_airline_name,
            segment.flight_number, segment.booking_class,
            segment.cabin_class as segment_cabin_class,
            segment.baggage_pieces as segment_baggage_pieces,
            segment.origin_code, segment.origin_name,
            segment.destination_code, segment.destination_name,
            segment.departs_at, segment.arrives_at, segment.equipment,
            selection.id as selection_id, selection.status as selection_status,
            selection.chosen_at as selection_chosen_at,
            selection.approval_instance_id, approval.status as approval_status,
            approval.completed_at as approval_completed_at
     from travel_quotes quote
     join demands demand
       on demand.tenant_id = quote.tenant_id and demand.id = quote.demand_id
     join travel_quote_options option_row
       on option_row.tenant_id = quote.tenant_id and option_row.quote_id = quote.id
     join air_quote_option_details detail
       on detail.tenant_id = option_row.tenant_id and detail.quote_option_id = option_row.id
     join air_quote_segments segment
       on segment.tenant_id = detail.tenant_id and segment.quote_option_id = detail.quote_option_id
     left join travel_quote_selections selection
       on selection.tenant_id = option_row.tenant_id and selection.option_id = option_row.id
      and selection.status in ('selected', 'pending_approval', 'approved')
     left join approval_instances approval
       on approval.tenant_id = selection.tenant_id and approval.id = selection.approval_instance_id
     where quote.tenant_id = $1 and quote.demand_id = $2
       and quote.provider = $3 and quote.service_type = 'aereo'
       and ($4::uuid is null or quote.id = $4::uuid)
     order by quote.created_at desc, quote.id, option_row.created_at,
              option_row.id, segment.sequence`,
    [tenantId, demandId, PROVIDER, quoteId],
  )
  return result.rows
}

function mapAirQuoteRows(rows: AirQuoteRow[]): OfflineAirQuoteReadModel[] {
  const quotes = new Map<string, OfflineAirQuoteReadModel>()
  const options = new Map<string, OfflineAirQuoteOptionReadModel>()
  for (const row of rows) {
    let quote = quotes.get(row.quote_id)
    if (!quote) {
      quote = {
        id: row.quote_id,
        demandId: row.demand_id,
        demandNumber: row.demand_number,
        status: quoteStatus(row.quote_status),
        lifecycleStatus: row.lifecycle_status,
        lifecycleVersion: Number(row.lifecycle_version),
        expiresAt: dateTimeOrNull(row.expires_at),
        selectedOptionId: null,
        options: [],
        createdAt: requiredDateTime(row.quote_created_at),
        updatedAt: requiredDateTime(row.quote_updated_at),
      }
      quotes.set(row.quote_id, quote)
    }
    let option = options.get(row.option_id)
    if (!option) {
      const canonical = recordValue(recordValue(row.option_metadata).offlineAir)
      option = {
        id: row.option_id,
        clientId: stringValue(canonical.clientId) || providerClientId(row.provider_option_id),
        reservationSystem: row.reservation_system,
        locator: row.locator,
        airlineCode: row.validating_airline_code,
        airlineName: row.validating_airline_name,
        cabinClass: airCabinClass(row.cabin_class),
        fareFamily: row.fare_family,
        baggagePieces: Number(row.baggage_pieces),
        issuanceDeadline: dateTimeOrNull(row.issuance_deadline),
        refundable: row.refundable,
        fareRules: nullableString(recordValue(row.detail_metadata).fareRules ?? canonical.fareRules),
        cancellationPolicy: row.cancellation_policy,
        changePolicy: row.change_policy,
        notes: row.detail_notes,
        pricing: {
          fare: minorUnitsToMoney(Number(row.fare_amount_minor)),
          taxes: minorUnitsToMoney(Number(row.tax_amount_minor)),
          rav: minorUnitsToMoney(Number(row.rav_amount_minor)),
          rac: minorUnitsToMoney(Number(row.rac_amount_minor)),
          total: minorUnitsToMoney(Number(row.total_amount_minor)),
          currency: row.currency,
          exchangeRate: Number(row.exchange_rate),
          referenceFare: minorUnitsToMoney(Number(row.reference_fare_minor)),
          mileage: Number(row.mileage),
        },
        segments: [],
        selected: Boolean(row.selection_id),
        selectionId: row.selection_id,
        selectionStatus: row.selection_status,
        selectedAt: dateTimeOrNull(row.selection_chosen_at),
        approvalInstanceId: row.approval_instance_id,
        approvalStatus: row.approval_status,
        approvedAt: dateTimeOrNull(row.approval_completed_at),
      }
      options.set(row.option_id, option)
      quote.options.push(option)
      if (option.selected) quote.selectedOptionId = option.id
    }
    option.segments.push(mapSegment(row))
  }
  return [...quotes.values()]
}

function mapSegment(row: AirQuoteRow): OfflineAirQuoteSegmentReadModel {
  return {
    id: row.segment_id,
    sequence: Number(row.segment_sequence),
    airlineCode: row.segment_airline_code,
    airlineName: row.segment_airline_name,
    flightNumber: row.flight_number,
    bookingClass: row.booking_class,
    cabinClass: airCabinClass(row.segment_cabin_class),
    baggagePieces: Number(row.segment_baggage_pieces),
    originCode: row.origin_code,
    originName: row.origin_name,
    destinationCode: row.destination_code,
    destinationName: row.destination_name,
    departsAt: requiredDateTime(row.departs_at),
    arrivesAt: requiredDateTime(row.arrives_at),
    equipment: row.equipment,
  }
}

function airOptionMetadata(option: PreparedAirOption): Record<string, unknown> {
  return {
    clientId: option.input.clientId,
    airlineName: option.input.airlineName,
    airlineCode: option.input.airlineCode,
    reservationSystem: option.input.reservationSystem,
    locator: option.input.locator || null,
    ticketingDeadline: option.input.issuanceDeadline || null,
    segments: option.input.segments.map((segment) => ({
      sequence: segment.sequence,
      airlineCode: segment.airlineCode,
      airlineName: segment.airlineName,
      flightNumber: segment.flightNumber,
      bookingClass: segment.bookingClass,
      cabinClass: segment.cabinClass,
      baggagePieces: segment.baggagePieces,
      originCode: segment.originCode,
      originName: segment.originName || null,
      destinationCode: segment.destinationCode,
      destinationName: segment.destinationName || null,
      departsAt: segment.departsAt,
      arrivesAt: segment.arrivesAt,
      equipment: segment.equipment || null,
    })),
    pricing: {
      fare: option.pricing.fare,
      taxes: option.pricing.taxes,
      rav: option.pricing.rav,
      rac: option.pricing.rac,
      total: option.pricing.total,
      currency: option.input.currency,
      exchangeRate: option.input.exchangeRate,
      referenceFare: option.input.referenceFare,
      mileage: option.input.mileage,
    },
    refundable: option.input.refundable ?? null,
    fareRules: option.input.fareRules || null,
    cancellationPolicy: option.input.cancellationPolicy || null,
    changePolicy: option.input.changePolicy || null,
    notes: option.input.notes || null,
  }
}

function normalizeExpiry(
  explicit: string | undefined,
  options: PreparedAirOption[],
): string | undefined {
  const candidates = [
    explicit,
    ...options.map((option) => option.input.issuanceDeadline),
  ].flatMap((value) => value && Number.isFinite(Date.parse(value))
    ? [new Date(value).toISOString()]
    : [])
  const firstDeparture = Math.min(...options.map((option) => Date.parse(option.startsAt)))
  const fallbackTime = Math.min(
    Date.now() + 24 * 60 * 60 * 1_000,
    firstDeparture - 60 * 60 * 1_000,
  )
  const expiresAt = candidates.sort()[0] || new Date(fallbackTime).toISOString()
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new TravelGovernanceError(
      'OFFLINE_AIR_QUOTE_EXPIRY_INVALID',
      'A validade da cotacao aerea deve estar no futuro.',
      422,
    )
  }
  return expiresAt
}

function routeLabel(segments: OfflineAirQuoteSegmentInput[]): string {
  const ordered = [...segments].sort((left, right) => left.sequence - right.sequence)
  return [ordered[0].originCode, ...ordered.map((segment) => segment.destinationCode)].join(' - ')
}

function cabinClassLabel(value: string): string {
  return ({
    economy: 'Economica',
    premium_economy: 'Economica premium',
    business: 'Executiva',
    first: 'Primeira classe',
  } as Record<string, string>)[value] || value
}

function airCabinClass(value: string): OfflineAirQuoteSegmentReadModel['cabinClass'] {
  if (['economy', 'premium_economy', 'business', 'first'].includes(value)) {
    return value as OfflineAirQuoteSegmentReadModel['cabinClass']
  }
  throw new TravelGovernanceError(
    'OFFLINE_AIR_QUOTE_READ_MODEL_INVALID',
    'A cotacao aerea possui classe de cabine invalida.',
    500,
  )
}

function quoteStatus(value: string): OfflineAirQuoteReadModel['status'] {
  if (['pending', 'completed', 'selected', 'expired', 'failed'].includes(value)) {
    return value as OfflineAirQuoteReadModel['status']
  }
  throw new TravelGovernanceError(
    'OFFLINE_AIR_QUOTE_STATUS_INVALID',
    'Estado da cotacao aerea invalido.',
    500,
  )
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function dateTimeOrNull(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function requiredDateTime(value: unknown): string {
  const normalized = dateTimeOrNull(value)
  if (!normalized) {
    throw new TravelGovernanceError(
      'OFFLINE_AIR_QUOTE_READ_MODEL_INVALID',
      'A cotacao aerea possui uma data invalida.',
      500,
    )
  }
  return normalized
}

function providerClientId(value: string): string {
  return value.replace(/^offline-air-option:/, '')
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableString(value: unknown): string | null {
  return stringValue(value) || null
}

async function assertRequesterOwnsDemand(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: Pick<AirDemandRow, 'requester_id' | 'company_id'>,
): Promise<void> {
  if (principal.roleKey !== 'requester') return
  const result = await client.query(
    `select 1 from requesters
     where tenant_id = $1 and id = $2 and company_id = $3
       and user_id = $4 and status = 'active' and deleted_at is null`,
    [principal.tenantId, demand.requester_id, demand.company_id, principal.user.id],
  )
  if (!result.rows[0]) {
    throw new TravelGovernanceError(
      'OFFLINE_AIR_QUOTE_REQUESTER_MISMATCH',
      'Somente o solicitante responsavel pode consultar esta cotacao aerea.',
      403,
    )
  }
}

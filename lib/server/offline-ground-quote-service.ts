import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import type { TravelQuote, TravelQuoteOption, TravelQuoteRequest } from '@/lib/integrations/types'
import { offlineServiceFromDemand } from '@/lib/offline-travel/catalog'
import { minorUnitsToMoney } from '@/lib/offline-travel/money'
import {
  offlineGroundQuoteCreateSchema,
  type OfflineBusQuoteCreateInput,
  type OfflineBusQuoteOptionReadModel,
  type OfflineCarQuoteCreateInput,
  type OfflineCarQuoteOptionReadModel,
  type OfflineGroundQuoteCreateInput,
  type OfflineGroundQuoteCatalogReadModel,
  type OfflineGroundQuoteListReadModel,
  type OfflineGroundQuoteOptionReadModel,
  type OfflineGroundQuoteReadModel,
  type OfflineGroundQuoteService,
  type OfflineGroundSelectionStatus,
} from '@/lib/offline-ground/quote-schema'
import { offlineGroundQuoteMaterialHash } from '@/lib/offline-ground/quote-idempotency'
import { sha256 } from '@/lib/policy'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { loadOfflinePolicyTravelers } from '@/lib/server/offline-travel-service'
import {
  executeGovernedTravelQuote,
  TravelGovernanceError,
} from '@/lib/server/travel-governance-service'

const PROVIDER = 'manual-offline' as const
const ACTIVE_SELECTION_STATUSES = ['selected', 'pending_approval', 'approved'] as const

interface GroundDemandRow extends QueryResultRow {
  id: string
  company_id: string
  group_id: string | null
  requester_id: string | null
  demand_number: string
  service_type: string
  lifecycle_status: string
  lifecycle_version: string | number
  travel_start_date: string | Date | null
  travel_end_date: string | Date | null
  destination: string | null
}

interface CarDemandRow extends QueryResultRow {
  pickup_location_id: string | null
  return_location_id: string | null
  pickup_location_text: string | null
  return_location_text: string | null
  pickup_at: string | Date
  return_at: string | Date
}

interface BusDemandLegRow extends QueryResultRow {
  id: string
  sequence: string | number
  origin_city_id: string
  destination_city_id: string
  origin_city_name: string
  destination_city_name: string
  origin_terminal_id: string | null
  destination_terminal_id: string | null
  valid_from: string | Date | null
  valid_until: string | Date | null
  departure_date: string | Date
  earliest_departure: string | null
  latest_departure: string | null
}

interface SupplierRow extends QueryResultRow {
  id: string
  supplier_name: string
  internal_code: string
}

interface RentalLocationRow extends QueryResultRow {
  id: string
  supplier_id: string
  name: string
}

interface BusRouteRow extends QueryResultRow {
  id: string
  supplier_id: string
  route_code: string
  origin_city_id: string
  destination_city_id: string
  origin_terminal_id: string | null
  destination_terminal_id: string | null
  origin_timezone: string | null
  destination_timezone: string | null
}

interface BusTerminalRow extends QueryResultRow {
  id: string
}

interface QuoteCatalogLocationRow extends QueryResultRow {
  id: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  name: string
  city_name: string | null
  address_text: string | null
}

interface QuoteCatalogRouteRow extends QueryResultRow {
  id: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  route_code: string
  origin_city_id: string
  destination_city_id: string
  origin_terminal_id: string | null
  destination_terminal_id: string | null
  origin_city_name: string
  destination_city_name: string
  origin_timezone: string | null
  destination_timezone: string | null
}

interface GroundQuoteRow extends QueryResultRow {
  quote_id: string
  demand_id: string
  demand_number: string
  service_type: string
  lifecycle_status: string
  lifecycle_version: string | number
  quote_status: string
  expires_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
  option_id: string
  provider_option_id: string
  supplier_name: string | null
  supplier_code: string | null
  title: string
  subtitle: string | null
  starts_at: string | Date | null
  ends_at: string | Date | null
  amount: string | number | null
  currency: string
  refundable: boolean | null
  option_metadata: Record<string, unknown> | null
  selection_id: string | null
  selection_status: string | null
  approval_instance_id: string | null
  approval_status: string | null
  supplier_id: string
  pickup_location_id: string | null
  pickup_location_name: string | null
  return_location_id: string | null
  return_location_name: string | null
  category_code: string | null
  category_name: string | null
  vehicle_example: string | null
  rental_days: string | number | null
  daily_amount_minor: string | number | null
  protection_amount_minor: string | number | null
  fee_amount_minor: string | number | null
  tax_amount_minor: string | number | null
  total_amount_minor: string | number
  mileage_policy: string | null
  fuel_policy: string | null
  deposit_policy: string | null
  protections: unknown
  cancellation_policy: string | null
  issuance_deadline: string | Date | null
  route_id: string | null
  route_code: string | null
  service_number: string | null
  class_name: string | null
  baggage_pieces: string | number | null
  fare_amount_minor: string | number | null
  change_policy: string | null
  detail_metadata: Record<string, unknown> | null
}

interface BusSegmentReadRow extends QueryResultRow {
  id: string
  quote_option_id: string
  demand_leg_id: string | null
  route_id: string
  route_code: string
  sequence: string | number
  origin_city_id: string
  destination_city_id: string
  origin_city_name: string
  destination_city_name: string
  origin_terminal_id: string | null
  destination_terminal_id: string | null
  origin_terminal_name: string | null
  destination_terminal_name: string | null
  departs_at: string | Date
  arrives_at: string | Date
  service_number: string | null
  class_name: string
  seat_available: boolean | null
  metadata: Record<string, unknown> | null
}

interface PreparedCarQuote {
  demand: GroundDemandRow
  detail: CarDemandRow
  input: OfflineCarQuoteCreateInput
  options: Array<OfflineCarQuoteCreateInput['options'][number] & {
    supplierName: string
    supplierCode: string
    pickupLocationName: string
    returnLocationName: string
    providerOptionId: string
  }>
}

interface PreparedBusQuote {
  demand: GroundDemandRow
  legs: BusDemandLegRow[]
  input: OfflineBusQuoteCreateInput
  options: Array<OfflineBusQuoteCreateInput['options'][number] & {
    supplierName: string
    supplierCode: string
    routeCode: string | null
    providerOptionId: string
  }>
}

type PreparedGroundQuote = PreparedCarQuote | PreparedBusQuote

export interface OfflineGroundQuoteCreationResult {
  item: OfflineGroundQuoteReadModel
  replayed: boolean
}

export async function createOfflineGroundQuote(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<OfflineGroundQuoteCreationResult> {
  const input = offlineGroundQuoteCreateSchema.parse(rawInput)
  const materialPayloadHash = offlineGroundQuoteMaterialHash(input)
  const prepared = input.service === 'locacao'
    ? await prepareCarQuote(principal, input)
    : await prepareBusQuote(principal, input)
  const createdAt = new Date().toISOString()
  const providerQuoteId = `offline-ground:${sha256({
    tenantId: principal.tenantId,
    demandId: input.demandId,
    service: input.service,
    idempotencyKey: input.idempotencyKey,
  }).slice(0, 48)}`
  const quoteOptions = 'detail' in prepared
    ? carTravelOptions(prepared)
    : busTravelOptions(prepared)
  const request: TravelQuoteRequest = {
    demandId: prepared.demand.id,
    expectedLifecycleVersion: input.expectedLifecycleVersion,
    idempotencyKey: input.idempotencyKey,
    policyJustification: input.policyJustification,
    service: input.service,
    empresaId: prepared.demand.company_id,
    destino: prepared.demand.destination || undefined,
    dataInicio: dateOnly(prepared.demand.travel_start_date),
    dataFim: dateOnly(prepared.demand.travel_end_date),
    raw: {
      channel: 'offline',
      manualOffline: true,
      offlineGround: true,
      service: input.service,
      optionCount: quoteOptions.length,
      materialPayloadHash,
      serial_os: prepared.demand.demand_number,
    },
  }
  const expiresAt = normalizeExpiry(input.expiresAt, prepared)
  const execution = await executeGovernedTravelQuote(
    principal,
    request,
    input.idempotencyKey,
    async (providerRequest): Promise<TravelQuote> => ({
      id: providerQuoteId,
      provider: PROVIDER,
      service: input.service,
      request: providerRequest,
      options: quoteOptions,
      raw: {
        source: PROVIDER,
        offlineGround: true,
        optionCount: quoteOptions.length,
        materialPayloadHash,
      },
      createdAt,
      expiresAt,
      warnings: [],
    }),
    {
      provider: PROVIDER,
      loadPolicyTravelers: async ({ client, demand }) => loadOfflinePolicyTravelers(
        client,
        principal.tenantId,
        demand,
        'quotation',
        { serviceKey: input.service },
      ),
      persistOptionDetails: async (context) => {
        if ('detail' in prepared) {
          await persistCarOptionDetails(context.client, principal, prepared, context.optionIdsByProviderId)
        } else {
          await persistBusOptionDetails(context.client, principal, prepared, context.optionIdsByProviderId)
        }
        await supersedePreviousGroundQuoteRounds(
          context.client,
          principal,
          context.demandId,
          context.databaseQuoteId,
          input.service,
        )
      },
    },
  )
  const item = await loadOfflineGroundQuoteById(
    principal,
    execution.demandId,
    execution.databaseQuoteId,
    input.service,
  )
  if (!item) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_QUOTE_READ_MODEL_NOT_FOUND',
      'A cotacao terrestre foi publicada, mas nao pode ser relida.',
      500,
    )
  }
  return { item, replayed: execution.replayed }
}

export async function listOfflineGroundQuotes(
  principal: RequestPrincipal,
  demandId: string,
  expectedService?: OfflineGroundQuoteService,
): Promise<OfflineGroundQuoteListReadModel> {
  const normalizedDemandId = String(demandId || '').trim()
  if (!normalizedDemandId) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_QUOTE_DEMAND_REQUIRED',
      'Informe a demanda para consultar cotacoes terrestres.',
      400,
    )
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadGroundDemand(client, principal.tenantId, normalizedDemandId)
    await requireCompanyAccess(principal, demand.company_id, 'ver_reservas')
    await assertRequesterOwnsDemand(client, principal, demand)
    const service = groundService(demand.service_type)
    if (expectedService && expectedService !== service) {
      throw new TravelGovernanceError(
        'OFFLINE_GROUND_QUOTE_SERVICE_MISMATCH',
        'O servico consultado nao corresponde ao servico da demanda.',
        409,
      )
    }
    const rows = await loadGroundQuoteRows(client, principal.tenantId, demand.id, service)
    const segmentRows = service === 'rodoviario'
      ? await loadBusSegmentRows(client, principal.tenantId, rows.map((row) => row.option_id))
      : []
    return {
      demandId: demand.id,
      service,
      lifecycleStatus: demand.lifecycle_status,
      lifecycleVersion: positiveInteger(demand.lifecycle_version),
      quotes: mapGroundQuoteRows(rows, segmentRows, service),
    }
  })
}

export async function listOfflineGroundQuoteCatalog(
  principal: RequestPrincipal,
  demandId: string,
  expectedService: OfflineGroundQuoteService,
): Promise<OfflineGroundQuoteCatalogReadModel> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadGroundDemand(client, principal.tenantId, demandId)
    await requireCompanyAccess(principal, demand.company_id, 'operar_cotacoes')
    assertGroundService(demand, expectedService)
    if (expectedService === 'locacao') {
      const rows = (await client.query<QuoteCatalogLocationRow>(
        `select location.id, location.supplier_id,
                coalesce(supplier.trade_name, supplier.legal_name) as supplier_name,
                supplier.internal_code::text as supplier_code,
                location.name, city.name as city_name, location.address_text
         from rental_locations location
         join commercial_suppliers supplier
           on supplier.tenant_id = location.tenant_id and supplier.id = location.supplier_id
          and supplier.status = 'active' and supplier.deleted_at is null
          and supplier.service_types @> array['car']::text[]
         left join geo_cities city on city.id = location.city_id
         where location.tenant_id = $1 and location.status = 'active'
           and location.deleted_at is null and location.review_status = 'verified'
         order by supplier_name, city.name nulls last, location.name`,
        [principal.tenantId],
      )).rows
      return {
        demandId: demand.id,
        service: expectedService,
        suppliers: uniqueSuppliers(rows, expectedService),
        rentalLocations: rows.map((row) => ({
          id: row.id,
          supplierId: row.supplier_id,
          name: row.name,
          cityName: row.city_name,
          addressText: row.address_text,
        })),
        busRoutes: [],
      }
    }
    const rows = (await client.query<QuoteCatalogRouteRow>(
      `select route.id, route.supplier_id,
              coalesce(supplier.trade_name, supplier.legal_name) as supplier_name,
              supplier.internal_code::text as supplier_code,
              route.route_code::text, route.origin_city_id, route.destination_city_id,
              route.origin_terminal_id, route.destination_terminal_id,
              coalesce(origin_terminal.timezone, 'UTC') as origin_timezone,
              coalesce(destination_terminal.timezone, 'UTC') as destination_timezone,
              origin.name as origin_city_name,
              destination.name as destination_city_name
       from bus_routes route
       join commercial_suppliers supplier
         on supplier.tenant_id = route.tenant_id and supplier.id = route.supplier_id
        and supplier.status = 'active' and supplier.deleted_at is null
        and supplier.service_types @> array['bus']::text[]
       join geo_cities origin on origin.id = route.origin_city_id
       join geo_cities destination on destination.id = route.destination_city_id
       left join bus_terminals origin_terminal
         on origin_terminal.tenant_id = route.tenant_id and origin_terminal.id = route.origin_terminal_id
       left join bus_terminals destination_terminal
         on destination_terminal.tenant_id = route.tenant_id and destination_terminal.id = route.destination_terminal_id
       where route.tenant_id = $1 and route.status = 'active'
         and route.deleted_at is null and route.review_status = 'verified'
         and (route.valid_from is null or route.valid_from <= current_date)
         and (route.valid_until is null or route.valid_until >= current_date)
       order by supplier_name, origin.name, destination.name, route.route_code`,
      [principal.tenantId],
    )).rows
    return {
      demandId: demand.id,
      service: expectedService,
      suppliers: uniqueSuppliers(rows, expectedService),
      rentalLocations: [],
      busRoutes: rows.map((row) => ({
        id: row.id,
        supplierId: row.supplier_id,
        routeCode: row.route_code,
        originCityId: row.origin_city_id,
        destinationCityId: row.destination_city_id,
        originTerminalId: row.origin_terminal_id,
        destinationTerminalId: row.destination_terminal_id,
        originTimezone: row.origin_timezone || 'UTC',
        destinationTimezone: row.destination_timezone || 'UTC',
        label: `${row.origin_city_name} - ${row.destination_city_name} (${row.route_code})`,
      })),
    }
  })
}

async function prepareCarQuote(
  principal: RequestPrincipal,
  input: OfflineCarQuoteCreateInput,
): Promise<PreparedCarQuote> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadGroundDemand(client, principal.tenantId, input.demandId)
    await requireCompanyAccess(principal, demand.company_id, 'operar_cotacoes')
    assertGroundService(demand, input.service)
    const detail = (await client.query<CarDemandRow>(
      `select pickup_location_id, return_location_id,
              pickup_location_text, return_location_text, pickup_at, return_at
       from car_demand_details
       where tenant_id = $1 and demand_id = $2`,
      [principal.tenantId, demand.id],
    )).rows[0]
    if (!detail) {
      throw new TravelGovernanceError(
        'OFFLINE_CAR_DEMAND_DETAILS_REQUIRED',
        'A demanda nao possui retirada e devolucao estruturadas para cotacao.',
        422,
      )
    }
    const suppliers = await loadSuppliers(
      client,
      principal.tenantId,
      input.options.map((option) => option.details.supplierId),
      'car',
    )
    const locationIds = input.options.flatMap((option) => [
      option.details.pickupLocationId,
      option.details.returnLocationId,
    ])
    const locations = (await client.query<RentalLocationRow>(
      `select id, supplier_id, name
       from rental_locations
       where tenant_id = $1 and id = any($2::uuid[])
         and status = 'active' and deleted_at is null
         and review_status = 'verified'`,
      [principal.tenantId, Array.from(new Set(locationIds))],
    )).rows
    const locationById = new Map(locations.map((location) => [location.id, location]))
    const rentalDays = Math.max(1, Math.ceil(
      (new Date(detail.return_at).getTime() - new Date(detail.pickup_at).getTime()) / 86_400_000,
    ))
    const options = input.options.map((option) => {
      const supplier = suppliers.get(option.details.supplierId)
      const pickup = locationById.get(option.details.pickupLocationId)
      const returned = locationById.get(option.details.returnLocationId)
      if (!supplier || !pickup || !returned
          || pickup.supplier_id !== supplier.id || returned.supplier_id !== supplier.id) {
        throw new TravelGovernanceError(
          'OFFLINE_CAR_QUOTE_CATALOG_SCOPE_INVALID',
          'A locadora ou uma das lojas da opcao nao esta ativa para este tenant.',
          422,
          { clientId: option.clientId },
        )
      }
      if (
        option.details.pickupLocationId !== detail.pickup_location_id
        || option.details.returnLocationId !== detail.return_location_id
      ) {
        throw new TravelGovernanceError(
          'OFFLINE_CAR_QUOTE_REQUEST_LOCATION_MISMATCH',
          'As lojas da opcao devem corresponder a retirada e devolucao solicitadas.',
          422,
          { clientId: option.clientId },
        )
      }
      if (option.details.rentalDays !== rentalDays) {
        throw new TravelGovernanceError(
          'OFFLINE_CAR_QUOTE_RENTAL_DAYS_MISMATCH',
          'A quantidade de diarias nao corresponde ao periodo solicitado.',
          422,
          { clientId: option.clientId, expectedRentalDays: rentalDays },
        )
      }
      return {
        ...option,
        supplierName: supplier.supplier_name,
        supplierCode: supplier.internal_code,
        pickupLocationName: pickup.name,
        returnLocationName: returned.name,
        providerOptionId: `offline-ground:${option.clientId}`,
      }
    })
    return { demand, detail, input, options }
  })
}

async function prepareBusQuote(
  principal: RequestPrincipal,
  input: OfflineBusQuoteCreateInput,
): Promise<PreparedBusQuote> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadGroundDemand(client, principal.tenantId, input.demandId)
    await requireCompanyAccess(principal, demand.company_id, 'operar_cotacoes')
    assertGroundService(demand, input.service)
    const legs = (await client.query<BusDemandLegRow>(
      `select leg.id, leg.sequence, leg.origin_city_id, leg.destination_city_id,
              origin.name as origin_city_name, destination.name as destination_city_name,
              leg.origin_terminal_id, leg.destination_terminal_id,
              leg.departure_date, leg.earliest_departure::text, leg.latest_departure::text
       from bus_demand_details detail
       join bus_demand_legs leg
         on leg.tenant_id = detail.tenant_id and leg.demand_id = detail.demand_id
       join geo_cities origin on origin.id = leg.origin_city_id
       join geo_cities destination on destination.id = leg.destination_city_id
       where detail.tenant_id = $1 and detail.demand_id = $2
       order by leg.sequence`,
      [principal.tenantId, demand.id],
    )).rows
    if (!legs.length) {
      throw new TravelGovernanceError(
        'OFFLINE_BUS_DEMAND_LEGS_REQUIRED',
        'A demanda nao possui trechos rodoviarios estruturados para cotacao.',
        422,
      )
    }
    const suppliers = await loadSuppliers(
      client,
      principal.tenantId,
      input.options.map((option) => option.details.supplierId),
      'bus',
    )
    const routeIds = input.options.flatMap((option) => (
      option.details.segments.map((segment) => segment.routeId)
    ))
    const routes = routeIds.length
      ? (await client.query<BusRouteRow>(
          `select route.id, route.supplier_id, route.route_code::text,
                  route.origin_city_id, route.destination_city_id,
                  route.origin_terminal_id, route.destination_terminal_id,
                  route.valid_from, route.valid_until,
                  coalesce(origin_terminal.timezone, 'UTC') as origin_timezone,
                  coalesce(destination_terminal.timezone, 'UTC') as destination_timezone
           from bus_routes route
           left join bus_terminals origin_terminal
             on origin_terminal.tenant_id = route.tenant_id and origin_terminal.id = route.origin_terminal_id
           left join bus_terminals destination_terminal
             on destination_terminal.tenant_id = route.tenant_id and destination_terminal.id = route.destination_terminal_id
           where route.tenant_id = $1 and route.id = any($2::uuid[])
             and route.status = 'active' and route.deleted_at is null
             and route.review_status = 'verified'`,
          [principal.tenantId, Array.from(new Set(routeIds))],
        )).rows
      : []
    const routeById = new Map(routes.map((route) => [route.id, route]))
    const legById = new Map(legs.map((leg) => [leg.id, leg]))
    const terminalIds = Array.from(new Set(input.options.flatMap((option) => (
      option.details.segments.flatMap((segment) => [
        segment.originTerminalId,
        segment.destinationTerminalId,
      ].filter((value): value is string => Boolean(value)))
    ))))
    const verifiedTerminals = terminalIds.length
      ? (await client.query<BusTerminalRow>(
          `select id from bus_terminals
           where tenant_id = $1 and id = any($2::uuid[])
             and status = 'active' and deleted_at is null
             and review_status = 'verified'`,
          [principal.tenantId, terminalIds],
        )).rows
      : []
    const verifiedTerminalIds = new Set(verifiedTerminals.map((terminal) => terminal.id))
    if (verifiedTerminalIds.size !== terminalIds.length) {
      throw new TravelGovernanceError(
        'OFFLINE_BUS_QUOTE_TERMINAL_SCOPE_INVALID',
        'Use somente terminais rodoviarios ativos e verificados.',
        422,
      )
    }
    const options = input.options.map((option) => {
      const supplier = suppliers.get(option.details.supplierId)
      if (!supplier) {
        throw new TravelGovernanceError(
          'OFFLINE_BUS_QUOTE_CATALOG_SCOPE_INVALID',
          'A empresa rodoviaria da opcao nao esta ativa para este tenant.',
          422,
          { clientId: option.clientId },
        )
      }
      for (const segment of option.details.segments) {
        const route = routeById.get(segment.routeId)
        if (
          !route || route.supplier_id !== supplier.id
          || route.origin_city_id !== segment.originCityId
          || route.destination_city_id !== segment.destinationCityId
          || Boolean(route.origin_terminal_id && route.origin_terminal_id !== segment.originTerminalId)
          || Boolean(route.destination_terminal_id
            && route.destination_terminal_id !== segment.destinationTerminalId)
          || Boolean(route.valid_from && civilDate(segment.departsAt) < civilDate(route.valid_from))
          || Boolean(route.valid_until && civilDate(segment.departsAt) > civilDate(route.valid_until))
        ) {
          throw new TravelGovernanceError(
            'OFFLINE_BUS_QUOTE_ROUTE_MARKET_MISMATCH',
            'Cada linha selecionada deve corresponder ao fornecedor, mercado e terminais do segmento.',
            422,
            { clientId: option.clientId, routeId: segment.routeId },
          )
        }
      }
      const segments = normalizeAndValidateBusSegments(
        option.details.segments,
        legs,
        legById,
        verifiedTerminalIds,
        option.clientId,
      )
      if (segments.some((segment) => (
        segment.className !== option.details.className
        || Boolean(option.details.serviceNumber && segment.serviceNumber
          && segment.serviceNumber !== option.details.serviceNumber)
      ))) {
        throw new TravelGovernanceError(
          'OFFLINE_BUS_QUOTE_SERVICE_DETAILS_MISMATCH',
          'Classe e numero do servico devem ser coerentes em todos os segmentos.',
          422,
          { clientId: option.clientId },
        )
      }
      return {
        ...option,
        details: {
          ...option.details,
          routeId: segments.length === 1 ? segments[0]!.routeId : undefined,
          segments,
        },
        supplierName: supplier.supplier_name,
        supplierCode: supplier.internal_code,
        routeCode: Array.from(new Set(segments.map((segment) => routeById.get(segment.routeId)!.route_code))).join(' / '),
        providerOptionId: `offline-ground:${option.clientId}`,
      }
    })
    return { demand, legs, input, options }
  })
}

function carTravelOptions(prepared: PreparedCarQuote): TravelQuoteOption[] {
  return prepared.options.map((option) => ({
    id: option.providerOptionId,
    provider: PROVIDER,
    service: 'locacao',
    supplierName: option.supplierName,
    title: option.details.categoryName,
    subtitle: [option.details.vehicleExample, option.pickupLocationName].filter(Boolean).join(' - '),
    price: minorUnitsToMoney(option.details.totalAmountMinor),
    currency: option.details.currency,
    policyStatus: 'respeitada',
    startsAt: isoDateTime(prepared.detail.pickup_at),
    endsAt: isoDateTime(prepared.detail.return_at),
    metadata: {
      offlineGround: {
        service: 'locacao',
        clientId: option.clientId,
        supplierId: option.details.supplierId,
        pickupLocationId: option.details.pickupLocationId,
        returnLocationId: option.details.returnLocationId,
        categoryName: option.details.categoryName,
        rentalDays: option.details.rentalDays,
        totalAmountMinor: option.details.totalAmountMinor,
        currency: option.details.currency,
      },
    },
    raw: { source: PROVIDER, offlineGround: true, service: 'locacao' },
  }))
}

function busTravelOptions(prepared: PreparedBusQuote): TravelQuoteOption[] {
  const firstLeg = prepared.legs[0]
  const lastLeg = prepared.legs[prepared.legs.length - 1]
  return prepared.options.map((option) => ({
    id: option.providerOptionId,
    provider: PROVIDER,
    service: 'rodoviario',
    supplierName: option.supplierName,
    title: `${firstLeg.origin_city_name} - ${lastLeg.destination_city_name}`,
    subtitle: [option.details.className, option.details.serviceNumber].filter(Boolean).join(' - '),
    price: minorUnitsToMoney(option.details.totalAmountMinor),
    currency: option.details.currency,
    refundable: option.details.refundable,
    policyStatus: 'respeitada',
    startsAt: option.details.segments[0].departsAt,
    endsAt: option.details.segments[option.details.segments.length - 1].arrivesAt,
    city: lastLeg.destination_city_name,
    metadata: {
      offlineGround: {
        service: 'rodoviario',
        clientId: option.clientId,
        supplierId: option.details.supplierId,
        routeId: option.details.routeId || null,
        className: option.details.className,
        segmentCount: option.details.segments.length,
        totalAmountMinor: option.details.totalAmountMinor,
        currency: option.details.currency,
      },
    },
    raw: { source: PROVIDER, offlineGround: true, service: 'rodoviario' },
  }))
}

async function persistCarOptionDetails(
  client: PoolClient,
  principal: RequestPrincipal,
  prepared: PreparedCarQuote,
  optionIdsByProviderId: ReadonlyMap<string, string>,
): Promise<void> {
  for (const option of prepared.options) {
    const quoteOptionId = requiredQuoteOptionId(optionIdsByProviderId, option.providerOptionId)
    const detail = option.details
    await client.query(
      `insert into car_quote_option_details (
         tenant_id, quote_option_id, supplier_id, pickup_location_id,
         return_location_id, category_code, category_name, vehicle_example,
         rental_days, daily_amount_minor, protection_amount_minor,
         fee_amount_minor, tax_amount_minor, total_amount_minor, currency,
         mileage_policy, fuel_policy, deposit_policy, protections,
         cancellation_policy, issuance_deadline, metadata
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19::jsonb, $20, $21, $22::jsonb
       )
       on conflict (tenant_id, quote_option_id) do update set
         supplier_id = excluded.supplier_id,
         pickup_location_id = excluded.pickup_location_id,
         return_location_id = excluded.return_location_id,
         category_code = excluded.category_code,
         category_name = excluded.category_name,
         vehicle_example = excluded.vehicle_example,
         rental_days = excluded.rental_days,
         daily_amount_minor = excluded.daily_amount_minor,
         protection_amount_minor = excluded.protection_amount_minor,
         fee_amount_minor = excluded.fee_amount_minor,
         tax_amount_minor = excluded.tax_amount_minor,
         total_amount_minor = excluded.total_amount_minor,
         currency = excluded.currency,
         mileage_policy = excluded.mileage_policy,
         fuel_policy = excluded.fuel_policy,
         deposit_policy = excluded.deposit_policy,
         protections = excluded.protections,
         cancellation_policy = excluded.cancellation_policy,
         issuance_deadline = excluded.issuance_deadline,
         metadata = excluded.metadata,
         updated_at = now()`,
      [
        principal.tenantId,
        quoteOptionId,
        detail.supplierId,
        detail.pickupLocationId,
        detail.returnLocationId,
        detail.categoryCode || null,
        detail.categoryName,
        detail.vehicleExample || null,
        detail.rentalDays,
        detail.dailyAmountMinor,
        detail.protectionAmountMinor,
        detail.feeAmountMinor,
        detail.taxAmountMinor,
        detail.totalAmountMinor,
        detail.currency,
        detail.mileagePolicy || null,
        detail.fuelPolicy || null,
        detail.depositPolicy || null,
        JSON.stringify(detail.protections),
        detail.cancellationPolicy || null,
        detail.issuanceDeadline || null,
        JSON.stringify({ clientMetadata: detail.metadata, source: PROVIDER, clientId: option.clientId }),
      ],
    )
  }
}

async function persistBusOptionDetails(
  client: PoolClient,
  principal: RequestPrincipal,
  prepared: PreparedBusQuote,
  optionIdsByProviderId: ReadonlyMap<string, string>,
): Promise<void> {
  for (const option of prepared.options) {
    const quoteOptionId = requiredQuoteOptionId(optionIdsByProviderId, option.providerOptionId)
    const detail = option.details
    await client.query(
      `insert into bus_quote_option_details (
         tenant_id, quote_option_id, supplier_id, route_id, service_number,
         class_name, baggage_pieces, refundable, issuance_deadline,
         fare_amount_minor, tax_amount_minor, fee_amount_minor,
         total_amount_minor, currency, change_policy, cancellation_policy, metadata
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17::jsonb
       )
       on conflict (tenant_id, quote_option_id) do update set
         supplier_id = excluded.supplier_id,
         route_id = excluded.route_id,
         service_number = excluded.service_number,
         class_name = excluded.class_name,
         baggage_pieces = excluded.baggage_pieces,
         refundable = excluded.refundable,
         issuance_deadline = excluded.issuance_deadline,
         fare_amount_minor = excluded.fare_amount_minor,
         tax_amount_minor = excluded.tax_amount_minor,
         fee_amount_minor = excluded.fee_amount_minor,
         total_amount_minor = excluded.total_amount_minor,
         currency = excluded.currency,
         change_policy = excluded.change_policy,
         cancellation_policy = excluded.cancellation_policy,
         metadata = excluded.metadata,
         updated_at = now()`,
      [
        principal.tenantId,
        quoteOptionId,
        detail.supplierId,
        detail.routeId || null,
        detail.serviceNumber || null,
        detail.className,
        detail.baggagePieces,
        detail.refundable ?? null,
        detail.issuanceDeadline || null,
        detail.fareAmountMinor,
        detail.taxAmountMinor,
        detail.feeAmountMinor,
        detail.totalAmountMinor,
        detail.currency,
        detail.changePolicy || null,
        detail.cancellationPolicy || null,
        JSON.stringify({ clientMetadata: detail.metadata, source: PROVIDER, clientId: option.clientId }),
      ],
    )
    await client.query(
      `delete from bus_quote_segments where tenant_id = $1 and quote_option_id = $2`,
      [principal.tenantId, quoteOptionId],
    )
    for (const [index, segment] of detail.segments.entries()) {
      await client.query(
        `insert into bus_quote_segments (
           tenant_id, quote_option_id, demand_leg_id, route_id, sequence,
           origin_city_id, destination_city_id, origin_terminal_id,
           destination_terminal_id, departs_at, arrives_at, service_number,
           class_name, seat_available, metadata
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
         )`,
        [
          principal.tenantId,
          quoteOptionId,
          segment.demandLegId || null,
          segment.routeId,
          index + 1,
          segment.originCityId,
          segment.destinationCityId,
          segment.originTerminalId || null,
          segment.destinationTerminalId || null,
          segment.departsAt,
          segment.arrivesAt,
          segment.serviceNumber || null,
          segment.className,
          segment.seatAvailable ?? null,
          JSON.stringify({ clientMetadata: segment.metadata, source: PROVIDER }),
        ],
      )
    }
  }
}

async function loadGroundQuoteRows(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  service: OfflineGroundQuoteService,
  quoteId: string | null = null,
): Promise<GroundQuoteRow[]> {
  const result = await client.query<GroundQuoteRow>(
    `select quote.id as quote_id, quote.demand_id, demand.demand_number,
            quote.service_type, demand.lifecycle_status, demand.lifecycle_version,
            quote.status as quote_status, quote.expires_at,
            quote.created_at, quote.updated_at,
            option_row.id as option_id, option_row.provider_option_id,
            option_row.supplier_name, supplier.internal_code::text as supplier_code,
            option_row.title, option_row.subtitle, option_row.starts_at,
            option_row.ends_at, option_row.amount, option_row.currency,
            option_row.refundable, option_row.metadata as option_metadata,
            selection.id as selection_id, selection.status as selection_status,
            selection.approval_instance_id, approval.status as approval_status,
            coalesce(car.supplier_id, bus.supplier_id) as supplier_id,
            car.pickup_location_id, pickup.name as pickup_location_name,
            car.return_location_id, returned.name as return_location_name,
            car.category_code, car.category_name, car.vehicle_example,
            car.rental_days, car.daily_amount_minor, car.protection_amount_minor,
            coalesce(car.fee_amount_minor, bus.fee_amount_minor) as fee_amount_minor,
            coalesce(car.tax_amount_minor, bus.tax_amount_minor) as tax_amount_minor,
            coalesce(car.total_amount_minor, bus.total_amount_minor) as total_amount_minor,
            car.mileage_policy, car.fuel_policy, car.deposit_policy, car.protections,
            coalesce(car.cancellation_policy, bus.cancellation_policy) as cancellation_policy,
            coalesce(car.issuance_deadline, bus.issuance_deadline) as issuance_deadline,
            bus.route_id, route.route_code::text, bus.service_number, bus.class_name,
            bus.baggage_pieces, bus.fare_amount_minor, bus.change_policy,
            coalesce(car.metadata, bus.metadata) as detail_metadata
     from travel_quotes quote
     join demands demand
       on demand.tenant_id = quote.tenant_id and demand.id = quote.demand_id
     join travel_quote_options option_row
       on option_row.tenant_id = quote.tenant_id and option_row.quote_id = quote.id
     left join car_quote_option_details car
       on car.tenant_id = option_row.tenant_id and car.quote_option_id = option_row.id
     left join rental_locations pickup
       on pickup.tenant_id = car.tenant_id and pickup.id = car.pickup_location_id
     left join rental_locations returned
       on returned.tenant_id = car.tenant_id and returned.id = car.return_location_id
     left join bus_quote_option_details bus
       on bus.tenant_id = option_row.tenant_id and bus.quote_option_id = option_row.id
     left join bus_routes route
       on route.tenant_id = bus.tenant_id and route.id = bus.route_id
     join commercial_suppliers supplier
       on supplier.tenant_id = option_row.tenant_id
      and supplier.id = coalesce(car.supplier_id, bus.supplier_id)
     left join travel_quote_selections selection
       on selection.tenant_id = quote.tenant_id
      and selection.demand_id = quote.demand_id
      and selection.quote_id = quote.id
      and selection.option_id = option_row.id
      and selection.status = any($4::text[])
     left join approval_instances approval
       on approval.tenant_id = selection.tenant_id
      and approval.id = selection.approval_instance_id
     where quote.tenant_id = $1 and quote.demand_id = $2
       and (demand.travel_order_id is null or exists (
         select 1 from company_portal_travel_orders visible_order
         where visible_order.tenant_id = demand.tenant_id
           and visible_order.id = demand.travel_order_id
           and visible_order.status = 'submitted'
       ))
       and quote.provider = $3 and quote.service_type = $5
       and quote.request_payload #>> '{raw,manualOffline}' = 'true'
       and quote.request_payload #>> '{raw,offlineGround}' = 'true'
       and ($6::uuid is null or quote.id = $6::uuid)
       and (($5 = 'locacao' and car.quote_option_id is not null)
         or ($5 = 'rodoviario' and bus.quote_option_id is not null))
     order by (selection.id is not null) desc,
              (quote.status = 'selected') desc,
              (quote.status = 'completed') desc,
              quote.created_at desc, quote.id desc,
              option_row.amount nulls last, option_row.created_at`,
    [tenantId, demandId, PROVIDER, [...ACTIVE_SELECTION_STATUSES], service, quoteId],
  )
  return result.rows
}

async function loadBusSegmentRows(
  client: PoolClient,
  tenantId: string,
  optionIds: string[],
): Promise<BusSegmentReadRow[]> {
  if (!optionIds.length) return []
  return (await client.query<BusSegmentReadRow>(
    `select segment.id, segment.quote_option_id, segment.demand_leg_id,
            segment.route_id, segment_route.route_code::text,
            segment.sequence, segment.origin_city_id, segment.destination_city_id,
            origin.name as origin_city_name, destination.name as destination_city_name,
            segment.origin_terminal_id, segment.destination_terminal_id,
            origin_terminal.name as origin_terminal_name,
            destination_terminal.name as destination_terminal_name,
            segment.departs_at, segment.arrives_at, segment.service_number,
            segment.class_name, segment.seat_available, segment.metadata
     from bus_quote_segments segment
     join bus_routes segment_route
       on segment_route.tenant_id = segment.tenant_id and segment_route.id = segment.route_id
     join geo_cities origin on origin.id = segment.origin_city_id
     join geo_cities destination on destination.id = segment.destination_city_id
     left join bus_terminals origin_terminal
       on origin_terminal.tenant_id = segment.tenant_id
      and origin_terminal.id = segment.origin_terminal_id
     left join bus_terminals destination_terminal
       on destination_terminal.tenant_id = segment.tenant_id
      and destination_terminal.id = segment.destination_terminal_id
     where segment.tenant_id = $1 and segment.quote_option_id = any($2::uuid[])
     order by segment.quote_option_id, segment.sequence`,
    [tenantId, Array.from(new Set(optionIds))],
  )).rows
}

function mapGroundQuoteRows(
  rows: GroundQuoteRow[],
  segmentRows: BusSegmentReadRow[],
  service: OfflineGroundQuoteService,
): OfflineGroundQuoteReadModel[] {
  const segmentsByOption = new Map<string, BusSegmentReadRow[]>()
  for (const segment of segmentRows) {
    segmentsByOption.set(segment.quote_option_id, [
      ...(segmentsByOption.get(segment.quote_option_id) || []),
      segment,
    ])
  }
  const byQuote = new Map<string, OfflineGroundQuoteReadModel>()
  for (const row of rows) {
    let quote = byQuote.get(row.quote_id)
    if (!quote) {
      quote = {
        id: row.quote_id,
        demandId: row.demand_id,
        demandNumber: row.demand_number,
        service,
        lifecycleStatus: row.lifecycle_status,
        lifecycleVersion: positiveInteger(row.lifecycle_version),
        status: quoteStatus(row.quote_status),
        expiresAt: nullableIso(row.expires_at),
        selectedOptionId: null,
        options: [],
        createdAt: requiredIso(row.created_at),
        updatedAt: requiredIso(row.updated_at),
      }
      byQuote.set(row.quote_id, quote)
    }
    const common = {
      id: row.option_id,
      clientId: clientId(row),
      supplierId: row.supplier_id,
      supplierName: row.supplier_name || 'Fornecedor nao informado',
      supplierCode: row.supplier_code,
      title: row.title,
      subtitle: row.subtitle,
      startsAt: nullableIso(row.starts_at),
      endsAt: nullableIso(row.ends_at),
      totalAmountMinor: positiveOrZero(row.total_amount_minor),
      currency: row.currency,
      refundable: row.refundable,
      selected: Boolean(row.selection_id),
      selectionId: row.selection_id,
      selectionStatus: effectiveSelectionStatus(row.selection_status, row.approval_status),
      approvalInstanceId: row.approval_instance_id,
      approvalStatus: row.approval_status,
    }
    let option: OfflineGroundQuoteOptionReadModel
    if (service === 'locacao') {
      option = {
        ...common,
        service,
        details: {
          supplierId: row.supplier_id,
          pickupLocationId: requiredText(row.pickup_location_id),
          returnLocationId: requiredText(row.return_location_id),
          pickupLocationName: requiredText(row.pickup_location_name),
          returnLocationName: requiredText(row.return_location_name),
          categoryCode: row.category_code || undefined,
          categoryName: requiredText(row.category_name),
          vehicleExample: row.vehicle_example || undefined,
          rentalDays: positiveInteger(row.rental_days),
          dailyAmountMinor: positiveOrZero(row.daily_amount_minor),
          protectionAmountMinor: positiveOrZero(row.protection_amount_minor),
          feeAmountMinor: positiveOrZero(row.fee_amount_minor),
          taxAmountMinor: positiveOrZero(row.tax_amount_minor),
          totalAmountMinor: positiveOrZero(row.total_amount_minor),
          currency: row.currency,
          mileagePolicy: row.mileage_policy || undefined,
          fuelPolicy: row.fuel_policy || undefined,
          depositPolicy: row.deposit_policy || undefined,
          protections: Array.isArray(row.protections)
            ? row.protections.filter((item): item is string => typeof item === 'string')
            : [],
          cancellationPolicy: row.cancellation_policy || undefined,
          issuanceDeadline: nullableIso(row.issuance_deadline) || undefined,
          metadata: row.detail_metadata || {},
        },
      } satisfies OfflineCarQuoteOptionReadModel
    } else {
      option = {
        ...common,
        service,
        details: {
          supplierId: row.supplier_id,
          routeId: row.route_id || undefined,
          routeCode: row.route_code,
          serviceNumber: row.service_number || undefined,
          className: requiredText(row.class_name),
          baggagePieces: positiveOrZero(row.baggage_pieces),
          refundable: row.refundable ?? undefined,
          issuanceDeadline: nullableIso(row.issuance_deadline) || undefined,
          fareAmountMinor: positiveOrZero(row.fare_amount_minor),
          taxAmountMinor: positiveOrZero(row.tax_amount_minor),
          feeAmountMinor: positiveOrZero(row.fee_amount_minor),
          totalAmountMinor: positiveOrZero(row.total_amount_minor),
          currency: row.currency,
          changePolicy: row.change_policy || undefined,
          cancellationPolicy: row.cancellation_policy || undefined,
          metadata: row.detail_metadata || {},
          segments: (segmentsByOption.get(row.option_id) || []).map((segment) => ({
            id: segment.id,
            demandLegId: segment.demand_leg_id || undefined,
            routeId: segment.route_id,
            routeCode: segment.route_code,
            sequence: positiveInteger(segment.sequence),
            originCityId: segment.origin_city_id,
            destinationCityId: segment.destination_city_id,
            originCityName: segment.origin_city_name,
            destinationCityName: segment.destination_city_name,
            originTerminalId: segment.origin_terminal_id || undefined,
            destinationTerminalId: segment.destination_terminal_id || undefined,
            originTerminalName: segment.origin_terminal_name,
            destinationTerminalName: segment.destination_terminal_name,
            departsAt: requiredIso(segment.departs_at),
            arrivesAt: requiredIso(segment.arrives_at),
            serviceNumber: segment.service_number || undefined,
            className: segment.class_name,
            seatAvailable: segment.seat_available ?? undefined,
            metadata: segment.metadata || {},
          })),
        },
      } satisfies OfflineBusQuoteOptionReadModel
    }
    quote.options.push(option)
    if (option.selected) quote.selectedOptionId = option.id
  }
  return [...byQuote.values()]
}

async function loadOfflineGroundQuoteById(
  principal: RequestPrincipal,
  demandId: string,
  quoteId: string,
  service: OfflineGroundQuoteService,
): Promise<OfflineGroundQuoteReadModel | null> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const rows = await loadGroundQuoteRows(client, principal.tenantId, demandId, service, quoteId)
    const segments = service === 'rodoviario'
      ? await loadBusSegmentRows(client, principal.tenantId, rows.map((row) => row.option_id))
      : []
    return mapGroundQuoteRows(rows, segments, service)[0] || null
  })
}

async function supersedePreviousGroundQuoteRounds(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  currentQuoteId: string,
  service: OfflineGroundQuoteService,
): Promise<void> {
  const superseded = await client.query<{ id: string }>(
    `update travel_quotes previous_quote
     set status = 'expired', updated_at = now()
     where previous_quote.tenant_id = $1 and previous_quote.demand_id = $2
       and previous_quote.id <> $3 and previous_quote.provider = $4
       and previous_quote.service_type = $5
       and previous_quote.request_payload #>> '{raw,manualOffline}' = 'true'
       and previous_quote.request_payload #>> '{raw,offlineGround}' = 'true'
       and previous_quote.status in ('pending', 'completed')
       and not exists (
         select 1 from travel_quote_selections selection
         where selection.tenant_id = previous_quote.tenant_id
           and selection.quote_id = previous_quote.id
           and selection.status = any($6::text[])
       )
     returning previous_quote.id`,
    [principal.tenantId, demandId, currentQuoteId, PROVIDER, service, [...ACTIVE_SELECTION_STATUSES]],
  )
  for (const previous of superseded.rows) {
    await client.query(
      `insert into audit_logs (
         tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
       ) values ($1, $2, 'travel.quote.superseded', 'travel_quote', $3, 'success', $4::jsonb)`,
      [
        principal.tenantId,
        principal.user.id,
        previous.id,
        JSON.stringify({
          demandId,
          previousQuoteId: previous.id,
          currentQuoteId,
          service,
          reason: 'new_offline_ground_quote_round',
        }),
      ],
    )
  }
}

async function loadGroundDemand(
  client: PoolClient,
  tenantId: string,
  demandId: string,
): Promise<GroundDemandRow> {
  const demand = (await client.query<GroundDemandRow>(
    `select demand.id, demand.company_id, company.group_id, demand.requester_id,
            demand.demand_number, demand.service_type, demand.lifecycle_status,
            demand.lifecycle_version, demand.travel_start_date,
            demand.travel_end_date, demand.destination
     from demands demand
     join companies company
       on company.tenant_id = demand.tenant_id and company.id = demand.company_id
     where demand.tenant_id = $1 and demand.id = $2 and demand.deleted_at is null
       and (demand.travel_order_id is null or exists (
         select 1 from company_portal_travel_orders visible_order
         where visible_order.tenant_id = demand.tenant_id
           and visible_order.id = demand.travel_order_id
           and visible_order.status = 'submitted'
       ))`,
    [tenantId, demandId],
  )).rows[0]
  if (!demand) {
    throw new TravelGovernanceError('OFFLINE_GROUND_DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
  }
  groundService(demand.service_type)
  return demand
}

async function loadSuppliers(
  client: PoolClient,
  tenantId: string,
  supplierIds: string[],
  service: 'car' | 'bus',
): Promise<Map<string, SupplierRow>> {
  const rows = (await client.query<SupplierRow>(
    `select id, coalesce(trade_name, legal_name) as supplier_name,
            internal_code::text
     from commercial_suppliers
     where tenant_id = $1 and id = any($2::uuid[])
       and status = 'active' and deleted_at is null
       and service_types @> array[$3]::text[]
       and ($3 <> 'bus' or exists (
         select 1 from bus_routes verified_route
         where verified_route.tenant_id = commercial_suppliers.tenant_id
           and verified_route.supplier_id = commercial_suppliers.id
           and verified_route.status = 'active'
           and verified_route.deleted_at is null
           and verified_route.review_status = 'verified'
           and (verified_route.valid_from is null or verified_route.valid_from <= current_date)
           and (verified_route.valid_until is null or verified_route.valid_until >= current_date)
       ))`,
    [tenantId, Array.from(new Set(supplierIds)), service],
  )).rows
  return new Map(rows.map((row) => [row.id, row]))
}

async function assertRequesterOwnsDemand(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: Pick<GroundDemandRow, 'requester_id' | 'company_id'>,
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
      'OFFLINE_GROUND_REQUESTER_MISMATCH',
      'Somente o solicitante responsavel pode consultar esta cotacao.',
      403,
    )
  }
}

function assertGroundService(demand: GroundDemandRow, expected: OfflineGroundQuoteService): void {
  if (groundService(demand.service_type) !== expected) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_QUOTE_SERVICE_MISMATCH',
      'A cotacao terrestre nao corresponde ao servico da demanda.',
      422,
    )
  }
}

function groundService(value: string): OfflineGroundQuoteService {
  const service = offlineServiceFromDemand(value)
  if (service !== 'locacao' && service !== 'rodoviario') {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_QUOTE_SERVICE_NOT_SUPPORTED',
      'A demanda nao e de locacao ou rodoviario.',
      422,
    )
  }
  return service
}

function normalizeAndValidateBusSegments(
  segments: OfflineBusQuoteCreateInput['options'][number]['details']['segments'],
  legs: BusDemandLegRow[],
  legById: Map<string, BusDemandLegRow>,
  verifiedTerminalIds: ReadonlySet<string>,
  clientId: string,
): OfflineBusQuoteCreateInput['options'][number]['details']['segments'] {
  const missingLegIds = segments.filter((segment) => !segment.demandLegId).length
  if (missingLegIds > 0 && missingLegIds < segments.length) {
    throw new TravelGovernanceError(
      'OFFLINE_BUS_QUOTE_LEG_SCOPE_INVALID',
      'Informe o vinculo de todos os segmentos ou use um segmento direto por trecho.',
      422,
      { clientId },
    )
  }
  const normalized = missingLegIds === segments.length && segments.length === legs.length
    ? segments.map((segment, index) => ({ ...segment, demandLegId: legs[index].id }))
    : segments
  const byLeg = new Map<string, typeof segments>()
  const legOrder = new Map(legs.map((leg, index) => [leg.id, index]))
  let previousLegIndex = -1
  let previousArrival = Number.NEGATIVE_INFINITY
  for (const segment of normalized) {
    if (!segment.demandLegId || !legById.has(segment.demandLegId)) {
      throw new TravelGovernanceError(
        'OFFLINE_BUS_QUOTE_LEG_SCOPE_INVALID',
        'Cada segmento deve estar vinculado a um trecho desta demanda.',
        422,
        { clientId },
      )
    }
    const currentLegIndex = legOrder.get(segment.demandLegId)!
    if (currentLegIndex < previousLegIndex || Date.parse(segment.departsAt) < previousArrival) {
      throw new TravelGovernanceError(
        'OFFLINE_BUS_QUOTE_GLOBAL_SEQUENCE_INVALID',
        'Os segmentos devem seguir a ordem cronologica dos trechos solicitados.',
        422,
        { clientId },
      )
    }
    if (
      (segment.originTerminalId && !verifiedTerminalIds.has(segment.originTerminalId))
      || (segment.destinationTerminalId && !verifiedTerminalIds.has(segment.destinationTerminalId))
    ) {
      throw new TravelGovernanceError(
        'OFFLINE_BUS_QUOTE_TERMINAL_SCOPE_INVALID',
        'Use somente terminais rodoviarios ativos e verificados.',
        422,
        { clientId },
      )
    }
    previousLegIndex = currentLegIndex
    previousArrival = Date.parse(segment.arrivesAt)
    byLeg.set(segment.demandLegId, [...(byLeg.get(segment.demandLegId) || []), segment])
  }
  for (const leg of legs) {
    const covered = byLeg.get(leg.id) || []
    if (!covered.length
        || covered[0].originCityId !== leg.origin_city_id
        || covered[covered.length - 1].destinationCityId !== leg.destination_city_id
        || Boolean(leg.origin_terminal_id && covered[0].originTerminalId !== leg.origin_terminal_id)
        || Boolean(leg.destination_terminal_id
          && covered[covered.length - 1].destinationTerminalId !== leg.destination_terminal_id)) {
      throw new TravelGovernanceError(
        'OFFLINE_BUS_QUOTE_LEG_COVERAGE_INVALID',
        'Os segmentos nao cobrem integralmente os trechos solicitados.',
        422,
        { clientId, demandLegId: leg.id },
      )
    }
    if (civilDate(covered[0].departsAt) !== civilDate(leg.departure_date)) {
      throw new TravelGovernanceError(
        'OFFLINE_BUS_QUOTE_DEPARTURE_DATE_MISMATCH',
        'A partida da opcao nao corresponde a data solicitada.',
        422,
        { clientId, demandLegId: leg.id },
      )
    }
    const departureTime = civilTime(covered[0].departsAt)
    if (
      (leg.earliest_departure && departureTime < leg.earliest_departure.slice(0, 5))
      || (leg.latest_departure && departureTime > leg.latest_departure.slice(0, 5))
    ) {
      throw new TravelGovernanceError(
        'OFFLINE_BUS_QUOTE_DEPARTURE_WINDOW_MISMATCH',
        'O horario de partida da opcao esta fora da janela solicitada.',
        422,
        { clientId, demandLegId: leg.id },
      )
    }
    for (let index = 1; index < covered.length; index += 1) {
      const previous = covered[index - 1]
      const current = covered[index]
      if (previous.destinationCityId !== current.originCityId
          || Date.parse(previous.arrivesAt) > Date.parse(current.departsAt)) {
        throw new TravelGovernanceError(
          'OFFLINE_BUS_QUOTE_CONNECTION_INVALID',
          'As conexoes rodoviarias da opcao nao sao continuas.',
          422,
          { clientId, demandLegId: leg.id },
        )
      }
    }
  }
  return normalized
}

function normalizeExpiry(
  explicit: string | undefined,
  prepared: PreparedGroundQuote,
): string | undefined {
  const deadlines = prepared.options.flatMap((option) => (
    option.details.issuanceDeadline ? [option.details.issuanceDeadline] : []
  ))
  const start = 'detail' in prepared
    ? isoDateTime(prepared.detail.pickup_at)
    : prepared.options[0].details.segments[0].departsAt
  const fallback = new Date(Math.min(
    Date.now() + 7 * 86_400_000,
    Date.parse(start) - 3_600_000,
  )).toISOString()
  const expiresAt = [explicit, ...deadlines]
    .flatMap((value) => value && Number.isFinite(Date.parse(value))
      ? [new Date(value).toISOString()]
      : [])
    .sort()[0] || fallback
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_QUOTE_EXPIRY_INVALID',
      'A validade da cotacao deve estar no futuro.',
      422,
    )
  }
  return expiresAt
}

function requiredQuoteOptionId(
  optionIdsByProviderId: ReadonlyMap<string, string>,
  providerOptionId: string,
): string {
  const id = optionIdsByProviderId.get(providerOptionId)
  if (!id) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_QUOTE_OPTION_PERSISTENCE_FAILED',
      'Uma opcao terrestre publicada nao foi localizada.',
      409,
    )
  }
  return id
}

function uniqueSuppliers(
  rows: Array<Pick<QuoteCatalogLocationRow, 'supplier_id' | 'supplier_name' | 'supplier_code'>>,
  service: OfflineGroundQuoteService,
): OfflineGroundQuoteCatalogReadModel['suppliers'] {
  return [...new Map(rows.map((row) => [row.supplier_id, {
    id: row.supplier_id,
    name: row.supplier_name,
    code: row.supplier_code,
    service,
  }])).values()]
}

function clientId(row: GroundQuoteRow): string {
  const metadata = row.detail_metadata || {}
  const value = String(metadata.clientId || '').trim()
  if (value) return value
  return row.provider_option_id.replace(/^offline-ground:/, '')
}

function effectiveSelectionStatus(
  selection: string | null,
  approval: string | null,
): OfflineGroundSelectionStatus | null {
  if (!selection) return null
  if (selection === 'pending_approval' && approval === 'approved') return 'approved'
  if (selection === 'pending_approval' && approval === 'rejected') return 'rejected'
  return ['selected', 'pending_approval', 'approved', 'rejected', 'superseded'].includes(selection)
    ? selection as OfflineGroundSelectionStatus
    : null
}

function quoteStatus(value: string): OfflineGroundQuoteReadModel['status'] {
  return ['pending', 'completed', 'selected', 'expired', 'failed'].includes(value)
    ? value as OfflineGroundQuoteReadModel['status']
    : 'failed'
}

function positiveInteger(value: unknown): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_READ_MODEL_INVALID',
      'A cotacao terrestre possui um numero inteiro invalido.',
      500,
    )
  }
  return number
}

function positiveOrZero(value: unknown): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_READ_MODEL_INVALID',
      'A cotacao terrestre possui um valor monetario invalido.',
      500,
    )
  }
  return number
}

function requiredText(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_READ_MODEL_INVALID',
      'A cotacao terrestre possui dados relacionais incompletos.',
      500,
    )
  }
  return text
}

function dateOnly(value: string | Date | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function civilDate(value: string | Date | null): string {
  if (!value) return ''
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return match[1]!
  }
  return dateOnly(value)
}

function civilTime(value: string | Date | null): string {
  if (!value) return ''
  if (typeof value === 'string') {
    const match = value.trim().match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/)
    if (match) return match[1]!
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime())
    ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : ''
}

function isoDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_DATE_INVALID',
      'A cotacao terrestre possui uma data invalida.',
      422,
    )
  }
  return date.toISOString()
}

function nullableIso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function requiredIso(value: unknown): string {
  const normalized = nullableIso(value)
  if (!normalized) {
    throw new TravelGovernanceError(
      'OFFLINE_GROUND_DATE_INVALID',
      'A cotacao terrestre possui uma data invalida.',
      500,
    )
  }
  return normalized
}

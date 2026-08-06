import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import type { TravelQuote, TravelQuoteOption, TravelQuoteRequest } from '@/lib/integrations/types'
import { calculateHotelQuote, nightsBetween } from '@/lib/hotel-demand/model'
import { offlineServiceFromDemand } from '@/lib/offline-travel/catalog'
import { moneyToMinorUnits, minorUnitsToMoney } from '@/lib/offline-travel/money'
import {
  offlineHotelQuoteCreateSchema,
  offlineQuoteSelectionSchema,
  type OfflineHotelQuoteCreateInput,
  type OfflineHotelQuoteListReadModel,
  type OfflineHotelQuoteOptionReadModel,
  type OfflineHotelQuoteReadModel,
  type OfflineQuoteSelectionInput,
  type OfflineQuoteSelectionReadModel,
} from '@/lib/offline-travel/quote-schema'
import { sha256, type PolicyEvaluationResult, type PolicyScopeContext } from '@/lib/policy'
import { createApprovalInstance } from '@/lib/server/approval-service'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { evaluateAndPersistPoliciesInTransaction } from '@/lib/server/policy-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  executeGovernedTravelQuote,
  TravelGovernanceError,
} from '@/lib/server/travel-governance-service'
import { persistTravelTransitionInTransaction } from '@/lib/server/travel-lifecycle-persistence'
import type {
  TravelLifecycleRecord,
  TravelLifecycleStatus,
  TravelTransitionRequirements,
} from '@/lib/travel-lifecycle/types'

const PROVIDER = 'manual-offline' as const
const CURRENCY = 'BRL'
const ACTIVE_SELECTION_STATUSES = ['selected', 'pending_approval', 'approved'] as const
const LIFECYCLE_STATUSES = new Set<TravelLifecycleStatus>([
  'draft', 'submitted', 'pending_merit_approval', 'approved_for_quotation', 'quoting',
  'pending_choice', 'pending_cost_approval', 'approved', 'reserving', 'reserved',
  'pending_issuance', 'issuing', 'issued', 'partially_issued', 'rejected', 'canceled',
  'expired', 'failed', 'pending_refund', 'refunded', 'closed',
])

interface QuoteDemandRow extends QueryResultRow {
  id: string
  tenant_id: string
  company_id: string
  group_id: string | null
  requester_id: string | null
  employee_id: string | null
  demand_number: string
  service_type: string
  passenger_name_snapshot: string
  priority: string
  travel_start_date: string | Date | null
  travel_end_date: string | Date | null
  destination: string | null
  cost_center: string | null
  estimated_amount: string | number
  metadata: Record<string, unknown>
  lifecycle_status: string
  lifecycle_version: string | number
  last_policy_evaluation_id: string | null
  active_approval_instance_id: string | null
  company_name: string
  employee_name: string | null
  employee_department: string | null
  city_id: string | null
  city_name: string | null
  check_in: string | Date | null
  check_out: string | Date | null
  preferred_hotel_ids: string[] | null
}

interface DemandRoomRow extends QueryResultRow {
  id: string
  room_sequence: string | number
  occupancy_code: string
}

interface HotelSupplierRow extends QueryResultRow {
  hotel_id: string
  hotel_supplier_id: string
  hotel_name: string
  category: string | null
  city_name: string
  address: string | null
  phone: string | null
  supplier_id: string
  supplier_name: string
  supplier_code: string
}

interface CatalogRateRow extends QueryResultRow {
  id: string
  hotel_id: string
  hotel_supplier_id: string
  version: string | number
  nightly_amount: string | number
  tax_amount: string | number
  service_fee_amount: string | number
  currency: string
  room_type_id: string
  room_name: string
  occupancy_type: string
  refundable: boolean | null
  meal_plan: string | null
  cancellation_policy: string | null
  metadata: Record<string, unknown> | null
  out_of_period_policy: 'block' | 'warn' | 'allow'
  inside_validity: boolean
}

interface PreparedHotelOption {
  clientId: string
  providerOptionId: string
  hotelId: string
  hotelSupplierId: string
  hotelName: string
  hotelCategory: string | null
  hotelAddress: string | null
  hotelPhone: string | null
  cityName: string
  supplierId: string
  supplierName: string
  supplierCode: string
  pricingMode: 'catalog' | 'manual_override' | 'manual'
  rateReference: { id: string; version: number } | null
  rateOutsideValidity: boolean
  outOfPeriodPolicy: 'block' | 'warn' | 'allow'
  roomCategory: string
  mealPlan: string | null
  refundable: boolean
  cancellationDeadline: string | null
  cancellationPolicy: string | null
  paymentTerms: string | null
  notes: string | null
  nightlyRateMinor: number
  nightlyTaxesMinor: number
  serviceFeeMinor: number
  roomSubtotalMinor: number
  taxesSubtotalMinor: number
  totalMinor: number
  nights: number
  roomCount: number
}

interface PreparedHotelQuote {
  demand: QuoteDemandRow
  rooms: DemandRoomRow[]
  options: PreparedHotelOption[]
  expiresAt: string | undefined
}

interface QuoteListRow extends QueryResultRow {
  quote_id: string
  demand_id: string
  demand_number: string
  lifecycle_status: string
  lifecycle_version: string | number
  quote_status: string
  expires_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
  option_id: string
  provider_option_id: string
  supplier_name: string | null
  title: string
  subtitle: string | null
  amount: string | number | null
  currency: string
  refundable: boolean | null
  starts_at: string | Date | null
  ends_at: string | Date | null
  option_metadata: Record<string, unknown>
  hotel_id: string | null
  hotel_name: string | null
  hotel_category: string | null
  hotel_address: string | null
  hotel_city_id: string | null
  hotel_city_name: string | null
  hotel_subdivision_code: string | null
  hotel_country_code: string | null
  room_category: string | null
  meal_plan: string | null
  cancellation_policy: string | null
  payment_terms: string | null
  hotel_metadata: Record<string, unknown> | null
  selection_id: string | null
  selection_status: string | null
  approval_instance_id: string | null
  approval_status: string | null
}

interface SelectionContextRow extends QueryResultRow {
  quote_id: string
  quote_status: string
  quote_expires_at: string | Date | null
  quote_option_count: string | number
  demand_id: string
  company_id: string
  provider_quote_id: string
  service_type: string
  option_id: string
  provider_option_id: string
  supplier_name: string | null
  option_title: string
  option_subtitle: string | null
  amount: string | number | null
  currency: string
  refundable: boolean | null
  starts_at: string | Date | null
  ends_at: string | Date | null
  option_metadata: Record<string, unknown>
  hotel_id: string | null
  hotel_name: string | null
  hotel_category: string | null
  hotel_address: string | null
  hotel_phone: string | null
  room_category: string | null
  meal_plan: string | null
  cancellation_policy: string | null
  payment_terms: string | null
  hotel_metadata: Record<string, unknown> | null
  is_current_round: boolean
}

interface ExistingSelectionRow extends QueryResultRow {
  id: string
  demand_id: string
  quote_id: string
  option_id: string
  status: string
  snapshot_hash: string
  approval_instance_id: string | null
  version: string | number
  chosen_at: string | Date
}

interface SelectionPreparation {
  input: OfflineQuoteSelectionInput
  selectionId: string
  demand: QuoteDemandRow
  option: SelectionContextRow
  snapshot: Record<string, unknown>
  snapshotHash: string
  policyEvaluationId: string
  policyResult: PolicyEvaluationResult
  workflowCode: string | null
  requirements: TravelTransitionRequirements
  subject: Record<string, unknown>
}

export interface OfflineHotelQuoteCreationResult {
  item: OfflineHotelQuoteReadModel
  replayed: boolean
}

export interface OfflineQuoteSelectionResult extends OfflineQuoteSelectionReadModel {
  replayed: boolean
}

export async function createOfflineHotelQuote(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<OfflineHotelQuoteCreationResult> {
  const input = offlineHotelQuoteCreateSchema.parse(rawInput)
  const prepared = await prepareHotelQuote(principal, input)

  const createdAt = new Date().toISOString()
  const providerQuoteId = `offline-quote:${sha256({
    tenantId: principal.tenantId,
    demandId: prepared.demand.id,
    idempotencyKey: input.idempotencyKey,
  }).slice(0, 48)}`
  const request: TravelQuoteRequest = {
    demandId: prepared.demand.id,
    expectedLifecycleVersion: input.expectedLifecycleVersion,
    idempotencyKey: input.idempotencyKey,
    policyJustification: input.policyJustification,
    service: 'hotelaria',
    empresaId: prepared.demand.company_id,
    destino: prepared.demand.city_name || undefined,
    dataInicio: dateOnly(prepared.demand.check_in),
    dataFim: dateOnly(prepared.demand.check_out),
    adultos: prepared.rooms.length,
    raw: {
      channel: 'offline',
      manualOffline: true,
      offlineOptionCount: prepared.options.length,
      offlineOptions: prepared.options.map((option) => optionMetadata(option)),
      serial_os: prepared.demand.demand_number,
    },
  }
  const quoteOptions: TravelQuoteOption[] = prepared.options.map((option) => ({
    id: option.providerOptionId,
    provider: PROVIDER,
    service: 'hotelaria',
    supplierName: option.supplierName,
    title: option.hotelName,
    subtitle: [option.roomCategory, option.mealPlan].filter(Boolean).join(' · '),
    price: minorUnitsToMoney(option.totalMinor),
    currency: CURRENCY,
    refundable: option.refundable,
    policyStatus: 'respeitada',
    startsAt: hotelDateTime(prepared.demand.check_in!, '14:00:00'),
    endsAt: hotelDateTime(prepared.demand.check_out!, '12:00:00'),
    city: prepared.demand.city_name || undefined,
    metadata: { offlineHotel: optionMetadata(option) },
    raw: {
      source: PROVIDER,
      hotelId: option.hotelId,
      hotelSupplierId: option.hotelSupplierId,
      supplierId: option.supplierId,
      supplierCode: option.supplierCode,
      pricingMode: option.pricingMode,
      rateReference: option.rateReference,
    },
  }))

  const execution = await executeGovernedTravelQuote(
    principal,
    request,
    input.idempotencyKey,
    async (providerRequest): Promise<TravelQuote> => ({
      id: providerQuoteId,
      provider: PROVIDER,
      service: 'hotelaria',
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
        await persistHotelOptionDetails(context.client, principal, prepared, context.optionIdsByProviderId)
        await supersedePreviousOfflineHotelQuoteRounds(
          context.client,
          principal,
          context.demandId,
          context.databaseQuoteId,
        )
      },
    },
  )
  const item = await loadOfflineHotelQuoteById(
    principal,
    execution.demandId,
    execution.databaseQuoteId,
  )
  if (!item) {
    throw new TravelGovernanceError(
      'OFFLINE_QUOTE_READ_MODEL_NOT_FOUND',
      'A cotacao foi publicada, mas nao pode ser relida.',
      500,
    )
  }
  return { item, replayed: execution.replayed }
}

export async function listOfflineHotelQuotes(
  principal: RequestPrincipal,
  demandId: string,
): Promise<OfflineHotelQuoteListReadModel> {
  const normalizedDemandId = String(demandId || '').trim()
  if (!normalizedDemandId) {
    throw new TravelGovernanceError('OFFLINE_QUOTE_DEMAND_REQUIRED', 'Informe a demanda para consultar cotacoes.', 400)
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demandResult = await client.query<Pick<QuoteDemandRow,
      'company_id' | 'requester_id' | 'lifecycle_status' | 'lifecycle_version'
    >>(
      `select company_id, requester_id, lifecycle_status, lifecycle_version
       from demands
       where tenant_id = $1 and id = $2 and deleted_at is null`,
      [principal.tenantId, normalizedDemandId],
    )
    const demand = demandResult.rows[0]
    if (!demand) throw new TravelGovernanceError('TRAVEL_DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
    await requireCompanyAccess(principal, demand.company_id, 'ver_reservas')
    await assertRequesterOwnsDemand(client, principal, demand)
    const rows = await loadOfflineHotelQuoteRows(client, principal.tenantId, normalizedDemandId)
    return {
      demandId: normalizedDemandId,
      lifecycleStatus: demand.lifecycle_status,
      lifecycleVersion: Number(demand.lifecycle_version),
      quotes: mapQuoteRows(rows),
    }
  })
}

async function loadOfflineHotelQuoteById(
  principal: RequestPrincipal,
  demandId: string,
  quoteId: string,
): Promise<OfflineHotelQuoteReadModel | null> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const rows = await loadOfflineHotelQuoteRows(client, principal.tenantId, demandId, quoteId)
    return mapQuoteRows(rows)[0] || null
  })
}

async function loadOfflineHotelQuoteRows(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  quoteId: string | null = null,
): Promise<QuoteListRow[]> {
  const result = await client.query<QuoteListRow>(
    `select quote.id as quote_id, quote.demand_id, demand.demand_number,
            demand.lifecycle_status, demand.lifecycle_version,
            quote.status as quote_status, quote.expires_at,
            quote.created_at, quote.updated_at,
            option_row.id as option_id, option_row.provider_option_id,
            option_row.supplier_name, option_row.title, option_row.subtitle,
            option_row.amount, option_row.currency, option_row.refundable,
            option_row.starts_at, option_row.ends_at,
            option_row.metadata as option_metadata,
            detail.hotel_id, hotel.name as hotel_name,
            hotel.category as hotel_category, hotel.address as hotel_address,
            hotel.city_id as hotel_city_id, city.name as hotel_city_name,
            subdivision.code::text as hotel_subdivision_code,
            country.iso_alpha2::text as hotel_country_code,
            detail.room_category, detail.meal_plan,
            detail.cancellation_policy, detail.payment_terms,
            detail.metadata as hotel_metadata,
            selection.id as selection_id, selection.status as selection_status,
            selection.approval_instance_id, approval.status as approval_status
     from travel_quotes quote
     join demands demand
       on demand.tenant_id = quote.tenant_id and demand.id = quote.demand_id
     join travel_quote_options option_row
       on option_row.tenant_id = quote.tenant_id and option_row.quote_id = quote.id
     join hotel_quote_option_details detail
       on detail.tenant_id = option_row.tenant_id and detail.quote_option_id = option_row.id
     join hotels hotel
       on hotel.tenant_id = detail.tenant_id and hotel.id = detail.hotel_id
     left join geo_cities city on city.id = hotel.city_id
     left join geo_subdivisions subdivision on subdivision.id = hotel.subdivision_id
     left join geo_countries country on country.id = hotel.country_id
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
       and quote.provider = $3 and quote.service_type = 'hotelaria'
       and quote.request_payload #>> '{raw,manualOffline}' = 'true'
       and ($5::uuid is null or quote.id = $5::uuid)
     order by (quote.status = 'completed') desc, quote.created_at desc, quote.id desc,
              option_row.amount nulls last, option_row.created_at`,
    [tenantId, demandId, PROVIDER, [...ACTIVE_SELECTION_STATUSES], quoteId],
  )
  return result.rows
}

export async function selectOfflineQuoteOption(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<OfflineQuoteSelectionResult> {
  const input = offlineQuoteSelectionSchema.parse(rawInput)
  const preparation = await prepareSelection(principal, input)
  if ('replay' in preparation) return preparation.replay

  if (!preparation.workflowCode) {
    return withTenantTransaction(principal.tenantId, async (client) => {
      return persistSelection(client, principal, preparation, null, null)
    })
  }

  const approval = await createApprovalInstance(principal, {
    workflowCode: preparation.workflowCode,
    companyId: preparation.demand.company_id,
    demandId: preparation.demand.id,
    employeeId: preparation.demand.employee_id,
    instanceType: 'cost',
    subject: preparation.subject,
    idempotencyKey: selectionOperationKey(principal, input, 'approval', preparation.workflowCode),
  })
  return withTenantTransaction(principal.tenantId, async (client) => {
    return persistSelection(client, principal, preparation, approval.id, approval.status)
  })
}

async function prepareHotelQuote(
  principal: RequestPrincipal,
  input: OfflineHotelQuoteCreateInput,
): Promise<PreparedHotelQuote> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await loadQuoteDemand(client, principal.tenantId, input.demandId, false)
    await requireCompanyAccess(principal, demand.company_id, 'operar_cotacoes')
    if (!normalizeService(demand.service_type).includes('hotel')) {
      throw new TravelGovernanceError('OFFLINE_QUOTE_SERVICE_MISMATCH', 'A demanda selecionada nao e de hotel.', 422)
    }
    const checkIn = dateOnly(demand.check_in)
    const checkOut = dateOnly(demand.check_out)
    if (!demand.city_id || !demand.city_name || !checkIn || !checkOut) {
      throw new TravelGovernanceError(
        'OFFLINE_QUOTE_HOTEL_DETAILS_REQUIRED',
        'A demanda nao possui cidade e periodo de hospedagem completos para cotacao.',
        422,
      )
    }
    const rooms = (await client.query<DemandRoomRow>(
      `select id, room_sequence, occupancy_code
       from hotel_demand_rooms
       where tenant_id = $1 and demand_id = $2 and deleted_at is null
       order by room_sequence`,
      [principal.tenantId, demand.id],
    )).rows
    if (!rooms.length) {
      throw new TravelGovernanceError('OFFLINE_QUOTE_ROOMS_REQUIRED', 'A demanda nao possui quartos ativos para cotacao.', 422)
    }
    const nights = nightsBetween(checkIn, checkOut)
    if (nights < 1) throw new TravelGovernanceError('OFFLINE_QUOTE_DATES_INVALID', 'Periodo de hospedagem invalido.', 422)

    const hotelIds = Array.from(new Set(input.options.map((option) => option.hotelId)))
    const hotels = (await client.query<HotelSupplierRow>(
      `select hotel.id as hotel_id, hotel.name as hotel_name, hotel.category,
              city.name as city_name, hotel.address, hotel.phone,
              link.id as hotel_supplier_id, supplier.id as supplier_id,
              coalesce(supplier.trade_name, supplier.legal_name) as supplier_name,
              supplier.internal_code::text as supplier_code
       from hotels hotel
       join geo_cities city on city.id = hotel.city_id
       join hotel_suppliers link
         on link.tenant_id = hotel.tenant_id and link.hotel_id = hotel.id
        and link.is_active and link.ended_at is null
        and (link.valid_from is null or link.valid_from <= $4::date)
        and (link.valid_until is null or link.valid_until >= ($5::date - 1))
       join commercial_suppliers supplier
         on supplier.tenant_id = link.tenant_id and supplier.id = link.supplier_id
        and supplier.status = 'active' and supplier.deleted_at is null
        and supplier.service_types @> array['hotel']::text[]
       where hotel.tenant_id = $1 and hotel.id = any($2::text[])
         and hotel.city_id = $3::uuid and hotel.status = 'active'
         and hotel.deleted_at is null
       order by hotel.id, link.priority, link.id`,
      [principal.tenantId, hotelIds, demand.city_id, checkIn, checkOut],
    )).rows
    const hotelRowsById = new Map<string, HotelSupplierRow[]>()
    for (const hotel of hotels) {
      hotelRowsById.set(hotel.hotel_id, [...(hotelRowsById.get(hotel.hotel_id) || []), hotel])
    }
    const missing = input.options.flatMap((option) => {
      const candidates = hotelRowsById.get(option.hotelId) || []
      const match = candidates.some((candidate) => candidate.hotel_supplier_id === option.hotelSupplierId)
      return match ? [] : [option.hotelId]
    })
    if (missing.length) {
      throw new TravelGovernanceError(
        'OFFLINE_QUOTE_HOTEL_INVALID',
        'Um dos hoteis esta inativo, sem fornecedor ou fora da cidade da demanda.',
        422,
        { hotelIds: missing },
      )
    }

    const rateReferences = input.options.flatMap((option) => option.rateReference ? [option.rateReference.id] : [])
    const catalogRates = rateReferences.length
      ? (await client.query<CatalogRateRow>(
          `select rate.id, rate.hotel_id, rate.hotel_supplier_id, rate.version,
                  rate.nightly_amount, rate.tax_amount, rate.service_fee_amount,
                  rate.currency, rate.room_type_id, room.name as room_name,
                  room.occupancy_type, rate.refundable, rate.meal_plan,
                  rate.cancellation_policy, rate.metadata,
                  link.out_of_period_policy,
                  (rate.valid_from <= $3::date and rate.valid_until >= ($4::date - 1)) as inside_validity
           from hotel_supplier_rates rate
           join hotel_suppliers link
             on link.tenant_id = rate.tenant_id and link.id = rate.hotel_supplier_id
            and link.hotel_id = rate.hotel_id and link.is_active and link.ended_at is null
           join hotel_room_types room
             on room.tenant_id = rate.tenant_id and room.id = rate.room_type_id
            and room.hotel_id = rate.hotel_id and room.is_active and room.deleted_at is null
           where rate.tenant_id = $1 and rate.id = any($2::uuid[])
             and rate.is_active and not rate.is_suspended
             and rate.currency = 'BRL'
             and (
               (rate.valid_from <= $3::date and rate.valid_until >= ($4::date - 1))
               or link.out_of_period_policy in ('warn', 'allow')
             )
             and (
               rate.scope_type = 'global'
               or exists (
                 select 1 from hotel_supplier_rate_scopes scope
                 where scope.tenant_id = rate.tenant_id and scope.rate_id = rate.id
                   and scope.deleted_at is null
                   and (
                     (scope.scope_type = 'company' and scope.company_id = $5)
                     or (scope.scope_type = 'group' and $6::text is not null
                         and scope.business_group_id = $6)
                   )
               )
             )`,
          [
            principal.tenantId,
            rateReferences,
            checkIn,
            checkOut,
            demand.company_id,
            demand.group_id,
          ],
        )).rows
      : []
    const catalogRateById = new Map(catalogRates.map((rate) => [rate.id, rate]))

    const options = input.options.map((option): PreparedHotelOption => {
      const candidates = hotelRowsById.get(option.hotelId) || []
      const hotel = candidates.find((candidate) => candidate.hotel_supplier_id === option.hotelSupplierId)!
      const nightlyRateMinor = moneyToMinorUnits(option.nightlyRate)
      const nightlyTaxesMinor = moneyToMinorUnits(option.nightlyTaxes || 0)
      const serviceFeeMinor = moneyToMinorUnits(option.serviceFee || 0)
      const rateReference = option.rateReference || null
      if (rateReference) {
        const rate = catalogRateById.get(rateReference.id)
        if (!rate
          || Number(rate.version) !== rateReference.version
          || rate.hotel_id !== option.hotelId
          || rate.hotel_supplier_id !== hotel.hotel_supplier_id) {
          throw new TravelGovernanceError(
            'OFFLINE_QUOTE_CATALOG_RATE_STALE',
            'A tarifa cadastrada foi alterada ou nao pertence mais a esta oferta. Reaplique a tarifa antes de publicar.',
            409,
            { rateId: rateReference.id },
          )
        }
        const incompatibleRoom = rooms.find((room) => (
          normalizeOccupancyType(room.occupancy_code) !== rate.occupancy_type
        ))
        if (incompatibleRoom) {
          throw new TravelGovernanceError(
            'OFFLINE_QUOTE_CATALOG_RATE_OCCUPANCY_MISMATCH',
            'A tarifa cadastrada nao atende a ocupacao de todos os quartos da demanda.',
            422,
            { rateId: rateReference.id, demandRoomId: incompatibleRoom.id },
          )
        }
        if (option.pricingMode === 'catalog') {
          const catalogValues = [
            moneyToMinorUnits(rate.nightly_amount),
            moneyToMinorUnits(rate.tax_amount),
            moneyToMinorUnits(rate.service_fee_amount),
          ]
          if (catalogValues[0] !== nightlyRateMinor
            || catalogValues[1] !== nightlyTaxesMinor
            || catalogValues[2] !== serviceFeeMinor) {
            throw new TravelGovernanceError(
              'OFFLINE_QUOTE_CATALOG_RATE_CHANGED',
              'Os valores nao correspondem mais a tarifa cadastrada. Reaplique ou marque a edicao manual.',
              409,
              { rateId: rateReference.id },
            )
          }
          const authoritativeTerms = typeof rate.metadata?.paymentTerms === 'string'
            ? rate.metadata.paymentTerms.trim() || null
            : null
          const catalogFieldsMatch = option.roomCategory.trim() === rate.room_name.trim()
            && nullableText(option.mealPlan) === nullableText(rate.meal_plan)
            && option.refundable === (rate.refundable === true)
            && nullableText(option.cancellationPolicy) === nullableText(rate.cancellation_policy)
            && nullableText(option.paymentTerms) === authoritativeTerms
          if (!catalogFieldsMatch) {
            throw new TravelGovernanceError(
              'OFFLINE_QUOTE_CATALOG_TERMS_CHANGED',
              'As condicoes nao correspondem mais a tarifa cadastrada. Reaplique ou marque a edicao manual.',
              409,
              { rateId: rateReference.id },
            )
          }
        }
      }
      const roomCount = rooms.length
      const taxesSubtotalMinor = nightlyTaxesMinor * nights * roomCount
      const calculated = calculateHotelQuote({
        rooms: rooms.map(() => ({ nightlyAmountMinor: nightlyRateMinor })),
        nights,
        charges: [
          ...(taxesSubtotalMinor ? [{ type: 'tax' as const, amountMinor: taxesSubtotalMinor }] : []),
          ...(serviceFeeMinor ? [{ type: 'fee' as const, amountMinor: serviceFeeMinor }] : []),
        ],
      })
      const cancellationDeadline = option.cancellationDeadline || null
      if (cancellationDeadline
          && Date.parse(cancellationDeadline) >= Date.parse(hotelDateTime(checkIn, '14:00:00'))) {
        throw new TravelGovernanceError(
          'OFFLINE_QUOTE_CANCELLATION_DEADLINE_INVALID',
          'O prazo de cancelamento deve ser anterior ao check-in.',
          422,
        )
      }
      return {
        clientId: option.clientId,
        providerOptionId: `offline-option:${option.clientId}`,
        hotelId: hotel.hotel_id,
        hotelSupplierId: hotel.hotel_supplier_id,
        hotelName: hotel.hotel_name,
        hotelCategory: hotel.category,
        hotelAddress: hotel.address,
        hotelPhone: hotel.phone,
        cityName: hotel.city_name,
        supplierId: hotel.supplier_id,
        supplierName: hotel.supplier_name,
        supplierCode: hotel.supplier_code,
        pricingMode: option.pricingMode,
        rateReference,
        rateOutsideValidity: rateReference
          ? !catalogRateById.get(rateReference.id)!.inside_validity
          : false,
        outOfPeriodPolicy: rateReference
          ? catalogRateById.get(rateReference.id)!.out_of_period_policy
          : 'block',
        roomCategory: option.roomCategory,
        mealPlan: option.mealPlan || null,
        refundable: option.refundable,
        cancellationDeadline,
        cancellationPolicy: option.cancellationPolicy || null,
        paymentTerms: option.paymentTerms || null,
        notes: option.notes || null,
        nightlyRateMinor,
        nightlyTaxesMinor,
        serviceFeeMinor,
        roomSubtotalMinor: calculated.subtotalMinor,
        taxesSubtotalMinor,
        totalMinor: calculated.totalMinor,
        nights,
        roomCount,
      }
    })
    return {
      demand,
      rooms,
      options,
      expiresAt: normalizeExpiry(input.expiresAt, options, checkIn),
    }
  })
}

async function persistHotelOptionDetails(
  client: PoolClient,
  principal: RequestPrincipal,
  prepared: PreparedHotelQuote,
  optionIdsByProviderId: ReadonlyMap<string, string>,
): Promise<void> {
  for (const option of prepared.options) {
    const quoteOptionId = optionIdsByProviderId.get(option.providerOptionId)
    if (!quoteOptionId) {
      throw new TravelGovernanceError('OFFLINE_QUOTE_OPTION_PERSISTENCE_FAILED', 'A opcao publicada nao foi localizada.', 409)
    }
    await client.query(
      `insert into hotel_quote_option_details (
         tenant_id, quote_option_id, hotel_id, supplier_id, meal_plan,
         room_category, cancellation_policy, payment_terms, metadata
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       on conflict (tenant_id, quote_option_id) do update set
         hotel_id = excluded.hotel_id, supplier_id = excluded.supplier_id,
         meal_plan = excluded.meal_plan, room_category = excluded.room_category,
         cancellation_policy = excluded.cancellation_policy,
         payment_terms = excluded.payment_terms, metadata = excluded.metadata,
         updated_at = now()`,
      [
        principal.tenantId,
        quoteOptionId,
        option.hotelId,
        option.supplierId,
        option.mealPlan,
        option.roomCategory,
        option.cancellationPolicy,
        option.paymentTerms,
        JSON.stringify({
          source: PROVIDER,
          hotelSupplierId: option.hotelSupplierId,
          pricingMode: option.pricingMode,
          rateReference: option.rateReference,
          rateOutsideValidity: option.rateOutsideValidity,
          outOfPeriodPolicy: option.outOfPeriodPolicy,
          refundable: option.refundable,
          cancellationDeadline: option.cancellationDeadline,
          notes: option.notes,
        }),
      ],
    )
    for (const room of prepared.rooms) {
      await client.query(
        `insert into hotel_quote_room_rates (
           tenant_id, quote_option_id, demand_room_id, room_category,
           nightly_amount_minor, nights, subtotal_amount_minor, currency
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (tenant_id, quote_option_id, demand_room_id) do update set
           room_category = excluded.room_category,
           nightly_amount_minor = excluded.nightly_amount_minor,
           nights = excluded.nights,
           subtotal_amount_minor = excluded.subtotal_amount_minor,
           currency = excluded.currency`,
        [
          principal.tenantId,
          quoteOptionId,
          room.id,
          option.roomCategory,
          option.nightlyRateMinor,
          option.nights,
          option.nightlyRateMinor * option.nights,
          CURRENCY,
        ],
      )
    }
    if (option.taxesSubtotalMinor) {
      await insertChargeLine(client, principal.tenantId, quoteOptionId, 'tax', 'TAXAS_DIARIAS', 'Taxas da hospedagem', option.taxesSubtotalMinor)
    }
    if (option.serviceFeeMinor) {
      await insertChargeLine(client, principal.tenantId, quoteOptionId, 'fee', 'TAXA_SERVICO', 'Taxa de servico', option.serviceFeeMinor)
    }
  }
}

async function insertChargeLine(
  client: PoolClient,
  tenantId: string,
  quoteOptionId: string,
  type: 'tax' | 'fee',
  code: string,
  description: string,
  amountMinor: number,
): Promise<void> {
  await client.query(
    `insert into quote_option_charge_lines (
       tenant_id, quote_option_id, charge_type, code, description, amount_minor, currency
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, quoteOptionId, type, code, description, amountMinor, CURRENCY],
  )
}

async function supersedePreviousOfflineHotelQuoteRounds(
  client: PoolClient,
  principal: RequestPrincipal,
  demandId: string,
  currentQuoteId: string,
): Promise<void> {
  const superseded = await client.query<{ id: string }>(
    `update travel_quotes previous_quote
     set status = 'expired', updated_at = now()
     where previous_quote.tenant_id = $1
       and previous_quote.demand_id = $2
       and previous_quote.id <> $3
       and previous_quote.provider = $4
       and previous_quote.service_type = 'hotelaria'
       and previous_quote.request_payload #>> '{raw,manualOffline}' = 'true'
       and previous_quote.status in ('pending', 'completed')
       and not exists (
         select 1
         from travel_quote_selections selection
         where selection.tenant_id = previous_quote.tenant_id
           and selection.quote_id = previous_quote.id
           and selection.status = any($5::text[])
       )
     returning previous_quote.id`,
    [principal.tenantId, demandId, currentQuoteId, PROVIDER, [...ACTIVE_SELECTION_STATUSES]],
  )

  for (const previousQuote of superseded.rows) {
    await client.query(
      `insert into audit_logs (
         tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
       ) values ($1, $2, 'travel.quote.superseded', 'travel_quote', $3, 'success', $4::jsonb)`,
      [
        principal.tenantId,
        principal.user.id,
        previousQuote.id,
        JSON.stringify({
          demandId,
          previousQuoteId: previousQuote.id,
          currentQuoteId,
          reason: 'new_offline_hotel_quote_round',
        }),
      ],
    )
  }
}

async function prepareSelection(
  principal: RequestPrincipal,
  input: OfflineQuoteSelectionInput,
): Promise<SelectionPreparation | { replay: OfflineQuoteSelectionResult }> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const existingByKey = await client.query<ExistingSelectionRow>(
      `select id, demand_id, quote_id, option_id, status, snapshot_hash,
              approval_instance_id, version, chosen_at
       from travel_quote_selections
       where tenant_id = $1 and idempotency_key = $2
       for update`,
      [principal.tenantId, input.idempotencyKey],
    )
    if (existingByKey.rows[0]) {
      const existing = existingByKey.rows[0]
      if (existing.demand_id !== input.demandId || existing.quote_id !== input.quoteId || existing.option_id !== input.optionId) {
        throw new TravelGovernanceError('OFFLINE_SELECTION_IDEMPOTENCY_CONFLICT', 'A chave de idempotencia pertence a outra escolha.', 409)
      }
      const demand = await loadQuoteDemand(client, principal.tenantId, input.demandId, true)
      return { replay: selectionResult(existing, demand, true) }
    }

    const demand = await loadQuoteDemand(client, principal.tenantId, input.demandId, true)
    await requireCompanyAccess(principal, demand.company_id, 'criar_demandas')
    await assertRequesterOwnsDemand(client, principal, demand)
    const option = await loadSelectionContext(client, principal.tenantId, input)
    if (option.demand_id !== demand.id || option.company_id !== demand.company_id) {
      throw new TravelGovernanceError('OFFLINE_SELECTION_SCOPE_MISMATCH', 'A cotacao nao pertence a demanda informada.', 409)
    }
    if (lifecycleVersion(demand) !== input.expectedLifecycleVersion) {
      throw new TravelGovernanceError('STALE_LIFECYCLE_VERSION', 'A demanda foi alterada. Atualize a pagina e tente novamente.', 409)
    }
    if (option.quote_status === 'selected') {
      throw new TravelGovernanceError('OFFLINE_SELECTION_ALREADY_EXISTS', 'Esta cotacao ja possui uma escolha ativa.', 409)
    }
    if (option.quote_status === 'expired') {
      throw new TravelGovernanceError('OFFLINE_SELECTION_QUOTE_EXPIRED', 'A cotacao expirou. Solicite uma nova rodada.', 409)
    }
    if (option.quote_status === 'failed') {
      throw new TravelGovernanceError('OFFLINE_SELECTION_QUOTE_FAILED', 'A cotacao falhou e nao pode ser escolhida.', 409)
    }
    if (option.quote_status !== 'completed') {
      throw new TravelGovernanceError('OFFLINE_SELECTION_QUOTE_INVALID', 'A cotacao nao esta publicada para escolha.', 409)
    }
    if (option.quote_expires_at && Date.parse(String(option.quote_expires_at)) <= Date.now()) {
      throw new TravelGovernanceError('OFFLINE_SELECTION_QUOTE_EXPIRED', 'A cotacao expirou. Solicite uma nova rodada.', 409)
    }
    if (!option.is_current_round) {
      throw new TravelGovernanceError(
        'OFFLINE_SELECTION_QUOTE_NOT_CURRENT',
        'Esta rodada foi substituida por uma cotacao mais recente. Atualize a pagina.',
        409,
      )
    }
    const active = await client.query<ExistingSelectionRow>(
      `select id, demand_id, quote_id, option_id, status, snapshot_hash,
              approval_instance_id, version, chosen_at
       from travel_quote_selections
       where tenant_id = $1 and demand_id = $2
         and status = any($3::text[])
       for update`,
      [principal.tenantId, demand.id, [...ACTIVE_SELECTION_STATUSES]],
    )
    if (active.rows[0]) {
      throw new TravelGovernanceError('OFFLINE_SELECTION_ALREADY_EXISTS', 'Esta demanda ja possui uma escolha ativa.', 409)
    }
    if (lifecycleStatus(demand) !== 'pending_choice') {
      throw new TravelGovernanceError(
        'OFFLINE_SELECTION_STATE_INVALID',
        `A demanda esta no estado ${demand.lifecycle_status} e nao aceita escolha de cotacao.`,
        409,
      )
    }

    const selectionId = randomUUID()
    const snapshot = canonicalSelectionSnapshot(demand, option)
    const snapshotHash = sha256(snapshot)
    const policy = await evaluateAndPersistPoliciesInTransaction(client, principal, {
      companyId: demand.company_id,
      employeeId: demand.employee_id,
      demandId: demand.id,
      context: {
        checkpoint: 'selection',
        evaluatedAt: new Date().toISOString(),
        mode: 'enforce',
        scopes: policyScopes(demand),
        facts: selectionPolicyFacts(demand, option, snapshot),
      },
    })
    if (!policy.result.passed || policy.result.blocks.length) {
      throw new TravelGovernanceError(
        'OFFLINE_SELECTION_POLICY_BLOCKED',
        'A politica vigente bloqueia esta escolha.',
        422,
        { policies: policy.result.blocks.map((block) => block.policyCode) },
      )
    }
    if (policy.result.justificationsRequired.length) {
      throw new TravelGovernanceError(
        'OFFLINE_SELECTION_JUSTIFICATION_REQUIRED',
        'A politica exige justificativa antes desta escolha.',
        422,
        { policies: policy.result.justificationsRequired.map((item) => item.policyCode) },
      )
    }
    const workflowCode = policy.result.approvalsRequired.length
      ? await resolveApprovalWorkflowCode(client, principal.tenantId, policy.result)
      : null
    if (policy.result.approvalsRequired.length && !workflowCode) {
      throw new TravelGovernanceError(
        'OFFLINE_SELECTION_WORKFLOW_NOT_CONFIGURED',
        'A politica exige aprovacao, mas nao aponta para um unico workflow publicado.',
        422,
      )
    }
    const requirements: TravelTransitionRequirements = {
      policyEvaluationId: policy.databaseEvaluationId,
      policyPassed: true,
      policyHasBlocks: false,
      approvalsSatisfied: policy.result.approvalsRequired.length === 0,
      companySelected: true,
      travelerSelected: Boolean(demand.employee_id || demand.passenger_name_snapshot.trim()),
      offerSelected: true,
      budgetSatisfied: !policy.result.requiredActions.some((item) => item.action === 'require_budget'),
    }
    return {
      input,
      selectionId,
      demand,
      option,
      snapshot,
      snapshotHash,
      policyEvaluationId: policy.databaseEvaluationId,
      policyResult: policy.result,
      workflowCode,
      requirements,
      subject: {
        amount: numberValue(option.amount),
        currency: option.currency,
        urgent: demand.priority === 'urgent',
        product: selectionServiceKey(demand, option),
        destination: selectionDestination(demand, option),
        policyViolationCodes: policy.result.approvalsRequired.map((item) => item.policyCode),
        quoteSelectionId: selectionId,
        quoteId: option.quote_id,
        quoteOptionId: option.option_id,
        quoteSnapshotHash: snapshotHash,
        quoteSnapshot: snapshot,
      },
    }
  })
}

async function persistSelection(
  client: PoolClient,
  principal: RequestPrincipal,
  preparation: SelectionPreparation,
  approvalInstanceId: string | null,
  approvalStatus: string | null,
): Promise<OfflineQuoteSelectionResult> {
  let demand = await loadQuoteDemand(client, principal.tenantId, preparation.demand.id, true)
  if (lifecycleVersion(demand) !== preparation.input.expectedLifecycleVersion || lifecycleStatus(demand) !== 'pending_choice') {
    throw new TravelGovernanceError('OFFLINE_SELECTION_STALE', 'A demanda mudou durante a escolha. Atualize a pagina.', 409)
  }
  const approved = !preparation.workflowCode || approvalStatus === 'approved'
  const persistedSelectionStatus: OfflineQuoteSelectionReadModel['status'] = approved
    ? 'approved'
    : 'pending_approval'
  const insertedSelection = await client.query<{ chosen_at: string | Date }>(
    `insert into travel_quote_selections (
       id, tenant_id, demand_id, quote_id, option_id, status,
       snapshot, snapshot_hash, approval_instance_id, chosen_by,
       idempotency_key
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
     returning chosen_at`,
    [
      preparation.selectionId,
      principal.tenantId,
      demand.id,
      preparation.option.quote_id,
      preparation.option.option_id,
      persistedSelectionStatus,
      JSON.stringify(preparation.snapshot),
      preparation.snapshotHash,
      approvalInstanceId,
      principal.user.id,
      preparation.input.idempotencyKey,
    ],
  )
  const requirements: TravelTransitionRequirements = {
    ...preparation.requirements,
    approvalInstanceId,
    approvalsSatisfied: approved,
    offerSelected: true,
  }
  await persistTravelTransitionInTransaction(
    client,
    principal,
    lifecycleRecord(demand),
    'select_offer',
    {
      idempotencyKey: selectionOperationKey(principal, preparation.input, 'select'),
      requirements,
      metadata: {
        channel: 'offline',
        selectionId: preparation.selectionId,
        quoteId: preparation.option.quote_id,
        quoteOptionId: preparation.option.option_id,
        snapshotHash: preparation.snapshotHash,
        approvalInstanceId,
      },
    },
  )
  demand = await loadQuoteDemand(client, principal.tenantId, demand.id, true)
  if (approved && lifecycleStatus(demand) === 'pending_cost_approval') {
    await persistTravelTransitionInTransaction(
      client,
      principal,
      lifecycleRecord(demand),
      'approve_cost',
      {
        idempotencyKey: selectionOperationKey(principal, preparation.input, 'approve-cost'),
        requirements: { ...requirements, approvalsSatisfied: true, budgetSatisfied: requirements.budgetSatisfied !== false },
        metadata: { selectionId: preparation.selectionId, approvalInstanceId },
      },
    )
    demand = await loadQuoteDemand(client, principal.tenantId, demand.id, true)
  }
  await client.query(
    `update travel_quote_options set selected_at = coalesce(selected_at, now()),
       selected_by = coalesce(selected_by, $4)
     where tenant_id = $1 and quote_id = $2 and id = $3`,
    [principal.tenantId, preparation.option.quote_id, preparation.option.option_id, principal.user.id],
  )
  await client.query(
    `update travel_quotes set status = 'selected', updated_at = now()
     where tenant_id = $1 and id = $2`,
    [principal.tenantId, preparation.option.quote_id],
  )
  await client.query(
    `update demands set final_amount = $3, updated_by = $4, updated_at = now()
     where tenant_id = $1 and id = $2`,
    [principal.tenantId, demand.id, numberValue(preparation.option.amount), principal.user.id],
  )
  await client.query(
    `insert into audit_logs (
       tenant_id, actor_user_id, action, entity_type, entity_id, result, metadata
     ) values ($1, $2, 'travel.quote.selected', 'travel_quote_selection', $3, 'success', $4::jsonb)`,
    [
      principal.tenantId,
      principal.user.id,
      preparation.selectionId,
      JSON.stringify({
        demandId: demand.id,
        quoteId: preparation.option.quote_id,
        optionId: preparation.option.option_id,
        snapshotHash: preparation.snapshotHash,
        approvalInstanceId,
      }),
    ],
  )
  return {
    id: preparation.selectionId,
    demandId: demand.id,
    quoteId: preparation.option.quote_id,
    optionId: preparation.option.option_id,
    status: persistedSelectionStatus,
    lifecycleStatus: lifecycleStatus(demand),
    lifecycleVersion: lifecycleVersion(demand),
    approvalInstanceId,
    selectedAt: requiredDateTime(insertedSelection.rows[0].chosen_at),
    replayed: false,
  }
}

async function loadQuoteDemand(
  client: PoolClient,
  tenantId: string,
  demandId: string,
  forUpdate: boolean,
): Promise<QuoteDemandRow> {
  const result = await client.query<QuoteDemandRow>(
    `select demand.*, company.group_id,
            coalesce(company.trade_name, company.legal_name) as company_name,
            employee.full_name as employee_name,
            employee.department as employee_department,
            detail.city_id,
            coalesce(city.name, demand.destination) as city_name,
            coalesce(detail.check_in, demand.travel_start_date) as check_in,
            coalesce(detail.check_out, demand.travel_end_date) as check_out,
            coalesce((
              select array_agg(preference.hotel_id order by preference.preference_order)
              from hotel_demand_preferred_hotels preference
              where preference.tenant_id = demand.tenant_id
                and preference.demand_id = demand.id
            ), case when detail.preferred_hotel_id is null
              then array[]::text[] else array[detail.preferred_hotel_id]::text[] end) as preferred_hotel_ids
     from demands demand
     join companies company
       on company.tenant_id = demand.tenant_id and company.id = demand.company_id
     left join employees employee
       on employee.tenant_id = demand.tenant_id and employee.id = demand.employee_id
     left join hotel_demand_details detail
       on detail.tenant_id = demand.tenant_id and detail.demand_id = demand.id
     left join geo_cities city on city.id = detail.city_id
     where demand.tenant_id = $1 and demand.id = $2 and demand.deleted_at is null
     ${forUpdate ? 'for update of demand' : ''}`,
    [tenantId, demandId],
  )
  if (!result.rows[0]) {
    throw new TravelGovernanceError('OFFLINE_QUOTE_DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
  }
  lifecycleStatus(result.rows[0])
  return result.rows[0]
}

async function loadSelectionContext(
  client: PoolClient,
  tenantId: string,
  input: OfflineQuoteSelectionInput,
): Promise<SelectionContextRow> {
  const result = await client.query<SelectionContextRow>(
    `select quote.id as quote_id, quote.status as quote_status,
            quote.expires_at as quote_expires_at, quote.option_count as quote_option_count,
            quote.demand_id, quote.company_id, quote.provider_quote_id, quote.service_type,
            option_row.id as option_id, option_row.provider_option_id,
            option_row.supplier_name, option_row.title as option_title,
            option_row.subtitle as option_subtitle, option_row.amount,
            option_row.currency, option_row.refundable, option_row.starts_at,
            option_row.ends_at, option_row.metadata as option_metadata,
            detail.hotel_id, hotel.name as hotel_name, hotel.category as hotel_category,
            hotel.address as hotel_address, hotel.phone as hotel_phone,
            detail.room_category, detail.meal_plan, detail.cancellation_policy,
            detail.payment_terms, detail.metadata as hotel_metadata,
            not exists (
              select 1
              from audit_logs supersession
              where supersession.tenant_id = quote.tenant_id
                and supersession.action = 'travel.quote.superseded'
                and supersession.entity_type = 'travel_quote'
                and supersession.entity_id = quote.id::text
            ) and not exists (
              select 1
              from travel_quotes newer_quote
              where newer_quote.tenant_id = quote.tenant_id
                and newer_quote.demand_id = quote.demand_id
                and newer_quote.provider = quote.provider
                and newer_quote.service_type = quote.service_type
                and newer_quote.request_payload #>> '{raw,manualOffline}' = 'true'
                and newer_quote.status in ('completed', 'selected')
                and (
                  newer_quote.created_at > quote.created_at
                  or (newer_quote.created_at = quote.created_at and newer_quote.id > quote.id)
                )
            ) as is_current_round
     from travel_quotes quote
     join travel_quote_options option_row
       on option_row.tenant_id = quote.tenant_id and option_row.quote_id = quote.id
     left join hotel_quote_option_details detail
       on detail.tenant_id = option_row.tenant_id and detail.quote_option_id = option_row.id
     left join hotels hotel
       on hotel.tenant_id = detail.tenant_id and hotel.id = detail.hotel_id
     where quote.tenant_id = $1 and quote.id = $2 and option_row.id = $3
       and quote.demand_id = $4 and quote.provider = $5
     for update of quote, option_row`,
    [tenantId, input.quoteId, input.optionId, input.demandId, PROVIDER],
  )
  if (!result.rows[0]) {
    throw new TravelGovernanceError('OFFLINE_QUOTE_OPTION_NOT_FOUND', 'Cotacao ou opcao nao encontrada para esta demanda.', 404)
  }
  return result.rows[0]
}

async function assertRequesterOwnsDemand(
  client: PoolClient,
  principal: RequestPrincipal,
  demand: Pick<QuoteDemandRow, 'requester_id' | 'company_id'>,
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
      'OFFLINE_SELECTION_REQUESTER_MISMATCH',
      'Somente o solicitante responsavel pode escolher uma opcao para esta demanda.',
      403,
    )
  }
}

function canonicalSelectionSnapshot(
  demand: QuoteDemandRow,
  option: SelectionContextRow,
): Record<string, unknown> {
  const serviceKey = selectionServiceKey(demand, option)
  const optionMetadata = objectValue(option.option_metadata)
  const commonDemand = {
    id: demand.id,
    number: demand.demand_number,
    companyId: demand.company_id,
    requesterId: demand.requester_id,
    employeeId: demand.employee_id,
    passengerName: demand.passenger_name_snapshot,
    startDate: dateOnly(demand.travel_start_date || demand.check_in),
    endDate: dateOnly(demand.travel_end_date || demand.check_out),
    destination: demand.destination || demand.city_name,
  }
  const commonOption = {
    id: option.option_id,
    providerOptionId: option.provider_option_id,
    supplierName: option.supplier_name,
    title: option.option_title,
    subtitle: option.option_subtitle,
    amount: numberValue(option.amount),
    currency: option.currency,
    refundable: option.refundable,
    startsAt: dateTimeOrNull(option.starts_at),
    endsAt: dateTimeOrNull(option.ends_at),
  }

  if (serviceKey === 'aereo') {
    return {
      version: 1,
      serviceKey,
      demand: {
        ...commonDemand,
        airRequest: airDemandDetails(demand),
      },
      quote: {
        id: option.quote_id,
        providerQuoteId: option.provider_quote_id,
        optionCount: Number(option.quote_option_count),
        expiresAt: dateTimeOrNull(option.quote_expires_at),
      },
      option: {
        ...commonOption,
        air: objectValue(optionMetadata.offlineAir),
        breakdown: objectValue(objectValue(optionMetadata.offlineAir).pricing),
      },
    }
  }

  return {
    version: 1,
    serviceKey: 'hotelaria',
    demand: {
      ...commonDemand,
      checkIn: dateOnly(demand.check_in),
      checkOut: dateOnly(demand.check_out),
      cityId: demand.city_id,
      cityName: demand.city_name,
    },
    quote: {
      id: option.quote_id,
      providerQuoteId: option.provider_quote_id,
      optionCount: Number(option.quote_option_count),
      expiresAt: dateTimeOrNull(option.quote_expires_at),
    },
    option: {
      ...commonOption,
      hotel: {
        id: option.hotel_id,
        name: option.hotel_name,
        category: option.hotel_category,
        address: option.hotel_address,
        phone: option.hotel_phone,
        roomCategory: option.room_category,
        mealPlan: option.meal_plan,
        cancellationPolicy: option.cancellation_policy,
        paymentTerms: option.payment_terms,
      },
      breakdown: objectValue(option.option_metadata).offlineHotel || {},
    },
  }
}

function selectionPolicyFacts(
  demand: QuoteDemandRow,
  option: SelectionContextRow,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const serviceKey = selectionServiceKey(demand, option)
  const destination = selectionDestination(demand, option)
  const breakdown = objectValue(objectValue(option.option_metadata).offlineHotel)
  const baseFacts: Record<string, unknown> = {
    tenant: { id: demand.tenant_id },
    organization: { groupId: demand.group_id, companyId: demand.company_id },
    company: { id: demand.company_id, name: demand.company_name, groupId: demand.group_id },
    employee: {
      id: demand.employee_id,
      name: demand.employee_name || demand.passenger_name_snapshot,
      department: demand.employee_department,
      costCenter: demand.cost_center,
      registered: Boolean(demand.employee_id),
    },
    traveler: { id: demand.employee_id, name: demand.employee_name || demand.passenger_name_snapshot },
    requester: { id: demand.requester_id },
    request: {
      id: demand.id,
      number: demand.demand_number,
      service: serviceKey,
      priority: demand.priority,
      destination,
      startDate: dateOnly(demand.travel_start_date || demand.check_in),
      endDate: dateOnly(demand.travel_end_date || demand.check_out),
      costCenter: demand.cost_center,
    },
    quote: {
      id: option.quote_id,
      offerCount: Number(option.quote_option_count),
      selectedOptionId: option.option_id,
      selectedAmount: numberValue(option.amount),
      currency: option.currency,
      supplier: option.supplier_name,
      snapshot,
    },
    finance: { totalAmount: numberValue(option.amount), currency: option.currency },
    operation: { checkpoint: 'selection', provider: PROVIDER, channel: 'offline', requestedAt: new Date().toISOString() },
  }
  if (serviceKey === 'aereo') {
    const air = objectValue(objectValue(option.option_metadata).offlineAir)
    return {
      ...baseFacts,
      air: {
        airline: air.airlineName || option.supplier_name,
        cabinClass: air.cabinClass || null,
        segments: Array.isArray(air.segments) ? air.segments : [],
        ticketingDeadline: air.ticketingDeadline || null,
        totalAmount: numberValue(option.amount),
        refundable: option.refundable,
      },
    }
  }
  return {
    ...baseFacts,
    hotel: {
      id: option.hotel_id,
      name: option.hotel_name,
      city: demand.city_name,
      dailyRate: numberValue(breakdown.nightlyRate),
      totalAmount: numberValue(option.amount),
      refundable: option.refundable,
      preferred: (demand.preferred_hotel_ids || []).includes(String(option.hotel_id || '')),
    },
  }
}

function selectionServiceKey(demand: QuoteDemandRow, option: SelectionContextRow): 'hotelaria' | 'aereo' {
  const quoteService = offlineServiceFromDemand(option.service_type)
  const demandService = offlineServiceFromDemand(demand.service_type)
  const service = quoteService || demandService
  if (service !== 'hotelaria' && service !== 'aereo') {
    throw new TravelGovernanceError(
      'OFFLINE_SELECTION_SERVICE_NOT_SUPPORTED',
      'Este tipo de cotacao ainda nao possui escolha formal offline.',
      422,
      { quoteService: option.service_type, demandService: demand.service_type },
    )
  }
  if (demandService && quoteService && demandService !== quoteService) {
    throw new TravelGovernanceError(
      'OFFLINE_SELECTION_SERVICE_SCOPE_MISMATCH',
      'O servico da cotacao nao corresponde ao servico da demanda.',
      409,
    )
  }
  return service
}

function selectionDestination(demand: QuoteDemandRow, option: SelectionContextRow): string | null {
  if (selectionServiceKey(demand, option) === 'hotelaria') return demand.city_name || demand.destination
  const segments = objectValue(objectValue(option.option_metadata).offlineAir).segments
  if (Array.isArray(segments)) {
    const last = segments.length ? objectValue(segments[segments.length - 1]) : {}
    const destination = String(last.destinationName || last.destinationCode || '').trim()
    if (destination) return destination
  }
  return demand.destination
}

function airDemandDetails(demand: QuoteDemandRow): Record<string, unknown> {
  const metadata = objectValue(demand.metadata)
  return objectValue(objectValue(metadata.serviceDetails).air)
}

async function resolveApprovalWorkflowCode(
  client: PoolClient,
  tenantId: string,
  result: PolicyEvaluationResult,
): Promise<string | null> {
  const configured = result.approvalsRequired.flatMap((item) => {
    const workflow = item.configuration.workflow
    return typeof workflow === 'string' && workflow.trim() ? [workflow.trim()] : []
  })
  const versionIds = Array.from(new Set(result.approvalsRequired.map((item) => item.policyVersionId)))
  const dependencies = versionIds.length
    ? await client.query<{ dependency_key: string }>(
        `select distinct dependency_key from policy_dependencies
         where tenant_id = $1 and policy_version_id = any($2::uuid[])
           and dependency_type = 'workflow' and required = true`,
        [tenantId, versionIds],
      )
    : { rows: [] as Array<{ dependency_key: string }> }
  const candidates = Array.from(new Set([
    ...configured,
    ...dependencies.rows.map((row) => row.dependency_key.trim()).filter(Boolean),
  ]))
  return candidates.length === 1 ? candidates[0] : null
}

function mapQuoteRows(rows: QuoteListRow[]): OfflineHotelQuoteReadModel[] {
  const byQuote = new Map<string, OfflineHotelQuoteReadModel>()
  for (const row of rows) {
    let quote = byQuote.get(row.quote_id)
    if (!quote) {
      quote = {
        id: row.quote_id,
        demandId: row.demand_id,
        demandNumber: row.demand_number,
        lifecycleStatus: row.lifecycle_status,
        lifecycleVersion: Number(row.lifecycle_version),
        status: quoteStatus(row.quote_status),
        expiresAt: dateTimeOrNull(row.expires_at),
        selectedOptionId: null,
        options: [],
        createdAt: requiredDateTime(row.created_at),
        updatedAt: requiredDateTime(row.updated_at),
      }
      byQuote.set(row.quote_id, quote)
    }
    const metadata = objectValue(row.option_metadata)
    const breakdown = objectValue(metadata.offlineHotel)
    const hotelMetadata = objectValue(row.hotel_metadata)
    const hotelId = row.hotel_id || stringOrEmpty(breakdown.hotelId)
    if (!hotelId) {
      throw new TravelGovernanceError(
        'OFFLINE_QUOTE_READ_MODEL_INVALID',
        'Uma opcao da cotacao nao possui hotel relacional.',
        500,
      )
    }
    const option: OfflineHotelQuoteOptionReadModel = {
      id: row.option_id,
      clientId: stringOrEmpty(breakdown.clientId) || offlineClientId(row.provider_option_id),
      hotelId,
      supplierId: nullableText(breakdown.supplierId),
      supplierName: row.supplier_name || 'Fornecedor nao informado',
      supplierCode: nullableText(breakdown.supplierCode),
      hotel: {
        id: hotelId,
        name: row.hotel_name || row.title,
        cityId: row.hotel_city_id,
        cityName: row.hotel_city_name,
        subdivisionCode: row.hotel_subdivision_code,
        countryCode: row.hotel_country_code,
        address: row.hotel_address,
        category: row.hotel_category,
      },
      startsAt: dateTimeOrNull(row.starts_at),
      endsAt: dateTimeOrNull(row.ends_at),
      roomCategory: row.room_category || stringOrEmpty(breakdown.roomCategory),
      mealPlan: row.meal_plan || nullableText(breakdown.mealPlan),
      refundable: row.refundable ?? Boolean(hotelMetadata.refundable ?? breakdown.refundable),
      cancellationDeadline: dateTimeOrNull(hotelMetadata.cancellationDeadline ?? breakdown.cancellationDeadline),
      cancellationPolicy: row.cancellation_policy || nullableText(breakdown.cancellationPolicy),
      paymentTerms: row.payment_terms || nullableText(breakdown.paymentTerms),
      notes: nullableText(hotelMetadata.notes ?? breakdown.notes),
      selected: Boolean(row.selection_id),
      selectionId: row.selection_id,
      selectionStatus: effectiveSelectionStatus(row.selection_status, row.approval_status),
      approvalInstanceId: row.approval_instance_id,
      approvalStatus: row.approval_status,
      breakdown: {
        nights: numberValue(breakdown.nights),
        roomCount: numberValue(breakdown.roomCount),
        nightlyRate: numberValue(breakdown.nightlyRate),
        nightlyTaxes: numberValue(breakdown.nightlyTaxes),
        roomSubtotal: numberValue(breakdown.roomSubtotal),
        taxesSubtotal: numberValue(breakdown.taxesSubtotal),
        serviceFee: numberValue(breakdown.serviceFee),
        total: numberValue(breakdown.total ?? row.amount),
        currency: stringOrEmpty(breakdown.currency) || row.currency,
      },
    }
    quote.options.push(option)
    if (option.selected) quote.selectedOptionId = option.id
  }
  return [...byQuote.values()]
}

function selectionResult(
  selection: ExistingSelectionRow,
  demand: QuoteDemandRow,
  replayed: boolean,
): OfflineQuoteSelectionResult {
  return {
    id: selection.id,
    demandId: selection.demand_id,
    quoteId: selection.quote_id,
    optionId: selection.option_id,
    status: selectionStatus(selection.status),
    lifecycleStatus: lifecycleStatus(demand),
    lifecycleVersion: lifecycleVersion(demand),
    approvalInstanceId: selection.approval_instance_id,
    selectedAt: requiredDateTime(selection.chosen_at),
    replayed,
  }
}

function optionMetadata(option: PreparedHotelOption): Record<string, unknown> {
  return {
    clientId: option.clientId,
    hotelId: option.hotelId,
    hotelSupplierId: option.hotelSupplierId,
    supplierId: option.supplierId,
    supplierCode: option.supplierCode,
    pricingMode: option.pricingMode,
    rateReference: option.rateReference,
    rateOutsideValidity: option.rateOutsideValidity,
    outOfPeriodPolicy: option.outOfPeriodPolicy,
    roomCategory: option.roomCategory,
    mealPlan: option.mealPlan,
    refundable: option.refundable,
    cancellationDeadline: option.cancellationDeadline,
    cancellationPolicy: option.cancellationPolicy,
    paymentTerms: option.paymentTerms,
    notes: option.notes,
    nights: option.nights,
    roomCount: option.roomCount,
    nightlyRate: minorUnitsToMoney(option.nightlyRateMinor),
    nightlyTaxes: minorUnitsToMoney(option.nightlyTaxesMinor),
    roomSubtotal: minorUnitsToMoney(option.roomSubtotalMinor),
    taxesSubtotal: minorUnitsToMoney(option.taxesSubtotalMinor),
    serviceFee: minorUnitsToMoney(option.serviceFeeMinor),
    total: minorUnitsToMoney(option.totalMinor),
    currency: CURRENCY,
  }
}

function normalizeExpiry(
  explicit: string | undefined,
  options: PreparedHotelOption[],
  checkIn: string | Date,
): string | undefined {
  const candidates = [
    explicit,
    ...options.map((option) => option.cancellationDeadline || undefined),
  ].flatMap((value) => value && Number.isFinite(Date.parse(value)) ? [new Date(value).toISOString()] : [])
  const fallback = new Date(Math.min(
    Date.now() + 7 * 86_400_000,
    Date.parse(String(checkIn)) - 86_400_000,
  )).toISOString()
  const expiresAt = candidates.sort()[0] || fallback
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new TravelGovernanceError('OFFLINE_QUOTE_EXPIRY_INVALID', 'A validade da cotacao deve estar no futuro.', 422)
  }
  return expiresAt
}

function policyScopes(demand: QuoteDemandRow): PolicyScopeContext[] {
  return [
    { type: 'tenant', id: null },
    ...(demand.group_id ? [{ type: 'group' as const, id: demand.group_id }] : []),
    { type: 'company', id: demand.company_id },
    ...(demand.employee_department ? [{ type: 'department' as const, id: demand.employee_department }] : []),
    ...(demand.employee_id ? [{ type: 'traveler' as const, id: demand.employee_id }] : []),
    ...(demand.requester_id ? [{ type: 'requester' as const, id: demand.requester_id }] : []),
  ]
}

function lifecycleRecord(demand: QuoteDemandRow): TravelLifecycleRecord {
  return {
    demandId: demand.id,
    companyId: demand.company_id,
    status: lifecycleStatus(demand),
    version: lifecycleVersion(demand),
    lastPolicyEvaluationId: demand.last_policy_evaluation_id,
    activeApprovalInstanceId: demand.active_approval_instance_id,
  }
}

function lifecycleStatus(demand: QuoteDemandRow): TravelLifecycleStatus {
  const status = demand.lifecycle_status as TravelLifecycleStatus
  if (!LIFECYCLE_STATUSES.has(status)) {
    throw new TravelGovernanceError('OFFLINE_QUOTE_LIFECYCLE_INVALID', 'Estado da demanda invalido.', 500)
  }
  return status
}

function lifecycleVersion(demand: QuoteDemandRow): number {
  const version = Number(demand.lifecycle_version)
  if (!Number.isInteger(version) || version < 1) {
    throw new TravelGovernanceError('OFFLINE_QUOTE_LIFECYCLE_VERSION_INVALID', 'Versao da demanda invalida.', 500)
  }
  return version
}

function dateOnly(value: string | Date | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function hotelDateTime(value: string | Date, time: string): string {
  return `${dateOnly(value)}T${time}-03:00`
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
      'OFFLINE_QUOTE_READ_MODEL_INVALID',
      'A cotacao possui uma data relacional invalida.',
      500,
    )
  }
  return normalized
}

function quoteStatus(value: string): OfflineHotelQuoteReadModel['status'] {
  if (['pending', 'completed', 'selected', 'expired', 'failed'].includes(value)) {
    return value as OfflineHotelQuoteReadModel['status']
  }
  throw new TravelGovernanceError('OFFLINE_QUOTE_STATUS_INVALID', 'Estado da cotacao invalido.', 500)
}

function selectionStatus(value: string): OfflineQuoteSelectionReadModel['status'] {
  if (['selected', 'pending_approval', 'approved', 'rejected', 'superseded'].includes(value)) {
    return value as OfflineQuoteSelectionReadModel['status']
  }
  throw new TravelGovernanceError('OFFLINE_SELECTION_STATUS_INVALID', 'Estado da escolha invalido.', 500)
}

function effectiveSelectionStatus(
  value: string | null,
  approvalStatus: string | null,
): OfflineQuoteSelectionReadModel['status'] | null {
  if (!value) return null
  if (value === 'pending_approval' && approvalStatus === 'approved') return 'approved'
  if (value === 'pending_approval' && ['rejected', 'cancelled', 'expired', 'failed'].includes(approvalStatus || '')) {
    return 'rejected'
  }
  return selectionStatus(value)
}

function offlineClientId(providerOptionId: string): string {
  const prefix = 'offline-option:'
  return providerOptionId.startsWith(prefix) ? providerOptionId.slice(prefix.length) : providerOptionId
}

function selectionOperationKey(
  principal: RequestPrincipal,
  input: OfflineQuoteSelectionInput,
  operation: 'approval' | 'select' | 'approve-cost',
  discriminator: string | null = null,
): string {
  const digest = sha256({
    tenantId: principal.tenantId,
    demandId: input.demandId,
    quoteId: input.quoteId,
    optionId: input.optionId,
    idempotencyKey: input.idempotencyKey,
    operation,
    discriminator,
  })
  return `offline-selection-${operation}:${digest}`
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown): string | null {
  const normalized = stringOrEmpty(value)
  return normalized || null
}

function numberValue(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function normalizeService(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function normalizeOccupancyType(value: string): string {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'couple' ? 'double' : normalized
}

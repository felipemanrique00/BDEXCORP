import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import type {
  HotelRateSuggestion,
  HotelRateSuggestionResult,
  HotelRateSuggestionScope,
} from '@/lib/offline-travel/hotel-rate-suggestion'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { TravelGovernanceError } from '@/lib/server/travel-governance-service'

interface DemandRateContextRow extends QueryResultRow {
  demand_id: string
  company_id: string
  group_id: string | null
  service_type: string
  city_id: string
  check_in: string | Date
  check_out: string | Date
  occupancy_types: string[] | null
}

interface RateSuggestionRow extends QueryResultRow {
  hotel_id: string
  hotel_supplier_id: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  room_type_id: string
  room_category: string
  rate_id: string
  rate_version: string | number
  nightly_amount: string | number
  tax_amount: string | number
  service_fee_amount: string | number
  currency: string
  refundable: boolean | null
  meal_plan: string | null
  cancellation_policy: string | null
  payment_terms: string | null
  effective_scope: HotelRateSuggestionScope
  scope_label: string
  inside_validity: boolean
  out_of_period_policy: 'block' | 'warn' | 'allow'
  is_net: boolean
  priority: string | number
}

interface EmissionRateSuggestionRow extends QueryResultRow {
  observation_id: string
  emission_id: string
  issued_at: string | Date
  hotel_id: string
  hotel_supplier_id: string
  supplier_id: string
  supplier_name: string
  supplier_code: string
  room_type_id: string | null
  room_category: string
  catalog_rate_id: string | null
  catalog_rate_version: string | number | null
  nightly_amount: string | number
  nightly_tax_amount: string | number
  service_fee_amount: string | number
  currency: string
  refundable: boolean | null
  meal_plan: string | null
  cancellation_policy: string | null
  payment_terms: string | null
  priority: string | number
}

export interface HotelRateSelectionContext {
  companyId: string
  groupId: string | null
  cityId: string
  checkIn: string
  checkOut: string
  occupancyType: string
  roomCount?: number
  hotelIds?: readonly string[]
}

export interface HotelRateSelectionCandidate extends HotelRateSuggestion {
  isNet: boolean
  supplierPriority: number
}

export async function listHotelRateSuggestionsForDemand(
  principal: RequestPrincipal,
  demandId: string,
): Promise<HotelRateSuggestionResult> {
  const normalizedDemandId = String(demandId || '').trim()
  if (!normalizedDemandId || normalizedDemandId.length > 200) {
    throw new TravelGovernanceError(
      'HOTEL_RATE_SUGGESTION_DEMAND_INVALID',
      'Informe uma demanda valida para consultar tarifas.',
      400,
    )
  }

  return withTenantTransaction(principal.tenantId, async (client) => {
    const contextResult = await client.query<DemandRateContextRow>(
      `select demand.id as demand_id, demand.company_id, company.group_id,
              demand.service_type, detail.city_id, detail.check_in, detail.check_out,
              array_agg(distinct case
                when lower(room.occupancy_code::text) = 'couple' then 'double'
                else lower(room.occupancy_code::text)
              end) filter (where room.id is not null) as occupancy_types
       from demands demand
       join companies company
         on company.tenant_id = demand.tenant_id and company.id = demand.company_id
       join hotel_demand_details detail
         on detail.tenant_id = demand.tenant_id and detail.demand_id = demand.id
       left join hotel_demand_rooms room
         on room.tenant_id = demand.tenant_id and room.demand_id = demand.id
        and room.deleted_at is null
       where demand.tenant_id = $1 and demand.id = $2 and demand.deleted_at is null
       group by demand.id, demand.company_id, company.group_id, demand.service_type,
                detail.city_id, detail.check_in, detail.check_out`,
      [principal.tenantId, normalizedDemandId],
    )
    const context = contextResult.rows[0]
    if (!context) {
      throw new TravelGovernanceError(
        'HOTEL_RATE_SUGGESTION_DEMAND_NOT_FOUND',
        'Demanda hoteleira nao encontrada.',
        404,
      )
    }
    await requireCompanyAccess(principal, context.company_id, 'operar_cotacoes')
    if (!normalizeService(context.service_type).includes('hotel')) {
      throw new TravelGovernanceError(
        'HOTEL_RATE_SUGGESTION_SERVICE_MISMATCH',
        'A demanda selecionada nao e de hotel.',
        422,
      )
    }
    if (!context.city_id) {
      throw new TravelGovernanceError(
        'HOTEL_RATE_SUGGESTION_CITY_REQUIRED',
        'A demanda nao possui cidade relacional para consultar tarifas.',
        422,
      )
    }

    const occupancyTypes = Array.from(new Set(context.occupancy_types || []))
    const baseResult: Omit<HotelRateSuggestionResult, 'items' | 'manualReason'> = {
      demandId: context.demand_id,
      companyId: context.company_id,
      groupId: context.group_id,
      checkIn: dateOnly(context.check_in),
      checkOut: dateOnly(context.check_out),
      occupancyType: occupancyTypes.length === 1 ? occupancyTypes[0] : null,
    }
    if (occupancyTypes.length !== 1) {
      return {
        ...baseResult,
        items: [],
        manualReason: occupancyTypes.length === 0
          ? 'A demanda nao possui quarto ativo para sugerir uma tarifa.'
          : 'A demanda possui ocupacoes diferentes; informe cada valor manualmente para evitar uma tarifa incorreta.',
      }
    }

    const candidates = await listHotelRateSelectionCandidates(client, principal.tenantId, {
      companyId: context.company_id,
      groupId: context.group_id,
      cityId: context.city_id,
      checkIn: dateOnly(context.check_in),
      checkOut: dateOnly(context.check_out),
      occupancyType: occupancyTypes[0],
    })
    const items = candidates.map(withoutInternalRateClassification)

    return {
      ...baseResult,
      items,
      manualReason: items.length
        ? null
        : 'Nenhuma tarifa cadastrada ou ultima emissao valida atende a ocupacao; o preenchimento manual continua disponivel.',
    }
  })
}

/**
 * Shared, server-only rate selection. It intentionally retains operational
 * provenance for internal consumers; public BFFs must project an allow-list.
 */
export async function listHotelRateSelectionCandidates(
  client: PoolClient,
  tenantId: string,
  context: HotelRateSelectionContext,
): Promise<HotelRateSelectionCandidate[]> {
  const roomCount = Math.max(1, Math.min(30, Math.trunc(context.roomCount || 1)))
  const hotelIds = context.hotelIds?.length
    ? Array.from(new Set(context.hotelIds.map((id) => String(id).trim()).filter(Boolean)))
    : null
  const suggestions = await client.query<RateSuggestionRow>(
    `with eligible_rates as (
       select hotel.id as hotel_id,
              link.id as hotel_supplier_id,
              supplier.id as supplier_id,
              coalesce(supplier.trade_name, supplier.legal_name) as supplier_name,
              supplier.internal_code::text as supplier_code,
              room.id as room_type_id,
              room.name as room_category,
              rate.id as rate_id,
              rate.version as rate_version,
              rate.nightly_amount,
              rate.tax_amount,
              rate.service_fee_amount,
              rate.currency,
              rate.refundable,
              rate.meal_plan,
              rate.cancellation_policy,
              nullif(rate.metadata ->> 'paymentTerms', '') as payment_terms,
              (rate.valid_from <= $3::date and rate.valid_until >= ($4::date - 1)) as inside_validity,
              link.out_of_period_policy,
              rate.is_net,
              case
                when rate.scope_type = 'restricted' and exists (
                  select 1 from hotel_supplier_rate_scopes company_scope
                  where company_scope.tenant_id = rate.tenant_id
                    and company_scope.rate_id = rate.id
                    and company_scope.deleted_at is null
                    and company_scope.scope_type = 'company'
                    and company_scope.company_id = $5
                ) then 'company'
                when rate.scope_type = 'restricted' and $6::text is not null and exists (
                  select 1 from hotel_supplier_rate_scopes group_scope
                  where group_scope.tenant_id = rate.tenant_id
                    and group_scope.rate_id = rate.id
                    and group_scope.deleted_at is null
                    and group_scope.scope_type = 'group'
                    and group_scope.business_group_id = $6
                ) then 'group'
                else 'global'
              end as effective_scope,
              case
                when rate.scope_type = 'restricted' and exists (
                  select 1 from hotel_supplier_rate_scopes company_scope
                  where company_scope.tenant_id = rate.tenant_id
                    and company_scope.rate_id = rate.id
                    and company_scope.deleted_at is null
                    and company_scope.scope_type = 'company'
                    and company_scope.company_id = $5
                ) then 'Acordo da empresa'
                when rate.scope_type = 'restricted' then 'Acordo do grupo'
                else 'Tarifa geral'
              end as scope_label,
              case
                when rate.scope_type = 'restricted' and exists (
                  select 1 from hotel_supplier_rate_scopes company_scope
                  where company_scope.tenant_id = rate.tenant_id
                    and company_scope.rate_id = rate.id
                    and company_scope.deleted_at is null
                    and company_scope.scope_type = 'company'
                    and company_scope.company_id = $5
                ) then 3
                when rate.scope_type = 'restricted' then 2
                else 1
              end as scope_priority,
              link.priority
       from hotels hotel
       join hotel_suppliers link
         on link.tenant_id = hotel.tenant_id and link.hotel_id = hotel.id
        and link.is_active and link.ended_at is null
       join commercial_suppliers supplier
         on supplier.tenant_id = link.tenant_id and supplier.id = link.supplier_id
        and supplier.status = 'active' and supplier.deleted_at is null
        and supplier.service_types @> array['hotel']::text[]
       join hotel_room_types room
         on room.tenant_id = hotel.tenant_id and room.hotel_id = hotel.id
        and room.is_active and room.deleted_at is null
        and room.occupancy_type = $7
       join hotel_supplier_rates rate
         on rate.tenant_id = link.tenant_id
        and rate.hotel_id = hotel.id
        and rate.hotel_supplier_id = link.id
        and rate.room_type_id = room.id
        and rate.is_active and not rate.is_suspended
        and rate.currency = 'BRL'
        and (
          (rate.valid_from <= $3::date and rate.valid_until >= ($4::date - 1))
          or link.out_of_period_policy in ('warn', 'allow')
        )
       where hotel.tenant_id = $1 and hotel.city_id = $2::uuid
         and hotel.status = 'active' and hotel.deleted_at is null
         and ($9::text[] is null or hotel.id = any($9::text[]))
         and (link.valid_from is null or link.valid_from <= $3::date)
         and (link.valid_until is null or link.valid_until >= ($4::date - 1))
         and (
           rate.scope_type = 'global'
           or exists (
             select 1 from hotel_supplier_rate_scopes matching_scope
             where matching_scope.tenant_id = rate.tenant_id
               and matching_scope.rate_id = rate.id
               and matching_scope.deleted_at is null
               and (
                 (matching_scope.scope_type = 'company' and matching_scope.company_id = $5)
                 or (matching_scope.scope_type = 'group' and $6::text is not null
                     and matching_scope.business_group_id = $6)
               )
           )
         )
     )
     select distinct on (hotel_id, hotel_supplier_id) *
     from eligible_rates
     order by hotel_id, hotel_supplier_id, scope_priority desc, inside_validity desc, priority asc,
              (((nightly_amount + tax_amount) * greatest(($4::date - $3::date), 1) * $8::integer)
                + service_fee_amount) asc,
              rate_id
     limit 500`,
    [
      tenantId,
      context.cityId,
      context.checkIn,
      context.checkOut,
      context.companyId,
      context.groupId,
      context.occupancyType,
      roomCount,
      hotelIds,
    ],
  )

  const emittedSuggestions = await client.query<EmissionRateSuggestionRow>(
    `select distinct on (observation.hotel_id, observation.hotel_supplier_id)
            observation.id as observation_id,
            observation.emission_id,
            observation.issued_at,
            observation.hotel_id,
            observation.hotel_supplier_id,
            observation.supplier_id,
            coalesce(supplier.trade_name, supplier.legal_name) as supplier_name,
            supplier.internal_code::text as supplier_code,
            observation.room_type_id,
            observation.room_category,
            observation.catalog_rate_id,
            observation.catalog_rate_version,
            observation.nightly_amount,
            observation.nightly_tax_amount,
            0::numeric as service_fee_amount,
            observation.currency,
            observation.refundable,
            observation.meal_plan,
            observation.cancellation_policy,
            observation.payment_terms,
            link.priority
     from hotel_emission_rate_observations observation
     join travel_emissions emission
       on emission.tenant_id = observation.tenant_id
      and emission.id = observation.emission_id
      and emission.status in ('issued', 'partially_issued')
     join hotels hotel
       on hotel.tenant_id = observation.tenant_id
      and hotel.id = observation.hotel_id
      and hotel.status = 'active' and hotel.deleted_at is null
     join hotel_suppliers link
       on link.tenant_id = observation.tenant_id
      and link.hotel_id = observation.hotel_id
      and link.id = observation.hotel_supplier_id
      and link.supplier_id = observation.supplier_id
      and link.is_active and link.ended_at is null
     join commercial_suppliers supplier
       on supplier.tenant_id = observation.tenant_id
      and supplier.id = observation.supplier_id
      and supplier.status = 'active' and supplier.deleted_at is null
      and supplier.service_types @> array['hotel']::text[]
     where observation.tenant_id = $1
       and hotel.city_id = $2::uuid
       and observation.company_id = $3
       and ($6::text[] is null or observation.hotel_id = any($6::text[]))
       and observation.supplier_matches_quote
       and observation.currency = 'BRL'
       and observation.nightly_amount > 0
       and observation.issued_at >= now() - interval '180 days'
       and observation.issued_at <= now() + interval '1 day'
       and extract(month from observation.stay_start) = extract(month from $4::date)
       and case
         when lower(observation.occupancy_code::text) = 'couple' then 'double'
         else lower(observation.occupancy_code::text)
       end = $5
     order by observation.hotel_id, observation.hotel_supplier_id,
              observation.issued_at desc, observation.created_at desc,
              observation.id desc
     limit 500`,
    [
      tenantId,
      context.cityId,
      context.companyId,
      context.checkIn,
      context.occupancyType,
      hotelIds,
    ],
  )
  const catalogItems = suggestions.rows.map(mapSuggestion)
  const catalogOffers = new Set(catalogItems.map(suggestionOfferKey))
  const emittedItems = emittedSuggestions.rows
    .map(mapEmissionSuggestion)
    .filter((suggestion) => !catalogOffers.has(suggestionOfferKey(suggestion)))
  return [...catalogItems, ...emittedItems]
}

function mapSuggestion(row: RateSuggestionRow): HotelRateSelectionCandidate {
  return {
    hotelId: row.hotel_id,
    hotelSupplierId: row.hotel_supplier_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierCode: row.supplier_code,
    roomTypeId: row.room_type_id,
    roomCategory: row.room_category,
    source: 'catalog',
    rateId: row.rate_id,
    rateVersion: Number(row.rate_version),
    emissionObservationId: null,
    emissionId: null,
    observedAt: null,
    nightlyRate: Number(row.nightly_amount),
    nightlyTaxes: Number(row.tax_amount),
    serviceFee: Number(row.service_fee_amount),
    currency: row.currency,
    refundable: row.refundable === true,
    mealPlan: row.meal_plan,
    cancellationPolicy: row.cancellation_policy,
    paymentTerms: row.payment_terms,
    scope: row.effective_scope,
    scopeLabel: row.scope_label,
    outsideValidity: !row.inside_validity,
    outOfPeriodPolicy: row.out_of_period_policy,
    isNet: row.is_net,
    supplierPriority: Number(row.priority),
  }
}

function mapEmissionSuggestion(row: EmissionRateSuggestionRow): HotelRateSelectionCandidate {
  return {
    hotelId: row.hotel_id,
    hotelSupplierId: row.hotel_supplier_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierCode: row.supplier_code,
    roomTypeId: row.room_type_id,
    roomCategory: row.room_category,
    source: 'last_emission',
    rateId: null,
    rateVersion: null,
    emissionObservationId: row.observation_id,
    emissionId: row.emission_id,
    observedAt: requiredIso(row.issued_at),
    nightlyRate: Number(row.nightly_amount),
    nightlyTaxes: Number(row.nightly_tax_amount),
    serviceFee: Number(row.service_fee_amount),
    currency: row.currency,
    refundable: row.refundable === true,
    mealPlan: row.meal_plan,
    cancellationPolicy: row.cancellation_policy,
    paymentTerms: row.payment_terms,
    scope: 'company',
    scopeLabel: 'Ultima emissao valida da empresa',
    outsideValidity: false,
    outOfPeriodPolicy: 'block',
    isNet: false,
    supplierPriority: Number(row.priority),
  }
}

function withoutInternalRateClassification(
  candidate: HotelRateSelectionCandidate,
): HotelRateSuggestion {
  const { isNet: _isNet, supplierPriority: _supplierPriority, ...suggestion } = candidate
  return suggestion
}

function suggestionOfferKey(
  suggestion: Pick<HotelRateSuggestion, 'hotelId' | 'hotelSupplierId'>,
): string {
  return `${suggestion.hotelId}:${suggestion.hotelSupplierId}`
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function requiredIso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new TravelGovernanceError(
      'HOTEL_RATE_OBSERVATION_DATE_INVALID',
      'Uma observacao de tarifa emitida possui data invalida.',
      500,
    )
  }
  return parsed.toISOString()
}

function normalizeService(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

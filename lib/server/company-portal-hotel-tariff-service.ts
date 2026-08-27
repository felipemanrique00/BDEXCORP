import 'server-only'

import type { QueryResultRow } from 'pg'

import {
  companyPortalHotelTariffSearchQuerySchema,
  companyPortalHotelTariffReferenceSnapshotSchema,
  type CompanyPortalHotelTariff,
  type CompanyPortalHotelTariffPriceStatus,
  type CompanyPortalHotelTariffReferenceSnapshot,
  type CompanyPortalHotelTariffSearchItem,
  type CompanyPortalHotelTariffSearchResult,
  type CompanyPortalHotelTariffOccupancyType,
  type CompanyPortalHotelTariffImage,
} from '@/lib/company-portal-lab/hotel-tariff-search'
import { hotelDemandDetailsSchema, type HotelDemandDetailsInput } from '@/lib/hotel-demand/model'
import { hotelDemandPreferredHotelIds } from '@/lib/hotel-demand/preferences'
import { requireCompanyAccessWithAnyPermission } from '@/lib/server/corporate-access-service'
import { resolveCompanyPortalScopeCompanyIdsWithAnyPermission } from '@/lib/server/company-portal-scope-service'
import type { CompanyPortalScope } from '@/lib/server/company-portal-scope-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  listHotelRateSelectionCandidates,
  type HotelRateSelectionCandidate,
} from '@/lib/server/hotel-rate-suggestion-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { TravelGovernanceError } from '@/lib/server/travel-governance-service'

interface CompanyContextRow extends QueryResultRow {
  id: string
  group_id: string | null
}

interface SafeHotelRow extends QueryResultRow {
  hotel_id: string
  name: string
  category: string | null
  star_rating: string | number | null
  address: string | null
  city: string
  amenities: unknown
  media: unknown
}

interface SafeHotelMedia {
  id: string
  altText: string | null
  roomTypeId: string | null
  roomCategory: string | null
}

interface SafeHotelPresentation {
  hotelId: string
  name: string
  category: string | null
  starRating: number | null
  address: string | null
  city: string
  companyId?: string
  scopeType?: 'company' | 'group'
  scopeId?: string
  amenities?: string[]
  media?: SafeHotelMedia[]
}

interface CompanyPortalHotelTariffSearchOptions {
  hotelIds?: readonly string[]
}

export const COMPANY_PORTAL_HOTEL_TARIFF_DISCLAIMER =
  'Tarifa offline de referencia apresentada no envio; disponibilidade, condicoes e preco final dependem de confirmacao da agencia.'

export async function listCompanyPortalHotelTariffs(
  principal: RequestPrincipal,
  rawQuery: unknown,
  options: CompanyPortalHotelTariffSearchOptions = {},
): Promise<CompanyPortalHotelTariffSearchResult> {
  const query = companyPortalHotelTariffSearchQuerySchema.parse(rawQuery)
  resolveCompanyPortalScopeCompanyIdsWithAnyPermission(
    principal,
    {
      scopeType: query.scopeType,
      scopeId: query.scopeId,
      companyId: query.companyId,
    },
    ['ver_demandas', 'criar_demandas'],
  )
  await requireCompanyAccessWithAnyPermission(
    principal,
    query.companyId,
    ['ver_demandas', 'criar_demandas'],
  )
  const restrictedHotelIds = options.hotelIds?.length
    ? Array.from(new Set(options.hotelIds.map((id) => String(id).trim()).filter(Boolean)))
    : null

  return withTenantTransaction(principal.tenantId, async (client) => {
    const companyResult = await client.query<CompanyContextRow>(
      `select id, group_id
       from companies
       where tenant_id = $1 and id = $2 and status = 'active' and deleted_at is null`,
      [principal.tenantId, query.companyId],
    )
    const company = companyResult.rows[0]
    if (!company) {
      throw new TravelGovernanceError(
        'COMPANY_PORTAL_HOTEL_TARIFF_COMPANY_NOT_FOUND',
        'Empresa ativa nao encontrada para consultar o tarifario.',
        404,
      )
    }

    const hasRateContext = Boolean(query.checkIn && query.checkOut && query.occupancyType)
    const normalizedSearch = query.q ? escapeLike(normalizeSearch(query.q)) : null
    const catalogResult = await client.query<SafeHotelRow>(
      `select hotel.id as hotel_id,
              hotel.name,
              hotel.category,
              hotel.star_rating,
              coalesce(address.formatted_address, hotel.address) as address,
              city.name as city,
              hotel.amenities,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', gallery.id,
                  'altText', gallery.alt_text,
                  'roomTypeId', gallery.room_type_id,
                  'roomCategory', gallery.room_category
                ) order by gallery.scope_order, gallery.sort_order, gallery.created_at, gallery.id)
                from (
                  select media.id, media.alt_text, media.room_type_id,
                         room.name as room_category,
                         case when media.room_type_id is null then 0 else 1 end as scope_order,
                         media.sort_order, media.created_at
                    from hotel_catalog_media media
                    join stored_files file
                      on file.tenant_id = media.tenant_id and file.id = media.file_id
                     and file.status = 'active' and file.mime_type = 'image/webp'
                    left join hotel_room_types room
                      on room.tenant_id = media.tenant_id
                     and room.hotel_id = media.hotel_id
                     and room.id = media.room_type_id
                     and room.is_active and room.deleted_at is null
                   where media.tenant_id = hotel.tenant_id
                     and media.hotel_id = hotel.id
                     and media.deleted_at is null
                     and (
                       media.room_type_id is null
                       or ($3::text is not null and room.occupancy_type = $3)
                     )
                   order by scope_order, media.sort_order, media.created_at, media.id
                ) gallery
              ), '[]'::jsonb) as media
       from hotels hotel
       join geo_cities city
         on city.id = hotel.city_id and city.is_active
       left join postal_addresses address
         on address.tenant_id = hotel.tenant_id
        and address.id = hotel.address_id
        and address.deleted_at is null
       where hotel.tenant_id = $1
         and hotel.city_id = $2::uuid
         and hotel.status = 'active'
         and hotel.deleted_at is null
         and ($6::text[] is null or hotel.id = any($6::text[]))
         and exists (
           select 1
           from hotel_suppliers quotable_link
           join commercial_suppliers quotable_supplier
             on quotable_supplier.tenant_id = quotable_link.tenant_id
            and quotable_supplier.id = quotable_link.supplier_id
            and quotable_supplier.status = 'active'
            and quotable_supplier.deleted_at is null
            and quotable_supplier.service_types @> array['hotel']::text[]
           where quotable_link.tenant_id = hotel.tenant_id
             and quotable_link.hotel_id = hotel.id
             and quotable_link.is_active
             and quotable_link.ended_at is null
         )
         and exists (
           select 1
           from hotel_room_types quotable_room
           where quotable_room.tenant_id = hotel.tenant_id
             and quotable_room.hotel_id = hotel.id
             and quotable_room.is_active
             and quotable_room.deleted_at is null
             and ($3::text is null or quotable_room.occupancy_type = $3)
         )
         and (
           $4::text is null
           or hotel.normalized_name like ('%' || $4 || '%') escape '\\'
           or lower(coalesce(hotel.category, '')) like ('%' || $4 || '%') escape '\\'
           or lower(coalesce(address.formatted_address, hotel.address, '')) like ('%' || $4 || '%') escape '\\'
         )
       order by hotel.normalized_name, hotel.id
       limit $5`,
      [
        principal.tenantId,
        query.cityId,
        hasRateContext ? query.occupancyType : null,
        normalizedSearch,
        query.limit,
        restrictedHotelIds,
      ],
    )

    const hotels = catalogResult.rows.map((row) => mapSafeHotel(
      row,
      company.id,
      query.scopeType,
      query.scopeId,
    ))
    const candidates = hasRateContext && hotels.length
      ? await listHotelRateSelectionCandidates(client, principal.tenantId, {
        companyId: company.id,
        groupId: company.group_id,
        cityId: query.cityId,
        checkIn: query.checkIn!,
        checkOut: query.checkOut!,
        occupancyType: query.occupancyType!,
        roomCount: query.roomCount,
        hotelIds: hotels.map((hotel) => hotel.hotelId),
      })
      : []
    const candidatesByHotel = groupCandidatesByHotel(candidates, new Set(hotels.map((hotel) => hotel.hotelId)))
    const nights = hasRateContext ? differenceInNights(query.checkIn!, query.checkOut!) : 0

    return {
      companyId: company.id,
      cityId: query.cityId,
      checkIn: query.checkIn || null,
      checkOut: query.checkOut || null,
      occupancyType: query.occupancyType || null,
      roomCount: query.roomCount,
      items: hotels.map((hotel) => projectSafeHotel(
        hotel,
        candidatesByHotel.get(hotel.hotelId) || [],
        nights,
        query.roomCount,
        hasRateContext,
      )),
    }
  })
}

export async function attachCompanyPortalHotelTariffReference(
  principal: RequestPrincipal,
  companyId: string,
  rawDetails: unknown,
  scope: CompanyPortalScope = {},
): Promise<HotelDemandDetailsInput> {
  const details = hotelDemandDetailsSchema.parse(rawDetails)
  const preferredHotelIds = hotelDemandPreferredHotelIds(details)
  const preferences = { ...(details.preferences || {}) }
  delete preferences.hotelTariffReference
  if (!preferredHotelIds.length) return { ...details, preferences }

  const occupancyTypes = Array.from(new Set(details.rooms.map((room) => normalizeOccupancy(room.occupancy_code))))
  const occupancyType = occupancyTypes.length === 1 ? occupancyTypes[0] : null
  const result = await listCompanyPortalHotelTariffs(principal, {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    companyId,
    cityId: details.city_id,
    ...(occupancyType ? {
      checkIn: details.data_checkin,
      checkOut: details.data_checkout,
      occupancyType,
      roomCount: details.rooms.length,
    } : {}),
    limit: preferredHotelIds.length,
  }, { hotelIds: preferredHotelIds })
  const byId = new Map(result.items.map((item) => [item.hotelId, item]))
  if (preferredHotelIds.some((hotelId) => !byId.has(hotelId))) {
    throw new TravelGovernanceError(
      'COMPANY_PORTAL_HOTEL_PREFERENCE_INVALID',
      'Um hotel preferencial nao pertence mais ao destino ou a ocupacao informada. Atualize a busca no tarifario.',
      422,
    )
  }
  const snapshot: CompanyPortalHotelTariffReferenceSnapshot = companyPortalHotelTariffReferenceSnapshotSchema.parse({
    capturedAt: new Date().toISOString(),
    cityId: details.city_id,
    checkIn: details.data_checkin,
    checkOut: details.data_checkout,
    occupancyType,
    roomCount: details.rooms.length,
    items: preferredHotelIds.flatMap((id) => {
      const item = byId.get(id)
      if (!item) return []
      return {
        hotelId: item.hotelId,
        name: item.name,
        priceStatus: item.priceStatus,
        tariff: item.tariff,
      }
    }),
    disclaimer: COMPANY_PORTAL_HOTEL_TARIFF_DISCLAIMER,
  })
  return {
    ...details,
    preferences: { ...preferences, hotelTariffReference: snapshot },
  }
}

export function projectCompanyPortalHotelTariffItem(
  hotel: SafeHotelPresentation,
  candidates: readonly HotelRateSelectionCandidate[],
  nights: number,
  roomCount = 1,
  hasRateContext = true,
): CompanyPortalHotelTariffSearchItem {
  return projectSafeHotel(hotel, candidates, nights, roomCount, hasRateContext)
}

function mapSafeHotel(
  row: SafeHotelRow,
  companyId: string,
  scopeType?: 'company' | 'group',
  scopeId?: string,
): SafeHotelPresentation {
  return {
    hotelId: row.hotel_id,
    name: row.name,
    category: row.category,
    starRating: row.star_rating == null ? null : Number(row.star_rating),
    address: row.address,
    city: row.city,
    companyId,
    scopeType,
    scopeId,
    amenities: publicAmenities(row.amenities),
    media: safeMedia(row.media),
  }
}

function groupCandidatesByHotel(
  candidates: readonly HotelRateSelectionCandidate[],
  allowedHotelIds: ReadonlySet<string>,
): Map<string, HotelRateSelectionCandidate[]> {
  const grouped = new Map<string, HotelRateSelectionCandidate[]>()
  for (const candidate of candidates) {
    if (!allowedHotelIds.has(candidate.hotelId)) continue
    const hotelCandidates = grouped.get(candidate.hotelId) || []
    hotelCandidates.push(candidate)
    grouped.set(candidate.hotelId, hotelCandidates)
  }
  return grouped
}

function projectSafeHotel(
  hotel: SafeHotelPresentation,
  candidates: readonly HotelRateSelectionCandidate[],
  nights: number,
  roomCount: number,
  hasRateContext: boolean,
): CompanyPortalHotelTariffSearchItem {
  if (!hasRateContext) return publicHotel(hotel, 'not_available', null, null)

  const catalog = candidates
    .filter((candidate) => candidate.source === 'catalog')
    .sort((left, right) => compareCatalogCandidates(left, right, nights, roomCount))[0]
  if (catalog) {
    if (catalog.isNet) return publicHotel(hotel, 'under_review', null, catalog.roomTypeId)
    return publicHotel(hotel, 'available', publicTariff(catalog, nights, roomCount), catalog.roomTypeId)
  }

  const lastEmission = candidates
    .filter((candidate) => candidate.source === 'last_emission')
    .sort(compareEmissionCandidates)[0]
  if (lastEmission) {
    return publicHotel(hotel, 'available', publicTariff(lastEmission, nights, roomCount), lastEmission.roomTypeId)
  }
  return publicHotel(hotel, 'not_available', null, null)
}

function publicHotel(
  hotel: SafeHotelPresentation,
  priceStatus: CompanyPortalHotelTariffPriceStatus,
  tariff: CompanyPortalHotelTariff | null,
  selectedRoomTypeId: string | null,
): CompanyPortalHotelTariffSearchItem {
  return {
    hotelId: hotel.hotelId,
    name: hotel.name,
    category: hotel.category,
    starRating: hotel.starRating,
    address: hotel.address,
    city: hotel.city,
    amenities: hotel.amenities || [],
    images: publicImages(
      hotel.media || [],
      selectedRoomTypeId,
      hotel.companyId || '',
      hotel.scopeType,
      hotel.scopeId,
    ),
    priceStatus,
    tariff,
  }
}

const PUBLIC_AMENITIES: ReadonlyArray<{ keys: readonly string[]; label: string }> = [
  { keys: ['breakfast', 'cafe_da_manha', 'cafeDaManha'], label: 'Cafe da manha' },
  { keys: ['wifi', 'wi_fi'], label: 'Wi-Fi' },
  { keys: ['parking', 'estacionamento'], label: 'Estacionamento' },
  { keys: ['pool', 'piscina'], label: 'Piscina' },
  { keys: ['gym', 'academia'], label: 'Academia' },
  { keys: ['accessibility', 'acessibilidade'], label: 'Acessibilidade' },
  { keys: ['air_conditioning', 'airConditioning', 'ar_condicionado'], label: 'Ar-condicionado' },
]

function publicAmenities(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  return PUBLIC_AMENITIES.flatMap(({ keys, label }) => (
    keys.some((key) => record[key] === true) ? [label] : []
  ))
}

function safeMedia(value: unknown): SafeHotelMedia[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return []
    return [{
      id,
      altText: typeof item.altText === 'string' ? item.altText : null,
      roomTypeId: typeof item.roomTypeId === 'string' ? item.roomTypeId : null,
      roomCategory: typeof item.roomCategory === 'string' ? item.roomCategory : null,
    }]
  })
}

function publicImages(
  media: readonly SafeHotelMedia[],
  selectedRoomTypeId: string | null,
  companyId: string,
  scopeType?: 'company' | 'group',
  scopeId?: string,
): CompanyPortalHotelTariffImage[] {
  if (!companyId) return []
  const query = new URLSearchParams({ companyId })
  if (scopeType) query.set('scopeType', scopeType)
  if (scopeId) query.set('scopeId', scopeId)
  return [...media]
    .filter((item) => (
      item.roomTypeId === null
      || (selectedRoomTypeId !== null && item.roomTypeId === selectedRoomTypeId)
    ))
    .sort((left, right) => {
      const leftRank = left.roomTypeId === selectedRoomTypeId ? 0 : 1
      const rightRank = right.roomTypeId === selectedRoomTypeId ? 0 : 1
      return leftRank - rightRank
    })
    .slice(0, 12)
    .map((item) => ({
      imageUrl: `/api/company-portal/hotel-media/${encodeURIComponent(item.id)}?${query}`,
      altText: item.altText,
      scope: item.roomTypeId ? 'room' : 'hotel',
      roomCategory: item.roomCategory,
    }))
}

function publicTariff(
  candidate: HotelRateSelectionCandidate,
  nights: number,
  roomCount: number,
): CompanyPortalHotelTariff {
  const nightlyRate = money(candidate.nightlyRate)
  const nightlyTaxes = money(candidate.nightlyTaxes)
  const serviceFee = money(candidate.serviceFee)
  return {
    source: candidate.source,
    label: candidate.scopeLabel,
    roomCategory: candidate.roomCategory,
    nightlyRate,
    nightlyTaxes,
    serviceFee,
    currency: candidate.currency,
    mealPlan: candidate.mealPlan,
    refundable: candidate.refundable,
    cancellationPolicy: candidate.cancellationPolicy,
    outsideValidity: candidate.outsideValidity,
    estimatedTotal: money((nightlyRate + nightlyTaxes) * nights * roomCount + serviceFee),
    nights,
    roomCount,
  }
}

function compareCatalogCandidates(
  left: HotelRateSelectionCandidate,
  right: HotelRateSelectionCandidate,
  nights: number,
  roomCount: number,
): number {
  const scopeDifference = scopeRank(right.scope) - scopeRank(left.scope)
  if (scopeDifference) return scopeDifference
  if (left.outsideValidity !== right.outsideValidity) return left.outsideValidity ? 1 : -1
  if (left.supplierPriority !== right.supplierPriority) {
    return left.supplierPriority - right.supplierPriority
  }
  return candidateTotal(left, nights, roomCount) - candidateTotal(right, nights, roomCount)
    || String(left.rateId || '').localeCompare(String(right.rateId || ''))
}

function compareEmissionCandidates(
  left: HotelRateSelectionCandidate,
  right: HotelRateSelectionCandidate,
): number {
  const observedDifference = Date.parse(right.observedAt || '') - Date.parse(left.observedAt || '')
  if (Number.isFinite(observedDifference) && observedDifference) return observedDifference
  return left.supplierPriority - right.supplierPriority
}

function scopeRank(scope: HotelRateSelectionCandidate['scope']): number {
  if (scope === 'company') return 3
  if (scope === 'group') return 2
  return 1
}

function candidateTotal(candidate: HotelRateSelectionCandidate, nights: number, roomCount: number): number {
  return (candidate.nightlyRate + candidate.nightlyTaxes) * nights * roomCount + candidate.serviceFee
}

function differenceInNights(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000)
}

function money(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function normalizeOccupancy(value: string): CompanyPortalHotelTariffOccupancyType {
  if (value === 'couple') return 'double'
  if (['single', 'double', 'twin', 'triple', 'quadruple', 'family'].includes(value)) {
    return value as CompanyPortalHotelTariffOccupancyType
  }
  throw new TravelGovernanceError(
    'COMPANY_PORTAL_HOTEL_OCCUPANCY_INVALID',
    'A ocupacao informada nao pode ser consultada no tarifario.',
    422,
  )
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  createHotelCatalogSchema,
  hotelCatalogQuerySchema,
  updateHotelCatalogSchema,
  type CreateHotelCatalogInput,
} from '@/lib/hotel-catalog/schema'
import type {
  HotelCatalogItem,
  HotelCatalogRoomType,
  HotelCatalogSupplier,
} from '@/lib/hotel-catalog/types'
import { resolveCanonicalHotelRoomCategory } from '@/lib/hotel-catalog/room-categories'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import { normalizeName } from '@/lib/server/geography-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface HotelRow extends QueryResultRow {
  id: string
  legacy_numeric_id: string | number | null
  name: string
  normalized_name: string
  country_id: string | null
  country_code: string | null
  country_name: string | null
  country: string | null
  subdivision_id: string | null
  subdivision_code: string | null
  subdivision_name: string | null
  state: string | null
  city_id: string | null
  city_name: string | null
  city: string | null
  phone: string | null
  email: string | null
  address: string | null
  address_id: string | null
  website: string | null
  category: string | null
  chain_name: string | null
  brand_name: string | null
  star_rating: string | number | null
  billing_enabled: boolean
  billing_info: string | null
  amenities: Record<string, unknown> | null
  status: 'active' | 'inactive'
  source: string
  version: string | number
  suppliers: unknown
  room_types: unknown
  created_at: string | Date
  updated_at: string | Date
  total_count?: string | number
}

interface GeographyRow extends QueryResultRow {
  country_id: string
  country_code: string
  country_name: string
  subdivision_id: string
  subdivision_code: string
  subdivision_name: string
  city_id: string
  city_name: string
}

export class HotelCatalogServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'HotelCatalogServiceError'
  }
}

export async function listHotelCatalog(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<{ items: HotelCatalogItem[]; total: number }> {
  const query = hotelCatalogQuerySchema.parse(rawQuery)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId]
    const clauses = ['hotel.tenant_id = $1', 'hotel.deleted_at is null']
    if (!query.includeInactive && !query.status) clauses.push(`hotel.status = 'active'`)
    for (const [column, value] of [
      ['hotel.country_id', query.countryId],
      ['hotel.subdivision_id', query.subdivisionId],
      ['hotel.city_id', query.cityId],
    ] as Array<[string, string | undefined]>) {
      if (!value) continue
      values.push(value)
      clauses.push(`${column} = $${values.length}::uuid`)
    }
    if (query.status) {
      values.push(query.status)
      clauses.push(`hotel.status = $${values.length}`)
    }
    if (query.supplierId) {
      values.push(query.supplierId)
      clauses.push(`exists (
        select 1 from hotel_suppliers link
        where link.tenant_id = hotel.tenant_id and link.hotel_id = hotel.id
          and link.supplier_id = $${values.length}::uuid and link.is_active
      )`)
    }
    if (query.quotable) {
      clauses.push(`hotel.status = 'active'`)
      clauses.push(`exists (
        select 1
        from hotel_suppliers quote_link
        join commercial_suppliers quote_supplier
          on quote_supplier.tenant_id = quote_link.tenant_id
         and quote_supplier.id = quote_link.supplier_id
        where quote_link.tenant_id = hotel.tenant_id
          and quote_link.hotel_id = hotel.id
          and quote_link.is_active
          and quote_link.ended_at is null
          and quote_supplier.status = 'active'
          and quote_supplier.deleted_at is null
          and quote_supplier.service_types @> array['hotel']::text[]
      )`)
      clauses.push(`exists (
        select 1 from hotel_room_types quotable_room
        where quotable_room.tenant_id = hotel.tenant_id
          and quotable_room.hotel_id = hotel.id
          and quotable_room.is_active
          and quotable_room.deleted_at is null
      )`)
    }
    if (query.q) {
      values.push(`%${normalizeName(query.q)}%`)
      clauses.push(`(
        hotel.normalized_name like $${values.length}
        or lower(coalesce(hotel.chain_name, '')) like $${values.length}
        or lower(coalesce(hotel.brand_name, '')) like $${values.length}
        or city.normalized_name like $${values.length}
        or lower(coalesce(hotel.address, '')) like $${values.length}
      )`)
    }
    values.push(query.limit, query.offset)
    const result = await client.query<HotelRow>(
      `${hotelSelect()}
       where ${clauses.join(' and ')}
       order by hotel.normalized_name
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: result.rows.map(mapHotel),
      total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    }
  })
}

export async function getHotelCatalog(
  principal: RequestPrincipal,
  id: string,
): Promise<HotelCatalogItem> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const row = await loadHotel(client, principal.tenantId, id)
    if (!row) throw notFound()
    return mapHotel(row)
  })
}

export async function createHotelCatalog(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<HotelCatalogItem> {
  const input = createHotelCatalogSchema.parse(rawInput)
  let item: HotelCatalogItem
  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      const geography = await requireGeography(client, input.countryId, input.subdivisionId, input.cityId)
      await requireSuppliers(client, principal.tenantId, input.supplierIds)
      const addressId = input.address
        ? await createAddress(client, principal, input, geography)
        : null
      const id = `hotel_${randomUUID()}`
      await client.query(
        `insert into hotels (
           id, tenant_id, name, normalized_name, legacy_numeric_id,
           city, state, country, country_id, subdivision_id, city_id,
           phone, email, address, address_id, website, category,
           chain_name, brand_name, star_rating,
           billing_enabled, billing_info, amenities, status, source,
           created_by, updated_by
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17, $18, $19, $20,
           $21, $22, $23::jsonb, $24, 'manual', $25, $25
         )`,
        [
          id,
          principal.tenantId,
          input.name,
          normalizeName(input.name),
          input.legacyNumericId || null,
          geography.city_name,
          geography.subdivision_code,
          geography.country_code,
          geography.country_id,
          geography.subdivision_id,
          geography.city_id,
          input.phone || null,
          input.email || null,
          input.address || null,
          addressId,
          input.website || null,
          input.category || null,
          input.chainName || null,
          input.brandName || null,
          input.starRating ?? null,
          input.billingEnabled,
          input.billingInfo || null,
          JSON.stringify(input.amenities),
          input.status,
          principal.user.id,
        ],
      )
      await replaceHotelSuppliers(client, principal, id, input.supplierIds)
      await replaceRoomTypes(client, principal, id, input.roomTypes)
      const row = await loadHotel(client, principal.tenantId, id)
      if (!row) throw new HotelCatalogServiceError('HOTEL_CREATE_FAILED', 'Nao foi possivel carregar o hotel criado.', 500)
      return mapHotel(row)
    })
  } catch (error) {
    throw translateDatabaseError(error)
  }
  await writeAuditEvent({
    action: 'hotel.catalog.created',
    result: 'success',
    entityType: 'hotel',
    entityId: item.id,
    metadata: { cityId: item.cityId, supplierCount: item.suppliers.length },
  })
  return item
}

export async function updateHotelCatalog(
  principal: RequestPrincipal,
  id: string,
  rawInput: unknown,
): Promise<HotelCatalogItem> {
  const input = updateHotelCatalogSchema.parse(rawInput)
  let item: HotelCatalogItem
  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      const current = await loadHotel(client, principal.tenantId, id, true)
      if (!current) throw notFound()
      if (Number(current.version) !== input.expectedVersion) {
        throw stale(Number(current.version))
      }
      const merged = createHotelCatalogSchema.parse({
        name: input.name ?? current.name,
        countryId: input.countryId ?? current.country_id,
        subdivisionId: input.subdivisionId ?? current.subdivision_id,
        cityId: input.cityId ?? current.city_id,
        legacyNumericId: input.legacyNumericId === undefined
          ? (current.legacy_numeric_id ? Number(current.legacy_numeric_id) : undefined)
          : input.legacyNumericId,
        phone: input.phone === undefined ? current.phone ?? undefined : input.phone,
        email: input.email === undefined ? current.email ?? undefined : input.email,
        address: input.address === undefined ? current.address ?? undefined : input.address,
        website: input.website === undefined ? current.website ?? undefined : input.website,
        category: input.category === undefined ? current.category ?? undefined : input.category,
        chainName: input.chainName === undefined ? current.chain_name ?? undefined : input.chainName,
        brandName: input.brandName === undefined ? current.brand_name ?? undefined : input.brandName,
        starRating: input.starRating === undefined
          ? (current.star_rating == null ? undefined : Number(current.star_rating))
          : input.starRating,
        billingEnabled: input.billingEnabled ?? current.billing_enabled,
        billingInfo: input.billingInfo === undefined ? current.billing_info ?? undefined : input.billingInfo,
        amenities: input.amenities ?? current.amenities ?? {},
        status: input.status ?? current.status,
        supplierIds: input.supplierIds ?? mapSuppliers(current.suppliers).map((row) => row.supplierId),
        roomTypes: input.roomTypes ?? roomTypeInputs(current.room_types),
      })
      const geography = await requireGeography(client, merged.countryId, merged.subdivisionId, merged.cityId)
      await requireSuppliers(client, principal.tenantId, merged.supplierIds)
      const addressId = await upsertAddress(client, principal, current.address_id, merged, geography)
      const updated = await client.query(
        `update hotels set
           name = $4, normalized_name = $5, legacy_numeric_id = $6,
           city = $7, state = $8, country = $9, country_id = $10,
           subdivision_id = $11, city_id = $12, phone = $13, email = $14,
           address = $15, address_id = $16, website = $17, category = $18,
           chain_name = $19, brand_name = $20, star_rating = $21,
           billing_enabled = $22, billing_info = $23, amenities = $24::jsonb,
           status = $25, version = version + 1, updated_by = $26, updated_at = now()
         where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null`,
        [
          principal.tenantId,
          id,
          input.expectedVersion,
          merged.name,
          normalizeName(merged.name),
          merged.legacyNumericId || null,
          geography.city_name,
          geography.subdivision_code,
          geography.country_code,
          geography.country_id,
          geography.subdivision_id,
          geography.city_id,
          merged.phone || null,
          merged.email || null,
          merged.address || null,
          addressId,
          merged.website || null,
          merged.category || null,
          merged.chainName || null,
          merged.brandName || null,
          merged.starRating ?? null,
          merged.billingEnabled,
          merged.billingInfo || null,
          JSON.stringify(merged.amenities),
          merged.status,
          principal.user.id,
        ],
      )
      if (!updated.rowCount) throw stale(Number(current.version))
      if (input.supplierIds) await replaceHotelSuppliers(client, principal, id, merged.supplierIds)
      if (input.roomTypes) await replaceRoomTypes(client, principal, id, merged.roomTypes)
      const row = await loadHotel(client, principal.tenantId, id)
      if (!row) throw notFound()
      return mapHotel(row)
    })
  } catch (error) {
    throw translateDatabaseError(error)
  }
  await writeAuditEvent({
    action: 'hotel.catalog.updated',
    result: 'success',
    entityType: 'hotel',
    entityId: item.id,
    metadata: { version: item.version, status: item.status },
  })
  return item
}

function hotelSelect(): string {
  return `select hotel.*,
          country.iso_alpha2::text as country_code,
          country.name as country_name,
          subdivision.code::text as subdivision_code,
          subdivision.name as subdivision_name,
          city.name as city_name,
          count(*) over() as total_count,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', link.id,
              'supplierId', supplier.id,
              'supplierName', coalesce(supplier.trade_name, supplier.legal_name),
              'supplierCode', supplier.internal_code::text,
              'propertyCode', link.supplier_property_code,
              'priority', link.priority,
              'billingEnabled', link.billing_enabled,
              'isActive', link.is_active,
              'validFrom', link.valid_from,
              'validUntil', link.valid_until
            ) order by link.priority, coalesce(supplier.trade_name, supplier.legal_name))
            from hotel_suppliers link
            join commercial_suppliers supplier
              on supplier.tenant_id = link.tenant_id and supplier.id = link.supplier_id
            where link.tenant_id = hotel.tenant_id and link.hotel_id = hotel.id
              and link.is_active and link.ended_at is null
              and supplier.status = 'active' and supplier.deleted_at is null
              and supplier.service_types @> array['hotel']::text[]
          ), '[]'::jsonb) as suppliers,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', room.id, 'code', room.code::text, 'name', room.name,
              'occupancyType', room.occupancy_type, 'maxGuests', room.max_guests,
              'maxAdults', room.max_adults, 'maxChildren', room.max_children,
              'bedConfiguration', room.bed_configuration, 'isActive', room.is_active
            ) order by room.code)
            from hotel_room_types room
            where room.tenant_id = hotel.tenant_id and room.hotel_id = hotel.id
              and room.is_active and room.deleted_at is null
          ), '[]'::jsonb) as room_types
   from hotels hotel
   left join geo_countries country on country.id = hotel.country_id
   left join geo_subdivisions subdivision on subdivision.id = hotel.subdivision_id
   left join geo_cities city on city.id = hotel.city_id`
}

async function loadHotel(
  client: PoolClient,
  tenantId: string,
  id: string,
  forUpdate = false,
): Promise<HotelRow | null> {
  const result = await client.query<HotelRow>(
    `${hotelSelect()}
     where hotel.tenant_id = $1 and hotel.id = $2 and hotel.deleted_at is null
     ${forUpdate ? 'for update of hotel' : ''}`,
    [tenantId, id],
  )
  return result.rows[0] || null
}

async function requireGeography(
  client: PoolClient,
  countryId: string,
  subdivisionId: string,
  cityId: string,
): Promise<GeographyRow> {
  const result = await client.query<GeographyRow>(
    `select country.id as country_id, country.iso_alpha2::text as country_code,
            country.name as country_name, subdivision.id as subdivision_id,
            subdivision.code::text as subdivision_code, subdivision.name as subdivision_name,
            city.id as city_id, city.name as city_name
     from geo_countries country
     join geo_subdivisions subdivision on subdivision.country_id = country.id and subdivision.id = $2
     join geo_cities city on city.country_id = country.id
       and city.subdivision_id = subdivision.id and city.id = $3
     where country.id = $1 and country.is_active and subdivision.is_active and city.is_active`,
    [countryId, subdivisionId, cityId],
  )
  if (!result.rows[0]) {
    throw new HotelCatalogServiceError(
      'HOTEL_GEOGRAPHY_INVALID',
      'Pais, estado ou cidade nao formam uma localizacao valida e ativa.',
      422,
    )
  }
  return result.rows[0]
}

async function requireSuppliers(client: PoolClient, tenantId: string, supplierIds: string[]): Promise<void> {
  if (!supplierIds.length) return
  const uniqueIds = Array.from(new Set(supplierIds))
  const result = await client.query<{ id: string }>(
    `select id from commercial_suppliers
     where tenant_id = $1 and id = any($2::uuid[]) and status = 'active'
       and service_types @> array['hotel']::text[] and deleted_at is null`,
    [tenantId, uniqueIds],
  )
  if (result.rows.length !== uniqueIds.length) {
    throw new HotelCatalogServiceError('HOTEL_SUPPLIER_INVALID', 'Ha fornecedor inativo ou fora do tenant.', 422)
  }
}

async function createAddress(
  client: PoolClient,
  principal: RequestPrincipal,
  input: Pick<CreateHotelCatalogInput, 'address'>,
  geography: GeographyRow,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into postal_addresses (
       tenant_id, country_id, subdivision_id, city_id, formatted_address,
       created_by, updated_by
     ) values ($1, $2, $3, $4, $5, $6, $6) returning id`,
    [
      principal.tenantId,
      geography.country_id,
      geography.subdivision_id,
      geography.city_id,
      input.address || null,
      principal.user.id,
    ],
  )
  return result.rows[0].id
}

async function upsertAddress(
  client: PoolClient,
  principal: RequestPrincipal,
  addressId: string | null,
  input: CreateHotelCatalogInput,
  geography: GeographyRow,
): Promise<string | null> {
  if (!input.address) {
    if (addressId) {
      await client.query(
        `update postal_addresses set deleted_at = coalesce(deleted_at, now()),
           version = version + 1, updated_by = $3, updated_at = now()
         where tenant_id = $1 and id = $2 and deleted_at is null`,
        [principal.tenantId, addressId, principal.user.id],
      )
    }
    return null
  }
  if (!addressId) return createAddress(client, principal, input, geography)
  const updated = await client.query(
    `update postal_addresses set country_id = $3, subdivision_id = $4, city_id = $5,
       formatted_address = $6, version = version + 1, updated_by = $7, updated_at = now()
     where tenant_id = $1 and id = $2 and deleted_at is null`,
    [
      principal.tenantId,
      addressId,
      geography.country_id,
      geography.subdivision_id,
      geography.city_id,
      input.address,
      principal.user.id,
    ],
  )
  return updated.rowCount ? addressId : createAddress(client, principal, input, geography)
}

async function replaceHotelSuppliers(
  client: PoolClient,
  principal: RequestPrincipal,
  hotelId: string,
  supplierIds: string[],
): Promise<void> {
  const ids = Array.from(new Set(supplierIds))
  await client.query(
    `update hotel_suppliers set is_active = false, ended_at = now(), updated_by = $3, updated_at = now()
     where tenant_id = $1 and hotel_id = $2 and is_active
       and not (supplier_id = any($4::uuid[]))`,
    [principal.tenantId, hotelId, principal.user.id, ids],
  )
  for (let index = 0; index < ids.length; index += 1) {
    await client.query(
      `insert into hotel_suppliers (
         tenant_id, hotel_id, supplier_id, priority, is_active,
         created_by, updated_by
       ) values ($1, $2, $3, $4, true, $5, $5)
       on conflict (tenant_id, hotel_id, supplier_id) do update set
         priority = excluded.priority, is_active = true, ended_at = null,
         updated_by = excluded.updated_by, updated_at = now(), version = hotel_suppliers.version + 1`,
      [principal.tenantId, hotelId, ids[index], index + 1, principal.user.id],
    )
  }
}

async function replaceRoomTypes(
  client: PoolClient,
  principal: RequestPrincipal,
  hotelId: string,
  roomTypes: CreateHotelCatalogInput['roomTypes'],
): Promise<void> {
  const codes = roomTypes.map((room) => room.code)
  await client.query(
    `update hotel_room_types set is_active = false, deleted_at = now(),
       updated_by = $3, updated_at = now()
     where tenant_id = $1 and hotel_id = $2 and is_active
       and not (code::text = any($4::text[]))`,
    [principal.tenantId, hotelId, principal.user.id, codes],
  )
  for (const room of roomTypes) {
    await client.query(
      `insert into hotel_room_types (
         tenant_id, hotel_id, code, name, occupancy_type, max_guests,
         max_adults, max_children, bed_configuration, is_active,
         created_by, updated_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $10)
       on conflict (tenant_id, hotel_id, code) do update set
         name = excluded.name, occupancy_type = excluded.occupancy_type,
         max_guests = excluded.max_guests, max_adults = excluded.max_adults,
         max_children = excluded.max_children, bed_configuration = excluded.bed_configuration,
         is_active = true, deleted_at = null, version = hotel_room_types.version + 1,
         updated_by = excluded.updated_by, updated_at = now()`,
      [
        principal.tenantId,
        hotelId,
        room.code,
        room.name,
        room.occupancyType,
        room.maxGuests,
        room.maxAdults,
        room.maxChildren,
        room.bedConfiguration || null,
        principal.user.id,
      ],
    )
  }
}

function mapHotel(row: HotelRow): HotelCatalogItem {
  return {
    id: row.id,
    legacyNumericId: row.legacy_numeric_id == null ? null : Number(row.legacy_numeric_id),
    name: row.name,
    normalizedName: row.normalized_name,
    countryId: row.country_id,
    countryCode: (row.country_code || row.country || 'BR').toUpperCase(),
    countryName: row.country_name,
    subdivisionId: row.subdivision_id,
    subdivisionCode: row.subdivision_code || row.state,
    subdivisionName: row.subdivision_name,
    cityId: row.city_id,
    cityName: row.city_name || row.city || null,
    phone: row.phone,
    email: row.email,
    address: row.address,
    website: row.website,
    category: row.category,
    chainName: row.chain_name,
    brandName: row.brand_name,
    starRating: row.star_rating == null ? null : Number(row.star_rating),
    billingEnabled: row.billing_enabled,
    billingInfo: row.billing_info,
    amenities: row.amenities || {},
    status: row.status,
    source: row.source,
    version: Number(row.version),
    suppliers: mapSuppliers(row.suppliers),
    roomTypes: mapRoomTypes(row.room_types),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function mapSuppliers(value: unknown): HotelCatalogSupplier[] {
  if (!Array.isArray(value)) return []
  return value as HotelCatalogSupplier[]
}

function mapRoomTypes(value: unknown): HotelCatalogRoomType[] {
  if (!Array.isArray(value)) return []
  return (value as Array<Omit<HotelCatalogRoomType, 'canonicalCategory'>>).map((room) => ({
    ...room,
    canonicalCategory: resolveCanonicalHotelRoomCategory(room.name),
  }))
}

function roomTypeInputs(value: unknown): CreateHotelCatalogInput['roomTypes'] {
  return mapRoomTypes(value).map((room) => ({
    code: room.code,
    name: room.name,
    occupancyType: room.occupancyType,
    maxGuests: room.maxGuests,
    maxAdults: room.maxAdults,
    maxChildren: room.maxChildren,
    bedConfiguration: room.bedConfiguration || undefined,
  }))
}

function notFound(): HotelCatalogServiceError {
  return new HotelCatalogServiceError('HOTEL_NOT_FOUND', 'Hotel nao encontrado.', 404)
}

function stale(currentVersion: number): HotelCatalogServiceError {
  return new HotelCatalogServiceError(
    'STALE_HOTEL_VERSION',
    'O hotel foi alterado por outro usuario. Atualize a pagina.',
    409,
    { currentVersion },
  )
}

function translateDatabaseError(error: unknown): Error {
  if (error instanceof HotelCatalogServiceError) return error
  const code = databaseCode(error)
  if (code === '23505') {
    return new HotelCatalogServiceError('HOTEL_DUPLICATE', 'Ja existe hotel com o identificador informado.', 409)
  }
  if (code === '23503' || code === '23514') {
    return new HotelCatalogServiceError('HOTEL_REFERENCE_INVALID', 'O hotel possui dados relacionados invalidos.', 422)
  }
  return error instanceof Error ? error : new Error('Falha ao persistir hotel.')
}

function databaseCode(error: unknown): string | null {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? String((error as { code: string }).code)
    : null
}

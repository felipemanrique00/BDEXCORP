import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  commercialSupplierQuerySchema,
  createCommercialSupplierSchema,
  updateCommercialSupplierSchema,
  type CreateCommercialSupplierInput,
} from '@/lib/commercial-suppliers/schema'
import type {
  CommercialSupplier,
  CommercialSupplierAddress,
  CommercialSupplierContact,
} from '@/lib/commercial-suppliers/types'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface SupplierRow extends QueryResultRow {
  id: string
  internal_code: string
  legal_name: string
  trade_name: string | null
  document_type: CommercialSupplier['documentType']
  document_number: string | null
  service_types: CommercialSupplier['serviceTypes']
  reservation_system: CommercialSupplier['reservationSystem']
  address_id: string | null
  resolved_address_id: string | null
  address_country_id: string | null
  address_country_code: string | null
  address_country_name: string | null
  address_subdivision_id: string | null
  address_subdivision_code: string | null
  address_subdivision_name: string | null
  address_city_id: string | null
  address_city_name: string | null
  address_postal_code: string | null
  address_street: string | null
  address_street_number: string | null
  address_complement: string | null
  address_district: string | null
  address_latitude: string | number | null
  address_longitude: string | number | null
  address_formatted: string | null
  website: string | null
  notes: string | null
  status: CommercialSupplier['status']
  payment_terms: Record<string, unknown> | null
  version: string | number
  contacts: unknown
  created_at: string | Date
  updated_at: string | Date
  total_count?: string | number
}

type SupplierAddressInput = NonNullable<CreateCommercialSupplierInput['address']>

export class CommercialSupplierServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'CommercialSupplierServiceError'
  }
}

export async function listCommercialSuppliers(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<{ items: CommercialSupplier[]; total: number }> {
  const query = commercialSupplierQuerySchema.parse(rawQuery)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [principal.tenantId]
    const clauses = ['supplier.tenant_id = $1', 'supplier.deleted_at is null']
    if (!query.includeInactive && !query.status) clauses.push(`supplier.status = 'active'`)
    if (query.status) {
      values.push(query.status)
      clauses.push(`supplier.status = $${values.length}`)
    }
    if (query.serviceType) {
      values.push(query.serviceType)
      clauses.push(`supplier.service_types @> array[$${values.length}]::text[]`)
    }
    if (query.cityId) {
      values.push(query.cityId)
      clauses.push(`address.city_id = $${values.length}::uuid`)
    }
    if (query.reservationSystem) {
      values.push(query.reservationSystem)
      clauses.push(`supplier.reservation_system = $${values.length}`)
    }
    if (query.q) {
      values.push(`%${query.q.toLowerCase()}%`)
      clauses.push(`(
        lower(supplier.internal_code::text) like $${values.length}
        or lower(supplier.legal_name) like $${values.length}
        or lower(coalesce(supplier.trade_name, '')) like $${values.length}
        or lower(coalesce(supplier.document_number, '')) like $${values.length}
        or lower(coalesce(address.formatted_address, '')) like $${values.length}
        or lower(coalesce(city.name, '')) like $${values.length}
      )`)
    }
    values.push(query.limit, query.offset)
    const result = await client.query<SupplierRow>(
      `${supplierSelect(true)}
       where ${clauses.join(' and ')}
       order by lower(coalesce(supplier.trade_name, supplier.legal_name))
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: result.rows.map(mapSupplier),
      total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    }
  })
}

export async function getCommercialSupplier(
  principal: RequestPrincipal,
  id: string,
): Promise<CommercialSupplier> {
  if (!isUuid(id)) {
    throw new CommercialSupplierServiceError('SUPPLIER_ID_INVALID', 'Identificador de fornecedor invalido.', 400)
  }
  return withTenantTransaction(principal.tenantId, async (client) => {
    const row = await loadSupplier(client, principal.tenantId, id)
    if (!row) throw new CommercialSupplierServiceError('SUPPLIER_NOT_FOUND', 'Fornecedor nao encontrado.', 404)
    return mapSupplier(row)
  })
}

export async function createCommercialSupplier(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<CommercialSupplier> {
  const input = createCommercialSupplierSchema.parse(rawInput)
  let item: CommercialSupplier
  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      const addressId = input.address
        ? await createSupplierAddress(client, principal, input.address)
        : null
      const inserted = await client.query<SupplierRow>(
        `insert into commercial_suppliers (
           tenant_id, internal_code, legal_name, trade_name, document_type,
           document_number, service_types, reservation_system, address_id,
           website, notes, status, payment_terms, created_by, updated_by
         ) values (
           $1, $2, $3, $4, $5, $6, $7::text[], $8, $9,
           $10, $11, $12, $13::jsonb, $14, $14
         )
         returning *, '[]'::jsonb as contacts`,
        [
          principal.tenantId,
          input.internalCode,
          input.legalName,
          input.tradeName || null,
          input.documentType,
          input.documentNumber || null,
          input.serviceTypes,
          input.reservationSystem,
          addressId,
          input.website || null,
          input.notes || null,
          input.status,
          JSON.stringify(input.paymentTerms),
          principal.user.id,
        ],
      )
      const row = inserted.rows[0]
      if (!row) throw new CommercialSupplierServiceError('SUPPLIER_CREATE_FAILED', 'Nao foi possivel criar o fornecedor.', 500)
      await replaceContacts(client, principal, row.id, input.contacts)
      const hydrated = await loadSupplier(client, principal.tenantId, row.id)
      if (!hydrated) throw new CommercialSupplierServiceError('SUPPLIER_CREATE_FAILED', 'Nao foi possivel carregar o fornecedor.', 500)
      return mapSupplier(hydrated)
    })
  } catch (error) {
    throw translateDatabaseError(error)
  }
  await writeAuditEvent({
    action: 'commercial_supplier.created',
    result: 'success',
    entityType: 'commercial_supplier',
    entityId: item.id,
    metadata: {
      internalCode: item.internalCode,
      serviceTypes: item.serviceTypes,
      reservationSystem: item.reservationSystem,
      cityId: item.address?.cityId || null,
    },
  })
  return item
}

export async function updateCommercialSupplier(
  principal: RequestPrincipal,
  id: string,
  rawInput: unknown,
): Promise<CommercialSupplier> {
  if (!isUuid(id)) {
    throw new CommercialSupplierServiceError('SUPPLIER_ID_INVALID', 'Identificador de fornecedor invalido.', 400)
  }
  const input = updateCommercialSupplierSchema.parse(rawInput)
  let item: CommercialSupplier
  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      const current = await loadSupplier(client, principal.tenantId, id, true)
      if (!current) throw new CommercialSupplierServiceError('SUPPLIER_NOT_FOUND', 'Fornecedor nao encontrado.', 404)
      if (Number(current.version) !== input.expectedVersion) {
        throw new CommercialSupplierServiceError(
          'STALE_SUPPLIER_VERSION',
          'O fornecedor foi alterado por outro usuario. Atualize a pagina.',
          409,
          { currentVersion: Number(current.version) },
        )
      }
      const merged = createCommercialSupplierSchema.parse({
        internalCode: input.internalCode ?? current.internal_code,
        legalName: input.legalName ?? current.legal_name,
        tradeName: input.tradeName === undefined ? current.trade_name ?? undefined : input.tradeName,
        documentType: input.documentType ?? current.document_type,
        documentNumber: input.documentNumber === undefined
          ? current.document_number ?? undefined
          : input.documentNumber,
        serviceTypes: input.serviceTypes ?? current.service_types,
        reservationSystem: input.reservationSystem ?? current.reservation_system,
        address: input.address === undefined ? addressInput(current) : input.address,
        website: input.website === undefined ? current.website ?? undefined : input.website,
        notes: input.notes === undefined ? current.notes ?? undefined : input.notes,
        status: input.status ?? current.status,
        paymentTerms: input.paymentTerms ?? current.payment_terms ?? {},
        contacts: input.contacts ?? contactInputs(current.contacts),
      })
      const addressId = await upsertSupplierAddress(
        client,
        principal,
        current.address_id,
        merged.address,
      )
      const updated = await client.query(
        `update commercial_suppliers set
           internal_code = $4, legal_name = $5, trade_name = $6,
           document_type = $7, document_number = $8, service_types = $9::text[],
           reservation_system = $10, address_id = $11, website = $12,
           notes = $13, status = $14, payment_terms = $15::jsonb,
           version = version + 1, updated_by = $16, updated_at = now()
         where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null`,
        [
          principal.tenantId,
          id,
          input.expectedVersion,
          merged.internalCode,
          merged.legalName,
          merged.tradeName || null,
          merged.documentType,
          merged.documentNumber || null,
          merged.serviceTypes,
          merged.reservationSystem,
          addressId,
          merged.website || null,
          merged.notes || null,
          merged.status,
          JSON.stringify(merged.paymentTerms),
          principal.user.id,
        ],
      )
      if (!updated.rowCount) throw new CommercialSupplierServiceError('STALE_SUPPLIER_VERSION', 'O fornecedor foi alterado por outro usuario.', 409)
      if (merged.status !== 'active' || !merged.serviceTypes.includes('hotel')) {
        await client.query(
          `update hotel_suppliers set is_active = false, ended_at = now(),
             version = version + 1, updated_by = $3, updated_at = now()
           where tenant_id = $1 and supplier_id = $2 and is_active`,
          [principal.tenantId, id, principal.user.id],
        )
      }
      // `contacts` e um snapshot completo quando informado. Omiti-lo no PATCH
      // preserva integralmente todos os tipos de contato ja cadastrados.
      if (input.contacts !== undefined) await replaceContacts(client, principal, id, merged.contacts)
      const hydrated = await loadSupplier(client, principal.tenantId, id)
      if (!hydrated) throw new CommercialSupplierServiceError('SUPPLIER_NOT_FOUND', 'Fornecedor nao encontrado.', 404)
      return mapSupplier(hydrated)
    })
  } catch (error) {
    throw translateDatabaseError(error)
  }
  await writeAuditEvent({
    action: 'commercial_supplier.updated',
    result: 'success',
    entityType: 'commercial_supplier',
    entityId: item.id,
    metadata: {
      version: item.version,
      status: item.status,
      reservationSystem: item.reservationSystem,
      cityId: item.address?.cityId || null,
    },
  })
  return item
}

async function replaceContacts(
  client: PoolClient,
  principal: RequestPrincipal,
  supplierId: string,
  contacts: CreateCommercialSupplierInput['contacts'],
): Promise<void> {
  await client.query(
    `update commercial_supplier_contacts set is_active = false, updated_by = $3, updated_at = now()
     where tenant_id = $1 and supplier_id = $2 and is_active`,
    [principal.tenantId, supplierId, principal.user.id],
  )
  for (const contact of contacts) {
    await client.query(
      `insert into commercial_supplier_contacts (
         tenant_id, supplier_id, contact_type, name, email, phone, fax,
         is_primary, is_active, created_by, updated_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $9)`,
      [
        principal.tenantId,
        supplierId,
        contact.type,
        contact.name || null,
        contact.email || null,
        contact.phone || null,
        contact.fax || null,
        contact.isPrimary,
        principal.user.id,
      ],
    )
  }
}

async function createSupplierAddress(
  client: PoolClient,
  principal: RequestPrincipal,
  address: SupplierAddressInput,
): Promise<string> {
  await requireAddressGeography(client, address)
  const inserted = await client.query<{ id: string }>(
    `insert into postal_addresses (
       tenant_id, country_id, subdivision_id, city_id, postal_code,
       street, street_number, complement, district, latitude, longitude,
       formatted_address, created_by, updated_by
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13
     ) returning id`,
    [
      principal.tenantId,
      address.countryId || null,
      address.subdivisionId || null,
      address.cityId || null,
      address.postalCode || null,
      address.street || null,
      address.streetNumber || null,
      address.complement || null,
      address.district || null,
      address.latitude ?? null,
      address.longitude ?? null,
      address.formattedAddress || null,
      principal.user.id,
    ],
  )
  return inserted.rows[0].id
}

async function upsertSupplierAddress(
  client: PoolClient,
  principal: RequestPrincipal,
  addressId: string | null,
  address: SupplierAddressInput | null | undefined,
): Promise<string | null> {
  if (!address) {
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
  await requireAddressGeography(client, address)
  if (!addressId) return createSupplierAddress(client, principal, address)
  const updated = await client.query(
    `update postal_addresses set
       country_id = $3, subdivision_id = $4, city_id = $5,
       postal_code = $6, street = $7, street_number = $8, complement = $9,
       district = $10, latitude = $11, longitude = $12,
       formatted_address = $13, version = version + 1,
       updated_by = $14, updated_at = now()
     where tenant_id = $1 and id = $2 and deleted_at is null`,
    [
      principal.tenantId,
      addressId,
      address.countryId || null,
      address.subdivisionId || null,
      address.cityId || null,
      address.postalCode || null,
      address.street || null,
      address.streetNumber || null,
      address.complement || null,
      address.district || null,
      address.latitude ?? null,
      address.longitude ?? null,
      address.formattedAddress || null,
      principal.user.id,
    ],
  )
  return updated.rowCount ? addressId : createSupplierAddress(client, principal, address)
}

async function requireAddressGeography(
  client: PoolClient,
  address: SupplierAddressInput,
): Promise<void> {
  if (!address.countryId) return
  const result = await client.query<{ valid: boolean }>(
    `select true as valid
     from geo_countries country
     left join geo_subdivisions subdivision
       on subdivision.country_id = country.id
      and subdivision.id = $2::uuid
      and subdivision.is_active
     left join geo_cities city
       on city.country_id = country.id
      and city.id = $3::uuid
      and city.is_active
      and ($2::uuid is null or city.subdivision_id = subdivision.id)
     where country.id = $1::uuid and country.is_active
       and ($2::uuid is null or subdivision.id is not null)
       and ($3::uuid is null or city.id is not null)`,
    [address.countryId, address.subdivisionId || null, address.cityId || null],
  )
  if (!result.rows[0]) {
    throw new CommercialSupplierServiceError(
      'SUPPLIER_ADDRESS_GEOGRAPHY_INVALID',
      'Pais, estado ou cidade nao formam uma localizacao valida e ativa.',
      422,
    )
  }
}

function supplierSelect(includeTotal = false): string {
  return `select supplier.*,
          ${includeTotal ? 'count(*) over() as total_count,' : ''}
          address.id as resolved_address_id,
          address.country_id as address_country_id,
          country.iso_alpha2::text as address_country_code,
          country.name as address_country_name,
          address.subdivision_id as address_subdivision_id,
          subdivision.code::text as address_subdivision_code,
          subdivision.name as address_subdivision_name,
          address.city_id as address_city_id,
          city.name as address_city_name,
          address.postal_code as address_postal_code,
          address.street as address_street,
          address.street_number as address_street_number,
          address.complement as address_complement,
          address.district as address_district,
          address.latitude as address_latitude,
          address.longitude as address_longitude,
          address.formatted_address as address_formatted,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', contact.id,
              'type', contact.contact_type,
              'name', contact.name,
              'email', contact.email::text,
              'phone', contact.phone,
              'fax', contact.fax,
              'isPrimary', contact.is_primary,
              'isActive', contact.is_active
            ) order by contact.is_primary desc, contact.contact_type, contact.created_at)
            from commercial_supplier_contacts contact
            where contact.tenant_id = supplier.tenant_id
              and contact.supplier_id = supplier.id
              and contact.is_active
          ), '[]'::jsonb) as contacts
   from commercial_suppliers supplier
   left join postal_addresses address
     on address.tenant_id = supplier.tenant_id
    and address.id = supplier.address_id
    and address.deleted_at is null
   left join geo_countries country on country.id = address.country_id
   left join geo_subdivisions subdivision on subdivision.id = address.subdivision_id
   left join geo_cities city on city.id = address.city_id`
}

async function loadSupplier(
  client: PoolClient,
  tenantId: string,
  id: string,
  forUpdate = false,
): Promise<SupplierRow | null> {
  const result = await client.query<SupplierRow>(
    `${supplierSelect()}
     where supplier.tenant_id = $1 and supplier.id = $2 and supplier.deleted_at is null
     ${forUpdate ? 'for update of supplier' : ''}`,
    [tenantId, id],
  )
  return result.rows[0] || null
}

function mapSupplier(row: SupplierRow): CommercialSupplier {
  return {
    id: row.id,
    internalCode: row.internal_code,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    documentType: row.document_type,
    documentNumber: row.document_number,
    serviceTypes: Array.isArray(row.service_types) ? row.service_types : [],
    reservationSystem: row.reservation_system || 'manual',
    address: mapAddress(row),
    website: row.website,
    notes: row.notes,
    status: row.status,
    paymentTerms: row.payment_terms || {},
    version: Number(row.version),
    contacts: mapContacts(row.contacts),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function mapAddress(row: SupplierRow): CommercialSupplierAddress | null {
  if (!row.resolved_address_id) return null
  return {
    id: row.resolved_address_id,
    countryId: row.address_country_id,
    countryCode: row.address_country_code,
    countryName: row.address_country_name,
    subdivisionId: row.address_subdivision_id,
    subdivisionCode: row.address_subdivision_code,
    subdivisionName: row.address_subdivision_name,
    cityId: row.address_city_id,
    cityName: row.address_city_name,
    postalCode: row.address_postal_code,
    street: row.address_street,
    streetNumber: row.address_street_number,
    complement: row.address_complement,
    district: row.address_district,
    latitude: row.address_latitude == null ? null : Number(row.address_latitude),
    longitude: row.address_longitude == null ? null : Number(row.address_longitude),
    formattedAddress: row.address_formatted,
  }
}

function addressInput(row: SupplierRow): SupplierAddressInput | undefined {
  if (!row.resolved_address_id) return undefined
  if (![
    row.address_country_id,
    row.address_subdivision_id,
    row.address_city_id,
    row.address_postal_code,
    row.address_street,
    row.address_street_number,
    row.address_complement,
    row.address_district,
    row.address_latitude,
    row.address_longitude,
    row.address_formatted,
  ].some((value) => value !== null && value !== '')) return undefined
  return {
    countryId: row.address_country_id || undefined,
    subdivisionId: row.address_subdivision_id || undefined,
    cityId: row.address_city_id || undefined,
    postalCode: row.address_postal_code || undefined,
    street: row.address_street || undefined,
    streetNumber: row.address_street_number || undefined,
    complement: row.address_complement || undefined,
    district: row.address_district || undefined,
    latitude: row.address_latitude == null ? undefined : Number(row.address_latitude),
    longitude: row.address_longitude == null ? undefined : Number(row.address_longitude),
    formattedAddress: row.address_formatted || undefined,
  }
}

function mapContacts(value: unknown): CommercialSupplierContact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): CommercialSupplierContact[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    return [{
      id: String(row.id || ''),
      type: String(row.type || 'general') as CommercialSupplierContact['type'],
      name: typeof row.name === 'string' ? row.name : null,
      email: typeof row.email === 'string' ? row.email : null,
      phone: typeof row.phone === 'string' ? row.phone : null,
      fax: typeof row.fax === 'string' ? row.fax : null,
      isPrimary: row.isPrimary === true,
      isActive: row.isActive !== false,
    }]
  })
}

function contactInputs(value: unknown): CreateCommercialSupplierInput['contacts'] {
  return mapContacts(value).map((contact) => ({
    type: contact.type,
    name: contact.name || undefined,
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    fax: contact.fax || undefined,
    isPrimary: contact.isPrimary,
  }))
}

function translateDatabaseError(error: unknown): Error {
  if (error instanceof CommercialSupplierServiceError) return error
  const code = databaseCode(error)
  if (code === '23505') {
    if (databaseConstraint(error) === 'commercial_supplier_contacts_primary_uidx') {
      return new CommercialSupplierServiceError(
        'SUPPLIER_PRIMARY_CONTACT_DUPLICATE',
        'Informe somente um contato principal por tipo.',
        422,
      )
    }
    return new CommercialSupplierServiceError(
      'SUPPLIER_DUPLICATE',
      'Ja existe fornecedor com este codigo ou documento.',
      409,
    )
  }
  if (code === '23503' || code === '23514') {
    return new CommercialSupplierServiceError(
      'SUPPLIER_REFERENCE_INVALID',
      'O fornecedor possui dados relacionados invalidos.',
      422,
    )
  }
  return error instanceof Error ? error : new Error('Falha ao persistir fornecedor.')
}

function databaseCode(error: unknown): string | null {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? String((error as { code: string }).code)
    : null
}

function databaseConstraint(error: unknown): string | null {
  return error && typeof error === 'object' && typeof (error as { constraint?: unknown }).constraint === 'string'
    ? String((error as { constraint: string }).constraint)
    : null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

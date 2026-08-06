import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import {
  canonicalNightlyAmount,
  createHotelSupplierLinkSchema,
  createHotelSupplierRateSchema,
  updateHotelSupplierLinkSchema,
  updateHotelSupplierRateSchema,
  type CreateHotelSupplierLinkInput,
  type CreateHotelSupplierRateInput,
  type HotelSupplierRateScopeTargetInput,
} from '@/lib/hotel-supplier-rates/schema'
import type {
  HotelSupplierLink,
  HotelSupplierRate,
  HotelSupplierRateRoomType,
  HotelSupplierRateScopeTarget,
} from '@/lib/hotel-supplier-rates/types'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import { HotelCatalogServiceError } from '@/lib/server/hotel-catalog-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

interface LinkRow extends QueryResultRow {
  id: string
  supplier_id: string
  hotel_id: string
  supplier_property_code: string | null
  reservation_email: string | null
  reservation_phone: string | null
  priority: string | number
  billing_enabled: boolean
  payment_methods: string[] | null
  commercial_terms: Record<string, unknown> | null
  is_active: boolean
  valid_from: string | Date | null
  valid_until: string | Date | null
  out_of_period_policy: HotelSupplierLink['outOfPeriodPolicy']
  version: string | number
  created_at: string | Date
  updated_at: string | Date
  hotel_name: string
  hotel_city_id: string | null
  hotel_city_name: string | null
  hotel_subdivision_code: string | null
  hotel_country_code: string | null
  hotel_address: string | null
  hotel_category: string | null
  hotel_status: 'active' | 'inactive'
  room_types: unknown
}

interface BasicLinkRow extends QueryResultRow {
  id: string
  supplier_id: string
  hotel_id: string
  supplier_property_code: string | null
  reservation_email: string | null
  reservation_phone: string | null
  priority: string | number
  billing_enabled: boolean
  payment_methods: string[] | null
  commercial_terms: Record<string, unknown> | null
  is_active: boolean
  valid_from: string | Date | null
  valid_until: string | Date | null
  out_of_period_policy: HotelSupplierLink['outOfPeriodPolicy']
  version: string | number
}

interface RateRow extends QueryResultRow {
  id: string
  hotel_id: string
  hotel_supplier_id: string
  room_type_id: string
  rate_code: string
  valid_from: string | Date
  valid_until: string | Date
  rack_amount: string | number | null
  nightly_amount: string | number
  tax_amount: string | number
  service_fee_amount: string | number
  currency: string
  is_net: boolean
  is_suspended: boolean
  is_active: boolean
  refundable: boolean | null
  meal_plan: string | null
  cancellation_policy: string | null
  scope_type: HotelSupplierRate['scopeType']
  metadata: Record<string, unknown> | null
  version: string | number
  created_at: string | Date
  updated_at: string | Date
  room_code: string
  room_name: string
  occupancy_type: HotelSupplierRateRoomType['occupancyType']
  max_guests: string | number
  room_is_active: boolean
  scope_targets: unknown
}

interface BasicRateRow extends QueryResultRow {
  id: string
  hotel_id: string
  hotel_supplier_id: string
  room_type_id: string
  rate_code: string
  valid_from: string | Date
  valid_until: string | Date
  rack_amount: string | number | null
  nightly_amount: string | number
  tax_amount: string | number
  service_fee_amount: string | number
  currency: string
  is_net: boolean
  is_suspended: boolean
  is_active: boolean
  refundable: boolean | null
  meal_plan: string | null
  cancellation_policy: string | null
  scope_type: HotelSupplierRate['scopeType']
  metadata: Record<string, unknown> | null
  version: string | number
}

export class HotelSupplierRateServiceError extends HotelCatalogServiceError {
  constructor(
    code: string,
    message: string,
    status = 409,
    details: Record<string, unknown> = {},
  ) {
    super(code, message, status, details)
    this.name = 'HotelSupplierRateServiceError'
  }
}

export async function listHotelSupplierLinks(
  principal: RequestPrincipal,
  supplierId: string,
): Promise<HotelSupplierLink[]> {
  requireUuid(supplierId, 'SUPPLIER_ID_INVALID', 'Identificador de fornecedor invalido.')
  return withTenantTransaction(principal.tenantId, async (client) => {
    await requireHotelSupplier(client, principal.tenantId, supplierId)
    const rows = await loadLinkRows(client, principal.tenantId, supplierId)
    const rates = await loadRatesForLinks(
      client,
      principal.tenantId,
      supplierId,
      rows.map((row) => row.id),
    )
    return hydrateLinks(rows, rates)
  })
}

export async function createHotelSupplierLink(
  principal: RequestPrincipal,
  supplierId: string,
  rawInput: unknown,
): Promise<{ item: HotelSupplierLink; replayed: boolean }> {
  requireUuid(supplierId, 'SUPPLIER_ID_INVALID', 'Identificador de fornecedor invalido.')
  const input = createHotelSupplierLinkSchema.parse(rawInput)
  let replayed = false
  let item: HotelSupplierLink
  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      await requireHotelSupplier(client, principal.tenantId, supplierId)
      await requireHotel(client, principal.tenantId, input.hotelId)
      const inserted = await client.query<{ id: string }>(
        `insert into hotel_suppliers (
           tenant_id, hotel_id, supplier_id, supplier_property_code,
           reservation_email, reservation_phone, priority, billing_enabled,
           payment_methods, commercial_terms, is_active, valid_from, valid_until,
           out_of_period_policy, ended_at, created_by, updated_by
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9::text[], $10::jsonb, $11, $12, $13, $14,
           case when $11 then null else now() end, $15, $15
         )
         on conflict (tenant_id, hotel_id, supplier_id) do nothing
         returning id`,
        [
          principal.tenantId,
          input.hotelId,
          supplierId,
          input.propertyCode || null,
          input.reservationEmail || null,
          input.reservationPhone || null,
          input.priority,
          input.billingEnabled,
          input.paymentMethods,
          JSON.stringify(input.commercialTerms),
          input.isActive,
          input.validFrom || null,
          input.validUntil || null,
          input.outOfPeriodPolicy,
          principal.user.id,
        ],
      )
      replayed = !inserted.rows[0]
      const linkId = inserted.rows[0]?.id || await findLinkId(
        client,
        principal.tenantId,
        supplierId,
        input.hotelId,
      )
      return requireHydratedLink(client, principal.tenantId, supplierId, linkId)
    })
  } catch (error) {
    throw translateDatabaseError(error)
  }
  if (!replayed) {
    await writeAuditEvent({
      action: 'hotel_supplier.link.created',
      result: 'success',
      entityType: 'hotel_supplier',
      entityId: item.id,
      metadata: { supplierId, hotelId: item.hotelId },
    })
  }
  return { item, replayed }
}

export async function updateHotelSupplierLink(
  principal: RequestPrincipal,
  supplierId: string,
  linkId: string,
  rawInput: unknown,
): Promise<HotelSupplierLink> {
  requireUuid(supplierId, 'SUPPLIER_ID_INVALID', 'Identificador de fornecedor invalido.')
  requireUuid(linkId, 'HOTEL_SUPPLIER_LINK_ID_INVALID', 'Identificador de vinculo invalido.')
  const input = updateHotelSupplierLinkSchema.parse(rawInput)
  let item: HotelSupplierLink
  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      await requireHotelSupplier(client, principal.tenantId, supplierId)
      const current = await loadBasicLink(client, principal.tenantId, supplierId, linkId, true)
      if (!current) throw linkNotFound()
      if (Number(current.version) !== input.expectedVersion) throw staleLink(Number(current.version))
      const merged = createHotelSupplierLinkSchema.parse({
        hotelId: current.hotel_id,
        propertyCode: input.propertyCode === undefined ? current.supplier_property_code : input.propertyCode,
        reservationEmail: input.reservationEmail === undefined ? current.reservation_email : input.reservationEmail,
        reservationPhone: input.reservationPhone === undefined ? current.reservation_phone : input.reservationPhone,
        priority: input.priority ?? Number(current.priority),
        billingEnabled: input.billingEnabled ?? current.billing_enabled,
        paymentMethods: input.paymentMethods ?? current.payment_methods ?? [],
        commercialTerms: input.commercialTerms ?? current.commercial_terms ?? {},
        validFrom: input.validFrom === undefined ? dateOnlyOrNull(current.valid_from) : input.validFrom,
        validUntil: input.validUntil === undefined ? dateOnlyOrNull(current.valid_until) : input.validUntil,
        outOfPeriodPolicy: input.outOfPeriodPolicy ?? current.out_of_period_policy,
        isActive: input.isActive ?? current.is_active,
      })
      const updated = await client.query(
        `update hotel_suppliers set
           supplier_property_code = $4, reservation_email = $5,
           reservation_phone = $6, priority = $7, billing_enabled = $8,
           payment_methods = $9::text[], commercial_terms = $10::jsonb,
           valid_from = $11, valid_until = $12, out_of_period_policy = $13,
           is_active = $14, ended_at = case when $14 then null else coalesce(ended_at, now()) end,
           version = version + 1, updated_by = $15, updated_at = now()
         where tenant_id = $1 and supplier_id = $2 and id = $3 and version = $16`,
        [
          principal.tenantId,
          supplierId,
          linkId,
          merged.propertyCode || null,
          merged.reservationEmail || null,
          merged.reservationPhone || null,
          merged.priority,
          merged.billingEnabled,
          merged.paymentMethods,
          JSON.stringify(merged.commercialTerms),
          merged.validFrom || null,
          merged.validUntil || null,
          merged.outOfPeriodPolicy,
          merged.isActive,
          principal.user.id,
          input.expectedVersion,
        ],
      )
      if (!updated.rowCount) throw staleLink(Number(current.version))
      return requireHydratedLink(client, principal.tenantId, supplierId, linkId)
    })
  } catch (error) {
    throw translateDatabaseError(error)
  }
  await writeAuditEvent({
    action: 'hotel_supplier.link.updated',
    result: 'success',
    entityType: 'hotel_supplier',
    entityId: item.id,
    metadata: { supplierId, hotelId: item.hotelId, version: item.version, isActive: item.isActive },
  })
  return item
}

export async function listHotelSupplierRates(
  principal: RequestPrincipal,
  supplierId: string,
  linkId: string,
): Promise<HotelSupplierRate[]> {
  requireUuid(supplierId, 'SUPPLIER_ID_INVALID', 'Identificador de fornecedor invalido.')
  requireUuid(linkId, 'HOTEL_SUPPLIER_LINK_ID_INVALID', 'Identificador de vinculo invalido.')
  return withTenantTransaction(principal.tenantId, async (client) => {
    await requireHotelSupplier(client, principal.tenantId, supplierId)
    if (!await loadBasicLink(client, principal.tenantId, supplierId, linkId)) throw linkNotFound()
    return loadRatesForLinks(client, principal.tenantId, supplierId, [linkId])
  })
}

export async function createHotelSupplierRate(
  principal: RequestPrincipal,
  supplierId: string,
  linkId: string,
  rawInput: unknown,
): Promise<HotelSupplierRate> {
  requireUuid(supplierId, 'SUPPLIER_ID_INVALID', 'Identificador de fornecedor invalido.')
  requireUuid(linkId, 'HOTEL_SUPPLIER_LINK_ID_INVALID', 'Identificador de vinculo invalido.')
  const input = createHotelSupplierRateSchema.parse(rawInput)
  let item: HotelSupplierRate
  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      await requireHotelSupplier(client, principal.tenantId, supplierId)
      const link = await loadBasicLink(client, principal.tenantId, supplierId, linkId)
      if (!link) throw linkNotFound()
      await requireRoomType(client, principal.tenantId, link.hotel_id, input.roomTypeId)
      await requireScopeTargets(client, principal.tenantId, input.scopeTargets)
      const nightlyAmount = requiredNightlyAmount(input)
      const inserted = await client.query<{ id: string }>(
        `insert into hotel_supplier_rates (
           tenant_id, hotel_id, hotel_supplier_id, room_type_id, rate_code,
           valid_from, valid_until, rack_amount, nightly_amount, tax_amount,
           service_fee_amount, currency, is_net, is_suspended, refundable,
           meal_plan, cancellation_policy, scope_type, metadata, is_active,
           created_by, updated_by
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $21
         ) returning id`,
        [
          principal.tenantId,
          link.hotel_id,
          linkId,
          input.roomTypeId,
          input.code,
          input.validFrom,
          input.validUntil,
          input.rackAmount ?? null,
          nightlyAmount,
          input.taxAmount,
          input.serviceFeeAmount,
          input.currency,
          input.isNet,
          input.isSuspended,
          input.refundable ?? null,
          input.mealPlan || null,
          input.cancellationPolicy || null,
          input.scopeType,
          JSON.stringify(metadataWithPaymentTerms(input.metadata, input.paymentTerms)),
          input.isActive,
          principal.user.id,
        ],
      )
      await replaceRateScopes(
        client,
        principal,
        inserted.rows[0].id,
        input.scopeType,
        input.scopeTargets,
      )
      return requireHydratedRate(client, principal.tenantId, supplierId, linkId, inserted.rows[0].id)
    })
  } catch (error) {
    throw translateDatabaseError(error)
  }
  await writeAuditEvent({
    action: 'hotel_supplier.rate.created',
    result: 'success',
    entityType: 'hotel_supplier_rate',
    entityId: item.id,
    metadata: {
      supplierId,
      hotelSupplierId: linkId,
      hotelId: item.hotelId,
      roomTypeId: item.roomTypeId,
      scopeType: item.scopeType,
    },
  })
  return item
}

export async function updateHotelSupplierRate(
  principal: RequestPrincipal,
  supplierId: string,
  linkId: string,
  rateId: string,
  rawInput: unknown,
): Promise<HotelSupplierRate> {
  requireUuid(supplierId, 'SUPPLIER_ID_INVALID', 'Identificador de fornecedor invalido.')
  requireUuid(linkId, 'HOTEL_SUPPLIER_LINK_ID_INVALID', 'Identificador de vinculo invalido.')
  requireUuid(rateId, 'HOTEL_SUPPLIER_RATE_ID_INVALID', 'Identificador de tarifa invalido.')
  const input = updateHotelSupplierRateSchema.parse(rawInput)
  let item: HotelSupplierRate
  try {
    item = await withTenantTransaction(principal.tenantId, async (client) => {
      await requireHotelSupplier(client, principal.tenantId, supplierId)
      const link = await loadBasicLink(client, principal.tenantId, supplierId, linkId)
      if (!link) throw linkNotFound()
      const currentRow = await loadBasicRate(
        client,
        principal.tenantId,
        supplierId,
        linkId,
        rateId,
        true,
      )
      if (!currentRow) throw rateNotFound()
      if (Number(currentRow.version) !== input.expectedVersion) throw staleRate(Number(currentRow.version))
      const current = await requireHydratedRate(client, principal.tenantId, supplierId, linkId, rateId)
      const targetScopeType = input.scopeType ?? current.scopeType
      const targetScopes = input.scopeTargets
        ?? (input.scopeType === 'global' ? [] : current.scopeTargets.map(({ type, id }) => ({ type, id })))
      const merged = createHotelSupplierRateSchema.parse({
        roomTypeId: input.roomTypeId ?? current.roomTypeId,
        code: input.code ?? current.code,
        validFrom: input.validFrom ?? current.validFrom,
        validUntil: input.validUntil ?? current.validUntil,
        rackAmount: input.rackAmount === undefined ? current.rackAmount : input.rackAmount,
        nightlyAmount: canonicalNightlyAmount(input) ?? current.nightlyAmount,
        taxAmount: input.taxAmount ?? current.taxAmount,
        serviceFeeAmount: input.serviceFeeAmount ?? current.serviceFeeAmount,
        currency: input.currency ?? current.currency,
        isNet: input.isNet ?? current.isNet,
        isSuspended: input.isSuspended ?? current.isSuspended,
        isActive: input.isActive ?? current.isActive,
        refundable: input.refundable === undefined ? current.refundable : input.refundable,
        mealPlan: input.mealPlan === undefined ? current.mealPlan : input.mealPlan,
        cancellationPolicy: input.cancellationPolicy === undefined
          ? current.cancellationPolicy
          : input.cancellationPolicy,
        paymentTerms: input.paymentTerms === undefined ? current.paymentTerms : input.paymentTerms,
        scopeType: targetScopeType,
        scopeTargets: targetScopes,
        metadata: input.metadata ?? current.metadata,
      })
      await requireRoomType(client, principal.tenantId, link.hotel_id, merged.roomTypeId)
      await requireScopeTargets(client, principal.tenantId, merged.scopeTargets)
      const updated = await client.query(
        `update hotel_supplier_rates set
           room_type_id = $6, rate_code = $7, valid_from = $8, valid_until = $9,
           rack_amount = $10, nightly_amount = $11, tax_amount = $12,
           service_fee_amount = $13, currency = $14, is_net = $15,
           is_suspended = $16, refundable = $17, meal_plan = $18,
           cancellation_policy = $19, scope_type = $20, metadata = $21::jsonb,
           is_active = $22, version = version + 1, updated_by = $23, updated_at = now()
         where tenant_id = $1 and hotel_supplier_id = $2 and id = $3
           and hotel_id = $4 and version = $5`,
        [
          principal.tenantId,
          linkId,
          rateId,
          link.hotel_id,
          input.expectedVersion,
          merged.roomTypeId,
          merged.code,
          merged.validFrom,
          merged.validUntil,
          merged.rackAmount ?? null,
          requiredNightlyAmount(merged),
          merged.taxAmount,
          merged.serviceFeeAmount,
          merged.currency,
          merged.isNet,
          merged.isSuspended,
          merged.refundable ?? null,
          merged.mealPlan || null,
          merged.cancellationPolicy || null,
          merged.scopeType,
          JSON.stringify(metadataWithPaymentTerms(merged.metadata, merged.paymentTerms)),
          merged.isActive,
          principal.user.id,
        ],
      )
      if (!updated.rowCount) throw staleRate(Number(currentRow.version))
      if (input.scopeType !== undefined || input.scopeTargets !== undefined) {
        await replaceRateScopes(client, principal, rateId, merged.scopeType, merged.scopeTargets)
      }
      return requireHydratedRate(client, principal.tenantId, supplierId, linkId, rateId)
    })
  } catch (error) {
    throw translateDatabaseError(error)
  }
  await writeAuditEvent({
    action: 'hotel_supplier.rate.updated',
    result: 'success',
    entityType: 'hotel_supplier_rate',
    entityId: item.id,
    metadata: {
      supplierId,
      hotelSupplierId: linkId,
      version: item.version,
      isSuspended: item.isSuspended,
      isActive: item.isActive,
      scopeType: item.scopeType,
    },
  })
  return item
}

async function requireHotelSupplier(client: PoolClient, tenantId: string, supplierId: string): Promise<void> {
  const result = await client.query(
    `select 1 from commercial_suppliers
     where tenant_id = $1 and id = $2 and deleted_at is null
       and service_types @> array['hotel']::text[]`,
    [tenantId, supplierId],
  )
  if (!result.rows[0]) {
    throw new HotelSupplierRateServiceError(
      'HOTEL_COMMERCIAL_SUPPLIER_NOT_FOUND',
      'Fornecedor comercial de hotel nao encontrado.',
      404,
    )
  }
}

async function requireHotel(client: PoolClient, tenantId: string, hotelId: string): Promise<void> {
  const result = await client.query(
    `select 1 from hotels where tenant_id = $1 and id = $2 and deleted_at is null`,
    [tenantId, hotelId],
  )
  if (!result.rows[0]) {
    throw new HotelSupplierRateServiceError('HOTEL_NOT_FOUND', 'Hotel nao encontrado no tenant.', 404)
  }
}

async function requireRoomType(
  client: PoolClient,
  tenantId: string,
  hotelId: string,
  roomTypeId: string,
): Promise<void> {
  const result = await client.query(
    `select 1 from hotel_room_types
     where tenant_id = $1 and hotel_id = $2 and id = $3
       and is_active and deleted_at is null`,
    [tenantId, hotelId, roomTypeId],
  )
  if (!result.rows[0]) {
    throw new HotelSupplierRateServiceError(
      'HOTEL_RATE_ROOM_TYPE_INVALID',
      'O tipo de quarto nao pertence ao hotel do vinculo ou esta inativo.',
      422,
    )
  }
}

async function requireScopeTargets(
  client: PoolClient,
  tenantId: string,
  targets: readonly HotelSupplierRateScopeTargetInput[],
): Promise<void> {
  const companyIds = targets.filter((target) => target.type === 'company').map((target) => target.id)
  const groupIds = targets.filter((target) => target.type === 'group').map((target) => target.id)
  const [companies, groups] = await Promise.all([
    companyIds.length
      ? client.query<{ id: string }>(
          `select id from companies
           where tenant_id = $1 and id = any($2::text[]) and deleted_at is null`,
          [tenantId, companyIds],
        )
      : Promise.resolve({ rows: [] as Array<{ id: string }> }),
    groupIds.length
      ? client.query<{ id: string }>(
          `select id from business_groups
           where tenant_id = $1 and id = any($2::text[]) and deleted_at is null`,
          [tenantId, groupIds],
        )
      : Promise.resolve({ rows: [] as Array<{ id: string }> }),
  ])
  const validCompanies = new Set(companies.rows.map((row) => row.id))
  const validGroups = new Set(groups.rows.map((row) => row.id))
  const invalid = targets.filter((target) => (
    target.type === 'company' ? !validCompanies.has(target.id) : !validGroups.has(target.id)
  ))
  if (invalid.length) {
    throw new HotelSupplierRateServiceError(
      'HOTEL_RATE_SCOPE_INVALID',
      'Ha empresa ou grupo fora do tenant ou removido.',
      422,
      { targets: invalid },
    )
  }
}

async function replaceRateScopes(
  client: PoolClient,
  principal: RequestPrincipal,
  rateId: string,
  scopeType: HotelSupplierRate['scopeType'],
  targets: readonly HotelSupplierRateScopeTargetInput[],
): Promise<void> {
  await client.query(
    `update hotel_supplier_rate_scopes set
       deleted_at = coalesce(deleted_at, now()), version = version + 1,
       updated_by = $3, updated_at = now()
     where tenant_id = $1 and rate_id = $2 and deleted_at is null`,
    [principal.tenantId, rateId, principal.user.id],
  )
  if (scopeType === 'global') return
  for (const target of targets) {
    await client.query(
      `insert into hotel_supplier_rate_scopes (
         tenant_id, rate_id, scope_type, company_id, business_group_id,
         created_by, updated_by
       ) values ($1, $2, $3, $4, $5, $6, $6)`,
      [
        principal.tenantId,
        rateId,
        target.type,
        target.type === 'company' ? target.id : null,
        target.type === 'group' ? target.id : null,
        principal.user.id,
      ],
    )
  }
}

async function loadLinkRows(
  client: PoolClient,
  tenantId: string,
  supplierId: string,
  linkId?: string,
): Promise<LinkRow[]> {
  const values: unknown[] = [tenantId, supplierId]
  const linkClause = linkId ? `and link.id = $${values.push(linkId)}::uuid` : ''
  const result = await client.query<LinkRow>(
    `select link.*,
            hotel.name as hotel_name, hotel.city_id as hotel_city_id,
            city.name as hotel_city_name,
            subdivision.code::text as hotel_subdivision_code,
            country.iso_alpha2::text as hotel_country_code,
            hotel.address as hotel_address, hotel.category as hotel_category,
            hotel.status as hotel_status,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', room.id, 'code', room.code::text, 'name', room.name,
                'occupancyType', room.occupancy_type, 'maxGuests', room.max_guests,
                'isActive', room.is_active
              ) order by room.code)
              from hotel_room_types room
              where room.tenant_id = link.tenant_id and room.hotel_id = link.hotel_id
                and room.deleted_at is null
            ), '[]'::jsonb) as room_types
     from hotel_suppliers link
     join hotels hotel
       on hotel.tenant_id = link.tenant_id and hotel.id = link.hotel_id
      and hotel.deleted_at is null
     left join geo_cities city on city.id = hotel.city_id
     left join geo_subdivisions subdivision on subdivision.id = hotel.subdivision_id
     left join geo_countries country on country.id = hotel.country_id
     where link.tenant_id = $1 and link.supplier_id = $2 ${linkClause}
     order by hotel.normalized_name, link.priority, link.id`,
    values,
  )
  return result.rows
}

async function loadBasicLink(
  client: PoolClient,
  tenantId: string,
  supplierId: string,
  linkId: string,
  forUpdate = false,
): Promise<BasicLinkRow | null> {
  const result = await client.query<BasicLinkRow>(
    `select link.* from hotel_suppliers link
     where link.tenant_id = $1 and link.supplier_id = $2 and link.id = $3
     ${forUpdate ? 'for update of link' : ''}`,
    [tenantId, supplierId, linkId],
  )
  return result.rows[0] || null
}

async function findLinkId(
  client: PoolClient,
  tenantId: string,
  supplierId: string,
  hotelId: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from hotel_suppliers
     where tenant_id = $1 and supplier_id = $2 and hotel_id = $3`,
    [tenantId, supplierId, hotelId],
  )
  if (!result.rows[0]) throw linkNotFound()
  return result.rows[0].id
}

async function loadRatesForLinks(
  client: PoolClient,
  tenantId: string,
  supplierId: string,
  linkIds: readonly string[],
): Promise<HotelSupplierRate[]> {
  if (!linkIds.length) return []
  const result = await client.query<RateRow>(
    `select rate.*,
            room.code::text as room_code, room.name as room_name,
            room.occupancy_type, room.max_guests, room.is_active as room_is_active,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', coalesce(scope.company_id, scope.business_group_id),
                'type', scope.scope_type,
                'name', coalesce(company.trade_name, company.legal_name, business_group.name),
                'version', scope.version
              ) order by
                case when scope.scope_type = 'company' then 0 else 1 end,
                coalesce(company.trade_name, company.legal_name, business_group.name)
              )
              from hotel_supplier_rate_scopes scope
              left join companies company
                on company.tenant_id = scope.tenant_id and company.id = scope.company_id
              left join business_groups business_group
                on business_group.tenant_id = scope.tenant_id
               and business_group.id = scope.business_group_id
              where scope.tenant_id = rate.tenant_id and scope.rate_id = rate.id
                and scope.deleted_at is null
            ), '[]'::jsonb) as scope_targets
     from hotel_supplier_rates rate
     join hotel_suppliers link
       on link.tenant_id = rate.tenant_id and link.id = rate.hotel_supplier_id
      and link.hotel_id = rate.hotel_id and link.supplier_id = $2
     join hotel_room_types room
       on room.tenant_id = rate.tenant_id and room.hotel_id = rate.hotel_id
      and room.id = rate.room_type_id
     where rate.tenant_id = $1 and rate.hotel_supplier_id = any($3::uuid[])
     order by rate.valid_from desc, rate.rate_code, room.code`,
    [tenantId, supplierId, linkIds],
  )
  return result.rows.map(mapRate)
}

async function loadBasicRate(
  client: PoolClient,
  tenantId: string,
  supplierId: string,
  linkId: string,
  rateId: string,
  forUpdate = false,
): Promise<BasicRateRow | null> {
  const result = await client.query<BasicRateRow>(
    `select rate.*
     from hotel_supplier_rates rate
     join hotel_suppliers link
       on link.tenant_id = rate.tenant_id and link.id = rate.hotel_supplier_id
      and link.hotel_id = rate.hotel_id
     where rate.tenant_id = $1 and link.supplier_id = $2
       and rate.hotel_supplier_id = $3 and rate.id = $4
     ${forUpdate ? 'for update of rate' : ''}`,
    [tenantId, supplierId, linkId, rateId],
  )
  return result.rows[0] || null
}

async function requireHydratedLink(
  client: PoolClient,
  tenantId: string,
  supplierId: string,
  linkId: string,
): Promise<HotelSupplierLink> {
  const rows = await loadLinkRows(client, tenantId, supplierId, linkId)
  if (!rows[0]) throw linkNotFound()
  const rates = await loadRatesForLinks(client, tenantId, supplierId, [linkId])
  return hydrateLinks(rows, rates)[0]
}

async function requireHydratedRate(
  client: PoolClient,
  tenantId: string,
  supplierId: string,
  linkId: string,
  rateId: string,
): Promise<HotelSupplierRate> {
  const rates = await loadRatesForLinks(client, tenantId, supplierId, [linkId])
  const item = rates.find((rate) => rate.id === rateId)
  if (!item) throw rateNotFound()
  return item
}

function hydrateLinks(rows: LinkRow[], rates: HotelSupplierRate[]): HotelSupplierLink[] {
  const ratesByLink = new Map<string, HotelSupplierRate[]>()
  for (const rate of rates) {
    ratesByLink.set(rate.hotelSupplierId, [...(ratesByLink.get(rate.hotelSupplierId) || []), rate])
  }
  return rows.map((row) => ({
    id: row.id,
    supplierId: row.supplier_id,
    hotelId: row.hotel_id,
    hotel: {
      id: row.hotel_id,
      name: row.hotel_name,
      cityId: row.hotel_city_id,
      cityName: row.hotel_city_name,
      subdivisionCode: row.hotel_subdivision_code,
      countryCode: row.hotel_country_code,
      address: row.hotel_address,
      category: row.hotel_category,
      status: row.hotel_status,
    },
    propertyCode: row.supplier_property_code,
    reservationEmail: row.reservation_email,
    reservationPhone: row.reservation_phone,
    priority: Number(row.priority),
    billingEnabled: row.billing_enabled,
    paymentMethods: Array.isArray(row.payment_methods) ? row.payment_methods : [],
    commercialTerms: row.commercial_terms || {},
    validFrom: dateOnlyOrNull(row.valid_from),
    validUntil: dateOnlyOrNull(row.valid_until),
    outOfPeriodPolicy: row.out_of_period_policy,
    isActive: row.is_active,
    version: Number(row.version),
    roomTypes: mapRoomTypes(row.room_types),
    rates: ratesByLink.get(row.id) || [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }))
}

function mapRate(row: RateRow): HotelSupplierRate {
  const metadata = row.metadata || {}
  const nightlyAmount = Number(row.nightly_amount)
  return {
    id: row.id,
    hotelId: row.hotel_id,
    hotelSupplierId: row.hotel_supplier_id,
    roomTypeId: row.room_type_id,
    roomType: {
      id: row.room_type_id,
      code: row.room_code,
      name: row.room_name,
      occupancyType: row.occupancy_type,
      maxGuests: Number(row.max_guests),
      isActive: row.room_is_active,
    },
    code: row.rate_code,
    validFrom: dateOnly(row.valid_from),
    validUntil: dateOnly(row.valid_until),
    rackAmount: row.rack_amount == null ? null : Number(row.rack_amount),
    nightlyAmount,
    agreementAmount: nightlyAmount,
    taxAmount: Number(row.tax_amount),
    serviceFeeAmount: Number(row.service_fee_amount),
    currency: row.currency,
    isNet: row.is_net,
    isSuspended: row.is_suspended,
    isActive: row.is_active,
    refundable: row.refundable,
    mealPlan: row.meal_plan,
    cancellationPolicy: row.cancellation_policy,
    paymentTerms: typeof metadata.paymentTerms === 'string' ? metadata.paymentTerms : null,
    scopeType: row.scope_type,
    scopeTargets: mapScopeTargets(row.scope_targets),
    metadata,
    version: Number(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function mapRoomTypes(value: unknown): HotelSupplierRateRoomType[] {
  return Array.isArray(value) ? value as HotelSupplierRateRoomType[] : []
}

function mapScopeTargets(value: unknown): HotelSupplierRateScopeTarget[] {
  return Array.isArray(value) ? value as HotelSupplierRateScopeTarget[] : []
}

function metadataWithPaymentTerms(
  metadata: Record<string, unknown>,
  paymentTerms: string | null | undefined,
): Record<string, unknown> {
  const next = { ...metadata }
  if (paymentTerms) next.paymentTerms = paymentTerms
  else delete next.paymentTerms
  return next
}

function requiredNightlyAmount(input: {
  nightlyAmount?: number
  agreementAmount?: number
}): number {
  const amount = canonicalNightlyAmount(input)
  if (amount === undefined) {
    throw new HotelSupplierRateServiceError(
      'HOTEL_RATE_AMOUNT_REQUIRED',
      'Informe a tarifa acordo/noturna.',
      422,
    )
  }
  return amount
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function dateOnlyOrNull(value: string | Date | null): string | null {
  return value == null ? null : dateOnly(value)
}

function requireUuid(value: string, code: string, message: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HotelSupplierRateServiceError(code, message, 400)
  }
}

function linkNotFound(): HotelSupplierRateServiceError {
  return new HotelSupplierRateServiceError(
    'HOTEL_SUPPLIER_LINK_NOT_FOUND',
    'Vinculo entre fornecedor e hotel nao encontrado.',
    404,
  )
}

function rateNotFound(): HotelSupplierRateServiceError {
  return new HotelSupplierRateServiceError(
    'HOTEL_SUPPLIER_RATE_NOT_FOUND',
    'Tarifa hoteleira nao encontrada.',
    404,
  )
}

function staleLink(currentVersion: number): HotelSupplierRateServiceError {
  return new HotelSupplierRateServiceError(
    'STALE_HOTEL_SUPPLIER_LINK_VERSION',
    'O vinculo foi alterado por outro usuario. Atualize a pagina.',
    409,
    { currentVersion },
  )
}

function staleRate(currentVersion: number): HotelSupplierRateServiceError {
  return new HotelSupplierRateServiceError(
    'STALE_HOTEL_SUPPLIER_RATE_VERSION',
    'A tarifa foi alterada por outro usuario. Atualize a pagina.',
    409,
    { currentVersion },
  )
}

function translateDatabaseError(error: unknown): Error {
  if (error instanceof HotelSupplierRateServiceError) return error
  const code = databaseProperty(error, 'code')
  if (code === '23505') {
    return new HotelSupplierRateServiceError(
      'HOTEL_SUPPLIER_RATE_DUPLICATE',
      'Ja existe vinculo ou tarifa com a mesma chave de negocio.',
      409,
    )
  }
  if (code === '23503' || code === '23514' || code === '22P02') {
    return new HotelSupplierRateServiceError(
      'HOTEL_SUPPLIER_RATE_REFERENCE_INVALID',
      'O vinculo ou tarifa possui referencia invalida.',
      422,
      { constraint: databaseProperty(error, 'constraint') },
    )
  }
  return error instanceof Error ? error : new Error('Falha ao persistir vinculo/tarifa hoteleira.')
}

function databaseProperty(error: unknown, key: 'code' | 'constraint'): string | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

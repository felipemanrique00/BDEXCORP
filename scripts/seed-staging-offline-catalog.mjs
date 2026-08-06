import { createHash } from 'node:crypto'

import pg from 'pg'

const FIXTURE_KEY = 'staging_offline_catalog_v1'
const EXPECTED_APP_URL = 'https://staging.bdextravel.com.br'
const EXPECTED_CONFIRMATION = 'bdex-homologacao:offline-catalog'
const EXPECTED_DATABASE_HOST = 'staging_postgres'
const EXPECTED_DATABASE_PORT = '5432'
const EXPECTED_DATABASE_NAME = 'bbt_corporativo_staging'
const EXPECTED_DATABASE_USER = 'bbt_staging_admin'
const REQUIRED_MIGRATION = '0068_commercial_supplier_offline_catalog.sql'

const TARGET = Object.freeze({
  tenantId: 'fa5fe929-fa02-4d84-8d07-3f04882a978d',
  tenantSlug: 'bdex-homologacao',
  companyId: 'emp-cfc5d0d0-8732-4a44-953c-cc4c9a0ff832',
  companyName: 'QA EMPRESA HOMOLOGACAO',
  groupId: 'grp-819fc4c3-2b88-4600-8f1f-c65a331bad02',
  groupName: 'QA GRUPO HOMOLOGACAO',
})

const SUPPLIER = Object.freeze({
  id: stableUuid(`${FIXTURE_KEY}:supplier`),
  code: 'STG-HOTEL-FICTICIO',
  name: 'Fornecedor Ficticio de Homologacao',
})

const GEOGRAPHY = Object.freeze({
  country: Object.freeze({
    code: 'BR',
    normalizedName: 'brasil',
    provider: 'ibge',
    providerId: '076',
  }),
  subdivision: Object.freeze({
    id: stableUuid(`${FIXTURE_KEY}:geo:subdivision:BR-RJ`),
    code: 'RJ',
    name: 'Rio de Janeiro',
    normalizedName: 'rio de janeiro',
    provider: 'ibge',
    providerId: '33',
  }),
  city: Object.freeze({
    id: stableUuid(`${FIXTURE_KEY}:geo:city:3304557`),
    name: 'Rio de Janeiro',
    normalizedName: 'rio de janeiro',
    provider: 'ibge',
    providerId: '3304557',
    timezone: 'America/Sao_Paulo',
  }),
})

const ROOM_TYPES = Object.freeze([
  {
    code: 'SGL-CM',
    name: 'Single Standard com Cafe da Manha',
    occupancyType: 'single',
    maxGuests: 1,
    maxAdults: 1,
    maxChildren: 0,
    bedConfiguration: '1 cama (configuracao ficticia)',
  },
  {
    code: 'DBL-CM',
    name: 'Double Standard com Cafe da Manha',
    occupancyType: 'double',
    maxGuests: 2,
    maxAdults: 2,
    maxChildren: 0,
    bedConfiguration: '1 cama de casal ou 2 camas (configuracao ficticia)',
  },
])

const HOTELS = Object.freeze([
  {
    id: 'hotel_staging_fixture_rio_centro_v1',
    name: 'Hotel Ficticio Homologacao Rio Centro',
    address: 'Endereco ficticio para homologacao - Centro, Rio de Janeiro/RJ',
    category: 'Standard com Cafe da Manha',
    propertyCode: 'STG-RIO-CENTRO',
  },
  {
    id: 'hotel_staging_fixture_rio_copacabana_v1',
    name: 'Hotel Ficticio Homologacao Rio Copacabana',
    address: 'Endereco ficticio para homologacao - Copacabana, Rio de Janeiro/RJ',
    category: 'Standard com Cafe da Manha',
    propertyCode: 'STG-RIO-COPACABANA',
  },
])

const RATES = Object.freeze([
  {
    id: stableUuid(`${FIXTURE_KEY}:rate:global`),
    hotelIndex: 0,
    roomCode: 'SGL-CM',
    code: 'STG-QA-GLOBAL-SGL',
    nightlyAmount: '350.00',
    taxAmount: '35.00',
    scopeType: 'global',
  },
  {
    id: stableUuid(`${FIXTURE_KEY}:rate:restricted`),
    hotelIndex: 1,
    roomCode: 'SGL-CM',
    code: 'STG-QA-RESTRITA-SGL',
    nightlyAmount: '465.00',
    taxAmount: '46.50',
    scopeType: 'restricted',
  },
])

async function main() {
  const connectionString = requireStagingRuntime()
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    application_name: 'bdex-staging-offline-catalog-fixture',
  })
  const client = await pool.connect()

  try {
    await client.query('begin')
    await client.query("set local lock_timeout = '10s'")
    await client.query("set local statement_timeout = '60s'")
    await requireMigration(client)
    await client.query(`select set_config('app.tenant_id', $1, true)`, [TARGET.tenantId])
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      `${FIXTURE_KEY}:${TARGET.tenantId}`,
    ])
    const context = await requireTargetContext(client)

    const supplier = await upsertSupplier(client, context)
    const hotels = []
    for (const hotel of HOTELS) {
      hotels.push(await upsertHotel(client, context, supplier, hotel))
    }

    for (const rate of RATES) {
      const hotel = hotels[rate.hotelIndex]
      const roomTypeId = hotel.roomTypeIds.get(rate.roomCode)
      await upsertRate(client, context, hotel, roomTypeId, rate)
    }

    await client.query('set constraints all immediate')
    const summary = await validateFixture(client, context)
    await client.query('commit')

    console.log(JSON.stringify({
      ok: true,
      fixtureCounts: {
        hotels: summary.hotels,
        suppliers: 1,
        rates: summary.rates,
        roomTypes: summary.roomTypes,
      },
    }))
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // Preserva a falha original.
    }
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

function requireStagingRuntime() {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production') {
    throw new Error('seed recusado: NODE_ENV deve ser production')
  }
  if (String(process.env.APP_ENVIRONMENT || '').trim().toLowerCase() !== 'staging') {
    throw new Error('seed recusado: APP_ENVIRONMENT deve ser staging')
  }
  const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '')
  if (appUrl !== EXPECTED_APP_URL) {
    throw new Error(`seed recusado: APP_URL deve ser ${EXPECTED_APP_URL}`)
  }
  if (String(process.env.STAGING_OFFLINE_CATALOG_SEED_CONFIRM || '').trim() !== EXPECTED_CONFIRMATION) {
    throw new Error(`seed recusado: confirme com STAGING_OFFLINE_CATALOG_SEED_CONFIRM=${EXPECTED_CONFIRMATION}`)
  }
  const connectionString = String(process.env.MIGRATION_DATABASE_URL || '').trim()
  if (!connectionString) {
    throw new Error('seed recusado: MIGRATION_DATABASE_URL obrigatoria')
  }
  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error('seed recusado: MIGRATION_DATABASE_URL invalida')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('seed recusado: MIGRATION_DATABASE_URL deve usar PostgreSQL')
  }
  const databasePort = parsed.port || '5432'
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const databaseUser = decodeURIComponent(parsed.username)
  if (parsed.hostname.toLowerCase() !== EXPECTED_DATABASE_HOST
    || databasePort !== EXPECTED_DATABASE_PORT
    || databaseName !== EXPECTED_DATABASE_NAME
    || databaseUser !== EXPECTED_DATABASE_USER) {
    throw new Error(
      `seed recusado: MIGRATION_DATABASE_URL deve apontar para ${EXPECTED_DATABASE_USER}`
      + `@${EXPECTED_DATABASE_HOST}:${EXPECTED_DATABASE_PORT}/${EXPECTED_DATABASE_NAME}`,
    )
  }
  return connectionString
}

async function requireMigration(client) {
  const result = await client.query(
    'select 1 from schema_migrations where name = $1',
    [REQUIRED_MIGRATION],
  )
  if (result.rowCount !== 1) {
    throw new Error(`seed recusado: migration obrigatoria ausente (${REQUIRED_MIGRATION})`)
  }
}

async function requireTargetContext(client) {
  const tenantResult = await client.query(
    `select id, slug::text, name
       from tenants
      where id = $1::uuid and slug = $2 and status = 'active'`,
    [TARGET.tenantId, TARGET.tenantSlug],
  )
  if (tenantResult.rowCount !== 1) throw new Error('seed recusado: tenant de homologacao nao corresponde a allowlist')

  const groupResult = await client.query(
    `select id, name
       from business_groups
      where tenant_id = $1 and id = $2 and name = $3
        and status = 'active' and deleted_at is null`,
    [TARGET.tenantId, TARGET.groupId, TARGET.groupName],
  )
  if (groupResult.rowCount !== 1) throw new Error('seed recusado: grupo QA nao corresponde a allowlist')

  const companyResult = await client.query(
    `select id, group_id, coalesce(trade_name, legal_name) as name
       from companies
      where tenant_id = $1 and id = $2
        and coalesce(trade_name, legal_name) = $3
        and group_id = $4 and status = 'active' and deleted_at is null`,
    [TARGET.tenantId, TARGET.companyId, TARGET.companyName, TARGET.groupId],
  )
  if (companyResult.rowCount !== 1) throw new Error('seed recusado: empresa QA nao corresponde a allowlist')

  const actorResult = await client.query(
    `select user_row.id
       from users user_row
       join tenant_memberships membership on membership.user_id = user_row.id
       join roles role_row on role_row.id = membership.role_id
      where membership.tenant_id = $1 and membership.status = 'active'
        and role_row.role_key = 'tenant_admin'
        and user_row.platform_admin and user_row.status = 'active'
        and user_row.deleted_at is null
      order by user_row.id
      limit 1`,
    [TARGET.tenantId],
  )
  if (actorResult.rowCount !== 1) throw new Error('seed recusado: exige ao menos um tenant_admin platform_admin ativo')

  const geography = await ensureRioGeography(client)

  return {
    tenant: tenantResult.rows[0],
    company: companyResult.rows[0],
    group: groupResult.rows[0],
    actorUserId: actorResult.rows[0].id,
    geography,
  }
}

async function ensureRioGeography(client) {
  await client.query(
    `select pg_advisory_xact_lock(hashtext('bbt:geography:ibge'))`,
  )
  const countryResult = await client.query(
    `select id, upper(iso_alpha2::text) as country_code, normalized_name,
            provider, provider_id
       from geo_countries
      where upper(iso_alpha2::text) = $1 and is_active
      for update`,
    [GEOGRAPHY.country.code],
  )
  if (countryResult.rowCount !== 1) {
    throw new Error('seed recusado: pais Brasil ativo nao encontrado de forma univoca')
  }
  const country = countryResult.rows[0]
  if (country.normalized_name !== GEOGRAPHY.country.normalizedName
    || country.provider !== GEOGRAPHY.country.provider
    || country.provider_id !== GEOGRAPHY.country.providerId) {
    throw new Error('seed recusado: referencia existente do Brasil e incompativel')
  }

  const subdivisionResult = await client.query(
    `select id, country_id, upper(code::text) as code, name, normalized_name,
            subdivision_type, provider, provider_id, is_active
       from geo_subdivisions
      where id = $1::uuid
         or (country_id = $2::uuid and upper(code::text) = $3)
         or (provider = $4 and provider_id = $5)
      for update`,
    [
      GEOGRAPHY.subdivision.id,
      country.id,
      GEOGRAPHY.subdivision.code,
      GEOGRAPHY.subdivision.provider,
      GEOGRAPHY.subdivision.providerId,
    ],
  )
  if (subdivisionResult.rowCount > 1) {
    throw new Error('seed recusado: referencias conflitantes para o estado RJ')
  }
  let subdivision = subdivisionResult.rows[0]
  if (subdivision) {
    if (subdivision.country_id !== country.id
      || subdivision.code !== GEOGRAPHY.subdivision.code
      || subdivision.name !== GEOGRAPHY.subdivision.name
      || subdivision.normalized_name !== GEOGRAPHY.subdivision.normalizedName
      || subdivision.subdivision_type !== 'state'
      || subdivision.provider !== GEOGRAPHY.subdivision.provider
      || subdivision.provider_id !== GEOGRAPHY.subdivision.providerId
      || !subdivision.is_active) {
      throw new Error('seed recusado: referencia existente do estado RJ e incompativel')
    }
  } else {
    const inserted = await client.query(
      `insert into geo_subdivisions (
         id, country_id, code, name, normalized_name, subdivision_type,
         provider, provider_id, dataset_version_id, is_active
       ) values (
         $1::uuid, $2::uuid, $3, $4, $5, 'state',
         $6, $7, null, true
       )
       returning id, country_id, upper(code::text) as code, name,
                 normalized_name, subdivision_type, provider, provider_id, is_active`,
      [
        GEOGRAPHY.subdivision.id,
        country.id,
        GEOGRAPHY.subdivision.code,
        GEOGRAPHY.subdivision.name,
        GEOGRAPHY.subdivision.normalizedName,
        GEOGRAPHY.subdivision.provider,
        GEOGRAPHY.subdivision.providerId,
      ],
    )
    subdivision = inserted.rows[0]
  }

  const cityResult = await client.query(
    `select id, country_id, subdivision_id, name, normalized_name,
            provider, provider_id, is_active
       from geo_cities
      where id = $1::uuid
         or (country_id = $2::uuid and subdivision_id = $3::uuid
           and normalized_name = $4)
         or (provider = $5 and provider_id = $6)
      for update`,
    [
      GEOGRAPHY.city.id,
      country.id,
      subdivision.id,
      GEOGRAPHY.city.normalizedName,
      GEOGRAPHY.city.provider,
      GEOGRAPHY.city.providerId,
    ],
  )
  if (cityResult.rowCount > 1) {
    throw new Error('seed recusado: referencias conflitantes para a cidade Rio de Janeiro')
  }
  let city = cityResult.rows[0]
  if (city) {
    if (city.country_id !== country.id || city.subdivision_id !== subdivision.id
      || city.name !== GEOGRAPHY.city.name
      || city.normalized_name !== GEOGRAPHY.city.normalizedName
      || city.provider !== GEOGRAPHY.city.provider
      || city.provider_id !== GEOGRAPHY.city.providerId
      || !city.is_active) {
      throw new Error('seed recusado: referencia existente da cidade Rio de Janeiro e incompativel')
    }
  } else {
    const inserted = await client.query(
      `insert into geo_cities (
         id, country_id, subdivision_id, name, normalized_name,
         provider, provider_id, dataset_version_id, timezone, is_active
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4, $5,
         $6, $7, null, $8, true
       )
       returning id, country_id, subdivision_id, name, normalized_name,
                 provider, provider_id, is_active`,
      [
        GEOGRAPHY.city.id,
        country.id,
        subdivision.id,
        GEOGRAPHY.city.name,
        GEOGRAPHY.city.normalizedName,
        GEOGRAPHY.city.provider,
        GEOGRAPHY.city.providerId,
        GEOGRAPHY.city.timezone,
      ],
    )
    city = inserted.rows[0]
  }

  return {
    country_id: country.id,
    country_code: country.country_code,
    subdivision_id: subdivision.id,
    subdivision_code: subdivision.code,
    city_id: city.id,
    city_name: city.name,
  }
}

async function upsertSupplier(client, context) {
  const collision = await client.query(
    `select id, tenant_id, internal_code::text, metadata->>'fixture' as fixture
       from commercial_suppliers
      where id = $1::uuid or (tenant_id = $2 and internal_code = $3)
      for update`,
    [SUPPLIER.id, context.tenant.id, SUPPLIER.code],
  )
  for (const row of collision.rows) {
    if (row.id !== SUPPLIER.id || row.tenant_id !== context.tenant.id
      || row.internal_code !== SUPPLIER.code || row.fixture !== FIXTURE_KEY) {
      throw new Error('seed recusado: colisao com fornecedor que nao pertence a fixture')
    }
  }

  await client.query(
    `insert into commercial_suppliers (
       id, tenant_id, internal_code, legal_name, trade_name, document_type,
       document_number, service_types, address_id, integration_provider_id,
       website, notes, status, payment_terms, metadata, reservation_system,
       created_by, updated_by
     ) values (
       $1::uuid, $2, $3, $4, $4, 'other', null, array['hotel']::text[],
       null, null, null, $5, 'active', '{}'::jsonb, $6::jsonb, 'manual', $7, $7
     )
     on conflict (id) do update set
       internal_code = excluded.internal_code, legal_name = excluded.legal_name,
       trade_name = excluded.trade_name, document_type = 'other', document_number = null,
       service_types = array['hotel']::text[], address_id = null,
       integration_provider_id = null, website = null, notes = excluded.notes,
       status = 'active', payment_terms = '{}'::jsonb, metadata = excluded.metadata,
       reservation_system = 'manual', deleted_at = null,
       version = commercial_suppliers.version + 1,
       updated_by = excluded.updated_by, updated_at = now()
     where commercial_suppliers.tenant_id = excluded.tenant_id
       and commercial_suppliers.metadata->>'fixture' = $8
       and row(
         commercial_suppliers.internal_code::text,
         commercial_suppliers.legal_name,
         commercial_suppliers.trade_name,
         commercial_suppliers.document_type,
         commercial_suppliers.document_number,
         commercial_suppliers.service_types,
         commercial_suppliers.address_id,
         commercial_suppliers.integration_provider_id,
         commercial_suppliers.website,
         commercial_suppliers.notes,
         commercial_suppliers.status,
         commercial_suppliers.payment_terms,
         commercial_suppliers.metadata,
         commercial_suppliers.reservation_system,
         commercial_suppliers.deleted_at
       ) is distinct from row(
         excluded.internal_code::text,
         excluded.legal_name,
         excluded.trade_name,
         'other',
         null,
         array['hotel']::text[],
         null,
         null,
         null,
         excluded.notes,
         'active',
         '{}'::jsonb,
         excluded.metadata,
         'manual',
         null
       )`,
    [
      SUPPLIER.id,
      context.tenant.id,
      SUPPLIER.code,
      SUPPLIER.name,
      'Registro exclusivamente ficticio para homologacao do fluxo offline.',
      JSON.stringify({ fixture: FIXTURE_KEY, fictional: true }),
      context.actorUserId,
      FIXTURE_KEY,
    ],
  )
  return { id: SUPPLIER.id }
}

async function upsertHotel(client, context, supplier, hotel) {
  const existing = await client.query(
    `select id, tenant_id, source
       from hotels
      where id = $1
         or (tenant_id = $2 and city_id = $3::uuid and normalized_name = $4)
      for update`,
    [hotel.id, context.tenant.id, context.geography.city_id, normalizeName(hotel.name)],
  )
  for (const row of existing.rows) {
    if (row.id !== hotel.id || row.tenant_id !== context.tenant.id || row.source !== 'staging_fixture') {
      throw new Error(`seed recusado: colisao com hotel que nao pertence a fixture (${hotel.id})`)
    }
  }

  await client.query(
    `insert into hotels (
       id, tenant_id, name, normalized_name, country, state, city,
       country_id, subdivision_id, city_id, address, category,
       billing_enabled, billing_info, amenities, status, source,
       chain_name, brand_name, star_rating, created_by, updated_by
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10::uuid,
       $11, $12, false, null, '{}'::jsonb, 'active', 'staging_fixture',
       null, null, 3, $13, $13
     )
     on conflict (id) do update set
       name = excluded.name, normalized_name = excluded.normalized_name,
       country = excluded.country, state = excluded.state, city = excluded.city,
       country_id = excluded.country_id, subdivision_id = excluded.subdivision_id,
       city_id = excluded.city_id, address = excluded.address, category = excluded.category,
       billing_enabled = false, billing_info = null, amenities = '{}'::jsonb,
       status = 'active', source = 'staging_fixture', chain_name = null,
       brand_name = null, star_rating = 3, deleted_at = null,
       version = hotels.version + 1, updated_by = excluded.updated_by, updated_at = now()
     where hotels.tenant_id = excluded.tenant_id and hotels.source = 'staging_fixture'
       and row(
         hotels.name, hotels.normalized_name, hotels.country, hotels.state,
         hotels.city, hotels.country_id, hotels.subdivision_id, hotels.city_id,
         hotels.address, hotels.category, hotels.billing_enabled,
         hotels.billing_info, hotels.amenities, hotels.status, hotels.source,
         hotels.chain_name, hotels.brand_name, hotels.star_rating,
         hotels.deleted_at
       ) is distinct from row(
         excluded.name, excluded.normalized_name, excluded.country, excluded.state,
         excluded.city, excluded.country_id, excluded.subdivision_id, excluded.city_id,
         excluded.address, excluded.category, false,
         null, '{}'::jsonb, 'active', 'staging_fixture',
         null, null, 3, null
       )`,
    [
      hotel.id,
      context.tenant.id,
      hotel.name,
      normalizeName(hotel.name),
      context.geography.country_code,
      context.geography.subdivision_code,
      context.geography.city_name,
      context.geography.country_id,
      context.geography.subdivision_id,
      context.geography.city_id,
      hotel.address,
      hotel.category,
      context.actorUserId,
    ],
  )

  const roomTypeIds = new Map()
  for (const room of ROOM_TYPES) {
    const id = stableUuid(`${FIXTURE_KEY}:room:${hotel.id}:${room.code}`)
    await assertRoomTypeIdentity(client, id, context.tenant.id, hotel.id)
    await client.query(
      `insert into hotel_room_types (
         id, tenant_id, hotel_id, code, name, occupancy_type,
         max_guests, max_adults, max_children, bed_configuration,
         amenities, is_active, created_by, updated_by
       ) values (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11::jsonb, true, $12, $12
       )
       on conflict (id) do update set
         code = excluded.code, name = excluded.name,
         occupancy_type = excluded.occupancy_type, max_guests = excluded.max_guests,
         max_adults = excluded.max_adults, max_children = excluded.max_children,
         bed_configuration = excluded.bed_configuration, amenities = excluded.amenities,
         is_active = true, deleted_at = null, version = hotel_room_types.version + 1,
         updated_by = excluded.updated_by, updated_at = now()
       where hotel_room_types.tenant_id = excluded.tenant_id
         and hotel_room_types.hotel_id = excluded.hotel_id
         and hotel_room_types.amenities->>'fixture' = $13
         and row(
           hotel_room_types.code, hotel_room_types.name, hotel_room_types.occupancy_type,
           hotel_room_types.max_guests, hotel_room_types.max_adults,
           hotel_room_types.max_children, hotel_room_types.bed_configuration,
           hotel_room_types.amenities, hotel_room_types.is_active,
           hotel_room_types.deleted_at
         ) is distinct from row(
           excluded.code, excluded.name, excluded.occupancy_type,
           excluded.max_guests, excluded.max_adults,
           excluded.max_children, excluded.bed_configuration,
           excluded.amenities, true, null
         )`,
      [
        id, context.tenant.id, hotel.id, room.code, room.name, room.occupancyType,
        room.maxGuests, room.maxAdults, room.maxChildren, room.bedConfiguration,
        JSON.stringify({ fixture: FIXTURE_KEY, fictional: true }),
        context.actorUserId,
        FIXTURE_KEY,
      ],
    )
    roomTypeIds.set(room.code, id)
  }

  const linkId = stableUuid(`${FIXTURE_KEY}:link:${hotel.id}:${supplier.id}`)
  await assertHotelSupplierIdentity(
    client,
    linkId,
    context.tenant.id,
    hotel.id,
    supplier.id,
  )
  await client.query(
    `insert into hotel_suppliers (
       id, tenant_id, hotel_id, supplier_id, supplier_property_code,
       priority, billing_enabled, payment_methods, commercial_terms,
       is_active, out_of_period_policy, created_by, updated_by
     ) values (
       $1::uuid, $2, $3, $4::uuid, $5, 10, false, '{}'::text[],
       $6::jsonb, true, 'allow', $7, $7
     )
     on conflict (id) do update set
       supplier_id = excluded.supplier_id,
       supplier_property_code = excluded.supplier_property_code,
       priority = 10, billing_enabled = false, payment_methods = '{}'::text[],
       commercial_terms = excluded.commercial_terms, is_active = true,
       out_of_period_policy = 'allow', ended_at = null,
       version = hotel_suppliers.version + 1,
       updated_by = excluded.updated_by, updated_at = now()
     where hotel_suppliers.tenant_id = excluded.tenant_id
       and hotel_suppliers.hotel_id = excluded.hotel_id
       and hotel_suppliers.supplier_id = excluded.supplier_id
       and hotel_suppliers.commercial_terms->>'fixture' = $8
       and row(
         hotel_suppliers.supplier_property_code, hotel_suppliers.priority,
         hotel_suppliers.billing_enabled, hotel_suppliers.payment_methods,
         hotel_suppliers.commercial_terms, hotel_suppliers.is_active,
         hotel_suppliers.out_of_period_policy, hotel_suppliers.ended_at
       ) is distinct from row(
         excluded.supplier_property_code, 10,
         false, '{}'::text[],
         excluded.commercial_terms, true,
         'allow', null
       )`,
    [
      linkId,
      context.tenant.id,
      hotel.id,
      supplier.id,
      hotel.propertyCode,
      JSON.stringify({ fixture: FIXTURE_KEY, fictional: true }),
      context.actorUserId,
      FIXTURE_KEY,
    ],
  )

  return { id: hotel.id, linkId, roomTypeIds }
}

async function upsertRate(client, context, hotel, roomTypeId, rate) {
  await assertRateIdentity(
    client,
    rate.id,
    context.tenant.id,
    hotel.id,
    hotel.linkId,
    roomTypeId,
  )
  const naturalCollision = await client.query(
    `select id
       from hotel_supplier_rates
      where tenant_id = $1 and hotel_supplier_id = $2::uuid
        and room_type_id = $3::uuid and rate_code = $4 and valid_from = date '2026-01-01'
        and id <> $5::uuid`,
    [context.tenant.id, hotel.linkId, roomTypeId, rate.code, rate.id],
  )
  if (naturalCollision.rowCount) throw new Error(`seed recusado: colisao de chave natural da tarifa ${rate.code}`)

  await client.query(
    `insert into hotel_supplier_rates (
       id, tenant_id, hotel_id, hotel_supplier_id, room_type_id, rate_code,
       valid_from, valid_until, rack_amount, nightly_amount, tax_amount,
       service_fee_amount, currency, is_net, is_suspended, refundable,
       meal_plan, cancellation_policy, scope_type, metadata, is_active,
       created_by, updated_by
     ) values (
       $1::uuid, $2, $3, $4::uuid, $5::uuid, $6,
       date '2026-01-01', date '2099-12-31', $7::numeric, $8::numeric, $9::numeric,
       0, 'BRL', false, false, true, 'Cafe da Manha',
       'Cancelamento sem custo ate 24 horas antes do check-in (fixture ficticia).',
       $10, $11::jsonb, true, $12, $12
     )
     on conflict (id) do update set
       hotel_id = excluded.hotel_id, hotel_supplier_id = excluded.hotel_supplier_id,
       room_type_id = excluded.room_type_id, rate_code = excluded.rate_code,
       valid_from = excluded.valid_from, valid_until = excluded.valid_until,
       rack_amount = excluded.rack_amount, nightly_amount = excluded.nightly_amount,
       tax_amount = excluded.tax_amount, service_fee_amount = 0, currency = 'BRL',
       is_net = false, is_suspended = false, refundable = true,
       meal_plan = excluded.meal_plan, cancellation_policy = excluded.cancellation_policy,
       scope_type = excluded.scope_type, metadata = excluded.metadata, is_active = true,
       version = hotel_supplier_rates.version + 1,
       updated_by = excluded.updated_by, updated_at = now()
     where hotel_supplier_rates.tenant_id = excluded.tenant_id
       and hotel_supplier_rates.metadata->>'fixture' = $13
       and row(
         hotel_supplier_rates.hotel_id, hotel_supplier_rates.hotel_supplier_id,
         hotel_supplier_rates.room_type_id, hotel_supplier_rates.rate_code,
         hotel_supplier_rates.valid_from, hotel_supplier_rates.valid_until,
         hotel_supplier_rates.rack_amount, hotel_supplier_rates.nightly_amount,
         hotel_supplier_rates.tax_amount, hotel_supplier_rates.service_fee_amount,
         hotel_supplier_rates.currency, hotel_supplier_rates.is_net,
         hotel_supplier_rates.is_suspended, hotel_supplier_rates.refundable,
         hotel_supplier_rates.meal_plan, hotel_supplier_rates.cancellation_policy,
         hotel_supplier_rates.scope_type, hotel_supplier_rates.metadata,
         hotel_supplier_rates.is_active
       ) is distinct from row(
         excluded.hotel_id, excluded.hotel_supplier_id,
         excluded.room_type_id, excluded.rate_code,
         excluded.valid_from, excluded.valid_until,
         excluded.rack_amount, excluded.nightly_amount,
         excluded.tax_amount, 0::numeric,
         'BRL', false,
         false, true,
         excluded.meal_plan, excluded.cancellation_policy,
         excluded.scope_type, excluded.metadata,
         true
       )`,
    [
      rate.id,
      context.tenant.id,
      hotel.id,
      hotel.linkId,
      roomTypeId,
      rate.code,
      rate.nightlyAmount,
      rate.nightlyAmount,
      rate.taxAmount,
      rate.scopeType,
      JSON.stringify({ fixture: FIXTURE_KEY, fictional: true }),
      context.actorUserId,
      FIXTURE_KEY,
    ],
  )

  if (rate.scopeType === 'restricted') {
    await upsertScope(client, context, rate.id, 'company', TARGET.companyId)
    await upsertScope(client, context, rate.id, 'group', TARGET.groupId)
  }
}

async function upsertScope(client, context, rateId, type, targetId) {
  const id = stableUuid(`${FIXTURE_KEY}:scope:${rateId}:${type}:${targetId}`)
  const companyId = type === 'company' ? targetId : null
  const groupId = type === 'group' ? targetId : null
  const existing = await client.query(
    `select id, tenant_id, rate_id, scope_type, company_id, business_group_id
       from hotel_supplier_rate_scopes
      where id = $1::uuid
         or (tenant_id = $2 and rate_id = $3::uuid
           and (($4 = 'company' and company_id = $5)
             or ($4 = 'group' and business_group_id = $6)))
      for update`,
    [id, context.tenant.id, rateId, type, companyId, groupId],
  )
  for (const row of existing.rows) {
    if (row.id !== id || row.tenant_id !== context.tenant.id || row.rate_id !== rateId
      || row.scope_type !== type || row.company_id !== companyId || row.business_group_id !== groupId) {
      throw new Error(`seed recusado: colisao no escopo ${type}`)
    }
  }
  await client.query(
    `insert into hotel_supplier_rate_scopes (
       id, tenant_id, rate_id, scope_type, company_id, business_group_id,
       created_by, updated_by
     ) values ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $7)
     on conflict (id) do update set
       deleted_at = null, version = hotel_supplier_rate_scopes.version + 1,
       updated_by = excluded.updated_by, updated_at = now()
     where hotel_supplier_rate_scopes.deleted_at is not null`,
    [id, context.tenant.id, rateId, type, companyId, groupId, context.actorUserId],
  )
}

async function assertRoomTypeIdentity(client, id, tenantId, hotelId) {
  const result = await client.query(
    `select tenant_id, hotel_id, amenities->>'fixture' as fixture
       from hotel_room_types
      where id = $1::uuid
      for update`,
    [id],
  )
  if (result.rows[0]
    && (result.rows[0].tenant_id !== tenantId || result.rows[0].hotel_id !== hotelId
      || result.rows[0].fixture !== FIXTURE_KEY)) {
    throw new Error('seed recusado: colisao de UUID em hotel_room_types')
  }
}

async function assertHotelSupplierIdentity(client, id, tenantId, hotelId, supplierId) {
  const result = await client.query(
    `select tenant_id, hotel_id, supplier_id, commercial_terms->>'fixture' as fixture
       from hotel_suppliers
      where id = $1::uuid
      for update`,
    [id],
  )
  if (result.rows[0]
    && (result.rows[0].tenant_id !== tenantId || result.rows[0].hotel_id !== hotelId
      || result.rows[0].supplier_id !== supplierId
      || result.rows[0].fixture !== FIXTURE_KEY)) {
    throw new Error('seed recusado: colisao de UUID em hotel_suppliers')
  }
}

async function assertRateIdentity(
  client,
  id,
  tenantId,
  hotelId,
  hotelSupplierId,
  roomTypeId,
) {
  const result = await client.query(
    `select tenant_id, hotel_id, hotel_supplier_id, room_type_id,
            metadata->>'fixture' as fixture
       from hotel_supplier_rates
      where id = $1::uuid
      for update`,
    [id],
  )
  if (result.rows[0]
    && (result.rows[0].tenant_id !== tenantId || result.rows[0].hotel_id !== hotelId
      || result.rows[0].hotel_supplier_id !== hotelSupplierId
      || result.rows[0].room_type_id !== roomTypeId
      || result.rows[0].fixture !== FIXTURE_KEY)) {
    throw new Error('seed recusado: colisao de UUID em hotel_supplier_rates')
  }
}

async function validateFixture(client, context) {
  const supplier = await client.query(
    `select count(*)::integer as count
       from commercial_suppliers supplier
      where supplier.id = $1::uuid and supplier.tenant_id = $2
        and supplier.internal_code = $3 and supplier.status = 'active'
        and supplier.deleted_at is null and supplier.document_number is null
        and supplier.address_id is null and supplier.website is null
        and supplier.service_types @> array['hotel']::text[]
        and supplier.metadata->>'fixture' = $4
        and not exists (
          select 1 from commercial_supplier_contacts contact
           where contact.tenant_id = supplier.tenant_id and contact.supplier_id = supplier.id
        )`,
    [SUPPLIER.id, context.tenant.id, SUPPLIER.code, FIXTURE_KEY],
  )
  const hotels = await client.query(
    `select count(distinct hotel.id)::integer as hotels,
            count(distinct link.id)::integer as links,
            count(distinct room.id)::integer as room_types
       from hotels hotel
       join hotel_suppliers link
         on link.tenant_id = hotel.tenant_id and link.hotel_id = hotel.id
        and link.supplier_id = $1::uuid and link.is_active and link.ended_at is null
       join hotel_room_types room
         on room.tenant_id = hotel.tenant_id and room.hotel_id = hotel.id
        and room.is_active and room.deleted_at is null
      where hotel.tenant_id = $2 and hotel.id = any($3::text[])
        and hotel.source = 'staging_fixture' and hotel.status = 'active'
        and hotel.deleted_at is null and hotel.city_id = $4::uuid`,
    [SUPPLIER.id, context.tenant.id, HOTELS.map((hotel) => hotel.id), context.geography.city_id],
  )
  const rates = await client.query(
    `select count(*)::integer as rates,
            count(*) filter (where scope_type = 'global')::integer as global_rates,
            count(*) filter (where scope_type = 'restricted')::integer as restricted_rates
       from hotel_supplier_rates
      where tenant_id = $1 and id = any($2::uuid[])
        and metadata->>'fixture' = $3 and is_active and not is_suspended`,
    [context.tenant.id, RATES.map((rate) => rate.id), FIXTURE_KEY],
  )
  const scopes = await client.query(
    `select count(*)::integer as scopes,
            count(*) filter (where scope_type = 'company' and company_id = $3)::integer as company_scopes,
            count(*) filter (where scope_type = 'group' and business_group_id = $4)::integer as group_scopes
       from hotel_supplier_rate_scopes
      where tenant_id = $1 and rate_id = $2::uuid and deleted_at is null`,
    [context.tenant.id, RATES[1].id, TARGET.companyId, TARGET.groupId],
  )
  const globalScopes = await client.query(
    `select count(*)::integer as count
       from hotel_supplier_rate_scopes
      where tenant_id = $1 and rate_id = $2::uuid and deleted_at is null`,
    [context.tenant.id, RATES[0].id],
  )

  const hotelRow = hotels.rows[0]
  const rateRow = rates.rows[0]
  const scopeRow = scopes.rows[0]
  if (supplier.rows[0]?.count !== 1
    || hotelRow?.hotels !== 2 || hotelRow?.links !== 2 || hotelRow?.room_types !== 4
    || rateRow?.rates !== 2 || rateRow?.global_rates !== 1 || rateRow?.restricted_rates !== 1
    || scopeRow?.scopes !== 2 || scopeRow?.company_scopes !== 1 || scopeRow?.group_scopes !== 1
    || globalScopes.rows[0]?.count !== 0) {
    throw new Error('fixture de staging nao passou pela validacao pos-gravacao')
  }
  return {
    hotels: hotelRow.hotels,
    supplierLinks: hotelRow.links,
    roomTypes: hotelRow.room_types,
    rates: rateRow.rates,
    restrictedScopes: scopeRow.scopes,
  }
}

function normalizeName(value) {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function stableUuid(seed) {
  const bytes = createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

import { randomUUID } from 'node:crypto'

import pg from 'pg'

const LOCAL_DATABASE_NAME = 'bdex_gap_closure'
const LOCAL_DATABASE_PORT = '55433'
const TENANT_SLUG = 'cost-centers-local'
const SUPPLIER_CODE = 'HOTEL-DEMO-OFFLINE'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const HOTELS = Object.freeze([
  {
    id: 'hotel_local_rio_centro_20260805',
    name: 'Hotel Homologacao Local Rio Centro',
    address: 'Avenida Rio Branco, 100 - Centro, Rio de Janeiro/RJ',
    category: 'Executivo',
    supplierPropertyCode: 'LOCAL-RIO-CENTRO',
  },
  {
    id: 'hotel_local_rio_copacabana_20260805',
    name: 'Hotel Homologacao Local Rio Copacabana',
    address: 'Avenida Atlantica, 1000 - Copacabana, Rio de Janeiro/RJ',
    category: 'Executivo',
    supplierPropertyCode: 'LOCAL-RIO-COPACABANA',
  },
])

const ROOM_TYPES = Object.freeze([
  {
    code: 'SGL',
    name: 'Single com cafe da manha',
    occupancyType: 'single',
    maxGuests: 1,
    maxAdults: 1,
    maxChildren: 0,
    bedConfiguration: '1 cama de casal ou 1 cama de solteiro',
  },
  {
    code: 'DBL',
    name: 'Duplo com cafe da manha',
    occupancyType: 'double',
    maxGuests: 2,
    maxAdults: 2,
    maxChildren: 0,
    bedConfiguration: '1 cama de casal ou 2 camas de solteiro',
  },
])

async function main() {
  const target = requireLocalDatabaseTarget()
  const pool = new pg.Pool({
    connectionString: target.connectionString,
    max: 1,
    application_name: 'bdex-local-rio-hotel-fixture',
  })
  const client = await pool.connect()

  try {
    await client.query('begin')

    const tenant = await requireTenant(client)
    await client.query(
      `select pg_advisory_xact_lock(hashtext($1))`,
      [`bdex-local-rio-hotel-fixture:${tenant.id}`],
    )
    const supplier = await requireHotelSupplier(client, tenant.id)
    const geography = await requireRioGeography(client)

    const results = []
    for (const hotel of HOTELS) {
      const result = await upsertHotelFixture(client, {
        tenant,
        supplier,
        geography,
        hotel,
      })
      results.push(result)
    }

    await client.query('commit')

    console.log(JSON.stringify({
      ok: true,
      localOnly: true,
      database: {
        host: target.host,
        port: target.port,
        name: target.databaseName,
      },
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      supplier: { id: supplier.id, code: supplier.internal_code, name: supplier.name },
      city: {
        id: geography.city_id,
        name: geography.city_name,
        subdivision: geography.subdivision_code,
        country: geography.country_code,
      },
      hotels: results,
    }, null, 2))
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // A falha original e mais util do que uma eventual falha de rollback.
    }
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

function requireLocalDatabaseTarget() {
  const nodeEnvironment = String(process.env.NODE_ENV || 'development').trim().toLowerCase()
  if (nodeEnvironment === 'production') {
    throw new Error('fixture local recusada: NODE_ENV=production')
  }

  const connectionString = String(
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '',
  ).trim()
  if (!connectionString) {
    throw new Error('fixture local recusada: MIGRATION_DATABASE_URL ou DATABASE_URL nao configurada')
  }

  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error('fixture local recusada: URL PostgreSQL invalida')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('fixture local recusada: protocolo PostgreSQL obrigatorio')
  }

  const host = parsed.hostname.toLowerCase()
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`fixture local recusada: host remoto nao permitido (${host})`)
  }

  const port = parsed.port || '5432'
  if (port !== LOCAL_DATABASE_PORT) {
    throw new Error(`fixture local recusada: porta deve ser ${LOCAL_DATABASE_PORT}`)
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (databaseName !== LOCAL_DATABASE_NAME) {
    throw new Error(`fixture local recusada: banco deve ser ${LOCAL_DATABASE_NAME}`)
  }

  return { connectionString, host, port, databaseName }
}

async function requireTenant(client) {
  const result = await client.query(
    `select id, slug, name
     from tenants
     where slug = $1 and status = 'active'`,
    [TENANT_SLUG],
  )
  if (result.rowCount !== 1) {
    throw new Error(`tenant local ativo nao encontrado: ${TENANT_SLUG}`)
  }
  return result.rows[0]
}

async function requireHotelSupplier(client, tenantId) {
  const result = await client.query(
    `select id, internal_code::text,
            coalesce(trade_name, legal_name) as name,
            coalesce(updated_by, created_by) as actor_user_id
     from commercial_suppliers
     where tenant_id = $1
       and internal_code = $2
       and status = 'active'
       and deleted_at is null
       and service_types @> array['hotel']::text[]`,
    [tenantId, SUPPLIER_CODE],
  )
  if (result.rowCount !== 1) {
    throw new Error(`fornecedor comercial local ativo nao encontrado: ${SUPPLIER_CODE}`)
  }
  return result.rows[0]
}

async function requireRioGeography(client) {
  const result = await client.query(
    `select country.id as country_id,
            upper(country.iso_alpha2::text) as country_code,
            subdivision.id as subdivision_id,
            upper(subdivision.code::text) as subdivision_code,
            city.id as city_id,
            city.name as city_name
     from geo_countries country
     join geo_subdivisions subdivision
       on subdivision.country_id = country.id
      and upper(subdivision.code::text) = 'RJ'
      and subdivision.is_active
     join geo_cities city
       on city.country_id = country.id
      and city.subdivision_id = subdivision.id
      and city.normalized_name = 'rio de janeiro'
      and city.is_active
     where upper(country.iso_alpha2::text) = 'BR'
       and country.is_active`,
  )
  if (result.rowCount !== 1) {
    throw new Error('geografia local de Rio de Janeiro/RJ nao encontrada de forma univoca')
  }
  return result.rows[0]
}

async function upsertHotelFixture(client, input) {
  const { tenant, supplier, geography, hotel } = input
  const existing = await client.query(
    `select tenant_id, source
     from hotels
     where id = $1
     for update`,
    [hotel.id],
  )
  if (existing.rows[0] && existing.rows[0].tenant_id !== tenant.id) {
    throw new Error(`colisao de ID de hotel com outro tenant: ${hotel.id}`)
  }
  if (existing.rows[0] && existing.rows[0].source !== 'local_fixture') {
    throw new Error(`o ID ${hotel.id} pertence a um hotel que nao e fixture local`)
  }

  const duplicate = await client.query(
    `select id
     from hotels
     where tenant_id = $1
       and city_id = $2::uuid
       and normalized_name = $3
       and id <> $4
       and deleted_at is null
     limit 1`,
    [tenant.id, geography.city_id, normalizeName(hotel.name), hotel.id],
  )
  if (duplicate.rows[0]) {
    throw new Error(`ja existe outro hotel local com o mesmo nome: ${hotel.name}`)
  }

  const inserted = await client.query(
    `insert into hotels (
       id, tenant_id, name, normalized_name,
       country, state, city, country_id, subdivision_id, city_id,
       address, category, billing_enabled, billing_info, amenities,
       status, source, created_by, updated_by
     ) values (
       $1, $2, $3, $4,
       $5, $6, $7, $8::uuid, $9::uuid, $10::uuid,
       $11, $12, false, null, '{}'::jsonb,
       'active', 'local_fixture', $13, $13
     )
     on conflict (id) do update set
       name = excluded.name,
       normalized_name = excluded.normalized_name,
       country = excluded.country,
       state = excluded.state,
       city = excluded.city,
       country_id = excluded.country_id,
       subdivision_id = excluded.subdivision_id,
       city_id = excluded.city_id,
       address = excluded.address,
       category = excluded.category,
       status = 'active',
       source = 'local_fixture',
       deleted_at = null,
       version = hotels.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()
     where hotels.tenant_id = excluded.tenant_id
       and row(
         hotels.name, hotels.normalized_name, hotels.country, hotels.state, hotels.city,
         hotels.country_id, hotels.subdivision_id, hotels.city_id, hotels.address,
         hotels.category, hotels.status, hotels.source, hotels.deleted_at
       ) is distinct from row(
         excluded.name, excluded.normalized_name, excluded.country, excluded.state, excluded.city,
         excluded.country_id, excluded.subdivision_id, excluded.city_id, excluded.address,
         excluded.category, 'active', 'local_fixture', null
       )
     returning id`,
    [
      hotel.id,
      tenant.id,
      hotel.name,
      normalizeName(hotel.name),
      geography.country_code,
      geography.subdivision_code,
      geography.city_name,
      geography.country_id,
      geography.subdivision_id,
      geography.city_id,
      hotel.address,
      hotel.category,
      supplier.actor_user_id,
    ],
  )

  for (const room of ROOM_TYPES) {
    await client.query(
      `insert into hotel_room_types (
         tenant_id, hotel_id, code, name, occupancy_type,
         max_guests, max_adults, max_children, bed_configuration,
         is_active, created_by, updated_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $10)
       on conflict (tenant_id, hotel_id, code) do update set
         name = excluded.name,
         occupancy_type = excluded.occupancy_type,
         max_guests = excluded.max_guests,
         max_adults = excluded.max_adults,
         max_children = excluded.max_children,
         bed_configuration = excluded.bed_configuration,
         is_active = true,
         deleted_at = null,
         version = hotel_room_types.version + 1,
         updated_by = excluded.updated_by,
         updated_at = now()
       where row(
         hotel_room_types.name, hotel_room_types.occupancy_type,
         hotel_room_types.max_guests, hotel_room_types.max_adults,
         hotel_room_types.max_children, hotel_room_types.bed_configuration,
         hotel_room_types.is_active, hotel_room_types.deleted_at
       ) is distinct from row(
         excluded.name, excluded.occupancy_type,
         excluded.max_guests, excluded.max_adults,
         excluded.max_children, excluded.bed_configuration,
         true, null
       )`,
      [
        tenant.id,
        hotel.id,
        room.code,
        room.name,
        room.occupancyType,
        room.maxGuests,
        room.maxAdults,
        room.maxChildren,
        room.bedConfiguration,
        supplier.actor_user_id,
      ],
    )
  }

  const link = await client.query(
    `insert into hotel_suppliers (
       id, tenant_id, hotel_id, supplier_id, supplier_property_code,
       priority, is_active, created_by, updated_by
     ) values ($1::uuid, $2, $3, $4::uuid, $5, 10, true, $6, $6)
     on conflict (tenant_id, hotel_id, supplier_id) do update set
       supplier_property_code = excluded.supplier_property_code,
       priority = excluded.priority,
       is_active = true,
       ended_at = null,
       version = hotel_suppliers.version + 1,
       updated_by = excluded.updated_by,
       updated_at = now()
     where row(
       hotel_suppliers.supplier_property_code, hotel_suppliers.priority,
       hotel_suppliers.is_active, hotel_suppliers.ended_at
     ) is distinct from row(
       excluded.supplier_property_code, excluded.priority, true, null
     )
     returning id`,
    [
      stableUuid(`hotel-supplier:${tenant.id}:${hotel.id}:${supplier.id}`),
      tenant.id,
      hotel.id,
      supplier.id,
      hotel.supplierPropertyCode,
      supplier.actor_user_id,
    ],
  )

  const validation = await client.query(
    `select hotel.id,
            exists (
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
            ) as quotable,
            (
              select count(*)::integer
              from hotel_room_types room
              where room.tenant_id = hotel.tenant_id
                and room.hotel_id = hotel.id
                and room.is_active
                and room.deleted_at is null
            ) as room_type_count
     from hotels hotel
     where hotel.tenant_id = $1
       and hotel.id = $2
       and hotel.city_id = $3::uuid
       and hotel.status = 'active'
       and hotel.deleted_at is null`,
    [tenant.id, hotel.id, geography.city_id],
  )
  if (!validation.rows[0]?.quotable || Number(validation.rows[0]?.room_type_count) < ROOM_TYPES.length) {
    throw new Error(`hotel local nao ficou ativo e cotavel: ${hotel.id}`)
  }

  const linkId = link.rows[0]?.id || (await client.query(
    `select id
     from hotel_suppliers
     where tenant_id = $1 and hotel_id = $2 and supplier_id = $3::uuid`,
    [tenant.id, hotel.id, supplier.id],
  )).rows[0]?.id

  return {
    id: hotel.id,
    name: hotel.name,
    createdOrRepaired: inserted.rowCount === 1,
    supplierLinkId: linkId,
    quotable: true,
    roomTypeCount: Number(validation.rows[0].room_type_count),
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
  // randomUUID e usado apenas como fallback impossivel de atingir na pratica;
  // o UUID deterministico torna o vinculo idempotente entre execucoes.
  const bytes = Buffer.from(seed, 'utf8')
  if (!bytes.length) return randomUUID()
  let hash = 2166136261
  const output = Buffer.alloc(16)
  for (let index = 0; index < output.length; index += 1) {
    for (const byte of bytes) {
      hash ^= byte + index
      hash = Math.imul(hash, 16777619) >>> 0
    }
    output[index] = hash & 0xff
  }
  output[6] = (output[6] & 0x0f) | 0x40
  output[8] = (output[8] & 0x3f) | 0x80
  const hex = output.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

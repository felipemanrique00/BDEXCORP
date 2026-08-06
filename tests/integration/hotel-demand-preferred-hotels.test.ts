import { randomUUID } from 'node:crypto'

import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { HotelDemandDetailsInput } from '@/lib/hotel-demand/model'
import {
  persistHotelDemandDetailsInTransaction,
} from '@/lib/server/hotel-demand-service'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL hotel demand preferred hotels persistence', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const tenantId = randomUUID()
  const actorUserId = randomUUID()
  const companyId = `company-${randomUUID()}`
  const employeeId = `employee-${randomUUID()}`
  const demandId = `demand-${randomUUID()}`
  const hotelIds = [`hotel-${randomUUID()}`, `hotel-${randomUUID()}`]
  const supplierIds = [randomUUID(), randomUUID()]
  const countryId = randomUUID()
  const subdivisionId = randomUUID()
  const cityId = randomUUID()
  const checkIn = futureDateOnly(180)
  const checkOut = futureDateOnly(183)
  let countryCode = ''

  beforeAll(async () => {
    countryCode = await seedIsolatedGeography(pool, {
      countryId,
      subdivisionId,
      cityId,
    })
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Hotel Preference Integration Tenant', $2)`,
      [tenantId, `hotel-preferences-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name, status, email_verified_at)
       values ($1, $2, 'Solicitante de preferencias', 'active', now())`,
      [actorUserId, `hotel-preferences-${actorUserId}@test.invalid`],
    )

    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into companies (
           id, tenant_id, legal_name, trade_name, document_number, status
         ) values (
           $1, $2, 'Empresa Preferencias Hoteleiras SA',
           'Empresa Preferencias Hoteleiras', $3, 'active'
         )`,
        [companyId, tenantId, uniqueDocumentNumber()],
      )
      await client.query(
        `insert into employees (
           id, tenant_id, company_id, identification_code, full_name,
           email, phone, metadata, status
         ) values (
           $1, $2, $3, $4, 'Viajante das preferencias',
           'viajante-preferencias@test.invalid', '(11) 99999-0101',
           '{}'::jsonb, 'active'
         )`,
        [employeeId, tenantId, companyId, `PREF-${randomUUID()}`],
      )
      await seedHotelsAndSuppliers(client, {
        tenantId,
        userId: actorUserId,
        countryId,
        subdivisionId,
        cityId,
        countryCode,
        hotelIds,
        supplierIds,
      })
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, employee_id, demand_number,
           service_type, passenger_name_snapshot, status, priority,
           travel_start_date, travel_end_date, destination, estimated_amount,
           lifecycle_status, lifecycle_version, created_by
         ) values (
           $1, $2, $3, $4, $5,
           'Hotel', 'Viajante das preferencias', 'em_andamento', 'normal',
           $6, $7, 'Cidade de Teste', 0,
           'submitted', 1, $8
         )`,
        [
          demandId,
          tenantId,
          companyId,
          employeeId,
          `OS-PREFERENCIAS-${randomUUID()}`,
          checkIn,
          checkOut,
          actorUserId,
        ],
      )
    })
  })

  afterAll(async () => {
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from users where id = $1', [actorUserId])
    await pool.query('delete from geo_cities where id = $1', [cityId])
    await pool.query('delete from geo_subdivisions where id = $1', [subdivisionId])
    await pool.query('delete from geo_countries where id = $1', [countryId])
    await pool.end()
  })

  it('keeps ordered preferences and the legacy mirror synchronized without partial writes', async () => {
    await tenantTransaction(pool, tenantId, async (client) => {
      await persistHotelDemandDetailsInTransaction(client, {
        tenantId,
        demandId,
        companyId,
        actorUserId,
        details: hotelDetails({
          preferredHotelIds: hotelIds,
          purpose: 'Cadastro inicial com duas preferencias',
        }),
      })
    })

    const created = await readPreferenceState(pool, tenantId, demandId)
    expect(created.preferences).toEqual([
      { hotel_id: hotelIds[0], preference_order: 1 },
      { hotel_id: hotelIds[1], preference_order: 2 },
    ])
    expect(created.details).toMatchObject({
      preferred_hotel_id: hotelIds[0],
      purpose: 'Cadastro inicial com duas preferencias',
    })

    await tenantTransaction(pool, tenantId, async (client) => {
      await persistHotelDemandDetailsInTransaction(client, {
        tenantId,
        demandId,
        companyId,
        actorUserId,
        details: hotelDetails({
          preferredHotelIds: [hotelIds[1]],
          purpose: 'Edicao removendo a primeira preferencia',
        }),
      })
    })

    const edited = await readPreferenceState(pool, tenantId, demandId)
    expect(edited.preferences).toEqual([
      { hotel_id: hotelIds[1], preference_order: 1 },
    ])
    expect(edited.details).toMatchObject({
      preferred_hotel_id: hotelIds[1],
      purpose: 'Edicao removendo a primeira preferencia',
    })
    expect(Number(edited.details?.version)).toBe(2)

    const invalidHotelId = `hotel-invalido-${randomUUID()}`
    await expect(tenantTransaction(pool, tenantId, async (client) => {
      await persistHotelDemandDetailsInTransaction(client, {
        tenantId,
        demandId,
        companyId,
        actorUserId,
        details: hotelDetails({
          preferredHotelIds: [hotelIds[0], invalidHotelId],
          purpose: 'Esta alteracao deve ser revertida',
        }),
      })
    })).rejects.toMatchObject({
      code: 'HOTEL_DEMAND_PREFERRED_HOTEL_INVALID',
      status: 422,
      details: { hotelIds: [invalidHotelId] },
    })

    expect(await readPreferenceState(pool, tenantId, demandId)).toEqual(edited)
  })

  function hotelDetails(input: {
    preferredHotelIds: string[]
    purpose: string
  }): HotelDemandDetailsInput {
    return {
      country_id: countryId,
      subdivision_id: subdivisionId,
      city_id: cityId,
      cidade: 'Cidade de Teste',
      data_checkin: checkIn,
      data_checkout: checkOut,
      preferred_hotel_ids: input.preferredHotelIds,
      purpose: input.purpose,
      preferences: {},
      needs_review: false,
      rooms: [{
        client_id: 'room-preferences-integration',
        occupancy_code: 'single',
        guests: [{
          slot_index: 1,
          role: 'responsible',
          employee_id: employeeId,
          name: 'Viajante das preferencias',
          email: 'viajante-preferencias@test.invalid',
          phone: '(11) 99999-0101',
          is_external: false,
        }],
      }],
    }
  }
})

async function readPreferenceState(pool: Pool, tenantId: string, demandId: string) {
  return tenantTransaction(pool, tenantId, async (client) => {
    const preferences = await client.query<{
      hotel_id: string
      preference_order: number
    }>(
      `select hotel_id, preference_order
       from hotel_demand_preferred_hotels
       where tenant_id = $1 and demand_id = $2
       order by preference_order`,
      [tenantId, demandId],
    )
    const details = await client.query<{
      preferred_hotel_id: string | null
      purpose: string | null
      version: string
    }>(
      `select preferred_hotel_id, purpose, version
       from hotel_demand_details
       where tenant_id = $1 and demand_id = $2`,
      [tenantId, demandId],
    )
    return {
      preferences: preferences.rows.map((row) => ({
        hotel_id: row.hotel_id,
        preference_order: Number(row.preference_order),
      })),
      details: details.rows[0],
    }
  })
}

async function seedIsolatedGeography(
  pool: Pool,
  ids: { countryId: string; subdivisionId: string; cityId: string },
): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('lock table geo_countries in share row exclusive mode')
    const existing = await client.query<{ code: string }>(
      'select upper(iso_alpha2::text) as code from geo_countries',
    )
    const occupied = new Set(existing.rows.map((row) => row.code))
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let code = ''
    for (const first of alphabet) {
      for (const second of alphabet) {
        const candidate = `${first}${second}`
        if (!occupied.has(candidate)) {
          code = candidate
          break
        }
      }
      if (code) break
    }
    if (!code) throw new Error('Nao ha codigo geografico livre para a fixture de integracao.')

    await client.query(
      `insert into geo_countries (
         id, iso_alpha2, iso_alpha3, name, normalized_name, provider, provider_id
       ) values ($1, $2, $3, 'Pais de Teste', 'pais de teste', 'integration-test', $4)`,
      [ids.countryId, code, `${code}X`, `hotel-preferences-country-${ids.countryId}`],
    )
    await client.query(
      `insert into geo_subdivisions (
         id, country_id, code, name, normalized_name, provider, provider_id
       ) values ($1, $2, $3, 'Estado de Teste', 'estado de teste', 'integration-test', $4)`,
      [ids.subdivisionId, ids.countryId, `${code}-T`, `hotel-preferences-state-${ids.subdivisionId}`],
    )
    await client.query(
      `insert into geo_cities (
         id, country_id, subdivision_id, name, normalized_name, provider, provider_id
       ) values ($1, $2, $3, 'Cidade de Teste', 'cidade de teste', 'integration-test', $4)`,
      [ids.cityId, ids.countryId, ids.subdivisionId, `hotel-preferences-city-${ids.cityId}`],
    )
    await client.query('commit')
    return code
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function seedHotelsAndSuppliers(
  client: PoolClient,
  input: {
    tenantId: string
    userId: string
    countryId: string
    subdivisionId: string
    cityId: string
    countryCode: string
    hotelIds: string[]
    supplierIds: string[]
  },
): Promise<void> {
  for (let index = 0; index < input.hotelIds.length; index += 1) {
    const suffix = index + 1
    await client.query(
      `insert into commercial_suppliers (
         id, tenant_id, internal_code, legal_name, trade_name,
         service_types, status, created_by
       ) values ($1, $2, $3, $4, $4, array['hotel']::text[], 'active', $5)`,
      [
        input.supplierIds[index],
        input.tenantId,
        `SUP-PREF-${suffix}-${input.supplierIds[index]}`,
        `Fornecedor Preferencial ${suffix}`,
        input.userId,
      ],
    )
    await client.query(
      `insert into hotels (
         id, tenant_id, name, normalized_name, city, state, country,
         country_id, subdivision_id, city_id, category, status, created_by
       ) values (
         $1, $2, $3, $4, 'Cidade de Teste', 'Estado de Teste', $5,
         $6, $7, $8, 'Homologacao', 'active', $9
       )`,
      [
        input.hotelIds[index],
        input.tenantId,
        `Hotel Preferencial ${suffix}`,
        `hotel preferencial ${suffix}`,
        input.countryCode,
        input.countryId,
        input.subdivisionId,
        input.cityId,
        input.userId,
      ],
    )
    await client.query(
      `insert into hotel_suppliers (
         tenant_id, hotel_id, supplier_id, priority, is_active, created_by
       ) values ($1, $2, $3, 1, true, $4)`,
      [input.tenantId, input.hotelIds[index], input.supplierIds[index], input.userId],
    )
  }
}

async function tenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await operation(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

function futureDateOnly(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

function uniqueDocumentNumber(): string {
  return randomUUID().replace(/-/g, '').slice(0, 14)
}

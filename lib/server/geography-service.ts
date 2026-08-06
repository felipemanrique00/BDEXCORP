import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  citySearchSchema,
  geographySearchSchema,
  geographySyncSchema,
  geographySyncStatusQuerySchema,
  subdivisionSearchSchema,
  type GeographySyncInput,
} from '@/lib/geography/schema'
import type {
  GeographyCity,
  GeographyCountry,
  GeographyDatasetVersion,
  GeographySubdivision,
  GeographySyncResult,
  GeographySyncRunStatus,
  GeographySyncStatus,
} from '@/lib/geography/types'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const IBGE_BASE_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades'

interface CountryRow extends QueryResultRow {
  id: string
  iso_alpha2: string
  iso_alpha3: string | null
  numeric_code: string | null
  name: string
  official_name: string | null
  provider: string
  provider_id: string
  is_active: boolean
  synced_at: string | Date
}

interface SubdivisionRow extends QueryResultRow {
  id: string
  country_id: string
  code: string
  name: string
  subdivision_type: string
  provider: string
  provider_id: string
  is_active: boolean
  synced_at: string | Date
}

interface CityRow extends QueryResultRow {
  id: string
  country_id: string
  subdivision_id: string | null
  subdivision_code: string | null
  name: string
  provider: string
  provider_id: string
  is_active: boolean
  synced_at: string | Date
}

interface SyncRunRow extends QueryResultRow {
  id: string
  provider: 'ibge'
  dataset_key: 'brazil' | 'countries'
  status: GeographySyncRunStatus['status']
  inserted_count: string | number
  updated_count: string | number
  unchanged_count: string | number
  inactivated_count: string | number
  error_count: string | number
  checksum_sha256: string | null
  error_message: string | null
  started_at: string | Date
  finished_at: string | Date | null
}

interface DatasetVersionRow extends QueryResultRow {
  id: string
  provider: 'ibge'
  dataset_key: 'brazil' | 'countries'
  checksum_sha256: string
  record_count: string | number
  source_url: string | null
  activated_at: string | Date
  created_at: string | Date
}

interface IbgeCountry {
  providerId: string
  alpha2: string
  alpha3: string | null
  numericCode: string | null
  name: string
  officialName: string | null
  normalizedName: string
}

interface IbgeSubdivision {
  providerId: string
  code: string
  name: string
  normalizedName: string
  type: string
}

interface IbgeCity {
  providerId: string
  subdivisionProviderId: string
  name: string
  normalizedName: string
}

export class GeographyServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'GeographyServiceError'
  }
}

export async function listCountries(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<{ items: GeographyCountry[]; total: number }> {
  const query = geographySearchSchema.parse(rawQuery)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = []
    const clauses = [query.includeInactive ? 'true' : 'country.is_active']
    if (query.q) {
      values.push(`%${normalizeName(query.q)}%`)
      clauses.push(`country.normalized_name like $${values.length}`)
    }
    values.push(query.limit, query.offset)
    const result = await client.query<CountryRow & { total_count: string | number }>(
      `select country.*, count(*) over() as total_count
       from geo_countries country
       where ${clauses.join(' and ')}
       order by case when upper(country.iso_alpha2::text) = 'BR' then 0 else 1 end,
                country.normalized_name
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: result.rows.map(mapCountry),
      total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    }
  })
}

export async function listSubdivisions(
  principal: RequestPrincipal,
  rawQuery: unknown,
): Promise<{ items: GeographySubdivision[]; total: number }> {
  const query = subdivisionSearchSchema.parse(rawQuery)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [query.countryId || null, query.countryCode || null]
    const clauses = [
      `(country.id = $1::uuid or ($1::uuid is null and upper(country.iso_alpha2::text) = $2))`,
      query.includeInactive ? 'true' : '(country.is_active and subdivision.is_active)',
    ]
    if (query.q) {
      values.push(`%${normalizeName(query.q)}%`)
      clauses.push(`subdivision.normalized_name like $${values.length}`)
    }
    values.push(query.limit, query.offset)
    const result = await client.query<SubdivisionRow & { total_count: string | number }>(
      `select subdivision.*, count(*) over() as total_count
       from geo_subdivisions subdivision
       join geo_countries country on country.id = subdivision.country_id
       where ${clauses.join(' and ')}
       order by subdivision.code
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: result.rows.map(mapSubdivision),
      total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    }
  })
}

export async function listCities(
  principal: RequestPrincipal,
  rawQuery: unknown,
): Promise<{ items: GeographyCity[]; total: number }> {
  const query = citySearchSchema.parse(rawQuery)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = [
      query.countryId || null,
      query.countryCode || null,
      query.subdivisionId || null,
      query.subdivisionCode || null,
    ]
    const clauses = [
      `(country.id = $1::uuid or ($1::uuid is null and upper(country.iso_alpha2::text) = $2))`,
      `($3::uuid is null or city.subdivision_id = $3::uuid)`,
      `($4::text is null or upper(subdivision.code::text) = upper($4))`,
      query.includeInactive
        ? 'true'
        : '(country.is_active and city.is_active and (city.subdivision_id is null or subdivision.is_active))',
    ]
    if (query.q) {
      values.push(`%${normalizeName(query.q)}%`)
      clauses.push(`(
        city.normalized_name like $${values.length}
        or exists (
          select 1 from geo_city_aliases alias
          where alias.city_id = city.id and alias.normalized_alias like $${values.length}
        )
      )`)
    }
    values.push(query.limit, query.offset)
    const result = await client.query<CityRow & { total_count: string | number }>(
      `select city.*, subdivision.code::text as subdivision_code,
              count(*) over() as total_count
       from geo_cities city
       join geo_countries country on country.id = city.country_id
       left join geo_subdivisions subdivision on subdivision.id = city.subdivision_id
       where ${clauses.join(' and ')}
       order by city.normalized_name
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: result.rows.map(mapCity),
      total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    }
  })
}

export async function getGeographySyncStatus(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<GeographySyncStatus> {
  const query = geographySyncStatusQuerySchema.parse(rawQuery)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const latestRun = await client.query<SyncRunRow>(
      `select id, provider, dataset_key, status, inserted_count, updated_count,
              unchanged_count, inactivated_count, error_count, checksum_sha256,
              error_message, started_at, finished_at
       from geo_sync_runs
       where tenant_id = $1 and provider = $2 and dataset_key = $3
       order by started_at desc, id desc
       limit 1`,
      [principal.tenantId, query.provider, query.datasetKey],
    )
    const datasetVersion = await client.query<DatasetVersionRow>(
      `select id, provider, dataset_key, checksum_sha256, record_count,
              source_url, activated_at, created_at
       from geo_dataset_versions
       where provider = $1 and dataset_key = $2 and status = 'active'
       limit 1`,
      [query.provider, query.datasetKey],
    )
    return {
      latestRun: latestRun.rows[0] ? mapSyncRun(latestRun.rows[0]) : null,
      datasetVersion: datasetVersion.rows[0] ? mapDatasetVersion(datasetVersion.rows[0]) : null,
    }
  })
}

export async function syncGeographyCatalog(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<GeographySyncResult> {
  const input = geographySyncSchema.parse(rawInput)
  const runId = randomUUID()
  const startedAt = new Date().toISOString()

  await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      `insert into geo_sync_runs (
         id, tenant_id, provider, dataset_key, status, started_by, started_at, scope
       ) values ($1, $2, $3, $4, 'running', $5, $6::timestamptz, $7::jsonb)`,
      [runId, principal.tenantId, input.provider, input.datasetKey, principal.user.id, startedAt, JSON.stringify(input)],
    )
  })

  try {
    const downloaded = await downloadIbge(input)
    validateDownloadedCatalog(downloaded, input)
    const checksum = sha256(downloaded)
    const applied = await withTenantTransaction(principal.tenantId, (client) => applyDownloadedCatalog(
      client,
      principal,
      runId,
      input,
      downloaded,
      checksum,
      startedAt,
    ))
    await writeAuditEvent({
      action: 'geography.catalog.synchronized',
      result: 'success',
      entityType: 'geo_sync_run',
      entityId: runId,
      metadata: { ...applied },
    })
    return applied
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida na sincronizacao geografica.'
    await withTenantTransaction(principal.tenantId, async (client) => {
      await client.query(
        `update geo_sync_runs set status = 'failed', error_count = error_count + 1,
           error_message = $3, finished_at = now()
         where tenant_id = $1 and id = $2 and status = 'running'`,
        [principal.tenantId, runId, message.slice(0, 4000)],
      )
    }).catch(() => undefined)
    throw error
  }
}

async function applyDownloadedCatalog(
  client: PoolClient,
  principal: RequestPrincipal,
  runId: string,
  input: GeographySyncInput,
  downloaded: { countries: IbgeCountry[]; subdivisions: IbgeSubdivision[]; cities: IbgeCity[] },
  checksum: string,
  startedAt: string,
): Promise<GeographySyncResult> {
  const lock = await client.query<{ locked: boolean }>(
    `select pg_try_advisory_xact_lock(hashtext('bbt:geography:ibge')) as locked`,
  )
  if (!lock.rows[0]?.locked) {
    throw new GeographyServiceError(
      'GEOGRAPHY_SYNC_IN_PROGRESS',
      'Ja existe uma sincronizacao geografica em andamento.',
      409,
    )
  }

  const datasetVersionId = await activateDatasetVersion(client, input, checksum, downloaded)
  const beforeCountries = await currentReferenceMap(client, 'geo_countries', 'ibge')
  await upsertCountries(client, downloaded.countries, datasetVersionId)
  const countryStats = classifyRows(downloaded.countries, beforeCountries, (item) => item.providerId, countryComparable)
  let inactivated = 0
  if (input.includeCountries) {
    const countryProviderIds = downloaded.countries.map((item) => item.providerId)
    const countries = await client.query(
      `update geo_countries set is_active = false, synced_at = now(), updated_at = now()
       where provider = 'ibge' and is_active
         and not (provider_id = any($1::text[]))`,
      [countryProviderIds],
    )
    inactivated += countries.rowCount || 0
  }

  const brCountry = await client.query<{ id: string }>(
    `select id from geo_countries where upper(iso_alpha2::text) = 'BR' and is_active`,
  )
  const countryId = brCountry.rows[0]?.id
  if (!countryId) throw new GeographyServiceError('GEOGRAPHY_BR_MISSING', 'O pais Brasil nao foi encontrado apos a sincronizacao.', 500)

  const beforeSubdivisions = await currentReferenceMap(client, 'geo_subdivisions', 'ibge')
  await upsertSubdivisions(client, countryId, downloaded.subdivisions, datasetVersionId)
  const subdivisionStats = classifyRows(
    downloaded.subdivisions,
    beforeSubdivisions,
    (item) => item.providerId,
    subdivisionComparable,
  )
  const subdivisionRows = await client.query<{ id: string; provider_id: string }>(
    `select id, provider_id from geo_subdivisions where provider = 'ibge' and country_id = $1`,
    [countryId],
  )
  const subdivisionIds = new Map(subdivisionRows.rows.map((row) => [row.provider_id, row.id]))

  const beforeCities = await currentReferenceMap(client, 'geo_cities', 'ibge')
  await upsertCities(client, countryId, downloaded.cities, subdivisionIds, datasetVersionId)
  const cityStats = classifyRows(downloaded.cities, beforeCities, (item) => item.providerId, cityComparable)

  if (input.datasetKey === 'brazil') {
    const stateIds = downloaded.subdivisions.map((item) => item.providerId)
    const cityIds = downloaded.cities.map((item) => item.providerId)
    const states = await client.query(
      `update geo_subdivisions set is_active = false, synced_at = now(), updated_at = now()
       where provider = 'ibge' and country_id = $1 and is_active
         and not (provider_id = any($2::text[]))`,
      [countryId, stateIds],
    )
    const cities = await client.query(
      `update geo_cities set is_active = false, synced_at = now(), updated_at = now()
       where provider = 'ibge' and country_id = $1 and is_active
         and not (provider_id = any($2::text[]))`,
      [countryId, cityIds],
    )
    inactivated += (states.rowCount || 0) + (cities.rowCount || 0)
  }

  const finishedAt = new Date().toISOString()
  const inserted = countryStats.inserted + subdivisionStats.inserted + cityStats.inserted
  const updated = countryStats.updated + subdivisionStats.updated + cityStats.updated
  const unchanged = countryStats.unchanged + subdivisionStats.unchanged + cityStats.unchanged
  await client.query(
    `update geo_sync_runs set
       status = 'completed', inserted_count = $3, updated_count = $4,
       unchanged_count = $5, inactivated_count = $6, checksum_sha256 = $7,
       finished_at = $8::timestamptz, metadata = $9::jsonb
     where tenant_id = $1 and id = $2`,
    [
      principal.tenantId,
      runId,
      inserted,
      updated,
      unchanged,
      inactivated,
      checksum,
      finishedAt,
      JSON.stringify({
        datasetVersionId,
        countries: downloaded.countries.length,
        subdivisions: downloaded.subdivisions.length,
        cities: downloaded.cities.length,
      }),
    ],
  )
  return {
    runId,
    provider: 'ibge',
    datasetKey: input.datasetKey,
    checksum,
    inserted,
    updated,
    unchanged,
    inactivated,
    countries: downloaded.countries.length,
    subdivisions: downloaded.subdivisions.length,
    cities: downloaded.cities.length,
    startedAt,
    finishedAt,
  }
}

async function downloadIbge(input: GeographySyncInput): Promise<{
  countries: IbgeCountry[]
  subdivisions: IbgeSubdivision[]
  cities: IbgeCity[]
}> {
  const [rawCountries, rawSubdivisions, rawCities] = await Promise.all([
    input.includeCountries ? fetchIbge('/paises') : Promise.resolve([]),
    input.datasetKey === 'brazil' ? fetchIbge('/estados') : Promise.resolve([]),
    input.datasetKey === 'brazil' ? fetchIbge('/municipios') : Promise.resolve([]),
  ])
  const countries = input.includeCountries
    ? rawCountries.flatMap(parseIbgeCountry)
    : []
  if (!countries.some((item) => item.alpha2 === 'BR')) {
    countries.unshift({
      providerId: '076',
      alpha2: 'BR',
      alpha3: 'BRA',
      numericCode: '076',
      name: 'Brasil',
      officialName: 'Republica Federativa do Brasil',
      normalizedName: 'brasil',
    })
  }
  return {
    countries: countries.sort(compareProviderId),
    subdivisions: rawSubdivisions.flatMap(parseIbgeSubdivision).sort(compareProviderId),
    cities: rawCities.flatMap(parseIbgeCity).sort(compareProviderId),
  }
}

async function fetchIbge(path: string): Promise<unknown[]> {
  let response: Response
  try {
    response = await fetch(`${IBGE_BASE_URL}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'BBT-Corporativo/1.1 geography-sync' },
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new GeographyServiceError(
      'GEOGRAPHY_PROVIDER_UNAVAILABLE',
      'Nao foi possivel acessar o servico de localidades do IBGE.',
      502,
      { cause: error instanceof Error ? error.name : 'unknown' },
    )
  }
  if (!response.ok) {
    throw new GeographyServiceError(
      'GEOGRAPHY_PROVIDER_UNAVAILABLE',
      `O IBGE respondeu com status ${response.status}.`,
      502,
    )
  }
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) {
    throw new GeographyServiceError('GEOGRAPHY_PROVIDER_INVALID', 'O IBGE retornou um formato inesperado.', 502)
  }
  return payload
}

function parseIbgeCountry(value: unknown): IbgeCountry[] {
  const row = record(value)
  const id = record(row.id)
  const alpha2 = textValue(id['ISO-ALPHA-2'] || id['iso-alpha-2'] || row.sigla)?.toUpperCase()
  const name = textValue(row.nome || row.name)
  if (!alpha2 || !/^[A-Z]{2}$/.test(alpha2) || !name) return []
  const alpha3 = textValue(id['ISO-ALPHA-3'] || id['iso-alpha-3'])?.toUpperCase() || null
  const numericCode = textValue(id.M49 || id.m49)?.padStart(3, '0') || null
  return [{
    providerId: numericCode || alpha2,
    alpha2,
    alpha3,
    numericCode,
    name,
    officialName: textValue(row['nome-oficial'] || row.officialName) || null,
    normalizedName: normalizeName(name),
  }]
}

function parseIbgeSubdivision(value: unknown): IbgeSubdivision[] {
  const row = record(value)
  const providerId = textValue(row.id)
  const code = textValue(row.sigla)?.toUpperCase()
  const name = textValue(row.nome)
  if (!providerId || !code || !name) return []
  return [{ providerId, code, name, normalizedName: normalizeName(name), type: 'state' }]
}

function parseIbgeCity(value: unknown): IbgeCity[] {
  const row = record(value)
  const providerId = textValue(row.id)
  const name = textValue(row.nome)
  const microregion = record(row.microrregiao)
  const mesoregion = record(microregion.mesorregiao)
  const immediateRegion = record(row['regiao-imediata'])
  const intermediateRegion = record(immediateRegion['regiao-intermediaria'])
  const state = record(mesoregion.UF || intermediateRegion.UF || row.UF)
  const subdivisionProviderId = textValue(state.id)
  if (!providerId || !name || !subdivisionProviderId) return []
  return [{ providerId, subdivisionProviderId, name, normalizedName: normalizeName(name) }]
}

function validateDownloadedCatalog(
  data: { countries: IbgeCountry[]; subdivisions: IbgeSubdivision[]; cities: IbgeCity[] },
  input: GeographySyncInput,
): void {
  if (input.includeCountries && data.countries.length < 190) {
    throw new GeographyServiceError(
      'GEOGRAPHY_COUNTRY_COUNT_INVALID',
      `A carga de paises retornou apenas ${data.countries.length} registros; nada foi aplicado.`,
      502,
    )
  }
  if (input.datasetKey === 'brazil' && data.subdivisions.length !== 27) {
    throw new GeographyServiceError(
      'GEOGRAPHY_SUBDIVISION_COUNT_INVALID',
      `A carga brasileira retornou ${data.subdivisions.length} UFs; eram esperadas 27.`,
      502,
    )
  }
  if (input.datasetKey === 'brazil' && data.cities.length < 5_000) {
    throw new GeographyServiceError(
      'GEOGRAPHY_CITY_COUNT_INVALID',
      `A carga brasileira retornou apenas ${data.cities.length} municipios; nada foi aplicado.`,
      502,
    )
  }
  assertUnique(data.countries, (item) => item.providerId, 'pais')
  assertUnique(data.countries, (item) => item.alpha2, 'codigo ISO de pais')
  assertUnique(data.subdivisions, (item) => item.providerId, 'UF')
  assertUnique(data.subdivisions, (item) => item.code, 'sigla de UF')
  assertUnique(data.cities, (item) => item.providerId, 'municipio')
  const subdivisionIds = new Set(data.subdivisions.map((item) => item.providerId))
  const invalidCity = data.cities.find((item) => !subdivisionIds.has(item.subdivisionProviderId))
  if (invalidCity) {
    throw new GeographyServiceError(
      'GEOGRAPHY_CITY_STATE_MISSING',
      `O municipio ${invalidCity.providerId} referencia uma UF ausente na carga.`,
      502,
    )
  }
}

async function activateDatasetVersion(
  client: PoolClient,
  input: GeographySyncInput,
  checksum: string,
  downloaded: { countries: unknown[]; subdivisions: unknown[]; cities: unknown[] },
): Promise<string> {
  const existing = await client.query<{ id: string; status: string }>(
    `select id, status from geo_dataset_versions
     where provider = $1 and dataset_key = $2 and checksum_sha256 = $3`,
    [input.provider, input.datasetKey, checksum],
  )
  const row = existing.rows[0]
  if (row?.status === 'active') return row.id
  await client.query(
    `update geo_dataset_versions set status = 'superseded'
     where provider = $1 and dataset_key = $2 and status = 'active'`,
    [input.provider, input.datasetKey],
  )
  if (row) {
    await client.query(
      `update geo_dataset_versions set status = 'active', activated_at = now(),
         record_count = $2 where id = $1`,
      [row.id, downloaded.countries.length + downloaded.subdivisions.length + downloaded.cities.length],
    )
    return row.id
  }
  const inserted = await client.query<{ id: string }>(
    `insert into geo_dataset_versions (
       provider, dataset_key, checksum_sha256, record_count, status,
       source_url, activated_at, metadata
     ) values ($1, $2, $3, $4, 'active', $5, now(), $6::jsonb)
     returning id`,
    [
      input.provider,
      input.datasetKey,
      checksum,
      downloaded.countries.length + downloaded.subdivisions.length + downloaded.cities.length,
      `${IBGE_BASE_URL}`,
      JSON.stringify({
        countries: downloaded.countries.length,
        subdivisions: downloaded.subdivisions.length,
        cities: downloaded.cities.length,
      }),
    ],
  )
  return inserted.rows[0].id
}

async function upsertCountries(client: PoolClient, rows: IbgeCountry[], versionId: string): Promise<void> {
  if (!rows.length) return
  await client.query(
    `insert into geo_countries (
       iso_alpha2, iso_alpha3, numeric_code, name, official_name, normalized_name,
       provider, provider_id, dataset_version_id, is_active, synced_at
     )
     select alpha2, alpha3, numeric_code, name, official_name, normalized_name,
            'ibge', provider_id, $2, true, now()
     from jsonb_to_recordset($1::jsonb) as source(
       provider_id text, alpha2 text, alpha3 text, numeric_code text,
       name text, official_name text, normalized_name text
     )
     on conflict (provider, provider_id) do update set
       iso_alpha2 = excluded.iso_alpha2,
       iso_alpha3 = excluded.iso_alpha3,
       numeric_code = excluded.numeric_code,
       name = excluded.name,
       official_name = excluded.official_name,
       normalized_name = excluded.normalized_name,
       dataset_version_id = excluded.dataset_version_id,
       is_active = true,
       synced_at = now(),
       updated_at = now()`,
    [JSON.stringify(rows.map((row) => snakeCaseCountry(row))), versionId],
  )
}

async function upsertSubdivisions(
  client: PoolClient,
  countryId: string,
  rows: IbgeSubdivision[],
  versionId: string,
): Promise<void> {
  if (!rows.length) return
  await client.query(
    `insert into geo_subdivisions (
       country_id, code, name, normalized_name, subdivision_type,
       provider, provider_id, dataset_version_id, is_active, synced_at
     )
     select $2, code, name, normalized_name, subdivision_type,
            'ibge', provider_id, $3, true, now()
     from jsonb_to_recordset($1::jsonb) as source(
       provider_id text, code text, name text, normalized_name text, subdivision_type text
     )
     on conflict (provider, provider_id) do update set
       country_id = excluded.country_id,
       code = excluded.code,
       name = excluded.name,
       normalized_name = excluded.normalized_name,
       subdivision_type = excluded.subdivision_type,
       dataset_version_id = excluded.dataset_version_id,
       is_active = true,
       synced_at = now(),
       updated_at = now()`,
    [JSON.stringify(rows.map((row) => ({
      provider_id: row.providerId,
      code: row.code,
      name: row.name,
      normalized_name: row.normalizedName,
      subdivision_type: row.type,
    }))), countryId, versionId],
  )
}

async function upsertCities(
  client: PoolClient,
  countryId: string,
  rows: IbgeCity[],
  subdivisionIds: Map<string, string>,
  versionId: string,
): Promise<void> {
  if (!rows.length) return
  const payload = rows.map((row) => ({
    provider_id: row.providerId,
    subdivision_id: subdivisionIds.get(row.subdivisionProviderId) || null,
    name: row.name,
    normalized_name: row.normalizedName,
  }))
  if (payload.some((row) => !row.subdivision_id)) {
    throw new GeographyServiceError('GEOGRAPHY_CITY_STATE_MISSING', 'Ha municipios sem UF valida na carga do IBGE.', 502)
  }
  await client.query(
    `insert into geo_cities (
       country_id, subdivision_id, name, normalized_name, provider,
       provider_id, dataset_version_id, is_active, synced_at
     )
     select $2, subdivision_id, name, normalized_name, 'ibge',
            provider_id, $3, true, now()
     from jsonb_to_recordset($1::jsonb) as source(
       provider_id text, subdivision_id uuid, name text, normalized_name text
     )
     on conflict (provider, provider_id) do update set
       country_id = excluded.country_id,
       subdivision_id = excluded.subdivision_id,
       name = excluded.name,
       normalized_name = excluded.normalized_name,
       dataset_version_id = excluded.dataset_version_id,
       is_active = true,
       synced_at = now(),
       updated_at = now()`,
    [JSON.stringify(payload), countryId, versionId],
  )
}

async function currentReferenceMap(
  client: PoolClient,
  table: 'geo_countries' | 'geo_subdivisions' | 'geo_cities',
  provider: string,
): Promise<Map<string, Record<string, unknown>>> {
  const result = await client.query<QueryResultRow>(
    `select * from ${table} where provider = $1`,
    [provider],
  )
  return new Map(result.rows.map((row) => [String(row.provider_id), row]))
}

function classifyRows<T>(
  rows: T[],
  before: Map<string, Record<string, unknown>>,
  key: (row: T) => string,
  comparable: (row: T) => Record<string, unknown>,
): { inserted: number; updated: number; unchanged: number } {
  let inserted = 0
  let updated = 0
  let unchanged = 0
  for (const row of rows) {
    const existing = before.get(key(row))
    if (!existing) {
      inserted += 1
      continue
    }
    const expected = comparable(row)
    const equal = Object.entries(expected).every(([field, value]) => String(existing[field] ?? '') === String(value ?? ''))
    if (equal && existing.is_active !== false) unchanged += 1
    else updated += 1
  }
  return { inserted, updated, unchanged }
}

function countryComparable(row: IbgeCountry): Record<string, unknown> {
  return {
    iso_alpha2: row.alpha2,
    iso_alpha3: row.alpha3,
    numeric_code: row.numericCode,
    name: row.name,
    official_name: row.officialName,
    normalized_name: row.normalizedName,
  }
}

function subdivisionComparable(row: IbgeSubdivision): Record<string, unknown> {
  return { code: row.code, name: row.name, normalized_name: row.normalizedName, subdivision_type: row.type }
}

function cityComparable(row: IbgeCity): Record<string, unknown> {
  return { name: row.name, normalized_name: row.normalizedName }
}

function snakeCaseCountry(row: IbgeCountry): Record<string, unknown> {
  return {
    provider_id: row.providerId,
    alpha2: row.alpha2,
    alpha3: row.alpha3,
    numeric_code: row.numericCode,
    name: row.name,
    official_name: row.officialName,
    normalized_name: row.normalizedName,
  }
}

function mapCountry(row: CountryRow): GeographyCountry {
  return {
    id: row.id,
    isoAlpha2: row.iso_alpha2.toUpperCase(),
    isoAlpha3: row.iso_alpha3?.toUpperCase() || null,
    numericCode: row.numeric_code,
    name: row.name,
    officialName: row.official_name,
    provider: row.provider,
    providerId: row.provider_id,
    isActive: row.is_active,
    syncedAt: new Date(row.synced_at).toISOString(),
  }
}

function mapSubdivision(row: SubdivisionRow): GeographySubdivision {
  return {
    id: row.id,
    countryId: row.country_id,
    code: row.code.toUpperCase(),
    name: row.name,
    type: row.subdivision_type,
    provider: row.provider,
    providerId: row.provider_id,
    isActive: row.is_active,
    syncedAt: new Date(row.synced_at).toISOString(),
  }
}

function mapCity(row: CityRow): GeographyCity {
  return {
    id: row.id,
    countryId: row.country_id,
    subdivisionId: row.subdivision_id,
    subdivisionCode: row.subdivision_code,
    name: row.name,
    provider: row.provider,
    providerId: row.provider_id,
    isActive: row.is_active,
    syncedAt: new Date(row.synced_at).toISOString(),
  }
}

function mapSyncRun(row: SyncRunRow): GeographySyncRunStatus {
  return {
    runId: row.id,
    provider: row.provider,
    datasetKey: row.dataset_key,
    status: row.status,
    inserted: Number(row.inserted_count),
    updated: Number(row.updated_count),
    unchanged: Number(row.unchanged_count),
    inactivated: Number(row.inactivated_count),
    errors: Number(row.error_count),
    checksum: row.checksum_sha256,
    errorMessage: row.error_message,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
  }
}

function mapDatasetVersion(row: DatasetVersionRow): GeographyDatasetVersion {
  return {
    id: row.id,
    provider: row.provider,
    datasetKey: row.dataset_key,
    checksum: row.checksum_sha256,
    recordCount: Number(row.record_count),
    sourceUrl: row.source_url,
    activatedAt: new Date(row.activated_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export function normalizeName(value: string): string {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function assertUnique<T>(rows: T[], key: (row: T) => string, label: string): void {
  const seen = new Set<string>()
  for (const row of rows) {
    const id = key(row)
    if (seen.has(id)) {
      throw new GeographyServiceError('GEOGRAPHY_DUPLICATE_PROVIDER_ID', `A carga possui ${label} duplicado: ${id}.`, 502)
    }
    seen.add(id)
  }
}

function compareProviderId<T extends { providerId: string }>(left: T, right: T): number {
  return left.providerId.localeCompare(right.providerId, 'en')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

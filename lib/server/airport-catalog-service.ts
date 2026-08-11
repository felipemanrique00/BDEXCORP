import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  airportCatalogSyncSchema,
  airportCatalogSyncStatusQuerySchema,
  airportSearchSchema,
  type AirportCatalogSyncInput,
} from '@/lib/geography/schema'
import {
  buildAirportLabel,
  normalizeAirportSearch,
  OURAIRPORTS_AIRPORTS_CSV_URL,
  parseOurAirportsCsv,
  type AirportProviderRecord,
} from '@/lib/geography/ourairports'
import type {
  AirportCatalogDatasetVersion,
  AirportCatalogSyncResult,
  AirportCatalogSyncRunStatus,
  AirportCatalogSyncStatus,
  GeographyAirport,
  GeographyAirportType,
} from '@/lib/geography/types'
import { sanitizeAirportStagePayload } from '@/lib/geography/airport-encoding'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import { GeographyServiceError } from '@/lib/server/geography-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

const AIRPORT_SYNC_BATCH_SIZE = 2_000

interface AirportRow extends QueryResultRow {
  id: string
  ident: string
  iata_code: string | null
  icao_code: string | null
  airport_type: GeographyAirportType
  name: string
  municipality: string | null
  subdivision_code: string | null
  country_code: string
  primary_provider: string
  primary_provider_id: string
  scheduled_service: boolean
  is_active: boolean
  latitude: string | number
  longitude: string | number
  timezone: string | null
}

interface SyncRunRow extends QueryResultRow {
  id: string
  provider: string
  dataset_key: 'airports'
  status: AirportCatalogSyncRunStatus['status']
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
  provider: string
  dataset_key: 'airports'
  checksum_sha256: string
  record_count: string | number
  source_url: string | null
  activated_at: string | Date
  created_at: string | Date
}

interface DownloadedAirportCatalog {
  provider: 'ourairports'
  sourceUrl: string
  checksum: string
  providerVersion: string | null
  referenceDate: string | null
  records: AirportProviderRecord[]
}

export async function listAirports(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<{ items: GeographyAirport[]; total: number }> {
  const query = airportSearchSchema.parse(rawQuery)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const values: unknown[] = []
    const clauses = [query.includeInactive ? 'true' : 'airport.is_active']
    if (!query.includeWithoutIata) clauses.push('airport.iata_code is not null')
    if (query.countryCode) {
      values.push(query.countryCode)
      clauses.push(`upper(airport.country_code::text) = $${values.length}`)
    }
    if (query.subdivisionCode) {
      values.push(query.subdivisionCode)
      clauses.push(`upper(airport.subdivision_code::text) = $${values.length}`)
    }
    if (query.scheduledService !== undefined) {
      values.push(query.scheduledService)
      clauses.push(`airport.scheduled_service = $${values.length}`)
    }

    let exactCodePlaceholder = 'null'
    let normalizedPlaceholder = 'null'
    let startsWithPlaceholder = 'null'
    let containsPlaceholder = 'null'
    if (query.q) {
      const exactCode = query.q.trim().toUpperCase()
      const normalized = normalizeAirportSearch(query.q)
      values.push(exactCode)
      exactCodePlaceholder = `$${values.length}::text`
      values.push(normalized)
      normalizedPlaceholder = `$${values.length}::text`
      values.push(`${escapeLike(exactCode)}%`)
      startsWithPlaceholder = `$${values.length}::text`
      values.push(`%${escapeLike(normalized)}%`)
      containsPlaceholder = `$${values.length}::text`
      clauses.push(`(
        upper(airport.iata_code::text) = ${exactCodePlaceholder}
        or upper(airport.icao_code::text) = ${exactCodePlaceholder}
        or upper(airport.ident::text) = ${exactCodePlaceholder}
        or upper(airport.local_code::text) = ${exactCodePlaceholder}
        or upper(airport.iata_code::text) like ${startsWithPlaceholder} escape '\\'
        or upper(airport.icao_code::text) like ${startsWithPlaceholder} escape '\\'
        or airport.normalized_name like ${containsPlaceholder} escape '\\'
        or airport.normalized_municipality like ${containsPlaceholder} escape '\\'
        or exists (
          select 1 from geo_airport_aliases alias
          where alias.airport_id = airport.id
            and alias.normalized_alias like ${containsPlaceholder} escape '\\'
        )
      )`)
    }

    values.push(query.limit, query.offset)
    const result = await client.query<AirportRow & { total_count: string | number }>(
      `select airport.*, count(*) over() as total_count
       from geo_airports airport
       where ${clauses.join(' and ')}
       order by
         case
           when ${exactCodePlaceholder} is not null and upper(airport.iata_code::text) = ${exactCodePlaceholder} then 0
           when ${exactCodePlaceholder} is not null and upper(airport.icao_code::text) = ${exactCodePlaceholder} then 1
           when ${exactCodePlaceholder} is not null and upper(airport.ident::text) = ${exactCodePlaceholder} then 2
           when ${exactCodePlaceholder} is not null and upper(airport.local_code::text) = ${exactCodePlaceholder} then 3
           when ${normalizedPlaceholder} is not null and airport.normalized_name = ${normalizedPlaceholder} then 4
           when ${normalizedPlaceholder} is not null and airport.normalized_municipality = ${normalizedPlaceholder} then 5
           else 10
         end,
         case when airport.scheduled_service then 0 else 1 end,
         case airport.airport_type
           when 'large_airport' then 0 when 'medium_airport' then 1
           when 'small_airport' then 2 else 3
         end,
         airport.normalized_name,
         airport.id
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return {
      items: result.rows.map(mapAirport),
      total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    }
  })
}

export async function getAirportCatalogSyncStatus(
  principal: RequestPrincipal,
  rawQuery: unknown = {},
): Promise<AirportCatalogSyncStatus> {
  const query = airportCatalogSyncStatusQuerySchema.parse(rawQuery)
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

export async function syncAirportCatalog(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<AirportCatalogSyncResult> {
  const input = airportCatalogSyncSchema.parse(rawInput)
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
    const downloaded = await downloadAirportCatalog(input)
    validateAirportCatalog(downloaded)
    const applied = await withTenantTransaction(principal.tenantId, (client) => applyAirportCatalog(
      client,
      principal,
      runId,
      input,
      downloaded,
      startedAt,
    ))
    await writeAuditEvent({
      tenantId: principal.tenantId,
      actorUserId: principal.user.id,
      action: 'geography.airport_catalog.synchronized',
      result: 'success',
      entityType: 'geo_sync_run',
      entityId: runId,
      metadata: { ...applied },
    })
    return applied
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida na sincronizacao de aeroportos.'
    await withTenantTransaction(principal.tenantId, async (client) => {
      await client.query(
        `update geo_sync_runs set status = 'failed', error_count = error_count + 1,
           error_message = $3, finished_at = now()
         where tenant_id = $1 and id = $2 and status = 'running'`,
        [principal.tenantId, runId, message.slice(0, 4_000)],
      )
    }).catch(() => undefined)
    await writeAuditEvent({
      tenantId: principal.tenantId,
      actorUserId: principal.user.id,
      action: 'geography.airport_catalog.synchronized',
      result: 'failure',
      entityType: 'geo_sync_run',
      entityId: runId,
      metadata: { provider: input.provider, datasetKey: input.datasetKey, error: message },
    }).catch(() => undefined)
    throw error
  }
}

async function downloadAirportCatalog(input: AirportCatalogSyncInput): Promise<DownloadedAirportCatalog> {
  if (input.provider !== 'ourairports') {
    throw new GeographyServiceError('AIRPORT_PROVIDER_UNSUPPORTED', 'Provedor de aeroportos nao suportado.', 400)
  }
  let response: Response
  try {
    response = await fetch(OURAIRPORTS_AIRPORTS_CSV_URL, {
      headers: {
        Accept: 'text/csv,text/plain;q=0.9',
        'User-Agent': 'BBT-Corporativo/1.1 airport-catalog-sync',
      },
      signal: AbortSignal.timeout(120_000),
    })
  } catch (error) {
    throw new GeographyServiceError(
      'AIRPORT_PROVIDER_UNAVAILABLE',
      'Nao foi possivel acessar a base de aeroportos do OurAirports.',
      502,
      { cause: error instanceof Error ? error.name : 'unknown' },
    )
  }
  if (!response.ok) {
    throw new GeographyServiceError(
      'AIRPORT_PROVIDER_UNAVAILABLE',
      `O OurAirports respondeu com status ${response.status}.`,
      502,
    )
  }
  const csv = await response.text()
  return {
    provider: 'ourairports',
    sourceUrl: OURAIRPORTS_AIRPORTS_CSV_URL,
    checksum: sha256Text(csv),
    providerVersion: response.headers.get('etag'),
    referenceDate: parseReferenceDate(response.headers.get('last-modified')),
    records: parseOurAirportsCsv(csv),
  }
}

function validateAirportCatalog(downloaded: DownloadedAirportCatalog): void {
  const iataCount = downloaded.records.filter((record) => record.iataCode).length
  const scheduledCount = downloaded.records.filter((record) => record.scheduledService).length
  if (downloaded.records.length < 50_000 || iataCount < 5_000 || scheduledCount < 1_000) {
    throw new GeographyServiceError(
      'AIRPORT_PROVIDER_INCOMPLETE',
      'A carga do OurAirports parece incompleta e nao sera aplicada.',
      502,
      { records: downloaded.records.length, iata: iataCount, scheduled: scheduledCount },
    )
  }
}

async function applyAirportCatalog(
  client: PoolClient,
  principal: RequestPrincipal,
  runId: string,
  input: AirportCatalogSyncInput,
  downloaded: DownloadedAirportCatalog,
  startedAt: string,
): Promise<AirportCatalogSyncResult> {
  const lock = await client.query<{ locked: boolean }>(
    `select pg_try_advisory_xact_lock(hashtext($1)) as locked`,
    [`bbt:geography:airports:${input.provider}`],
  )
  if (!lock.rows[0]?.locked) {
    throw new GeographyServiceError(
      'AIRPORT_SYNC_IN_PROGRESS',
      'Ja existe uma sincronizacao de aeroportos em andamento.',
      409,
    )
  }

  const datasetVersionId = await activateDatasetVersion(client, input, downloaded)
  await createAirportStagingTable(client)
  const encodingResult = await client.query<{ server_encoding: string }>('show server_encoding')
  const serverEncoding = String(encodingResult.rows[0]?.server_encoding || 'UTF8')
  await stageAirportRecords(client, downloaded.records, serverEncoding)

  const stats = await client.query<{
    inserted: string | number
    updated: string | number
    unchanged: string | number
  }>(
    `select
       count(*) filter (where source.id is null) as inserted,
       count(*) filter (
         where source.id is not null
           and (not source.is_current or source.source_checksum_sha256 <> stage.source_checksum)
       ) as updated,
       count(*) filter (
         where source.id is not null
           and source.is_current and source.source_checksum_sha256 = stage.source_checksum
       ) as unchanged
     from airport_sync_stage stage
     left join geo_airport_sources source
       on source.provider = $1 and source.provider_id = stage.provider_id`,
    [input.provider],
  )

  await client.query(
    `update airport_sync_stage stage set airport_id = source.airport_id
     from geo_airport_sources source
     where source.provider = $1 and source.provider_id = stage.provider_id`,
    [input.provider],
  )
  await client.query(
    `update airport_sync_stage stage set airport_id = airport.id
     from geo_airports airport
     where stage.airport_id is null and airport.canonical_key = stage.canonical_key`,
  )
  await client.query(
    `insert into geo_airports (
       canonical_key, ident, iata_code, icao_code, gps_code, local_code,
       airport_type, name, normalized_name, municipality, normalized_municipality,
       country_code, subdivision_code, latitude, longitude, elevation_ft, timezone,
       scheduled_service, primary_provider, primary_provider_id,
       dataset_version_id, is_active, metadata, synced_at
     )
     select stage.canonical_key, stage.ident, stage.iata_code, stage.icao_code,
            stage.gps_code, stage.local_code, stage.airport_type, stage.name,
            stage.normalized_name, stage.municipality, stage.normalized_municipality,
            stage.country_code, stage.subdivision_code, stage.latitude, stage.longitude,
            stage.elevation_ft, stage.timezone, stage.scheduled_service, $1,
            stage.provider_id, $2, stage.is_operational, stage.metadata, now()
     from airport_sync_stage stage
     where stage.airport_id is null
     on conflict (canonical_key) do nothing`,
    [input.provider, datasetVersionId],
  )
  await client.query(
    `update airport_sync_stage stage set airport_id = airport.id
     from geo_airports airport
     where stage.airport_id is null and airport.canonical_key = stage.canonical_key`,
  )

  const unresolved = await client.query<{ count: string }>(
    `select count(*)::text as count from airport_sync_stage where airport_id is null`,
  )
  if (Number(unresolved.rows[0]?.count || 0) > 0) {
    throw new GeographyServiceError('AIRPORT_RECONCILIATION_FAILED', 'Ha aeroportos sem identidade canonica na carga.', 500)
  }

  await client.query(
    `update geo_airports airport set
       ident = stage.ident,
       iata_code = stage.iata_code,
       icao_code = stage.icao_code,
       gps_code = stage.gps_code,
       local_code = stage.local_code,
       airport_type = stage.airport_type,
       name = stage.name,
       normalized_name = stage.normalized_name,
       municipality = stage.municipality,
       normalized_municipality = stage.normalized_municipality,
       country_code = stage.country_code,
       subdivision_code = stage.subdivision_code,
       latitude = stage.latitude,
       longitude = stage.longitude,
       elevation_ft = stage.elevation_ft,
       timezone = stage.timezone,
       scheduled_service = stage.scheduled_service,
       primary_provider = $1,
       primary_provider_id = stage.provider_id,
       dataset_version_id = $2,
       is_active = stage.is_operational,
       metadata = stage.metadata,
       synced_at = now(),
       updated_at = now()
     from airport_sync_stage stage
     where airport.id = stage.airport_id`,
    [input.provider, datasetVersionId],
  )

  await client.query(
    `insert into geo_airport_sources (
       airport_id, provider, provider_id, dataset_version_id,
       source_checksum_sha256, is_current, metadata, synced_at
     )
     select stage.airport_id, $1, stage.provider_id, $2,
            stage.source_checksum, true, stage.metadata, now()
     from airport_sync_stage stage
     on conflict (provider, provider_id) do update set
       airport_id = excluded.airport_id,
       dataset_version_id = excluded.dataset_version_id,
       source_checksum_sha256 = excluded.source_checksum_sha256,
       is_current = true,
       metadata = excluded.metadata,
       synced_at = now(),
       updated_at = now()`,
    [input.provider, datasetVersionId],
  )

  await client.query(
    `delete from geo_airport_aliases alias
     using geo_airport_sources source
     where alias.airport_id = source.airport_id
       and alias.provider = $1
       and source.provider = $1`,
    [input.provider],
  )
  await client.query(
    `insert into geo_airport_aliases (
       airport_id, alias, normalized_alias, alias_type, provider
     )
     select candidate.airport_id, candidate.alias,
            candidate.normalized_alias, 'keyword', $1
     from (
       select distinct on (stage.airport_id, item.normalized_alias)
              stage.airport_id, item.alias, item.normalized_alias
       from airport_sync_stage stage
       cross join lateral jsonb_to_recordset(stage.aliases)
         item(alias text, normalized_alias text)
       where btrim(item.alias) <> '' and btrim(item.normalized_alias) <> ''
       order by stage.airport_id, item.normalized_alias,
                length(item.alias), item.alias collate "C"
     ) candidate
     on conflict (airport_id, normalized_alias) do update set
       alias = excluded.alias,
       alias_type = excluded.alias_type,
       provider = excluded.provider`,
    [input.provider],
  )

  let inactivated = 0
  if (input.deactivateMissing) {
    const result = await client.query(
      `update geo_airport_sources source set
         is_current = false, synced_at = now(), updated_at = now()
       where source.provider = $1 and source.is_current
         and not exists (
           select 1 from airport_sync_stage stage
           where stage.provider_id = source.provider_id
         )`,
      [input.provider],
    )
    inactivated = result.rowCount || 0
    await client.query(
      `update geo_airports airport set is_active = (
         airport.airport_type <> 'closed'
         and exists (
           select 1 from geo_airport_sources source
           where source.airport_id = airport.id and source.is_current
         )
       ), synced_at = now(), updated_at = now()
       where exists (
         select 1 from geo_airport_sources source
         where source.airport_id = airport.id and source.provider = $1
       )`,
      [input.provider],
    )
  }

  const finishedAt = new Date().toISOString()
  const inserted = Number(stats.rows[0]?.inserted || 0)
  const updated = Number(stats.rows[0]?.updated || 0)
  const unchanged = Number(stats.rows[0]?.unchanged || 0)
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
      downloaded.checksum,
      finishedAt,
      JSON.stringify({
        datasetVersionId,
        sourceUrl: downloaded.sourceUrl,
        providerVersion: downloaded.providerVersion,
        referenceDate: downloaded.referenceDate,
        airports: downloaded.records.length,
      }),
    ],
  )
  return {
    runId,
    provider: input.provider,
    datasetKey: 'airports',
    checksum: downloaded.checksum,
    inserted,
    updated,
    unchanged,
    inactivated,
    airports: downloaded.records.length,
    startedAt,
    finishedAt,
  }
}

async function activateDatasetVersion(
  client: PoolClient,
  input: AirportCatalogSyncInput,
  downloaded: DownloadedAirportCatalog,
): Promise<string> {
  const existing = await client.query<{ id: string; status: string }>(
    `select id, status from geo_dataset_versions
     where provider = $1 and dataset_key = $2 and checksum_sha256 = $3`,
    [input.provider, input.datasetKey, downloaded.checksum],
  )
  const row = existing.rows[0]
  if (row?.status === 'active') {
    await client.query(
      `update geo_dataset_versions set record_count = $2, source_url = $3,
         provider_version = $4, reference_date = $5::date, metadata = $6::jsonb
       where id = $1`,
      [
        row.id,
        downloaded.records.length,
        downloaded.sourceUrl,
        downloaded.providerVersion,
        downloaded.referenceDate,
        JSON.stringify({ airportCount: downloaded.records.length }),
      ],
    )
    return row.id
  }
  await client.query(
    `update geo_dataset_versions set status = 'superseded'
     where provider = $1 and dataset_key = $2 and status = 'active'`,
    [input.provider, input.datasetKey],
  )
  if (row) {
    await client.query(
      `update geo_dataset_versions set status = 'active', activated_at = now(),
         record_count = $2, source_url = $3, provider_version = $4,
         reference_date = $5::date, metadata = $6::jsonb
       where id = $1`,
      [
        row.id,
        downloaded.records.length,
        downloaded.sourceUrl,
        downloaded.providerVersion,
        downloaded.referenceDate,
        JSON.stringify({ airportCount: downloaded.records.length }),
      ],
    )
    return row.id
  }
  const inserted = await client.query<{ id: string }>(
    `insert into geo_dataset_versions (
       provider, dataset_key, provider_version, reference_date, checksum_sha256,
       record_count, status, source_url, activated_at, metadata
     ) values ($1, $2, $3, $4::date, $5, $6, 'active', $7, now(), $8::jsonb)
     returning id`,
    [
      input.provider,
      input.datasetKey,
      downloaded.providerVersion,
      downloaded.referenceDate,
      downloaded.checksum,
      downloaded.records.length,
      downloaded.sourceUrl,
      JSON.stringify({ airportCount: downloaded.records.length }),
    ],
  )
  return inserted.rows[0].id
}

async function createAirportStagingTable(client: PoolClient): Promise<void> {
  await client.query(
    `create temporary table airport_sync_stage (
       provider_id text primary key,
       airport_id uuid,
       canonical_key text not null,
       ident text not null,
       iata_code text,
       icao_code text,
       gps_code text,
       local_code text,
       airport_type text not null,
       name text not null,
       normalized_name text not null,
       municipality text,
       normalized_municipality text,
       country_code text not null,
       subdivision_code text,
       latitude numeric(10,7) not null,
       longitude numeric(10,7) not null,
       elevation_ft integer,
       timezone text,
       scheduled_service boolean not null,
       is_operational boolean not null,
       aliases jsonb not null,
       source_checksum char(64) not null,
       metadata jsonb not null
     ) on commit drop`,
  )
}

async function stageAirportRecords(
  client: PoolClient,
  records: AirportProviderRecord[],
  serverEncoding: string,
): Promise<void> {
  for (let index = 0; index < records.length; index += AIRPORT_SYNC_BATCH_SIZE) {
    const batch = records.slice(index, index + AIRPORT_SYNC_BATCH_SIZE)
      .map(toStageRow)
      .map((row) => sanitizeAirportStagePayload(row, serverEncoding))
    await client.query(
      `insert into airport_sync_stage (
         provider_id, canonical_key, ident, iata_code, icao_code, gps_code,
         local_code, airport_type, name, normalized_name, municipality,
         normalized_municipality, country_code, subdivision_code, latitude,
         longitude, elevation_ft, timezone, scheduled_service, is_operational,
         aliases, source_checksum, metadata
       )
       select provider_id, canonical_key, ident, iata_code, icao_code, gps_code,
              local_code, airport_type, name, normalized_name, municipality,
              normalized_municipality, country_code, subdivision_code, latitude,
              longitude, elevation_ft, timezone, scheduled_service, is_operational,
              aliases, source_checksum, metadata
       from jsonb_to_recordset($1::jsonb) as source(
         provider_id text, canonical_key text, ident text, iata_code text,
         icao_code text, gps_code text, local_code text, airport_type text,
         name text, normalized_name text, municipality text,
         normalized_municipality text, country_code text, subdivision_code text,
         latitude numeric, longitude numeric, elevation_ft integer, timezone text,
         scheduled_service boolean, is_operational boolean, aliases jsonb,
         source_checksum text, metadata jsonb
       )`,
      [JSON.stringify(batch)],
    )
  }
}

function toStageRow(record: AirportProviderRecord): Record<string, unknown> {
  return {
    provider_id: record.providerId,
    canonical_key: record.canonicalKey,
    ident: record.ident,
    iata_code: record.iataCode,
    icao_code: record.icaoCode,
    gps_code: record.gpsCode,
    local_code: record.localCode,
    airport_type: record.type,
    name: record.name,
    normalized_name: record.normalizedName,
    municipality: record.municipality,
    normalized_municipality: record.normalizedMunicipality,
    country_code: record.countryCode,
    subdivision_code: record.subdivisionCode,
    latitude: record.latitude,
    longitude: record.longitude,
    elevation_ft: record.elevationFt,
    timezone: record.timezone,
    scheduled_service: record.scheduledService,
    is_operational: record.isOperational,
    aliases: record.aliases.map((alias) => ({ alias, normalized_alias: normalizeAirportSearch(alias) })),
    source_checksum: record.sourceChecksum,
    metadata: record.metadata,
  }
}

function mapAirport(row: AirportRow): GeographyAirport {
  const shape: AirportProviderRecord = {
    providerId: row.primary_provider_id,
    canonicalKey: '',
    ident: row.ident.toUpperCase(),
    iataCode: row.iata_code?.toUpperCase() || null,
    icaoCode: row.icao_code?.toUpperCase() || null,
    gpsCode: null,
    localCode: null,
    type: row.airport_type,
    name: row.name,
    normalizedName: '',
    municipality: row.municipality,
    normalizedMunicipality: null,
    countryCode: row.country_code.toUpperCase(),
    subdivisionCode: row.subdivision_code?.toUpperCase() || null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    elevationFt: null,
    timezone: row.timezone,
    scheduledService: row.scheduled_service,
    isOperational: row.is_active,
    aliases: [],
    sourceChecksum: '',
    metadata: {},
  }
  return {
    id: row.id,
    iataCode: shape.iataCode,
    icaoCode: shape.icaoCode,
    ident: shape.ident,
    name: shape.name,
    municipality: shape.municipality,
    subdivisionCode: shape.subdivisionCode,
    countryCode: shape.countryCode,
    label: buildAirportLabel(shape),
    provider: row.primary_provider,
    providerId: row.primary_provider_id,
    scheduledService: row.scheduled_service,
    isActive: row.is_active,
    latitude: shape.latitude,
    longitude: shape.longitude,
    timezone: row.timezone,
    type: row.airport_type,
  }
}

function mapSyncRun(row: SyncRunRow): AirportCatalogSyncRunStatus {
  return {
    runId: row.id,
    provider: row.provider,
    datasetKey: 'airports',
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

function mapDatasetVersion(row: DatasetVersionRow): AirportCatalogDatasetVersion {
  return {
    id: row.id,
    provider: row.provider,
    datasetKey: 'airports',
    checksum: row.checksum_sha256,
    recordCount: Number(row.record_count),
    sourceUrl: row.source_url,
    activatedAt: new Date(row.activated_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseReferenceDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

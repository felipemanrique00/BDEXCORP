import { createHash } from 'node:crypto'

import Papa from 'papaparse'

import type { GeographyAirportType } from '@/lib/geography/types'

export const OURAIRPORTS_PROVIDER = 'ourairports' as const
export const OURAIRPORTS_DATASET_KEY = 'airports' as const
export const OURAIRPORTS_AIRPORTS_CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv'

export interface AirportProviderRecord {
  providerId: string
  canonicalKey: string
  ident: string
  iataCode: string | null
  icaoCode: string | null
  gpsCode: string | null
  localCode: string | null
  type: GeographyAirportType
  name: string
  normalizedName: string
  municipality: string | null
  normalizedMunicipality: string | null
  countryCode: string
  subdivisionCode: string | null
  latitude: number
  longitude: number
  elevationFt: number | null
  timezone: string | null
  scheduledService: boolean
  isOperational: boolean
  aliases: string[]
  sourceChecksum: string
  metadata: Record<string, unknown>
}

interface CsvAirportRow {
  id?: string
  ident?: string
  type?: string
  name?: string
  latitude_deg?: string
  longitude_deg?: string
  elevation_ft?: string
  continent?: string
  iso_country?: string
  iso_region?: string
  municipality?: string
  scheduled_service?: string
  gps_code?: string
  iata_code?: string
  local_code?: string
  home_link?: string
  wikipedia_link?: string
  keywords?: string
}

export function parseOurAirportsCsv(csv: string): AirportProviderRecord[] {
  const parsed = Papa.parse<CsvAirportRow>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })
  const fatalError = parsed.errors.find((error) => error.code !== 'UndetectableDelimiter')
  if (fatalError) {
    throw new Error(`CSV OurAirports invalido na linha ${fatalError.row ?? 0}: ${fatalError.message}`)
  }

  const records = parsed.data.flatMap(parseRow)
  const providerIds = new Set<string>()
  for (const record of records) {
    if (providerIds.has(record.providerId)) {
      throw new Error(`CSV OurAirports possui ID duplicado: ${record.providerId}`)
    }
    providerIds.add(record.providerId)
  }

  // Codigos IATA/ICAO normalmente sao unicos, mas a fonte pode manter um
  // aeroporto fechado com codigo reaproveitado. Nesses casos nao mesclamos
  // entidades: a identidade cai para o ID imutavel do provedor.
  const keyCounts = new Map<string, number>()
  for (const record of records) {
    const candidate = canonicalCodeKey(record)
    if (candidate) keyCounts.set(candidate, (keyCounts.get(candidate) || 0) + 1)
  }
  for (const record of records) {
    const candidate = canonicalCodeKey(record)
    record.canonicalKey = candidate && keyCounts.get(candidate) === 1
      ? candidate
      : `${OURAIRPORTS_PROVIDER}:${record.providerId}`
  }

  return records.sort((left, right) => left.providerId.localeCompare(right.providerId, 'en'))
}

export function normalizeAirportSearch(value: string): string {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function buildAirportLabel(input: Pick<
  AirportProviderRecord,
  'iataCode' | 'icaoCode' | 'ident' | 'name' | 'municipality' | 'subdivisionCode' | 'countryCode'
>): string {
  const code = input.iataCode || input.icaoCode || input.ident
  const location = [
    input.municipality,
    input.subdivisionCode || input.countryCode,
  ].filter(Boolean).join('/')
  return `${code} — ${input.name}${location ? ` · ${location}` : ''}`
}

function parseRow(row: CsvAirportRow): AirportProviderRecord[] {
  const providerId = clean(row.id)
  const ident = upperCode(row.ident, 2, 16)
  const name = clean(row.name)
  const countryCode = upperCode(row.iso_country, 2, 2, /^[A-Z]{2}$/)
  const latitude = finiteNumber(row.latitude_deg)
  const longitude = finiteNumber(row.longitude_deg)
  if (!providerId || !ident || !name || !countryCode || latitude === null || longitude === null) return []
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return []

  const airportType = mapAirportType(row.type)
  const iataCode = upperCode(row.iata_code, 3, 3, /^[A-Z0-9]{3}$/)
  const gpsCode = upperCode(row.gps_code, 2, 8, /^[A-Z0-9]+$/)
  const identIcao = /^[A-Z0-9]{4}$/.test(ident) ? ident : null
  const icaoCode = gpsCode && /^[A-Z0-9]{4}$/.test(gpsCode) ? gpsCode : identIcao
  const localCode = upperCode(row.local_code, 1, 16, /^[A-Z0-9-]+$/)
  const municipality = clean(row.municipality)
  const subdivisionCode = normalizeSubdivisionCode(row.iso_region, countryCode)
  const aliases = uniqueAliases([
    ident,
    gpsCode,
    localCode,
    ...(clean(row.keywords)?.split(/[,;]/) || []),
  ], [name, iataCode, icaoCode])
  const metadata = compactObject({
    continent: clean(row.continent),
    homeLink: clean(row.home_link),
    wikipediaLink: clean(row.wikipedia_link),
  })
  const sourceShape = {
    providerId,
    ident,
    iataCode,
    icaoCode,
    gpsCode,
    localCode,
    type: airportType,
    name,
    municipality,
    countryCode,
    subdivisionCode,
    latitude,
    longitude,
    elevationFt: integerNumber(row.elevation_ft),
    scheduledService: String(row.scheduled_service || '').trim().toLowerCase() === 'yes',
    aliases,
    metadata,
  }

  return [{
    ...sourceShape,
    canonicalKey: '',
    normalizedName: normalizeAirportSearch(name),
    normalizedMunicipality: municipality ? normalizeAirportSearch(municipality) : null,
    timezone: null,
    isOperational: airportType !== 'closed',
    sourceChecksum: sha256(sourceShape),
  }]
}

function canonicalCodeKey(record: AirportProviderRecord): string | null {
  if (record.iataCode) return `iata:${record.iataCode}`
  if (record.icaoCode) return `icao:${record.icaoCode}`
  return null
}

function mapAirportType(value: unknown): GeographyAirportType {
  const normalized = clean(value)?.toLowerCase()
  if (normalized === 'large_airport') return 'large_airport'
  if (normalized === 'medium_airport') return 'medium_airport'
  if (normalized === 'small_airport') return 'small_airport'
  if (normalized === 'heliport') return 'heliport'
  if (normalized === 'seaplane_base') return 'seaplane_base'
  if (normalized === 'balloonport') return 'balloonport'
  if (normalized === 'closed') return 'closed'
  return 'other'
}

function normalizeSubdivisionCode(value: unknown, countryCode: string): string | null {
  const raw = clean(value)?.toUpperCase()
  if (!raw) return null
  const prefix = `${countryCode}-`
  const code = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  return /^[A-Z0-9-]{2,16}$/.test(code) ? code : null
}

function upperCode(
  value: unknown,
  minimum: number,
  maximum: number,
  pattern: RegExp = /^[A-Z0-9-]+$/,
): string | null {
  const normalized = clean(value)?.toUpperCase()
  if (!normalized || normalized.length < minimum || normalized.length > maximum || !pattern.test(normalized)) return null
  return normalized
}

function uniqueAliases(values: Array<string | null>, excluded: Array<string | null>): string[] {
  const excludedNormalized = new Set(excluded.filter(Boolean).map((value) => normalizeAirportSearch(String(value))))
  const aliases = new Map<string, string>()
  for (const value of values) {
    const alias = clean(value)
    if (!alias) continue
    const normalized = normalizeAirportSearch(alias)
    if (!normalized || excludedNormalized.has(normalized)) continue
    aliases.set(normalized, alias)
  }
  return [...aliases.values()].slice(0, 40)
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function integerNumber(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed === null || !Number.isSafeInteger(parsed) ? null : parsed
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ''))
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

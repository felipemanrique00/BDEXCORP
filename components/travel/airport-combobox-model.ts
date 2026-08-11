export interface AirportOption {
  id: string
  iataCode: string
  icaoCode: string | null
  name: string
  municipality: string
  subdivisionCode: string | null
  countryCode: string
  label: string
}

export const AIRPORT_SEARCH_DEBOUNCE_MS = 250
export const MIN_AIRPORT_QUERY_LENGTH = 2

export function formatAirportLegacyValue(airport: AirportOption): string {
  const iataCode = airport.iataCode.trim().toUpperCase()
  const fallbackLocation = [airport.municipality, airport.subdivisionCode].filter(Boolean).join('/')
  const fallbackDetails = [airport.name, fallbackLocation].filter(Boolean).join(' · ')
  const labelWithoutCode = airport.label
    .trim()
    .replace(new RegExp(`^${escapeRegExp(iataCode)}\\s*(?:[-–—:|·]\\s*)?`, 'i'), '')
    .trim()
  const details = labelWithoutCode || fallbackDetails
  if (!iataCode) return details
  return details ? `${iataCode} - ${details}` : iataCode
}

export function buildAirportSearchUrl(query: string, limit = 20): string {
  const normalizedQuery = airportSearchQuery(query)
  const params = new URLSearchParams({
    q: normalizedQuery,
    limit: String(normalizeAirportSearchLimit(limit)),
  })
  return `/api/geography/airports?${params.toString()}`
}

export function airportSearchQuery(value: string): string {
  const trimmed = value.trim()
  const legacyCode = /^([A-Za-z0-9]{3})\s*[-–—:|·]/.exec(trimmed)?.[1]
  return legacyCode ? legacyCode.toUpperCase() : trimmed
}

export function parseAirportSearchResponse(payload: unknown): AirportOption[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return []
  return payload.items.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = readString(item.id)
    const iataCode = readString(item.iataCode).toUpperCase()
    const name = readString(item.name)
    const municipality = readString(item.municipality)
    const countryCode = readString(item.countryCode).toUpperCase()
    const label = readString(item.label)
    if (!id || !/^[A-Z]{3}$/.test(iataCode) || !name || !label) return []
    return [{
      id,
      iataCode,
      icaoCode: readNullableString(item.icaoCode),
      name,
      municipality,
      subdivisionCode: readNullableString(item.subdivisionCode),
      countryCode,
      label,
    }]
  })
}

export function isAirportCatalogReady(payload: unknown): boolean {
  return !isRecord(payload) || payload.catalogReady !== false
}

export function normalizeAirportSearchLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20
  return Math.min(50, Math.max(1, Math.trunc(limit)))
}

export function readAirportApiError(payload: unknown): string {
  if (!isRecord(payload)) return ''
  return readString(payload.error) || readString(payload.message)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNullableString(value: unknown): string | null {
  return readString(value) || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

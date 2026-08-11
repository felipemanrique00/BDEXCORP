export interface AirlineOption {
  id: string
  iataCode: string
  icaoCode: string | null
  name: string
  displayName: string
  countryCode: string
  logoPath: string | null
  aliases: string[]
}

export const AIRLINE_SEARCH_DEBOUNCE_MS = 250
export const MIN_AIRLINE_QUERY_LENGTH = 1

export function buildAirlineSearchUrl(query: string, limit = 20): string {
  const params = new URLSearchParams({
    q: airlineSearchQuery(query),
    limit: String(normalizeAirlineSearchLimit(limit)),
  })
  return `/api/geography/airlines?${params.toString()}`
}

export function airlineSearchQuery(value: string): string {
  const trimmed = value.trim()
  const legacyCode = /^([A-Za-z0-9]{2,3})\s*[-–—:|·]/.exec(trimmed)?.[1]
  return legacyCode ? legacyCode.toUpperCase() : trimmed
}

export function formatAirlineLegacyValue(airline: Pick<AirlineOption, 'iataCode' | 'name' | 'displayName'>): string {
  const code = airline.iataCode.trim().toUpperCase()
  const name = (airline.displayName || airline.name).trim()
  if (!code) return name
  return name ? `${code} - ${name}` : code
}

export function parseAirlineSearchResponse(payload: unknown): AirlineOption[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return []

  return payload.items.flatMap((item) => {
    if (!isRecord(item)) return []

    const id = readString(item.id)
    const iataCode = readString(item.iataCode).toUpperCase()
    const name = readString(item.name)
    const displayName = readString(item.displayName) || name
    if (!id || !/^[A-Z0-9]{2}$/.test(iataCode) || !name) return []

    return [{
      id,
      iataCode,
      icaoCode: readNullableString(item.icaoCode)?.toUpperCase() || null,
      name,
      displayName,
      countryCode: readString(item.countryCode).toUpperCase(),
      logoPath: readNullableString(item.logoPath),
      aliases: Array.isArray(item.aliases)
        ? item.aliases.map(readString).filter(Boolean)
        : [],
    }]
  })
}

export function normalizeAirlineSearchLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20
  return Math.min(50, Math.max(1, Math.trunc(limit)))
}

export function readAirlineApiError(payload: unknown): string {
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

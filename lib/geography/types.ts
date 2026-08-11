export interface GeographyCountry {
  id: string
  isoAlpha2: string
  isoAlpha3: string | null
  numericCode: string | null
  name: string
  officialName: string | null
  provider: string
  providerId: string
  isActive: boolean
  syncedAt: string
}

export interface GeographySubdivision {
  id: string
  countryId: string
  code: string
  name: string
  type: string
  provider: string
  providerId: string
  isActive: boolean
  syncedAt: string
}

export interface GeographyCity {
  id: string
  countryId: string
  subdivisionId: string | null
  subdivisionCode: string | null
  name: string
  provider: string
  providerId: string
  isActive: boolean
  syncedAt: string
}

export interface GeographySyncResult {
  runId: string
  provider: 'ibge'
  datasetKey: string
  checksum: string
  inserted: number
  updated: number
  unchanged: number
  inactivated: number
  countries: number
  subdivisions: number
  cities: number
  startedAt: string
  finishedAt: string
}

export interface GeographySyncRunStatus {
  runId: string
  provider: 'ibge'
  datasetKey: 'brazil' | 'countries'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  inserted: number
  updated: number
  unchanged: number
  inactivated: number
  errors: number
  checksum: string | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
}

export interface GeographyDatasetVersion {
  id: string
  provider: 'ibge'
  datasetKey: 'brazil' | 'countries'
  checksum: string
  recordCount: number
  sourceUrl: string | null
  activatedAt: string
  createdAt: string
}

export interface GeographySyncStatus {
  latestRun: GeographySyncRunStatus | null
  datasetVersion: GeographyDatasetVersion | null
}

export type GeographyAirportType =
  | 'large_airport'
  | 'medium_airport'
  | 'small_airport'
  | 'heliport'
  | 'seaplane_base'
  | 'balloonport'
  | 'closed'
  | 'other'

export interface GeographyAirport {
  id: string
  iataCode: string | null
  icaoCode: string | null
  ident: string
  name: string
  municipality: string | null
  subdivisionCode: string | null
  countryCode: string
  label: string
  provider: string
  providerId: string
  scheduledService: boolean
  isActive: boolean
  latitude: number
  longitude: number
  timezone: string | null
  type: GeographyAirportType
}

export interface AirportCatalogSyncResult {
  runId: string
  provider: string
  datasetKey: 'airports'
  checksum: string
  inserted: number
  updated: number
  unchanged: number
  inactivated: number
  airports: number
  startedAt: string
  finishedAt: string
}

export interface AirportCatalogSyncRunStatus {
  runId: string
  provider: string
  datasetKey: 'airports'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  inserted: number
  updated: number
  unchanged: number
  inactivated: number
  errors: number
  checksum: string | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
}

export interface AirportCatalogDatasetVersion {
  id: string
  provider: string
  datasetKey: 'airports'
  checksum: string
  recordCount: number
  sourceUrl: string | null
  activatedAt: string
  createdAt: string
}

export interface AirportCatalogSyncStatus {
  latestRun: AirportCatalogSyncRunStatus | null
  datasetVersion: AirportCatalogDatasetVersion | null
}

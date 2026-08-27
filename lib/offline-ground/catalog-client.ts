'use client'

export interface GroundRentalLocationOption {
  id: string
  supplierId: string
  supplierName: string
  name: string
  cityId: string | null
  cityName: string | null
  addressText: string | null
  airportIata: string | null
  timezone: string
  reviewStatus: 'verified'
}

export interface GroundBusTerminalOption {
  id: string
  name: string
  cityId: string
  cityName: string
  addressText: string | null
  timezone: string
  reviewStatus: 'verified'
}

export interface GroundSupplierOption {
  id: string
  name: string
  service: 'car' | 'bus'
}

export interface GroundBusRouteOption {
  id: string
  supplierId: string
  routeCode: string
  label: string
}

export type GroundRequestCatalog =
  | { service: 'car'; suppliers: GroundSupplierOption[]; rentalLocations: GroundRentalLocationOption[]; busTerminals?: never; busRoutes?: never }
  | { service: 'bus'; suppliers: GroundSupplierOption[]; busTerminals: GroundBusTerminalOption[]; busRoutes: GroundBusRouteOption[]; rentalLocations?: never }

export async function listGroundRequestCatalogFromServer(input: {
  service: 'car' | 'bus'
  q?: string
  cityId?: string
  signal?: AbortSignal
}): Promise<GroundRequestCatalog> {
  const search = new URLSearchParams({ service: input.service })
  if (input.q?.trim()) search.set('q', input.q.trim())
  if (input.cityId?.trim()) search.set('cityId', input.cityId.trim())
  const response = await fetch(`/api/offline-travel/ground/catalog?${search}`, {
    cache: 'no-store',
    signal: input.signal,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true || payload?.service !== input.service) {
    throw new Error(String(payload?.error || 'Nao foi possivel carregar o catalogo terrestre aprovado.'))
  }
  if (input.service === 'car') {
    return {
      service: 'car',
      suppliers: Array.isArray(payload.suppliers) ? payload.suppliers : [],
      rentalLocations: Array.isArray(payload.rentalLocations) ? payload.rentalLocations : [],
    }
  }
  return {
    service: 'bus',
    suppliers: Array.isArray(payload.suppliers) ? payload.suppliers : [],
    busTerminals: Array.isArray(payload.busTerminals) ? payload.busTerminals : [],
    busRoutes: Array.isArray(payload.busRoutes) ? payload.busRoutes : [],
  }
}

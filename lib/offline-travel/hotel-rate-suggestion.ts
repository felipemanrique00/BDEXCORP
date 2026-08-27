'use client'

export type HotelRateSuggestionScope = 'company' | 'group' | 'global'
export type HotelRateSuggestionSource = 'catalog' | 'last_emission'

export interface HotelRateSuggestion {
  hotelId: string
  hotelSupplierId: string
  supplierId: string
  supplierName: string
  supplierCode: string
  roomTypeId: string | null
  roomCategory: string
  source: HotelRateSuggestionSource
  rateId: string | null
  rateVersion: number | null
  emissionObservationId: string | null
  emissionId: string | null
  observedAt: string | null
  nightlyRate: number
  nightlyTaxes: number
  serviceFee: number
  currency: string
  refundable: boolean
  mealPlan: string | null
  cancellationPolicy: string | null
  paymentTerms: string | null
  scope: HotelRateSuggestionScope
  scopeLabel: string
  outsideValidity: boolean
  outOfPeriodPolicy: 'block' | 'warn' | 'allow'
}

export interface HotelRateSuggestionResult {
  demandId: string
  companyId: string
  groupId: string | null
  checkIn: string
  checkOut: string
  occupancyType: string | null
  items: HotelRateSuggestion[]
  manualReason: string | null
}

export async function listHotelRateSuggestions(
  demandId: string,
  signal?: AbortSignal,
): Promise<HotelRateSuggestionResult> {
  const normalizedDemandId = String(demandId || '').trim()
  if (!normalizedDemandId) throw new Error('Informe a demanda para consultar as tarifas cadastradas.')

  const response = await fetch(
    `/api/offline-travel/hotel-rate-suggestions?${new URLSearchParams({ demandId: normalizedDemandId })}`,
    { cache: 'no-store', signal },
  )
  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    result?: HotelRateSuggestionResult
    error?: string
  } | null
  if (!response.ok || payload?.ok !== true || !payload.result) {
    throw new Error(payload?.error || 'Nao foi possivel consultar as tarifas cadastradas.')
  }
  return payload.result
}

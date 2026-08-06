import { formatMinorUnits, moneyToMinorUnits } from '@/lib/offline-travel/money'

import type {
  OfflineAirPriceDraft,
  OfflineAirQuoteOptionDraft,
  OfflineAirQuoteSegmentDraft,
  OfflineAirRequestedSegment,
} from './types'

export const MIN_AIR_QUOTE_OPTIONS = 1
export const MAX_AIR_QUOTE_OPTIONS = 10
export const MAX_AIR_SEGMENTS = 12

export function airQuoteTotalMinor(pricing: Pick<OfflineAirPriceDraft, 'fare' | 'taxes' | 'rav' | 'rac'>): number {
  return moneyMinorOrZero(pricing.fare)
    + moneyMinorOrZero(pricing.taxes)
    + moneyMinorOrZero(pricing.rav)
    + moneyMinorOrZero(pricing.rac)
}

export function formatAirMoney(minorUnits: number, currency = 'BRL'): string {
  const amount = Number(formatMinorUnits(minorUnits))
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
    }).format(amount)
  } catch {
    return `${currency || 'BRL'} ${amount.toFixed(2)}`
  }
}

export function createEmptyAirSegment(
  sequence: number,
  requested?: OfflineAirRequestedSegment,
): OfflineAirQuoteSegmentDraft {
  return {
    clientId: createClientId('segment', sequence),
    airlineCode: '',
    airlineName: '',
    flightNumber: '',
    bookingClass: '',
    cabinClass: '',
    baggagePieces: '0',
    originCode: requested?.originCode || '',
    originName: requested?.originName || '',
    destinationCode: requested?.destinationCode || '',
    destinationName: requested?.destinationName || '',
    departureAt: requested?.departureDate ? `${requested.departureDate}T00:00` : '',
    arrivalAt: requested?.departureDate ? `${requested.departureDate}T00:00` : '',
    equipment: '',
  }
}

export function createEmptyAirQuoteOption(
  sequence: number,
  requestedSegments: OfflineAirRequestedSegment[] = [],
): OfflineAirQuoteOptionDraft {
  const initialSegments = requestedSegments.length
    ? requestedSegments.map((segment, index) => createEmptyAirSegment(index + 1, segment))
    : [createEmptyAirSegment(1)]

  return {
    clientId: createClientId('air-option', sequence),
    reservationSystem: '',
    locator: '',
    fareFamily: '',
    refundable: false,
    issuanceDeadline: '',
    segments: initialSegments,
    pricing: {
      currency: 'BRL',
      fare: '',
      taxes: '0',
      rav: '0',
      rac: '0',
      exchangeRate: '1',
      referenceFare: '0',
      mileage: '0',
    },
    fareRules: '',
    cancellationPolicy: '',
    changePolicy: '',
    observations: '',
  }
}

export function isValidMoneyInput(value: string, required = false): boolean {
  if (!String(value || '').trim()) return !required
  try {
    moneyToMinorUnits(value)
    return true
  } catch {
    return false
  }
}

function moneyMinorOrZero(value: string): number {
  if (!String(value || '').trim()) return 0
  try {
    return moneyToMinorUnits(value)
  } catch {
    return 0
  }
}

function createClientId(prefix: string, sequence: number): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}-${cryptoApi.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${sequence}`
}

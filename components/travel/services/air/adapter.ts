import type {
  OfflineAirQuoteCreateInput,
  OfflineAirQuoteOptionInput,
  OfflineAirQuoteSegmentInput,
} from '@/lib/offline-travel/services/air/schema'
import type {
  OfflineAirQuoteOptionReadModel as ServerAirQuoteOption,
  OfflineAirQuoteReadModel as ServerAirQuote,
  OfflineAirQuoteSegmentReadModel as ServerAirQuoteSegment,
} from '@/lib/offline-travel/services/air/read-model'

import { airQuoteTotalMinor } from './pricing'
import type {
  OfflineAirQuoteFormValue,
  OfflineAirQuoteOptionDraft,
  OfflineAirQuoteOptionReadModel,
  OfflineAirQuoteRoundReadModel,
  OfflineAirQuoteSegmentDraft,
} from './types'

export interface OfflineAirQuoteSubmitMetadata {
  expectedLifecycleVersion?: number
  expiresAt?: string
  policyJustification?: string
  idempotencyKey: string
}

/**
 * Fronteira explícita entre os campos amigáveis da UI e o contrato canônico do
 * backend. Datas locais viram ISO com offset e valores monetários viram number.
 */
export function toOfflineAirQuoteCreateInput(
  value: OfflineAirQuoteFormValue,
  metadata: OfflineAirQuoteSubmitMetadata,
): OfflineAirQuoteCreateInput {
  return {
    demandId: value.demandId,
    expectedLifecycleVersion: metadata.expectedLifecycleVersion,
    expiresAt: optionalIso(metadata.expiresAt),
    policyJustification: optionalText(metadata.policyJustification),
    confirmed: true,
    idempotencyKey: metadata.idempotencyKey,
    options: value.options.map(toServerOption),
  }
}

export function toOfflineAirQuoteRoundReadModel(quote: ServerAirQuote): OfflineAirQuoteRoundReadModel {
  return {
    id: quote.id,
    demandId: quote.demandId,
    expiresAt: quote.expiresAt,
    options: quote.options.map((option, index) => toUiOption(option, index)),
  }
}

export function toOfflineAirQuoteOptionReadModel(
  option: ServerAirQuoteOption,
  optionNumber = 0,
): OfflineAirQuoteOptionReadModel {
  return toUiOption(option, optionNumber)
}

function toServerOption(option: OfflineAirQuoteOptionDraft): OfflineAirQuoteOptionInput {
  const primarySegment = requirePrimarySegment(option)
  const cabinClass = requireCabinClass(primarySegment)
  const segmentBaggage = option.segments.map((segment) => integerValue(segment.baggagePieces, 0))

  return {
    clientId: option.clientId,
    reservationSystem: option.reservationSystem.trim(),
    locator: optionalText(option.locator),
    airlineCode: primarySegment.airlineCode.trim().toUpperCase(),
    airlineName: primarySegment.airlineName.trim(),
    cabinClass,
    fareFamily: optionalText(option.fareFamily),
    baggagePieces: Math.max(0, ...segmentBaggage),
    issuanceDeadline: optionalIso(option.issuanceDeadline),
    exchangeRate: decimalValue(option.pricing.exchangeRate || '1'),
    mileage: integerValue(option.pricing.mileage, 0),
    referenceFare: decimalValue(option.pricing.referenceFare || '0'),
    fare: decimalValue(option.pricing.fare),
    taxes: decimalValue(option.pricing.taxes || '0'),
    rav: decimalValue(option.pricing.rav || '0'),
    rac: decimalValue(option.pricing.rac || '0'),
    currency: option.pricing.currency.trim().toUpperCase(),
    refundable: option.refundable,
    fareRules: optionalText(option.fareRules),
    cancellationPolicy: optionalText(option.cancellationPolicy),
    changePolicy: optionalText(option.changePolicy),
    notes: optionalText(option.observations),
    segments: option.segments.map(toServerSegment),
  }
}

function toServerSegment(segment: OfflineAirQuoteSegmentDraft, index: number): OfflineAirQuoteSegmentInput {
  return {
    sequence: index + 1,
    airlineCode: segment.airlineCode.trim().toUpperCase(),
    airlineName: segment.airlineName.trim(),
    flightNumber: segment.flightNumber.trim().toUpperCase(),
    bookingClass: segment.bookingClass.trim().toUpperCase(),
    cabinClass: requireCabinClass(segment),
    baggagePieces: integerValue(segment.baggagePieces, 0),
    originCode: segment.originCode.trim().toUpperCase(),
    originName: optionalText(segment.originName),
    destinationCode: segment.destinationCode.trim().toUpperCase(),
    destinationName: optionalText(segment.destinationName),
    departsAt: requiredIso(segment.departureAt, 'saída'),
    arrivesAt: requiredIso(segment.arrivalAt, 'chegada'),
    equipment: optionalText(segment.equipment),
  }
}

function toUiOption(option: ServerAirQuoteOption, index: number): OfflineAirQuoteOptionReadModel {
  const draft: Omit<OfflineAirQuoteOptionReadModel, 'id' | 'optionNumber' | 'totalMinor'> = {
    reservationSystem: option.reservationSystem,
    locator: option.locator || '',
    fareFamily: option.fareFamily || '',
    refundable: option.refundable === true,
    issuanceDeadline: localDateTimeValue(option.issuanceDeadline),
    segments: option.segments.map(toUiSegment),
    pricing: {
      currency: option.pricing.currency,
      fare: moneyInput(option.pricing.fare),
      taxes: moneyInput(option.pricing.taxes),
      rav: moneyInput(option.pricing.rav),
      rac: moneyInput(option.pricing.rac),
      exchangeRate: String(option.pricing.exchangeRate),
      referenceFare: moneyInput(option.pricing.referenceFare),
      mileage: String(option.pricing.mileage),
    },
    fareRules: option.fareRules || '',
    cancellationPolicy: option.cancellationPolicy || '',
    changePolicy: option.changePolicy || '',
    observations: option.notes || '',
  }

  return {
    id: option.id,
    optionNumber: index + 1,
    totalMinor: airQuoteTotalMinor(draft.pricing),
    ...draft,
  }
}

function toUiSegment(segment: ServerAirQuoteSegment): OfflineAirQuoteSegmentDraft {
  return {
    clientId: segment.id,
    airlineCode: segment.airlineCode,
    airlineName: segment.airlineName,
    flightNumber: segment.flightNumber,
    bookingClass: segment.bookingClass,
    cabinClass: segment.cabinClass,
    baggagePieces: String(segment.baggagePieces),
    originCode: segment.originCode,
    originName: segment.originName || '',
    destinationCode: segment.destinationCode,
    destinationName: segment.destinationName || '',
    departureAt: localDateTimeValue(segment.departsAt),
    arrivalAt: localDateTimeValue(segment.arrivesAt),
    equipment: segment.equipment || '',
  }
}

function requirePrimarySegment(option: OfflineAirQuoteOptionDraft): OfflineAirQuoteSegmentDraft {
  const segment = option.segments[0]
  if (!segment) throw new Error('A opção aérea deve possuir pelo menos um trecho.')
  return segment
}

function requireCabinClass(segment: OfflineAirQuoteSegmentDraft): Exclude<OfflineAirQuoteSegmentDraft['cabinClass'], ''> {
  if (!segment.cabinClass) throw new Error('Informe a cabine de todos os trechos.')
  return segment.cabinClass
}

function optionalText(value: string | null | undefined): string | undefined {
  return String(value || '').trim() || undefined
}

function decimalValue(value: string): number {
  const normalized = String(value || '').trim().replace(',', '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Informe um valor numérico válido.')
  return parsed
}

function integerValue(value: string, fallback: number): number {
  const normalized = String(value || '').trim()
  if (!normalized) return fallback
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Informe um valor inteiro válido.')
  return parsed
}

function optionalIso(value: string | null | undefined): string | undefined {
  const normalized = String(value || '').trim()
  return normalized ? requiredIso(normalized, 'data e hora') : undefined
}

function requiredIso(value: string, label: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Informe ${label} válida.`)
  return parsed.toISOString()
}

function localDateTimeValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function moneyInput(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

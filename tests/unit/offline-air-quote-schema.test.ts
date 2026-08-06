import { describe, expect, it } from 'vitest'

import {
  offlineAirQuoteCreateSchema,
  offlineAirQuoteOptionSchema,
} from '@/lib/offline-travel/services/air/schema'

function segment(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    sequence,
    airlineCode: 'LA',
    airlineName: 'LATAM Airlines',
    flightNumber: String(3374 + sequence),
    bookingClass: 'V',
    cabinClass: 'economy',
    baggagePieces: 0,
    originCode: sequence === 1 ? 'REC' : 'GRU',
    originName: sequence === 1 ? 'Recife' : 'Guarulhos',
    destinationCode: sequence === 1 ? 'GRU' : 'GYN',
    destinationName: sequence === 1 ? 'Guarulhos' : 'Goiania',
    departsAt: sequence === 1
      ? '2030-08-11T02:45:00-03:00'
      : '2030-08-11T07:15:00-03:00',
    arrivesAt: sequence === 1
      ? '2030-08-11T06:00:00-03:00'
      : '2030-08-11T08:55:00-03:00',
    ...overrides,
  }
}

function option(clientId = 'air-option-1') {
  return {
    clientId,
    reservationSystem: 'SKYTEAM',
    locator: 'LA9574809IUEI',
    airlineCode: 'la',
    airlineName: 'LATAM Airlines',
    cabinClass: 'economy',
    fareFamily: 'Economica promocional',
    baggagePieces: 0,
    issuanceDeadline: '2030-08-10T23:30:00-03:00',
    exchangeRate: 1,
    mileage: 0,
    referenceFare: '9856.52',
    fare: '3678,74',
    taxes: '110,96',
    rav: 0,
    rac: 15,
    refundable: false,
    fareRules: 'Tarifa sujeita a alteracao no ato da emissao.',
    cancellationPolicy: 'Nao reembolsavel.',
    changePolicy: 'Alteracao mediante multa e diferenca tarifaria.',
    segments: [segment(1), segment(2)],
  }
}

describe('offline air quote schema', () => {
  it('normalizes airline, airport and monetary fields', () => {
    const parsed = offlineAirQuoteOptionSchema.parse(option())

    expect(parsed.airlineCode).toBe('LA')
    expect(parsed.fare).toBe(3678.74)
    expect(parsed.taxes).toBe(110.96)
    expect(parsed.segments[0].originCode).toBe('REC')
  })

  it('accepts one to ten independent options', () => {
    const parsed = offlineAirQuoteCreateSchema.parse({
      demandId: 'air-demand-1',
      expectedLifecycleVersion: 4,
      expiresAt: '2030-08-10T23:30:00-03:00',
      confirmed: true,
      idempotencyKey: 'air-quote-create-001',
      options: [option('air-1'), option('air-2')],
    })

    expect(parsed.options).toHaveLength(2)
  })

  it('rejects duplicate client ids and more than ten options', () => {
    expect(offlineAirQuoteCreateSchema.safeParse({
      demandId: 'air-demand-1',
      confirmed: true,
      idempotencyKey: 'air-quote-create-001',
      options: [option('same'), option('same')],
    }).success).toBe(false)
    expect(offlineAirQuoteCreateSchema.safeParse({
      demandId: 'air-demand-1',
      confirmed: true,
      idempotencyKey: 'air-quote-create-002',
      options: Array.from({ length: 11 }, (_, index) => option(`air-${index}`)),
    }).success).toBe(false)
  })

  it('requires a continuous, chronological itinerary', () => {
    expect(offlineAirQuoteOptionSchema.safeParse({
      ...option(),
      segments: [segment(1), segment(3)],
    }).success).toBe(false)
    expect(offlineAirQuoteOptionSchema.safeParse({
      ...option(),
      segments: [segment(1), segment(2, { originCode: 'BSB' })],
    }).success).toBe(false)
    expect(offlineAirQuoteOptionSchema.safeParse({
      ...option(),
      segments: [segment(1), segment(2, { departsAt: '2030-08-11T05:30:00-03:00' })],
    }).success).toBe(false)
  })

  it('requires the ticketing deadline before departure', () => {
    expect(offlineAirQuoteOptionSchema.safeParse({
      ...option(),
      issuanceDeadline: '2030-08-11T02:45:00-03:00',
    }).success).toBe(false)
  })
})

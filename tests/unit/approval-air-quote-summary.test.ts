import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  approvalPolicyLabel,
  buildApprovalSubjectPresentation,
  extractAirQuoteApprovalSummary,
  extractHotelQuoteApprovalSummary,
} from '@/lib/approvals/subject-presentation'

const subject = {
  amount: 3804.70,
  currency: 'BRL',
  product: 'aereo',
  quoteSnapshot: {
    version: 1,
    serviceKey: 'aereo',
    demand: {
      id: 'private-demand-id',
      number: 'OS-20260805-0003',
      passengerName: 'Alexandre Paiva Bezerra',
      destination: 'Goiania',
    },
    quote: {
      id: 'private-quote-id',
      optionCount: 2,
      expiresAt: '2026-08-05T23:30:00.000Z',
    },
    option: {
      id: 'private-option-id',
      supplierName: 'LATAM Airlines',
      title: 'LATAM Airlines - REC - GYN',
      amount: 3804.70,
      currency: 'BRL',
      refundable: false,
      breakdown: {
        fare: 3678.74,
        taxes: 110.96,
        rav: 0,
        rac: 15,
        total: 3804.70,
        currency: 'BRL',
      },
      air: {
        airlineName: 'LATAM Airlines',
        airlineCode: 'LA',
        reservationSystem: 'SKYTEAM',
        locator: 'LA9574809IUEI',
        ticketingDeadline: '2026-08-05T23:30:00.000Z',
        segments: [
          {
            sequence: 1,
            airlineCode: 'LA',
            airlineName: 'LATAM Airlines',
            flightNumber: '3375',
            bookingClass: 'V',
            cabinClass: 'economy',
            baggagePieces: 0,
            originCode: 'REC',
            originName: 'Recife',
            destinationCode: 'GRU',
            destinationName: 'Guarulhos',
            departsAt: '2026-08-11T02:45:00.000Z',
            arrivesAt: '2026-08-11T06:00:00.000Z',
          },
          {
            sequence: 2,
            airlineCode: 'LA',
            airlineName: 'LATAM Airlines',
            flightNumber: '3372',
            bookingClass: 'V',
            cabinClass: 'economy',
            baggagePieces: 0,
            originCode: 'GRU',
            originName: 'Guarulhos',
            destinationCode: 'GYN',
            destinationName: 'Goiania',
            departsAt: '2026-08-11T07:15:00.000Z',
            arrivesAt: '2026-08-11T08:55:00.000Z',
          },
        ],
        pricing: {
          fare: 3678.74,
          taxes: 110.96,
          rav: 0,
          rac: 15,
          total: 3804.70,
          currency: 'BRL',
        },
        refundable: false,
        fareRules: 'Tarifa sujeita a alteracao ate a emissao.',
        cancellationPolicy: 'Nao reembolsavel.',
        changePolicy: 'Alteracao com multa e diferenca tarifaria.',
      },
    },
  },
}

describe('air quote approval presentation', () => {
  it('presents itinerary, pricing and policies as an allow-listed decision summary', () => {
    expect(extractAirQuoteApprovalSummary(subject)).toMatchObject({
      demandNumber: 'OS-20260805-0003',
      passengerName: 'Alexandre Paiva Bezerra',
      airlineName: 'LATAM Airlines',
      reservationSystem: 'SKYTEAM',
      locator: 'LA9574809IUEI',
      optionCount: 2,
      fare: 3678.74,
      taxes: 110.96,
      rac: 15,
      total: 3804.70,
      refundable: false,
      segments: [
        expect.objectContaining({ originCode: 'REC', destinationCode: 'GRU', flightNumber: '3375' }),
        expect.objectContaining({ originCode: 'GRU', destinationCode: 'GYN', flightNumber: '3372' }),
      ],
    })

    const presentation = buildApprovalSubjectPresentation(subject)
    expect(presentation.kind).toBe('air_quote')
    expect(extractHotelQuoteApprovalSummary(subject)).toBeNull()
    expect(approvalPolicyLabel('local-air-selection-approval')).toBe('Aprovação da cotação aérea escolhida')
    expect(JSON.stringify(presentation)).not.toMatch(/private-demand-id|private-quote-id|private-option-id/)
  })

  it('uses the readable air summary component and never prints the raw snapshot', () => {
    const component = readFileSync(resolve(process.cwd(), 'components/approvals/approval-subject-summary.tsx'), 'utf8')
    expect(component).toContain('Itinerário escolhido')
    expect(component).toContain('Prazo de emissão')
    expect(component).toContain('Regras tarifárias')
    expect(component).toContain("if (presentation?.kind === 'air_quote')")
    expect(component.indexOf('const airQuote = extractAirQuoteApprovalSummary(subject)'))
      .toBeLessThan(component.indexOf('const hotelQuote = extractHotelQuoteApprovalSummary(subject)'))
    expect(component).not.toContain('JSON.stringify(subject)')
    expect(component).not.toContain('Object.entries(subject)')
  })

})

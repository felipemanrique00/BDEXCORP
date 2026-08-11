import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { OfflineAirQuoteChoicePanel } from '@/components/travel/services/air/offline-air-quote-choice-panel'
import type {
  OfflineAirDemandSummary,
  OfflineAirQuoteOptionReadModel,
  OfflineAirQuoteRoundReadModel,
} from '@/components/travel/services/air/types'

const demand: OfflineAirDemandSummary = {
  id: 'demand-air-render',
  number: 'OS-20260810-RENDER',
  companyName: 'Empresa Render',
  requesterName: 'Solicitante Render',
  requestedCabin: 'Econômica',
  preferredAirlines: ['LATAM', 'GOL'],
  passengers: [{ id: 'employee-render', name: 'Passageiro Render', type: 'adulto' }],
  requestedSegments: [{
    id: 'requested-outbound',
    originCode: 'REC',
    originName: 'Recife',
    destinationCode: 'GRU',
    destinationName: 'Guarulhos',
    departureDate: '2026-08-11',
    preferredPeriod: 'a partir de 02:00',
  }],
}

const quote: OfflineAirQuoteRoundReadModel = {
  id: 'quote-air-render',
  demandId: demand.id,
  createdAt: '2026-08-10T12:00:00.000Z',
  expiresAt: '2026-08-10T23:00:00.000Z',
  options: [
    option({
      id: 'option-expanded',
      optionNumber: 1,
      airlineCode: 'LA',
      airlineName: 'LATAM Airlines',
      flightNumber: '3375',
      originCode: 'REC',
      originName: 'Recife',
      destinationCode: 'GRU',
      destinationName: 'Guarulhos',
      departureAt: '2026-08-11T02:45:00-03:00',
      arrivalAt: '2026-08-11T06:00:00-03:00',
      issuanceDeadline: '2026-08-10T23:30:00-03:00',
      locator: 'EXP123',
      fare: '1000.10',
      taxes: '200.20',
      rav: '30.30',
      rac: '4.40',
      exchangeRate: '1.2345',
      referenceFare: '9876.54',
      mileage: '12345',
      fareRules: 'REGRA-PRIMEIRA-VISIVEL',
    }),
    option({
      id: 'option-compact',
      optionNumber: 2,
      airlineCode: 'G3',
      airlineName: 'GOL Linhas Aéreas',
      flightNumber: '9876',
      originCode: 'REC',
      originName: 'Recife',
      destinationCode: 'CGH',
      destinationName: 'Congonhas',
      departureAt: '2026-08-11T08:00:00-03:00',
      arrivalAt: '2026-08-11T11:00:00-03:00',
      issuanceDeadline: '2026-08-10T22:00:00-03:00',
      locator: 'CMP456',
      fare: '800.00',
      taxes: '100.00',
      rav: '25.00',
      rac: '25.00',
      exchangeRate: '9.8765',
      referenceFare: '7654.32',
      mileage: '54321',
      fareRules: 'REGRA-SEGUNDA-DEVE-FICAR-OCULTA',
    }),
  ],
}

describe('offline air requester choice rendered markup', () => {
  it('renders two radio choices with only the first option expanded and complete', () => {
    const markup = normalizeMarkup(renderToStaticMarkup(createElement(
      OfflineAirQuoteChoicePanel,
      { demand, quote, onSelect: () => undefined },
    )))

    expect(count(markup, 'type="radio"')).toBe(2)
    expect(count(markup, 'aria-expanded="true"')).toBe(1)
    expect(count(markup, 'aria-expanded="false"')).toBe(1)
    expect(count(markup, 'id="air-choice-details-')).toBe(1)
    expect(count(markup, '<table')).toBe(1)

    expect(markup).toContain('LATAM Airlines')
    expect(markup).toContain('src="/airlines/LA.svg"')
    expect(markup).toContain('LA 3375')
    expect(markup).toContain('(REC) Recife')
    expect(markup).toContain('(GRU) Guarulhos')
    expect(markup).toContain('Prazo de emissão')
    expect(markup).toContain('10/08/2026, 23:30')

    expect(markup).toContain('Tarifa')
    expect(markup).toContain('R$ 1.000,10')
    expect(markup).toContain('Taxas')
    expect(markup).toContain('R$ 200,20')
    expect(markup).toContain('RAV')
    expect(markup).toContain('R$ 30,30')
    expect(markup).toContain('RAC')
    expect(markup).toContain('R$ 4,40')
    expect(markup).toContain('R$ 1.235,00')

    expect(markup).toContain('Câmbio informado')
    expect(markup).toContain('1,2345')
    expect(markup).toContain('Tarifa de referência')
    expect(markup).toContain('R$ 9.876,54')
    expect(markup).toContain('Milhagem do itinerário')
    expect(markup).toContain('12345 milhas')
    expect(markup).toContain('REGRA-PRIMEIRA-VISIVEL')

    // A segunda opção permanece comparável na linha compacta, mas seus
    // dados detalhados não podem ser duplicados no primeiro render.
    expect(markup).toContain('GOL Linhas Aéreas')
    expect(markup).toContain('src="/airlines/G3.svg"')
    expect(markup).toContain('R$ 950,00')
    expect(markup).not.toContain('G3 9876')
    expect(markup).not.toContain('REGRA-SEGUNDA-DEVE-FICAR-OCULTA')
    expect(markup).not.toContain('9,8765')
    expect(markup).not.toContain('54321 milhas')
  })
})

interface OptionFixture {
  id: string
  optionNumber: number
  airlineCode: string
  airlineName: string
  flightNumber: string
  originCode: string
  originName: string
  destinationCode: string
  destinationName: string
  departureAt: string
  arrivalAt: string
  issuanceDeadline: string
  locator: string
  fare: string
  taxes: string
  rav: string
  rac: string
  exchangeRate: string
  referenceFare: string
  mileage: string
  fareRules: string
}

function option(fixture: OptionFixture): OfflineAirQuoteOptionReadModel {
  return {
    id: fixture.id,
    optionNumber: fixture.optionNumber,
    reservationSystem: 'Manual',
    locator: fixture.locator,
    fareFamily: 'Light',
    refundable: false,
    issuanceDeadline: fixture.issuanceDeadline,
    segments: [{
      clientId: `${fixture.id}-segment-1`,
      airlineCode: fixture.airlineCode,
      airlineName: fixture.airlineName,
      flightNumber: fixture.flightNumber,
      bookingClass: 'V',
      cabinClass: 'economy',
      baggagePieces: '1',
      originCode: fixture.originCode,
      originName: fixture.originName,
      destinationCode: fixture.destinationCode,
      destinationName: fixture.destinationName,
      departureAt: fixture.departureAt,
      arrivalAt: fixture.arrivalAt,
      equipment: 'A320',
    }],
    pricing: {
      currency: 'BRL',
      fare: fixture.fare,
      taxes: fixture.taxes,
      rav: fixture.rav,
      rac: fixture.rac,
      exchangeRate: fixture.exchangeRate,
      referenceFare: fixture.referenceFare,
      mileage: fixture.mileage,
    },
    fareRules: fixture.fareRules,
    cancellationPolicy: 'Não reembolsável.',
    changePolicy: 'Alteração sujeita a diferença tarifária.',
    observations: 'Opção de teste renderizado.',
  }
}

function normalizeMarkup(markup: string): string {
  return markup.replace(/\u00a0/g, ' ')
}

function count(value: string, fragment: string): number {
  return value.split(fragment).length - 1
}

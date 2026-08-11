import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { OfflineAirOperationFields } from '@/components/travel/services/air/offline-air-operation-fields'
import type { OfflineAirApprovedSnapshot, OfflineAirOperationDraft } from '@/components/travel/services/air/types'

const snapshot: OfflineAirApprovedSnapshot = {
  demand: {
    id: 'demand-operation-render',
    number: 'OS-20260810-0002',
    companyName: 'Empresa Brasil - Teste CC',
    requesterName: 'Solicitante Teste Centro de Custo',
    requestedCabin: 'Econômica',
    passengers: [
      { id: 'passenger-1', sequence: 1, name: 'Funcionário Teste Centro de Custo' },
      { id: 'passenger-2', sequence: 2, name: 'Acompanhante Teste' },
    ],
    requestedSegments: [{
      id: 'request-1',
      originCode: 'GYN',
      originName: 'Goiânia',
      destinationCode: 'CGH',
      destinationName: 'Congonhas',
      departureDate: '2026-09-01',
      preferredPeriod: 'a partir de 09:00',
    }],
  },
  quoteId: 'quote-operation-render',
  option: {
    id: 'option-operation-render',
    reservationSystem: 'Manual',
    locator: 'BDS912',
    fareFamily: 'Light',
    refundable: false,
    issuanceDeadline: '2026-08-10T11:00:00-03:00',
    validatingAirlineCode: 'G3',
    validatingAirlineName: 'GOL Linhas Aéreas',
    segments: [{
      clientId: 'segment-operation-render',
      airlineCode: 'G3',
      airlineName: 'GOL Linhas Aéreas',
      flightNumber: '3399',
      bookingClass: 'Y',
      cabinClass: 'economy',
      baggagePieces: '1',
      originCode: 'GYN',
      originName: 'Goiânia',
      destinationCode: 'CGH',
      destinationName: 'Congonhas',
      departureAt: '2026-09-01T13:00:00-03:00',
      arrivalAt: '2026-09-01T14:50:00-03:00',
      equipment: '',
    }],
    pricing: {
      currency: 'BRL',
      fare: '450,36',
      taxes: '40,00',
      rav: '0,00',
      rac: '10,00',
      exchangeRate: '1,0000',
      referenceFare: '0,00',
      mileage: '0',
    },
    fareRules: 'Tarifa escolhida pelo solicitante.',
    cancellationPolicy: 'Não reembolsável.',
    changePolicy: 'Alteração sujeita a diferença tarifária.',
    observations: '',
  },
}

const value: OfflineAirOperationDraft = {
  reservationSystem: 'Manual',
  locator: 'BDS912',
  operationalSupplierName: 'GOL Linhas Aéreas',
  reservationConfirmedAt: '2026-08-10T10:00',
  issuedAt: '2026-08-10T10:05',
  tickets: [
    { passengerId: 'passenger-1', passengerName: 'Funcionário Teste Centro de Custo', ticketNumber: '' },
    { passengerId: 'passenger-2', passengerName: 'Acompanhante Teste', ticketNumber: '' },
  ],
  paymentMethod: 'faturado',
  paymentReference: '',
  operationalNotes: '',
}

describe('offline air operation rendered markup', () => {
  it('restores the approved choice and keeps only fulfillment fields prominent', () => {
    const markup = renderToStaticMarkup(createElement(OfflineAirOperationFields, {
      approvedSnapshot: snapshot,
      value,
      mode: 'reservation_and_issue',
      onChange: () => undefined,
    })).replace(/\u00a0/g, ' ')

    expect(markup).toContain('Aéreo · Aprovada')
    expect(markup).toContain('OS-20260810-0002')
    expect(markup).toContain('Solicitante Teste Centro de Custo')
    expect(markup).toContain('Funcionário Teste Centro de Custo')
    expect(markup).toContain('Acompanhante Teste')
    expect(markup).toContain('G3 3399')
    expect(markup).toContain('BDS912')
    expect(markup).toContain('R$ 450,36')
    expect(markup).toContain('R$ 40,00')
    expect(markup).toContain('R$ 10,00')
    expect(markup).toContain('R$ 500,36')
    expect(markup).toContain('Dados administrativos opcionais')
    expect(markup).toContain('Emissor / consolidador')
    expect(markup).toContain('Bilhetes por passageiro')
  })
})

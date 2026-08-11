import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MAX_AIR_QUOTE_OPTIONS,
  MIN_AIR_QUOTE_OPTIONS,
  airQuoteTotalMinor,
  createEmptyAirQuoteOption,
  formatAirMoney,
} from '@/components/travel/services/air/pricing'
import { toOfflineAirQuoteCreateInput } from '@/components/travel/services/air/adapter'
import { offlineAirQuoteCreateSchema } from '@/lib/offline-travel/services/air/schema'

const quoteFormSource = readFileSync(
  resolve(process.cwd(), 'components/travel/services/air/offline-air-quote-form.tsx'),
  'utf8',
)
const choicePanelSource = readFileSync(
  resolve(process.cwd(), 'components/travel/services/air/offline-air-quote-choice-panel.tsx'),
  'utf8',
)
const operationFieldsSource = readFileSync(
  resolve(process.cwd(), 'components/travel/services/air/offline-air-operation-fields.tsx'),
  'utf8',
)

describe('offline air UI contract', () => {
  it('calculates the approved total from fare, taxes, RAV and RAC without floating point drift', () => {
    expect(airQuoteTotalMinor({
      fare: '3678,74',
      taxes: '110,96',
      rav: '0',
      rac: '15,00',
    })).toBe(380_470)
    expect(formatAirMoney(380_470, 'BRL')).toContain('3.804,70')
  })

  it('starts with one editable option and mirrors every requested journey as an air segment', () => {
    const option = createEmptyAirQuoteOption(1, [
      {
        id: 'outbound',
        originCode: 'REC',
        originName: 'Recife',
        destinationCode: 'GYN',
        destinationName: 'Goiânia',
        departureDate: '2026-08-11',
      },
      {
        id: 'inbound',
        originCode: 'GYN',
        originName: 'Goiânia',
        destinationCode: 'REC',
        destinationName: 'Recife',
        departureDate: '2026-08-14',
      },
    ])

    expect(MIN_AIR_QUOTE_OPTIONS).toBe(1)
    expect(MAX_AIR_QUOTE_OPTIONS).toBe(10)
    expect(option.segments).toHaveLength(2)
    expect(option.segments[0]).toMatchObject({ originCode: 'REC', destinationCode: 'GYN' })
    expect(option.segments[1]).toMatchObject({ originCode: 'GYN', destinationCode: 'REC' })
    expect(option.pricing).toMatchObject({ currency: 'BRL', exchangeRate: '1,0000', rac: '0,00' })
  })

  it('adapts PT-BR UI fields to the canonical backend schema', () => {
    const option = createEmptyAirQuoteOption(1)
    Object.assign(option, {
      reservationSystem: 'Sabre',
      locator: 'ABC123',
      issuanceDeadline: '2026-08-10T20:00',
      fareFamily: 'Light',
      fareRules: 'Tarifa promocional.',
      cancellationPolicy: 'Não reembolsável.',
    })
    Object.assign(option.pricing, {
      fare: '3678,74',
      taxes: '110,96',
      rac: '15,00',
    })
    Object.assign(option.segments[0], {
      airlineCode: 'LA',
      airlineName: 'LATAM',
      flightNumber: '3375',
      bookingClass: 'V',
      cabinClass: 'economy',
      originCode: 'REC',
      originName: 'Recife',
      destinationCode: 'GRU',
      destinationName: 'Guarulhos',
      departureAt: '2026-08-11T02:45',
      arrivalAt: '2026-08-11T06:00',
    })

    const payload = toOfflineAirQuoteCreateInput(
      { demandId: 'demand-air-1', options: [option] },
      { expectedLifecycleVersion: 2, idempotencyKey: 'air-quote-idempotency-1' },
    )

    expect(offlineAirQuoteCreateSchema.safeParse(payload).success).toBe(true)
    expect(payload.options[0]).toMatchObject({
      airlineCode: 'LA',
      cabinClass: 'economy',
      fare: 3678.74,
      taxes: 110.96,
      rac: 15,
    })
    expect(payload.options[0].segments[0]).toMatchObject({
      sequence: 1,
      originCode: 'REC',
      destinationCode: 'GRU',
    })
  })

  it('supports one to ten quote options, repeatable segments and automatic price preview', () => {
    expect(quoteFormSource).toContain('options.length >= MAX_AIR_QUOTE_OPTIONS')
    expect(quoteFormSource).toContain('options.length <= MIN_AIR_QUOTE_OPTIONS')
    expect(quoteFormSource).toContain('createEmptyAirSegment(option.segments.length + 1)')
    expect(quoteFormSource).toContain('option.segments.length <= 1')
    expect(quoteFormSource).toContain('DateTimeInput')
    expect(quoteFormSource).toContain('Total = tarifa + taxas + RAV + RAC')
    expect(quoteFormSource).toContain('Companhias preferenciais:')
    expect(quoteFormSource).toContain('Publicar para escolha')
  })

  it('renders intelligible itinerary, baggage, deadline, policies and full price breakdown for requester choice', () => {
    for (const label of [
      'Data e hora',
      'Trecho',
      'Companhia / voo',
      'Classe',
      'Bagagem',
      'Prazo de emissão',
      'Regras tarifárias',
      'Política de cancelamento',
      'Câmbio informado',
      'Tarifa de referência',
      'Milhagem do itinerário',
      'Escolher e enviar',
    ]) {
      expect(choicePanelSource).toContain(label)
    }
    expect(choicePanelSource).toContain('airQuoteTotalMinor(option.pricing)')
    expect(choicePanelSource).toContain('type="radio"')
    expect(choicePanelSource).toContain('aria-expanded={expanded}')
    expect(choicePanelSource).toContain('{expanded && <div')
    expect(choicePanelSource).toContain('<AirlineLogo')
    expect(choicePanelSource).toContain('option.validatingAirlineCode')
    expect(choicePanelSource).toContain('Confirmo os trechos, passageiros, bagagem, valor total')
  })

  it('locks the approved commercial snapshot and exposes only operational reservation and issuance fields', () => {
    expect(operationFieldsSource).toContain('data-locked-approved-air-snapshot')
    expect(operationFieldsSource).toContain('cotação imutável para a operação')
    expect(operationFieldsSource).toContain('<AirlineLogo')
    expect(operationFieldsSource).toContain('option.validatingAirlineCode')
    expect(operationFieldsSource).toContain('Para alterá-los, retorne à cotação e abra uma nova rodada.')
    expect(operationFieldsSource).toContain('data-air-request-summary')
    expect(operationFieldsSource).toContain('data-air-administrative-details')
    for (const label of [
      'Localizador confirmado *',
      'Emissor / consolidador *',
      'Reserva confirmada em *',
      'Bilhetes por passageiro',
      'Forma de pagamento',
      'Observações operacionais',
    ]) {
      expect(operationFieldsSource).toContain(label)
    }
  })
})

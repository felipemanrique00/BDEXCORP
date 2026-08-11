import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const quoteFormSource = readFileSync(
  resolve(process.cwd(), 'components/travel/services/air/offline-air-quote-form.tsx'),
  'utf8',
)

describe('offline air quote airport catalog UI', () => {
  it('uses the shared airport catalog for origin and destination', () => {
    expect(quoteFormSource).toContain("from '@/components/travel/airport-combobox'")
    expect(quoteFormSource).toContain('<AirportLocationField')
    expect(quoteFormSource).toContain('<AirportCombobox')
    expect(quoteFormSource).toContain('Busque por IATA, aeroporto ou cidade')
  })

  it('stores the selected airport IATA code and official name together', () => {
    expect(quoteFormSource).toContain('code: airport.iataCode.trim().toUpperCase()')
    expect(quoteFormSource).toContain('name: airport.name.trim() || airport.municipality.trim()')
    expect(quoteFormSource).toContain('onPatch({ originCode, originName })')
    expect(quoteFormSource).toContain('onPatch({ destinationCode, destinationName })')
  })

  it('keeps legacy values editable and requested demand segments prefilled', () => {
    expect(quoteFormSource).toContain('airQuoteAirportLegacyValue(code, name)')
    expect(quoteFormSource).toContain('resolveAirQuoteAirportValue(value, airport)')
    expect(quoteFormSource).toContain('createEmptyAirQuoteOption(1, demand.requestedSegments)')
    expect(quoteFormSource).toContain('createEmptyAirQuoteOption(nextNumber, demand.requestedSegments)')
  })
})

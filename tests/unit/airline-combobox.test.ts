import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AIRLINE_SEARCH_DEBOUNCE_MS,
  MIN_AIRLINE_QUERY_LENGTH,
  airlineSearchQuery,
  buildAirlineSearchUrl,
  formatAirlineLegacyValue,
  parseAirlineSearchResponse,
  type AirlineOption,
} from '@/components/travel/services/air/airline-combobox-model'

const LATAM: AirlineOption = {
  id: 'airline-la',
  iataCode: 'LA',
  icaoCode: 'LAN',
  name: 'LATAM Airlines',
  displayName: 'LATAM Airlines Brasil',
  countryCode: 'BR',
  logoPath: '/airlines/LA.svg',
  aliases: ['TAM', 'JJ'],
}

describe('airline combobox', () => {
  it('persists IATA code and catalog name as one visible selection', () => {
    expect(formatAirlineLegacyValue(LATAM)).toBe('LA - LATAM Airlines Brasil')
    expect(airlineSearchQuery('LA - LATAM Airlines Brasil')).toBe('LA')
  })

  it('builds an encoded and bounded dynamic-search URL', () => {
    expect(buildAirlineSearchUrl('  LATAM Brasil ', 500))
      .toBe('/api/geography/airlines?q=LATAM+Brasil&limit=50')
    expect(buildAirlineSearchUrl('G3 - GOL', 0))
      .toBe('/api/geography/airlines?q=G3&limit=1')
  })

  it('accepts only complete catalog items with a valid two-character IATA code', () => {
    expect(parseAirlineSearchResponse({
      items: [
        LATAM,
        { ...LATAM, id: 'airline-ad', iataCode: ' ad ', aliases: null },
        { ...LATAM, id: 'airline-invalid', iataCode: 'LAT' },
        { ...LATAM, id: '', iataCode: 'G3' },
        null,
      ],
    })).toEqual([
      LATAM,
      { ...LATAM, id: 'airline-ad', iataCode: 'AD', aliases: [] },
    ])
    expect(parseAirlineSearchResponse(null)).toEqual([])
  })

  it('keeps accessible keyboard/listbox semantics and an explicit manual fallback', () => {
    expect(AIRLINE_SEARCH_DEBOUNCE_MS).toBe(250)
    expect(MIN_AIRLINE_QUERY_LENGTH).toBe(1)

    const source = readFileSync(resolve(process.cwd(), 'components/travel/services/air/airline-combobox.tsx'), 'utf8')
    expect(source).toContain('role="combobox"')
    expect(source).toContain('aria-autocomplete="list"')
    expect(source).toContain('role="listbox"')
    expect(source).toContain("event.key === 'ArrowDown'")
    expect(source).toContain("event.key === 'Enter'")
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain('Companhia não encontrada? Informar manualmente')
    expect(source).toContain('Buscar no catálogo de companhias')
  })

  it('replaces the two independent airline inputs in the offline air quote form', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/travel/services/air/offline-air-quote-form.tsx'), 'utf8')
    expect(source).toContain("import { AirlineCombobox } from './airline-combobox'")
    expect(source).toContain('<AirlineCombobox')
    expect(source).toContain('onPatch({ airlineCode, airlineName })')
    expect(source).not.toContain('placeholder="LATAM"')
    expect(source).not.toContain('placeholder="LA" maxLength={3}')
  })
})

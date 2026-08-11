import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AIRPORT_SEARCH_DEBOUNCE_MS,
  MIN_AIRPORT_QUERY_LENGTH,
  airportSearchQuery,
  buildAirportSearchUrl,
  formatAirportLegacyValue,
  isAirportCatalogReady,
  parseAirportSearchResponse,
  type AirportOption,
} from '@/components/travel/airport-combobox-model'

const GYN: AirportOption = {
  id: 'airport-sbgo',
  iataCode: 'GYN',
  icaoCode: 'SBGO',
  name: 'Aeroporto Santa Genoveva',
  municipality: 'Goiânia',
  subdivisionCode: 'GO',
  countryCode: 'BR',
  label: 'GYN — Aeroporto Santa Genoveva · Goiânia/GO',
}

describe('airport combobox', () => {
  it('persists the selection in the legacy IATA - description format', () => {
    expect(formatAirportLegacyValue(GYN)).toBe('GYN - Aeroporto Santa Genoveva · Goiânia/GO')
    expect(formatAirportLegacyValue({ ...GYN, label: 'Aeroporto Santa Genoveva · Goiânia/GO' }))
      .toBe('GYN - Aeroporto Santa Genoveva · Goiânia/GO')
  })

  it('falls back to airport and location data when the API label contains only the code', () => {
    expect(formatAirportLegacyValue({ ...GYN, label: 'GYN' }))
      .toBe('GYN - Aeroporto Santa Genoveva · Goiânia/GO')
  })

  it('builds an encoded, bounded dynamic-search URL', () => {
    expect(buildAirportSearchUrl('  São Paulo GRU ', 500))
      .toBe('/api/geography/airports?q=S%C3%A3o+Paulo+GRU&limit=50')
    expect(buildAirportSearchUrl('GYN', 0))
      .toBe('/api/geography/airports?q=GYN&limit=1')
    expect(airportSearchQuery('GYN - Aeroporto Santa Genoveva · Goiânia/GO')).toBe('GYN')
    expect(buildAirportSearchUrl('GYN - Aeroporto Santa Genoveva · Goiânia/GO', 20))
      .toBe('/api/geography/airports?q=GYN&limit=20')
  })

  it('accepts only complete airport items with a valid IATA code', () => {
    expect(parseAirportSearchResponse({
      items: [
        GYN,
        { ...GYN, id: 'airport-gru', iataCode: ' gru ', label: 'GRU — Guarulhos' },
        { ...GYN, id: 'airport-without-iata', iataCode: '' },
        { ...GYN, id: '', iataCode: 'BSB' },
        null,
      ],
    })).toEqual([
      GYN,
      { ...GYN, id: 'airport-gru', iataCode: 'GRU', label: 'GRU — Guarulhos' },
    ])
    expect(parseAirportSearchResponse(null)).toEqual([])
    expect(parseAirportSearchResponse({ items: 'invalid' })).toEqual([])
  })

  it('distinguishes an empty catalog from a search without matches', () => {
    expect(isAirportCatalogReady({ items: [], catalogReady: false })).toBe(false)
    expect(isAirportCatalogReady({ items: [], catalogReady: true })).toBe(true)
    expect(isAirportCatalogReady({ items: [] })).toBe(true)
    expect(isAirportCatalogReady(null)).toBe(true)
  })

  it('keeps debounce, minimum query and accessible keyboard/listbox semantics explicit', () => {
    expect(AIRPORT_SEARCH_DEBOUNCE_MS).toBe(250)
    expect(MIN_AIRPORT_QUERY_LENGTH).toBe(2)

    const source = readFileSync(resolve(process.cwd(), 'components/travel/airport-combobox.tsx'), 'utf8')
    expect(source).toContain('role="combobox"')
    expect(source).toContain('aria-autocomplete="list"')
    expect(source).toContain('role="listbox"')
    expect(source).toContain("event.key === 'ArrowDown'")
    expect(source).toContain("event.key === 'Enter'")
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain('O catálogo de aeroportos ainda não foi sincronizado')
    expect(source.match(/setItems\(\[\]\)/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('replaces both free-text fields in the air demand configurator', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/travel/air-demand-configurator.tsx'), 'utf8')
    expect(source.match(/<AirportCombobox/g)).toHaveLength(2)
    expect(source).toContain('onChange={(origin) => updateLeg(index, { origin })}')
    expect(source).toContain('onChange={(destination) => updateLeg(index, { destination })}')
  })
})

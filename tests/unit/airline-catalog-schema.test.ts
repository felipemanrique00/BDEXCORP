import { describe, expect, it } from 'vitest'

import { normalizeAirlineSearch } from '@/lib/airlines/normalization'
import { airlineSearchSchema } from '@/lib/airlines/schema'

describe('airline catalog search contracts', () => {
  it('normalizes names with accents and punctuation', () => {
    expect(normalizeAirlineSearch('Azul Linhas Aereas Brasileiras S.A.'))
      .toBe('azul linhas aereas brasileiras s a')
    expect(normalizeAirlineSearch('GOL / LATAM')).toBe('gol latam')
  })

  it('validates safe query filters and pagination', () => {
    expect(airlineSearchSchema.parse({ q: 'jj', countryCode: 'br', includeInactive: '1' }))
      .toEqual({ q: 'jj', countryCode: 'BR', includeInactive: true, limit: 30, offset: 0 })
    expect(() => airlineSearchSchema.parse({ countryCode: 'BRA' })).toThrow()
    expect(() => airlineSearchSchema.parse({ limit: 51 })).toThrow()
    expect(() => airlineSearchSchema.parse({ unexpected: true })).toThrow()
  })
})

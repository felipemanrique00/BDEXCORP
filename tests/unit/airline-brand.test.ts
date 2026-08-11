import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  normalizeAirlineIataCode,
  resolveAirlineBrand,
  supportedAirlineBrandCodes,
} from '../../components/travel/services/air/airline-brand'

describe('airline brand registry', () => {
  it('normalizes IATA designators without consulting airline names', () => {
    expect(normalizeAirlineIataCode(' la ')).toBe('LA')
    expect(resolveAirlineBrand('LA')?.name).toBe('LATAM Airlines')
    expect(resolveAirlineBrand('unknown')).toBeNull()
  })

  it('keeps the legacy TAM designator as an explicit LATAM alias', () => {
    expect(resolveAirlineBrand('jj')?.iataCode).toBe('LA')
  })

  it('ships every registered asset locally', () => {
    expect(supportedAirlineBrandCodes()).toEqual(['AD', 'G3', 'JJ', 'LA'])
    for (const code of ['AD', 'G3', 'LA']) {
      const asset = resolveAirlineBrand(code)
      expect(asset).not.toBeNull()
      expect(existsSync(resolve(process.cwd(), 'public', asset!.logoPath.replace('/airlines/', 'airlines/')))).toBe(true)
    }
  })
})

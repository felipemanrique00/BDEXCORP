import { describe, expect, it } from 'vitest'

import { demandFocusHref, demandFocusIdFromSearch } from '@/lib/demands/focus-query'

describe('demand focus query', () => {
  it('uses id as the canonical deep-link key', () => {
    expect(demandFocusHref('demand/a 1')).toBe('/dashboard/demandas?id=demand%2Fa%201')
  })

  it('reads canonical id and keeps legacy focus links compatible', () => {
    expect(demandFocusIdFromSearch('?id=demand-canonical&focus=demand-legacy')).toBe('demand-canonical')
    expect(demandFocusIdFromSearch('?focus=demand-legacy')).toBe('demand-legacy')
    expect(demandFocusIdFromSearch('?id=%20')).toBeNull()
  })
})

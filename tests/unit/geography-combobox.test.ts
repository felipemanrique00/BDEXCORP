import { describe, expect, it } from 'vitest'

import {
  filterGeographyOptions,
  normalizeGeographySearch,
  type GeographyComboboxOption,
} from '@/components/geography/geography-combobox-search'

const OPTIONS: GeographyComboboxOption[] = [
  { value: '1', label: 'São Paulo', keywords: ['SP', 'Brasil'] },
  { value: '2', label: 'Espírito Santo', keywords: ['ES', 'Brasil'] },
  { value: '3', label: 'München', keywords: ['MUC', 'Alemanha'] },
]

describe('geography combobox search', () => {
  it('normalizes accents, case and repeated whitespace', () => {
    expect(normalizeGeographySearch('  SÃO   João  ')).toBe('sao joao')
  })

  it('finds labels without requiring accents', () => {
    expect(filterGeographyOptions(OPTIONS, 'sao pa').map((item) => item.value)).toEqual(['1'])
    expect(filterGeographyOptions(OPTIONS, 'espirito').map((item) => item.value)).toEqual(['2'])
    expect(filterGeographyOptions(OPTIONS, 'munchen').map((item) => item.value)).toEqual(['3'])
  })

  it('searches codes and requires every typed token', () => {
    expect(filterGeographyOptions(OPTIONS, 'brasil sp').map((item) => item.value)).toEqual(['1'])
    expect(filterGeographyOptions(OPTIONS, 'brasil muc')).toEqual([])
  })

  it('keeps the original ordering when the query is empty', () => {
    expect(filterGeographyOptions(OPTIONS, '')).toEqual(OPTIONS)
  })
})

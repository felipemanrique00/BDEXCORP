import { describe, expect, it } from 'vitest'

import { appendCompanyIdsQuery, companyIdsQuerySchema } from '@/lib/company-selection-query'

describe('company selection query', () => {
  it('decodes, trims and deduplicates a company selection', () => {
    const parsed: string[] = companyIdsQuerySchema.parse('company-a, company-b,company-a')
    expect(parsed).toEqual(['company-a', 'company-b'])
  })

  it('encodes a company selection as a compact query value', () => {
    const query = new URLSearchParams()
    appendCompanyIdsQuery(query, ['company-a', 'company-b', 'company-a'])
    expect(query.get('companyIds')).toBe('company-a,company-b')
  })

  it('rejects empty and oversized selections', () => {
    expect(companyIdsQuerySchema.safeParse('').success).toBe(false)
    const queryValue = Array.from({ length: 101 }, (_, index) => `company-${index}`).join(',')
    expect(companyIdsQuerySchema.safeParse(queryValue).success)
      .toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import {
  intelligenceFiltersSchema,
  intelligenceInsightTransitionSchema,
} from '@/lib/intelligence'

describe('intelligence schemas', () => {
  it('accepts a bounded period and a complete corporate context', () => {
    const result = intelligenceFiltersSchema.parse({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      contextType: 'group',
      contextId: 'group-1',
    })
    expect(result.contextType).toBe('group')
  })

  it('rejects incomplete context and periods above two years', () => {
    expect(() => intelligenceFiltersSchema.parse({
      startDate: '2024-01-01',
      endDate: '2026-12-31',
      contextType: 'company',
    })).toThrow()
  })

  it('accepts and normalizes an explicit company selection', () => {
    const result = intelligenceFiltersSchema.parse({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      companyIds: 'company-a, company-b,company-a',
    })

    expect(result.companyIds).toEqual(['company-a', 'company-b'])
  })

  it('rejects an ambiguous context combined with company ids', () => {
    expect(() => intelligenceFiltersSchema.parse({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      contextType: 'group',
      contextId: 'group-a',
      companyIds: ['company-a'],
    })).toThrow()
  })

  it('requires an audited note for state transitions', () => {
    expect(() => intelligenceInsightTransitionSchema.parse({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      status: 'resolved',
      expectedVersion: 1,
      note: 'curta',
    })).toThrow()
  })

  it('accepts the same company selection in audited transitions', () => {
    const result = intelligenceInsightTransitionSchema.parse({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      companyIds: ['company-b', 'company-a', 'company-b'],
      status: 'resolved',
      expectedVersion: 1,
      note: 'Escopo selecionado revisado e confirmado pelo gestor.',
    })

    expect(result.companyIds).toEqual(['company-b', 'company-a'])
  })
})

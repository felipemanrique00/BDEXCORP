import { describe, expect, it } from 'vitest'

import {
  normalizeExternalCompanyName,
  TECH_EMISSION_CLIENT_PROVIDER,
} from '@/lib/integrations/company-mapping'

describe('integration company mapping', () => {
  it('normalizes accents, punctuation and spacing deterministically', () => {
    expect(normalizeExternalCompanyName('  São João & Cia. Ltda  ')).toBe('SAO JOAO CIA LTDA')
    expect(normalizeExternalCompanyName('SAO-JOAO / CIA LTDA')).toBe('SAO JOAO CIA LTDA')
  })

  it('rejects names without an alphanumeric identity at the service boundary', () => {
    expect(normalizeExternalCompanyName('--- / ---')).toBe('')
  })

  it('uses a provider namespace separate from the Tech API company identifier', () => {
    expect(TECH_EMISSION_CLIENT_PROVIDER).toBe('tech_travel_emission_client')
  })
})

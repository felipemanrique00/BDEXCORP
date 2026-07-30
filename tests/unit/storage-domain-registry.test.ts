import { describe, expect, it } from 'vitest'

import {
  STORAGE_DOMAIN_REGISTRY,
  storageDomainEntry,
  validateStorageDomainRegistry,
} from '@/lib/data-migration/registry'
import { SHARED_STORAGE_KEYS } from '@/lib/storage-keys'

describe('storage domain migration registry', () => {
  it('classifies every shared key exactly once', () => {
    expect(validateStorageDomainRegistry()).toEqual([])
    expect(STORAGE_DOMAIN_REGISTRY).toHaveLength(SHARED_STORAGE_KEYS.length)
    expect(new Set(STORAGE_DOMAIN_REGISTRY.map((entry) => entry.key)).size).toBe(SHARED_STORAGE_KEYS.length)
  })

  it('keeps the corporate directory in shadow while declaring completed relational domains explicitly', () => {
    const corporateDirectory = storageDomainEntry('bbt-data-v4')
    expect(corporateDirectory.classification).toBe('critical')
    expect(corporateDirectory.migrationState).toBe('shadow')

    for (const key of [
      'bbt-atendimentos',
      'bbt-emissoes',
      'bbt-financeiro',
      'bbt-aprovacoes',
    ] as const) {
      const entry = storageDomainEntry(key)
      expect(entry.classification).toBe('critical')
      expect(entry.migrationState).toBe('relational')
    }
  })
})

import { describe, expect, it } from 'vitest'

import { filterRelationalDemandStorageWrites } from '@/lib/storage-relational-guard'

const current = [
  {
    id: 'demand-protected',
    empresa_id: 'company-relational',
    passageiro_nome: 'Pessoa Protegida',
    updated_at: '2026-07-23T10:00:00.000Z',
  },
  {
    id: 'demand-legacy',
    empresa_id: 'company-legacy',
    passageiro_nome: 'Pessoa Legado',
    updated_at: '2026-07-23T10:00:00.000Z',
  },
]

describe('relational demand storage guard', () => {
  it('blocks changes and deletions for relational pilot companies', () => {
    const result = filterRelationalDemandStorageWrites(current, [
      {
        ...current[0],
        passageiro_nome: 'Alteracao indevida',
        updated_at: '2099-01-01T00:00:00.000Z',
      },
      { __bbt_deleted_record_key: 'id:demand-protected' },
      {
        ...current[1],
        passageiro_nome: 'Alteracao permitida',
      },
    ], {
      status: 'active',
      writeMode: 'relational',
      pilotCompanyIds: ['company-relational'],
    })

    expect(result).toEqual([
      expect.objectContaining({
        id: 'demand-legacy',
        passageiro_nome: 'Alteracao permitida',
      }),
    ])
  })

  it('prevents changing a protected record to another company to bypass the guard', () => {
    const result = filterRelationalDemandStorageWrites(current, [{
      ...current[0],
      empresa_id: 'company-legacy',
      passageiro_nome: 'Tentativa de bypass',
    }], {
      status: 'active',
      writeMode: 'relational',
      pilotCompanyIds: ['company-relational'],
    })

    expect(result).toEqual([])
  })

  it('keeps dual-write untouched during shadow migration', () => {
    const incoming = [{ ...current[0], passageiro_nome: 'Shadow write' }]
    expect(filterRelationalDemandStorageWrites(current, incoming, {
      status: 'active',
      writeMode: 'dual',
      pilotCompanyIds: [],
    })).toBe(incoming)
  })
})

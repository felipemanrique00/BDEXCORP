import { describe, expect, it } from 'vitest'

import { createStorageSyncValue, mergeStorageValues } from '@/lib/storage-merge'

describe('shared storage merge', () => {
  it('preserva registros anteriores ao receber uma importacao nova', () => {
    const current = [{ id: 'old', created_at: '2026-01-01T10:00:00.000Z', value: 10 }]
    const incoming = [{ id: 'new', created_at: '2026-07-01T10:00:00.000Z', value: 20 }]
    const merged = mergeStorageValues('bbt-atendimentos', current, incoming)

    expect(merged.map((item: { id: string }) => item.id).sort()).toEqual(['new', 'old'])
  })

  it('aplica exclusao explicita sem apagar outro registro', () => {
    const previous = [{ id: 'keep' }, { id: 'remove' }]
    const next = [{ id: 'keep' }]
    const patch = createStorageSyncValue('bbt-atendimentos', previous, next)
    const merged = mergeStorageValues('bbt-atendimentos', previous, patch)

    expect(merged).toEqual([{ id: 'keep' }])
  })

  it('mantem a versao mais recente do mesmo identificador', () => {
    const merged = mergeStorageValues(
      'bbt-atendimentos',
      [{ id: 'same', updated_at: '2026-07-01T10:00:00.000Z', status: 'pendente' }],
      [{ id: 'same', updated_at: '2026-07-01T11:00:00.000Z', status: 'concluido' }],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('concluido')
  })
})

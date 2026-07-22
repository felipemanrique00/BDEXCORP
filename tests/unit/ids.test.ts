import { describe, expect, it } from 'vitest'

import { createEntityId } from '@/lib/ids'

describe('entity identifiers', () => {
  it('creates collision-resistant UUID identifiers with the expected prefix', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createEntityId('atd')))

    expect(ids.size).toBe(500)
    ids.forEach((id) => expect(id).toMatch(/^atd-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i))
  })

  it('preserves underscore contracts when requested', () => {
    expect(createEntityId('tech_quote', '_')).toMatch(/^tech_quote_[0-9a-f-]{36}$/i)
  })

  it('rejects an empty identifier prefix', () => {
    expect(() => createEntityId('***')).toThrow('Prefixo de identificador invalido.')
  })
})

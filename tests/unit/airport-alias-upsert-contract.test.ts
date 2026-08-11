import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const service = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/server/airport-catalog-service.ts'),
  'utf8',
)

describe('airport alias upsert SQL', () => {
  it('deduplicates a conflict key before a single upsert statement', () => {
    expect(service).toContain('distinct on (stage.airport_id, item.normalized_alias)')
    expect(service).toContain('order by stage.airport_id, item.normalized_alias,')
    expect(service).toContain('length(item.alias), item.alias collate "C"')
    expect(service).toContain('on conflict (airport_id, normalized_alias) do update set')

    const distinctPosition = service.indexOf('distinct on (stage.airport_id, item.normalized_alias)')
    const conflictPosition = service.indexOf('on conflict (airport_id, normalized_alias) do update set')
    expect(distinctPosition).toBeGreaterThan(-1)
    expect(conflictPosition).toBeGreaterThan(distinctPosition)
  })
})

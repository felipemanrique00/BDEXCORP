import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const service = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/server/airport-catalog-service.ts'),
  'utf8',
)

describe('airport search SQL parameters', () => {
  it('casts every textual placeholder before null checks and comparisons', () => {
    for (const assignment of [
      'exactCodePlaceholder = `$${values.length}::text`',
      'normalizedPlaceholder = `$${values.length}::text`',
      'startsWithPlaceholder = `$${values.length}::text`',
      'containsPlaceholder = `$${values.length}::text`',
    ]) {
      expect(service).toContain(assignment)
    }
    expect(service).toContain('when ${normalizedPlaceholder} is not null')
  })
})

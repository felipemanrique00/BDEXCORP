import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('air demand service wiring', () => {
  it('normalizes and persists air details on demand creation and update', () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/server/demand-service.ts'), 'utf8')

    expect(source).toContain('const airDetails = normalizedAirDetails(parsedSnapshot)')
    expect(source.match(/persistNormalizedAirDemand\(/g)?.length).toBeGreaterThanOrEqual(3)
    expect(source).toContain('hasPersistedAirDemandDetailsInTransaction')
    expect(source).toContain('AIR_DEMAND_DETAILS_INVALID')
    expect(source).toContain('demandSnapshotWithAirItinerary')
  })
})

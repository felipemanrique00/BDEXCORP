import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const service = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/server/airline-catalog-service.ts'),
  'utf8',
)
const route = fs.readFileSync(
  path.resolve(process.cwd(), 'app/api/geography/airlines/route.ts'),
  'utf8',
)

describe('airline catalog API contracts', () => {
  it('searches exact and partial IATA, ICAO, name and alias safely', () => {
    expect(service).toContain('upper(airline.iata_code::text) = ${exactCodePlaceholder}')
    expect(service).toContain('upper(airline.icao_code::text) = ${exactCodePlaceholder}')
    expect(service).toContain('airline.normalized_name like ${containsPlaceholder}')
    expect(service).toContain('airline.normalized_legal_name like ${containsPlaceholder}')
    expect(service).toContain('from geo_airline_aliases alias')
    expect(service).toContain('alias.normalized_alias like ${containsPlaceholder}')
    expect(service).toContain('limit $${values.length - 1} offset $${values.length}')
  })

  it('exposes an authenticated rate-limited GET endpoint', () => {
    expect(route).toContain('export async function GET(request: Request)')
    expect(route).toContain('requireAuth: true')
    expect(route).toContain("key: 'geography:airlines'")
    expect(route).toContain('Object.fromEntries(new URL(request.url).searchParams)')
    expect(route).toContain("'Cache-Control': 'private, max-age=300'")
  })
})

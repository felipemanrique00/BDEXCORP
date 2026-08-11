import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'deploy/postgres/migrations/0072_airline_catalog.sql'),
  'utf8',
)

describe('airline catalog migration', () => {
  it('creates a global searchable airline catalog with brand presentation', () => {
    expect(migration).toContain('create table if not exists geo_airlines')
    expect(migration).toContain('iata_code citext not null')
    expect(migration).toContain('icao_code citext')
    expect(migration).toContain('logo_path text')
    expect(migration).toContain('logo_background_color text')
    expect(migration).toContain("logo_path ~ '^/airlines/[A-Za-z0-9_-]+\\.svg$'")
    expect(migration).toContain('geo_airlines_iata_idx')
    expect(migration).toContain('geo_airlines_icao_idx')
  })

  it('keeps aliases separate and seeds the Brazilian offline carriers', () => {
    expect(migration).toContain('create table if not exists geo_airline_aliases')
    expect(migration).toContain("'historical_iata'")
    expect(migration).toContain("'AD', 'AZU', 'Azul'")
    expect(migration).toContain("'G3', 'GLO', 'GOL'")
    expect(migration).toContain("'LA', 'LAN', 'LATAM'")
    expect(migration).toContain("('LA', 'JJ', 'jj', 'historical_iata')")
    expect(migration).toContain("'/airlines/LA.svg', '#1B0088'")
  })
})

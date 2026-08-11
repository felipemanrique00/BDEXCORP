import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'deploy/postgres/migrations/0070_airport_catalog.sql'),
  'utf8',
)

describe('airport catalog migration', () => {
  it('creates a provider-neutral catalog with searchable codes', () => {
    expect(migration).toContain('create table if not exists geo_airports')
    expect(migration).toContain('iata_code citext')
    expect(migration).toContain('icao_code citext')
    expect(migration).toContain('scheduled_service boolean')
    expect(migration).toContain('geo_airports_iata_idx')
    expect(migration).toContain('geo_airports_icao_idx')
  })

  it('keeps source lineage, aliases and metropolitan codes separate', () => {
    expect(migration).toContain('create table if not exists geo_airport_sources')
    expect(migration).toContain('source_checksum_sha256 char(64)')
    expect(migration).toContain('create table if not exists geo_airport_aliases')
    expect(migration).toContain('create table if not exists geo_airport_location_codes')
    expect(migration).toContain("'airport', 'metropolitan', 'city'")
    expect(migration).toContain('create table if not exists geo_airport_location_code_memberships')
  })
})

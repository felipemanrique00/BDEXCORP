import { describe, expect, it } from 'vitest'

import {
  compatibleMigrationChecksums,
  isMigrationChecksumCompatible,
  migrationChecksum,
} from '../../scripts/migration-checksum.mjs'

describe('migration checksum compatibility', () => {
  const lfSql = 'begin;\ncreate table example (id uuid);\ncommit;\n'
  const crlfSql = lfSql.replace(/\n/g, '\r\n')

  it('accepts the exact checksum', () => {
    expect(isMigrationChecksumCompatible(lfSql, migrationChecksum(lfSql))).toBe(true)
  })

  it('accepts only the equivalent LF and CRLF byte sequences', () => {
    const crSql = lfSql.replace(/\n/g, '\r')
    expect(migrationChecksum(lfSql)).not.toBe(migrationChecksum(crlfSql))
    expect(isMigrationChecksumCompatible(lfSql, migrationChecksum(crlfSql))).toBe(true)
    expect(isMigrationChecksumCompatible(crlfSql, migrationChecksum(lfSql))).toBe(true)
    expect(isMigrationChecksumCompatible(lfSql, migrationChecksum(crSql))).toBe(false)
    expect(compatibleMigrationChecksums(lfSql)).toHaveLength(2)
  })

  it('continues rejecting any SQL content change', () => {
    const changedSql = lfSql.replace('uuid', 'text')
    expect(isMigrationChecksumCompatible(changedSql, migrationChecksum(lfSql))).toBe(false)
    expect(isMigrationChecksumCompatible(
      changedSql.replace(/\n/g, '\r\n'),
      migrationChecksum(crlfSql),
    )).toBe(false)
  })
})

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  evaluateMigrationReadiness,
  readMigrationInventory,
} from '@/lib/server/migration-readiness'

describe('migration readiness', () => {
  const inventory = [
    { name: '0001_platform.sql', checksum: 'checksum-1' },
    { name: '0002_domain.sql', checksum: 'checksum-2' },
  ]

  it('builds the inventory checksum from the complete SQL content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bbt-migration-readiness-'))
    try {
      const directory = path.join(root, 'deploy', 'postgres', 'migrations')
      await mkdir(directory, { recursive: true })
      const sql = 'select 1;\n'
      await writeFile(path.join(directory, '0001_platform.sql'), sql, 'utf8')
      await writeFile(path.join(directory, 'README.txt'), 'ignored', 'utf8')

      await expect(readMigrationInventory(root)).resolves.toEqual([{
        name: '0001_platform.sql',
        checksum: createHash('sha256').update(sql).digest('hex'),
      }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts only an exact migration inventory with matching checksums', () => {
    expect(evaluateMigrationReadiness(inventory, [...inventory])).toEqual({
      ok: true,
      missing: [],
      extra: [],
      checksumMismatches: [],
    })
  })

  it('rejects missing and extra migrations', () => {
    expect(evaluateMigrationReadiness(inventory, [
      inventory[0],
      { name: '9999_unknown.sql', checksum: 'checksum-extra' },
    ])).toEqual({
      ok: false,
      missing: ['0002_domain.sql'],
      extra: ['9999_unknown.sql'],
      checksumMismatches: [],
    })
  })

  it('rejects a changed checksum for an applied migration', () => {
    expect(evaluateMigrationReadiness(inventory, [
      inventory[0],
      { name: '0002_domain.sql', checksum: 'tampered-checksum' },
    ])).toEqual({
      ok: false,
      missing: [],
      extra: [],
      checksumMismatches: ['0002_domain.sql'],
    })
  })
})

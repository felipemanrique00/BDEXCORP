import 'server-only'

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_-]+\.sql$/i

export interface MigrationInventoryEntry {
  name: string
  checksum: string
}

export interface MigrationReadinessState {
  ok: boolean
  missing: string[]
  extra: string[]
  checksumMismatches: string[]
}

export async function readMigrationInventory(
  rootDirectory = process.cwd(),
): Promise<MigrationInventoryEntry[]> {
  const directory = path.join(rootDirectory, 'deploy', 'postgres', 'migrations')
  const names = (await readdir(directory))
    .filter((name) => MIGRATION_FILE_PATTERN.test(name))
    .sort((left, right) => left.localeCompare(right))
  if (!names.length) throw new Error('Inventario de migrations indisponivel.')

  return Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(directory, name), 'utf8')
    return {
      name,
      checksum: createHash('sha256').update(sql).digest('hex'),
    }
  }))
}

export function evaluateMigrationReadiness(
  required: MigrationInventoryEntry[],
  applied: MigrationInventoryEntry[],
): MigrationReadinessState {
  const requiredByName = new Map(required.map((migration) => [migration.name, migration.checksum]))
  const appliedByName = new Map(applied.map((migration) => [migration.name, migration.checksum]))

  const missing = [...requiredByName.keys()]
    .filter((name) => !appliedByName.has(name))
    .sort((left, right) => left.localeCompare(right))
  const extra = [...appliedByName.keys()]
    .filter((name) => !requiredByName.has(name))
    .sort((left, right) => left.localeCompare(right))
  const checksumMismatches = [...requiredByName.entries()]
    .filter(([name, checksum]) => appliedByName.has(name) && appliedByName.get(name) !== checksum)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right))

  return {
    ok: missing.length === 0 && extra.length === 0 && checksumMismatches.length === 0,
    missing,
    extra,
    checksumMismatches,
  }
}

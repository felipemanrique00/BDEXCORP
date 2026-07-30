import { NextResponse } from 'next/server'

import { queryDatabase } from '@/lib/server/database'
import { logError } from '@/lib/server/logger'
import {
  evaluateMigrationReadiness,
  readMigrationInventory,
} from '@/lib/server/migration-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const requiredMigrations = await readMigrationInventory()
    const databaseRole = await queryDatabase<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    )
    if (process.env.NODE_ENV === 'production' && (
      databaseRole.rows[0]?.rolsuper || databaseRole.rows[0]?.rolbypassrls
    )) {
      return NextResponse.json(
        { ok: false, code: 'DATABASE_ROLE_INSECURE' },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }
    const result = await queryDatabase<{ name: string; checksum: string }>(
      'select name, checksum from schema_migrations',
    )
    const migrationState = evaluateMigrationReadiness(requiredMigrations, result.rows)
    if (!migrationState.ok) {
      const inconsistent = (
        migrationState.extra.length > 0 ||
        migrationState.checksumMismatches.length > 0
      )
      return NextResponse.json(
        {
          ok: false,
          code: inconsistent ? 'MIGRATIONS_INCONSISTENT' : 'MIGRATIONS_PENDING',
          pendingCount: migrationState.missing.length,
          extraCount: migrationState.extra.length,
          checksumMismatchCount: migrationState.checksumMismatches.length,
          requiredCount: requiredMigrations.length,
          appliedCount: result.rows.length,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }
    return NextResponse.json(
      {
        ok: true,
        service: 'bbt-corporativo',
        schemaVersion: requiredMigrations.at(-1)?.name,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  } catch (error) {
    logError('readiness_check_failed', error, { errorCode: 'READINESS_DATABASE_ERROR' })
    return NextResponse.json(
      { ok: false, code: 'DEPENDENCY_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }
}

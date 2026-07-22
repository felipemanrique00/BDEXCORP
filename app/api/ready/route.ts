import { NextResponse } from 'next/server'

import { queryDatabase } from '@/lib/server/database'
import { logError } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REQUIRED_MIGRATIONS = [
  '0001_platform_core.sql',
  '0002_travel_domain.sql',
  '0003_file_links.sql',
  '0004_tenant_usage.sql',
]

export async function GET() {
  try {
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
    const result = await queryDatabase<{ name: string }>(
      'select name from schema_migrations where name = any($1::text[])',
      [REQUIRED_MIGRATIONS],
    )
    const applied = new Set(result.rows.map((row) => row.name))
    const pending = REQUIRED_MIGRATIONS.filter((name) => !applied.has(name))
    if (pending.length) {
      return NextResponse.json(
        { ok: false, code: 'MIGRATIONS_PENDING' },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      )
    }
    return NextResponse.json(
      { ok: true, service: 'bbt-corporativo' },
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

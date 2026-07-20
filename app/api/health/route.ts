import { NextResponse } from 'next/server'

import { databaseConfigured, pingDatabase } from '@/lib/server-db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const database = {
    configured: databaseConfigured(),
    ok: false,
  }

  if (database.configured) {
    try {
      await pingDatabase()
      database.ok = true
    } catch (error) {
      console.error('[health] Falha ao verificar o armazenamento persistente.', error)
    }
  }

  const ok = !database.configured || database.ok

  return NextResponse.json(
    {
      ok,
      app: 'BBT Corporativo',
      time: new Date().toISOString(),
      database,
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  )
}

import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { listTenantDirectory } from '@/lib/server/user-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'users-directory:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const users = await listTenantDirectory(guard.principal!)
  return NextResponse.json({ ok: true, users }, { headers: { 'Cache-Control': 'no-store, private' } })
}

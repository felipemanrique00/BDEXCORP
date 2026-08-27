import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { getClientIp } from '@/lib/server/auth-service'
import {
  ImpersonationError,
  listImpersonationTargets,
} from '@/lib/server/impersonation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    authorization: { action: 'read', resource: 'session', allowSelf: true },
    rateLimit: { key: 'impersonation-targets:get', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const url = new URL(request.url)
    const items = await listImpersonationTargets(
      guard.principal!,
      url.searchParams.get('q') || '',
      Number(url.searchParams.get('limit') || 20),
      metadata(request, guard.requestId),
    )
    return NextResponse.json({ ok: true, items, total: items.length })
  } catch (error) {
    return impersonationError(error)
  }
}

function metadata(request: Request, requestId: string) {
  return { requestId, ipAddress: getClientIp(request), userAgent: request.headers.get('user-agent') }
}

function impersonationError(error: unknown) {
  if (error instanceof ImpersonationError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status })
  }
  throw error
}

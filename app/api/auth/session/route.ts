import { NextResponse } from 'next/server'

import { authRequired, getSessionUserFromRequest } from '@/lib/server-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = getSessionUserFromRequest(request)
  return NextResponse.json({
    ok: Boolean(user),
    requireSession: authRequired(),
    user,
  })
}

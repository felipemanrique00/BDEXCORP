import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readEffectiveCorporateBrandingLogo } from '@/lib/server/corporate-branding-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    authorization: { resource: 'navigation', action: 'read' },
    rateLimit: { key: 'effective-branding:logo', limit: 240, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    const file = await readEffectiveCorporateBrandingLogo(
      guard.principal!,
      id,
      Object.fromEntries(new URL(request.url).searchParams),
    )
    return new NextResponse(Uint8Array.from(file.bytes), {
      headers: {
        'Content-Type': file.record.mimeType,
        'Content-Length': String(file.record.sizeBytes),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=300',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': guard.requestId,
      },
    })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

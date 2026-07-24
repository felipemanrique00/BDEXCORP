import { NextResponse } from 'next/server'

import {
  intelligenceFingerprintSchema,
  intelligenceInsightTransitionSchema,
} from '@/lib/intelligence'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'
import { transitionIntelligenceInsightState } from '@/lib/server/intelligence-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ fingerprint: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_ia',
    authorization: {
      resource: 'intelligence',
      action: 'manage',
      requiredPermission: 'gerenciar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'intelligence:insight-transition', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const body = await readJsonBodyResult<unknown>(request, 32 * 1024)
  if (!body.ok) return governanceBodyErrorResponse(body, guard.requestId)
  try {
    const { fingerprint: rawFingerprint } = await context.params
    const fingerprint = intelligenceFingerprintSchema.parse(rawFingerprint)
    const input = intelligenceInsightTransitionSchema.parse(body.body)
    const insight = await runInApiGuardContext(
      guard,
      () => transitionIntelligenceInsightState(guard.principal!, fingerprint, input),
    )
    return NextResponse.json(
      { ok: true, insight },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

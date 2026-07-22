import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { logError } from '@/lib/server/logger'
import {
  listPlatformPlans,
  PlatformNotFoundError,
  upsertPlatformPlan,
} from '@/lib/server/platform-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const optionalLimit = z.number().int().positive().nullable()
const planSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(120),
  active: z.boolean(),
  maxUsers: optionalLimit,
  maxStorageBytes: optionalLimit,
  maxMonthlyOperations: optionalLimit,
  entitlements: z.record(z.boolean()).default({}),
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, platformAdmin: true, rateLimit: { key: 'platform-plans:get', limit: 60, windowMs: 60_000 } })
  if (guard.response) return guard.response
  return NextResponse.json({ ok: true, plans: await listPlatformPlans() })
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, platformAdmin: true, rateLimit: { key: 'platform-plans:post', limit: 20, windowMs: 60_000 } })
  if (guard.response) return guard.response
  try {
    const input = planSchema.parse(await readJsonBody<unknown>(request, 64 * 1024))
    const plan = await upsertPlatformPlan(input)
    await writeAuditEvent({
      action: input.id ? 'platform.plan_update' : 'platform.plan_create',
      result: 'success',
      entityType: 'plan',
      entityId: plan.id,
      metadata: { planKey: plan.key },
    })
    return NextResponse.json({ ok: true, plan }, { status: input.id ? 200 : 201 })
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Dados do plano invalidos.' }, { status: 400 })
    if (error instanceof PlatformNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    logError('platform_plan_write_failed', error, { requestId: guard.requestId, errorCode: 'PLATFORM_PLAN_WRITE_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel salvar o plano.' }, { status: 503 })
  }
}

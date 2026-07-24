import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { EmployeeIdentityError, linkDemandsToEmployee } from '@/lib/server/employee-identity-service'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const linkDemandsSchema = z.object({
  employeeId: z.string().trim().min(1).max(200),
  demandIds: z.array(z.string().trim().min(1).max(200)).min(1).max(5_000),
  aliases: z.array(z.string().trim().min(2).max(300)).max(100).optional(),
})

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_funcionarios',
    rateLimit: { key: 'employees-link-demands:post', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 1024 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const body = linkDemandsSchema.parse(input.body)
    const result = await linkDemandsToEmployee(guard.principal!, body)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Dados invalidos para vincular as demandas.', details: error.flatten() }, { status: 400 })
    }
    if (error instanceof EmployeeIdentityError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, requestId: guard.requestId },
        { status: error.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    return governanceErrorResponse(error, guard.requestId)
  }
}

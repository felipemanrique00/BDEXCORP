import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requesterCompanyIdentifierSchema } from '@/lib/requesters/schema'
import { guardApiRequest } from '@/lib/security/api-guard'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  removeCompanyRequester,
  RequesterServiceError,
} from '@/lib/server/requester-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_solicitantes',
    rateLimit: { key: 'solicitantes-empresa:delete', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    const companyId = requesterCompanyIdentifierSchema.parse(
      new URL(request.url).searchParams.get('companyId'),
    )
    const result = await removeCompanyRequester(guard.principal!, id, companyId)
    return NextResponse.json(
      { ok: true, removedId: result.removedId, solicitantes: result.requesters },
      { headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'Identificadores invalidos.', details: error.flatten(), requestId: guard.requestId },
        { status: 400, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (error instanceof CorporateAccessDeniedError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, requestId: guard.requestId },
        { status: 403, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (error instanceof RequesterServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, requestId: guard.requestId },
        { status: error.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    console.error('[solicitantes:empresa:delete]', error)
    return NextResponse.json(
      { ok: false, error: 'Falha ao remover solicitante.', requestId: guard.requestId },
      { status: 500, headers: { 'X-Request-Id': guard.requestId } },
    )
  }
}

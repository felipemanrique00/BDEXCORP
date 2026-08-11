import { NextResponse } from 'next/server'

import { guardApiRequest } from '@/lib/security/api-guard'
import { BRANDING_IMAGE_MAX_BYTES } from '@/lib/security/branding-image'
import { uploadCorporateBrandingLogo } from '@/lib/server/corporate-branding-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ scopeType: string; scopeId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'alterar_configuracoes',
    authorization: {
      resource: 'settings',
      action: 'update',
      requiredPermission: 'alterar_configuracoes',
    },
    rateLimit: { key: 'corporate-branding-settings:logo-upload', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength && contentLength > BRANDING_IMAGE_MAX_BYTES + 256 * 1024) {
    return NextResponse.json(
      { ok: false, code: 'BODY_TOO_LARGE', error: 'A logomarca deve ter no maximo 5 MB.' },
      { status: 413, headers: { 'X-Request-Id': guard.requestId } },
    )
  }

  try {
    const { scopeType, scopeId } = await context.params
    const form = await request.formData()
    const uploaded = form.get('file')
    if (!(uploaded instanceof File)) {
      return NextResponse.json(
        { ok: false, code: 'VALIDATION_ERROR', error: 'Arquivo de logomarca obrigatorio.' },
        { status: 400, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (!uploaded.size || uploaded.size > BRANDING_IMAGE_MAX_BYTES) {
      return NextResponse.json(
        { ok: false, code: 'BODY_TOO_LARGE', error: 'A logomarca deve ter no maximo 5 MB.' },
        { status: 413, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    const expectedVersionValue = form.get('expectedVersion')
    const expectedVersion = expectedVersionValue === null || expectedVersionValue === ''
      ? undefined
      : expectedVersionValue === 'null'
        ? null
        : Number(expectedVersionValue)
    const configuration = await uploadCorporateBrandingLogo({
      principal: guard.principal!,
      rawScopeType: scopeType,
      rawScopeId: scopeId,
      bytes: Buffer.from(await uploaded.arrayBuffer()),
      originalName: uploaded.name,
      declaredMimeType: uploaded.type,
      expectedVersion,
    })
    return NextResponse.json(
      { ok: true, configuration },
      {
        status: 201,
        headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { FileQuotaExceededError } from '@/lib/server/file-storage'
import { governanceBodyErrorResponse, governanceErrorResponse } from '@/lib/server/governance-api'
import {
  HOTEL_CATALOG_MEDIA_MAX_BYTES,
  reorderHotelCatalogMedia,
  uploadHotelCatalogMedia,
} from '@/lib/server/hotel-catalog-media-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'cadastrar_hoteis',
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    rateLimit: { key: 'hotel-catalog:media-upload', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      return NextResponse.json(
        { ok: false, code: 'CONTENT_LENGTH_REQUIRED', error: 'Informe o tamanho do envio da foto.' },
        { status: 411, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    if (contentLength > HOTEL_CATALOG_MEDIA_MAX_BYTES + 256 * 1024) {
      return NextResponse.json(
        { ok: false, code: 'BODY_TOO_LARGE', error: 'A foto deve ter no maximo 5 MB.' },
        { status: 413, headers: { 'X-Request-Id': guard.requestId } },
      )
    }

    try {
      const { id } = await context.params
      const form = await request.formData()
      const uploaded = form.get('file')
      if (!(uploaded instanceof File)) {
        return NextResponse.json(
          { ok: false, code: 'VALIDATION_ERROR', error: 'Arquivo de foto obrigatorio.' },
          { status: 400, headers: { 'X-Request-Id': guard.requestId } },
        )
      }
      if (!uploaded.size || uploaded.size > HOTEL_CATALOG_MEDIA_MAX_BYTES) {
        return NextResponse.json(
          { ok: false, code: 'BODY_TOO_LARGE', error: 'A foto deve ter no maximo 5 MB.' },
          { status: 413, headers: { 'X-Request-Id': guard.requestId } },
        )
      }
      const media = await uploadHotelCatalogMedia({
        principal: guard.principal!,
        rawHotelId: id,
        rawRoomTypeId: form.get('roomTypeId'),
        rawAltText: form.get('altText'),
        bytes: Buffer.from(await uploaded.arrayBuffer()),
        originalName: uploaded.name,
        declaredMimeType: uploaded.type,
      })
      return NextResponse.json(
        { ok: true, media },
        {
          status: 201,
          headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
        },
      )
    } catch (error) {
      if (error instanceof FileQuotaExceededError) {
        return NextResponse.json(
          { ok: false, code: 'STORAGE_QUOTA_EXCEEDED', error: error.message },
          { status: 409, headers: { 'X-Request-Id': guard.requestId } },
        )
      }
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'cadastrar_hoteis',
    roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator'],
    rateLimit: { key: 'hotel-catalog:media-order', limit: 90, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<unknown>(request, 64 * 1024)
    if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)
    try {
      const { id } = await context.params
      const items = await reorderHotelCatalogMedia(guard.principal!, id, input.body)
      return NextResponse.json(
        { ok: true, items },
        { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
      )
    } catch (error) {
      return governanceErrorResponse(error, guard.requestId)
    }
  })
}

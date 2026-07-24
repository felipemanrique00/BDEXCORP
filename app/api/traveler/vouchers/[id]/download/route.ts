import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { readStoredFile, StoredFileNotFoundError } from '@/lib/server/file-storage'
import { logError } from '@/lib/server/logger'
import { getTravelerVoucherFileId } from '@/lib/server/traveler-portal-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'acessar_portal_viajante',
    authorization: {
      resource: 'traveler_portal',
      action: 'read',
      requiredPermission: 'acessar_portal_viajante',
    },
    rateLimit: { key: 'traveler:voucher-download', limit: 90, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
      return notFound(guard.requestId)
    }

    const fileId = await runInApiGuardContext(
      guard,
      () => getTravelerVoucherFileId(guard.principal!, id),
    )
    if (!fileId) return notFound(guard.requestId)

    const file = await runInApiGuardContext(
      guard,
      () => readStoredFile(guard.principal!, fileId),
    )
    await runInApiGuardContext(
      guard,
      () => writeAuditEvent({
        action: 'traveler.voucher.download',
        result: 'success',
        entityType: 'voucher',
        entityId: id,
      }),
    )

    return new NextResponse(Uint8Array.from(file.bytes), {
      headers: {
        'Content-Type': file.record.mimeType,
        'Content-Length': String(file.record.sizeBytes),
        'Content-Disposition': contentDisposition(file.record.originalName),
        'Cache-Control': 'no-store, private',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': guard.requestId,
      },
    })
  } catch (error) {
    if (error instanceof StoredFileNotFoundError) return notFound(guard.requestId)
    logError('traveler_voucher_download_failed', error, {
      requestId: guard.requestId,
      tenantId: guard.principal?.tenantId,
      userId: guard.principal?.user.id,
      errorCode: 'TRAVELER_VOUCHER_DOWNLOAD_FAILED',
    })
    return NextResponse.json(
      {
        ok: false,
        code: 'TRAVELER_VOUCHER_DOWNLOAD_FAILED',
        error: 'Nao foi possivel baixar o voucher.',
        requestId: guard.requestId,
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, private',
          'X-Request-Id': guard.requestId,
        },
      },
    )
  }
}

function notFound(requestId: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: 'TRAVELER_VOUCHER_NOT_FOUND',
      error: 'Voucher nao encontrado.',
      requestId,
    },
    {
      status: 404,
      headers: {
        'Cache-Control': 'no-store, private',
        'X-Request-Id': requestId,
      },
    },
  )
}

function contentDisposition(originalName: string): string {
  const ascii = originalName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'voucher.pdf'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(originalName)}`
}

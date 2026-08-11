import { NextResponse } from 'next/server'

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { renderVoucherHtml } from '@/lib/assistant/pdf'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { getCompanyDocumentBranding } from '@/lib/server/corporate-branding-service'
import { readStoredFile, StoredFileNotFoundError } from '@/lib/server/file-storage'
import { logError } from '@/lib/server/logger'
import { getTravelerVoucherDownloadDescriptor } from '@/lib/server/traveler-portal-service'
import {
  resolveVoucherEmailAssets,
  toVoucherDocumentAssets,
} from '@/lib/server/voucher-email-assets'
import { collectVoucherDocumentAirlineCodes } from '@/lib/vouchers/document-model'
import { requiresSanitizedVoucherRendering } from '@/lib/vouchers/presentation'

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

    const descriptor = await runInApiGuardContext(
      guard,
      () => getTravelerVoucherDownloadDescriptor(guard.principal!, id),
    )
    if (!descriptor) return notFound(guard.requestId)

    if (requiresSanitizedVoucherRendering(descriptor.presentationSettings)) {
      if (!descriptor.voucher) return sanitizedArtifactUnavailable(guard.requestId)
      const { branding, logoDataUrl } = await runInApiGuardContext(
        guard,
        () => getCompanyDocumentBranding(guard.principal!, descriptor.voucher!.empresa_id),
      )
      const documentBranding = {
        displayName: branding.displayName,
        logoDataUrl: branding.sources.logoUrl === 'system' ? null : logoDataUrl,
        primaryColor: branding.primaryColor,
        accentColor: branding.accentColor,
        documentLegalName: branding.documentLegalName,
        documentNumber: branding.documentNumber,
      }
      const assets = await resolveVoucherEmailAssets({
        corporateLogoDataUrl: documentBranding.logoDataUrl,
        airlineIataCodes: collectVoucherDocumentAirlineCodes(descriptor.voucher),
      })
      const html = renderVoucherHtml(
        descriptor.voucher,
        true,
        documentBranding,
        toVoucherDocumentAssets(assets, 'data-uri', {
          agencyLogoAlt: 'BBT Corporativo',
          customerLogoAlt: branding.displayName,
        }),
      )
      const bytes = new TextEncoder().encode(html)
      await runInApiGuardContext(
        guard,
        () => writeAuditEvent({
          action: 'traveler.voucher.download',
          result: 'success',
          entityType: 'voucher',
          entityId: id,
          metadata: { presentation: 'sanitized-html' },
        }),
      )
      return new NextResponse(bytes, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(bytes.byteLength),
          'Content-Disposition': contentDisposition(`voucher-${id}.html`),
          'Cache-Control': 'no-store, private',
          'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
          'X-Content-Type-Options': 'nosniff',
          'X-Request-Id': guard.requestId,
          'X-Voucher-Presentation': 'sanitized',
        },
      })
    }

    if (!descriptor.fileId) return notFound(guard.requestId)

    const file = await runInApiGuardContext(
      guard,
      () => readStoredFile(guard.principal!, descriptor.fileId!),
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

function sanitizedArtifactUnavailable(requestId: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: 'TRAVELER_VOUCHER_SANITIZED_ARTIFACT_UNAVAILABLE',
      error: 'O voucher precisa ser regenerado para aplicar as regras atuais de exibicao.',
      requestId,
    },
    {
      status: 409,
      headers: {
        'Cache-Control': 'no-store, private',
        'X-Request-Id': requestId,
      },
    },
  )
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

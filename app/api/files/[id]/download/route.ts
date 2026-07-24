import { NextResponse } from 'next/server'

import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  assertStoredFileAccess,
  FileAccessDeniedError,
  guardFileEntityRequest,
} from '@/lib/server/file-access'
import { readStoredFile, StoredFileNotFoundError } from '@/lib/server/file-storage'
import { logError } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardFileEntityRequest(
    request,
    { key: 'files:download', limit: 180, windowMs: 60_000 },
  )
  if (guard.response) return guard.response

  try {
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StoredFileNotFoundError('Arquivo nao encontrado.')
    const file = await readStoredFile(guard.principal!, id)
    await assertStoredFileAccess(guard.principal!, file.links)
    await writeAuditEvent({
      action: 'file.download',
      result: 'success',
      entityType: 'stored_file',
      entityId: file.record.id,
    })

    const inline = new URL(request.url).searchParams.get('inline') === '1'
    return new NextResponse(Uint8Array.from(file.bytes), {
      headers: {
        'Content-Type': file.record.mimeType,
        'Content-Length': String(file.record.sizeBytes),
        'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', file.record.originalName),
        'Cache-Control': 'no-store, private',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof StoredFileNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    if (error instanceof FileAccessDeniedError) return NextResponse.json({ ok: false, error: error.message }, { status: 403 })
    logError('file_download_failed', error, { requestId: guard.requestId, errorCode: 'FILE_DOWNLOAD_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel baixar o arquivo.' }, { status: 503 })
  }
}

function contentDisposition(disposition: 'inline' | 'attachment', originalName: string): string {
  const ascii = originalName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'documento.pdf'
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(originalName)}`
}

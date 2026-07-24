import { NextResponse } from 'next/server'

import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  assertStoredFileMutationAccess,
  FileAccessDeniedError,
  guardFileEntityRequest,
} from '@/lib/server/file-access'
import {
  deleteStoredFile,
  readStoredFile,
  StoredFileNotFoundError,
} from '@/lib/server/file-storage'
import { logError } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardFileEntityRequest(
    request,
    { key: 'files:delete', limit: 30, windowMs: 60_000 },
  )
  if (guard.response) return guard.response
  try {
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StoredFileNotFoundError('Arquivo nao encontrado.')
    const file = await readStoredFile(guard.principal!, id)
    await assertStoredFileMutationAccess(guard.principal!, file.links)
    await deleteStoredFile(guard.principal!, id)
    await writeAuditEvent({
      action: 'file.delete',
      result: 'success',
      entityType: 'stored_file',
      entityId: id,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof StoredFileNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    if (error instanceof FileAccessDeniedError) return NextResponse.json({ ok: false, error: error.message }, { status: 403 })
    logError('file_delete_failed', error, { requestId: guard.requestId, errorCode: 'FILE_DELETE_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel excluir o arquivo.' }, { status: 503 })
  }
}

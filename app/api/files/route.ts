import { NextResponse } from 'next/server'
import { z } from 'zod'

import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  assertFileEntityAccess,
  assertFileEntityMutationAccess,
  FileAccessDeniedError,
  guardFileEntityRequest,
} from '@/lib/server/file-access'
import {
  createStoredPdf,
  FILE_ENTITY_TYPES,
  FileQuotaExceededError,
  FileValidationError,
  listStoredFiles,
  type FileEntityType,
  type FileLinkInput,
} from '@/lib/server/file-storage'
import { getServerEnvironment } from '@/lib/server/environment'
import { logError } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  entityType: z.enum(FILE_ENTITY_TYPES),
  entityId: z.string().trim().min(1).max(200),
})

export async function GET(request: Request) {
  const guard = await guardFileEntityRequest(
    request,
    { key: 'files:list', limit: 120, windowMs: 60_000 },
  )
  if (guard.response) return guard.response

  try {
    const url = new URL(request.url)
    const query = querySchema.parse({
      entityType: url.searchParams.get('entityType'),
      entityId: url.searchParams.get('entityId'),
    })
    await assertFileEntityAccess(guard.principal!, query)
    const files = await listStoredFiles(guard.principal!, query)
    return NextResponse.json({ ok: true, files }, { headers: { 'Cache-Control': 'no-store, private' } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: 'Filtro de arquivos invalido.' }, { status: 400 })
    if (error instanceof FileAccessDeniedError) return NextResponse.json({ ok: false, error: error.message }, { status: 403 })
    logError('file_list_failed', error, { requestId: guard.requestId, errorCode: 'FILE_LIST_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel listar os arquivos.' }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const guard = await guardFileEntityRequest(
    request,
    { key: 'files:upload', limit: 30, windowMs: 60_000 },
  )
  if (guard.response) return guard.response

  const maxBytes = getServerEnvironment().MAX_UPLOAD_BYTES
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength && contentLength > maxBytes + 256 * 1024) {
    return NextResponse.json({ ok: false, error: 'Arquivo excede o limite permitido.' }, { status: 413 })
  }

  try {
    const form = await request.formData()
    const uploaded = form.get('file')
    if (!(uploaded instanceof File)) return NextResponse.json({ ok: false, error: 'Arquivo obrigatorio.' }, { status: 400 })

    const primary = querySchema.parse({
      entityType: form.get('entityType'),
      entityId: form.get('entityId'),
    })
    const links: FileLinkInput[] = [primary]
    const secondaryType = form.get('secondaryEntityType')
    const secondaryId = form.get('secondaryEntityId')
    if (secondaryType || secondaryId) {
      links.push(querySchema.parse({ entityType: secondaryType, entityId: secondaryId }))
    }
    for (const link of links) await assertFileEntityMutationAccess(guard.principal!, link)

    const bytes = Buffer.from(await uploaded.arrayBuffer())
    const file = await createStoredPdf({
      principal: guard.principal!,
      bytes,
      originalName: uploaded.name,
      description: String(form.get('description') || ''),
      links,
    })
    await writeAuditEvent({
      action: 'file.upload',
      result: 'success',
      entityType: 'stored_file',
      entityId: file.id,
      metadata: { purpose: file.purpose, sizeBytes: file.sizeBytes, links },
    })
    return NextResponse.json({ ok: true, file }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof FileValidationError) {
      return NextResponse.json({ ok: false, error: error instanceof FileValidationError ? error.message : 'Vinculo do arquivo invalido.' }, { status: 400 })
    }
    if (error instanceof FileQuotaExceededError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    if (error instanceof FileAccessDeniedError) return NextResponse.json({ ok: false, error: error.message }, { status: 403 })
    logError('file_upload_failed', error, { requestId: guard.requestId, errorCode: 'FILE_UPLOAD_FAILED' })
    return NextResponse.json({ ok: false, error: 'Nao foi possivel armazenar o arquivo.' }, { status: 503 })
  }
}

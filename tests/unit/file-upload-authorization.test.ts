import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  createStoredPdf: vi.fn(),
  getStorageEntries: vi.fn(),
  guardApiRequest: vi.fn(),
  hasServerPermission: vi.fn(),
  listStoredFiles: vi.fn(),
  requireCompanyAccess: vi.fn(),
  writeAuditEvent: vi.fn(),
}))

vi.mock('@/lib/security/api-guard', () => ({
  guardApiRequest: mocks.guardApiRequest,
  hasServerPermission: mocks.hasServerPermission,
}))
vi.mock('@/lib/server-db', () => ({
  getStorageEntries: mocks.getStorageEntries,
}))
vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))
vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccess: mocks.requireCompanyAccess,
}))
vi.mock('@/lib/server/environment', () => ({
  getServerEnvironment: () => ({ MAX_UPLOAD_BYTES: 10 * 1024 * 1024 }),
}))
vi.mock('@/lib/server/file-storage', () => ({
  FILE_ENTITY_TYPES: ['demand', 'employee', 'company', 'voucher', 'import'],
  FileQuotaExceededError: class FileQuotaExceededError extends Error {},
  FileValidationError: class FileValidationError extends Error {},
  createStoredPdf: mocks.createStoredPdf,
  listStoredFiles: mocks.listStoredFiles,
}))
vi.mock('@/lib/server/logger', () => ({
  logError: vi.fn(),
}))

import { GET, POST } from '@/app/api/files/route'

describe('file upload authorization', () => {
  const principal = {
    tenantId: '00000000-0000-4000-8000-000000000001',
    user: {
      id: 'user-importer',
      permissoes: { importar_planilhas: true },
    },
  } as RequestPrincipal

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardApiRequest.mockResolvedValue({
      principal,
      requestId: 'request-upload',
      response: null,
    })
    mocks.hasServerPermission.mockImplementation(
      (user: RequestPrincipal['user'], permission: string) =>
        Boolean(user.permissoes?.[permission as keyof NonNullable<typeof user.permissoes>]),
    )
    mocks.createStoredPdf.mockResolvedValue({
      id: 'file-import',
      purpose: 'import',
      sizeBytes: 15,
      downloadUrl: '/api/files/file-import/download',
    })
    mocks.listStoredFiles.mockResolvedValue([{
      id: 'file-import',
      purpose: 'import',
    }])
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('authenticates first and permits reading an import through importar_planilhas', async () => {
    const response = await GET(new Request(
      'http://localhost/api/files?entityType=import&entityId=import-job-1',
    ))

    expect(response.status).toBe(200)
    expect(mocks.guardApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      {
        requireAuth: true,
        authorization: {
          action: 'read',
          resource: 'session',
        },
        rateLimit: { key: 'files:list', limit: 120, windowMs: 60_000 },
      },
    )
    expect(mocks.hasServerPermission).toHaveBeenCalledWith(
      principal.user,
      'importar_planilhas',
    )
    expect(mocks.listStoredFiles).toHaveBeenCalledWith(principal, {
      entityType: 'import',
      entityId: 'import-job-1',
    })
  })

  it('authenticates first and permits an import through importar_planilhas', async () => {
    const response = await POST(importUploadRequest())

    expect(response.status).toBe(201)
    expect(mocks.guardApiRequest).toHaveBeenCalledWith(
      expect.any(Request),
      {
        requireAuth: true,
        authorization: {
          action: 'read',
          resource: 'session',
        },
        rateLimit: { key: 'files:upload', limit: 30, windowMs: 60_000 },
      },
    )
    expect(mocks.hasServerPermission).toHaveBeenCalledWith(
      principal.user,
      'importar_planilhas',
    )
    expect(mocks.createStoredPdf).toHaveBeenCalledOnce()
  })

  it('denies an import when importar_planilhas is absent', async () => {
    mocks.hasServerPermission.mockReturnValue(false)

    const response = await POST(importUploadRequest())

    expect(response.status).toBe(403)
    expect(mocks.createStoredPdf).not.toHaveBeenCalled()
  })
})

function importUploadRequest(): Request {
  const form = new FormData()
  form.set('entityType', 'import')
  form.set('entityId', 'import-job-1')
  form.set('file', new File(['%PDF-1.4\n%%EOF\n'], 'import.pdf', {
    type: 'application/pdf',
  }))
  return new Request('http://localhost/api/files', {
    method: 'POST',
    body: form,
  })
}

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  guardApiRequest: vi.fn(),
  getArtifact: vi.fn(),
  retryJob: vi.fn(),
  reconcileJob: vi.fn(),
}))

vi.mock('@/lib/security/api-guard', () => ({ guardApiRequest: mocks.guardApiRequest }))
vi.mock('@/lib/server/wintour-sync-service', () => ({
  WintourSyncError: class WintourSyncError extends Error {
    code = 'WINTOUR_TEST_ERROR'
    status = 400
  },
  getWintourSyncJobArtifact: mocks.getArtifact,
  retryWintourSyncJob: mocks.retryJob,
  reconcileWintourSyncJob: mocks.reconcileJob,
}))

import { GET as downloadJob } from '@/app/api/integrations/wintour/sync/jobs/[jobId]/download/route'
import { POST as reconcileJob } from '@/app/api/integrations/wintour/sync/jobs/[jobId]/reconcile/route'
import { POST as retryJob } from '@/app/api/integrations/wintour/sync/jobs/[jobId]/retry/route'

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const principal = {
  tenantId: 'tenant-a',
  user: { id: 'user-a' },
}

describe('Wintour administrative job routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardApiRequest.mockResolvedValue({
      principal,
      requestId: 'request-a',
      response: null,
    })
    mocks.getArtifact.mockResolvedValue({
      jobId: JOB_ID,
      operation: 'create',
      filename: 'wintour-create-0001.xml',
      contentType: 'application/xml',
      bytes: Uint8Array.from([60, 114, 97, 105, 122, 62]),
      sha256: 'a'.repeat(64),
      serializerVersion: 'wintour-create-v4',
    })
    mocks.retryJob.mockResolvedValue({ id: JOB_ID, state: 'ready' })
    mocks.reconcileJob.mockResolvedValue({ id: JOB_ID, state: 'completed' })
  })

  it('downloads only the tenant-scoped artifact as a non-cacheable ISO-8859-1 attachment', async () => {
    const response = await downloadJob(
      new Request(`http://localhost/api/integrations/wintour/sync/jobs/${JOB_ID}/download?tenantId=tenant-b`),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    )

    expect(mocks.getArtifact).toHaveBeenCalledWith(principal, { jobId: JOB_ID })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=iso-8859-1')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="wintour-create-0001.xml"')
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Request-Id')).toBe('request-a')
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([60, 114, 97, 105, 122, 62])
  })

  it('uses allowlisted optimistic retry and reconciliation inputs without accepting tenant scope from JSON', async () => {
    await retryJob(
      jsonRequest('retry', {
        expectedJobVersion: 3,
        reason: 'Falha conhecida corrigida',
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    )
    await reconcileJob(
      jsonRequest('reconcile', {
        expectedJobVersion: 4,
        targetState: 'completed',
        wintourSaleNumber: '123456',
        reason: 'Resultado conferido no Wintour',
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    )

    expect(mocks.retryJob).toHaveBeenCalledWith(principal, {
      jobId: JOB_ID,
      expectedJobVersion: 3,
      reason: 'Falha conhecida corrigida',
    })
    expect(mocks.reconcileJob).toHaveBeenCalledWith(principal, {
      jobId: JOB_ID,
      expectedJobVersion: 4,
      targetState: 'completed',
      wintourSaleNumber: '123456',
      reason: 'Resultado conferido no Wintour',
    })
  })

  it('never returns an artifact when the integration permission guard rejects the request', async () => {
    mocks.guardApiRequest.mockResolvedValue({
      principal: null,
      requestId: 'request-denied',
      response: new Response(JSON.stringify({ ok: false }), { status: 403 }),
    })

    const response = await downloadJob(
      new Request(`http://localhost/api/integrations/wintour/sync/jobs/${JOB_ID}/download`),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    )

    expect(response.status).toBe(403)
    expect(mocks.getArtifact).not.toHaveBeenCalled()
  })
})

function jsonRequest(action: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/integrations/wintour/sync/jobs/${JOB_ID}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

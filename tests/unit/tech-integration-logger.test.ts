import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appendIntegrationActionLog: vi.fn(),
  getRequestContext: vi.fn(),
}))

vi.mock('@/lib/server/integration-action-log-service', () => ({
  appendIntegrationActionLog: mocks.appendIntegrationActionLog,
}))
vi.mock('@/lib/server/request-context', () => ({
  getRequestContext: mocks.getRequestContext,
}))

import { logTechIntegration } from '@/lib/integrations/tech/tech-logger'

describe('Tech integration logger', () => {
  beforeEach(() => {
    mocks.appendIntegrationActionLog.mockReset()
    mocks.appendIntegrationActionLog.mockResolvedValue('log-id')
    mocks.getRequestContext.mockReset()
  })

  it('persists a redacted tenant-scoped log when an authenticated context exists', async () => {
    mocks.getRequestContext.mockReturnValue({
      requestId: 'request-a',
      principal: {
        tenantId: 'tenant-a',
        user: { id: 'user-a' },
      },
    })

    const result = await logTechIntegration({
      action: 'login',
      status: 'error',
      message: 'Falha controlada',
      endpoint: '/login',
      durationMs: 42,
      metadata: {
        token: 'secret-token',
        nested: { senha: 'secret-password', visible: 'ok' },
      },
    })

    expect(result.metadata).toEqual({
      token: '***',
      nested: { senha: '***', visible: 'ok' },
    })
    expect(mocks.appendIntegrationActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      expect.objectContaining({
        providerKey: 'tech-ttravel',
        status: 'failure',
        endpoint: '/login',
        durationMs: 42,
        payloadRedacted: {
          requestId: 'request-a',
          metadata: {
            token: '***',
            nested: { senha: '***', visible: 'ok' },
          },
        },
      }),
    )
  })

  it('does not write outside an authenticated tenant context', async () => {
    mocks.getRequestContext.mockReturnValue(null)

    await logTechIntegration({
      action: 'status',
      status: 'success',
      message: 'Consulta executada',
    })

    expect(mocks.appendIntegrationActionLog).not.toHaveBeenCalled()
  })
})

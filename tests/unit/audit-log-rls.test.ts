import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  getRequestContext: vi.fn(),
  logError: vi.fn(),
  queryDatabase: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  queryDatabase: mocks.queryDatabase,
  withTenantTransaction: mocks.withTenantTransaction,
}))
vi.mock('@/lib/server/logger', () => ({
  logError: mocks.logError,
}))
vi.mock('@/lib/server/request-context', () => ({
  getRequestContext: mocks.getRequestContext,
}))

import { writeAuditEvent } from '@/lib/server/audit-log'

describe('audit log RLS context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clientQuery.mockResolvedValue({ rows: [] })
    mocks.queryDatabase.mockResolvedValue({ rows: [] })
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.clientQuery }) => unknown) =>
        operation({ query: mocks.clientQuery }),
    )
  })

  it('writes tenant audit events inside the tenant transaction', async () => {
    mocks.getRequestContext.mockReturnValue({
      requestId: '936da01f-80d8-4b75-b01b-6bb76c217def',
      principal: {
        tenantId: 'f33ad60b-060f-47a1-a0af-64ed98a6f0d0',
        user: { id: '8159f25c-e14e-4c45-8f77-6aa4c66c80fa' },
      },
    })

    await writeAuditEvent({
      action: 'finance.entry.read',
      result: 'success',
      entityType: 'financial_entry',
      entityId: 'entry-a',
    })

    expect(mocks.withTenantTransaction).toHaveBeenCalledWith(
      'f33ad60b-060f-47a1-a0af-64ed98a6f0d0',
      expect.any(Function),
    )
    expect(mocks.clientQuery).toHaveBeenCalledOnce()
    expect(mocks.queryDatabase).not.toHaveBeenCalled()
  })

  it('keeps anonymous platform security events insertable without tenant read scope', async () => {
    mocks.getRequestContext.mockReturnValue(null)

    await writeAuditEvent({
      action: 'security.rate_limit',
      result: 'denied',
      metadata: { identity: 'anonymous' },
    })

    expect(mocks.queryDatabase).toHaveBeenCalledOnce()
    expect(mocks.withTenantTransaction).not.toHaveBeenCalled()
  })
})

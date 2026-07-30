import { describe, expect, it } from 'vitest'

import { auditLogQuerySchema } from '@/lib/server/audit-query-service'

describe('audit log query schema', () => {
  it('applies bounded pagination defaults', () => {
    expect(auditLogQuerySchema.parse({})).toMatchObject({
      limit: 200,
      offset: 0,
    })
    expect(auditLogQuerySchema.safeParse({ limit: 501 }).success).toBe(false)
    expect(auditLogQuerySchema.safeParse({ offset: 100_001 }).success).toBe(false)
  })

  it('normalizes optional text filters and validates known results', () => {
    expect(auditLogQuerySchema.parse({
      action: '  finance.invoice ',
      entityType: ' invoice ',
      result: 'success',
    })).toMatchObject({
      action: 'finance.invoice',
      entityType: 'invoice',
      result: 'success',
    })
    expect(auditLogQuerySchema.safeParse({ result: 'unknown' }).success).toBe(false)
  })

  it('rejects inverted periods, invalid actors and unknown parameters', () => {
    expect(auditLogQuerySchema.safeParse({
      from: '2026-07-24T00:00:00.000Z',
      to: '2026-07-23T00:00:00.000Z',
    }).success).toBe(false)
    expect(auditLogQuerySchema.safeParse({ actorUserId: 'not-a-uuid' }).success).toBe(false)
    expect(auditLogQuerySchema.safeParse({ tenantId: 'client-controlled' }).success).toBe(false)
  })
})

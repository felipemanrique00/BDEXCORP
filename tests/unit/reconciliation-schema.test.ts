import { describe, expect, it } from 'vitest'

import {
  reconciliationListQuerySchema,
  reconciliationResolutionSchema,
  reconciliationRunSchema,
} from '@/lib/reconciliation/schema'

describe('relational reconciliation schemas', () => {
  it('uses bounded list defaults and rejects client-controlled tenant scope', () => {
    expect(reconciliationListQuerySchema.parse({})).toMatchObject({
      status: 'open',
      limit: 200,
      offset: 0,
    })
    expect(reconciliationListQuerySchema.safeParse({ limit: 501 }).success).toBe(false)
    expect(reconciliationListQuerySchema.safeParse({ tenantId: 'tenant-from-browser' }).success).toBe(false)
  })

  it('allows only a selected company as optional run scope', () => {
    expect(reconciliationRunSchema.parse({ companyId: 'company-a' })).toEqual({
      companyId: 'company-a',
    })
    expect(reconciliationRunSchema.safeParse({ companyIds: ['company-a'] }).success).toBe(false)
  })

  it('requires confirmation, a version and evidence for employee links', () => {
    const base = {
      resolutionKind: 'manual',
      note: 'Revisado pelo financeiro.',
      expectedVersion: 2,
      confirmed: true,
    } as const
    expect(reconciliationResolutionSchema.safeParse(base).success).toBe(true)
    expect(reconciliationResolutionSchema.safeParse({
      ...base,
      confirmed: false,
    }).success).toBe(false)
    expect(reconciliationResolutionSchema.safeParse({
      ...base,
      resolutionKind: 'employee_linked',
    }).success).toBe(false)
    expect(reconciliationResolutionSchema.safeParse({
      ...base,
      resolutionKind: 'employee_linked',
      employeeId: 'employee-a',
    }).success).toBe(true)
    expect(reconciliationResolutionSchema.safeParse({
      ...base,
      employeeId: 'employee-a',
    }).success).toBe(false)
  })
})

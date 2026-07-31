import { describe, expect, it } from 'vitest'

import {
  createCostCenterPlanSchema,
  createCostCenterSchema,
  updateCostCenterSchema,
} from '@/lib/cost-centers/schema'

const planId = '00000000-0000-4000-8000-000000000010'

describe('cost center schemas', () => {
  it('accepts a center available to the whole plan', () => {
    const result = createCostCenterSchema.parse({
      planId,
      code: 'ADM-001',
      name: 'Administrativo corporativo',
      scopeType: 'plan',
      companyIds: [],
    })

    expect(result).toMatchObject({
      planId,
      code: 'ADM-001',
      scopeType: 'plan',
      companyIds: [],
      isActive: true,
    })
  })

  it('requires at least one unique company for a restricted center', () => {
    expect(createCostCenterSchema.safeParse({
      planId,
      code: 'PROJ-SP',
      name: 'Projeto Sao Paulo',
      scopeType: 'selected_companies',
      companyIds: [],
    }).success).toBe(false)

    expect(createCostCenterSchema.safeParse({
      planId,
      code: 'PROJ-SP',
      name: 'Projeto Sao Paulo',
      scopeType: 'selected_companies',
      companyIds: ['company-a', 'company-a'],
    }).success).toBe(false)
  })

  it('validates ownership rules for shared and exclusive plans', () => {
    expect(createCostCenterPlanSchema.safeParse({
      code: 'GRUPO',
      name: 'Plano do grupo',
      planType: 'group_shared',
      businessGroupId: 'group-a',
      companyIds: ['company-a', 'company-b'],
    }).success).toBe(true)

    expect(createCostCenterPlanSchema.safeParse({
      code: 'EXCLUSIVO',
      name: 'Plano alternativo',
      planType: 'company_exclusive',
      ownerCompanyId: 'company-a',
      companyIds: ['company-b'],
    }).success).toBe(false)
  })

  it('requires optimistic concurrency and at least one change', () => {
    expect(updateCostCenterSchema.safeParse({ expectedVersion: 2 }).success).toBe(false)
    expect(updateCostCenterSchema.safeParse({
      expectedVersion: 2,
      name: 'Novo nome',
    }).success).toBe(true)
  })
})

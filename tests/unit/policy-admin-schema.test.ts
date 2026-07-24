import { describe, expect, it } from 'vitest'

import {
  policyDraftInputSchema,
  policyTemplateInstantiationSchema,
  policyVersionInputSchema,
} from '@/lib/policy/admin-schema'

const validDraft = {
  policyCode: 'airfare.advance-purchase',
  name: 'Compra antecipada de aereo',
  description: 'Controla a antecedencia minima para emissao de bilhetes aereos.',
  category: 'aereo',
  priority: 100,
  severity: 'blocking' as const,
  inheritanceMode: 'inherit' as const,
  overridable: false,
  businessJustification: 'Reduz custos e protege o planejamento orcamentario.',
  changeSummary: 'Criacao inicial da politica.',
  tags: ['aereo', 'antecedencia'],
  timezone: 'America/Sao_Paulo',
  validFrom: '2026-07-22T12:00:00-03:00',
  validUntil: '2027-07-22T12:00:00-03:00',
  scopes: [{ type: 'tenant' as const, mode: 'include' as const, specificity: 0 }],
  condition: { operator: 'gte' as const, fact: 'trip.advance_days', value: 14 },
  actions: [{ type: 'allow' as const, message: 'Solicitacao dentro da politica corporativa.' }],
  exceptions: [],
  dependencies: [],
}

describe('policy admin schemas', () => {
  it('accepts the same validated configuration for drafts and new versions', () => {
    expect(policyDraftInputSchema.parse(validDraft).policyCode).toBe(validDraft.policyCode)

    const { policyCode: _policyCode, ...configuration } = validDraft
    expect(policyVersionInputSchema.parse({ ...configuration, expectedCurrentVersion: 1 }).expectedCurrentVersion).toBe(1)
  })

  it('rejects invalid validity windows for drafts and versions', () => {
    const invalid = { ...validDraft, validUntil: validDraft.validFrom }
    expect(policyDraftInputSchema.safeParse(invalid).success).toBe(false)

    const { policyCode: _policyCode, ...configuration } = invalid
    expect(policyVersionInputSchema.safeParse({ ...configuration, expectedCurrentVersion: 1 }).success).toBe(false)
  })

  it('rejects excessive expression depth instead of accepting unsafe input', () => {
    let condition: unknown = { operator: 'eq', fact: 'trip.type', value: 'air' }
    for (let index = 0; index < 20; index += 1) {
      condition = { operator: 'not', condition }
    }

    expect(policyDraftInputSchema.safeParse({ ...validDraft, condition }).success).toBe(false)
  })

  it('accepts a template instantiation scoped to one company', () => {
    const parsed = policyTemplateInstantiationSchema.parse({
      scope: {
        type: 'company',
        id: '9a641665-39f8-476d-b4cb-1cb1431ff68e',
        specificity: 30,
      },
      validFrom: '2026-07-22T12:00:00-03:00',
      validUntil: '2027-07-22T12:00:00-03:00',
      priority: 140,
      tags: ['piloto', 'empresa'],
    })

    expect(parsed.scope).toEqual({
      type: 'company',
      id: '9a641665-39f8-476d-b4cb-1cb1431ff68e',
      mode: 'include',
      specificity: 30,
    })
    expect(parsed.priority).toBe(140)
  })

  it('rejects inconsistent template scopes and validity windows', () => {
    expect(policyTemplateInstantiationSchema.safeParse({
      scope: { type: 'tenant', id: '9a641665-39f8-476d-b4cb-1cb1431ff68e', specificity: 0 },
    }).success).toBe(false)

    expect(policyTemplateInstantiationSchema.safeParse({
      scope: { type: 'company', specificity: 30 },
    }).success).toBe(false)

    expect(policyTemplateInstantiationSchema.safeParse({
      scope: { type: 'tenant', specificity: 0 },
      validFrom: '2027-07-22T12:00:00-03:00',
      validUntil: '2026-07-22T12:00:00-03:00',
    }).success).toBe(false)
  })
})

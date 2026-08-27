import { describe, expect, it } from 'vitest'

import {
  policyResultRequiresSecondLevel,
  policyResultsRequireSecondLevel,
} from '@/lib/approvals/policy-routing'

describe('approval policy routing', () => {
  const matrix = item('matrix.trigger.cost.company.abc', 'request_approval')

  it('keeps a matrix-only request at level one', () => {
    expect(policyResultRequiresSecondLevel(result({ approvalsRequired: [matrix] }))).toBe(false)
  })

  it('routes matrix requests with a travel-policy warning to level two', () => {
    expect(policyResultRequiresSecondLevel(result({
      approvalsRequired: [matrix],
      warnings: [item('air.class.exception', 'warn')],
    }))).toBe(true)
  })

  it('aggregates a matrix trigger and a warning persisted in separate evaluations', () => {
    expect(policyResultsRequireSecondLevel([
      result({ warnings: [item('profile.air.class.exception', 'warn')] }),
      result({ approvalsRequired: [matrix] }),
    ])).toBe(true)
  })

  it('routes satisfied justification and document requirements to level two', () => {
    expect(policyResultRequiresSecondLevel(result({
      approvalsRequired: [matrix],
      justificationsRequired: [item('fare.justification', 'require_justification')],
    }))).toBe(true)
    expect(policyResultRequiresSecondLevel(result({
      approvalsRequired: [matrix],
      requiredDocuments: [item('documents.passport', 'require_document')],
    }))).toBe(true)
  })

  it('does not turn blocks or evaluation errors into a second-level override', () => {
    expect(policyResultRequiresSecondLevel(result({
      approvalsRequired: [matrix],
      blocks: [item('security.block', 'block')],
    }))).toBe(false)
    expect(policyResultRequiresSecondLevel(result({
      approvalsRequired: [matrix],
      requiredActions: [{ ...item('broken.fact', 'require_manual_review'), configuration: { error: 'missing fact' } }],
    }))).toBe(false)
    expect(policyResultsRequireSecondLevel([
      result({ approvalsRequired: [matrix] }),
      result({ blocks: [item('security.block', 'block')] }),
    ])).toBe(false)
  })

  it('does not change a legacy warning-only workflow', () => {
    expect(policyResultRequiresSecondLevel(result({
      warnings: [item('legacy.warning', 'warn')],
    }))).toBe(false)
  })

  it('treats a non-matrix approval or explicit level modifier as level two', () => {
    expect(policyResultRequiresSecondLevel(result({
      approvalsRequired: [matrix, item('fare.exception', 'request_approval')],
    }))).toBe(true)
    expect(policyResultRequiresSecondLevel(result({
      approvalsRequired: [item('legacy.level', 'add_approval_level')],
    }))).toBe(true)
  })
})

function result(overrides: Record<string, unknown> = {}) {
  return {
    approvalsRequired: [],
    warnings: [],
    justificationsRequired: [],
    requiredDocuments: [],
    requiredActions: [],
    blocks: [],
    ...overrides,
  }
}

function item(policyCode: string, action: string) {
  return { policyCode, action, configuration: {} }
}

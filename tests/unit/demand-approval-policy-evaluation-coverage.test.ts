import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { policyResultRequiresSecondLevel } from '@/lib/approvals/policy-routing'
import { demandApprovalPolicyEvaluationIds } from '@/lib/demands/approval-policy-evaluation-ids'

const demandServiceSource = readFileSync(
  resolve(process.cwd(), 'lib/server/demand-service.ts'),
  'utf8',
)

describe('demand approval policy evaluation coverage', () => {
  it('keeps T1 matrix-only and T2 warning evaluations in the approval subject so N2 is derived', () => {
    const matrixTrigger = {
      policyCode: 'matrix.trigger.merit.company.company-1',
      action: 'request_approval',
      configuration: {},
    }
    const persistedResults = new Map<string, unknown>([
      ['evaluation-t1', result({ approvalsRequired: [matrixTrigger] })],
      ['evaluation-t2', result({
        approvalsRequired: [matrixTrigger],
        warnings: [{
          policyCode: 'air.class.exception',
          action: 'warn',
          configuration: {},
        }],
      })],
    ])
    const policyEvaluationIds = demandApprovalPolicyEvaluationIds([
      { databaseEvaluationId: 'evaluation-t1' },
      { databaseEvaluationId: 'evaluation-t1' },
      { databaseEvaluationId: 'evaluation-t2' },
    ])

    expect(policyEvaluationIds).toEqual(['evaluation-t1', 'evaluation-t2'])
    expect(policyResultRequiresSecondLevel(persistedResults.get('evaluation-t1'))).toBe(false)
    expect(policyEvaluationIds.some((id) => (
      policyResultRequiresSecondLevel(persistedResults.get(id))
    ))).toBe(true)
  })

  it('deduplicates persisted IDs and caps the approval subject at 100 evaluations', () => {
    const references = Array.from({ length: 105 }, (_, index) => ({
      databaseEvaluationId: `evaluation-${index}`,
    }))

    expect(demandApprovalPolicyEvaluationIds([
      { databaseEvaluationId: ' evaluation-0 ' },
      ...references,
      { databaseEvaluationId: '' },
      { databaseEvaluationId: null },
    ])).toEqual(Array.from({ length: 100 }, (_, index) => `evaluation-${index + 5}`))
  })

  it('retains an early policy warning and submission matrix witnesses across 300 evaluations', () => {
    const evaluations = [
      {
        databaseEvaluationId: 'profile-t1-warning',
        result: result({ warnings: [{ policyCode: 'air.class.exception', action: 'warn' }] }),
      },
      ...Array.from({ length: 199 }, (_, index) => ({
        databaseEvaluationId: `profile-noise-${index}`,
        result: result(),
      })),
      ...Array.from({ length: 100 }, (_, index) => ({
        databaseEvaluationId: `submission-matrix-${index}`,
        result: result({
          approvalsRequired: [{
            policyCode: 'matrix.trigger.merit.company.company-1',
            action: 'request_approval',
            configuration: {},
          }],
        }),
      })),
    ]

    const ids = demandApprovalPolicyEvaluationIds(evaluations)
    expect(ids).toHaveLength(100)
    expect(ids).toContain('profile-t1-warning')
    expect(ids.filter((id) => id.startsWith('submission-matrix-'))).toHaveLength(99)
  })

  it('retains an early explicit N2 modifier before a tail of warning-only evaluations', () => {
    const ids = demandApprovalPolicyEvaluationIds([
      {
        databaseEvaluationId: 'profile-explicit-n2',
        result: result({
          approvalsRequired: [{
            policyCode: 'profile.executive.second-level',
            action: 'add_approval_level',
            configuration: { requiredLevel: 2 },
          }],
        }),
      },
      ...Array.from({ length: 100 }, (_, index) => ({
        databaseEvaluationId: `warning-only-${index}`,
        result: result({
          warnings: [{ policyCode: `warning.${index}`, action: 'warn', configuration: {} }],
        }),
      })),
    ])

    expect(ids).toHaveLength(100)
    expect(ids).toContain('profile-explicit-n2')
    expect(ids).not.toContain('warning-only-0')
  })

  it('wires complete evaluation coverage into creation, update and replay/reapproval paths', () => {
    expect(demandServiceSource.match(
      /const policyEvaluationIds = demandApprovalPolicyEvaluationIds\(fullResults\)/g,
    )).toHaveLength(2)
    expect(demandServiceSource.match(/policyEvaluationIds,/g)?.length).toBeGreaterThanOrEqual(2)
    expect(demandServiceSource.match(
      /demandApprovalSubjectWithPolicyEvaluationIds\(/g,
    )).toHaveLength(4)
    expect(demandServiceSource).toContain('preparation.policy.checkpoints')
    expect(demandServiceSource).toContain('current.last_policy_evaluation_id')
    expect(demandServiceSource).toContain('row.last_policy_evaluation_id')
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

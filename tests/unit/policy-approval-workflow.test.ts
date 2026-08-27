import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { PolicyEvaluationResult, PolicyResultItem } from '@/lib/policy'
import {
  resolvePolicyApprovalWorkflowCode,
  workflowSelectingItems,
} from '@/lib/server/policy-approval-workflow'

describe('policy approval workflow resolution', () => {
  it('keeps the matrix workflow when a second-level modifier has a legacy dependency', async () => {
    const matrix = item({
      action: 'request_approval',
      policyCode: 'matrix.trigger.cost.company.abc',
      policyVersionId: '00000000-0000-0000-0000-000000000001',
      workflow: 'matrix.cost.company.abc',
    })
    const modifier = item({
      action: 'add_approval_level',
      policyCode: 'fare.exception',
      policyVersionId: '00000000-0000-0000-0000-000000000002',
    })
    const query = vi.fn(async (_sql: string, values: unknown[]) => {
      expect(values[1]).toEqual([matrix.policyVersionId])
      return { rows: [{ dependency_key: 'matrix.cost.company.abc' }] }
    })

    const result = await resolvePolicyApprovalWorkflowCode(
      { query } as unknown as PoolClient,
      'tenant-1',
      evaluation([matrix, modifier]),
    )

    expect(result).toBe('matrix.cost.company.abc')
    expect(query).toHaveBeenCalledOnce()
  })

  it('fails closed when two primary routing actions select different workflows', async () => {
    const result = await resolvePolicyApprovalWorkflowCode(
      { query: vi.fn(async () => ({ rows: [] })) } as unknown as PoolClient,
      'tenant-1',
      evaluation([
        item({ action: 'request_approval', policyCode: 'base.one', workflow: 'workflow.one' }),
        item({ action: 'route_to_cost_approval', policyCode: 'base.two', workflow: 'workflow.two' }),
      ]),
    )

    expect(result).toBeNull()
  })

  it('preserves the controlled legacy fallback for a modifier-only policy', async () => {
    const modifier = item({
      action: 'add_approval_level',
      policyCode: 'legacy.level',
      policyVersionId: '00000000-0000-0000-0000-000000000003',
    })
    const result = await resolvePolicyApprovalWorkflowCode(
      {
        query: vi.fn(async () => ({ rows: [{ dependency_key: 'legacy.workflow' }] })),
      } as unknown as PoolClient,
      'tenant-1',
      evaluation([modifier]),
    )

    expect(result).toBe('legacy.workflow')
    expect(workflowSelectingItems([modifier])).toEqual([modifier])
  })

  it('ignores modifier workflow configuration when a normal primary action exists', async () => {
    const primary = item({ action: 'request_approval', policyCode: 'approval.base', workflow: 'approval.base.workflow' })
    const modifier = item({ action: 'require_sequential_approval', policyCode: 'legacy.sequence', workflow: 'legacy.sequence.workflow' })
    const result = await resolvePolicyApprovalWorkflowCode(
      { query: vi.fn(async () => ({ rows: [] })) } as unknown as PoolClient,
      'tenant-1',
      evaluation([primary, modifier]),
    )

    expect(result).toBe('approval.base.workflow')
  })
})

function item(input: {
  action: PolicyResultItem['action']
  policyCode: string
  policyVersionId?: string
  workflow?: string
}): PolicyResultItem {
  return {
    policyId: `policy-${input.policyCode}`,
    policyVersionId: input.policyVersionId || '00000000-0000-0000-0000-000000000099',
    policyCode: input.policyCode,
    action: input.action,
    message: 'Approval required',
    configuration: input.workflow ? { workflow: input.workflow } : {},
  }
}

function evaluation(approvalsRequired: PolicyResultItem[]): PolicyEvaluationResult {
  return {
    passed: true,
    errors: [],
    warnings: [],
    justificationsRequired: [],
    approvalsRequired,
    blocks: [],
    requiredDocuments: [],
    requiredActions: [],
    applicablePolicies: approvalsRequired.map((approval) => approval.policyId),
    policyVersions: approvalsRequired.map((approval) => approval.policyVersionId),
    alternatives: [],
    remediation: [],
    evaluationId: 'evaluation-1',
    factsHash: 'facts',
    resultHash: 'result',
    evaluatedAt: new Date(0).toISOString(),
    checkpoint: 'selection',
    mode: 'enforce',
    decisions: [],
  }
}

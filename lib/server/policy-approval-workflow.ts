import 'server-only'

import type { PoolClient } from 'pg'

import type { PolicyEvaluationResult, PolicyResultItem } from '@/lib/policy'

const WORKFLOW_SELECTING_ACTIONS = new Set<PolicyResultItem['action']>([
  'request_approval',
  'route_to_merit_approval',
  'route_to_cost_approval',
])

/**
 * Resolves the single workflow selected by a policy evaluation.
 *
 * Approval-level modifiers (for example add_approval_level) may carry legacy
 * workflow dependencies of their own. Once a primary routing action exists,
 * those modifiers must not replace or make the primary workflow ambiguous.
 * Matrix trigger policies take precedence when they coexist with older
 * routing policies, because the matrix owns the stable L1/L2 graph.
 */
export async function resolvePolicyApprovalWorkflowCode(
  client: PoolClient,
  tenantId: string,
  results: PolicyEvaluationResult | readonly PolicyEvaluationResult[],
): Promise<string | null> {
  const evaluations = Array.isArray(results) ? results : [results]
  const approvalItems = evaluations.flatMap((result) => result.approvalsRequired)
  const selectedItems = workflowSelectingItems(approvalItems)
  if (!selectedItems.length) return null

  const configured = selectedItems.flatMap((item) => {
    const workflow = item.configuration.workflow
    return typeof workflow === 'string' && workflow.trim() ? [workflow.trim()] : []
  })
  const versionIds = Array.from(new Set(selectedItems.map((item) => item.policyVersionId)))
  const dependencies = versionIds.length
    ? await client.query<{ dependency_key: string }>(
        `select distinct dependency_key
         from policy_dependencies
         where tenant_id = $1 and policy_version_id = any($2::uuid[])
           and dependency_type = 'workflow' and required = true`,
        [tenantId, versionIds],
      )
    : { rows: [] as Array<{ dependency_key: string }> }
  const candidates = Array.from(new Set([
    ...configured,
    ...dependencies.rows.map((row) => row.dependency_key.trim()).filter(Boolean),
  ]))
  return candidates.length === 1 ? candidates[0] : null
}

export function workflowSelectingItems(items: readonly PolicyResultItem[]): PolicyResultItem[] {
  const primary = items.filter((item) => WORKFLOW_SELECTING_ACTIONS.has(item.action))
  const matrixPrimary = primary.filter((item) => item.policyCode.startsWith('matrix.trigger.'))
  if (matrixPrimary.length) return matrixPrimary
  if (primary.length) return primary
  // Backwards compatibility for old policies that only emitted a modifier and
  // used its dependency to select the workflow.
  return [...items]
}

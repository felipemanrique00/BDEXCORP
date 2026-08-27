/**
 * Derives conditional L2 routing exclusively from persisted policy results.
 * Legacy workflows keep their previous behaviour; automatic policy-violation
 * escalation is enabled only when the canonical matrix trigger is present.
 */
export function policyResultRequiresSecondLevel(value: unknown): boolean {
  return policyResultsRequireSecondLevel([value])
}

/**
 * Policy evaluations are persisted per checkpoint/profile and the canonical
 * matrix trigger does not necessarily live in the same row as a travel-policy
 * warning. Aggregate the complete trusted evaluation set before deciding L2.
 */
export function policyResultsRequireSecondLevel(values: readonly unknown[]): boolean {
  const results = values.map(record)
  const approvals = results.flatMap((result) => records(result.approvalsRequired))
  const explicitSecondLevel = approvals.some((approval) => {
    const configuration = record(approval.configuration)
    const requiredLevel = Number(configuration.requiredLevel || configuration.approvalLevel || 0)
    return requiredLevel >= 2 || approval.action === 'add_approval_level'
  })
  if (explicitSecondLevel) return true

  const policyItems = results.flatMap((result) => [
    ...records(result.approvalsRequired),
    ...records(result.warnings),
    ...records(result.justificationsRequired),
    ...records(result.requiredDocuments),
    ...records(result.requiredActions),
  ])
  if (!policyItems.some((item) => (
    isMatrixTriggerItem(item) && !record(item.configuration).error
  ))) return false
  return policyItems.some((item) => (
    !isMatrixTriggerItem(item) && !record(item.configuration).error
  ))
}

function isMatrixTriggerItem(item: Record<string, unknown>): boolean {
  return typeof item.policyCode === 'string' && item.policyCode.startsWith('matrix.trigger.')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : []
}

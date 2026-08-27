const MAX_APPROVAL_POLICY_EVALUATION_IDS = 100

export interface DemandPolicyEvaluationReference {
  databaseEvaluationId: unknown
  result?: unknown
  retainForApprovalRouting?: boolean
}

/**
 * Keeps the approval subject bound to every persisted policy evaluation that
 * contributed to the demand decision, rather than only the primary traveler.
 */
export function demandApprovalPolicyEvaluationIds(
  evaluations: readonly DemandPolicyEvaluationReference[],
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const byId = new Map<string, DemandPolicyEvaluationReference>()

  for (const evaluation of evaluations) {
    if (typeof evaluation.databaseEvaluationId !== 'string') continue
    const id = evaluation.databaseEvaluationId.trim()
    if (!id) continue
    const existing = byId.get(id)
    byId.set(id, {
      ...existing,
      ...evaluation,
      databaseEvaluationId: id,
      result: evaluation.result ?? existing?.result,
      retainForApprovalRouting: Boolean(
        existing?.retainForApprovalRouting || evaluation.retainForApprovalRouting,
      ),
    })
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }

  if (ids.length <= MAX_APPROVAL_POLICY_EVALUATION_IDS) return ids

  const selected = new Set<string>()
  const recentIds = [...ids].reverse()
  const add = (id: string) => {
    if (selected.size < MAX_APPROVAL_POLICY_EVALUATION_IDS) selected.add(id)
  }

  // Explicit level modifiers can require N2 even without a matrix trigger, so
  // one must survive before generic warnings consume the bounded collection.
  const latestExplicitLevelId = recentIds.find((id) => hasExplicitSecondLevel(byId.get(id)))
  if (latestExplicitLevelId) add(latestExplicitLevelId)

  // One persisted matrix trigger is necessary to identify matrix routing at
  // collection level, even when the policy exception happened much earlier.
  const latestMatrixTriggerId = recentIds.find((id) => hasMatrixTrigger(byId.get(id)))
  if (latestMatrixTriggerId) add(latestMatrixTriggerId)

  // Preserve semantic witnesses before filling with recent evaluations.
  for (const id of recentIds) {
    if (hasSecondLevelSignal(byId.get(id))) add(id)
  }
  // Explicitly retained IDs come from a previously normalized approval
  // subject. This keeps replay/reapproval stable even without raw results.
  for (const id of recentIds) {
    if (byId.get(id)?.retainForApprovalRouting) add(id)
  }
  for (const id of recentIds) {
    if (hasMatrixTrigger(byId.get(id))) add(id)
  }
  for (const id of recentIds) add(id)

  // Preserve the deterministic checkpoint/traveler order in the subject.
  return ids.filter((id) => selected.has(id))
}

function hasMatrixTrigger(reference: DemandPolicyEvaluationReference | undefined): boolean {
  return approvalItems(reference).some((item) => policyCode(item).startsWith('matrix.trigger.'))
}

function hasSecondLevelSignal(reference: DemandPolicyEvaluationReference | undefined): boolean {
  const result = resultRecord(reference)
  const approvals = approvalItems(reference)
  if (hasExplicitSecondLevel(reference)) return true
  if (approvals.some((approval) => !policyCode(approval).startsWith('matrix.trigger.'))) return true

  return ['warnings', 'justificationsRequired', 'requiredDocuments', 'requiredActions'].some((field) => (
    records(result[field]).some((item) => (
      !policyCode(item).startsWith('matrix.trigger.') && !record(item.configuration).error
    ))
  ))
}

function hasExplicitSecondLevel(reference: DemandPolicyEvaluationReference | undefined): boolean {
  return approvalItems(reference).some((approval) => {
    const configuration = record(approval.configuration)
    const requiredLevel = Number(configuration.requiredLevel || configuration.approvalLevel || 0)
    return requiredLevel >= 2 || approval.action === 'add_approval_level'
  })
}

function approvalItems(reference: DemandPolicyEvaluationReference | undefined): Array<Record<string, unknown>> {
  const result = resultRecord(reference)
  return records(result.approvalsRequired).length
    ? records(result.approvalsRequired)
    : records(result.approvals)
}

function resultRecord(reference: DemandPolicyEvaluationReference | undefined): Record<string, unknown> {
  return record(reference?.result || reference)
}

function policyCode(item: Record<string, unknown>): string {
  return typeof item.policyCode === 'string'
    ? item.policyCode
    : typeof item.code === 'string' ? item.code : ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : []
}

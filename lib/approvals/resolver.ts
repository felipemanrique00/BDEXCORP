import { ApprovalWorkflowError } from '@/lib/approvals/graph'
import type {
  ApprovalCandidate,
  ApprovalKind,
  ApprovalSubject,
  ApproverResolutionResult,
  ApproverResolutionSpec,
  ApproverSelector,
  ResolvedApprover,
} from '@/lib/approvals/types'

export function resolveApprovers(
  kind: ApprovalKind,
  spec: ApproverResolutionSpec,
  subject: ApprovalSubject,
  candidates: readonly ApprovalCandidate[],
): ApproverResolutionResult {
  const eligible = candidates.filter((candidate) => baseEligible(candidate, kind, subject, spec))
  const primary = resolveByCombination(spec.selectors, spec.combination, eligible, subject)
  let selected = primary
  let usedFallback = false

  if (selected.length < spec.minimumApprovers && spec.fallbackSelectors?.length) {
    const fallback = resolveByCombination(spec.fallbackSelectors, 'first_non_empty', eligible, subject)
    selected = uniqueCandidates([...selected, ...fallback])
    usedFallback = fallback.length > 0
  }
  if (spec.maximumApprovers) selected = selected.slice(0, spec.maximumApprovers)
  if (selected.length < spec.minimumApprovers) {
    throw new ApprovalWorkflowError(
      'NO_APPROVER_AVAILABLE',
      `Foram encontrados ${selected.length} aprovador(es), mas o fluxo exige ${spec.minimumApprovers}.`,
      422,
    )
  }

  const source = usedFallback ? 'fallback' : 'primary'
  const selectors = usedFallback && spec.fallbackSelectors?.length ? spec.fallbackSelectors : spec.selectors
  const approvers: ResolvedApprover[] = selected.map((candidate) => {
    const matchedSelectors = selectors.filter((selector) => matchesSelector(candidate, selector, subject)).map((selector) => selector.type)
    return {
      userId: candidate.userId,
      membershipId: candidate.membershipId,
      source,
      matchedSelectors,
      explanation: `Aprovador resolvido por ${matchedSelectors.join(', ') || 'fallback autorizado'}.`,
    }
  })
  return {
    approvers,
    usedFallback,
    explanations: approvers.map((approver) => `${approver.userId}: ${approver.explanation}`),
  }
}

function baseEligible(
  candidate: ApprovalCandidate,
  kind: ApprovalKind,
  subject: ApprovalSubject,
  spec: ApproverResolutionSpec,
): boolean {
  if (!candidate.active || candidate.tenantId !== subject.tenantId || !candidate.approvalKinds.includes(kind)) return false
  if (!candidate.companyIds.includes(subject.companyId) && !(subject.groupId && candidate.groupIds.includes(subject.groupId))) return false
  const excluded = new Set<string>()
  if (!spec.allowSelfApproval && subject.requesterUserId) excluded.add(subject.requesterUserId)
  for (const rule of spec.separationOfDuties || []) {
    const userId = separationUserId(rule, subject)
    if (userId) excluded.add(userId)
  }
  return !excluded.has(candidate.userId)
}

function resolveByCombination(
  selectors: readonly ApproverSelector[],
  combination: ApproverResolutionSpec['combination'],
  candidates: readonly ApprovalCandidate[],
  subject: ApprovalSubject,
): ApprovalCandidate[] {
  if (combination === 'all') return candidates.filter((candidate) => selectors.every((selector) => matchesSelector(candidate, selector, subject)))
  if (combination === 'union') {
    return uniqueCandidates(selectors.flatMap((selector) => candidates.filter((candidate) => matchesSelector(candidate, selector, subject))))
  }
  for (const selector of selectors) {
    const matches = candidates.filter((candidate) => matchesSelector(candidate, selector, subject))
    if (matches.length) return matches
  }
  return []
}

function matchesSelector(candidate: ApprovalCandidate, selector: ApproverSelector, subject: ApprovalSubject): boolean {
  const values = stringValues(selector.value)
  switch (selector.type) {
    case 'person': return values.includes(candidate.userId)
    case 'role': return intersects(candidate.roleKeys, values)
    case 'job_title': return candidate.jobTitle ? values.includes(candidate.jobTitle) : false
    case 'level': return candidate.level ? values.includes(candidate.level) : false
    case 'group': return intersects(candidate.groupIds, values.length ? values : subject.groupId ? [subject.groupId] : [])
    case 'company': return intersects(candidate.companyIds, values.length ? values : [subject.companyId])
    case 'branch': return Boolean(subject.branchId && candidate.branchIds?.includes(subject.branchId))
    case 'cost_center': return Boolean(subject.costCenterId && candidate.costCenterIds?.includes(subject.costCenterId))
    case 'project': return Boolean(subject.projectId && candidate.projectIds?.includes(subject.projectId))
    case 'account': return Boolean(subject.accountId && candidate.accountIds?.includes(subject.accountId))
    case 'requester': return candidate.userId === subject.requesterUserId
    case 'traveler': return candidate.userId === subject.travelerUserId
    case 'manager': return candidate.userId === subject.managerUserId
    case 'authority': return withinAuthority(candidate, subject, selector)
    case 'amount': return withinAmount(candidate, subject)
    case 'currency': return Boolean(subject.currency && candidate.currencies?.includes(subject.currency.toUpperCase()))
    case 'product': return Boolean(subject.product && candidate.products?.includes(subject.product))
    case 'destination': return Boolean(subject.destination && candidate.destinations?.includes(subject.destination))
    case 'policy_violation': return intersects(candidate.policyViolationCodes || [], subject.policyViolationCodes || values)
    case 'budget': return Boolean(subject.budgetId && candidate.budgetIds?.includes(subject.budgetId))
    case 'risk': return Boolean(subject.riskLevel && candidate.riskLevels?.includes(subject.riskLevel))
  }
}

function withinAmount(candidate: ApprovalCandidate, subject: ApprovalSubject): boolean {
  if (subject.amount === null || subject.amount === undefined || !Number.isFinite(subject.amount)) return false
  if (!candidate.authorityMatched) return false
  return candidate.maxAmount === null || candidate.maxAmount === undefined || candidate.maxAmount >= subject.amount
}

function withinAuthority(candidate: ApprovalCandidate, subject: ApprovalSubject, selector: ApproverSelector): boolean {
  if (!candidate.authorityMatched) return false
  if (subject.amount === null || subject.amount === undefined || !Number.isFinite(subject.amount)) return false
  if (candidate.maxAmount !== null && candidate.maxAmount !== undefined && candidate.maxAmount < subject.amount) return false
  const currency = String(selector.configuration?.currency || subject.currency || '').toUpperCase()
  if (!currency) return false
  if (candidate.currencies?.length && !candidate.currencies.includes(currency)) return false
  if (exceeds(candidate.accumulatedAmountLimit, subject.accumulatedAmount)) return false
  if (exceeds(candidate.maxPercentageAboveLowest, subject.percentageAboveLowest)) return false
  if (exceeds(candidate.maxPercentageAboveAverage, subject.percentageAboveAverage)) return false
  if (candidate.requiresBudgetAvailable && (
    subject.budgetAvailable === null
    || subject.budgetAvailable === undefined
    || subject.budgetAvailable < subject.amount
  )) return false
  if (subject.urgent === true && candidate.urgentAllowed !== true) return false
  if (candidate.products?.length && (!subject.product || !candidate.products.includes(subject.product))) return false
  if (candidate.destinations?.length && (!subject.destination || !candidate.destinations.includes(subject.destination))) return false
  if (candidate.riskLevels?.length && (!subject.riskLevel || !candidate.riskLevels.includes(subject.riskLevel))) return false
  return true
}

function exceeds(limit: number | null | undefined, observed: number | null | undefined): boolean {
  return limit !== null && limit !== undefined
    && (observed === null || observed === undefined || !Number.isFinite(observed) || observed > limit)
}

function separationUserId(
  rule: NonNullable<ApproverResolutionSpec['separationOfDuties']>[number],
  subject: ApprovalSubject,
): string | null | undefined {
  if (rule === 'requester') return subject.requesterUserId
  if (rule === 'traveler') return subject.travelerUserId
  if (rule === 'last_editor') return subject.lastEditorUserId
  return subject.financialExecutorUserId
}

function stringValues(value: ApproverSelector['value']): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value]
  return []
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const expected = new Set(right)
  return left.some((value) => expected.has(value))
}

function uniqueCandidates(candidates: readonly ApprovalCandidate[]): ApprovalCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.userId)) return false
    seen.add(candidate.userId)
    return true
  }).sort((left, right) => left.userId.localeCompare(right.userId))
}

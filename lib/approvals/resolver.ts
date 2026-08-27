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
  let requiresEscalation = false
  let selectedWithOverflow = false

  if (selected.length < spec.minimumApprovers && spec.selectors.some(selectorEscalatesOnLimit)) {
    const overflow = resolveByCombination(spec.selectors, spec.combination, eligible, subject, true)
    if (overflow.length >= spec.minimumApprovers) {
      selected = overflow
      requiresEscalation = true
      selectedWithOverflow = true
    }
  }

  if (selected.length < spec.minimumApprovers && spec.fallbackSelectors?.length) {
    const fallback = resolveByCombination(spec.fallbackSelectors, 'first_non_empty', eligible, subject)
    selected = [...selected, ...fallback]
    usedFallback = fallback.length > 0
  }
  const selectors = usedFallback && spec.fallbackSelectors?.length ? spec.fallbackSelectors : spec.selectors
  selected = rankedUniqueCandidates(selected, selectors, subject, selectedWithOverflow)
  if (spec.maximumApprovers === 1) assertUnambiguousSingleApprover(selected, selectors, subject, selectedWithOverflow)
  if (spec.maximumApprovers) selected = selected.slice(0, spec.maximumApprovers)
  if (selected.length < spec.minimumApprovers) {
    throw new ApprovalWorkflowError(
      'NO_APPROVER_AVAILABLE',
      `Foram encontrados ${selected.length} aprovador(es), mas o fluxo exige ${spec.minimumApprovers}.`,
      422,
    )
  }

  const source = usedFallback ? 'fallback' : 'primary'
  const approvers: ResolvedApprover[] = selected.map((candidate) => {
    const matchedSelectors = selectors
      .filter((selector) => selectedWithOverflow
        ? matchesSelectorWithAuthorityOverflow(candidate, selector, subject)
        : matchesSelector(candidate, selector, subject))
      .map((selector) => selector.type)
    return {
      userId: candidate.userId,
      membershipId: candidate.membershipId,
      source,
      matchedSelectors,
      explanation: `Aprovador resolvido por ${matchedSelectors.join(', ') || 'fallback autorizado'}${selectedWithOverflow ? '; limite da alcada exige segundo nivel' : ''}.`,
    }
  })
  return {
    approvers,
    usedFallback,
    requiresEscalation,
    escalationReasons: requiresEscalation ? ['authority_limit_exceeded'] : [],
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
  return !approverConflictsWithSubject(candidate.userId, subject, spec)
}

export function approverConflictsWithSubject(
  userId: string,
  subject: ApprovalSubject,
  spec: Pick<ApproverResolutionSpec, 'allowSelfApproval' | 'separationOfDuties'>,
): boolean {
  const excluded = new Set<string>()
  if (subject.assistedActorUserId) excluded.add(subject.assistedActorUserId)
  for (const conflictedUserId of subject.conflictedUserIds || []) excluded.add(conflictedUserId)
  if (!spec.allowSelfApproval && subject.requesterUserId) excluded.add(subject.requesterUserId)
  for (const rule of spec.separationOfDuties || []) {
    if (rule === 'prior_approver') {
      for (const priorApproverUserId of subject.priorApproverUserIds || []) excluded.add(priorApproverUserId)
      continue
    }
    const separatedUserId = separationUserId(rule, subject)
    if (separatedUserId) excluded.add(separatedUserId)
  }
  return excluded.has(userId)
}

function resolveByCombination(
  selectors: readonly ApproverSelector[],
  combination: ApproverResolutionSpec['combination'],
  candidates: readonly ApprovalCandidate[],
  subject: ApprovalSubject,
  allowAuthorityOverflow = false,
): ApprovalCandidate[] {
  const matcher = allowAuthorityOverflow ? matchesSelectorWithAuthorityOverflow : matchesSelector
  const candidatesFor = (selector: ApproverSelector) => mostSpecificAuthorityTier(candidates, selector, subject)
  if (combination === 'all') {
    return candidates.filter((candidate) => selectors.every((selector) => (
      candidatesFor(selector).includes(candidate) && matcher(candidate, selector, subject)
    )))
  }
  if (combination === 'union') {
    return selectors.flatMap((selector) => candidatesFor(selector).filter((candidate) => matcher(candidate, selector, subject)))
  }
  for (const selector of selectors) {
    const matches = candidatesFor(selector).filter((candidate) => matcher(candidate, selector, subject))
    if (matches.length) return matches
  }
  return []
}

function mostSpecificAuthorityTier(
  candidates: readonly ApprovalCandidate[],
  selector: ApproverSelector,
  subject: ApprovalSubject,
): readonly ApprovalCandidate[] {
  if (selector.type !== 'authority') return candidates
  const applicable = candidates.filter((candidate) => authorityDimensionsMatch(candidate, subject, selector))
  if (!applicable.length) return applicable
  const maximumSpecificity = Math.max(...applicable.map((candidate) => candidate.authoritySpecificity || 0))
  return applicable.filter((candidate) => (candidate.authoritySpecificity || 0) === maximumSpecificity)
}

function matchesSelectorWithAuthorityOverflow(
  candidate: ApprovalCandidate,
  selector: ApproverSelector,
  subject: ApprovalSubject,
): boolean {
  if (selector.type !== 'authority' || !selectorEscalatesOnLimit(selector)) {
    return matchesSelector(candidate, selector, subject)
  }
  return authorityLimitExceeded(candidate, subject, selector)
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
    case 'department': {
      const expected = values.length ? values : subject.department ? [subject.department] : []
      return normalizedIntersects(candidate.departments || [], expected)
    }
    case 'cost_center': return Boolean(subject.costCenterId && candidate.costCenterIds?.includes(subject.costCenterId))
    case 'project': return Boolean(subject.projectId && candidate.projectIds?.includes(subject.projectId))
    case 'account': return Boolean(subject.accountId && candidate.accountIds?.includes(subject.accountId))
    case 'requester': return candidate.userId === subject.requesterUserId
    case 'traveler': return candidate.userId === subject.travelerUserId
    case 'manager': return candidate.userId === subject.managerUserId
    case 'approver_group': return intersects(candidate.approverGroupIds || [], values)
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
  if (!authorityDimensionsMatch(candidate, subject, selector)) return false
  if (subject.amount === null || subject.amount === undefined || !Number.isFinite(subject.amount)) return false
  if (candidate.maxAmount !== null && candidate.maxAmount !== undefined && candidate.maxAmount < subject.amount) return false
  if (exceeds(candidate.accumulatedAmountLimit, subject.accumulatedAmount)) return false
  if (exceeds(candidate.maxPercentageAboveLowest, subject.percentageAboveLowest)) return false
  if (exceeds(candidate.maxPercentageAboveAverage, subject.percentageAboveAverage)) return false
  if (candidate.requiresBudgetAvailable && (
    subject.budgetAvailable === null
    || subject.budgetAvailable === undefined
    || subject.budgetAvailable < subject.amount
  )) return false
  if (subject.urgent === true && candidate.urgentAllowed !== true) return false
  return true
}

function authorityDimensionsMatch(candidate: ApprovalCandidate, subject: ApprovalSubject, selector: ApproverSelector): boolean {
  if (!candidate.authorityMatched) return false
  const configuredLevel = Number(selector.configuration?.level)
  if (Number.isFinite(configuredLevel) && configuredLevel > 0 && candidate.authorityLevel !== configuredLevel) return false
  const currency = String(selector.configuration?.currency || subject.currency || '').toUpperCase()
  if (!currency) return false
  if (candidate.currencies?.length && !candidate.currencies.includes(currency)) return false
  if (candidate.products?.length && (!subject.product || !candidate.products.includes(subject.product))) return false
  if (candidate.destinations?.length && (!subject.destination || !candidate.destinations.includes(subject.destination))) return false
  if (candidate.riskLevels?.length && (!subject.riskLevel || !candidate.riskLevels.includes(subject.riskLevel))) return false
  return true
}

function authorityLimitExceeded(candidate: ApprovalCandidate, subject: ApprovalSubject, selector: ApproverSelector): boolean {
  return authorityDimensionsMatch(candidate, subject, selector) && !withinAuthority(candidate, subject, selector)
}

function selectorEscalatesOnLimit(selector: ApproverSelector): boolean {
  return selector.type === 'authority' && selector.configuration?.onLimitExceeded === 'escalate'
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
  if (rule === 'prior_approver') return null
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

function normalizedIntersects(left: readonly string[], right: readonly string[]): boolean {
  const expected = new Set(right.map(normalizedScopeValue).filter(Boolean))
  return left.some((value) => expected.has(normalizedScopeValue(value)))
}

function normalizedScopeValue(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR')
}

function rankedUniqueCandidates(
  candidates: readonly ApprovalCandidate[],
  selectors: readonly ApproverSelector[],
  subject: ApprovalSubject,
  overflow: boolean,
): ApprovalCandidate[] {
  const seen = new Set<string>()
  return [...candidates].sort((left, right) => compareCandidateRank(left, right, selectors, subject, overflow)).filter((candidate) => {
    if (seen.has(candidate.userId)) return false
    seen.add(candidate.userId)
    return true
  })
}

function compareCandidateRank(
  left: ApprovalCandidate,
  right: ApprovalCandidate,
  selectors: readonly ApproverSelector[],
  subject: ApprovalSubject,
  overflow: boolean,
): number {
  const specificityDifference = candidateSpecificity(right, selectors, subject) - candidateSpecificity(left, selectors, subject)
  if (specificityDifference) return specificityDifference
  const leftCap = left.maxAmount === null || left.maxAmount === undefined ? Number.POSITIVE_INFINITY : left.maxAmount
  const rightCap = right.maxAmount === null || right.maxAmount === undefined ? Number.POSITIVE_INFINITY : right.maxAmount
  const capDifference = overflow ? rightCap - leftCap : leftCap - rightCap
  if (Number.isFinite(capDifference) && capDifference) return capDifference
  return left.userId.localeCompare(right.userId) || left.membershipId.localeCompare(right.membershipId)
}

function candidateSpecificity(
  candidate: ApprovalCandidate,
  selectors: readonly ApproverSelector[],
  subject: ApprovalSubject,
): number {
  const approverGroupSpecificity = selectors.some((selector) => (
    selector.type === 'approver_group' && matchesSelector(candidate, selector, subject)
  )) ? 1_000 : 0
  return approverGroupSpecificity + (candidate.authoritySpecificity || 0)
}

function assertUnambiguousSingleApprover(
  candidates: readonly ApprovalCandidate[],
  selectors: readonly ApproverSelector[],
  subject: ApprovalSubject,
  overflow: boolean,
): void {
  if (candidates.length < 2) return
  const left = candidates[0]
  const right = candidates[1]
  const sameSpecificity = candidateSpecificity(left, selectors, subject) === candidateSpecificity(right, selectors, subject)
  const leftCap = left.maxAmount === null || left.maxAmount === undefined ? Number.POSITIVE_INFINITY : left.maxAmount
  const rightCap = right.maxAmount === null || right.maxAmount === undefined ? Number.POSITIVE_INFINITY : right.maxAmount
  if (sameSpecificity && leftCap === rightCap) {
    throw new ApprovalWorkflowError(
      'AMBIGUOUS_APPROVER_RESOLUTION',
      `Mais de um aprovador possui a mesma prioridade para uma atribuicao unica${overflow ? ' em escalacao de alcada' : ''}.`,
      422,
    )
  }
}

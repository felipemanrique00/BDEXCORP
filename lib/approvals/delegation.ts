import { ApprovalWorkflowError } from '@/lib/approvals/graph'
import type {
  ApprovalDelegationCandidate,
  DelegationMembership,
} from '@/lib/approvals/types'

export function validateApprovalDelegation(
  draft: ApprovalDelegationCandidate,
  memberships: readonly DelegationMembership[],
  existing: readonly ApprovalDelegationCandidate[],
  now: string,
  maximumDelegates = 3,
  maximumChainDepth = 3,
): ApprovalDelegationCandidate {
  const nowValue = Date.parse(now)
  const from = Date.parse(draft.validFrom)
  const until = Date.parse(draft.validUntil)
  if (![nowValue, from, until].every(Number.isFinite)) throw invalid('INVALID_DELEGATION_DATE', 'Datas da delegacao invalidas.')
  if (from < nowValue) throw invalid('RETROACTIVE_DELEGATION', 'Delegacao retroativa nao e permitida.')
  if (until <= from) throw invalid('INVALID_DELEGATION_PERIOD', 'O fim da delegacao deve ser posterior ao inicio.')
  if (draft.delegatorMembershipId === draft.delegateMembershipId) throw invalid('SELF_DELEGATION', 'Autodelegacao nao e permitida.')
  if (!draft.justification.trim()) throw invalid('DELEGATION_JUSTIFICATION_REQUIRED', 'Justificativa da delegacao obrigatoria.')

  const delegator = memberships.find((item) => item.membershipId === draft.delegatorMembershipId)
  const delegate = memberships.find((item) => item.membershipId === draft.delegateMembershipId)
  if (!delegator || !delegate || delegator.tenantId !== draft.tenantId || delegate.tenantId !== draft.tenantId) {
    throw invalid('DELEGATION_TENANT_MISMATCH', 'Delegante e delegado devem pertencer ao mesmo tenant.')
  }
  if (!delegator.active || !delegate.active || !delegate.canReceiveDelegation) {
    throw invalid('INELIGIBLE_DELEGATION_MEMBER', 'Delegante ou delegado nao esta apto para a delegacao.')
  }
  if (delegator.platformAdmin) throw invalid('PLATFORM_ADMIN_DELEGATION_FORBIDDEN', 'Privilegios da plataforma nao podem ser delegados.')
  assertSubset(draft.companyIds, delegator.companyIds, 'DELEGATION_COMPANY_SCOPE_EXCEEDED', 'A delegacao inclui empresa fora do escopo do delegante.')
  assertSubset(draft.groupIds, delegator.groupIds, 'DELEGATION_GROUP_SCOPE_EXCEEDED', 'A delegacao inclui grupo fora do escopo do delegante.')
  assertSubset(draft.modules, delegator.delegableModules, 'DELEGATION_PRIVILEGE_ESCALATION', 'A delegacao inclui modulo que o delegante nao pode delegar.')

  const overlapping = existing.filter((item) => (
    item.tenantId === draft.tenantId
    && item.delegatorMembershipId === draft.delegatorMembershipId
    && ['active', 'scheduled', undefined].includes(item.status)
    && periodsOverlap(item.validFrom, item.validUntil, draft.validFrom, draft.validUntil)
  ))
  if (new Set(overlapping.map((item) => item.delegateMembershipId)).size >= maximumDelegates) {
    throw invalid('DELEGATE_LIMIT_EXCEEDED', `O limite de ${maximumDelegates} delegado(s) simultaneos foi atingido.`)
  }

  const activeEdges = existing
    .filter((item) => item.tenantId === draft.tenantId && ['active', 'scheduled', undefined].includes(item.status))
    .filter((item) => periodsOverlap(item.validFrom, item.validUntil, draft.validFrom, draft.validUntil))
    .map((item) => [item.delegatorMembershipId, item.delegateMembershipId] as const)
  activeEdges.push([draft.delegatorMembershipId, draft.delegateMembershipId])
  if (pathExists(activeEdges, draft.delegateMembershipId, draft.delegatorMembershipId)) {
    throw invalid('DELEGATION_CYCLE', 'A delegacao criaria um ciclo.')
  }
  if (longestPath(activeEdges, draft.delegatorMembershipId) > maximumChainDepth) {
    throw invalid('DELEGATION_CHAIN_TOO_DEEP', `A cadeia de delegacao excede ${maximumChainDepth} niveis.`)
  }

  return {
    ...draft,
    companyIds: unique(draft.companyIds),
    groupIds: unique(draft.groupIds),
    modules: unique(draft.modules),
    justification: draft.justification.trim(),
    status: from > nowValue ? 'scheduled' : 'active',
  }
}

function invalid(code: string, message: string): ApprovalWorkflowError {
  return new ApprovalWorkflowError(code, message, 400)
}

function assertSubset(values: string[], allowed: string[], code: string, message: string): void {
  const set = new Set(allowed)
  if (values.some((value) => !set.has(value))) throw invalid(code, message)
}

function periodsOverlap(leftFrom: string, leftUntil: string, rightFrom: string, rightUntil: string): boolean {
  return Date.parse(leftFrom) < Date.parse(rightUntil) && Date.parse(rightFrom) < Date.parse(leftUntil)
}

function pathExists(edges: ReadonlyArray<readonly [string, string]>, from: string, target: string): boolean {
  const queue = [from]
  const seen = new Set<string>()
  while (queue.length) {
    const current = queue.shift() as string
    if (current === target) return true
    if (seen.has(current)) continue
    seen.add(current)
    queue.push(...edges.filter(([source]) => source === current).map(([, destination]) => destination))
  }
  return false
}

function longestPath(edges: ReadonlyArray<readonly [string, string]>, from: string, seen = new Set<string>()): number {
  if (seen.has(from)) return Number.POSITIVE_INFINITY
  const next = edges.filter(([source]) => source === from).map(([, destination]) => destination)
  if (!next.length) return 0
  const branchSeen = new Set(seen).add(from)
  return 1 + Math.max(...next.map((destination) => longestPath(edges, destination, branchSeen)))
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

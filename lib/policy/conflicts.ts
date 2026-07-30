import { stableStringify } from '@/lib/policy/evaluator'
import type { ExecutablePolicyVersion, PolicyConflict } from '@/lib/policy/types'

const BLOCKING_ACTIONS = new Set(['block', 'prevent_issuance', 'block_supplier'])

export function analyzePolicyConflicts(
  policies: readonly ExecutablePolicyVersion[],
  availableDependencies: ReadonlySet<string> = new Set(),
): PolicyConflict[] {
  const conflicts: PolicyConflict[] = []

  for (const policy of policies) {
    if (!policy.scopes.length) conflicts.push(issue('missing_scope', 'blocking', [policy.versionId], 'Politica sem escopo aplicavel.'))
    if (!policy.actions.length) conflicts.push(issue('missing_action', 'blocking', [policy.versionId], 'Politica sem acao declarada.'))
    for (const dependency of policy.dependencies || []) {
      if (dependency.required && !availableDependencies.has(`${dependency.type}:${dependency.key}`)) {
        conflicts.push(issue(
          'missing_dependency',
          'blocking',
          [policy.versionId],
          `Dependencia obrigatoria ausente: ${dependency.type}:${dependency.key}.`,
        ))
      }
    }
  }

  for (let leftIndex = 0; leftIndex < policies.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < policies.length; rightIndex += 1) {
      const left = policies[leftIndex]
      const right = policies[rightIndex]
      if (left.contentHash === right.contentHash) {
        conflicts.push(issue('duplicate', 'warning', [left.versionId, right.versionId], 'As versoes possuem conteudo identico.'))
      }
      if (left.code === right.code && periodsOverlap(left, right)) {
        conflicts.push(issue(
          'overlapping_versions',
          'blocking',
          [left.versionId, right.versionId],
          'Versoes do mesmo codigo possuem vigencia sobreposta.',
        ))
      }
      if (
        left.category === right.category
        && left.priority === right.priority
        && checkpointsOverlap(left, right)
        && scopesOverlap(left, right)
        && stableStringify(left.condition) === stableStringify(right.condition)
        && actionsContradict(left, right)
      ) {
        conflicts.push(issue(
          'contradictory_actions',
          'blocking',
          [left.versionId, right.versionId],
          'Regras equivalentes na mesma prioridade permitem e bloqueiam a mesma situacao.',
        ))
      }
      if (
        left.category === right.category
        && checkpointsOverlap(left, right)
        && scopesEqual(left, right)
        && left.priority > right.priority
        && stableStringify(left.condition) === stableStringify(right.condition)
        && left.inheritanceMode === 'replace'
      ) {
        conflicts.push(issue(
          'shadowed',
          'warning',
          [right.versionId, left.versionId],
          'A regra de menor prioridade nunca sera aplicada porque outra regra a substitui.',
        ))
      }
    }
  }

  conflicts.push(...dependencyCycles(policies))
  return deduplicate(conflicts)
}

function dependencyCycles(policies: readonly ExecutablePolicyVersion[]): PolicyConflict[] {
  const byCode = new Map(policies.map((policy) => [policy.code, policy]))
  const visited = new Set<string>()
  const active = new Set<string>()
  const result: PolicyConflict[] = []

  const visit = (policy: ExecutablePolicyVersion, path: string[]) => {
    if (active.has(policy.code)) {
      const cycleStart = path.indexOf(policy.code)
      const cycleCodes = cycleStart >= 0 ? path.slice(cycleStart) : [...path, policy.code]
      const ids = cycleCodes.flatMap((code) => byCode.get(code)?.versionId || [])
      result.push(issue('dependency_cycle', 'blocking', ids, `Ciclo de dependencia: ${[...cycleCodes, policy.code].join(' -> ')}.`))
      return
    }
    if (visited.has(policy.code)) return
    active.add(policy.code)
    for (const dependency of policy.dependencies || []) {
      if (dependency.type !== 'policy') continue
      const target = byCode.get(dependency.key)
      if (target) visit(target, [...path, policy.code])
    }
    active.delete(policy.code)
    visited.add(policy.code)
  }

  policies.forEach((policy) => visit(policy, []))
  return result
}

function actionsContradict(left: ExecutablePolicyVersion, right: ExecutablePolicyVersion): boolean {
  const leftAllows = left.actions.some((action) => action.type === 'allow' || action.type === 'auto_approve')
  const rightAllows = right.actions.some((action) => action.type === 'allow' || action.type === 'auto_approve')
  const leftBlocks = left.actions.some((action) => BLOCKING_ACTIONS.has(action.type))
  const rightBlocks = right.actions.some((action) => BLOCKING_ACTIONS.has(action.type))
  return (leftAllows && rightBlocks) || (rightAllows && leftBlocks)
}

function periodsOverlap(left: ExecutablePolicyVersion, right: ExecutablePolicyVersion): boolean {
  const leftStart = left.validFrom ? Date.parse(left.validFrom) : Number.NEGATIVE_INFINITY
  const leftEnd = left.validUntil ? Date.parse(left.validUntil) : Number.POSITIVE_INFINITY
  const rightStart = right.validFrom ? Date.parse(right.validFrom) : Number.NEGATIVE_INFINITY
  const rightEnd = right.validUntil ? Date.parse(right.validUntil) : Number.POSITIVE_INFINITY
  return leftStart < rightEnd && rightStart < leftEnd
}

function scopesOverlap(left: ExecutablePolicyVersion, right: ExecutablePolicyVersion): boolean {
  return left.scopes.some((leftScope) => right.scopes.some((rightScope) => (
    leftScope.type === rightScope.type
    && (leftScope.type === 'tenant' || leftScope.id === rightScope.id)
    && (leftScope.mode || 'include') === 'include'
    && (rightScope.mode || 'include') === 'include'
  )))
}

function scopesEqual(left: ExecutablePolicyVersion, right: ExecutablePolicyVersion): boolean {
  return stableStringify(left.scopes) === stableStringify(right.scopes)
}

function checkpointsOverlap(left: ExecutablePolicyVersion, right: ExecutablePolicyVersion): boolean {
  return left.checkpoints.includes('*')
    || right.checkpoints.includes('*')
    || left.checkpoints.some((checkpoint) => right.checkpoints.includes(checkpoint))
}

function issue(
  type: PolicyConflict['type'],
  severity: PolicyConflict['severity'],
  policyVersionIds: string[],
  explanation: string,
): PolicyConflict {
  return { type, severity, policyVersionIds: Array.from(new Set(policyVersionIds)), explanation }
}

function deduplicate(conflicts: PolicyConflict[]): PolicyConflict[] {
  const seen = new Set<string>()
  return conflicts.filter((conflict) => {
    const key = `${conflict.type}:${[...conflict.policyVersionIds].sort().join(',')}:${conflict.explanation}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

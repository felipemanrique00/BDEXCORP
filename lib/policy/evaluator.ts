import { createHash } from 'node:crypto'

import { evaluateCondition } from '@/lib/policy/operators'
import { executablePolicyVersionSchema } from '@/lib/policy/schema'
import type {
  ConditionTrace,
  ExecutablePolicyVersion,
  PolicyAction,
  PolicyDecisionExplanation,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  PolicyExpression,
  PolicyResultItem,
  PolicyScope,
} from '@/lib/policy/types'

export const POLICY_ENGINE_VERSION = '1.0.0'

interface ApplicablePolicy {
  policy: ExecutablePolicyVersion
  specificity: number
}

export function evaluatePolicies(
  rawPolicies: readonly ExecutablePolicyVersion[],
  context: PolicyEvaluationContext,
): PolicyEvaluationResult {
  const policies = rawPolicies.map((policy) => executablePolicyVersionSchema.parse(policy))
  const applicable = resolveApplicablePolicies(policies, context)
  const decisions = applicable.map(({ policy, specificity }) => evaluatePolicy(policy, specificity, context.facts))
  const matched = decisions.filter((decision) => decision.matched && !decision.exceptionApplied)
  const items = matched.flatMap(decisionItems)
  const errors = decisions.flatMap(evaluationErrorItem)
  const blocks = [
    ...items.filter((item) => ['block', 'prevent_issuance', 'block_supplier'].includes(item.action)),
    ...errors,
  ]
  const warnings = items.filter((item) => item.action === 'warn')
  const justificationsRequired = items.filter((item) => (
    item.action === 'require_justification' || item.action === 'require_predefined_justification'
  ))
  const approvalsRequired = items.filter((item) => (
    item.action === 'request_approval'
    || item.action === 'add_approval_level'
    || item.action === 'require_parallel_approval'
    || item.action === 'require_sequential_approval'
    || item.action === 'route_to_merit_approval'
    || item.action === 'route_to_cost_approval'
  ))
  const requiredDocuments = items.filter((item) => (
    item.action === 'require_document' || item.action === 'require_attachment' || item.action === 'require_insurance'
  ))
  const classified = new Set([
    ...blocks, ...warnings, ...justificationsRequired, ...approvalsRequired, ...requiredDocuments,
  ].map(itemIdentity))
  const requiredActions = [
    ...items.filter((item) => !classified.has(itemIdentity(item)) && item.action !== 'allow'),
    ...errors,
  ]
  const factsHash = sha256(context.facts)
  const evaluationSeed = {
    factsHash,
    checkpoint: context.checkpoint,
    evaluatedAt: context.evaluatedAt,
    policyVersions: matched.map((decision) => decision.policyVersionId),
    mode: context.mode || 'enforce',
  }
  const evaluationId = `peval_${sha256(evaluationSeed).slice(0, 32)}`
  const resultCore = {
    passed: blocks.length === 0,
    errors,
    warnings,
    justificationsRequired,
    approvalsRequired,
    blocks,
    requiredDocuments,
    requiredActions,
    applicablePolicies: matched.map((decision) => decision.policyId),
    policyVersions: matched.map((decision) => decision.policyVersionId),
    alternatives: uniqueStrings(items.flatMap((item) => stringArray(item.configuration.alternatives))),
    remediation: uniqueStrings(items.flatMap((item) => item.remediation ? [item.remediation] : [])),
    evaluationId,
    factsHash,
    evaluatedAt: context.evaluatedAt,
    checkpoint: context.checkpoint,
    mode: context.mode || 'enforce',
    decisions,
  }

  return {
    ...resultCore,
    resultHash: sha256(resultCore),
  }
}

export function evaluateExpression(
  expression: PolicyExpression,
  facts: Record<string, unknown>,
): ConditionTrace {
  if ('all' in expression) {
    const children = expression.all.map((child) => evaluateExpression(child, facts))
    const error = firstTraceError(children)
    return { kind: 'all', matched: !error && children.every((child) => child.matched), error, children }
  }
  if ('any' in expression) {
    const children = expression.any.map((child) => evaluateExpression(child, facts))
    const error = firstTraceError(children)
    return { kind: 'any', matched: !error && children.some((child) => child.matched), error, children }
  }
  if ('not' in expression) {
    const child = evaluateExpression(expression.not, facts)
    const error = traceError(child)
    return { kind: 'not', matched: !error && !child.matched, error, children: [child] }
  }
  const result = evaluateCondition(expression, facts)
  return {
    kind: 'condition',
    matched: result.matched,
    fact: expression.fact,
    operator: expression.operator,
    observed: result.observed,
    expected: result.expected,
    error: result.error,
  }
}

export function resolveApplicablePolicies(
  policies: readonly ExecutablePolicyVersion[],
  context: PolicyEvaluationContext,
): ApplicablePolicy[] {
  const evaluatedAt = Date.parse(context.evaluatedAt)
  if (!Number.isFinite(evaluatedAt)) throw new Error('Data de avaliacao invalida.')

  const candidates = policies.flatMap((policy) => {
    if (!policy.checkpoints.includes('*') && !policy.checkpoints.includes(context.checkpoint)) return []
    if (policy.validFrom && Date.parse(policy.validFrom) > evaluatedAt) return []
    if (policy.validUntil && Date.parse(policy.validUntil) <= evaluatedAt) return []
    const specificity = matchingScopeSpecificity(policy.scopes, context)
    return specificity === null ? [] : [{ policy, specificity }]
  }).sort((left, right) => (
    left.specificity - right.specificity
    || left.policy.priority - right.policy.priority
    || left.policy.version - right.policy.version
    || left.policy.versionId.localeCompare(right.policy.versionId)
  ))

  const selected: ApplicablePolicy[] = []
  for (const candidate of candidates) {
    const { policy, specificity } = candidate
    if (policy.inheritanceMode === 'disable') {
      removeOverridable(selected, (current) => current.policy.category === policy.category, specificity, policy)
      continue
    }
    if (policy.inheritanceMode === 'stop_inheritance') {
      removeOverridable(selected, () => true, specificity, policy)
    }
    if (policy.inheritanceMode === 'replace') {
      removeOverridable(selected, (current) => current.policy.category === policy.category, specificity, policy)
    }
    if (policy.inheritanceMode === 'override') {
      removeOverridable(selected, (current) => current.policy.code === policy.code, specificity, policy)
    }
    selected.push(candidate)
  }

  return selected.sort((left, right) => (
    right.policy.priority - left.policy.priority
    || right.specificity - left.specificity
    || right.policy.version - left.policy.version
    || left.policy.versionId.localeCompare(right.policy.versionId)
  ))
}

function evaluatePolicy(
  policy: ExecutablePolicyVersion,
  specificity: number,
  facts: Record<string, unknown>,
): PolicyDecisionExplanation {
  const trace = evaluateExpression(policy.condition, facts)
  const exceptionTraces = trace.matched && !traceError(trace)
    ? (policy.exceptions || []).map((exception) => evaluateExpression(exception, facts))
    : []
  const evaluationError = traceError(trace) || firstTraceError(exceptionTraces)
  const exceptionApplied = !evaluationError && exceptionTraces.some((exception) => exception.matched)
  const matched = trace.matched && !evaluationError && !exceptionApplied
  const explanation = evaluationError
    ? `${policy.name}: avaliacao invalida (${evaluationError}).`
    : exceptionApplied
      ? `${policy.name}: condicao atendida, mas uma excecao autorizada foi aplicada.`
      : matched
        ? `${policy.name}: condicao atendida; ${policy.actions.map((action) => action.message).join(' ')}`
        : `${policy.name}: condicao nao atendida.`

  return {
    policyId: policy.policyId,
    policyVersionId: policy.versionId,
    policyCode: policy.code,
    policyName: policy.name,
    version: policy.version,
    category: policy.category,
    priority: policy.priority,
    severity: policy.severity,
    matched,
    exceptionApplied,
    scopeSpecificity: specificity,
    trace,
    exceptionTraces,
    evaluationError,
    actions: matched && !exceptionApplied ? policy.actions : [],
    explanation,
  }
}

function decisionItems(decision: PolicyDecisionExplanation): PolicyResultItem[] {
  return decision.actions.map((action) => actionItem(decision, action))
}

function evaluationErrorItem(decision: PolicyDecisionExplanation): PolicyResultItem[] {
  if (!decision.evaluationError) return []
  return [{
    policyId: decision.policyId,
    policyVersionId: decision.policyVersionId,
    policyCode: decision.policyCode,
    action: 'require_manual_review',
    message: `Nao foi possivel avaliar a politica ${decision.policyName} com seguranca.`,
    remediation: 'Revise os fatos, dependencias e configuracao da politica antes de continuar.',
    configuration: { error: decision.evaluationError },
  }]
}

function actionItem(decision: PolicyDecisionExplanation, action: PolicyAction): PolicyResultItem {
  return {
    policyId: decision.policyId,
    policyVersionId: decision.policyVersionId,
    policyCode: decision.policyCode,
    action: action.type,
    message: action.message,
    remediation: action.remediation,
    configuration: action.configuration || {},
  }
}

function matchingScopeSpecificity(
  scopes: readonly PolicyScope[],
  context: PolicyEvaluationContext,
): number | null {
  const matches = (scope: PolicyScope) => scope.type === 'tenant'
    ? context.scopes.some((item) => item.type === 'tenant')
    : context.scopes.some((item) => item.type === scope.type && item.id === scope.id)
  if (scopes.some((scope) => (scope.mode || 'include') === 'exclude' && matches(scope))) return null
  const included = scopes.filter((scope) => (scope.mode || 'include') === 'include' && matches(scope))
  return included.length ? Math.max(...included.map((scope) => scope.specificity)) : null
}

function removeOverridable(
  selected: ApplicablePolicy[],
  predicate: (candidate: ApplicablePolicy) => boolean,
  specificity: number,
  replacingPolicy: ExecutablePolicyVersion,
): void {
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const current = selected[index]
    const canonicalMatrixTrigger = current.policy.code.startsWith('matrix.trigger.')
    const canonicalMatrixReplacement = replacingPolicy.code.startsWith('matrix.trigger.')
    if (
      current.specificity <= specificity
      && current.policy.overridable
      && (!canonicalMatrixTrigger || canonicalMatrixReplacement)
      && predicate(current)
    ) {
      selected.splice(index, 1)
    }
  }
}

function itemIdentity(item: PolicyResultItem): string {
  return `${item.policyVersionId}:${item.action}:${item.message}`
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function traceError(trace: ConditionTrace): string | undefined {
  return trace.error || firstTraceError(trace.children || [])
}

function firstTraceError(traces: readonly ConditionTrace[]): string | undefined {
  for (const trace of traces) {
    const error = traceError(trace)
    if (error) return error
  }
  return undefined
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

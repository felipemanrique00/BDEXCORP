export const HOTEL_POLICY_CODE = 'local-hotel-selection-approval'
export const HOTEL_WORKFLOW_CODE = 'local-hotel-cost-approval'
export const AIR_POLICY_CODE = 'local-air-selection-approval'
export const AIR_WORKFLOW_CODE = 'local-air-cost-approval'
export const LOCAL_APPROVAL_SEED_PORT = 55433
export const LOCAL_APPROVAL_SEED_DATABASE = 'bdex_gap_closure'

const SERVICE_FACT = 'request.service'
const SELECTION_FACT = 'operation.checkpoint'

export function selectionCondition(service) {
  assertService(service)
  return {
    all: [
      { fact: SELECTION_FACT, operator: 'eq', value: 'selection' },
      { fact: SERVICE_FACT, operator: 'eq', value: service },
    ],
  }
}

/**
 * Adds an AND service guard without discarding unrelated fixture conditions.
 * Existing service predicates are removed first so a bad local fixture cannot
 * remain ambiguous or impossible to satisfy.
 */
export function constrainSelectionCondition(condition, service) {
  assertService(service)
  const serviceGuard = { fact: SERVICE_FACT, operator: 'eq', value: service }
  const withoutService = removeServicePredicates(condition)

  if (!withoutService) return selectionCondition(service)
  if (isRecord(withoutService) && Array.isArray(withoutService.all)) {
    return { ...withoutService, all: [...withoutService.all, serviceGuard] }
  }
  return { all: [withoutService, serviceGuard] }
}

export function conditionTargetsOnlyService(condition, service) {
  assertService(service)
  const predicates = collectPredicates(condition)
  const servicePredicates = predicates.filter((item) => item.fact === SERVICE_FACT)
  const selectionPredicates = predicates.filter((item) => item.fact === SELECTION_FACT)
  return servicePredicates.length === 1
    && servicePredicates[0].operator === 'eq'
    && servicePredicates[0].value === service
    && selectionPredicates.some((item) => item.operator === 'eq' && item.value === 'selection')
}

export function retargetApprovalActions(actions, workflowCode) {
  const normalized = Array.isArray(actions) ? actions.map(cloneJson) : []
  if (!normalized.some((action) => action?.type === 'request_approval')) {
    throw new Error('A politica base nao possui uma acao request_approval para clonar.')
  }
  return normalized.map((action) => action?.type === 'request_approval'
    ? {
        ...action,
        configuration: { ...(isRecord(action.configuration) ? action.configuration : {}), workflow: workflowCode },
      }
    : action)
}

export function approvalActionsTargetWorkflow(actions, workflowCode) {
  const approvalActions = Array.isArray(actions)
    ? actions.filter((action) => action?.type === 'request_approval')
    : []
  return approvalActions.length > 0
    && approvalActions.every((action) => action?.configuration?.workflow === workflowCode)
}

/**
 * Compares topology and approver resolution while deliberately ignoring the
 * generated UUIDs and the user-facing names changed for the air copy.
 */
export function workflowApprovalSignature(graph) {
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('Snapshot do workflow base invalido.')
  }
  const nodeKeyById = new Map(graph.nodes.map((node) => [node.id, node.key]))
  const nodes = graph.nodes.map((node) => ({
    key: node.key,
    type: node.type,
    approvalKind: node.approvalKind || null,
    completionMode: node.completionMode || null,
    quorum: node.quorum || null,
    approverResolution: node.approverResolution || {},
    configuration: node.configuration || {},
  })).sort((left, right) => String(left.key).localeCompare(String(right.key)))
  const edges = graph.edges.map((edge) => ({
    sourceKey: nodeKeyById.get(edge.sourceNodeId) || null,
    targetKey: nodeKeyById.get(edge.targetNodeId) || null,
    sequence: Number(edge.sequence) || 0,
    condition: edge.condition || null,
    label: edge.label || null,
  })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  return canonicalJson({ nodes, edges })
}

export function scopeSignature(scopes) {
  const normalized = (Array.isArray(scopes) ? scopes : []).map((scope) => ({
    scopeType: scope.scope_type ?? scope.scopeType,
    scopeId: scope.scope_id ?? scope.scopeId ?? null,
    mode: scope.mode,
    specificity: Number(scope.specificity),
  })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  return canonicalJson(normalized)
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value))
}

function removeServicePredicates(value) {
  if (Array.isArray(value)) {
    const items = value.map(removeServicePredicates).filter((item) => item !== null)
    return items.length ? items : null
  }
  if (!isRecord(value)) return cloneJson(value)
  if (value.fact === SERVICE_FACT) return null

  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'all' || key === 'any') {
      const children = removeServicePredicates(Array.isArray(child) ? child : [])
      if (children) result[key] = children
      continue
    }
    if (key === 'not') {
      const nested = removeServicePredicates(child)
      if (nested) result[key] = nested
      continue
    }
    result[key] = cloneJson(child)
  }
  return Object.keys(result).length ? result : null
}

function collectPredicates(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPredicates(item, output))
    return output
  }
  if (!isRecord(value)) return output
  if (typeof value.fact === 'string') output.push(value)
  Object.values(value).forEach((item) => collectPredicates(item, output))
  return output
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
  )
}

function cloneJson(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertService(service) {
  if (!['hotelaria', 'aereo'].includes(service)) {
    throw new Error(`Servico de roteamento local invalido: ${String(service)}`)
  }
}

import { createHash } from 'node:crypto'

export const GROUND_APPROVAL_TEMPLATE = Object.freeze({
  policyCode: 'local-hotel-selection-approval',
  workflowCode: 'local-hotel-cost-approval',
})

export const GROUND_APPROVAL_ROUTES = Object.freeze([
  Object.freeze({
    service: 'aereo',
    label: 'aereo',
    policyCode: 'local-company-portal-air-selection-approval',
    workflowCode: 'local-company-portal-air-cost-approval',
  }),
  Object.freeze({
    service: 'hotelaria',
    label: 'hotelaria',
    policyCode: 'local-company-portal-hotel-selection-approval',
    workflowCode: 'local-company-portal-hotel-cost-approval',
  }),
  Object.freeze({
    service: 'locacao',
    label: 'locacao de veiculo',
    policyCode: 'local-company-portal-car-selection-approval',
    workflowCode: 'local-company-portal-car-cost-approval',
  }),
  Object.freeze({
    service: 'rodoviario',
    label: 'rodoviario',
    policyCode: 'local-company-portal-bus-selection-approval',
    workflowCode: 'local-company-portal-bus-cost-approval',
  }),
])

export function groundSelectionCondition(service) {
  assertGroundService(service)
  return {
    all: [
      { fact: 'operation.checkpoint', operator: 'eq', value: 'selection' },
      { fact: 'request.service', operator: 'eq', value: service },
    ],
  }
}

export function groundSelectionApprovalActions(route) {
  assertRoute(route)
  return [{
    type: 'request_approval',
    message: `A cotacao ${route.label} escolhida deve ser autorizada antes da reserva.`,
    configuration: { workflow: route.workflowCode },
  }]
}

export function buildGroundApprovalWorkflow({
  fixtureKey,
  route,
  sourceGraph,
  workflowId,
  workflowVersionId,
  stableId,
}) {
  assertRoute(route)
  if (!isRecord(sourceGraph) || !Array.isArray(sourceGraph.nodes) || !Array.isArray(sourceGraph.edges)) {
    throw new Error('snapshot do workflow-base de aprovacao invalido')
  }
  if (typeof stableId !== 'function') throw new Error('gerador de identificadores deterministico ausente')

  const sourceNodes = sourceGraph.nodes.map(normalizeSourceNode)
  assertApprovalPath(sourceNodes, sourceGraph.edges)
  const sourceIds = new Set(sourceNodes.map((node) => node.id))
  if (sourceIds.size !== sourceNodes.length) throw new Error('workflow-base possui ids de no duplicados')

  const targetIdBySourceId = new Map()
  const targetNodes = sourceNodes.map((node) => {
    const id = stableId(`${fixtureKey}:approval-workflow:${route.service}:node:${node.key}`)
    targetIdBySourceId.set(node.id, id)
    if (node.type !== 'approval') {
      return {
        id,
        key: node.key,
        name: node.name,
        type: node.type,
        configuration: cloneJson(isRecord(node.configuration) ? node.configuration : {}),
      }
    }
    return {
      id,
      key: node.key,
      name: `Autorizacao de custo - ${route.label}`,
      type: 'approval',
      approvalKind: 'cost',
      completionMode: 'any',
      approverResolution: {
        selectors: [{ type: 'authority', configuration: { currency: 'BRL' } }],
        combination: 'all',
        minimumApprovers: 1,
        maximumApprovers: 1,
        allowSelfApproval: false,
        separationOfDuties: ['requester'],
      },
      // Configuracoes do no-base podem apontar para pessoas/SLA do hotel; a fixture
      // terrestre preserva apenas a topologia e usa exclusivamente alcadas nativas.
      configuration: {},
    }
  })

  const targetEdges = sourceGraph.edges.map((rawEdge, index) => {
    if (!isRecord(rawEdge)) throw new Error('workflow-base possui conexao invalida')
    const sourceNodeId = targetIdBySourceId.get(rawEdge.sourceNodeId)
    const targetNodeId = targetIdBySourceId.get(rawEdge.targetNodeId)
    if (!sourceNodeId || !targetNodeId) throw new Error('workflow-base possui conexao orfa')
    return {
      id: stableId(
        `${fixtureKey}:approval-workflow:${route.service}:edge:${index}:${String(rawEdge.sourceNodeId)}:${String(rawEdge.targetNodeId)}`,
      ),
      sourceNodeId,
      targetNodeId,
      sequence: Number.isInteger(rawEdge.sequence) && rawEdge.sequence >= 0 ? rawEdge.sequence : 0,
      ...(isRecord(rawEdge.condition) ? { condition: cloneJson(rawEdge.condition) } : {}),
      ...(typeof rawEdge.label === 'string' ? { label: rawEdge.label } : {}),
    }
  })

  const graphBase = {
    workflowId,
    workflowVersionId,
    version: 1,
    code: route.workflowCode,
    name: `Aprovacao local de custo - ${route.label}`,
    nodes: targetNodes,
    edges: targetEdges,
    validFrom: null,
    validUntil: null,
  }
  const graph = { ...graphBase, contentHash: sha256Canonical(graphBase) }
  assertSafeGroundApprovalWorkflow(graph)
  return graph
}

export function assertSafeGroundApprovalWorkflow(graph) {
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('workflow terrestre invalido')
  }
  if (containsUnsafeApprovalToken(graph)) {
    throw new Error('workflow terrestre nao pode conter autoaprovacao ou aprovacao passiva')
  }
  const nodes = graph.nodes.map(normalizeSourceNode)
  assertApprovalPath(nodes, graph.edges)
  const approvals = nodes.filter((node) => node.type === 'approval')
  for (const node of approvals) {
    const resolution = node.approverResolution
    if (!isRecord(resolution)
        || resolution.allowSelfApproval !== false
        || resolution.minimumApprovers !== 1
        || resolution.maximumApprovers !== 1
        || resolution.combination !== 'all'
        || !Array.isArray(resolution.selectors)
        || resolution.selectors.length !== 1
        || resolution.selectors[0]?.type !== 'authority'
        || resolution.selectors[0]?.configuration?.currency !== 'BRL') {
      throw new Error('workflow terrestre precisa de uma alcada BRL, sem autoaprovacao')
    }
  }
  return graph
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value))
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function assertApprovalPath(nodes, rawEdges) {
  const starts = nodes.filter((node) => node.type === 'start')
  const ends = new Set(nodes.filter((node) => node.type === 'end').map((node) => node.id))
  const approvals = new Set(nodes.filter((node) => node.type === 'approval').map((node) => node.id))
  const nodeIds = new Set(nodes.map((node) => node.id))
  if (starts.length !== 1 || ends.size === 0 || approvals.size === 0) {
    throw new Error('workflow terrestre exige um inicio, ao menos uma aprovacao e um fim')
  }
  if (nodeIds.size !== nodes.length) throw new Error('workflow terrestre possui ids de no duplicados')
  const outgoing = new Map()
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of rawEdges) {
    if (!isRecord(edge) || typeof edge.sourceNodeId !== 'string' || typeof edge.targetNodeId !== 'string') {
      throw new Error('workflow terrestre possui conexao invalida')
    }
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      throw new Error('workflow terrestre possui conexao orfa')
    }
    if (edge.sourceNodeId === edge.targetNodeId) throw new Error('workflow terrestre possui autociclo')
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) || []), edge.targetNodeId])
    incomingCount.set(edge.targetNodeId, (incomingCount.get(edge.targetNodeId) || 0) + 1)
  }
  for (const node of nodes) {
    if (node.type !== 'end' && !(outgoing.get(node.id)?.length)) {
      throw new Error('workflow terrestre possui no sem saida')
    }
    if (node.type === 'start' && incomingCount.get(node.id)) {
      throw new Error('workflow terrestre possui entrada no no inicial')
    }
    if (node.type === 'end' && outgoing.get(node.id)?.length) {
      throw new Error('workflow terrestre possui saida em no final')
    }
  }
  const reachable = new Set()
  const reachableQueue = [starts[0].id]
  while (reachableQueue.length) {
    const nodeId = reachableQueue.shift()
    if (reachable.has(nodeId)) continue
    reachable.add(nodeId)
    reachableQueue.push(...(outgoing.get(nodeId) || []))
  }
  if (reachable.size !== nodes.length || ![...ends].some((endId) => reachable.has(endId))) {
    throw new Error('workflow terrestre possui nos inalcançaveis ou nenhum fim alcançavel')
  }
  const topologicalQueue = nodes.filter((node) => incomingCount.get(node.id) === 0).map((node) => node.id)
  let topologicalCount = 0
  while (topologicalQueue.length) {
    const nodeId = topologicalQueue.shift()
    topologicalCount += 1
    for (const targetId of outgoing.get(nodeId) || []) {
      const remaining = (incomingCount.get(targetId) || 0) - 1
      incomingCount.set(targetId, remaining)
      if (remaining === 0) topologicalQueue.push(targetId)
    }
  }
  if (topologicalCount !== nodes.length) {
    throw new Error('workflow terrestre possui ciclo')
  }
  const queue = [starts[0].id]
  const visited = new Set()
  while (queue.length) {
    const nodeId = queue.shift()
    if (visited.has(nodeId) || approvals.has(nodeId)) continue
    if (ends.has(nodeId)) throw new Error('workflow terrestre possui caminho que contorna a aprovacao')
    visited.add(nodeId)
    queue.push(...(outgoing.get(nodeId) || []))
  }
}

function normalizeSourceNode(rawNode) {
  if (!isRecord(rawNode)
      || typeof rawNode.id !== 'string'
      || typeof rawNode.key !== 'string'
      || typeof rawNode.name !== 'string'
      || typeof rawNode.type !== 'string') {
    throw new Error('workflow-base possui no invalido')
  }
  return rawNode
}

function containsUnsafeApprovalToken(value) {
  if (Array.isArray(value)) return value.some(containsUnsafeApprovalToken)
  if (isRecord(value)) {
    return Object.entries(value).some(([key, child]) => (
      /auto[_ -]?approve|passive[_ -]?approv/i.test(key) || containsUnsafeApprovalToken(child)
    ))
  }
  return typeof value === 'string' && /auto[_ -]?approve|passive[_ -]?approv/i.test(value)
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]))
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertGroundService(service) {
  if (!GROUND_APPROVAL_ROUTES.some((route) => route.service === service)) {
    throw new Error(`servico terrestre invalido: ${String(service)}`)
  }
}

function assertRoute(route) {
  if (!GROUND_APPROVAL_ROUTES.some((candidate) => candidate === route
      || (candidate.service === route?.service
        && candidate.policyCode === route?.policyCode
        && candidate.workflowCode === route?.workflowCode))) {
    throw new Error('rota de aprovacao terrestre invalida')
  }
}

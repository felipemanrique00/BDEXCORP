import { evaluateExpression } from '@/lib/policy/evaluator'
import { validateEnterpriseWorkflow } from '@/lib/workflows/graph'
import type {
  EnterpriseWorkflowEdge,
  EnterpriseWorkflowGraph,
  EnterpriseWorkflowNode,
  EnterpriseWorkflowSimulationResult,
} from '@/lib/workflows/types'

const WAITING_TYPES = new Set([
  'human_task',
  'approval',
  'wait',
  'timer',
  'service_call',
  'integration_call',
  'subworkflow',
])

export function simulateEnterpriseWorkflow(
  workflow: EnterpriseWorkflowGraph,
  facts: Record<string, unknown>,
): EnterpriseWorkflowSimulationResult {
  const validation = validateEnterpriseWorkflow(workflow)
  if (!validation.valid) {
    return {
      valid: false,
      reachedEnd: false,
      steps: [],
      issues: validation.issues,
      visitedNodeIds: [],
    }
  }

  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]))
  const start = workflow.nodes.find((node) => node.type === 'start')!
  const queue = [start.id]
  const visited = new Set<string>()
  const steps: EnterpriseWorkflowSimulationResult['steps'] = []

  while (queue.length) {
    const nodeId = queue.shift()!
    if (visited.has(nodeId)) continue
    const node = nodesById.get(nodeId)
    if (!node) continue
    visited.add(nodeId)
    const selected = selectSimulationEdges(workflow, node, facts)
    const waiting = WAITING_TYPES.has(node.type)
    steps.push({
      sequence: steps.length + 1,
      nodeId: node.id,
      nodeKey: node.key,
      nodeName: node.name,
      nodeType: node.type,
      outcome: waiting ? 'waiting' : 'traversed',
      selectedEdgeIds: selected.map((edge) => edge.id),
      explanation: explanationFor(node, selected),
    })
    queue.push(...selected.map((edge) => edge.targetNodeId))
  }

  return {
    valid: true,
    reachedEnd: steps.some((step) => step.nodeType === 'end'),
    steps,
    issues: validation.issues,
    visitedNodeIds: [...visited],
  }
}

export function selectSimulationEdges(
  workflow: EnterpriseWorkflowGraph,
  node: EnterpriseWorkflowNode,
  facts: Record<string, unknown>,
): EnterpriseWorkflowEdge[] {
  const outgoing = workflow.edges
    .filter((edge) => edge.sourceNodeId === node.id)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  if (node.type === 'condition' || node.type === 'decision') {
    const matches = outgoing.filter((edge) => (
      edge.kind === 'condition'
      && edge.condition
      && evaluateExpression(edge.condition, facts).matched
    ))
    if (matches.length) return node.type === 'condition' ? matches.slice(0, 1) : matches
    return outgoing.filter((edge) => edge.kind === 'default').slice(0, 1)
  }
  if (node.type === 'parallel_split') return outgoing.filter((edge) => edge.kind === 'parallel')
  return outgoing.filter((edge) => !['failure', 'timeout', 'compensation'].includes(edge.kind))
}

function explanationFor(node: EnterpriseWorkflowNode, selected: EnterpriseWorkflowEdge[]): string {
  if (node.type === 'condition' || node.type === 'decision') {
    return selected.length
      ? `Ramo selecionado: ${selected.map((edge) => edge.label || edge.kind).join(', ')}.`
      : 'Nenhum ramo correspondeu aos fatos.'
  }
  if (WAITING_TYPES.has(node.type)) return 'O runtime aguardará conclusão externa autorizada.'
  if (node.type === 'domain_command') return 'O comando será resolvido pelo catálogo de domínio e auditado.'
  if (node.type === 'end') return 'Execução encerrada.'
  return 'Nó percorrido de forma determinística.'
}

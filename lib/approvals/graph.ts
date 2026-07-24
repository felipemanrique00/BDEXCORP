import { evaluateExpression } from '@/lib/policy'
import { approvalWorkflowSnapshotSchema } from '@/lib/approvals/schema'
import type {
  ApprovalWorkflowNode,
  ApprovalWorkflowSnapshot,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from '@/lib/approvals/types'

export class ApprovalWorkflowError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message)
    this.name = 'ApprovalWorkflowError'
  }
}

export function validateApprovalWorkflow(raw: ApprovalWorkflowSnapshot): WorkflowValidationResult {
  const parsed = approvalWorkflowSnapshotSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'INVALID_WORKFLOW_SCHEMA',
        severity: 'blocking' as const,
        message: `${issue.path.join('.') || 'workflow'}: ${issue.message}`,
      })),
      topologicalOrder: [],
    }
  }

  const workflow = parsed.data
  const issues: WorkflowValidationIssue[] = []
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]))
  const duplicateKeys = duplicates(workflow.nodes.map((node) => node.key))
  if (duplicateKeys.length) issues.push(blocking('DUPLICATE_NODE_KEY', `Chaves de nos duplicadas: ${duplicateKeys.join(', ')}.`))

  const starts = workflow.nodes.filter((node) => node.type === 'start')
  const ends = workflow.nodes.filter((node) => node.type === 'end')
  if (starts.length !== 1) issues.push(blocking('INVALID_START_COUNT', 'O workflow deve possuir exatamente um no inicial.', starts.map(nodeId)))
  if (!ends.length) issues.push(blocking('MISSING_END_NODE', 'O workflow deve possuir ao menos um no final.'))

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const edge of workflow.edges) {
    if (!byId.has(edge.sourceNodeId) || !byId.has(edge.targetNodeId)) {
      issues.push({ code: 'ORPHAN_EDGE', severity: 'blocking', message: 'Conexao referencia no inexistente.', edgeIds: [edge.id] })
      continue
    }
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) || []), edge.targetNodeId])
    incoming.set(edge.targetNodeId, [...(incoming.get(edge.targetNodeId) || []), edge.sourceNodeId])
  }

  for (const node of workflow.nodes) {
    if (node.type !== 'end' && !(outgoing.get(node.id)?.length)) {
      issues.push(blocking('DEAD_END_NODE', `O no ${node.name} nao possui saida.`, [node.id]))
    }
    if (node.type === 'start' && incoming.get(node.id)?.length) {
      issues.push(blocking('START_HAS_INCOMING_EDGE', 'O no inicial nao pode possuir entrada.', [node.id]))
    }
    if (node.type === 'end' && outgoing.get(node.id)?.length) {
      issues.push(blocking('END_HAS_OUTGOING_EDGE', `O no final ${node.name} nao pode possuir saida.`, [node.id]))
    }
    if (node.type === 'approval' && node.completionMode === 'quorum') {
      const max = node.approverResolution?.maximumApprovers
      if (max && node.quorum && node.quorum > max) {
        issues.push(blocking('QUORUM_EXCEEDS_MAX_APPROVERS', `O quorum do no ${node.name} excede o maximo de aprovadores.`, [node.id]))
      }
    }
  }

  const topologicalOrder = topologicalSort(workflow.nodes, outgoing)
  if (topologicalOrder.length !== workflow.nodes.length) {
    issues.push(blocking('WORKFLOW_CYCLE', 'O workflow possui ciclo e nao pode ser publicado.'))
  }
  if (starts.length === 1) {
    const reachable = reachableFrom(starts[0].id, outgoing)
    const unreachable = workflow.nodes.filter((node) => !reachable.has(node.id))
    if (unreachable.length) {
      issues.push(blocking('UNREACHABLE_NODES', `Existem ${unreachable.length} no(s) inalcancaveis.`, unreachable.map(nodeId)))
    }
  }

  return { valid: !issues.some((issue) => issue.severity === 'blocking'), issues, topologicalOrder }
}

export function assertValidApprovalWorkflow(workflow: ApprovalWorkflowSnapshot): ApprovalWorkflowSnapshot {
  const result = validateApprovalWorkflow(workflow)
  if (!result.valid) {
    throw new ApprovalWorkflowError(
      'INVALID_APPROVAL_WORKFLOW',
      result.issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.message).join(' '),
      400,
    )
  }
  return approvalWorkflowSnapshotSchema.parse(workflow)
}

export function resolveNextWorkflowNodes(
  workflow: ApprovalWorkflowSnapshot,
  fromNodeId: string,
  facts: Record<string, unknown>,
): ApprovalWorkflowNode[] {
  assertValidApprovalWorkflow(workflow)
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]))
  if (!byId.has(fromNodeId)) throw new ApprovalWorkflowError('WORKFLOW_NODE_NOT_FOUND', 'No do workflow nao encontrado.', 404)

  const queue = matchingTargets(workflow, fromNodeId, facts)
  const result: ApprovalWorkflowNode[] = []
  const visited = new Set<string>()
  while (queue.length) {
    const nodeId = queue.shift() as string
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    const node = byId.get(nodeId)
    if (!node) continue
    if (node.type === 'approval' || node.type === 'end') {
      result.push(node)
      continue
    }
    queue.push(...matchingTargets(workflow, node.id, facts))
  }
  if (!result.length) throw new ApprovalWorkflowError('NO_WORKFLOW_PATH', 'Nenhum caminho de aprovacao corresponde aos fatos informados.')
  return result
}

function matchingTargets(workflow: ApprovalWorkflowSnapshot, nodeId: string, facts: Record<string, unknown>): string[] {
  const edges = workflow.edges
    .filter((edge) => edge.sourceNodeId === nodeId)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  const matched = edges.filter((edge) => !edge.condition || evaluateExpression(edge.condition, facts).matched)
  return matched.map((edge) => edge.targetNodeId)
}

function topologicalSort(nodes: ApprovalWorkflowNode[], outgoing: Map<string, string[]>): string[] {
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]))
  outgoing.forEach((targets) => targets.forEach((target) => incomingCount.set(target, (incomingCount.get(target) || 0) + 1)))
  const queue = nodes.filter((node) => incomingCount.get(node.id) === 0).map(nodeId).sort()
  const result: string[] = []
  while (queue.length) {
    const current = queue.shift() as string
    result.push(current)
    for (const target of outgoing.get(current) || []) {
      const count = (incomingCount.get(target) || 0) - 1
      incomingCount.set(target, count)
      if (count === 0) {
        queue.push(target)
        queue.sort()
      }
    }
  }
  return result
}

function reachableFrom(start: string, outgoing: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length) {
    const current = queue.shift() as string
    if (seen.has(current)) continue
    seen.add(current)
    queue.push(...(outgoing.get(current) || []))
  }
  return seen
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const result = new Set<string>()
  values.forEach((value) => seen.has(value) ? result.add(value) : seen.add(value))
  return [...result]
}

function blocking(code: string, message: string, nodeIds?: string[]): WorkflowValidationIssue {
  return { code, severity: 'blocking', message, nodeIds }
}

function nodeId(node: ApprovalWorkflowNode): string {
  return node.id
}

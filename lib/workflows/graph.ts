import { getWorkflowDomainCommand } from '@/lib/workflows/command-catalog'
import { enterpriseWorkflowGraphSchema } from '@/lib/workflows/schema'
import type {
  EnterpriseWorkflowEdge,
  EnterpriseWorkflowGraph,
  EnterpriseWorkflowNode,
  EnterpriseWorkflowValidationIssue,
  EnterpriseWorkflowValidationResult,
} from '@/lib/workflows/types'

const MUTATING_CONFIGURATION_KEY = /^(?:status|setstatus|entitystatus|lifecyclestatus|state|newstatus|sql|query|table)$/i
const PURE_AUTOMATIC_OPERATIONS = new Set(['set_variable', 'copy_value', 'calculate_expression', 'format_value'])
const WAITING_NODE_TYPES = new Set(['human_task', 'approval', 'wait', 'timer', 'service_call', 'integration_call', 'subworkflow'])

export class EnterpriseWorkflowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'EnterpriseWorkflowError'
  }
}

export function validateEnterpriseWorkflow(raw: EnterpriseWorkflowGraph): EnterpriseWorkflowValidationResult {
  const parsed = enterpriseWorkflowGraphSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => blocking(
        'INVALID_WORKFLOW_SCHEMA',
        `${issue.path.join('.') || 'workflow'}: ${issue.message}`,
      )),
      topologicalOrder: [],
    }
  }

  const workflow = parsed.data
  const issues: EnterpriseWorkflowValidationIssue[] = []
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, EnterpriseWorkflowEdge[]>()
  const incoming = new Map<string, EnterpriseWorkflowEdge[]>()

  addDuplicateIssue(issues, 'DUPLICATE_NODE_ID', 'Identificadores de nós duplicados', workflow.nodes.map((node) => node.id))
  addDuplicateIssue(issues, 'DUPLICATE_NODE_KEY', 'Chaves de nós duplicadas', workflow.nodes.map((node) => node.key))
  addDuplicateIssue(issues, 'DUPLICATE_EDGE_ID', 'Identificadores de conexões duplicados', workflow.edges.map((edge) => edge.id))

  for (const edge of workflow.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) {
      issues.push({
        code: 'ORPHAN_EDGE',
        severity: 'blocking',
        message: 'A conexão referencia um nó inexistente.',
        edgeIds: [edge.id],
      })
      continue
    }
    if (edge.sourceNodeId === edge.targetNodeId) {
      issues.push({
        code: 'SELF_EDGE',
        severity: 'blocking',
        message: 'Um nó não pode se conectar diretamente a ele mesmo.',
        edgeIds: [edge.id],
      })
    }
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) || []), edge])
    incoming.set(edge.targetNodeId, [...(incoming.get(edge.targetNodeId) || []), edge])
  }

  const starts = workflow.nodes.filter((node) => node.type === 'start')
  const ends = workflow.nodes.filter((node) => node.type === 'end')
  if (starts.length !== 1) {
    issues.push(blocking('INVALID_START_COUNT', 'O workflow deve possuir exatamente um evento inicial.', starts.map((node) => node.id)))
  }
  if (!ends.length) issues.push(blocking('MISSING_END_NODE', 'O workflow deve possuir ao menos um encerramento.'))

  for (const node of workflow.nodes) {
    const nodeOutgoing = outgoing.get(node.id) || []
    const nodeIncoming = incoming.get(node.id) || []
    if (node.type !== 'end' && !nodeOutgoing.length) {
      issues.push(blocking('DEAD_END_NODE', `O nó "${node.name}" não possui saída.`, [node.id]))
    }
    if (node.type !== 'start' && !nodeIncoming.length) {
      issues.push(blocking('NODE_WITHOUT_ENTRY', `O nó "${node.name}" não possui entrada.`, [node.id]))
    }
    if (node.type === 'start' && nodeIncoming.length) {
      issues.push(blocking('START_HAS_INCOMING_EDGE', 'O evento inicial não pode possuir entrada.', [node.id]))
    }
    if (node.type === 'end' && nodeOutgoing.length) {
      issues.push(blocking('END_HAS_OUTGOING_EDGE', `O encerramento "${node.name}" não pode possuir saída.`, [node.id]))
    }
    validateNodeConfiguration(workflow, node, nodeIncoming, nodeOutgoing, issues)
  }

  const topologicalOrder = topologicalSort(workflow.nodes, outgoing)
  if (topologicalOrder.length !== workflow.nodes.length) {
    issues.push(blocking(
      'WORKFLOW_CYCLE',
      'O grafo possui ciclo. Use nós de retry ou fallback; conexões cíclicas não são determinísticas.',
    ))
  }

  if (starts.length === 1) {
    const reachable = reachableFrom(starts[0].id, outgoing)
    const unreachable = workflow.nodes.filter((node) => !reachable.has(node.id))
    if (unreachable.length) {
      issues.push(blocking(
        'UNREACHABLE_NODES',
        `Existem ${unreachable.length} nó(s) inalcançáveis a partir do início.`,
        unreachable.map((node) => node.id),
      ))
    }
    const canReachEnd = nodesReachingAnyEnd(ends.map((node) => node.id), incoming)
    const impossible = workflow.nodes.filter((node) => !canReachEnd.has(node.id))
    if (impossible.length) {
      issues.push(blocking(
        'IMPOSSIBLE_COMPLETION_PATH',
        `Existem ${impossible.length} nó(s) sem caminho possível até um encerramento.`,
        impossible.map((node) => node.id),
      ))
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'blocking'),
    issues,
    topologicalOrder,
  }
}

export function assertValidEnterpriseWorkflow(workflow: EnterpriseWorkflowGraph): EnterpriseWorkflowGraph {
  const result = validateEnterpriseWorkflow(workflow)
  if (!result.valid) {
    throw new EnterpriseWorkflowError(
      'INVALID_ENTERPRISE_WORKFLOW',
      result.issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.message).join(' '),
      422,
      result.issues,
    )
  }
  return enterpriseWorkflowGraphSchema.parse(workflow)
}

export function nodeRequiresExternalCompletion(node: EnterpriseWorkflowNode): boolean {
  return WAITING_NODE_TYPES.has(node.type)
}

function validateNodeConfiguration(
  workflow: EnterpriseWorkflowGraph,
  node: EnterpriseWorkflowNode,
  incoming: EnterpriseWorkflowEdge[],
  outgoing: EnterpriseWorkflowEdge[],
  issues: EnterpriseWorkflowValidationIssue[],
): void {
  const configuration = node.configuration
  if (containsForbiddenMutation(configuration)) {
    issues.push(blocking(
      'DIRECT_ENTITY_MUTATION_FORBIDDEN',
      `O nó "${node.name}" tenta alterar estado diretamente. Use um comando de domínio registrado.`,
      [node.id],
    ))
  }

  if (node.type === 'human_task') {
    const assignment = objectValue(configuration.assignment)
    const assignmentType = stringValue(assignment.type)
    const needsValue = ['user', 'role', 'company_role'].includes(assignmentType)
    if (!['user', 'role', 'manager', 'requester', 'company_role'].includes(assignmentType)) {
      issues.push(blocking('HUMAN_TASK_WITHOUT_ASSIGNEE', `A tarefa "${node.name}" não possui responsável válido.`, [node.id]))
    } else if (needsValue && !stringValue(assignment.value)) {
      issues.push(blocking('HUMAN_TASK_WITHOUT_ASSIGNEE', `A tarefa "${node.name}" exige o responsável configurado.`, [node.id]))
    }
    if (!stringValue(configuration.requiredPermission)) {
      issues.push(blocking('HUMAN_TASK_WITHOUT_PERMISSION', `A tarefa "${node.name}" exige uma permissão funcional.`, [node.id]))
    }
  }

  if (node.type === 'automatic_task') {
    const operation = stringValue(configuration.operation)
    if (!PURE_AUTOMATIC_OPERATIONS.has(operation)) {
      issues.push(blocking(
        'UNSAFE_AUTOMATIC_OPERATION',
        `A tarefa automática "${node.name}" deve usar uma operação determinística permitida.`,
        [node.id],
      ))
    }
  }

  if (node.type === 'condition' || node.type === 'decision') {
    const conditional = outgoing.filter((edge) => edge.kind === 'condition')
    const defaults = outgoing.filter((edge) => edge.kind === 'default')
    const minimumBranches = node.type === 'condition' ? 1 : 2
    if (conditional.length < minimumBranches || defaults.length !== 1) {
      issues.push(blocking(
        'INVALID_DECISION_BRANCHES',
        `O nó "${node.name}" exige ${minimumBranches} condição(ões) e exatamente uma saída padrão.`,
        [node.id],
      ))
    }
  }

  if (node.type === 'domain_command') {
    const commandKey = stringValue(configuration.commandKey)
    const command = getWorkflowDomainCommand(commandKey)
    if (!command) {
      issues.push(blocking('UNREGISTERED_DOMAIN_COMMAND', `O comando "${commandKey || 'não informado'}" não está registrado.`, [node.id]))
    } else {
      if (!command.requiredPermission) {
        issues.push(blocking('DOMAIN_COMMAND_WITHOUT_PERMISSION', `O comando "${command.key}" não possui permissão declarada.`, [node.id]))
      }
      const compensationKey = stringValue(configuration.compensationCommandKey)
      const hasCompensationEdge = outgoing.some((edge) => edge.kind === 'compensation')
      if (command.critical && command.compensationRequired && !compensationKey && !hasCompensationEdge) {
        issues.push(blocking(
          'CRITICAL_COMMAND_WITHOUT_COMPENSATION',
          `A operação crítica "${node.name}" exige comando ou caminho de compensação.`,
          [node.id],
        ))
      }
      if (compensationKey && !getWorkflowDomainCommand(compensationKey)) {
        issues.push(blocking(
          'UNREGISTERED_COMPENSATION_COMMAND',
          `O comando de compensação "${compensationKey}" não está registrado.`,
          [node.id],
        ))
      }
    }
  }

  if (node.type === 'service_call' || node.type === 'integration_call') {
    if (!stringValue(configuration.providerKey) || !stringValue(configuration.operation)) {
      issues.push(blocking(
        'INTEGRATION_OPERATION_INCOMPLETE',
        `A chamada "${node.name}" exige provedor e operação.`,
        [node.id],
      ))
    }
    if (!stringValue(configuration.idempotencyScope)) {
      issues.push(blocking(
        'INTEGRATION_WITHOUT_IDEMPOTENCY',
        `A chamada "${node.name}" exige escopo de idempotência.`,
        [node.id],
      ))
    }
    const retries = numberValue(configuration.maxAttempts)
    if (!Number.isInteger(retries) || retries < 1 || retries > 100) {
      issues.push(blocking('INVALID_RETRY_CONFIGURATION', `A chamada "${node.name}" exige de 1 a 100 tentativas.`, [node.id]))
    }
    if (!outgoing.some((edge) => edge.kind === 'failure')) {
      issues.push(blocking('INTEGRATION_WITHOUT_FAILURE_PATH', `A chamada "${node.name}" exige uma saída de falha.`, [node.id]))
    }
  }

  if (node.type === 'timer' || node.type === 'wait' || node.type === 'sla') {
    const duration = numberValue(configuration.durationMinutes)
    if (!Number.isInteger(duration) || duration < 1 || duration > 525_600) {
      issues.push(blocking('INVALID_WAIT_DURATION', `O nó "${node.name}" exige duração válida em minutos.`, [node.id]))
    }
  }

  if (node.type === 'retry') {
    const attempts = numberValue(configuration.maxAttempts)
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
      issues.push(blocking('INVALID_RETRY_CONFIGURATION', `O retry "${node.name}" exige de 1 a 10 tentativas.`, [node.id]))
    }
  }

  if (node.type === 'parallel_split' && outgoing.filter((edge) => edge.kind === 'parallel').length < 2) {
    issues.push(blocking('INVALID_PARALLEL_SPLIT', `O paralelismo "${node.name}" exige ao menos duas saídas paralelas.`, [node.id]))
  }
  if (node.type === 'parallel_join' && incoming.filter((edge) => edge.kind === 'parallel').length < 2) {
    issues.push(blocking('INVALID_PARALLEL_JOIN', `A junção "${node.name}" exige ao menos duas entradas paralelas.`, [node.id]))
  }

  if (node.type === 'quorum') {
    const required = numberValue(configuration.required)
    const total = numberValue(configuration.total)
    if (!Number.isInteger(required) || !Number.isInteger(total) || required < 1 || total < required) {
      issues.push(blocking('INVALID_QUORUM', `O quórum "${node.name}" possui limites inválidos.`, [node.id]))
    }
  }

  if (node.type === 'subworkflow') {
    const workflowCode = stringValue(configuration.workflowCode)
    if (!workflowCode || workflowCode === workflow.code) {
      issues.push(blocking('INVALID_SUBWORKFLOW', `O subworkflow "${node.name}" deve referenciar outro código.`, [node.id]))
    }
  }

  if (node.type === 'approval' && !stringValue(configuration.approvalWorkflowCode)) {
    issues.push(blocking('APPROVAL_WORKFLOW_REQUIRED', `O nó "${node.name}" deve referenciar um workflow de aprovação.`, [node.id]))
  }

  if (node.type === 'compensation' && !stringValue(configuration.commandKey)) {
    issues.push(blocking('COMPENSATION_COMMAND_REQUIRED', `A compensação "${node.name}" exige um comando registrado.`, [node.id]))
  }
}

function containsForbiddenMutation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsForbiddenMutation)
  return Object.entries(value).some(([key, child]) => (
    MUTATING_CONFIGURATION_KEY.test(key)
    || containsForbiddenMutation(child)
  ))
}

function topologicalSort(
  nodes: EnterpriseWorkflowNode[],
  outgoing: Map<string, EnterpriseWorkflowEdge[]>,
): string[] {
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]))
  outgoing.forEach((edges) => edges.forEach((edge) => {
    incomingCount.set(edge.targetNodeId, (incomingCount.get(edge.targetNodeId) || 0) + 1)
  }))
  const queue = nodes.filter((node) => incomingCount.get(node.id) === 0).map((node) => node.id).sort()
  const result: string[] = []
  while (queue.length) {
    const current = queue.shift()!
    result.push(current)
    for (const edge of outgoing.get(current) || []) {
      const count = (incomingCount.get(edge.targetNodeId) || 0) - 1
      incomingCount.set(edge.targetNodeId, count)
      if (count === 0) {
        queue.push(edge.targetNodeId)
        queue.sort()
      }
    }
  }
  return result
}

function reachableFrom(
  start: string,
  outgoing: Map<string, EnterpriseWorkflowEdge[]>,
): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    queue.push(...(outgoing.get(current) || []).map((edge) => edge.targetNodeId))
  }
  return seen
}

function nodesReachingAnyEnd(
  ends: string[],
  incoming: Map<string, EnterpriseWorkflowEdge[]>,
): Set<string> {
  const seen = new Set<string>()
  const queue = [...ends]
  while (queue.length) {
    const current = queue.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    queue.push(...(incoming.get(current) || []).map((edge) => edge.sourceNodeId))
  }
  return seen
}

function addDuplicateIssue(
  issues: EnterpriseWorkflowValidationIssue[],
  code: string,
  label: string,
  values: string[],
): void {
  const duplicated = duplicates(values)
  if (duplicated.length) issues.push(blocking(code, `${label}: ${duplicated.join(', ')}.`))
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  values.forEach((value) => seen.has(value) ? duplicated.add(value) : seen.add(value))
  return [...duplicated]
}

function blocking(code: string, message: string, nodeIds?: string[]): EnterpriseWorkflowValidationIssue {
  return { code, severity: 'blocking', message, nodeIds }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN
}

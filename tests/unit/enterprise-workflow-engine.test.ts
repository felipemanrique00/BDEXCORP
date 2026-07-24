import { describe, expect, it } from 'vitest'

import {
  simulateEnterpriseWorkflow,
  validateEnterpriseWorkflow,
  type EnterpriseWorkflowGraph,
} from '@/lib/workflows'

const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '22222222-2222-4222-8222-222222222222'

function validWorkflow(): EnterpriseWorkflowGraph {
  return {
    workflowId: WORKFLOW_ID,
    workflowVersionId: VERSION_ID,
    version: 1,
    code: 'travel.request.standard',
    name: 'Solicitação padrão',
    processType: 'travel_request',
    contentHash: 'a'.repeat(64),
    source: 'manual',
    nodes: [
      {
        id: 'start',
        key: 'start',
        name: 'Início',
        type: 'start',
        position: { x: 0, y: 0 },
        configuration: {},
      },
      {
        id: 'review',
        key: 'review',
        name: 'Revisar solicitação',
        type: 'human_task',
        position: { x: 240, y: 0 },
        configuration: {
          assignment: { type: 'role', value: 'travel_agent' },
          requiredPermission: 'criar_demandas',
        },
      },
      {
        id: 'normalize',
        key: 'normalize',
        name: 'Normalizar dados',
        type: 'automatic_task',
        position: { x: 480, y: 0 },
        configuration: { operation: 'copy_value', source: 'subject.id', target: 'result.subjectId' },
      },
      {
        id: 'notify',
        key: 'notify',
        name: 'Notificar solicitante',
        type: 'domain_command',
        position: { x: 720, y: 0 },
        configuration: { commandKey: 'workflow.notification.enqueue' },
      },
      {
        id: 'end',
        key: 'end',
        name: 'Concluído',
        type: 'end',
        position: { x: 960, y: 0 },
        configuration: {},
      },
    ],
    edges: [
      { id: 'start-review', sourceNodeId: 'start', targetNodeId: 'review', kind: 'success', sequence: 1 },
      { id: 'review-normalize', sourceNodeId: 'review', targetNodeId: 'normalize', kind: 'success', sequence: 1 },
      { id: 'normalize-notify', sourceNodeId: 'normalize', targetNodeId: 'notify', kind: 'success', sequence: 1 },
      { id: 'notify-end', sourceNodeId: 'notify', targetNodeId: 'end', kind: 'success', sequence: 1 },
    ],
  }
}

describe('enterprise workflow validation', () => {
  it('aceita um fluxo determinístico com tarefa humana e comando registrado', () => {
    const result = validateEnterpriseWorkflow(validWorkflow())
    expect(result.valid).toBe(true)
    expect(result.topologicalOrder).toEqual(['start', 'review', 'normalize', 'notify', 'end'])
  })

  it('bloqueia ciclos e nós sem caminho até o encerramento', () => {
    const workflow = validWorkflow()
    workflow.edges.push({
      id: 'cycle',
      sourceNodeId: 'notify',
      targetNodeId: 'review',
      kind: 'failure',
      sequence: 2,
    })
    const result = validateEnterpriseWorkflow(workflow)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('WORKFLOW_CYCLE')
  })

  it('bloqueia tarefa humana sem responsável e operação automática insegura', () => {
    const workflow = validWorkflow()
    workflow.nodes.find((node) => node.id === 'review')!.configuration = {
      assignment: { type: 'role' },
      requiredPermission: '',
    }
    workflow.nodes.find((node) => node.id === 'normalize')!.configuration = {
      operation: 'update_database',
    }
    const result = validateEnterpriseWorkflow(workflow)
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'HUMAN_TASK_WITHOUT_ASSIGNEE',
      'HUMAN_TASK_WITHOUT_PERMISSION',
      'UNSAFE_AUTOMATIC_OPERATION',
    ]))
  })

  it('impede alteração direta de status fora do catálogo de domínio', () => {
    const workflow = validWorkflow()
    workflow.nodes.find((node) => node.id === 'normalize')!.configuration = {
      operation: 'set_variable',
      status: 'issued',
    }
    const result = validateEnterpriseWorkflow(workflow)
    expect(result.issues.map((issue) => issue.code)).toContain('DIRECT_ENTITY_MUTATION_FORBIDDEN')
  })

  it('exige compensação para comando crítico', () => {
    const workflow = validWorkflow()
    workflow.nodes.find((node) => node.id === 'notify')!.configuration = {
      commandKey: 'travel.lifecycle.start_reservation',
    }
    const result = validateEnterpriseWorkflow(workflow)
    expect(result.issues.map((issue) => issue.code)).toContain('CRITICAL_COMMAND_WITHOUT_COMPENSATION')
  })

  it('valida decisões com ramos condicionais e uma saída padrão', () => {
    const workflow = validWorkflow()
    workflow.nodes = [
      workflow.nodes[0],
      {
        id: 'decision',
        key: 'decision',
        name: 'Classificar valor',
        type: 'decision',
        position: { x: 250, y: 0 },
        configuration: {},
      },
      {
        id: 'high',
        key: 'high',
        name: 'Alto valor',
        type: 'end',
        position: { x: 500, y: -100 },
        configuration: {},
      },
      {
        id: 'medium',
        key: 'medium',
        name: 'Médio valor',
        type: 'end',
        position: { x: 500, y: 0 },
        configuration: {},
      },
      {
        id: 'default',
        key: 'default',
        name: 'Valor padrão',
        type: 'end',
        position: { x: 500, y: 100 },
        configuration: {},
      },
    ]
    workflow.edges = [
      { id: 'start-decision', sourceNodeId: 'start', targetNodeId: 'decision', kind: 'success', sequence: 1 },
      {
        id: 'decision-high',
        sourceNodeId: 'decision',
        targetNodeId: 'high',
        kind: 'condition',
        sequence: 1,
        condition: { fact: 'travel.amount', operator: 'gt', value: 10_000 },
      },
      {
        id: 'decision-medium',
        sourceNodeId: 'decision',
        targetNodeId: 'medium',
        kind: 'condition',
        sequence: 2,
        condition: { fact: 'travel.amount', operator: 'gt', value: 5_000 },
      },
      { id: 'decision-default', sourceNodeId: 'decision', targetNodeId: 'default', kind: 'default', sequence: 3 },
    ]

    const validation = validateEnterpriseWorkflow(workflow)
    expect(validation.valid).toBe(true)
    const simulation = simulateEnterpriseWorkflow(workflow, { travel: { amount: 12_000 } })
    expect(simulation.valid).toBe(true)
    expect(simulation.reachedEnd).toBe(true)
    expect(simulation.visitedNodeIds).toEqual(['start', 'decision', 'high', 'medium'])
  })
})

describe('enterprise workflow simulation', () => {
  it('gera trilha determinística sem executar efeitos colaterais', () => {
    const result = simulateEnterpriseWorkflow(validWorkflow(), { subject: { id: 'demand-1' } })
    expect(result.valid).toBe(true)
    expect(result.reachedEnd).toBe(true)
    expect(result.steps.map((step) => step.nodeKey)).toEqual(['start', 'review', 'normalize', 'notify', 'end'])
    expect(result.steps.find((step) => step.nodeKey === 'review')?.outcome).toBe('waiting')
    expect(result.steps.find((step) => step.nodeKey === 'notify')?.explanation).toContain('catálogo de domínio')
  })
})

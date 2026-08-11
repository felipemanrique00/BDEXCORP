import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AIR_WORKFLOW_CODE,
  HOTEL_WORKFLOW_CODE,
  approvalActionsTargetWorkflow,
  canonicalJson,
  conditionTargetsOnlyService,
  constrainSelectionCondition,
  retargetApprovalActions,
  scopeSignature,
  selectionCondition,
  workflowApprovalSignature,
} from '../../scripts/lib/local-offline-approval-routing.mjs'

const source = readFileSync(resolve(process.cwd(), 'scripts/seed-local-offline-approval-routing.mjs'), 'utf8')

describe('local offline approval routing seed', () => {
  it('is guarded against remote or unintended databases', () => {
    expect(source).toContain("process.env.BDEX_ALLOW_LOCAL_APPROVAL_SEED !== '1'")
    expect(source).toContain('LOCAL_APPROVAL_SEED_PORT as LOCAL_PORT')
    expect(source).toContain('LOCAL_APPROVAL_SEED_DATABASE as LOCAL_DATABASE')
    expect(source).toContain("dataDirectory.includes('/.bdex-local-runtime/data')")
    expect(source).toContain('pg_advisory_xact_lock')
    expect(source).toContain("await client.query('begin')")
    expect(source).toContain("await client.query('commit')")
  })

  it('separates hotel and air policies by request service', () => {
    expect(conditionTargetsOnlyService(selectionCondition('hotelaria'), 'hotelaria')).toBe(true)
    expect(conditionTargetsOnlyService(selectionCondition('hotelaria'), 'aereo')).toBe(false)
    expect(conditionTargetsOnlyService(selectionCondition('aereo'), 'aereo')).toBe(true)
    expect(conditionTargetsOnlyService(selectionCondition('aereo'), 'hotelaria')).toBe(false)
    expect(source).toContain('assertFinalRouting')
  })

  it('creates immutable successors instead of rewriting published versions', () => {
    expect(source).toContain('const versionNumber = Number(source.version_number) + 1')
    expect(source).toContain("$1, $2, $3, $4, 'draft'")
    expect(source).toContain("set status = 'published'")
    expect(source).not.toMatch(/update policy_versions[\s\S]{0,240}condition_ast/i)
    expect(source).not.toMatch(/update approval_workflow_versions[\s\S]{0,240}graph_snapshot/i)
  })

  it('adds the service guard idempotently without dropping unrelated rules', () => {
    const legacy = {
      all: [
        { fact: 'operation.checkpoint', operator: 'eq', value: 'selection' },
        { fact: 'request.urgent', operator: 'eq', value: false },
        { fact: 'request.service', operator: 'eq', value: 'aereo' },
      ],
    }
    const once = constrainSelectionCondition(legacy, 'hotelaria')
    const twice = constrainSelectionCondition(once, 'hotelaria')

    expect(canonicalJson(twice)).toBe(canonicalJson(once))
    expect(conditionTargetsOnlyService(once, 'hotelaria')).toBe(true)
    expect(conditionTargetsOnlyService(once, 'aereo')).toBe(false)
    expect(JSON.stringify(once)).toContain('request.urgent')
  })

  it('retargets only approval actions and verifies their workflow dependency', () => {
    const base = [
      { type: 'notify', configuration: { channel: 'in_app' } },
      { type: 'request_approval', message: 'Aprovar', configuration: { workflow: HOTEL_WORKFLOW_CODE } },
    ]
    const air = retargetApprovalActions(base, AIR_WORKFLOW_CODE)

    expect(approvalActionsTargetWorkflow(air, AIR_WORKFLOW_CODE)).toBe(true)
    expect(approvalActionsTargetWorkflow(air, HOTEL_WORKFLOW_CODE)).toBe(false)
    expect(air[0]).toEqual(base[0])
  })

  it('compares workflow approvers and topology independently of generated ids and labels', () => {
    const hotel = workflowFixture('hotel-node', 'start-hotel', 'end-hotel', 'approver-1')
    const air = workflowFixture('air-node', 'start-air', 'end-air', 'approver-1')
    const approvalNode = air.nodes.find((node) => node.type === 'approval')
    const selector = approvalNode?.approverResolution?.selectors[0]
    if (!approvalNode || !selector) throw new Error('Fixture de aprovação inválido.')
    approvalNode.name = 'Autorização aérea'

    expect(workflowApprovalSignature(air)).toBe(workflowApprovalSignature(hotel))
    selector.value = 'approver-2'
    expect(workflowApprovalSignature(air)).not.toBe(workflowApprovalSignature(hotel))
  })

  it('compares cloned scopes independent of row order and database ids', () => {
    const sourceScopes = [
      { id: '1', scope_type: 'company', scope_id: 'company-a', mode: 'include', specificity: 80 },
      { id: '2', scope_type: 'group', scope_id: 'group-a', mode: 'exclude', specificity: 60 },
    ]
    const clonedScopes = [
      { id: 'new-2', scope_type: 'group', scope_id: 'group-a', mode: 'exclude', specificity: '60' },
      { id: 'new-1', scope_type: 'company', scope_id: 'company-a', mode: 'include', specificity: '80' },
    ]
    expect(scopeSignature(clonedScopes)).toBe(scopeSignature(sourceScopes))
  })
})

interface WorkflowFixture {
  nodes: Array<{
    id: string
    key: string
    name: string
    type: string
    approvalKind?: string
    completionMode?: string
    approverResolution?: {
      selectors: Array<{ type: string; value: string }>
      combination: string
      minimumApprovers: number
      maximumApprovers: number
    }
  }>
  edges: Array<{
    id: string
    sourceNodeId: string
    targetNodeId: string
    sequence: number
  }>
}

function workflowFixture(
  approvalId: string,
  startId: string,
  endId: string,
  approverId: string,
): WorkflowFixture {
  return {
    nodes: [
      { id: startId, key: 'start', name: 'Início', type: 'start' },
      {
        id: approvalId,
        key: 'cost-approval',
        name: 'Autorização',
        type: 'approval',
        approvalKind: 'cost',
        completionMode: 'all',
        approverResolution: {
          selectors: [{ type: 'person', value: approverId }],
          combination: 'all',
          minimumApprovers: 1,
          maximumApprovers: 1,
        },
      },
      { id: endId, key: 'end', name: 'Fim', type: 'end' },
    ],
    edges: [
      { id: `edge-${startId}`, sourceNodeId: startId, targetNodeId: approvalId, sequence: 0 },
      { id: `edge-${endId}`, sourceNodeId: approvalId, targetNodeId: endId, sequence: 0 },
    ],
  }
}

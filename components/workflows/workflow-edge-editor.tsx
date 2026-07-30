'use client'

import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import type {
  EnterpriseWorkflowEdge,
  EnterpriseWorkflowEdgeKind,
  EnterpriseWorkflowNode,
} from '@/lib/workflows/types'

const EDGE_KINDS: Array<{ value: EnterpriseWorkflowEdgeKind; label: string }> = [
  { value: 'success', label: 'Sucesso' },
  { value: 'condition', label: 'Condição' },
  { value: 'default', label: 'Padrão' },
  { value: 'failure', label: 'Falha' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'parallel', label: 'Paralela' },
  { value: 'compensation', label: 'Compensação' },
]

interface WorkflowEdgeEditorProps {
  nodes: EnterpriseWorkflowNode[]
  edges: EnterpriseWorkflowEdge[]
  readOnly?: boolean
  onChange: (edges: EnterpriseWorkflowEdge[]) => void
}

export function WorkflowEdgeEditor({
  nodes,
  edges,
  readOnly = false,
  onChange,
}: WorkflowEdgeEditorProps) {
  const [sourceNodeId, setSourceNodeId] = useState('')
  const [targetNodeId, setTargetNodeId] = useState('')
  const [kind, setKind] = useState<EnterpriseWorkflowEdgeKind>('success')
  const [label, setLabel] = useState('')
  const [fact, setFact] = useState('')
  const [operator, setOperator] = useState<'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists'>('eq')
  const [expected, setExpected] = useState('')
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  function addEdge() {
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return
    const condition = kind === 'condition'
      ? {
          fact: fact.trim(),
          operator,
          ...(operator === 'exists' ? {} : { value: parseConditionValue(expected) }),
        }
      : undefined
    if (kind === 'condition' && !fact.trim()) return
    const sequence = Math.max(
      0,
      ...edges.filter((edge) => edge.sourceNodeId === sourceNodeId).map((edge) => edge.sequence),
    ) + 1
    onChange([
      ...edges,
      {
        id: `edge-${crypto.randomUUID()}`,
        sourceNodeId,
        targetNodeId,
        kind,
        sequence,
        label: label.trim() || undefined,
        condition,
      },
    ])
    setTargetNodeId('')
    setLabel('')
    setFact('')
    setExpected('')
  }

  return (
    <section className="space-y-3" aria-labelledby="workflow-connections-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Conexões</p>
          <h3 id="workflow-connections-title" className="text-sm font-bold text-bbt-primary dark:text-white">
            Caminhos do processo
          </h3>
        </div>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {edges.length}
        </span>
      </div>

      {!readOnly && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <select
              value={sourceNodeId}
              onChange={(event) => setSourceNodeId(event.target.value)}
              className="bbt-input w-full text-xs"
              aria-label="Nó de origem"
            >
              <option value="">Origem</option>
              {nodes.filter((node) => node.type !== 'end').map((node) => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
            <ArrowRight className="mx-auto hidden h-4 w-4 text-slate-400 sm:block" />
            <select
              value={targetNodeId}
              onChange={(event) => setTargetNodeId(event.target.value)}
              className="bbt-input w-full text-xs"
              aria-label="Nó de destino"
            >
              <option value="">Destino</option>
              {nodes.filter((node) => node.id !== sourceNodeId && node.type !== 'start').map((node) => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as EnterpriseWorkflowEdgeKind)}
              className="bbt-input w-full text-xs"
              aria-label="Tipo de conexão"
            >
              {EDGE_KINDS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="bbt-input w-full text-xs"
              placeholder="Rótulo opcional"
              maxLength={240}
            />
          </div>
          {kind === 'condition' && (
            <div className="grid gap-2 sm:grid-cols-[1.4fr_0.8fr_1fr]">
              <input
                value={fact}
                onChange={(event) => setFact(event.target.value)}
                className="bbt-input w-full font-mono text-xs"
                placeholder="Fato: finance.totalAmount"
              />
              <select
                value={operator}
                onChange={(event) => setOperator(event.target.value as typeof operator)}
                className="bbt-input w-full text-xs"
                aria-label="Operador da condição"
              >
                <option value="eq">Igual</option>
                <option value="neq">Diferente</option>
                <option value="gt">Maior que</option>
                <option value="gte">Maior ou igual</option>
                <option value="lt">Menor que</option>
                <option value="lte">Menor ou igual</option>
                <option value="contains">Contém</option>
                <option value="exists">Existe</option>
              </select>
              <input
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
                className="bbt-input w-full text-xs"
                placeholder={operator === 'exists' ? 'Sem valor' : 'Valor esperado'}
                disabled={operator === 'exists'}
              />
            </div>
          )}
          <button
            type="button"
            className="bbt-button-outline w-full justify-center text-xs"
            onClick={addEdge}
            disabled={!sourceNodeId || !targetNodeId || (kind === 'condition' && !fact.trim())}
          >
            <Plus className="h-4 w-4" />
            Adicionar conexão
          </button>
        </div>
      )}

      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {edges.map((edge) => (
          <div
            key={edge.id}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <span className="min-w-0 flex-1 truncate font-semibold">
              {nodesById.get(edge.sourceNodeId)?.name || 'Origem ausente'}
            </span>
            <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {EDGE_KINDS.find((item) => item.value === edge.kind)?.label}
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {nodesById.get(edge.targetNodeId)?.name || 'Destino ausente'}
            </span>
            {!readOnly && (
              <button
                type="button"
                className="h-8 w-8 shrink-0 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                onClick={() => onChange(edges.filter((item) => item.id !== edge.id))}
                title="Excluir conexão"
                aria-label="Excluir conexão"
              >
                <Trash2 className="mx-auto h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {!edges.length && (
          <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">
            Nenhuma conexão configurada.
          </p>
        )}
      </div>
    </section>
  )
}

function parseConditionValue(value: string): unknown {
  const normalized = value.trim()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  if (normalized !== '' && Number.isFinite(Number(normalized))) return Number(normalized)
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    try {
      const parsed = JSON.parse(normalized)
      if (Array.isArray(parsed)) return parsed
    } catch {
      return normalized
    }
  }
  return normalized
}

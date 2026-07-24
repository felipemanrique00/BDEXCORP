'use client'

import {
  ArrowRight,
  CheckCircle2,
  GitCompare,
  History,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { GovernanceClientError } from '@/lib/governance-client'
import {
  fetchEnterpriseWorkflowVersion,
  restoreEnterpriseWorkflowVersion,
  type EnterpriseWorkflowDetail,
} from '@/lib/workflows/client'
import type { EnterpriseWorkflowGraph } from '@/lib/workflows/types'

interface WorkflowVersionHistoryProps {
  workflow: EnterpriseWorkflowDetail
  canManage: boolean
  onWorkflowChange: (workflow: EnterpriseWorkflowDetail) => void
}

interface VersionComparison {
  left: EnterpriseWorkflowGraph
  right: EnterpriseWorkflowGraph
  addedNodes: string[]
  removedNodes: string[]
  changedNodes: string[]
  addedEdges: number
  removedEdges: number
}

export function WorkflowVersionHistory({
  workflow,
  canManage,
  onWorkflowChange,
}: WorkflowVersionHistoryProps) {
  const [leftVersionId, setLeftVersionId] = useState(workflow.versions[1]?.id || workflow.versions[0]?.id || '')
  const [rightVersionId, setRightVersionId] = useState(workflow.versions[0]?.id || '')
  const [comparison, setComparison] = useState<VersionComparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreReason, setRestoreReason] = useState('')
  const versions = useMemo(
    () => [...workflow.versions].sort((left, right) => right.version - left.version),
    [workflow.versions],
  )

  async function compare() {
    if (!leftVersionId || !rightVersionId || leftVersionId === rightVersionId) {
      toast.error('Selecione duas versões diferentes.')
      return
    }
    setLoading(true)
    try {
      const [left, right] = await Promise.all([
        fetchEnterpriseWorkflowVersion(workflow.id, leftVersionId),
        fetchEnterpriseWorkflowVersion(workflow.id, rightVersionId),
      ])
      setComparison(compareGraphs(left.graph, right.graph))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  async function restore() {
    if (!restoringId) return
    if (restoreReason.trim().length < 10) {
      toast.error('Informe o motivo da restauração com pelo menos 10 caracteres.')
      return
    }
    setLoading(true)
    try {
      const updated = await restoreEnterpriseWorkflowVersion(workflow.id, {
        versionId: restoringId,
        expectedCurrentVersion: workflow.currentVersion,
        reason: restoreReason.trim(),
      })
      onWorkflowChange(updated)
      setRestoringId(null)
      setRestoreReason('')
      setComparison(null)
      toast.success('A versão foi restaurada como um novo rascunho auditado.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="bbt-card overflow-hidden" aria-labelledby="workflow-version-history-title">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 id="workflow-version-history-title" className="flex items-center gap-2 text-sm font-bold text-bbt-primary dark:text-white">
            <History className="h-4 w-4 text-bbt-accent" />
            Histórico imutável
          </h3>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {versions.map((version) => (
            <article key={version.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm font-bold text-bbt-primary dark:bg-slate-800 dark:text-white">
                v{version.version}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-slate-900 dark:text-white">{version.changeSummary}</strong>
                  <StatusBadge status={version.status} />
                  {version.source === 'ai_draft' && (
                    <span className="rounded bg-cyan-50 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200">
                      Rascunho de IA
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(version.createdAt)} · hash {version.contentHash.slice(0, 12)}
                </p>
              </div>
              {canManage && version.version !== workflow.currentVersion && (
                <button
                  type="button"
                  className="bbt-button-outline text-xs"
                  onClick={() => {
                    setRestoringId(version.id)
                    setRestoreReason('')
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  Restaurar
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <aside className="space-y-4">
        <section className="bbt-card space-y-3 p-4" aria-labelledby="workflow-version-compare-title">
          <h3 id="workflow-version-compare-title" className="flex items-center gap-2 text-sm font-bold text-bbt-primary dark:text-white">
            <GitCompare className="h-4 w-4 text-bbt-accent" />
            Comparar versões
          </h3>
          <select
            value={leftVersionId}
            onChange={(event) => setLeftVersionId(event.target.value)}
            className="bbt-input w-full text-xs"
            aria-label="Versão de origem"
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>v{version.version} · {version.status}</option>
            ))}
          </select>
          <div className="flex items-center justify-center">
            <ArrowRight className="h-4 w-4 rotate-90 text-slate-400" />
          </div>
          <select
            value={rightVersionId}
            onChange={(event) => setRightVersionId(event.target.value)}
            className="bbt-input w-full text-xs"
            aria-label="Versão de destino"
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>v{version.version} · {version.status}</option>
            ))}
          </select>
          <button
            type="button"
            className="bbt-button-primary w-full justify-center text-xs"
            onClick={() => void compare()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
            Comparar
          </button>
        </section>

        {comparison && (
          <section className="bbt-card space-y-3 p-4" aria-live="polite">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-bbt-primary dark:text-white">Diferenças</h3>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <ComparisonRow label="Nós adicionados" value={comparison.addedNodes.length} />
            <ComparisonRow label="Nós removidos" value={comparison.removedNodes.length} />
            <ComparisonRow label="Nós alterados" value={comparison.changedNodes.length} />
            <ComparisonRow label="Conexões adicionadas" value={comparison.addedEdges} />
            <ComparisonRow label="Conexões removidas" value={comparison.removedEdges} />
            {!!comparison.changedNodes.length && (
              <p className="rounded bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                {comparison.changedNodes.join(', ')}
              </p>
            )}
          </section>
        )}
      </aside>

      {restoringId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true">
          <div className="bbt-card w-full max-w-lg space-y-4 p-5">
            <div>
              <h2 className="text-lg font-bold text-bbt-primary dark:text-white">Restaurar versão</h2>
              <p className="mt-1 text-sm text-slate-500">
                O histórico não será reescrito. O sistema criará uma nova versão de rascunho.
              </p>
            </div>
            <label className="block text-xs font-semibold uppercase text-slate-500">
              Motivo
              <textarea
                value={restoreReason}
                onChange={(event) => setRestoreReason(event.target.value)}
                className="bbt-input mt-1 min-h-24 w-full resize-y normal-case"
                placeholder="Descreva por que esta versão deve ser recuperada."
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="bbt-button-ghost" onClick={() => setRestoringId(null)} disabled={loading}>
                Cancelar
              </button>
              <button type="button" className="bbt-button-primary" onClick={() => void restore()} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Criar versão restaurada
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function compareGraphs(left: EnterpriseWorkflowGraph, right: EnterpriseWorkflowGraph): VersionComparison {
  const leftNodes = new Map(left.nodes.map((node) => [node.key, node]))
  const rightNodes = new Map(right.nodes.map((node) => [node.key, node]))
  const addedNodes = [...rightNodes.keys()].filter((key) => !leftNodes.has(key))
  const removedNodes = [...leftNodes.keys()].filter((key) => !rightNodes.has(key))
  const changedNodes = [...rightNodes.entries()]
    .filter(([key, node]) => leftNodes.has(key) && stableJson(leftNodes.get(key)) !== stableJson(node))
    .map(([key]) => key)
  const leftEdges = new Set(left.edges.map(edgeIdentity))
  const rightEdges = new Set(right.edges.map(edgeIdentity))
  return {
    left,
    right,
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges: [...rightEdges].filter((edge) => !leftEdges.has(edge)).length,
    removedEdges: [...leftEdges].filter((edge) => !rightEdges.has(edge)).length,
  }
}

function edgeIdentity(edge: EnterpriseWorkflowGraph['edges'][number]): string {
  return [
    edge.sourceNodeId,
    edge.targetNodeId,
    edge.kind,
    edge.label || '',
    stableJson(edge.condition || null),
  ].join('|')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function ComparisonRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs last:border-0 dark:border-slate-800">
      <span className="text-slate-500">{label}</span>
      <strong className="text-slate-900 dark:text-white">{value}</strong>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'published'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
    : status === 'in_review' || status === 'approved'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>{status}</span>
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError) return error.message
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

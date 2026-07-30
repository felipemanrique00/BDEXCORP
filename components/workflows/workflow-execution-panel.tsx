'use client'

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  Clock3,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { GovernanceClientError } from '@/lib/governance-client'
import {
  completeEnterpriseWorkflowStep,
  fetchEnterpriseWorkflowExecution,
  fetchEnterpriseWorkflowExecutions,
  reprocessEnterpriseWorkflowStep,
  startEnterpriseWorkflow,
  type EnterpriseWorkflowDetail,
  type EnterpriseWorkflowExecutionDetail,
  type EnterpriseWorkflowExecutionSummary,
} from '@/lib/workflows/client'

interface WorkflowExecutionPanelProps {
  workflow: EnterpriseWorkflowDetail
  companies: Array<{ id: string; name: string }>
  canExecute: boolean
}

interface FactRow {
  id: string
  key: string
  value: string
}

const EXECUTION_STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  running: 'Em execução',
  waiting: 'Aguardando',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
}

export function WorkflowExecutionPanel({
  workflow,
  companies,
  canExecute,
}: WorkflowExecutionPanelProps) {
  const [executions, setExecutions] = useState<EnterpriseWorkflowExecutionSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selected, setSelected] = useState<EnterpriseWorkflowExecutionDetail | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [showStart, setShowStart] = useState(false)
  const [companyId, setCompanyId] = useState(companies[0]?.id || '')
  const [subjectType, setSubjectType] = useState<'demand' | 'reservation' | 'employee' | 'company' | 'integration' | 'workflow_execution' | 'generic'>('generic')
  const [subjectId, setSubjectId] = useState('')
  const [facts, setFacts] = useState<FactRow[]>([{ id: crypto.randomUUID(), key: '', value: '' }])
  const [starting, setStarting] = useState(false)
  const [stepNodeKey, setStepNodeKey] = useState('')
  const [stepOutcome, setStepOutcome] = useState<'completed' | 'approved' | 'rejected' | 'failed' | 'timeout'>('completed')
  const [stepReason, setStepReason] = useState('')
  const [processingStep, setProcessingStep] = useState(false)

  const loadExecutions = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchEnterpriseWorkflowExecutions({
        workflowId: workflow.id,
        status: statusFilter ? statusFilter as EnterpriseWorkflowExecutionSummary['status'] : undefined,
        limit: 100,
      })
      setExecutions(result.items)
      setTotal(result.total)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [statusFilter, workflow.id])

  useEffect(() => {
    void loadExecutions()
  }, [loadExecutions])

  useEffect(() => {
    if (!companyId && companies[0]) setCompanyId(companies[0].id)
  }, [companies, companyId])

  const waitingSteps = useMemo(
    () => selected?.steps.filter((step) => step.status === 'waiting') || [],
    [selected],
  )
  const failedSteps = useMemo(
    () => selected?.steps.filter((step) => step.status === 'failed') || [],
    [selected],
  )

  async function openExecution(executionId: string) {
    setDetailLoading(true)
    try {
      const detail = await fetchEnterpriseWorkflowExecution(executionId)
      setSelected(detail)
      const firstWaiting = detail.steps.find((step) => step.status === 'waiting')
      setStepNodeKey(firstWaiting?.nodeKey || '')
      setStepOutcome(firstWaiting?.nodeType === 'approval' ? 'approved' : 'completed')
      setStepReason('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDetailLoading(false)
    }
  }

  async function startExecution() {
    if (!companyId || !subjectId.trim()) {
      toast.error('Informe a empresa e o identificador do registro.')
      return
    }
    setStarting(true)
    try {
      const execution = await startEnterpriseWorkflow(workflow.id, {
        companyId,
        subjectType,
        subjectId: subjectId.trim(),
        facts: factObject(facts),
        idempotencyKey: `ui:${workflow.id}:${crypto.randomUUID()}`,
      })
      setSelected(execution)
      setShowStart(false)
      setSubjectId('')
      setFacts([{ id: crypto.randomUUID(), key: '', value: '' }])
      await loadExecutions()
      toast.success('Execução iniciada de forma transacional.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setStarting(false)
    }
  }

  async function completeStep() {
    if (!selected || !stepNodeKey || stepReason.trim().length < 3) {
      toast.error('Selecione a etapa e informe o motivo.')
      return
    }
    setProcessingStep(true)
    try {
      const execution = await completeEnterpriseWorkflowStep(selected.id, {
        nodeKey: stepNodeKey,
        outcome: stepOutcome,
        output: {},
        reason: stepReason.trim(),
        idempotencyKey: `ui-step:${selected.id}:${stepNodeKey}:${crypto.randomUUID()}`,
      })
      setSelected(execution)
      const nextWaiting = execution.steps.find((step) => step.status === 'waiting')
      setStepNodeKey(nextWaiting?.nodeKey || '')
      setStepOutcome(nextWaiting?.nodeType === 'approval' ? 'approved' : 'completed')
      setStepReason('')
      await loadExecutions()
      toast.success('Etapa concluída e registrada na trilha de eventos.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setProcessingStep(false)
    }
  }

  async function reprocessStep(nodeKey: string) {
    if (!selected) return
    const reason = window.prompt('Informe o motivo do reprocessamento seguro:')
    if (!reason || reason.trim().length < 10) {
      toast.error('O motivo precisa ter pelo menos 10 caracteres.')
      return
    }
    setProcessingStep(true)
    try {
      const execution = await reprocessEnterpriseWorkflowStep(selected.id, {
        nodeKey,
        reason: reason.trim(),
        idempotencyKey: `ui-reprocess:${selected.id}:${nodeKey}:${crypto.randomUUID()}`,
      })
      setSelected(execution)
      await loadExecutions()
      toast.success('Nova tentativa criada sem sobrescrever o histórico.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setProcessingStep(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
      <section className="bbt-card overflow-hidden" aria-labelledby="workflow-executions-title">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
          <div>
            <h3 id="workflow-executions-title" className="flex items-center gap-2 text-sm font-bold text-bbt-primary dark:text-white">
              <Activity className="h-4 w-4 text-bbt-accent" />
              Execuções
            </h3>
            <p className="mt-1 text-xs text-slate-500">{total} execução(ões) encontrada(s)</p>
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="bbt-input min-w-36 text-xs"
              aria-label="Filtrar execução por status"
            >
              <option value="">Todos os status</option>
              {Object.entries(EXECUTION_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button
              type="button"
              className="bbt-button-ghost h-10 w-10 justify-center p-0"
              onClick={() => void loadExecutions()}
              title="Atualizar execuções"
              aria-label="Atualizar execuções"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {canExecute && workflow.status === 'published' && (
              <button type="button" className="bbt-button-primary" onClick={() => setShowStart(true)}>
                <Play className="h-4 w-4" />
                Executar
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[42rem] divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
          {loading && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando execuções
            </div>
          )}
          {!loading && executions.map((execution) => (
            <button
              key={execution.id}
              type="button"
              className={`flex w-full items-center gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900 ${
                selected?.id === execution.id ? 'bg-cyan-50/60 dark:bg-cyan-950/20' : ''
              }`}
              onClick={() => void openExecution(execution.id)}
            >
              <ExecutionStatusIcon status={execution.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">
                  {execution.subjectType} · {execution.subjectId}
                </span>
                <span className="mt-1 block truncate text-xs text-slate-500">
                  {execution.companyName} · {formatDateTime(execution.startedAt)}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[10px] font-bold uppercase text-slate-500">
                  {EXECUTION_STATUS_LABEL[execution.status]}
                </span>
                {!!execution.activeNodeKeys.length && (
                  <span className="mt-1 block text-[10px] text-slate-400">
                    {execution.activeNodeKeys.length} ativa(s)
                  </span>
                )}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          ))}
          {!loading && !executions.length && (
            <div className="p-10 text-center text-sm text-slate-500">
              Nenhuma execução foi iniciada para este workflow.
            </div>
          )}
        </div>
      </section>

      <section className="bbt-card min-w-0 overflow-hidden" aria-labelledby="workflow-execution-detail-title">
        {detailLoading && (
          <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando histórico
          </div>
        )}
        {!detailLoading && !selected && (
          <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center">
            <Clock3 className="h-8 w-8 text-slate-300" />
            <h3 className="mt-3 text-sm font-bold text-bbt-primary dark:text-white">Histórico passo a passo</h3>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              Selecione uma execução para inspecionar etapas, comandos, erros e eventos auditáveis.
            </p>
          </div>
        )}
        {!detailLoading && selected && (
          <div>
            <div className="border-b border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Execução</p>
                  <h3 id="workflow-execution-detail-title" className="mt-1 text-base font-bold text-bbt-primary dark:text-white">
                    {selected.subjectType} · {selected.subjectId}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">{selected.companyName}</p>
                </div>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {EXECUTION_STATUS_LABEL[selected.status]}
                </span>
              </div>
              {selected.lastErrorMessage && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span><strong>{selected.lastErrorCode}</strong><br />{selected.lastErrorMessage}</span>
                </div>
              )}
            </div>

            {canExecute && waitingSteps.length > 0 && (
              <div className="space-y-3 border-b border-slate-200 bg-cyan-50/50 p-4 dark:border-slate-700 dark:bg-cyan-950/10">
                <h4 className="text-xs font-bold uppercase text-cyan-900 dark:text-cyan-200">Concluir etapa pendente</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={stepNodeKey}
                    onChange={(event) => {
                      setStepNodeKey(event.target.value)
                      const step = waitingSteps.find((item) => item.nodeKey === event.target.value)
                      setStepOutcome(step?.nodeType === 'approval' ? 'approved' : 'completed')
                    }}
                    className="bbt-input w-full text-xs"
                    aria-label="Etapa pendente"
                  >
                    {waitingSteps.map((step) => (
                      <option key={step.id} value={step.nodeKey}>{step.nodeName}</option>
                    ))}
                  </select>
                  <select
                    value={stepOutcome}
                    onChange={(event) => setStepOutcome(event.target.value as typeof stepOutcome)}
                    className="bbt-input w-full text-xs"
                    aria-label="Resultado da etapa"
                  >
                    <option value="completed">Concluída</option>
                    <option value="approved">Aprovada</option>
                    <option value="rejected">Rejeitada</option>
                    <option value="failed">Falhou</option>
                    <option value="timeout">Expirou</option>
                  </select>
                </div>
                <input
                  value={stepReason}
                  onChange={(event) => setStepReason(event.target.value)}
                  className="bbt-input w-full text-xs"
                  placeholder="Motivo ou observação da conclusão"
                />
                <button
                  type="button"
                  className="bbt-button-primary w-full justify-center text-xs"
                  onClick={() => void completeStep()}
                  disabled={processingStep}
                >
                  {processingStep ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Confirmar etapa
                </button>
              </div>
            )}

            <div className="max-h-[36rem] overflow-auto p-4">
              <ol className="relative space-y-3 border-l border-slate-200 pl-5 dark:border-slate-700">
                {selected.steps.map((step) => (
                  <li key={step.id} className="relative">
                    <span className="absolute -left-[1.61rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-slate-400 dark:border-slate-900" />
                    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <strong className="text-sm text-slate-900 dark:text-white">{step.nodeName}</strong>
                          <p className="mt-1 font-mono text-[10px] text-slate-500">
                            {step.nodeKey} · tentativa {step.attempt}
                          </p>
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {step.status}
                        </span>
                      </div>
                      {step.errorMessage && (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-300">{step.errorMessage}</p>
                      )}
                      {canExecute && step.status === 'failed' && (
                        <button
                          type="button"
                          className="bbt-button-outline mt-3 text-xs"
                          onClick={() => void reprocessStep(step.nodeKey)}
                          disabled={processingStep}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reprocessar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              <details className="mt-4 rounded-md border border-slate-200 dark:border-slate-700">
                <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-bbt-primary dark:text-white">
                  Eventos auditáveis ({selected.events.length})
                </summary>
                <div className="max-h-56 divide-y divide-slate-100 overflow-auto border-t border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                  {selected.events.map((event) => (
                    <div key={event.id} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-slate-800 dark:text-slate-100">{event.type}</strong>
                        <span className="text-slate-400">#{event.sequence}</span>
                      </div>
                      <p className="mt-1 text-slate-500">{formatDateTime(event.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )}
      </section>

      {showStart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true">
          <div className="bbt-card max-h-[90vh] w-full max-w-2xl overflow-auto p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-bbt-primary dark:text-white">Iniciar execução</h2>
                <p className="mt-1 text-sm text-slate-500">
                  A empresa e o registro serão validados novamente pelo servidor.
                </p>
              </div>
              <button
                type="button"
                className="bbt-button-ghost h-9 w-9 justify-center p-0"
                onClick={() => setShowStart(false)}
                title="Fechar"
                aria-label="Fechar"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold uppercase text-slate-500">
                Empresa
                <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="bbt-input mt-1 w-full normal-case">
                  <option value="">Selecione</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase text-slate-500">
                Tipo do registro
                <select value={subjectType} onChange={(event) => setSubjectType(event.target.value as typeof subjectType)} className="bbt-input mt-1 w-full normal-case">
                  <option value="demand">Demanda</option>
                  <option value="reservation">Reserva</option>
                  <option value="employee">Funcionário</option>
                  <option value="company">Empresa</option>
                  <option value="integration">Integração</option>
                  <option value="workflow_execution">Outra execução</option>
                  <option value="generic">Processo genérico</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase text-slate-500 sm:col-span-2">
                ID do registro
                <input value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="bbt-input mt-1 w-full normal-case" />
              </label>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-bbt-primary dark:text-white">Dados de entrada</h3>
                  <p className="text-xs text-slate-500">Fatos utilizados em condições e decisões.</p>
                </div>
                <button
                  type="button"
                  className="bbt-button-outline text-xs"
                  onClick={() => setFacts([...facts, { id: crypto.randomUUID(), key: '', value: '' }])}
                >
                  <CirclePlus className="h-4 w-4" />
                  Campo
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {facts.map((fact) => (
                  <div key={fact.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      value={fact.key}
                      onChange={(event) => setFacts(facts.map((item) => item.id === fact.id ? { ...item, key: event.target.value } : item))}
                      className="bbt-input w-full font-mono text-xs"
                      placeholder="finance.totalAmount"
                    />
                    <input
                      value={fact.value}
                      onChange={(event) => setFacts(facts.map((item) => item.id === fact.id ? { ...item, value: event.target.value } : item))}
                      className="bbt-input w-full text-xs"
                      placeholder="Valor"
                    />
                    <button
                      type="button"
                      className="bbt-button-ghost h-10 w-10 justify-center p-0 text-red-600"
                      onClick={() => setFacts(facts.filter((item) => item.id !== fact.id))}
                      title="Remover campo"
                      aria-label="Remover campo"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="bbt-button-ghost" onClick={() => setShowStart(false)} disabled={starting}>
                Cancelar
              </button>
              <button type="button" className="bbt-button-primary" onClick={() => void startExecution()} disabled={starting}>
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Iniciar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ExecutionStatusIcon({ status }: { status: EnterpriseWorkflowExecutionSummary['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
  if (status === 'failed') return <XCircle className="h-5 w-5 shrink-0 text-red-600" />
  if (status === 'waiting') return <Clock3 className="h-5 w-5 shrink-0 text-amber-600" />
  return <Activity className="h-5 w-5 shrink-0 text-blue-600" />
}

function factObject(rows: FactRow[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  rows.forEach((row) => {
    const path = row.key.trim()
    if (!path) return
    setPath(result, path, parseScalar(row.value))
  })
  return result
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean)
  let current = target
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value
      return
    }
    const child = current[segment]
    if (!child || typeof child !== 'object' || Array.isArray(child)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  })
}

function parseScalar(value: string): unknown {
  const normalized = value.trim()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  if (normalized === 'null') return null
  if (normalized !== '' && Number.isFinite(Number(normalized))) return Number(normalized)
  return normalized
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

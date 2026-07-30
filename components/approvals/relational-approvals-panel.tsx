'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Search,
  ShieldCheck,
  TimerOff,
  X,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  decideApproval,
  fetchApprovalInstance,
  fetchApprovalInstances,
  type ApprovalAssignmentDetail,
  type ApprovalInstanceDetail,
  type ApprovalInstanceSummary,
} from '@/lib/approvals/client'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { GovernanceClientError } from '@/lib/governance-client'
import { formatCurrency } from '@/lib/utils'
import type { User } from '@/types'

type QueueFilter = 'pending' | 'mine' | 'overdue' | 'all'
type Decision = 'approved' | 'rejected'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  failed: 'Falha',
  superseded: 'Substituída',
}

export function RelationalApprovalsPanel({ refreshToken }: { refreshToken: number }) {
  const [user, setUser] = useState<User | null>(null)
  const [items, setItems] = useState<ApprovalInstanceSummary[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<QueueFilter>('pending')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ApprovalInstanceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [reason, setReason] = useState('')
  const [deciding, setDeciding] = useState(false)

  useEffect(() => setUser(getCurrentUser()), [])
  const canDecide = hasPermission(user, 'decidir_aprovacoes')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchApprovalInstances({ limit: 200 })
      setItems(result.items)
      setTotal(result.total)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshToken
    void load()
  }, [load, refreshToken])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return items.filter((item) => {
      if (filter === 'pending' && !['pending', 'in_progress'].includes(item.status)) return false
      if (filter === 'mine' && (!item.assignedToMe || !['pending', 'in_progress'].includes(item.status))) return false
      if (filter === 'overdue' && item.overdueSteps < 1) return false
      if (!query) return true
      return `${item.workflowName} ${item.companyName} ${item.demandId || ''} ${item.reservationId || ''}`
        .toLocaleLowerCase('pt-BR')
        .includes(query)
    })
  }, [filter, items, search])

  const metrics = useMemo(() => ({
    pending: items.filter((item) => ['pending', 'in_progress'].includes(item.status)).length,
    mine: items.filter((item) => item.assignedToMe && ['pending', 'in_progress'].includes(item.status)).length,
    overdue: items.filter((item) => item.overdueSteps > 0).length,
    approved: items.filter((item) => item.status === 'approved').length,
  }), [items])

  async function openInstance(instanceId: string) {
    setDetailLoading(true)
    try {
      setSelected(await fetchApprovalInstance(instanceId))
      setDecision(null)
      setReason('')
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setDetailLoading(false)
    }
  }

  const pendingAssignment = useMemo(
    () => findPendingAssignment(selected, user?.id || null),
    [selected, user?.id],
  )

  async function submitDecision() {
    if (!selected || !pendingAssignment || !decision) return
    if (reason.trim().length < 3) {
      toast.error('Informe o motivo da decisão com pelo menos 3 caracteres.')
      return
    }
    const chosenDecision = decision
    setDeciding(true)
    try {
      const updated = await decideApproval(pendingAssignment.assignment.id, {
        decision: chosenDecision,
        reason: reason.trim(),
        expectedStepVersion: pendingAssignment.stepVersion,
        idempotencyKey: decisionKey(
          pendingAssignment.assignment.id,
          pendingAssignment.stepVersion,
          chosenDecision,
          reason.trim(),
        ),
        confirmation: true,
      })
      setSelected(updated)
      setDecision(null)
      setReason('')
      await load()
      toast.success(chosenDecision === 'approved' ? 'Aprovação registrada.' : 'Rejeição registrada.')
    } catch (requestError) {
      toast.error(errorMessage(requestError))
      if (requestError instanceof GovernanceClientError && requestError.status === 409) {
        try {
          setSelected(await fetchApprovalInstance(selected.id))
          await load()
        } catch {
          // O erro principal já foi exibido; a próxima atualização fará a reconciliação.
        }
      }
    } finally {
      setDeciding(false)
    }
  }

  if (loading) return <LoadingState label="Carregando fila de aprovações" />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <section className="space-y-4" aria-labelledby="approval-queue-title">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={Clock3} label="Pendentes" value={metrics.pending} tone="amber" />
        <Metric icon={ShieldCheck} label="Atribuídas a mim" value={metrics.mine} tone="blue" />
        <Metric icon={TimerOff} label="SLA vencido" value={metrics.overdue} tone="red" />
        <Metric icon={CheckCircle2} label="Aprovadas na consulta" value={metrics.approved} tone="green" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="bbt-tabs w-fit max-w-full overflow-x-auto">
          {([
            ['pending', 'Pendentes'],
            ['mine', 'Para mim'],
            ['overdue', 'Vencidas'],
            ['all', 'Todas'],
          ] as Array<[QueueFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`bbt-tab ${filter === value ? 'bbt-tab-active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex min-w-0 items-center rounded-md border border-bbt-gray-100 bg-white px-3 dark:border-slate-700 dark:bg-slate-900 lg:w-80">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="sr-only">Buscar aprovações</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
            placeholder="Empresa, workflow ou demanda"
          />
        </label>
      </div>

      <div className="flex items-center justify-between text-sm">
        <h2 id="approval-queue-title" className="font-semibold text-bbt-primary dark:text-white">Fila governada</h2>
        <span className="text-slate-500">{filtered.length} exibida(s) de {total}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openInstance(item.id)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-4 text-left transition hover:bg-bbt-gray-50 dark:hover:bg-slate-800/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    {item.assignedToMe && (
                      <span className="bbt-badge bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Para mim</span>
                    )}
                    {item.overdueSteps > 0 && (
                      <span className="bbt-badge bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        {item.overdueSteps} etapa(s) vencida(s)
                      </span>
                    )}
                  </div>
                  <div className="mt-2 truncate font-semibold text-bbt-primary dark:text-white">
                    {item.companyName} <span className="font-normal text-slate-400">·</span> {item.workflowName}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span>{formatDateTime(item.startedAt)}</span>
                    {item.demandId && <span>Demanda {item.demandId.slice(-10)}</span>}
                    {item.reservationId && <span>Reserva {item.reservationId.slice(-10)}</span>}
                    <span>{item.pendingSteps} etapa(s) pendente(s)</span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => !deciding && setSelected(null)}>
          <aside
            className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-950 sm:p-6"
            onClick={(event) => event.stopPropagation()}
            aria-label="Detalhes da aprovação"
          >
            {detailLoading && !selected ? (
              <LoadingState label="Carregando aprovação" />
            ) : selected ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={selected.status} />
                      {selected.overdueSteps > 0 && (
                        <span className="bbt-badge bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">SLA vencido</span>
                      )}
                    </div>
                    <h2 className="mt-2 text-xl font-bold text-bbt-primary dark:text-white">{selected.workflowName}</h2>
                    <p className="mt-1 text-sm text-slate-500">{selected.companyName}</p>
                  </div>
                  <button type="button" className="bbt-button-ghost p-2" onClick={() => setSelected(null)} aria-label="Fechar">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <dl className="grid gap-3 border-y border-bbt-gray-100 py-4 text-sm dark:border-slate-800 sm:grid-cols-2">
                  <Detail label="Iniciada em" value={formatDateTime(selected.startedAt)} />
                  <Detail label="Tipo" value={selected.type} />
                  <Detail label="Demanda" value={selected.demandId || '—'} />
                  <Detail label="Reserva" value={selected.reservationId || '—'} />
                  <Detail label="Viajante" value={selected.employeeId || '—'} />
                  <Detail label="Versão da instância" value={String(selected.version)} />
                </dl>

                {selected.demandId && (
                  <Link href={`/dashboard/demandas?focus=${encodeURIComponent(selected.demandId)}`} className="bbt-button-ghost w-fit">
                    <FileText className="h-4 w-4" />
                    Abrir demanda
                  </Link>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Dados avaliados</h3>
                  <SubjectSummary subject={selected.subject} />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Etapas do workflow</h3>
                  <ol className="mt-3 space-y-2">
                    {selected.steps.map((step) => (
                      <li key={step.id} className={`rounded-md border p-3 ${step.status === 'pending' ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20' : 'border-bbt-gray-100 dark:border-slate-800'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-bbt-primary dark:text-white">{step.stepNumber}. {step.nodeName}</div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {step.approvalKind || 'etapa automática'} · {step.completionMode}
                              {step.dueAt ? ` · vence ${formatDateTime(step.dueAt)}` : ''}
                            </div>
                          </div>
                          <StatusBadge status={step.status} />
                        </div>
                        {step.assignments.length > 0 && (
                          <ul className="mt-3 divide-y divide-bbt-gray-100 border-t border-bbt-gray-100 text-xs dark:divide-slate-800 dark:border-slate-800">
                            {step.assignments.map((assignment) => (
                              <li key={assignment.id} className="flex items-center justify-between gap-3 py-2">
                                <span className="truncate">
                                  {assignment.userName || assignment.userEmail || 'Aprovador não resolvido'}
                                  {assignment.delegatedFromUserId && <span className="ml-1 text-slate-400">(delegado)</span>}
                                </span>
                                <StatusBadge status={assignment.status} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>

                {pendingAssignment && canDecide && (
                  <div className="border-t border-bbt-gray-100 pt-4 dark:border-slate-800">
                    <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Registrar decisão</h3>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className={`bbt-button-ghost flex-1 justify-center ${decision === 'rejected' ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300' : ''}`}
                        onClick={() => setDecision('rejected')}
                      >
                        <XCircle className="h-4 w-4" />
                        Rejeitar
                      </button>
                      <button
                        type="button"
                        className={`bbt-button-ghost flex-1 justify-center ${decision === 'approved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : ''}`}
                        onClick={() => setDecision('approved')}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Aprovar
                      </button>
                    </div>
                    {decision && (
                      <div className="mt-3">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Motivo da decisão
                          <textarea
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            rows={3}
                            className="bbt-input mt-1"
                            placeholder="Registre o fundamento da decisão"
                          />
                        </label>
                        <div className="mt-3 flex justify-end gap-2">
                          <button type="button" className="bbt-button-ghost" onClick={() => {
                            setDecision(null)
                            setReason('')
                          }}>
                            Cancelar
                          </button>
                          <button type="button" className="bbt-button-primary" disabled={deciding} onClick={() => void submitDecision()}>
                            {deciding && <Loader2 className="h-4 w-4 animate-spin" />}
                            Confirmar decisão
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!pendingAssignment && selected.assignedToMe && ['pending', 'in_progress'].includes(selected.status) && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                    A atribuição mudou enquanto a tela estava aberta. Atualize a fila antes de decidir.
                  </div>
                )}
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </section>
  )
}

function findPendingAssignment(
  detail: ApprovalInstanceDetail | null,
  userId: string | null,
): { assignment: ApprovalAssignmentDetail; stepVersion: number } | null {
  if (!detail || !userId) return null
  for (const step of detail.steps) {
    if (step.status !== 'pending') continue
    const assignment = step.assignments.find((candidate) => candidate.status === 'pending' && candidate.userId === userId)
    if (assignment) return { assignment, stepVersion: step.version }
  }
  return null
}

function decisionKey(
  assignmentId: string,
  version: number,
  decision: Decision,
  reason: string,
): string {
  let hash = 2166136261
  for (let index = 0; index < reason.length; index += 1) {
    hash ^= reason.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `approval:${assignmentId}:${version}:${decision}:${(hash >>> 0).toString(16)}`
}

function SubjectSummary({ subject }: { subject: Record<string, unknown> }) {
  const visible = Object.entries(subject).filter(([, value]) => (
    value !== null
    && value !== undefined
    && value !== ''
    && (!Array.isArray(value) || value.length > 0)
  ))
  if (visible.length === 0) return <p className="mt-2 text-sm text-slate-500">Sem dados adicionais.</p>
  return (
    <dl className="mt-2 grid gap-x-5 gap-y-2 rounded-md bg-bbt-gray-50 p-3 text-xs dark:bg-slate-900 sm:grid-cols-2">
      {visible.slice(0, 16).map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="truncate font-semibold text-slate-500">{key}</dt>
          <dd className="mt-0.5 break-words text-bbt-primary dark:text-white">{displayValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function displayValue(value: unknown): string {
  if (typeof value === 'number') return formatCurrency(value)
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'object' && value) return JSON.stringify(value)
  return String(value)
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock3
  label: string
  value: number
  tone: 'amber' | 'blue' | 'red' | 'green'
}) {
  const toneClass = {
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  }[tone]
  return (
    <div className="bbt-card flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${toneClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500">{label}</div>
        <div className="mt-0.5 text-xl font-bold tabular-nums text-bbt-primary dark:text-white">{value}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const className = status === 'approved'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : ['pending', 'in_progress'].includes(status)
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      : ['rejected', 'failed', 'expired'].includes(status)
        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return <span className={`bbt-badge ${className}`}>{STATUS_LABEL[status] || status}</span>
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-bbt-primary dark:text-white">{value}</dd>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-52 items-center justify-center text-sm text-slate-500" role="status">
      <Loader2 className="mr-2 h-5 w-5 animate-spin text-bbt-accent" />
      {label}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-5 text-center dark:border-red-900 dark:bg-red-950/20">
      <AlertTriangle className="mx-auto h-6 w-6 text-red-600" />
      <p className="mt-2 text-sm text-red-800 dark:text-red-200">{message}</p>
      <button type="button" className="bbt-button-ghost mt-3" onClick={onRetry}>Tentar novamente</button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center border-y border-bbt-gray-100 text-center dark:border-slate-800">
      <ShieldCheck className="h-9 w-9 text-slate-300" />
      <h3 className="mt-3 font-semibold text-bbt-primary dark:text-white">Nenhuma aprovação neste filtro</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">A fila será atualizada quando uma política iniciar um workflow.</p>
    </div>
  )
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR')
}

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError && error.requestId) {
    return `${error.message} Referência: ${error.requestId}.`
  }
  return error instanceof Error ? error.message : 'Não foi possível consultar as aprovações.'
}

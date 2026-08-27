'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ApprovalSubjectSummary } from '@/components/approvals/approval-subject-summary'
import { CompanyPortalLabShell } from '@/components/company-portal-lab/company-portal-chrome'
import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import {
  decideCompanyPortalApproval,
  fetchCompanyPortalApproval,
  fetchCompanyPortalApprovals,
} from '@/lib/company-portal-lab/approval-client'
import { hasPermission } from '@/lib/auth'
import {
  type CorporateApprovalDetail,
  type CorporateApprovalItem,
} from '@/lib/company-portal-lab/corporate-projections'
import { GovernanceClientError } from '@/lib/governance-client'

type QueueFilter = 'pending' | 'mine' | 'completed' | 'all'
type Decision = 'approved' | 'rejected'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em análise',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  failed: 'Não concluída',
  superseded: 'Substituída',
}

export function CorporateApprovalsSection() {
  const { user, portalContext } = useCompanyPortalContext()
  const [items, setItems] = useState<CorporateApprovalItem[]>([])
  const [selected, setSelected] = useState<CorporateApprovalDetail | null>(null)
  const [filter, setFilter] = useState<QueueFilter>('pending')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [decision, setDecision] = useState<Decision | null>(null)
  const [reason, setReason] = useState('')
  const [deciding, setDeciding] = useState(false)
  const listRequestSequence = useRef(0)
  const detailRequestSequence = useRef(0)
  const decisionRequestSequence = useRef(0)
  const contextKey = portalContext ? `${portalContext.type}:${portalContext.id}` : 'unavailable'
  const contextKeyRef = useRef(contextKey)
  contextKeyRef.current = contextKey
  const scope = useMemo(() => portalContext ? {
    scopeType: portalContext.type,
    scopeId: portalContext.id,
  } : {}, [portalContext])
  const canView = hasPermission(user, 'ver_aprovacoes')
  const canDecide = hasPermission(user, 'decidir_aprovacoes')

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = listRequestSequence.current + 1
    listRequestSequence.current = sequence
    const requestedContextKey = contextKey
    if (!canView) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await fetchCompanyPortalApprovals({ ...scope, limit: 200 }, signal)
      if (signal?.aborted || sequence !== listRequestSequence.current || requestedContextKey !== contextKeyRef.current) return
      setItems(result.items)
    } catch (cause) {
      if (signal?.aborted || sequence !== listRequestSequence.current || requestedContextKey !== contextKeyRef.current) return
      setItems([])
      setError(errorMessage(cause))
    } finally {
      if (!signal?.aborted && sequence === listRequestSequence.current && requestedContextKey === contextKeyRef.current) {
        setLoading(false)
      }
    }
  }, [canView, contextKey, scope])

  useEffect(() => {
    const controller = new AbortController()
    detailRequestSequence.current += 1
    decisionRequestSequence.current += 1
    setSelected(null)
    setDecision(null)
    setReason('')
    void load(controller.signal)
    return () => {
      controller.abort()
      listRequestSequence.current += 1
      detailRequestSequence.current += 1
      decisionRequestSequence.current += 1
    }
  }, [load])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return items.filter((item) => {
      const pending = ['pending', 'in_progress'].includes(item.status)
      if (filter === 'pending' && !pending) return false
      if (filter === 'mine' && (!pending || !item.assignedToMe)) return false
      if (filter === 'completed' && pending) return false
      if (!query) return true
      return [
        item.demandNumber,
        item.companyName,
        item.travelerName,
        item.requesterName,
        item.destination,
        item.serviceLabel,
      ].join(' ').toLocaleLowerCase('pt-BR').includes(query)
    })
  }, [filter, items, search])

  const metrics = useMemo(() => ({
    pending: items.filter((item) => ['pending', 'in_progress'].includes(item.status)).length,
    mine: items.filter((item) => item.assignedToMe && ['pending', 'in_progress'].includes(item.status)).length,
    approved: items.filter((item) => item.status === 'approved').length,
  }), [items])

  async function openApproval(id: string) {
    const sequence = detailRequestSequence.current + 1
    detailRequestSequence.current = sequence
    const requestedContextKey = contextKey
    setDetailLoading(true)
    setSelected(null)
    setDecision(null)
    setReason('')
    try {
      const detail = await fetchCompanyPortalApproval(id, scope)
      if (sequence === detailRequestSequence.current && requestedContextKey === contextKeyRef.current) {
        setSelected(detail)
      }
    } catch (cause) {
      if (sequence === detailRequestSequence.current && requestedContextKey === contextKeyRef.current) {
        toast.error(errorMessage(cause))
      }
    } finally {
      if (sequence === detailRequestSequence.current && requestedContextKey === contextKeyRef.current) {
        setDetailLoading(false)
      }
    }
  }

  async function submitDecision() {
    if (!selected?.decision || !decision) return
    const normalizedReason = reason.replace(/\s+/g, ' ').trim()
    if (normalizedReason.length < 3) {
      toast.error('Informe o motivo da decisão com pelo menos 3 caracteres.')
      return
    }
    const chosenDecision = decision
    const sequence = decisionRequestSequence.current + 1
    decisionRequestSequence.current = sequence
    const requestedContextKey = contextKey
    setDeciding(true)
    try {
      const updated = await decideCompanyPortalApproval(selected.id, {
        decision: chosenDecision,
        reason: normalizedReason,
        expectedStepVersion: selected.decision.expectedStepVersion,
        idempotencyKey: decisionKey(
          selected.id,
          selected.decision.expectedStepVersion,
          chosenDecision,
          normalizedReason,
        ),
        confirmation: true,
      }, scope)
      if (sequence !== decisionRequestSequence.current || requestedContextKey !== contextKeyRef.current) return
      setSelected(updated)
      setDecision(null)
      setReason('')
      await load()
      if (sequence !== decisionRequestSequence.current || requestedContextKey !== contextKeyRef.current) return
      toast.success(chosenDecision === 'approved' ? 'Pedido aprovado.' : 'Pedido rejeitado para ajuste.')
    } catch (cause) {
      if (sequence !== decisionRequestSequence.current || requestedContextKey !== contextKeyRef.current) return
      toast.error(errorMessage(cause))
      if (cause instanceof GovernanceClientError && cause.status === 409) {
        try {
          const detail = await fetchCompanyPortalApproval(selected.id, scope)
          if (sequence !== decisionRequestSequence.current || requestedContextKey !== contextKeyRef.current) return
          setSelected(detail)
          await load()
        } catch {
          // The original conflict is already visible to the user.
        }
      }
    } finally {
      if (sequence === decisionRequestSequence.current && requestedContextKey === contextKeyRef.current) {
        setDeciding(false)
      }
    }
  }

  const selectedCompanyId = selected?.companyId
    || items.find((item) => item.id === selected?.id)?.companyId
  const selectedScope = selectedCompanyId
    ? { type: 'company' as const, id: selectedCompanyId }
    : undefined

  return (
    <CompanyPortalLabShell activeSection="approvals" scope={selectedScope}>
      <main className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6" data-company-portal-approvals>
        <PortalSectionHeading
          eyebrow="Decisões da empresa"
          title="Aprovações"
          description="Analise solicitações e registre a decisão sem sair do Portal Empresa."
          onRefresh={() => void load()}
        />

        {!canView ? (
          <AccessDenied label="aprovações" />
        ) : loading ? (
          <LoadingState label="Carregando aprovações" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo das aprovações">
              <Metric icon={Clock3} label="Pendentes" value={metrics.pending} tone="amber" />
              <Metric icon={ShieldCheck} label="Aguardando sua decisão" value={metrics.mine} tone="blue" />
              <Metric icon={CheckCircle2} label="Aprovadas" value={metrics.approved} tone="green" />
            </section>

            <section className="bbt-card space-y-4 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="bbt-tabs w-fit max-w-full overflow-x-auto">
                  {([
                    ['pending', 'Pendentes'],
                    ['mine', 'Para mim'],
                    ['completed', 'Concluídas'],
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
                <label className="flex min-w-0 items-center rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900 lg:w-96">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="sr-only">Buscar aprovações</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
                    placeholder="Pedido, viajante, empresa ou destino"
                  />
                </label>
              </div>

              {filtered.length ? (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                  {filtered.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void openApproval(item.id)}
                      className="grid w-full gap-3 bg-white p-4 text-left transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-bbt-primary dark:text-white">Pedido {item.demandNumber} | {item.serviceLabel}</strong>
                          <StatusBadge status={item.status} />
                          {item.assignedToMe && ['pending', 'in_progress'].includes(item.status) && (
                            <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase text-blue-700">Sua decisão</span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {item.travelerName} · {item.destination}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Solicitante: {item.requesterName} · {item.companyName}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-bbt-accent">
                        Analisar <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState />
              )}
            </section>
          </>
        )}

        {(selected || detailLoading) && (
          <section className="bbt-card overflow-hidden" aria-label="Detalhes da aprovação">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
              <div>
                <p className="bbt-section-label">Decisão do pedido</p>
                <h2 className="mt-1 font-bold text-bbt-primary dark:text-white">
                  {selected ? `Pedido ${selected.demandNumber || '—'}` : 'Carregando pedido'}
                </h2>
              </div>
              <button type="button" className="bbt-button-ghost h-10 w-10 p-0" onClick={() => setSelected(null)} aria-label="Fechar detalhes">
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading ? (
              <LoadingState label="Carregando dados para decisão" />
            ) : selected ? (
              <div className="space-y-5 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selected.status} />
                    <span className="text-sm text-slate-500">{selected.companyName}</span>
                  </div>
                  {selected.demandId && (
                    <Link href={`/dashboard/portal-empresa-lab?demand=${encodeURIComponent(selected.demandId)}`} className="bbt-button-outline">
                      Abrir pedido
                    </Link>
                  )}
                </div>

                <ApprovalSubjectSummary
                  subject={{}}
                  context={{
                    instanceType: selected.type,
                    demandNumber: selected.demandNumber,
                    companyName: selected.companyName,
                    requesterName: selected.requesterName,
                    travelerName: selected.travelerName,
                    serviceType: selected.serviceLabel,
                    destination: selected.destination,
                    travelStartDate: selected.travelStartDate,
                    travelEndDate: selected.travelEndDate,
                  }}
                  presentation={selected.presentation}
                />

                {selected.decision && canDecide && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                    <h3 className="font-bold text-bbt-primary dark:text-white">Registrar sua decisão</h3>
                    <p className="mt-1 text-sm text-slate-500">A decisão será registrada no histórico do pedido.</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className={`bbt-button-ghost justify-center ${decision === 'rejected' ? 'bg-red-50 text-red-700' : ''}`}
                        onClick={() => setDecision('rejected')}
                      >
                        <XCircle className="h-4 w-4" /> Rejeitar para ajuste
                      </button>
                      <button
                        type="button"
                        className={`bbt-button-ghost justify-center ${decision === 'approved' ? 'bg-emerald-50 text-emerald-700' : ''}`}
                        onClick={() => setDecision('approved')}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Aprovar
                      </button>
                    </div>
                    {decision && (
                      <div className="mt-4">
                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Motivo da decisão
                          <textarea
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            rows={3}
                            className="bbt-input mt-1"
                            placeholder="Explique sua decisão"
                          />
                        </label>
                        <div className="mt-3 flex justify-end gap-2">
                          <button type="button" className="bbt-button-ghost" onClick={() => { setDecision(null); setReason('') }}>Cancelar</button>
                          <button type="button" className="bbt-button-primary" disabled={deciding} onClick={() => void submitDecision()}>
                            {deciding && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar decisão
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!selected.decision && ['pending', 'in_progress'].includes(selected.status) && (
                  <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                    Este pedido segue em aprovação, mas não aguarda uma decisão deste usuário neste momento.
                  </p>
                )}
              </div>
            ) : null}
          </section>
        )}
      </main>
    </CompanyPortalLabShell>
  )
}

function PortalSectionHeading({
  eyebrow,
  title,
  description,
  onRefresh,
}: {
  eyebrow: string
  title: string
  description: string
  onRefresh: () => void
}) {
  return (
    <section className="bbt-card flex flex-col gap-4 border-t-4 border-t-bbt-accent p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="bbt-section-label">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-black text-bbt-primary dark:text-white">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <button type="button" className="bbt-button-outline" onClick={onRefresh}>
        <RefreshCw className="h-4 w-4" /> Atualizar
      </button>
    </section>
  )
}

export function CompanyPortalAccessDenied({ label }: { label: string }) {
  return <AccessDenied label={label} />
}

function AccessDenied({ label }: { label: string }) {
  return (
    <section className="bbt-card flex min-h-64 flex-col items-center justify-center p-6 text-center" role="alert">
      <ShieldCheck className="h-10 w-10 text-slate-300" />
      <h2 className="mt-3 text-lg font-bold text-bbt-primary dark:text-white">Acesso não habilitado</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">Seu perfil corporativo não possui permissão para consultar {label}.</p>
      <Link href="/dashboard/portal-empresa-lab" className="bbt-button-primary mt-4">Voltar às demandas</Link>
    </section>
  )
}

function LoadingState({ label }: { label: string }) {
  return <div className="bbt-card flex min-h-52 items-center justify-center gap-2 p-6 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" />{label}</div>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bbt-card flex min-h-52 flex-col items-center justify-center border-red-200 p-6 text-center" role="alert">
      <AlertTriangle className="h-6 w-6 text-red-600" />
      <p className="mt-2 text-sm text-red-700">{message}</p>
      <button type="button" className="bbt-button-outline mt-3" onClick={onRetry}>Tentar novamente</button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center text-center">
      <ShieldCheck className="h-9 w-9 text-slate-300" />
      <h3 className="mt-3 font-bold text-bbt-primary dark:text-white">Nenhuma aprovação neste filtro</h3>
      <p className="mt-1 text-sm text-slate-500">Novas solicitações aparecerão aqui quando precisarem de decisão.</p>
    </div>
  )
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Clock3; label: string; value: number; tone: 'amber' | 'blue' | 'green' }) {
  const toneClass = {
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-emerald-100 text-emerald-700',
  }[tone]
  return (
    <div className="bbt-card flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}><Icon className="h-5 w-5" /></span>
      <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-0.5 text-2xl font-black text-bbt-primary dark:text-white">{value}</p></div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'approved'
    ? 'bg-emerald-100 text-emerald-700'
    : ['pending', 'in_progress'].includes(status)
      ? 'bg-amber-100 text-amber-700'
      : ['rejected', 'failed', 'expired'].includes(status)
        ? 'bg-red-100 text-red-700'
        : 'bg-slate-100 text-slate-600'
  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${tone}`}>{STATUS_LABEL[status] || status}</span>
}

function decisionKey(instanceId: string, version: number, decision: Decision, reason: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < reason.length; index += 1) {
    hash ^= reason.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `company-portal-approval:${instanceId}:${version}:${decision}:${(hash >>> 0).toString(16)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

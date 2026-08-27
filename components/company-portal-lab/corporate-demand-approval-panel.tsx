'use client'

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ApprovalSubjectSummary } from '@/components/approvals/approval-subject-summary'
import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import { hasPermission } from '@/lib/auth'
import {
  decideCompanyPortalApproval,
  fetchCompanyPortalApproval,
  fetchCompanyPortalApprovals,
} from '@/lib/company-portal-lab/approval-client'
import type {
  CorporateApprovalDetail,
  CorporateApprovalItem,
} from '@/lib/company-portal-lab/corporate-projections'
import { GovernanceClientError } from '@/lib/governance-client'

interface CorporateDemandApprovalPanelProps {
  refreshToken: number
  demandId: string
  onDecided?: () => void
}

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

export function CorporateDemandApprovalPanel({
  refreshToken,
  demandId,
  onDecided,
}: CorporateDemandApprovalPanelProps) {
  const { user, portalContext } = useCompanyPortalContext()
  const [items, setItems] = useState<CorporateApprovalItem[]>([])
  const [selected, setSelected] = useState<CorporateApprovalDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [decision, setDecision] = useState<Decision | null>(null)
  const [reason, setReason] = useState('')
  const [deciding, setDeciding] = useState(false)
  const requestSequence = useRef(0)
  const scope = useMemo(() => portalContext ? {
    scopeType: portalContext.type,
    scopeId: portalContext.id,
  } : {}, [portalContext])
  const canView = hasPermission(user, 'ver_aprovacoes')
  const canDecide = hasPermission(user, 'decidir_aprovacoes')

  const openApproval = useCallback(async (id: string, sequence = requestSequence.current) => {
    setDetailLoading(true)
    setDecision(null)
    setReason('')
    try {
      const detail = await fetchCompanyPortalApproval(id, scope)
      if (sequence === requestSequence.current) setSelected(detail)
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setSelected(null)
        setError(errorMessage(cause))
      }
    } finally {
      if (sequence === requestSequence.current) setDetailLoading(false)
    }
  }, [scope])

  const load = useCallback(async () => {
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    if (!canView) {
      setItems([])
      setSelected(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setSelected(null)
    setDecision(null)
    setReason('')
    setDeciding(false)
    try {
      const result = await fetchCompanyPortalApprovals({ ...scope, demandId, limit: 50 })
      if (sequence !== requestSequence.current) return
      setItems(result.items)
      const preferred = result.items.find((item) => (
        item.assignedToMe && ['pending', 'in_progress'].includes(item.status)
      )) || result.items[0]
      if (preferred) await openApproval(preferred.id, sequence)
      else setSelected(null)
    } catch (cause) {
      if (sequence !== requestSequence.current) return
      setItems([])
      setSelected(null)
      setError(errorMessage(cause))
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [canView, demandId, openApproval, scope])

  useEffect(() => {
    void refreshToken
    void load()
    return () => { requestSequence.current += 1 }
  }, [load, refreshToken])

  const currentStatusMessage = useMemo(() => {
    if (!selected || !['pending', 'in_progress'].includes(selected.status)) return null
    if (selected.decision && canDecide) return 'Este pedido aguarda sua decisão.'
    return 'O pedido continua em aprovação e não aguarda uma decisão deste usuário neste momento.'
  }, [canDecide, selected])

  async function submitDecision() {
    if (!selected?.decision || !decision) return
    const normalizedReason = reason.replace(/\s+/g, ' ').trim()
    if (normalizedReason.length < 3) {
      toast.error('Informe o motivo da decisão com pelo menos 3 caracteres.')
      return
    }
    const chosenDecision = decision
    const sequence = requestSequence.current
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
      if (sequence !== requestSequence.current) return
      setSelected(updated)
      setDecision(null)
      setReason('')
      onDecided?.()
      toast.success(chosenDecision === 'approved' ? 'Pedido aprovado.' : 'Pedido rejeitado para ajuste.')
      void load()
    } catch (cause) {
      if (sequence !== requestSequence.current) return
      toast.error(errorMessage(cause))
      if (cause instanceof GovernanceClientError && cause.status === 409) {
        await openApproval(selected.id)
      }
    } finally {
      if (sequence === requestSequence.current) setDeciding(false)
    }
  }

  if (!canView) return null
  if (loading && !selected) return <LoadingState />
  if (error && !selected) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <section className="bbt-card space-y-4 p-4 sm:p-5" aria-labelledby="company-portal-demand-approval-title" data-company-portal-demand-approval>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="bbt-section-label">Decisão da empresa</p>
          <h2 id="company-portal-demand-approval-title" className="mt-1 text-lg font-bold text-bbt-primary dark:text-white">
            Autorização deste pedido
          </h2>
          <p className="mt-1 text-sm text-slate-500">Consulte o que está sendo avaliado e acompanhe o status da decisão.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/portal-empresa-lab?section=approvals" className="bbt-button-outline">Ver aprovações</Link>
          <button type="button" className="bbt-button-ghost" onClick={() => void load()} disabled={loading || deciding}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {items.length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="Decisões vinculadas ao pedido">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selected?.id === item.id ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary' : 'border-slate-200 text-slate-600'}`}
              onClick={() => void openApproval(item.id)}
              disabled={detailLoading || deciding}
            >
              {approvalTypeLabel(item.serviceLabel)} · {STATUS_LABEL[item.status] || item.status}
            </button>
          ))}
        </div>
      )}

      {detailLoading && !selected ? <LoadingState /> : selected ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={selected.status} />
            {selected.assignedToMe && ['pending', 'in_progress'].includes(selected.status) && (
              <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase text-blue-700">Sua decisão</span>
            )}
            <span className="text-xs text-slate-500">Iniciada em {formatDateTime(selected.startedAt)}</span>
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

          {currentStatusMessage && (
            <div className={`rounded-xl border p-3 text-sm ${selected.decision && canDecide ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
              {currentStatusMessage}
            </div>
          )}

          {selected.decision && canDecide && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <h3 className="font-bold text-bbt-primary dark:text-white">Registrar sua decisão</h3>
              <p className="mt-1 text-sm text-slate-500">A decisão será registrada no histórico do pedido.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" className={`bbt-button-ghost justify-center ${decision === 'rejected' ? 'bg-red-50 text-red-700' : ''}`} onClick={() => setDecision('rejected')}>
                  <XCircle className="h-4 w-4" /> Rejeitar para ajuste
                </button>
                <button type="button" className={`bbt-button-ghost justify-center ${decision === 'approved' ? 'bg-emerald-50 text-emerald-700' : ''}`} onClick={() => setDecision('approved')}>
                  <CheckCircle2 className="h-4 w-4" /> Aprovar
                </button>
              </div>
              {decision && (
                <div className="mt-4">
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Motivo da decisão
                    <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="bbt-input mt-1" placeholder="Explique sua decisão" />
                  </label>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" className="bbt-button-ghost" disabled={deciding} onClick={() => { setDecision(null); setReason('') }}>Cancelar</button>
                    <button type="button" className="bbt-button-primary" disabled={deciding} onClick={() => void submitDecision()}>
                      {deciding && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar decisão
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-36 flex-col items-center justify-center text-center">
          <ShieldCheck className="h-8 w-8 text-slate-300" />
          <h3 className="mt-2 font-semibold text-bbt-primary dark:text-white">Nenhuma aprovação vinculada</h3>
          <p className="mt-1 text-sm text-slate-500">O status será atualizado quando uma decisão for iniciada.</p>
        </div>
      )}
    </section>
  )
}

function LoadingState() {
  return <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-slate-500" role="status"><Loader2 className="h-4 w-4 animate-spin" />Carregando autorização...</div>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bbt-card flex min-h-36 flex-col items-center justify-center gap-3 border-red-200 p-6 text-center text-red-700" role="alert">
      <AlertTriangle className="h-5 w-5" /><span className="font-semibold">{message}</span>
      <button type="button" className="bbt-button-outline" onClick={onRetry}>Tentar novamente</button>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const className = status === 'approved'
    ? 'bg-emerald-100 text-emerald-700'
    : ['pending', 'in_progress'].includes(status)
      ? 'bg-amber-100 text-amber-700'
      : ['rejected', 'failed', 'expired'].includes(status)
        ? 'bg-red-100 text-red-700'
        : 'bg-slate-100 text-slate-600'
  const Icon = status === 'approved' ? CheckCircle2 : ['pending', 'in_progress'].includes(status) ? Clock3 : ShieldCheck
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${className}`}><Icon className="h-3 w-3" />{STATUS_LABEL[status] || status}</span>
}

function decisionKey(instanceId: string, version: number, decision: Decision, reason: string): string {
  let hash = 2166136261
  for (let index = 0; index < reason.length; index += 1) {
    hash ^= reason.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `company-portal-approval:${instanceId}:${version}:${decision}:${(hash >>> 0).toString(16)}`
}

function approvalTypeLabel(serviceLabel: string): string {
  return serviceLabel || 'Pedido'
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'data não informada' : parsed.toLocaleString('pt-BR')
}

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError && error.requestId) return `${error.message} Referência: ${error.requestId}.`
  return error instanceof Error ? error.message : 'Não foi possível carregar a aprovação.'
}

export default CorporateDemandApprovalPanel

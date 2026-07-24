'use client'

import { useState } from 'react'
import {
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  confirmAiActionProposalClient,
  rejectAiActionProposalClient,
} from '@/lib/ai-action-client'
import type { AiActionProposal } from '@/lib/ai-actions'

interface AiActionProposalCardProps {
  proposal: AiActionProposal
  onChange?: (proposal: AiActionProposal) => void
  compact?: boolean
}

export function AiActionProposalCard({
  proposal,
  onChange,
  compact = false,
}: AiActionProposalCardProps) {
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null)

  async function confirmProposal() {
    if (busy || proposal.status !== 'pending_confirmation') return
    setBusy('confirm')
    try {
      const next = await confirmAiActionProposalClient(proposal)
      onChange?.(next)
      toast.success('Ação confirmada e executada com segurança.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível executar a ação.')
    } finally {
      setBusy(null)
    }
  }

  async function rejectProposal() {
    if (busy || proposal.status !== 'pending_confirmation') return
    setBusy('reject')
    try {
      const next = await rejectAiActionProposalClient(proposal)
      onChange?.(next)
      toast.success('Proposta rejeitada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível rejeitar a proposta.')
    } finally {
      setBusy(null)
    }
  }

  const pending = proposal.status === 'pending_confirmation'
  const status = proposalStatus(proposal)

  return (
    <section
      className={`rounded-lg border p-3 text-left ${
        pending
          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
          : proposal.status === 'completed'
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900'
      }`}
      aria-label={`Proposta de ação: ${proposal.summary}`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0 text-bbt-accent">
          {pending ? (
            <ShieldCheck className="h-4 w-4" />
          ) : proposal.status === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <Clock3 className="h-4 w-4 text-slate-500" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-bbt-primary dark:text-white">
              {proposal.summary}
            </p>
            <span className={`text-[10px] font-semibold uppercase ${status.className}`}>
              {status.label}
            </span>
          </div>
          <dl className={`mt-2 grid gap-x-4 gap-y-1 text-xs ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
            {Object.entries(proposal.payloadPreview)
              .filter(([, value]) => value !== null && value !== undefined && value !== '')
              .slice(0, 8)
              .map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="inline text-slate-500">{formatKey(key)}: </dt>
                  <dd className="inline break-words font-medium text-slate-800 dark:text-slate-200">
                    {formatValue(value)}
                  </dd>
                </div>
              ))}
          </dl>
          {proposal.errorMessage ? (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300">{proposal.errorMessage}</p>
          ) : null}
          {pending ? (
            <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
              Nada será alterado até sua confirmação. O servidor validará novamente o acesso e os dados.
            </p>
          ) : null}
        </div>
      </div>

      {pending ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void rejectProposal()}
            disabled={Boolean(busy)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {busy === 'reject' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Rejeitar
          </button>
          <button
            type="button"
            onClick={() => void confirmProposal()}
            disabled={Boolean(busy)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-bbt-accent px-3 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50"
          >
            {busy === 'confirm' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Confirmar e executar
          </button>
        </div>
      ) : null}
    </section>
  )
}

function proposalStatus(proposal: AiActionProposal): { label: string; className: string } {
  const values: Record<AiActionProposal['status'], { label: string; className: string }> = {
    pending_confirmation: { label: 'Aguardando confirmação', className: 'text-amber-700 dark:text-amber-300' },
    executing: { label: 'Executando', className: 'text-blue-700 dark:text-blue-300' },
    completed: { label: 'Concluída', className: 'text-emerald-700 dark:text-emerald-300' },
    rejected: { label: 'Rejeitada', className: 'text-slate-600 dark:text-slate-300' },
    expired: { label: 'Expirada', className: 'text-slate-600 dark:text-slate-300' },
    failed: { label: 'Falhou', className: 'text-red-700 dark:text-red-300' },
  }
  return values[proposal.status]
}

function formatKey(key: string): string {
  const labels: Record<string, string> = {
    empresaId: 'Empresa',
    passageiro: 'Passageiro',
    servico: 'Serviço',
    prioridade: 'Prioridade',
    destino: 'Destino',
    nome: 'Hotel',
    cidade: 'Cidade',
    uf: 'UF',
    categoria: 'Categoria',
    reason: 'Motivo',
    priority: 'Prioridade',
  }
  return labels[key] || key.replace(/_/g, ' ')
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

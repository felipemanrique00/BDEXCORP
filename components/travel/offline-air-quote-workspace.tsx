'use client'

import { AlertTriangle, Clock3, Plane, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { atendimentoToOfflineAirDemandSummary } from '@/components/travel/offline-air-demand-summary'
import {
  OfflineAirQuoteForm,
  toOfflineAirQuoteCreateInput,
  type OfflineAirQuoteFormValue,
} from '@/components/travel/services/air'
import { DateTimeInput } from '@/components/ui/date-input'
import {
  createOfflineAirQuoteFromServer,
  OfflineAirQuoteClientError,
} from '@/lib/offline-travel/services/air/client'
import type { Atendimento, Empresa } from '@/types'

const ELIGIBLE_LIFECYCLE_STATUSES = new Set([
  'draft',
  'submitted',
  'approved_for_quotation',
  'quoting',
  'pending_choice',
])

export interface OfflineAirQuoteContext {
  demandId: string
  lifecycleStatus: string
}

export interface OfflineAirQuoteWorkspaceProps {
  demands: Atendimento[]
  companies: Empresa[]
  initialDemandId?: string
  onCompleted: () => void
  onContextChange?: (context: OfflineAirQuoteContext) => void
}

export function OfflineAirQuoteWorkspace({
  demands,
  companies,
  initialDemandId,
  onCompleted,
  onContextChange,
}: OfflineAirQuoteWorkspaceProps) {
  const [demandId, setDemandId] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [policyJustification, setPolicyJustification] = useState('')
  const [busy, setBusy] = useState(false)
  const appliedInitialDemandRef = useRef('')
  const idempotencyKeysRef = useRef(new Map<string, string>())

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  )
  const eligibleDemands = useMemo(
    () => [...demands]
      .filter(isAirDemand)
      .filter((demand) => Boolean(demand.serial_os))
      .filter((demand) => companyById.has(demand.empresa_id))
      .filter((demand) => ELIGIBLE_LIFECYCLE_STATUSES.has(demandLifecycleStatus(demand)))
      .sort((left, right) => demandUpdatedAt(right).localeCompare(demandUpdatedAt(left))),
    [companyById, demands],
  )
  const selectedDemand = useMemo(
    () => eligibleDemands.find((demand) => demand.id === demandId) || null,
    [demandId, eligibleDemands],
  )
  const summary = useMemo(() => {
    if (!selectedDemand) return null
    return atendimentoToOfflineAirDemandSummary(
      selectedDemand,
      companyById.get(selectedDemand.empresa_id)?.nome || 'Empresa não informada',
    )
  }, [companyById, selectedDemand])

  useEffect(() => {
    const requested = String(initialDemandId || '').trim()
    if (!requested) {
      appliedInitialDemandRef.current = ''
      return
    }
    if (appliedInitialDemandRef.current === requested) return
    if (!eligibleDemands.some((demand) => demand.id === requested)) return
    appliedInitialDemandRef.current = requested
    setDemandId(requested)
  }, [eligibleDemands, initialDemandId])

  useEffect(() => {
    onContextChange?.({
      demandId,
      lifecycleStatus: selectedDemand ? demandLifecycleStatus(selectedDemand) : '',
    })
  }, [demandId, onContextChange, selectedDemand])

  async function publishQuote(value: OfflineAirQuoteFormValue) {
    if (!selectedDemand || !summary || value.demandId !== selectedDemand.id) {
      throw new Error('Selecione novamente a demanda aérea antes de publicar a cotação.')
    }

    const operationKey = selectedDemand.id
    const idempotencyKey = idempotencyKeysRef.current.get(operationKey) || createIdempotencyKey()
    idempotencyKeysRef.current.set(operationKey, idempotencyKey)
    setBusy(true)
    try {
      const lifecycleVersion = positiveVersion(selectedDemand.relational_lifecycle_version)
      await createOfflineAirQuoteFromServer(toOfflineAirQuoteCreateInput(value, {
        expectedLifecycleVersion: lifecycleVersion || undefined,
        expiresAt: expiresAt || undefined,
        policyJustification,
        idempotencyKey,
      }))
      idempotencyKeysRef.current.delete(operationKey)
      toast.success(`Cotação aérea do pedido ${summary.number} publicada para escolha.`)
      onCompleted()
    } catch (error) {
      if (error instanceof OfflineAirQuoteClientError && error.status === 409) onCompleted()
      throw error
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4" data-offline-air-quote-workspace>
      <section className="bbt-card p-5" aria-labelledby="offline-air-demand-selector-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="bbt-section-label">Cotação offline por serviço</p>
            <h3 id="offline-air-demand-selector-title" className="mt-1 flex items-center gap-2 font-bold text-bbt-primary dark:text-white">
              <Plane className="h-4 w-4 text-bbt-accent" />
              Selecione a solicitação aérea
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Os trechos solicitados abrem preenchidos e continuam editáveis para conexões, horários e companhia.
            </p>
          </div>
          <button
            type="button"
            className="bbt-button-ghost h-9 text-xs"
            onClick={onCompleted}
            disabled={busy}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar demandas
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            <span className="mb-1 block">Serial / OS *</span>
            <select
              className="bbt-input"
              value={demandId}
              onChange={(event) => setDemandId(event.target.value)}
              disabled={busy}
            >
              <option value="">Selecione uma demanda aérea</option>
              {eligibleDemands.map((demand) => (
                <option key={demand.id} value={demand.id}>
                  {demand.serial_os || demand.id} · {demand.passageiro_nome || 'Viajante não informado'} · {companyById.get(demand.empresa_id)?.nome || 'Empresa'}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            <span className="mb-1 flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Validade da rodada</span>
            <DateTimeInput
              value={expiresAt}
              onInput={(event) => setExpiresAt(event.currentTarget.value)}
              disabled={busy}
            />
          </label>
        </div>

        <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className="mb-1 block">Justificativa de exceção de política (quando aplicável)</span>
          <textarea
            className="bbt-input min-h-20 resize-y"
            value={policyJustification}
            onChange={(event) => setPolicyJustification(event.target.value)}
            disabled={busy}
            placeholder="Informe somente quando a política corporativa exigir justificativa."
          />
        </label>

        {!eligibleDemands.length && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Nenhuma solicitação aérea apta para cotação foi encontrada no seu escopo.
          </div>
        )}
      </section>

      {summary ? (
        <OfflineAirQuoteForm
          key={summary.id}
          demand={summary}
          busy={busy}
          onSubmit={publishQuote}
        />
      ) : (
        <section className="bbt-card border-dashed p-8 text-center text-sm text-slate-500">
          Selecione uma Serial / OS para montar as opções aéreas.
        </section>
      )}
    </div>
  )
}

export default OfflineAirQuoteWorkspace

function isAirDemand(demand: Atendimento): boolean {
  const service = normalizeService(demand.tipo_servico)
  return service === 'aereo' || service === 'air'
}

function normalizeService(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function demandLifecycleStatus(demand: Atendimento): string {
  const relational = String(demand.relational_lifecycle_status || '').trim().toLowerCase()
  if (relational) return relational
  if (demand.status === 'aguardando_cliente') return 'pending_choice'
  return String(demand.status || '').trim().toLowerCase()
}

function demandUpdatedAt(demand: Atendimento): string {
  return String(demand.updated_at || demand.created_at || '')
}

function positiveVersion(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function createIdempotencyKey(): string {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${performance.now()}`
  return `offline-air-quote:${randomPart}`
}

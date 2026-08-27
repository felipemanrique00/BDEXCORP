'use client'

import { AlertTriangle, Loader2, Plane, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { atendimentoToOfflineAirDemandSummary } from '@/components/travel/offline-air-demand-summary'
import {
  OfflineAirQuoteChoicePanel,
  toOfflineAirQuoteRoundReadModel,
  type OfflineAirDemandSummary,
} from '@/components/travel/services/air'
import { listDemandsFromServer } from '@/lib/demands-client'
import {
  OfflineHotelQuoteClientError,
  selectOfflineQuoteOptionFromServer,
} from '@/lib/offline-travel/quote-client'
import {
  listOfflineAirQuotesFromServer,
  OfflineAirQuoteClientError,
} from '@/lib/offline-travel/services/air/client'
import type {
  OfflineAirQuoteListReadModel,
  OfflineAirQuoteReadModel,
} from '@/lib/offline-travel/services/air/read-model'
import type { Atendimento, Empresa } from '@/types'

const REQUESTER_HIDDEN_STATUSES = new Set([403, 404])
const CLOSED_DEMAND_STATUSES = new Set([
  'issued',
  'closed',
  'canceled',
  'cancelado',
  'rejected',
  'rejeitado',
  'expired',
  'finalizado',
])

export interface OfflineAirQuoteChoiceWorkspaceProps {
  demands: Atendimento[]
  companies: Empresa[]
  requesterId?: string | null
  focusDemandId?: string | null
  /** Internal screens may discover eligible demands; embedded corporate views must provide projected demands. */
  discoverServerDemands?: boolean
  onCompleted: () => void
}

interface AirDemandQuoteRound {
  demand: Atendimento
  list: OfflineAirQuoteListReadModel
  quote: OfflineAirQuoteReadModel
}

export function OfflineAirQuoteChoiceWorkspace({
  demands,
  companies,
  requesterId,
  focusDemandId,
  discoverServerDemands = true,
  onCompleted,
}: OfflineAirQuoteChoiceWorkspaceProps) {
  const [rounds, setRounds] = useState<AirDemandQuoteRound[]>([])
  const [serverDemands, setServerDemands] = useState<Atendimento[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [demandLoadError, setDemandLoadError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [submittingQuoteId, setSubmittingQuoteId] = useState('')
  const [completedDemandIds, setCompletedDemandIds] = useState<Set<string>>(() => new Set())
  const idempotencyKeysRef = useRef(new Map<string, string>())

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  )
  const requesterDemandCandidates = useMemo(() => {
    const exactRequesterId = String(requesterId || '').trim()
    const byId = new Map<string, Atendimento>()

    for (const demand of [...demands, ...serverDemands]) {
      if (!isAirDemand(demand) || isClosedDemand(demand)) continue
      if (completedDemandIds.has(demand.id)) continue
      if (focusDemandId && demand.id !== focusDemandId) continue
      if (exactRequesterId && String(demand.solicitante_id || '') !== exactRequesterId) continue
      byId.set(demand.id, demand)
    }

    return [...byId.values()].sort((left, right) => demandUpdatedAt(right).localeCompare(demandUpdatedAt(left)))
  }, [completedDemandIds, demands, focusDemandId, requesterId, serverDemands])
  const candidateKey = useMemo(
    () => requesterDemandCandidates.map((demand) => demand.id).sort().join('|'),
    [requesterDemandCandidates],
  )

  useEffect(() => {
    let active = true
    setDemandLoadError('')
    if (!discoverServerDemands) {
      setServerDemands([])
      return () => {
        active = false
      }
    }
    void listDemandsFromServer({ lifecycleStatus: 'pending_choice', serviceType: 'air', limit: 200 })
      .then((result) => {
        if (active) setServerDemands(result.items.map((item) => item.demand))
      })
      .catch((error: unknown) => {
        if (!active) return
        setServerDemands([])
        setDemandLoadError(errorMessage(error))
      })
    return () => {
      active = false
    }
  }, [discoverServerDemands, reloadToken])

  useEffect(() => {
    let active = true
    if (!requesterDemandCandidates.length) {
      setRounds([])
      setLoadError('')
      setLoading(false)
      return () => {
        active = false
      }
    }

    setLoading(true)
    setLoadError('')
    void Promise.allSettled(
      requesterDemandCandidates.map(async (demand) => ({
        demand,
        list: await listOfflineAirQuotesFromServer(demand.id),
      })),
    ).then((results) => {
      if (!active) return
      const nextRounds: AirDemandQuoteRound[] = []
      const errors: string[] = []

      for (const result of results) {
        if (result.status === 'rejected') {
          if (!isRequesterHiddenError(result.reason)) errors.push(errorMessage(result.reason))
          continue
        }
        const { demand, list } = result.value
        if (String(list.lifecycleStatus || '') !== 'pending_choice') continue
        const quote = (list.quotes || []).find((candidate) => (
          candidate.demandId === demand.id
          && candidate.lifecycleStatus === 'pending_choice'
          && candidate.status === 'completed'
          && !isQuoteExpired(candidate)
          && !hasActiveSelection(candidate)
        ))
        if (quote) nextRounds.push({ demand, list, quote })
      }

      nextRounds.sort((left, right) => right.quote.createdAt.localeCompare(left.quote.createdAt))
      setRounds(nextRounds)
      setLoadError(errors[0] || '')
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => {
      active = false
    }
  }, [candidateKey, reloadToken, requesterDemandCandidates])

  async function selectOption(round: AirDemandQuoteRound, optionId: string) {
    const lifecycleVersion = positiveVersion(round.quote.lifecycleVersion || round.list.lifecycleVersion)
    if (!lifecycleVersion) throw new Error('A versão desta demanda está desatualizada. Atualize as cotações.')
    if (round.quote.status !== 'completed' || isQuoteExpired(round.quote) || hasActiveSelection(round.quote)) {
      throw new Error('Esta cotação aérea não está mais disponível para escolha. Atualize a página.')
    }

    const operationKey = `${round.quote.id}:${optionId}`
    const idempotencyKey = idempotencyKeysRef.current.get(operationKey) || createSelectionKey()
    idempotencyKeysRef.current.set(operationKey, idempotencyKey)
    setSubmittingQuoteId(round.quote.id)

    try {
      const result = await selectOfflineQuoteOptionFromServer({
        demandId: round.demand.id,
        quoteId: round.quote.id,
        optionId,
        expectedLifecycleVersion: lifecycleVersion,
        confirmed: true,
        idempotencyKey,
      })
      idempotencyKeysRef.current.delete(operationKey)
      setCompletedDemandIds((current) => new Set(current).add(round.demand.id))
      toast.success(result.status === 'pending_approval'
        ? 'Opção aérea escolhida e enviada para aprovação.'
        : 'Opção aérea escolhida. A solicitação seguirá para reserva.')
      onCompleted()
    } catch (error) {
      if (error instanceof OfflineHotelQuoteClientError && error.status === 409) {
        setReloadToken((current) => current + 1)
        onCompleted()
      }
      throw new Error(errorMessage(error))
    } finally {
      setSubmittingQuoteId('')
    }
  }

  const visibleError = loadError || demandLoadError
  if (!loading && !rounds.length && !visibleError) return null

  return (
    <section className="bbt-card overflow-hidden" aria-labelledby="offline-air-choice-workspace-title" data-offline-air-choice-workspace>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700">
        <div>
          <h3 id="offline-air-choice-workspace-title" className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white">
            <Plane className="h-4 w-4 text-bbt-accent" />
            Cotações aéreas disponíveis
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Compare itinerário, horários, bagagem, valores, prazo de emissão e condições.
          </p>
        </div>
        <button
          type="button"
          className="bbt-button-ghost h-9 text-xs"
          onClick={() => setReloadToken((current) => current + 1)}
          disabled={loading || Boolean(submittingQuoteId)}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      {loading && !rounds.length ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Consultando cotações aéreas autorizadas...
        </div>
      ) : visibleError && !rounds.length ? (
        <div className="flex items-start gap-2 p-5 text-sm text-red-700 dark:text-red-300" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Não foi possível consultar as cotações aéreas.</div>
            <div className="mt-0.5 text-xs opacity-90">{visibleError}</div>
          </div>
        </div>
      ) : (
        <div className="space-y-5 bg-bbt-gray-50/60 p-4 dark:bg-slate-900/20">
          {visibleError && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Algumas cotações aéreas não puderam ser atualizadas: {visibleError}
            </div>
          )}
          {rounds.map((round) => (
            <OfflineAirQuoteChoicePanel
              key={round.quote.id}
              demand={airChoiceDemandSummary(
                round,
                companyById.get(round.demand.empresa_id)?.nome || 'Empresa não informada',
              )}
              quote={toOfflineAirQuoteRoundReadModel(round.quote)}
              busy={submittingQuoteId === round.quote.id}
              onSelect={(optionId) => selectOption(round, optionId)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default OfflineAirQuoteChoiceWorkspace

function airChoiceDemandSummary(round: AirDemandQuoteRound, companyName: string): OfflineAirDemandSummary {
  const legacy = atendimentoToOfflineAirDemandSummary(round.demand, companyName)
  if (!round.list.passengers.length) return legacy

  return {
    ...legacy,
    passengers: round.list.passengers.map((passenger) => ({
      id: passenger.demandTravelerId,
      demandTravelerId: passenger.demandTravelerId,
      employeeId: passenger.employeeId || undefined,
      sequence: passenger.sequence,
      identificationCode: passenger.identificationCode || undefined,
      name: passenger.name,
      type: 'adulto',
    })),
  }
}

function isAirDemand(demand: Atendimento): boolean {
  const service = String(demand.tipo_servico || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
  return service === 'aereo' || service === 'air'
}

function demandLifecycleStatus(demand: Atendimento): string {
  const relational = String(demand.relational_lifecycle_status || '').trim().toLowerCase()
  if (relational) return relational
  if (demand.status === 'aguardando_cliente') return 'pending_choice'
  return String(demand.status || '').trim().toLowerCase()
}

function isClosedDemand(demand: Atendimento): boolean {
  return CLOSED_DEMAND_STATUSES.has(demandLifecycleStatus(demand))
}

function demandUpdatedAt(demand: Atendimento): string {
  return String(demand.updated_at || demand.created_at || '')
}

function positiveVersion(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function isQuoteExpired(quote: OfflineAirQuoteReadModel): boolean {
  if (quote.status === 'expired') return true
  if (!quote.expiresAt) return false
  const expiresAt = Date.parse(quote.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function hasActiveSelection(quote: OfflineAirQuoteReadModel): boolean {
  return Boolean(quote.selectedOptionId || quote.options.some((option) => option.selected) || quote.status === 'selected')
}

function isRequesterHiddenError(error: unknown): boolean {
  return error instanceof OfflineAirQuoteClientError && REQUESTER_HIDDEN_STATUSES.has(error.status)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Não foi possível concluir a operação de cotação aérea offline.'
}

function createSelectionKey(): string {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${performance.now()}`
  return `offline-air-selection:${randomPart}`
}

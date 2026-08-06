'use client'

import { BedDouble, Check, Circle, ClipboardCheck, Plane } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import OfflineAirQuoteWorkspace, {
  type OfflineAirQuoteContext,
} from '@/components/travel/offline-air-quote-workspace'
import OfflineHotelQuoteForm, {
  type OfflineHotelQuoteContext,
} from '@/components/travel/offline-hotel-quote-form'
import OfflineTravelOperationForm, {
  type OfflineTravelContext,
} from '@/components/travel/offline-travel-operation-form'
import type { GovernedTravelReservationSummary } from '@/lib/travel/reservation-records'
import type { Atendimento, Empresa } from '@/types'

interface OfflineTravelWorkspaceProps {
  demands: Atendimento[]
  companies: Empresa[]
  reservations: GovernedTravelReservationSummary[]
  quoteCompanyIds?: readonly string[]
  reservationCompanyIds?: readonly string[]
  initialDemandId?: string
  canQuoteHotels: boolean
  canQuoteAir?: boolean
  canOperateReservations: boolean
  onCompleted: () => void
}

type OfflineWorkspacePanel = 'hotel_quote' | 'air_quote' | 'reservation'

const OFFLINE_FLOW_STAGES = [
  'Solicitação',
  'Cotações',
  'Escolha',
  'Aprovação',
  'Reserva',
  'Emissão',
  'Voucher',
] as const

export function OfflineTravelWorkspace(props: OfflineTravelWorkspaceProps) {
  const canQuoteAir = props.canQuoteAir ?? props.canQuoteHotels
  const [panel, setPanel] = useState<OfflineWorkspacePanel>(() => (
    props.canQuoteHotels ? 'hotel_quote' : canQuoteAir ? 'air_quote' : 'reservation'
  ))
  const [sharedDemandId, setSharedDemandId] = useState('')
  const [context, setContext] = useState<OfflineTravelContext>({
    demandId: '',
    lifecycleStatus: '',
    operation: 'reservation',
  })
  const appliedInitialDemandRef = useRef('')
  const sharedDemandIdRef = useRef('')
  const hotelQuoteContextReadyRef = useRef(false)
  const airQuoteContextReadyRef = useRef(false)
  const operationContextReadyRef = useRef(false)
  const activeStage = useMemo(() => stageFromContext(context), [context])
  const quoteCompanyIds = useMemo(
    () => new Set(props.quoteCompanyIds || props.companies.map((item) => item.id)),
    [props.companies, props.quoteCompanyIds],
  )
  const reservationCompanyIds = useMemo(
    () => new Set(props.reservationCompanyIds || props.companies.map((item) => item.id)),
    [props.companies, props.reservationCompanyIds],
  )
  const quoteDemands = useMemo(
    () => props.demands.filter((item) => quoteCompanyIds.has(item.empresa_id)),
    [props.demands, quoteCompanyIds],
  )
  const reservationDemands = useMemo(
    () => props.demands.filter((item) => reservationCompanyIds.has(item.empresa_id)),
    [props.demands, reservationCompanyIds],
  )
  const quoteCompanies = useMemo(
    () => props.companies.filter((item) => quoteCompanyIds.has(item.id)),
    [props.companies, quoteCompanyIds],
  )
  const reservationCompanies = useMemo(
    () => props.companies.filter((item) => reservationCompanyIds.has(item.id)),
    [props.companies, reservationCompanyIds],
  )
  const reservationRecords = useMemo(
    () => props.reservations.filter((item) => reservationCompanyIds.has(item.companyId)),
    [props.reservations, reservationCompanyIds],
  )

  useEffect(() => {
    const requested = String(props.initialDemandId || '').trim()
    if (!requested) {
      appliedInitialDemandRef.current = ''
      return
    }
    if (appliedInitialDemandRef.current === requested) return
    const demand = props.demands.find((item) => item.id === requested)
    if (!demand) return
    const canQuoteHotelDemand = props.canQuoteHotels && isHotelDemand(demand) && quoteCompanyIds.has(demand.empresa_id)
    const canQuoteAirDemand = canQuoteAir && isAirDemand(demand) && quoteCompanyIds.has(demand.empresa_id)
    const canOperateDemand = props.canOperateReservations && reservationCompanyIds.has(demand.empresa_id)
    if (!canQuoteHotelDemand && !canQuoteAirDemand && !canOperateDemand) return

    const lifecycleStatus = demandLifecycleStatus(demand)
    appliedInitialDemandRef.current = requested
    sharedDemandIdRef.current = requested
    hotelQuoteContextReadyRef.current = false
    airQuoteContextReadyRef.current = false
    operationContextReadyRef.current = false
    setSharedDemandId(requested)
    setContext({
      demandId: requested,
      lifecycleStatus,
      operation: 'reservation',
    })
    setPanel(canReceiveQuote(lifecycleStatus) && canQuoteHotelDemand
      ? 'hotel_quote'
      : canReceiveQuote(lifecycleStatus) && canQuoteAirDemand
        ? 'air_quote'
        : 'reservation')
  }, [
    canQuoteAir,
    props.canOperateReservations,
    props.canQuoteHotels,
    props.demands,
    props.initialDemandId,
    quoteCompanyIds,
    reservationCompanyIds,
  ])

  useEffect(() => {
    const panelAllowed = panel === 'hotel_quote'
      ? props.canQuoteHotels
      : panel === 'air_quote'
        ? canQuoteAir
        : props.canOperateReservations
    if (panelAllowed) return
    if (props.canQuoteHotels) setPanel('hotel_quote')
    else if (canQuoteAir) setPanel('air_quote')
    else if (props.canOperateReservations) setPanel('reservation')
  }, [canQuoteAir, panel, props.canOperateReservations, props.canQuoteHotels])

  const handleHotelQuoteContext = useCallback((nextContext: OfflineHotelQuoteContext) => {
    if (!nextContext.demandId && sharedDemandIdRef.current && !hotelQuoteContextReadyRef.current) return
    hotelQuoteContextReadyRef.current = true
    sharedDemandIdRef.current = nextContext.demandId
    setSharedDemandId(nextContext.demandId)
    setContext({
      demandId: nextContext.demandId,
      lifecycleStatus: nextContext.lifecycleStatus,
      operation: 'reservation',
    })
  }, [])

  const handleAirQuoteContext = useCallback((nextContext: OfflineAirQuoteContext) => {
    if (!nextContext.demandId && sharedDemandIdRef.current && !airQuoteContextReadyRef.current) return
    airQuoteContextReadyRef.current = true
    sharedDemandIdRef.current = nextContext.demandId
    setSharedDemandId(nextContext.demandId)
    setContext({
      demandId: nextContext.demandId,
      lifecycleStatus: nextContext.lifecycleStatus,
      operation: 'reservation',
    })
  }, [])

  const handleOperationContext = useCallback((nextContext: OfflineTravelContext) => {
    if (!nextContext.demandId && sharedDemandIdRef.current && !operationContextReadyRef.current) return
    operationContextReadyRef.current = true
    sharedDemandIdRef.current = nextContext.demandId
    setSharedDemandId(nextContext.demandId)
    setContext(nextContext)
  }, [])

  function selectPanel(nextPanel: OfflineWorkspacePanel) {
    if (nextPanel === panel) return
    if (nextPanel === 'hotel_quote' && !props.canQuoteHotels) return
    if (nextPanel === 'air_quote' && !canQuoteAir) return
    if (nextPanel === 'reservation' && !props.canOperateReservations) return
    if (nextPanel === 'hotel_quote') hotelQuoteContextReadyRef.current = false
    else if (nextPanel === 'air_quote') airQuoteContextReadyRef.current = false
    else operationContextReadyRef.current = false
    setPanel(nextPanel)
  }

  const availablePanelCount = Number(props.canQuoteHotels) + Number(canQuoteAir) + Number(props.canOperateReservations)
  const panelGridClass = availablePanelCount >= 3
    ? 'md:grid-cols-3'
    : availablePanelCount === 2
      ? 'md:grid-cols-2'
      : ''

  return (
    <div className="space-y-4">
      <section className="bbt-card p-5" aria-labelledby="offline-workspace-title">
        <div>
          <p className="bbt-section-label">Workspace offline por serviço</p>
          <h2 id="offline-workspace-title" className="mt-1 font-semibold text-bbt-primary dark:text-white">
            Da solicitação ao voucher
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            A OS permanece no mesmo fluxo governado: o consultor cota, o solicitante escolhe, a aprovação antecede a reserva e a emissão gera o voucher.
          </p>
        </div>

        <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-7" aria-label="Etapas do fluxo offline">
          {OFFLINE_FLOW_STAGES.map((stage, index) => {
            const completed = activeStage >= 0 && index < activeStage
            const active = index === activeStage
            return (
              <li
                key={stage}
                aria-current={active ? 'step' : undefined}
                className={`rounded-lg border px-3 py-3 text-sm transition ${
                  active
                    ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-white'
                    : completed
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200'
                      : 'border-bbt-gray-100 text-slate-500 dark:border-slate-700'
                }`}
              >
                <span className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  {completed
                    ? <Check className="h-4 w-4" aria-hidden="true" />
                    : <Circle className={`h-3.5 w-3.5 ${active ? 'fill-current' : ''}`} aria-hidden="true" />}
                  Etapa {index + 1}
                </span>
                <span className="font-semibold">{stage}</span>
              </li>
            )
          })}
        </ol>

        {!context.demandId && (
          <p className="mt-3 text-xs text-slate-500">
            Selecione uma Serial/OS abaixo para posicionar a demanda no fluxo.
          </p>
        )}
      </section>

      <section className="bbt-card p-3" aria-label="Área de trabalho do consultor">
        <div className={`grid gap-2 ${panelGridClass}`} role="tablist" aria-label="Etapa operacional offline">
          {props.canQuoteHotels && <button
            type="button"
            role="tab"
            aria-selected={panel === 'hotel_quote'}
            onClick={() => selectPanel('hotel_quote')}
            className={`flex items-start gap-3 rounded-lg border p-4 text-left transition ${
              panel === 'hotel_quote'
                ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-white'
                : 'border-bbt-gray-100 hover:border-bbt-accent/60 dark:border-slate-700'
            }`}
          >
            <BedDouble className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span>
              <span className="block text-sm font-semibold">Cotação de hotel</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                Monte alternativas para o solicitante escolher antes da aprovação.
              </span>
            </span>
          </button>}
          {canQuoteAir && <button
            type="button"
            role="tab"
            aria-selected={panel === 'air_quote'}
            onClick={() => selectPanel('air_quote')}
            className={`flex items-start gap-3 rounded-lg border p-4 text-left transition ${
              panel === 'air_quote'
                ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-white'
                : 'border-bbt-gray-100 hover:border-bbt-accent/60 dark:border-slate-700'
            }`}
          >
            <Plane className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span>
              <span className="block text-sm font-semibold">Cotação aérea</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                Monte itinerários com conexões, bagagem, tarifas e prazo de emissão.
              </span>
            </span>
          </button>}
          {props.canOperateReservations && <button
            type="button"
            role="tab"
            aria-selected={panel === 'reservation'}
            onClick={() => selectPanel('reservation')}
            className={`flex items-start gap-3 rounded-lg border p-4 text-left transition ${
              panel === 'reservation'
                ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-white'
                : 'border-bbt-gray-100 hover:border-bbt-accent/60 dark:border-slate-700'
            }`}
          >
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span>
              <span className="block text-sm font-semibold">Reserva, emissão e correção</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                Conclua a operação aprovada e gere o voucher, ou corrija a reserva.
              </span>
            </span>
          </button>}
        </div>
      </section>

      {panel === 'hotel_quote' && props.canQuoteHotels ? (
        <OfflineHotelQuoteForm
          demands={quoteDemands}
          companies={quoteCompanies}
          initialDemandId={sharedDemandId || undefined}
          onCompleted={props.onCompleted}
          onContextChange={handleHotelQuoteContext}
        />
      ) : panel === 'air_quote' && canQuoteAir ? (
        <OfflineAirQuoteWorkspace
          demands={quoteDemands}
          companies={quoteCompanies}
          initialDemandId={sharedDemandId || undefined}
          onCompleted={props.onCompleted}
          onContextChange={handleAirQuoteContext}
        />
      ) : (
        <OfflineTravelOperationForm
          demands={reservationDemands}
          companies={reservationCompanies}
          reservations={reservationRecords}
          initialDemandId={sharedDemandId || undefined}
          onCompleted={props.onCompleted}
          onContextChange={handleOperationContext}
        />
      )}
    </div>
  )
}

export default OfflineTravelWorkspace

function stageFromContext(context: OfflineTravelContext): number {
  if (!context.demandId) return -1
  if (context.operation === 'correct_existing') return 4
  if (context.operation === 'issue_existing') return 5

  const stageByStatus: Record<string, number> = {
    draft: 0,
    submitted: 0,
    pending_merit_approval: 0,
    approved_for_quotation: 1,
    quoting: 1,
    pending_choice: 2,
    pending_cost_approval: 3,
    approved: 4,
    reserving: 4,
    reserved: 4,
    pending_issuance: 5,
    issuing: 5,
    partially_issued: 5,
    issued: 6,
    closed: 6,
  }
  return stageByStatus[context.lifecycleStatus] ?? 0
}

function demandLifecycleStatus(demand: Atendimento): string {
  return String(demand.relational_lifecycle_status || demand.status || '').trim().toLowerCase()
}

function isHotelDemand(demand: Atendimento): boolean {
  const service = String(demand.tipo_servico || '').trim().toLowerCase()
  return service === 'hotel' || service === 'hotelaria' || service.includes('hosped')
}

function isAirDemand(demand: Atendimento): boolean {
  const service = String(demand.tipo_servico || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
  return service === 'aereo' || service === 'air'
}

function canReceiveQuote(lifecycleStatus: string): boolean {
  return [
    'draft',
    'submitted',
    'approved_for_quotation',
    'quoting',
    'pending_choice',
  ].includes(lifecycleStatus)
}

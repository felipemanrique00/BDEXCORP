'use client'

import {
  AlertTriangle,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Hotel,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { listDemandsFromServer } from '@/lib/demands-client'
import {
  OfflineHotelQuoteClientError,
  listOfflineHotelQuotesFromServer,
  selectOfflineQuoteOptionFromServer,
} from '@/lib/offline-travel/quote-client'
import type {
  OfflineHotelQuoteListReadModel,
  OfflineHotelQuoteOptionReadModel,
  OfflineHotelQuoteReadModel,
} from '@/lib/offline-travel/quote-schema'
import type { Atendimento } from '@/types'

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

export interface OfflineQuoteChoicePanelProps {
  demands: Atendimento[]
  requesterId?: string | null
  /** Limits the embedded workspace to one demand, as used by the company portal detail. */
  focusDemandId?: string
  /** Internal screens may discover eligible demands; embedded corporate views must provide projected demands. */
  discoverServerDemands?: boolean
  onCompleted: () => void
}

interface DemandQuoteRound {
  demand: Atendimento
  list: OfflineHotelQuoteListReadModel
  quote: OfflineHotelQuoteReadModel
}

export function OfflineQuoteChoicePanel({
  demands,
  requesterId,
  focusDemandId,
  discoverServerDemands = true,
  onCompleted,
}: OfflineQuoteChoicePanelProps) {
  const [rounds, setRounds] = useState<DemandQuoteRound[]>([])
  const [serverDemands, setServerDemands] = useState<Atendimento[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [demandLoadError, setDemandLoadError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [selectedByQuote, setSelectedByQuote] = useState<Record<string, string>>({})
  const [confirmedByQuote, setConfirmedByQuote] = useState<Record<string, boolean>>({})
  const [submittingQuoteId, setSubmittingQuoteId] = useState('')
  const [completedDemandIds, setCompletedDemandIds] = useState<Set<string>>(() => new Set())
  const [clock, setClock] = useState<number | null>(null)
  const idempotencyKeysRef = useRef(new Map<string, string>())

  const requesterDemandCandidates = useMemo(() => {
    const exactRequesterId = String(requesterId || '').trim()
    const byId = new Map<string, Atendimento>()

    for (const demand of [...demands, ...serverDemands]) {
      // A projecao legada no navegador pode continuar em "draft" mesmo depois
      // de o consultor publicar a cotacao no banco relacional. A autorizacao e
      // o estado decisivo sao validados pelo GET server-side logo abaixo.
      if (!isHotelDemand(demand) || isClosedDemand(demand)) continue
      if (focusDemandId && demand.id !== focusDemandId) continue
      if (completedDemandIds.has(demand.id)) continue
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
    void listDemandsFromServer({
      lifecycleStatus: 'pending_choice',
      serviceType: 'hotel',
      limit: 200,
    })
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
    setClock(Date.now())
    const interval = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let active = true

    if (requesterDemandCandidates.length === 0) {
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
        list: await listOfflineHotelQuotesFromServer(demand.id),
      })),
    ).then((results) => {
      if (!active) return

      const authorizedRounds: DemandQuoteRound[] = []
      const errors: string[] = []

      for (const result of results) {
        if (result.status === 'rejected') {
          if (!isRequesterHiddenError(result.reason)) errors.push(errorMessage(result.reason))
          continue
        }

        const { demand, list } = result.value
        if (String(list.lifecycleStatus || '') !== 'pending_choice') continue

        const currentQuote = (list.quotes || [])[0]
        if (!currentQuote) continue
        if (currentQuote.demandId !== demand.id || String(currentQuote.lifecycleStatus || '') !== 'pending_choice') continue
        if (currentQuote.status !== 'completed' || isQuoteExpired(currentQuote, Date.now()) || hasActiveSelection(currentQuote)) continue
        authorizedRounds.push({ demand, list, quote: currentQuote })
      }

      authorizedRounds.sort((left, right) => (
        String(right.quote.createdAt || '').localeCompare(String(left.quote.createdAt || ''))
      ))
      setRounds(authorizedRounds)
      setLoadError(errors[0] || '')
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => {
      active = false
    }
  }, [candidateKey, reloadToken, requesterDemandCandidates])

  async function chooseOption(round: DemandQuoteRound) {
    const { quote } = round
    const optionId = selectedByQuote[quote.id]
    const confirmed = confirmedByQuote[quote.id] === true
    const expired = isQuoteExpired(quote, clock)
    const alreadySelected = hasActiveSelection(quote)
    const lifecycleVersion = positiveVersion(quote.lifecycleVersion || round.list.lifecycleVersion)

    if (!optionId) return toast.error('Selecione uma opção de hospedagem.')
    if (!confirmed) return toast.error('Confirme que revisou os valores e as condições da opção.')
    if (quote.status !== 'completed' || expired || alreadySelected || !lifecycleVersion) {
      return toast.error('Esta cotação não está mais disponível para escolha. Atualize a página.')
    }

    const operationKey = `${quote.id}:${optionId}`
    const idempotencyKey = idempotencyKeysRef.current.get(operationKey) || createSelectionKey()
    idempotencyKeysRef.current.set(operationKey, idempotencyKey)
    setSubmittingQuoteId(quote.id)

    try {
      const result = await selectOfflineQuoteOptionFromServer({
        demandId: quote.demandId,
        quoteId: quote.id,
        optionId,
        expectedLifecycleVersion: lifecycleVersion,
        confirmed: true,
        idempotencyKey,
      })

      idempotencyKeysRef.current.delete(operationKey)
      setCompletedDemandIds((current) => new Set(current).add(quote.demandId))
      setSelectedByQuote((current) => omitKey(current, quote.id))
      setConfirmedByQuote((current) => omitKey(current, quote.id))

      if (result.status === 'pending_approval') {
        toast.success('Escolha registrada e enviada para aprovação.')
      } else {
        toast.success('Escolha registrada. A solicitação seguirá para reserva.')
      }
      onCompleted()
    } catch (error) {
      toast.error(errorMessage(error))
      if (error instanceof OfflineHotelQuoteClientError && error.status === 409) {
        setReloadToken((current) => current + 1)
        onCompleted()
      }
    } finally {
      setSubmittingQuoteId('')
    }
  }

  const visibleError = loadError || demandLoadError

  if (!loading && rounds.length === 0 && !visibleError) return null

  return (
    <section className="bbt-card overflow-hidden" aria-labelledby="offline-quote-choice-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700">
        <div>
          <h3 id="offline-quote-choice-title" className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white">
            <Hotel className="h-4 w-4 text-bbt-accent" />
            Cotações disponíveis para escolha
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Compare valores e condições antes de encaminhar a opção escolhida para aprovação.
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

      {loading && rounds.length === 0 ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Consultando cotações autorizadas...
        </div>
      ) : visibleError && rounds.length === 0 ? (
        <div className="flex items-start gap-2 p-5 text-sm text-red-700 dark:text-red-300" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Não foi possível consultar as cotações.</div>
            <div className="mt-0.5 text-xs opacity-90">{visibleError}</div>
          </div>
        </div>
      ) : (
        <div className="space-y-5 bg-bbt-gray-50/60 p-4 dark:bg-slate-900/20">
          {visibleError && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Algumas cotações não puderam ser atualizadas: {visibleError}
            </div>
          )}
          {rounds.map((round) => (
            <QuoteRoundCard
              key={round.quote.id}
              round={round}
              selectedOptionId={selectedByQuote[round.quote.id] || ''}
              confirmed={confirmedByQuote[round.quote.id] === true}
              submitting={submittingQuoteId === round.quote.id}
              clock={clock}
              onSelect={(optionId) => {
                setSelectedByQuote((current) => ({ ...current, [round.quote.id]: optionId }))
                setConfirmedByQuote((current) => ({ ...current, [round.quote.id]: false }))
              }}
              onConfirm={(confirmed) => {
                setConfirmedByQuote((current) => ({ ...current, [round.quote.id]: confirmed }))
              }}
              onSubmit={() => void chooseOption(round)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

interface QuoteRoundCardProps {
  round: DemandQuoteRound
  selectedOptionId: string
  confirmed: boolean
  submitting: boolean
  clock: number | null
  onSelect: (optionId: string) => void
  onConfirm: (confirmed: boolean) => void
  onSubmit: () => void
}

function QuoteRoundCard({
  round,
  selectedOptionId,
  confirmed,
  submitting,
  clock,
  onSelect,
  onConfirm,
  onSubmit,
}: QuoteRoundCardProps) {
  const { demand, quote } = round
  const hotelDetails = demand.detalhes_hotel
  const expired = isQuoteExpired(quote, clock)
  const alreadySelected = hasActiveSelection(quote)
  const selectable = quote.status === 'completed'
    && quote.lifecycleStatus === 'pending_choice'
    && !expired
    && !alreadySelected
    && positiveVersion(quote.lifecycleVersion || round.list.lifecycleVersion) !== null

  return (
    <article className="overflow-hidden rounded-lg border border-bbt-gray-100 bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="grid gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-bbt-primary dark:text-white">
              Pedido {quote.demandNumber || demand.serial_os || demand.id}
            </span>
            <QuoteStatusBadge quote={quote} expired={expired} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {hotelDetails?.cidade || 'Destino não informado'}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDateOnly(hotelDetails?.data_checkin)} a {formatDateOnly(hotelDetails?.data_checkout)}
            </span>
            <span className="inline-flex items-center gap-1">
              <BedDouble className="h-3.5 w-3.5" />
              {pluralize(hotelDetails?.rooms?.length || 0, 'quarto', 'quartos')}
            </span>
          </div>
        </div>
        <div className="text-left text-xs text-slate-500 md:text-right">
          <div>Rodada publicada em {formatDateTime(quote.createdAt)}</div>
          <div className={expired ? 'mt-1 font-semibold text-red-600 dark:text-red-300' : 'mt-1'}>
            Validade: {quote.expiresAt ? formatDateTime(quote.expiresAt) : 'não informada'}
          </div>
        </div>
      </div>

      <fieldset className="space-y-3 p-4" disabled={!selectable || submitting}>
        <legend className="sr-only">Opções da cotação do pedido {quote.demandNumber}</legend>
        {quote.options.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-600">
            Esta rodada não possui opções publicadas.
          </div>
        ) : quote.options.map((option, index) => (
          <QuoteOptionCard
            key={option.id}
            quoteId={quote.id}
            option={option}
            optionNumber={index + 1}
            checked={selectedOptionId === option.id || option.selected}
            disabled={!selectable || submitting || option.selected}
            onSelect={() => onSelect(option.id)}
          />
        ))}
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-bbt-gray-100 bg-bbt-gray-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/20 sm:flex-row sm:items-center sm:justify-between">
        {alreadySelected ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Opção já escolhida nesta demanda.
          </div>
        ) : expired ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <Clock3 className="h-4 w-4" />
            Cotação expirada. Solicite uma nova rodada.
          </div>
        ) : quote.status !== 'completed' ? (
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <Clock3 className="h-4 w-4" />
            A cotação ainda não foi publicada para escolha.
          </div>
        ) : (
          <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-bbt-primary focus:ring-bbt-accent"
              checked={confirmed}
              onChange={(event) => onConfirm(event.target.checked)}
              disabled={!selectedOptionId || submitting}
            />
            <span>Revisei valores, prazo e regras de cancelamento desta opção.</span>
          </label>
        )}

        {!alreadySelected && !expired && quote.status === 'completed' && (
          <button
            type="button"
            className="bbt-button-primary shrink-0"
            onClick={onSubmit}
            disabled={!selectable || !selectedOptionId || !confirmed || submitting}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {submitting ? 'Registrando...' : 'Escolher e enviar'}
          </button>
        )}
      </div>
    </article>
  )
}

interface QuoteOptionCardProps {
  quoteId: string
  option: OfflineHotelQuoteOptionReadModel
  optionNumber: number
  checked: boolean
  disabled: boolean
  onSelect: () => void
}

function QuoteOptionCard({
  quoteId,
  option,
  optionNumber,
  checked,
  disabled,
  onSelect,
}: QuoteOptionCardProps) {
  const breakdown = option.breakdown

  return (
    <label className={`block rounded-lg border p-4 transition ${
      checked
        ? 'border-bbt-accent bg-cyan-50/60 ring-1 ring-bbt-accent/30 dark:bg-cyan-950/20'
        : 'border-bbt-gray-100 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
    } ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <input
          type="radio"
          name={`offline-quote-${quoteId}`}
          value={option.id}
          checked={checked}
          onChange={onSelect}
          disabled={disabled}
          className="mt-1 h-4 w-4 border-slate-300 text-bbt-primary focus:ring-bbt-accent"
          aria-label={`Escolher opção ${optionNumber}: ${option.hotel.name}`}
        />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-bbt-accent">Opção {optionNumber}</span>
            {option.selected && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                Escolhida
              </span>
            )}
          </div>
          <div className="mt-1 font-bold text-bbt-primary dark:text-white">{option.hotel.name}</div>
          <div className="mt-1 text-xs text-slate-500">
            {[option.hotel.category, option.hotel.cityName, option.hotel.subdivisionCode]
              .filter(Boolean)
              .join(' · ') || 'Dados do hotel não informados'}
          </div>
          {option.hotel.address && <div className="mt-0.5 text-xs text-slate-500">{option.hotel.address}</div>}

          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
            <Info label="Acomodação" value={option.roomCategory} />
            <Info label="Regime" value={option.mealPlan || 'Não informado'} />
            <Info label="Cancelamento" value={option.refundable ? 'Reembolsável' : 'Não reembolsável'} />
          </div>
        </div>

        <div className="min-w-[180px] rounded-md bg-slate-50 p-3 text-xs dark:bg-slate-900/50">
          <MoneyRow label="Diária" value={breakdown.nightlyRate} currency={breakdown.currency} />
          <MoneyRow label="Taxas/dia" value={breakdown.nightlyTaxes} currency={breakdown.currency} />
          <MoneyRow label={`${breakdown.nights} noite(s) · ${breakdown.roomCount} quarto(s)`} value={breakdown.roomSubtotal + breakdown.taxesSubtotal} currency={breakdown.currency} />
          <MoneyRow label="Taxa de serviço" value={breakdown.serviceFee} currency={breakdown.currency} />
          <div className="mt-2 flex items-end justify-between gap-3 border-t border-slate-200 pt-2 dark:border-slate-700">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Total</span>
            <span className="text-base font-extrabold text-bbt-primary dark:text-white">
              {formatMoney(breakdown.total, breakdown.currency)}
            </span>
          </div>
        </div>
      </div>

      {(option.cancellationDeadline || option.cancellationPolicy || option.paymentTerms || option.notes) && (
        <div className="mt-3 grid gap-2 border-t border-bbt-gray-100 pt-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300 md:grid-cols-2">
          {option.cancellationDeadline && (
            <Info label="Prazo de cancelamento" value={formatDateTime(option.cancellationDeadline)} />
          )}
          {option.cancellationPolicy && <Info label="Política de cancelamento" value={option.cancellationPolicy} />}
          {option.paymentTerms && <Info label="Condições de pagamento" value={option.paymentTerms} />}
          {option.notes && <Info label="Observações" value={option.notes} />}
        </div>
      )}
    </label>
  )
}

function QuoteStatusBadge({ quote, expired }: { quote: OfflineHotelQuoteReadModel; expired: boolean }) {
  const status = expired ? 'expired' : quote.status
  const presentation: Record<string, { label: string; className: string }> = {
    pending: { label: 'Em processamento', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    completed: { label: 'Disponível', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
    selected: { label: 'Escolhida', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    expired: { label: 'Expirada', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    failed: { label: 'Indisponível', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  }
  const item = presentation[status] || { label: status, className: 'bg-slate-100 text-slate-700' }
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.className}`}>{item.label}</span>
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-semibold text-slate-700 dark:text-slate-200">{label}: </span>
      <span>{value}</span>
    </div>
  )
}

function MoneyRow({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-700 dark:text-slate-200">{formatMoney(value, currency)}</span>
    </div>
  )
}

function demandLifecycleStatus(demand: Atendimento): string {
  const relational = String(demand.relational_lifecycle_status || '').trim()
  if (relational) return relational
  if (demand.status === 'aguardando_cliente') return 'pending_choice'
  return String(demand.status || '')
}

function isClosedDemand(demand: Atendimento): boolean {
  return CLOSED_DEMAND_STATUSES.has(demandLifecycleStatus(demand))
}

function isHotelDemand(demand: Atendimento): boolean {
  return String(demand.tipo_servico || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase() === 'hotel'
}

function demandUpdatedAt(demand: Atendimento): string {
  return String(demand.updated_at || demand.created_at || '')
}

function isQuoteExpired(quote: OfflineHotelQuoteReadModel, clock: number | null): boolean {
  if (quote.status === 'expired') return true
  if (clock === null || !quote.expiresAt) return false
  const expiresAt = Date.parse(quote.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt <= clock
}

function hasActiveSelection(quote: OfflineHotelQuoteReadModel): boolean {
  return Boolean(quote.selectedOptionId || quote.options.some((option) => option.selected) || quote.status === 'selected')
}

function positiveVersion(value: number): number | null {
  return Number.isInteger(value) && value > 0 ? value : null
}

function isRequesterHiddenError(error: unknown): boolean {
  return error instanceof OfflineHotelQuoteClientError && REQUESTER_HIDDEN_STATUSES.has(error.status)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Não foi possível concluir a operação de cotação offline.'
}

function createSelectionKey(): string {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${performance.now()}`
  return `offline-hotel-selection:${randomPart}`
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0)
}

function formatDateOnly(value?: string): string {
  const normalized = String(value || '').slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'não informada'
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'não informada'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'não informada'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(parsed)
}

function pluralize(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

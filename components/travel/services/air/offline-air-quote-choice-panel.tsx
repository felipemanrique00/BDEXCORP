'use client'

import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Luggage,
  Plane,
  ReceiptText,
  Route,
  Send,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { formatDecimalInput } from '@/lib/decimal-input'

import { AirlineLogo } from './airline-logo'
import { airQuoteTotalMinor, formatAirMoney } from './pricing'
import type {
  OfflineAirDemandSummary,
  OfflineAirQuoteOptionReadModel,
  OfflineAirQuoteRoundReadModel,
} from './types'

export interface OfflineAirQuoteChoicePanelProps {
  demand: OfflineAirDemandSummary
  quote: OfflineAirQuoteRoundReadModel
  busy?: boolean
  onSelect: (optionId: string) => void | Promise<void>
}

export function OfflineAirQuoteChoicePanel({
  demand,
  quote,
  busy = false,
  onSelect,
}: OfflineAirQuoteChoicePanelProps) {
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [expandedOptionId, setExpandedOptionId] = useState(quote.options[0]?.id || '')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const firstOptionId = quote.options[0]?.id || ''

  useEffect(() => {
    setSelectedOptionId('')
    setExpandedOptionId(firstOptionId)
    setConfirmed(false)
    setError('')
  }, [firstOptionId, quote.id])

  const selectedOption = useMemo(
    () => quote.options.find((option) => option.id === selectedOptionId) || null,
    [quote.options, selectedOptionId],
  )

  async function choose() {
    if (!selectedOption) {
      setError('Selecione uma das opções de voo antes de continuar.')
      return
    }
    if (!confirmed) {
      setError('Confirme que revisou itinerário, valores, prazo e condições.')
      return
    }
    setError('')
    try {
      await onSelect(selectedOption.id)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Não foi possível registrar a escolha.')
    }
  }

  return (
    <section className="bbt-card overflow-hidden" aria-labelledby="offline-air-choice-title" data-offline-air-choice-panel>
      <header className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="offline-air-choice-title" className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white">
              <Plane className="h-4 w-4 text-bbt-accent" />
              Escolha sua opção aérea
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Compare horários, conexões, bagagem, preço e regras antes de encaminhar para aprovação.
            </p>
          </div>
          {quote.expiresAt && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <span className="flex items-center gap-1.5 font-semibold"><Clock3 className="h-3.5 w-3.5" />Cotação disponível até</span>
              <span className="mt-0.5 block tabular-nums">{formatDateTime(quote.expiresAt)}</span>
            </div>
          )}
          {quote.createdAt && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <span className="flex items-center gap-1.5 font-semibold"><ReceiptText className="h-3.5 w-3.5" />Rodada publicada</span>
              <span className="mt-0.5 block tabular-nums">{formatDateTime(quote.createdAt)}</span>
            </div>
          )}
        </div>
      </header>

      <RequestSummary demand={demand} />

      <div className="space-y-4 bg-bbt-gray-50/60 p-4 dark:bg-slate-900/20">
        {quote.options.map((option, index) => {
          const selected = option.id === selectedOptionId
          return (
            <AirChoiceCard
              key={option.id}
              option={option}
              index={index}
              selected={selected}
              expanded={option.id === expandedOptionId}
              disabled={busy}
              radioName={`offline-air-choice-${quote.id}`}
              onSelect={() => {
                setSelectedOptionId(option.id)
                setExpandedOptionId(option.id)
                setConfirmed(false)
                setError('')
              }}
              onToggle={() => setExpandedOptionId((current) => current === option.id ? '' : option.id)}
            />
          )
        })}

        {quote.options.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
            Nenhuma opção aérea foi publicada nesta rodada.
          </div>
        )}
      </div>

      <footer className="space-y-3 border-t border-bbt-gray-100 p-4 dark:border-slate-700">
        {selectedOption && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3 text-xs text-cyan-950 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-100">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-bbt-accent focus:ring-bbt-accent"
              checked={confirmed}
              onChange={(event) => {
                setConfirmed(event.target.checked)
                setError('')
              }}
              disabled={busy}
            />
            <span>
              <strong className="block">Revisei a opção selecionada</strong>
              Confirmo os trechos, passageiros, bagagem, valor total, prazo de emissão e políticas informadas.
            </span>
          </label>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Sua escolha será registrada e seguirá para o fluxo de aprovação aplicável.
          </div>
          <button type="button" className="bbt-button-primary" onClick={() => void choose()} disabled={busy || !quote.options.length}>
            {busy ? <Clock3 className="h-4 w-4 animate-pulse" /> : <Send className="h-4 w-4" />}
            {busy ? 'Enviando...' : 'Escolher e enviar'}
          </button>
        </div>
      </footer>
    </section>
  )
}

function RequestSummary({ demand }: { demand: OfflineAirDemandSummary }) {
  return (
    <div className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Solicitação {demand.number}</div>
        <div className="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200">
          {demand.requestedCabin || 'Cabine não informada'}
        </div>
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <RequestFact icon={<Building2 className="h-3.5 w-3.5" />} label="Empresa" value={demand.companyName || 'Não informada'} />
        <RequestFact icon={<UserRound className="h-3.5 w-3.5" />} label="Solicitante" value={demand.requesterName || 'Não informado'} />
        <RequestFact icon={<Users className="h-3.5 w-3.5" />} label="Passageiros" value={demand.passengers.map((passenger) => passenger.name).join(', ') || 'Não informados'} />
        <RequestFact icon={<Plane className="h-3.5 w-3.5" />} label="Preferências" value={demand.preferredAirlines?.join(', ') || 'Qualquer companhia'} />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {demand.requestedSegments.map((segment, index) => (
          <div key={segment.id} className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
            <Route className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bbt-accent" />
            <div>
              <div className="font-semibold text-bbt-primary dark:text-white">
                {index + 1}. {locationLabel(segment.originCode, segment.originName)} → {locationLabel(segment.destinationCode, segment.destinationName)}
              </div>
              <div className="mt-0.5 text-slate-500">{formatDate(segment.departureDate)} {segment.preferredPeriod || ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RequestFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{icon}{label}</div>
      <div className="mt-0.5 line-clamp-2 text-xs font-medium text-bbt-primary dark:text-white" title={value}>{value}</div>
    </div>
  )
}

function AirChoiceCard({ option, index, selected, expanded, disabled, radioName, onSelect, onToggle }: {
  option: OfflineAirQuoteOptionReadModel
  index: number
  selected: boolean
  expanded: boolean
  disabled: boolean
  radioName: string
  onSelect: () => void
  onToggle: () => void
}) {
  const totalMinor = option.totalMinor ?? airQuoteTotalMinor(option.pricing)
  const connectionCount = Math.max(0, option.segments.length - countJourneys(option.segments))
  const firstSegment = option.segments[0]
  const lastSegment = option.segments[option.segments.length - 1]
  const route = firstSegment && lastSegment
    ? `${locationLabel(firstSegment.originCode, firstSegment.originName)} → ${locationLabel(lastSegment.destinationCode, lastSegment.destinationName)}`
    : 'Itinerário não informado'
  const detailsId = `air-choice-details-${option.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  return (
    <article className={`overflow-hidden rounded-xl border bg-white shadow-sm transition dark:bg-slate-900 ${selected ? 'border-cyan-500 ring-2 ring-cyan-500/20 dark:border-cyan-400' : 'border-slate-200 hover:border-cyan-300 dark:border-slate-700'}`} data-air-choice-option={option.id}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-stretch">
        <label className="flex cursor-pointer items-center border-r border-slate-100 px-4 dark:border-slate-700" title={`Selecionar opção ${option.optionNumber || index + 1}`}>
          <input
            type="radio"
            name={radioName}
            value={option.id}
            checked={selected}
            onChange={onSelect}
            disabled={disabled}
            className="h-4 w-4 border-slate-300 text-bbt-accent focus:ring-bbt-accent"
            aria-label={`Selecionar opção aérea ${option.optionNumber || index + 1}`}
          />
        </label>
        <button type="button" className="grid min-w-0 gap-3 px-4 py-3 text-left sm:grid-cols-2 lg:grid-cols-[1.05fr_1.25fr_1.25fr_1fr_auto] lg:items-center" onClick={onSelect} disabled={disabled} aria-pressed={selected}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${selected ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                {selected ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
              </span>
              Opção {option.optionNumber || index + 1}
            </div>
            <div className="mt-1 truncate text-[11px] text-slate-500">{option.locator || 'Sem localizador na cotação'}</div>
          </div>
          <CompactAirlineFact option={option} />
          <CompactFact label="Itinerário" value={route} helper={connectionCount === 0 ? 'Direto por sentido' : `${connectionCount} conexão${connectionCount === 1 ? '' : 'ões'}`} />
          <CompactFact label="Prazo de emissão" value={formatDateTime(option.issuanceDeadline)} highlight />
          <div className="text-left lg:text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</div>
            <div className="mt-0.5 whitespace-nowrap text-lg font-bold text-bbt-primary dark:text-white">{formatAirMoney(totalMinor, option.pricing.currency)}</div>
          </div>
        </button>
        <button
          type="button"
          className="flex w-11 items-center justify-center border-l border-slate-100 text-slate-500 hover:bg-slate-50 hover:text-bbt-primary focus:outline-none focus:ring-2 focus:ring-inset focus:ring-bbt-accent/30 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
          onClick={onToggle}
          disabled={disabled}
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? 'Ocultar' : 'Mostrar'} detalhes da opção ${option.optionNumber || index + 1}`}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {expanded && <div id={detailsId} className="border-t border-slate-100 dark:border-slate-700">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70">
              <tr>
                <th className="px-3 py-2 font-semibold">Data e hora</th>
                <th className="px-3 py-2 font-semibold">Trecho</th>
                <th className="px-3 py-2 font-semibold">Companhia / voo</th>
                <th className="px-3 py-2 font-semibold">Classe</th>
                <th className="px-3 py-2 font-semibold">Bagagem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {option.segments.map((segment) => (
                <tr key={segment.clientId}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    <span className="block font-medium">Sai {formatDateTime(segment.departureAt)}</span>
                    <span className="block text-slate-500">Chega {formatDateTime(segment.arrivalAt)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="block font-medium text-bbt-primary dark:text-white">{locationLabel(segment.originCode, segment.originName)}</span>
                    <span className="block text-slate-500">→ {locationLabel(segment.destinationCode, segment.destinationName)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex min-w-40 items-center gap-2">
                      <AirlineLogo iataCode={segment.airlineCode} airlineName={segment.airlineName} size="xs" decorative />
                      <div className="min-w-0">
                        <span className="block font-medium">{segment.airlineName || segment.airlineCode}</span>
                        <span className="block text-slate-500">{[segment.airlineCode, segment.flightNumber].filter(Boolean).join(' ')}</span>
                        {segment.equipment && <span className="block text-slate-400">Equip. {segment.equipment}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{segment.bookingClass || '—'}{segment.cabinClass ? ` · ${cabinLabel(segment.cabinClass)}` : ''}</td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1"><Luggage className="h-3.5 w-3.5" />{baggageLabel(segment.baggagePieces)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-5 dark:bg-slate-700">
          <PriceCell label="Tarifa" value={option.pricing.fare} currency={option.pricing.currency} />
          <PriceCell label="Taxas" value={option.pricing.taxes} currency={option.pricing.currency} />
          <PriceCell label="RAV" value={option.pricing.rav} currency={option.pricing.currency} />
          <PriceCell label="RAC" value={option.pricing.rac} currency={option.pricing.currency} />
          <div className="bg-cyan-50 px-3 py-2 dark:bg-cyan-950/30">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">Total</div>
            <div className="mt-0.5 font-bold text-cyan-950 dark:text-cyan-100">{formatAirMoney(totalMinor, option.pricing.currency)}</div>
          </div>
        </div>

        <div className="grid gap-3 p-3 lg:grid-cols-3">
          <InfoBlock icon={<CalendarClock className="h-3.5 w-3.5" />} label="Prazo de emissão" value={formatDateTime(option.issuanceDeadline)} highlight />
          <InfoBlock icon={<ReceiptText className="h-3.5 w-3.5" />} label="Sistema / localizador" value={`${option.reservationSystem || 'Não informado'} · ${option.locator || 'Sem localizador'}`} />
          <InfoBlock icon={<Plane className="h-3.5 w-3.5" />} label="Família / reembolso" value={`${option.fareFamily || 'Família não informada'} · ${option.refundable ? 'Reembolsável' : 'Não reembolsável'}`} />
        </div>

        <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-3 dark:border-slate-700">
          <InfoBlock label="Câmbio informado" value={formatDecimalInput(option.pricing.exchangeRate, 4) || 'Não informado'} />
          <InfoBlock label="Tarifa de referência" value={formatAirMoney(safeMoneyMinor(option.pricing.referenceFare), option.pricing.currency)} />
          <InfoBlock label="Milhagem do itinerário" value={`${Number.parseInt(option.pricing.mileage || '0', 10) || 0} milhas`} />
        </div>

        {(option.fareRules || option.cancellationPolicy || option.changePolicy || option.observations) && (
          <div className="grid gap-3 border-t border-slate-100 p-3 text-xs lg:grid-cols-2 dark:border-slate-700">
            {option.fareRules && <InfoBlock label="Regras tarifárias" value={option.fareRules} />}
            {option.cancellationPolicy && <InfoBlock label="Política de cancelamento" value={option.cancellationPolicy} />}
            {option.changePolicy && <InfoBlock label="Política de alteração" value={option.changePolicy} />}
            {option.observations && <InfoBlock label="Observações" value={option.observations} />}
          </div>
        )}
      </div>}
    </article>
  )
}

function CompactFact({ label, value, helper, highlight = false }: { label: string; value: string; helper?: string; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${highlight ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-bbt-primary dark:text-white" title={value}>{value}</div>
      {helper && <div className="truncate text-[11px] text-slate-500" title={helper}>{helper}</div>}
    </div>
  )
}

function CompactAirlineFact({ option }: { option: OfflineAirQuoteOptionReadModel }) {
  const identities = optionAirlineIdentities(option)
  const label = primaryAirlineLabel(option)

  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Companhia</div>
      <div className="mt-0.5 flex min-w-0 items-center gap-2">
        <div className="flex shrink-0 items-center -space-x-1">
          {identities.slice(0, 2).map((identity) => (
            <AirlineLogo
              key={`${identity.code}-${identity.name}`}
              iataCode={identity.code}
              airlineName={identity.name}
              size="md"
              decorative
              className="bg-white dark:bg-slate-900"
            />
          ))}
          {!identities.length && <AirlineLogo iataCode="" airlineName="Companhia não informada" size="md" decorative />}
        </div>
        <span className="truncate text-xs font-semibold text-bbt-primary dark:text-white" title={label}>{label}</span>
      </div>
    </div>
  )
}

function PriceCell({ label, value, currency }: { label: string; value: string; currency: string }) {
  return (
    <div className="bg-white px-3 py-2 dark:bg-slate-900">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-semibold text-bbt-primary dark:text-white">{formatAirMoney(safeMoneyMinor(value), currency)}</div>
    </div>
  )
}

function InfoBlock({ icon, label, value, highlight = false }: { icon?: ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md px-3 py-2 ${highlight ? 'border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30' : 'bg-slate-50 dark:bg-slate-800/60'}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{icon}{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-xs font-medium text-slate-800 dark:text-slate-100">{value}</div>
    </div>
  )
}

function safeMoneyMinor(value: string): number {
  return airQuoteTotalMinor({ fare: value, taxes: '0', rav: '0', rac: '0' })
}

function countJourneys(segments: OfflineAirQuoteOptionReadModel['segments']): number {
  if (!segments.length) return 0
  let journeys = 1
  for (let index = 1; index < segments.length; index += 1) {
    const previousArrival = Date.parse(segments[index - 1].arrivalAt)
    const nextDeparture = Date.parse(segments[index].departureAt)
    if (Number.isFinite(previousArrival) && Number.isFinite(nextDeparture) && nextDeparture - previousArrival > 12 * 60 * 60 * 1000) {
      journeys += 1
    }
  }
  return journeys
}

function primaryAirlineLabel(option: OfflineAirQuoteOptionReadModel): string {
  const airlines = optionAirlineIdentities(option).map((identity) => identity.name || identity.code)
  return airlines.join(' + ') || 'Companhia não informada'
}

function optionAirlineIdentities(option: OfflineAirQuoteOptionReadModel): Array<{ code: string; name: string }> {
  const candidates = [
    { code: option.validatingAirlineCode || '', name: option.validatingAirlineName || '' },
    ...option.segments.map((segment) => ({ code: segment.airlineCode || '', name: segment.airlineName || '' })),
  ]
  const seen = new Set<string>()

  return candidates.flatMap((identity) => {
    const code = identity.code.trim().toUpperCase()
    const name = identity.name.trim()
    if (!code && !name) return []
    const key = code || name.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) return []
    seen.add(key)
    return [{ code, name }]
  })
}

function cabinLabel(value: string): string {
  return ({
    economy: 'Econômica',
    premium_economy: 'Econômica premium',
    business: 'Executiva',
    first: 'Primeira classe',
  } as Record<string, string>)[value] || value
}

function baggageLabel(value: string): string {
  const pieces = Number.parseInt(value, 10)
  if (!Number.isInteger(pieces) || pieces < 0) return 'Não informada'
  return `${pieces} ${pieces === 1 ? 'volume' : 'volumes'}`
}

function locationLabel(code: string | undefined, name: string): string {
  return [code?.trim() ? `(${code.trim().toUpperCase()})` : '', name.trim()].filter(Boolean).join(' ')
}

function formatDate(value: string): string {
  if (!value) return 'Data não informada'
  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR').format(parsed)
}

function formatDateTime(value: string): string {
  if (!value) return 'Não informado'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.replace('T', ' ')
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

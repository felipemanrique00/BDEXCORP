'use client'

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Luggage,
  Plane,
  ReceiptText,
  Route,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

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
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setSelectedOptionId('')
    setConfirmed(false)
    setError('')
  }, [quote.id])

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
              disabled={busy}
              onSelect={() => {
                setSelectedOptionId(option.id)
                setConfirmed(false)
                setError('')
              }}
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Solicitação {demand.number}</div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Users className="h-3.5 w-3.5" />
          {demand.passengers.map((passenger) => passenger.name).join(', ') || 'Viajante não informado'}
        </div>
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

function AirChoiceCard({ option, index, selected, disabled, onSelect }: {
  option: OfflineAirQuoteOptionReadModel
  index: number
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const totalMinor = option.totalMinor ?? airQuoteTotalMinor(option.pricing)
  const connectionCount = Math.max(0, option.segments.length - countJourneys(option.segments))

  return (
    <article className={`overflow-hidden rounded-xl border bg-white shadow-sm transition dark:bg-slate-900 ${selected ? 'border-cyan-500 ring-2 ring-cyan-500/20 dark:border-cyan-400' : 'border-slate-200 hover:border-cyan-300 dark:border-slate-700'}`} data-air-choice-option={option.id}>
      <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left" onClick={onSelect} disabled={disabled} aria-pressed={selected}>
        <div className="flex items-center gap-3">
          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${selected ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {selected ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
          </span>
          <div>
            <div className="font-bold text-bbt-primary dark:text-white">Opção {option.optionNumber || index + 1}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {primaryAirlineLabel(option)} · {connectionCount === 0 ? 'Direto por sentido' : `${connectionCount} conexão${connectionCount === 1 ? '' : 'ões'}`}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Total</div>
          <div className="text-lg font-bold text-bbt-primary dark:text-white">{formatAirMoney(totalMinor, option.pricing.currency)}</div>
        </div>
      </button>

      <div className="border-t border-slate-100 dark:border-slate-700">
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
                    <span className="block font-medium">{segment.airlineName || segment.airlineCode}</span>
                    <span className="block text-slate-500">{[segment.airlineCode, segment.flightNumber].filter(Boolean).join(' ')}</span>
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

        {(option.fareRules || option.cancellationPolicy || option.changePolicy || option.observations) && (
          <div className="grid gap-3 border-t border-slate-100 p-3 text-xs lg:grid-cols-2 dark:border-slate-700">
            {option.fareRules && <InfoBlock label="Regras tarifárias" value={option.fareRules} />}
            {option.cancellationPolicy && <InfoBlock label="Política de cancelamento" value={option.cancellationPolicy} />}
            {option.changePolicy && <InfoBlock label="Política de alteração" value={option.changePolicy} />}
            {option.observations && <InfoBlock label="Observações" value={option.observations} />}
          </div>
        )}
      </div>
    </article>
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
  const airlines = [...new Set(option.segments.map((segment) => segment.airlineName || segment.airlineCode).filter(Boolean))]
  return airlines.join(' + ') || 'Companhia não informada'
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

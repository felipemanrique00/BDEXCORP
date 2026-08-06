'use client'

import {
  AlertTriangle,
  Building2,
  Clock3,
  Luggage,
  Plane,
  Plus,
  ReceiptText,
  Route,
  Send,
  Trash2,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { DateTimeInput } from '@/components/ui/date-input'

import {
  MAX_AIR_QUOTE_OPTIONS,
  MAX_AIR_SEGMENTS,
  MIN_AIR_QUOTE_OPTIONS,
  airQuoteTotalMinor,
  createEmptyAirQuoteOption,
  createEmptyAirSegment,
  formatAirMoney,
  isValidMoneyInput,
} from './pricing'
import type {
  OfflineAirDemandSummary,
  OfflineAirPriceDraft,
  OfflineAirQuoteFormValue,
  OfflineAirQuoteOptionDraft,
  OfflineAirQuoteSegmentDraft,
} from './types'

export interface OfflineAirQuoteFormProps {
  demand: OfflineAirDemandSummary
  initialOptions?: OfflineAirQuoteOptionDraft[]
  busy?: boolean
  onSubmit: (value: OfflineAirQuoteFormValue) => void | Promise<void>
  onCancel?: () => void
}

export function OfflineAirQuoteForm({
  demand,
  initialOptions,
  busy = false,
  onSubmit,
  onCancel,
}: OfflineAirQuoteFormProps) {
  const [options, setOptions] = useState<OfflineAirQuoteOptionDraft[]>(() => (
    normalizeInitialOptions(initialOptions, demand)
  ))
  const [errors, setErrors] = useState<string[]>([])
  const nextOptionNumberRef = useRef(options.length + 1)

  useEffect(() => {
    const normalized = normalizeInitialOptions(initialOptions, demand)
    setOptions(normalized)
    setErrors([])
    nextOptionNumberRef.current = normalized.length + 1
  }, [demand, initialOptions])

  const lowestTotalMinor = useMemo(
    () => options.reduce<number | null>((lowest, option) => {
      const total = airQuoteTotalMinor(option.pricing)
      return lowest === null || total < lowest ? total : lowest
    }, null),
    [options],
  )

  function addOption() {
    if (options.length >= MAX_AIR_QUOTE_OPTIONS) return
    const nextNumber = nextOptionNumberRef.current
    nextOptionNumberRef.current += 1
    setOptions((current) => [
      ...current,
      createEmptyAirQuoteOption(nextNumber, demand.requestedSegments),
    ])
    setErrors([])
  }

  function removeOption(clientId: string) {
    if (options.length <= MIN_AIR_QUOTE_OPTIONS) {
      setErrors(['A cotação aérea deve manter pelo menos uma opção.'])
      return
    }
    setOptions((current) => current.filter((option) => option.clientId !== clientId))
    setErrors([])
  }

  function patchOption(clientId: string, patch: Partial<OfflineAirQuoteOptionDraft>) {
    setOptions((current) => current.map((option) => (
      option.clientId === clientId ? { ...option, ...patch } : option
    )))
    setErrors([])
  }

  function patchPricing(clientId: string, patch: Partial<OfflineAirPriceDraft>) {
    setOptions((current) => current.map((option) => (
      option.clientId === clientId
        ? { ...option, pricing: { ...option.pricing, ...patch } }
        : option
    )))
    setErrors([])
  }

  function addSegment(optionId: string) {
    setOptions((current) => current.map((option) => {
      if (option.clientId !== optionId || option.segments.length >= MAX_AIR_SEGMENTS) return option
      return {
        ...option,
        segments: [...option.segments, createEmptyAirSegment(option.segments.length + 1)],
      }
    }))
    setErrors([])
  }

  function removeSegment(optionId: string, segmentId: string) {
    setOptions((current) => current.map((option) => {
      if (option.clientId !== optionId || option.segments.length <= 1) return option
      return {
        ...option,
        segments: option.segments.filter((segment) => segment.clientId !== segmentId),
      }
    }))
    setErrors([])
  }

  function patchSegment(optionId: string, segmentId: string, patch: Partial<OfflineAirQuoteSegmentDraft>) {
    setOptions((current) => current.map((option) => (
      option.clientId === optionId
        ? {
            ...option,
            segments: option.segments.map((segment) => (
              segment.clientId === segmentId ? { ...segment, ...patch } : segment
            )),
          }
        : option
    )))
    setErrors([])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateOptions(options)
    if (nextErrors.length) {
      setErrors(nextErrors)
      return
    }

    setErrors([])
    try {
      await onSubmit({ demandId: demand.id, options })
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Não foi possível publicar a cotação aérea.'])
    }
  }

  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)} data-offline-air-quote-form>
      <DemandSummary demand={demand} />

      <section className="bbt-card overflow-hidden" aria-labelledby="air-quote-options-title">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700">
          <div>
            <h3 id="air-quote-options-title" className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white">
              <Plane className="h-4 w-4 text-bbt-accent" />
              Opções de voo
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Cadastre de uma a dez alternativas. Cada opção aceita conexões e trechos de ida e volta.
            </p>
          </div>
          <button
            type="button"
            className="bbt-button-secondary h-9 text-xs"
            onClick={addOption}
            disabled={busy || options.length >= MAX_AIR_QUOTE_OPTIONS}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar opção
          </button>
        </header>

        <div className="space-y-5 bg-bbt-gray-50/60 p-4 dark:bg-slate-900/20">
          {options.map((option, index) => (
            <AirQuoteOptionEditor
              key={option.clientId}
              option={option}
              index={index}
              disabled={busy}
              canRemove={options.length > MIN_AIR_QUOTE_OPTIONS}
              onRemove={() => removeOption(option.clientId)}
              onPatch={(patch) => patchOption(option.clientId, patch)}
              onPatchPricing={(patch) => patchPricing(option.clientId, patch)}
              onAddSegment={() => addSegment(option.clientId)}
              onRemoveSegment={(segmentId) => removeSegment(option.clientId, segmentId)}
              onPatchSegment={(segmentId, patch) => patchSegment(option.clientId, segmentId, patch)}
            />
          ))}
        </div>
      </section>

      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200" role="alert">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Revise a cotação antes de publicar
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {errors.slice(0, 8).map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bbt-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{options.length} {options.length === 1 ? 'opção cadastrada' : 'opções cadastradas'} · menor valor</div>
          <div className="mt-0.5 text-lg font-bold text-bbt-primary dark:text-white">
            {formatAirMoney(lowestTotalMinor || 0, options[0]?.pricing.currency || 'BRL')}
          </div>
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" className="bbt-button-ghost" onClick={onCancel} disabled={busy}>
              Cancelar
            </button>
          )}
          <button type="submit" className="bbt-button-primary" disabled={busy}>
            <Send className="h-4 w-4" />
            {busy ? 'Publicando...' : 'Publicar para escolha'}
          </button>
        </div>
      </footer>
    </form>
  )
}

function DemandSummary({ demand }: { demand: OfflineAirDemandSummary }) {
  return (
    <section className="bbt-card overflow-hidden" aria-labelledby="air-demand-summary-title">
      <header className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
        <h3 id="air-demand-summary-title" className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white">
          <Route className="h-4 w-4 text-bbt-accent" />
          Solicitação {demand.number}
        </h3>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{demand.companyName}</span>
          <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{passengerLabel(demand.passengers.length)}</span>
          {demand.requestedCabin && <span>Classe solicitada: <strong>{demand.requestedCabin}</strong></span>}
          {Boolean(demand.preferredAirlines?.length) && (
            <span>Companhias preferenciais: <strong>{demand.preferredAirlines?.join(', ')}</strong></span>
          )}
        </div>
      </header>
      <div className="grid gap-2 p-4 md:grid-cols-2">
        {demand.requestedSegments.map((segment, index) => (
          <div key={segment.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/60">
            <div className="font-semibold text-bbt-primary dark:text-white">Trecho solicitado {index + 1}</div>
            <div className="mt-1 flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <span>{locationLabel(segment.originCode, segment.originName)}</span>
              <span aria-hidden="true">→</span>
              <span>{locationLabel(segment.destinationCode, segment.destinationName)}</span>
            </div>
            <div className="mt-1 text-slate-500">{formatRequestedDate(segment.departureDate)} {segment.preferredPeriod || ''}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

interface AirQuoteOptionEditorProps {
  option: OfflineAirQuoteOptionDraft
  index: number
  disabled: boolean
  canRemove: boolean
  onRemove: () => void
  onPatch: (patch: Partial<OfflineAirQuoteOptionDraft>) => void
  onPatchPricing: (patch: Partial<OfflineAirPriceDraft>) => void
  onAddSegment: () => void
  onRemoveSegment: (segmentId: string) => void
  onPatchSegment: (segmentId: string, patch: Partial<OfflineAirQuoteSegmentDraft>) => void
}

function AirQuoteOptionEditor({
  option,
  index,
  disabled,
  canRemove,
  onRemove,
  onPatch,
  onPatchPricing,
  onAddSegment,
  onRemoveSegment,
  onPatchSegment,
}: AirQuoteOptionEditorProps) {
  const totalMinor = airQuoteTotalMinor(option.pricing)

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900" data-air-quote-option={option.clientId}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-50 text-sm font-bold text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
            {index + 1}
          </span>
          <div>
            <h4 className="font-bold text-bbt-primary dark:text-white">Opção aérea {index + 1}</h4>
            <p className="text-xs text-slate-500">{option.segments.length} {option.segments.length === 1 ? 'trecho' : 'trechos'} · {formatAirMoney(totalMinor, option.pricing.currency)}</p>
          </div>
        </div>
        <button
          type="button"
          className="bbt-button-ghost h-8 px-2 text-xs text-red-600 disabled:opacity-35"
          onClick={onRemove}
          disabled={disabled || !canRemove}
          aria-label={`Remover opção aérea ${index + 1}`}
          title={canRemove ? 'Remover esta opção' : 'A cotação deve manter pelo menos uma opção'}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover
        </button>
      </header>

      <div className="space-y-5 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Sistema de reserva *">
            <input className="bbt-input" value={option.reservationSystem} onChange={(event) => onPatch({ reservationSystem: event.target.value })} disabled={disabled} placeholder="Ex.: Sabre, Amadeus, outros" />
          </Field>
          <Field label="Localizador (opcional na cotação)">
            <input className="bbt-input uppercase" value={option.locator} onChange={(event) => onPatch({ locator: event.target.value.toUpperCase() })} disabled={disabled} placeholder="Ex.: ABC123" />
          </Field>
          <Field label="Família tarifária">
            <input className="bbt-input" value={option.fareFamily} onChange={(event) => onPatch({ fareFamily: event.target.value })} disabled={disabled} placeholder="Ex.: Promo, Light, Flex" />
          </Field>
          <Field label="Prazo de emissão *" icon={<Clock3 className="h-3.5 w-3.5" />}>
            <DateTimeInput value={option.issuanceDeadline} onInput={(event) => onPatch({ issuanceDeadline: event.currentTarget.value })} disabled={disabled} />
          </Field>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              <Route className="h-3.5 w-3.5" />
              Voos da opção
            </div>
            <button type="button" className="bbt-button-ghost h-8 text-xs" onClick={onAddSegment} disabled={disabled || option.segments.length >= MAX_AIR_SEGMENTS}>
              <Plus className="h-3.5 w-3.5" />
              Adicionar trecho
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {option.segments.map((segment, segmentIndex) => (
              <AirSegmentEditor
                key={segment.clientId}
                segment={segment}
                index={segmentIndex}
                disabled={disabled}
                canRemove={option.segments.length > 1}
                onPatch={(patch) => onPatchSegment(segment.clientId, patch)}
                onRemove={() => onRemoveSegment(segment.clientId)}
              />
            ))}
          </div>
        </div>

        <PriceEditor pricing={option.pricing} disabled={disabled} onPatch={onPatchPricing} />

        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Regras tarifárias">
            <textarea className="bbt-input min-h-24 resize-y" value={option.fareRules} onChange={(event) => onPatch({ fareRules: event.target.value })} disabled={disabled} placeholder="Regras da tarifa, franquia, reembolso e no-show" />
          </Field>
          <Field label="Política de cancelamento">
            <textarea className="bbt-input min-h-24 resize-y" value={option.cancellationPolicy} onChange={(event) => onPatch({ cancellationPolicy: event.target.value })} disabled={disabled} placeholder="Prazos, multas e condições de cancelamento" />
          </Field>
          <Field label="Política de alteração">
            <textarea className="bbt-input min-h-24 resize-y" value={option.changePolicy} onChange={(event) => onPatch({ changePolicy: event.target.value })} disabled={disabled} placeholder="Multas e diferença tarifária para alteração" />
          </Field>
          <Field label="Observações">
            <textarea className="bbt-input min-h-24 resize-y" value={option.observations} onChange={(event) => onPatch({ observations: event.target.value })} disabled={disabled} placeholder="Informações complementares para solicitante e aprovador" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-bbt-accent focus:ring-bbt-accent" checked={option.refundable} onChange={(event) => onPatch({ refundable: event.target.checked })} disabled={disabled} />
          Tarifa reembolsável, conforme as condições informadas
        </label>
      </div>
    </article>
  )
}

interface AirSegmentEditorProps {
  segment: OfflineAirQuoteSegmentDraft
  index: number
  disabled: boolean
  canRemove: boolean
  onPatch: (patch: Partial<OfflineAirQuoteSegmentDraft>) => void
  onRemove: () => void
}

function AirSegmentEditor({ segment, index, disabled, canRemove, onPatch, onRemove }: AirSegmentEditorProps) {
  return (
    <div className="space-y-3 p-3" data-air-segment={segment.clientId}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
          <Plane className="h-4 w-4 text-bbt-accent" />
          Trecho {index + 1}
        </div>
        <button type="button" className="bbt-button-ghost h-7 px-2 text-xs text-red-600 disabled:opacity-35" onClick={onRemove} disabled={disabled || !canRemove} aria-label={`Remover trecho ${index + 1}`}>
          <Trash2 className="h-3.5 w-3.5" />
          Remover trecho
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Cia. aérea *">
          <input className="bbt-input" value={segment.airlineName} onChange={(event) => onPatch({ airlineName: event.target.value })} disabled={disabled} placeholder="LATAM" />
        </Field>
        <Field label="Código cia.">
          <input className="bbt-input uppercase" value={segment.airlineCode} onChange={(event) => onPatch({ airlineCode: event.target.value.toUpperCase() })} disabled={disabled} placeholder="LA" maxLength={3} />
        </Field>
        <Field label="Voo *">
          <input className="bbt-input uppercase" value={segment.flightNumber} onChange={(event) => onPatch({ flightNumber: event.target.value.toUpperCase() })} disabled={disabled} placeholder="3375" />
        </Field>
        <Field label="Classe de reserva *">
          <input className="bbt-input uppercase" value={segment.bookingClass} onChange={(event) => onPatch({ bookingClass: event.target.value.toUpperCase() })} disabled={disabled} placeholder="V" maxLength={3} />
        </Field>
        <Field label="Cabine">
          <select className="bbt-input" value={segment.cabinClass} onChange={(event) => onPatch({ cabinClass: event.target.value as OfflineAirQuoteSegmentDraft['cabinClass'] })} disabled={disabled}>
            <option value="">Selecione</option>
            <option value="economy">Econômica</option>
            <option value="premium_economy">Econômica premium</option>
            <option value="business">Executiva</option>
            <option value="first">Primeira classe</option>
          </select>
        </Field>
        <Field label="Bagagens despachadas" icon={<Luggage className="h-3.5 w-3.5" />}>
          <select className="bbt-input" value={segment.baggagePieces} onChange={(event) => onPatch({ baggagePieces: event.target.value })} disabled={disabled}>
            {Array.from({ length: 10 }, (_, pieces) => <option key={pieces} value={String(pieces)}>{pieces} {pieces === 1 ? 'volume' : 'volumes'}</option>)}
          </select>
        </Field>
        <Field label="Equipamento">
          <input className="bbt-input" value={segment.equipment} onChange={(event) => onPatch({ equipment: event.target.value })} disabled={disabled} placeholder="Ex.: A320" />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <LocationField label="Origem *" code={segment.originCode} name={segment.originName} disabled={disabled} onCode={(originCode) => onPatch({ originCode })} onName={(originName) => onPatch({ originName })} />
        <Field label="Saída *">
          <DateTimeInput value={segment.departureAt} onInput={(event) => onPatch({ departureAt: event.currentTarget.value })} disabled={disabled} />
        </Field>
        <LocationField label="Destino *" code={segment.destinationCode} name={segment.destinationName} disabled={disabled} onCode={(destinationCode) => onPatch({ destinationCode })} onName={(destinationName) => onPatch({ destinationName })} />
        <Field label="Chegada *">
          <DateTimeInput value={segment.arrivalAt} onInput={(event) => onPatch({ arrivalAt: event.currentTarget.value })} disabled={disabled} />
        </Field>
      </div>
    </div>
  )
}

function LocationField({ label, code, name, disabled, onCode, onName }: {
  label: string
  code: string
  name: string
  disabled: boolean
  onCode: (value: string) => void
  onName: (value: string) => void
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
        <input className="bbt-input uppercase" value={code} onChange={(event) => onCode(event.target.value.toUpperCase())} disabled={disabled} placeholder="IATA" maxLength={4} aria-label={`${label} - código`} />
        <input className="bbt-input" value={name} onChange={(event) => onName(event.target.value)} disabled={disabled} placeholder="Cidade / aeroporto" aria-label={`${label} - cidade ou aeroporto`} />
      </div>
    </Field>
  )
}

function PriceEditor({ pricing, disabled, onPatch }: {
  pricing: OfflineAirPriceDraft
  disabled: boolean
  onPatch: (patch: Partial<OfflineAirPriceDraft>) => void
}) {
  const totalMinor = airQuoteTotalMinor(pricing)
  return (
    <section className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-3 dark:border-cyan-950 dark:bg-cyan-950/10" aria-label="Composição do preço">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          <ReceiptText className="h-3.5 w-3.5" />
          Composição do preço
        </div>
        <div className="text-sm font-bold text-bbt-primary dark:text-white">Total: {formatAirMoney(totalMinor, pricing.currency)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Field label="Moeda *">
          <select className="bbt-input" value={pricing.currency} onChange={(event) => onPatch({ currency: event.target.value })} disabled={disabled}>
            <option value="BRL">BRL</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </Field>
        <MoneyField label="Tarifa *" value={pricing.fare} disabled={disabled} onChange={(fare) => onPatch({ fare })} />
        <MoneyField label="Taxas" value={pricing.taxes} disabled={disabled} onChange={(taxes) => onPatch({ taxes })} />
        <MoneyField label="RAV" value={pricing.rav} disabled={disabled} onChange={(rav) => onPatch({ rav })} />
        <MoneyField label="RAC" value={pricing.rac} disabled={disabled} onChange={(rac) => onPatch({ rac })} />
        <MoneyField label="Câmbio" value={pricing.exchangeRate} disabled={disabled} onChange={(exchangeRate) => onPatch({ exchangeRate })} />
        <MoneyField label="Tarifa referência" value={pricing.referenceFare} disabled={disabled} onChange={(referenceFare) => onPatch({ referenceFare })} />
        <Field label="Milhas">
          <input className="bbt-input" inputMode="numeric" value={pricing.mileage} onChange={(event) => onPatch({ mileage: event.target.value.replace(/[^0-9]/g, '') })} disabled={disabled} placeholder="0" />
        </Field>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Total = tarifa + taxas + RAV + RAC. Câmbio, tarifa de referência e milhas são informativos.</p>
    </section>
  )
}

function MoneyField({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <input className="bbt-input tabular-nums" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} placeholder="0,00" />
    </Field>
  )
}

function Field({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0 text-xs font-medium text-slate-600 dark:text-slate-300">
      <span className="mb-1 flex items-center gap-1.5">{icon}{label}</span>
      {children}
    </label>
  )
}

function normalizeInitialOptions(
  initialOptions: OfflineAirQuoteOptionDraft[] | undefined,
  demand: OfflineAirDemandSummary,
): OfflineAirQuoteOptionDraft[] {
  if (!initialOptions?.length) return [createEmptyAirQuoteOption(1, demand.requestedSegments)]
  return initialOptions.slice(0, MAX_AIR_QUOTE_OPTIONS).map((option) => ({
    ...option,
    pricing: { ...option.pricing },
    segments: option.segments.map((segment) => ({ ...segment })),
  }))
}

function validateOptions(options: OfflineAirQuoteOptionDraft[]): string[] {
  const errors: string[] = []
  if (options.length < MIN_AIR_QUOTE_OPTIONS || options.length > MAX_AIR_QUOTE_OPTIONS) {
    errors.push(`Informe entre ${MIN_AIR_QUOTE_OPTIONS} e ${MAX_AIR_QUOTE_OPTIONS} opções.`)
    return errors
  }

  options.forEach((option, optionIndex) => {
    const prefix = `Opção ${optionIndex + 1}`
    if (!option.reservationSystem.trim()) errors.push(`${prefix}: informe o sistema de reserva.`)
    if (!option.issuanceDeadline) errors.push(`${prefix}: informe o prazo de emissão.`)
    if (!isValidMoneyInput(option.pricing.fare, true)) errors.push(`${prefix}: informe uma tarifa válida.`)
    for (const [label, value] of [
      ['taxas', option.pricing.taxes],
      ['RAV', option.pricing.rav],
      ['RAC', option.pricing.rac],
      ['câmbio', option.pricing.exchangeRate],
      ['tarifa de referência', option.pricing.referenceFare],
    ]) {
      if (!isValidMoneyInput(value)) errors.push(`${prefix}: o valor de ${label} é inválido.`)
    }

    if (!option.segments.length) errors.push(`${prefix}: informe pelo menos um trecho.`)
    option.segments.forEach((segment, segmentIndex) => {
      const segmentPrefix = `${prefix}, trecho ${segmentIndex + 1}`
      if (!segment.airlineName.trim()) errors.push(`${segmentPrefix}: informe a companhia aérea.`)
      if (!/^[A-Z0-9]{2,3}$/.test(segment.airlineCode.trim().toUpperCase())) errors.push(`${segmentPrefix}: informe um código de companhia válido.`)
      if (!/^[0-9]{1,4}[A-Z]?$/.test(segment.flightNumber.trim().toUpperCase())) errors.push(`${segmentPrefix}: informe um número de voo válido.`)
      if (!segment.bookingClass.trim() || segment.bookingClass.trim().length > 2) errors.push(`${segmentPrefix}: informe a classe de reserva.`)
      if (!segment.cabinClass) errors.push(`${segmentPrefix}: informe a cabine.`)
      if (!/^[A-Z]{3}$/.test(segment.originCode.trim().toUpperCase())) errors.push(`${segmentPrefix}: informe o código IATA da origem.`)
      if (!/^[A-Z]{3}$/.test(segment.destinationCode.trim().toUpperCase())) errors.push(`${segmentPrefix}: informe o código IATA do destino.`)
      if (segment.originCode.trim().toUpperCase() === segment.destinationCode.trim().toUpperCase()) errors.push(`${segmentPrefix}: origem e destino devem ser diferentes.`)
      if (!segment.departureAt || !segment.arrivalAt) {
        errors.push(`${segmentPrefix}: informe saída e chegada.`)
      } else if (Date.parse(segment.arrivalAt) <= Date.parse(segment.departureAt)) {
        errors.push(`${segmentPrefix}: a chegada deve ser posterior à saída.`)
      }
    })
    for (let segmentIndex = 1; segmentIndex < option.segments.length; segmentIndex += 1) {
      const previous = option.segments[segmentIndex - 1]
      const segment = option.segments[segmentIndex]
      if (previous.destinationCode.trim().toUpperCase() !== segment.originCode.trim().toUpperCase()) {
        errors.push(`${prefix}, trecho ${segmentIndex + 1}: a origem deve continuar o destino do trecho anterior.`)
      }
      if (previous.arrivalAt && segment.departureAt && Date.parse(segment.departureAt) < Date.parse(previous.arrivalAt)) {
        errors.push(`${prefix}, trecho ${segmentIndex + 1}: a saída não pode ocorrer antes da chegada anterior.`)
      }
    }
    const firstDeparture = option.segments[0]?.departureAt
    if (option.issuanceDeadline && firstDeparture && Date.parse(option.issuanceDeadline) >= Date.parse(firstDeparture)) {
      errors.push(`${prefix}: o prazo de emissão deve ser anterior ao primeiro embarque.`)
    }
  })

  return [...new Set(errors)]
}

function passengerLabel(count: number): string {
  return `${count} ${count === 1 ? 'viajante' : 'viajantes'}`
}

function locationLabel(code: string | undefined, name: string): string {
  return [code?.trim() ? `(${code.trim().toUpperCase()})` : '', name.trim()].filter(Boolean).join(' ')
}

function formatRequestedDate(value: string): string {
  if (!value) return 'Data não informada'
  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR').format(parsed)
}

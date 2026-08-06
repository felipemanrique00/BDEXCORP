'use client'

import { ArrowRight, Luggage, Plane, Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'

import { DateInput } from '@/components/ui/date-input'
import type { AirDemandLeg, ClasseAerea, DetalhesAereo } from '@/types'

interface AirDemandConfiguratorProps {
  value: DetalhesAereo
  onChange: (value: DetalhesAereo) => void
  disabled?: boolean
}

const TRIP_TYPES = [
  { value: 'one_way', label: 'Somente ida' },
  { value: 'round_trip', label: 'Ida e volta' },
  { value: 'multi_city', label: 'Múltiplos destinos' },
] as const

const CABIN_CLASSES: ClasseAerea[] = [
  'Econômica',
  'Econômica Premium',
  'Executiva',
  'Primeira',
]

export function AirDemandConfigurator({ value, onChange, disabled = false }: AirDemandConfiguratorProps) {
  const tripType = value.trip_type || (value.data_volta ? 'round_trip' : 'one_way')
  const legs = useMemo(() => normalizeLegs(value, tripType), [tripType, value])

  function setTripType(nextType: DetalhesAereo['trip_type']) {
    if (!nextType) return
    const first = legs[0] || emptyLeg(1, 'outbound')
    let nextLegs: AirDemandLeg[]
    if (nextType === 'one_way') {
      nextLegs = [{ ...first, sequence: 1, direction: 'outbound' }]
    } else if (nextType === 'round_trip') {
      const currentReturn = legs[1]
      nextLegs = [
        { ...first, sequence: 1, direction: 'outbound' },
        currentReturn
          ? { ...currentReturn, sequence: 2, direction: 'return' }
          : {
              ...emptyLeg(2, 'return'),
              origin: first.destination,
              destination: first.origin,
            },
      ]
    } else {
      nextLegs = legs.length >= 2
        ? legs.map((leg, index) => ({ ...leg, sequence: index + 1, direction: 'multi_city' }))
        : [
            { ...first, sequence: 1, direction: 'multi_city' },
            { ...emptyLeg(2, 'multi_city'), origin: first.destination },
          ]
    }
    commitLegs(nextLegs, { ...value, trip_type: nextType })
  }

  function commitLegs(nextLegs: AirDemandLeg[], base: DetalhesAereo = value) {
    const normalized = nextLegs.map((leg, index) => ({ ...leg, sequence: index + 1 }))
    const first = normalized[0]
    const last = normalized[normalized.length - 1]
    onChange({
      ...base,
      trechos: normalized,
      origem: first?.origin || '',
      destino: first?.destination || '',
      data_ida: first?.departure_date || '',
      data_volta: base.trip_type === 'round_trip' ? last?.departure_date || '' : undefined,
    })
  }

  function updateLeg(index: number, patch: Partial<AirDemandLeg>) {
    const next = legs.map((leg, itemIndex) => itemIndex === index ? { ...leg, ...patch } : leg)
    if (tripType === 'round_trip' && index === 0 && next[1]) {
      if (!next[1].origin || next[1].origin === legs[0].destination) next[1].origin = next[0].destination
      if (!next[1].destination || next[1].destination === legs[0].origin) next[1].destination = next[0].origin
    }
    if (tripType === 'multi_city' && next[index + 1] && !next[index + 1].origin) {
      next[index + 1].origin = next[index].destination
    }
    commitLegs(next)
  }

  function addLeg() {
    const previous = legs[legs.length - 1]
    commitLegs([
      ...legs,
      { ...emptyLeg(legs.length + 1, 'multi_city'), origin: previous?.destination || '' },
    ], { ...value, trip_type: 'multi_city' })
  }

  function removeLeg(index: number) {
    if (legs.length <= 1) return
    const next = legs.filter((_, itemIndex) => itemIndex !== index)
    const nextType = next.length === 1 ? 'one_way' : tripType
    commitLegs(next, { ...value, trip_type: nextType })
  }

  const airlineText = (value.preferred_airlines || []).join(', ')

  return (
    <section className="space-y-4 rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700" aria-labelledby="air-demand-title">
      <header>
        <h4 id="air-demand-title" className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
          <Plane className="h-4 w-4 text-bbt-accent" aria-hidden="true" />
          Itinerário solicitado
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          Informe os trechos desejados. A cotação poderá apresentar conexões diferentes dentro de cada opção.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-bbt-gray-50 p-1 dark:bg-slate-800">
        {TRIP_TYPES.map((item) => (
          <button
            key={item.value}
            type="button"
            disabled={disabled}
            onClick={() => setTripType(item.value)}
            className={`rounded-md px-2 py-2 text-xs font-semibold transition ${
              tripType === item.value
                ? 'bg-white text-bbt-primary shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-bbt-primary dark:hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {legs.map((leg, index) => (
          <article key={`${leg.sequence}-${index}`} className="rounded-lg border border-bbt-gray-100 p-3 dark:border-slate-700">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bbt-accent/10 text-xs text-bbt-accent">{index + 1}</span>
                {tripType === 'round_trip' ? (index === 0 ? 'Ida' : 'Volta') : `Trecho ${index + 1}`}
              </div>
              {tripType === 'multi_city' && legs.length > 1 && (
                <button type="button" onClick={() => removeLeg(index)} disabled={disabled} className="rounded p-1 text-red-500 hover:bg-red-50" aria-label={`Remover trecho ${index + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
              <Field label="Origem *">
                <input value={leg.origin} onChange={(event) => updateLeg(index, { origin: event.target.value })} disabled={disabled} className="bbt-input uppercase" placeholder="REC - Recife" title="Informe o código IATA de 3 letras, opcionalmente seguido do nome" />
              </Field>
              <ArrowRight className="mb-3 hidden h-4 w-4 text-slate-400 md:block" aria-hidden="true" />
              <Field label="Destino *">
                <input value={leg.destination} onChange={(event) => updateLeg(index, { destination: event.target.value })} disabled={disabled} className="bbt-input uppercase" placeholder="GYN - Goiânia" title="Informe o código IATA de 3 letras, opcionalmente seguido do nome" />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Data *">
                <DateInput value={leg.departure_date} onChange={(event) => updateLeg(index, { departure_date: event.target.value })} disabled={disabled} aria-label={`Data do trecho ${index + 1}`} />
              </Field>
              <Field label="Horário a partir de">
                <input type="time" value={leg.earliest_time || ''} onChange={(event) => updateLeg(index, { earliest_time: event.target.value })} disabled={disabled} className="bbt-input" />
              </Field>
              <Field label="Horário até">
                <input type="time" value={leg.latest_time || ''} onChange={(event) => updateLeg(index, { latest_time: event.target.value })} disabled={disabled} className="bbt-input" />
              </Field>
            </div>
          </article>
        ))}
      </div>

      {tripType === 'multi_city' && legs.length < 12 && (
        <button type="button" onClick={addLeg} disabled={disabled} className="bbt-button-outline h-9 text-xs">
          <Plus className="h-4 w-4" /> Adicionar trecho
        </button>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Classe desejada">
          <select value={value.classe || 'Econômica'} onChange={(event) => onChange({ ...value, classe: event.target.value as ClasseAerea })} disabled={disabled} className="bbt-input">
            {CABIN_CLASSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Bagagem despachada">
          <select value={value.baggage_pieces ?? 0} onChange={(event) => onChange({ ...value, baggage_pieces: Number(event.target.value) })} disabled={disabled} className="bbt-input">
            {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count === 0 ? 'Sem bagagem' : `${count} volume(s)`}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Companhias preferenciais">
        <input
          value={airlineText}
          onChange={(event) => onChange({
            ...value,
            preferred_airlines: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
          })}
          disabled={disabled}
          className="bbt-input"
          placeholder="Deixe em branco para qualquer companhia; separe preferências por vírgula"
        />
      </Field>

      <div className="grid gap-2 sm:grid-cols-3">
        <Check label="Aceita datas próximas" checked={Boolean(value.flexible_dates)} onChange={(checked) => onChange({ ...value, flexible_dates: checked })} disabled={disabled} />
        <Check label="Aceita outros horários" checked={Boolean(value.flexible_times)} onChange={(checked) => onChange({ ...value, flexible_times: checked })} disabled={disabled} />
        <Check label="Viagem internacional" checked={Boolean(value.internacional)} onChange={(checked) => onChange({ ...value, internacional: checked })} disabled={disabled} />
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
        <Luggage className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        A bagagem e a classe serão conferidas em cada opção da cotação antes da escolha.
      </div>
    </section>
  )
}

function normalizeLegs(value: DetalhesAereo, tripType: NonNullable<DetalhesAereo['trip_type']>): AirDemandLeg[] {
  if (value.trechos?.length) return value.trechos.map((leg, index) => ({ ...leg, sequence: index + 1 }))
  const outbound: AirDemandLeg = {
    sequence: 1,
    direction: 'outbound',
    origin: value.origem || '',
    destination: value.destino || '',
    departure_date: value.data_ida || '',
  }
  if (tripType === 'one_way') return [outbound]
  return [
    outbound,
    {
      sequence: 2,
      direction: tripType === 'round_trip' ? 'return' : 'multi_city',
      origin: value.destino || '',
      destination: tripType === 'round_trip' ? value.origem || '' : '',
      departure_date: value.data_volta || '',
    },
  ]
}

function emptyLeg(sequence: number, direction: AirDemandLeg['direction']): AirDemandLeg {
  return { sequence, direction, origin: '', destination: '', departure_date: '' }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-bbt-gray-100 px-3 py-2 text-xs dark:border-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="h-4 w-4 rounded border-slate-300 text-bbt-primary" />
      {label}
    </label>
  )
}

export default AirDemandConfigurator

'use client'

import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  CreditCard,
  LockKeyhole,
  Luggage,
  MapPin,
  PencilLine,
  Plane,
  UserRound,
  UsersRound,
} from 'lucide-react'

import { airPassengersFromDetails } from '@/lib/air-demand/passenger-selection'
import type { CorporateDemandSnapshot } from '@/lib/company-portal-lab/demand-projection'
import { formatDate } from '@/lib/utils'
import {
  FORMAS_PAGAMENTO_LABEL,
  PRIORIDADE_LABEL,
  type AirDemandLeg,
} from '@/types'

interface AirRequestReadonlyProps {
  demand: CorporateDemandSnapshot
  companyName: string
  canEditAfterRejection?: boolean
  editReason?: string | null
  onEdit?: () => void
}

const TRIP_TYPE_LABELS = {
  one_way: 'Um trecho',
  round_trip: 'Ida e volta',
  multi_city: 'Múltiplos trechos',
} as const

export function AirRequestReadonly({
  demand,
  companyName,
  canEditAfterRejection = false,
  editReason = null,
  onEdit,
}: AirRequestReadonlyProps) {
  const details = demand.detalhes_aereo
  const tripType = details?.trip_type || (details?.data_volta ? 'round_trip' : 'one_way')
  const legs = normalizedLegs(demand)
  const passengers = airPassengersFromDetails(details || {})

  return (
    <section className="space-y-4" data-company-portal-request-snapshot>
      <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${canEditAfterRejection
        ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100'
        : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${canEditAfterRejection
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {canEditAfterRejection ? <PencilLine className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h2 className="font-bold">
              {canEditAfterRejection ? 'Ajuste liberado após a rejeição' : 'Dados enviados à agência · somente leitura'}
            </h2>
            <p className="mt-0.5 text-xs leading-5 opacity-80">
              {canEditAfterRejection
                ? editReason || 'Revise os dados solicitados e envie novamente para uma nova cotação.'
                : 'Depois do envio, estes dados ficam preservados para manter cotação, escolha e aprovação rastreáveis.'}
            </p>
          </div>
        </div>
        {canEditAfterRejection && onEdit && (
          <button type="button" onClick={onEdit} className="bbt-button-primary shrink-0 justify-center">
            <PencilLine className="h-4 w-4" />Editar solicitação
          </button>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <article className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 p-4 dark:border-slate-700 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="bbt-section-label">Itinerário solicitado</p>
                <h3 className="mt-1 text-lg font-bold text-bbt-primary dark:text-white">
                  {routeLabel(legs)}
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-bbt-accent/10 px-3 py-1.5 text-xs font-bold text-bbt-primary dark:text-white">
                <Plane className="h-3.5 w-3.5" />Offline
              </span>
            </div>
          </div>

          <div className="border-b border-bbt-gray-100 px-4 pt-4 dark:border-slate-700 sm:px-5">
            <div className="flex max-w-xl overflow-x-auto" aria-label="Formato da viagem">
              {(Object.keys(TRIP_TYPE_LABELS) as Array<keyof typeof TRIP_TYPE_LABELS>).map((value) => (
                <span
                  key={value}
                  className={`min-w-36 border-b-2 px-4 py-3 text-center text-xs font-bold uppercase tracking-wide ${tripType === value
                    ? 'border-bbt-accent text-bbt-primary dark:text-white'
                    : 'border-transparent text-slate-400'}`}
                >
                  {TRIP_TYPE_LABELS[value]}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            {legs.map((leg, index) => (
              <AirLegReadonly key={`${leg.sequence}:${index}`} leg={leg} index={index} />
            ))}
            {!legs.length && (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
                Itinerário não informado.
              </div>
            )}

            <dl className="grid gap-3 border-t border-bbt-gray-100 pt-4 dark:border-slate-700 sm:grid-cols-2 lg:grid-cols-4">
              <ReadonlyField icon={Plane} label="Classe" value={details?.classe || 'Não informada'} />
              <ReadonlyField icon={Luggage} label="Bagagem" value={`${details?.baggage_pieces ?? 0} volume(s)`} />
              <ReadonlyField icon={CalendarDays} label="Datas flexíveis" value={details?.flexible_dates ? 'Sim' : 'Não'} />
              <ReadonlyField icon={Clock3} label="Horários flexíveis" value={details?.flexible_times ? 'Sim' : 'Não'} />
            </dl>

            {details?.preferred_airlines?.length ? (
              <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Companhias preferenciais</span>
                <div className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{details.preferred_airlines.join(', ')}</div>
              </div>
            ) : null}
          </div>
        </article>

        <aside className="space-y-3">
          <ReadonlyAccordion
            title="Viajantes"
            icon={UsersRound}
            summary={`${passengers.length} passageiro(s)`}
            defaultOpen
          >
            {passengers.length ? (
              <ul className="space-y-2">
                {passengers.map((passenger, index) => (
                  <li key={passenger.employee_id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bbt-accent/10 text-bbt-accent">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{passenger.name}</div>
                      <div className="text-[11px] text-slate-500">{index === 0 ? 'Passageiro principal' : `Passageiro ${index + 1}`}</div>
                    </div>
                    <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-500" aria-label="Cadastro conferido" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Nenhum passageiro informado.</p>
            )}
          </ReadonlyAccordion>

          <ReadonlyAccordion
            title="Dados administrativos e financeiros"
            icon={CreditCard}
            summary={demand.centro_custo || 'Centro de custo não informado'}
            defaultOpen
          >
            <dl className="space-y-3">
              <CompactField label="Faturar para" value={companyName} />
              <CompactField label="Centro de custo" value={demand.centro_custo || 'Padrão da empresa'} />
              <CompactField
                label="Forma de pagamento"
                value={demand.forma_pagamento ? FORMAS_PAGAMENTO_LABEL[demand.forma_pagamento] : 'Não informada'}
              />
            </dl>
          </ReadonlyAccordion>

          <ReadonlyAccordion
            title="Dados gerais"
            icon={Building2}
            summary={demand.solicitante_nome || 'Solicitante não informado'}
            defaultOpen
          >
            <dl className="space-y-3">
              <CompactField label="Solicitante" value={demand.solicitante_nome || 'Não informado'} />
              <CompactField label="Prioridade" value={PRIORIDADE_LABEL[demand.prioridade]} />
              <CompactField label="Observações" value={demand.observacoes || 'Nenhuma observação'} multiline />
            </dl>
          </ReadonlyAccordion>
        </aside>
      </div>
    </section>
  )
}

function AirLegReadonly({ leg, index }: { leg: AirDemandLeg; index: number }) {
  return (
    <div className="grid gap-3 rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Trecho {index + 1}</div>
        <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <CalendarDays className="h-4 w-4 text-bbt-accent" />
          {leg.departure_date ? formatDate(leg.departure_date) : 'Sem data'}
        </div>
        <div className="mt-1 text-xs text-slate-500">{timeWindow(leg)}</div>
      </div>
      <Location label="Origem" value={leg.origin} />
      <Location label="Destino" value={leg.destination} />
    </div>
  )
}

function Location({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500"><MapPin className="h-3 w-3" />{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{value || 'Não informado'}</div>
    </div>
  )
}

function ReadonlyField({ icon: Icon, label, value }: { icon: typeof Plane; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</dd>
      </div>
    </div>
  )
}

function CompactField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100 ${multiline ? 'whitespace-pre-wrap leading-5' : ''}`}>{value}</dd>
    </div>
  )
}

function ReadonlyAccordion({
  title,
  icon: Icon,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: typeof Plane
  summary: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="group overflow-hidden rounded-xl border border-bbt-gray-100 bg-white dark:border-slate-700 dark:bg-slate-900" open={defaultOpen || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bbt-accent/10 text-bbt-accent"><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-bbt-primary dark:text-white">{title}</span>
          <span className="block truncate text-xs text-slate-500">{summary}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-bbt-gray-100 p-4 dark:border-slate-700">{children}</div>
    </details>
  )
}

function normalizedLegs(demand: CorporateDemandSnapshot): AirDemandLeg[] {
  const details = demand.detalhes_aereo
  if (details?.trechos?.length) return details.trechos
  if (!details?.origem && !details?.destino) return []
  const legs: AirDemandLeg[] = [{
    sequence: 1,
    direction: 'outbound',
    origin: details.origem || '',
    destination: details.destino || '',
    departure_date: details.data_ida || '',
  }]
  if (details.data_volta) {
    legs.push({
      sequence: 2,
      direction: 'return',
      origin: details.destino || '',
      destination: details.origem || '',
      departure_date: details.data_volta,
    })
  }
  return legs
}

function routeLabel(legs: AirDemandLeg[]): string {
  if (!legs.length) return 'Itinerário não informado'
  return `${legs[0].origin || 'Origem'} → ${legs[legs.length - 1].destination || 'Destino'}`
}

function timeWindow(leg: AirDemandLeg): string {
  if (leg.earliest_time && leg.latest_time) return `${leg.earliest_time}–${leg.latest_time}`
  return leg.earliest_time || leg.latest_time || 'Horário livre'
}

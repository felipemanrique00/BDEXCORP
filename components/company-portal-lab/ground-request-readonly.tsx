'use client'

import {
  Accessibility,
  Building2,
  BusFront,
  CalendarClock,
  Car,
  ChevronDown,
  CreditCard,
  LockKeyhole,
  MapPin,
  PencilLine,
  UserRound,
  UsersRound,
} from 'lucide-react'

import { formatDate } from '@/lib/utils'
import type { CorporateDemandSnapshot } from '@/lib/company-portal-lab/demand-projection'
import {
  FORMAS_PAGAMENTO_LABEL,
  PRIORIDADE_LABEL,
} from '@/types'

import type { GroundPortalService } from './ground-portal-contract'

export function GroundRequestReadonly({
  demand,
  companyName,
  service,
  canEditAfterRejection = false,
  editReason,
  onEdit,
}: {
  demand: CorporateDemandSnapshot
  companyName: string
  service: GroundPortalService
  canEditAfterRejection?: boolean
  editReason?: string | null
  onEdit?: () => void
}) {
  const travelers = service === 'car'
    ? demand.detalhes_carro?.primary_driver ? [demand.detalhes_carro.primary_driver] : []
    : demand.detalhes_rodoviario?.travelers || []

  return (
    <section className="space-y-4" data-company-portal-ground-request-snapshot data-service={service}>
      <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${canEditAfterRejection
        ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100'
        : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 dark:bg-slate-800">
            {canEditAfterRejection ? <PencilLine className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="font-bold">{canEditAfterRejection ? 'Ajuste liberado apos a rejeicao' : 'Dados enviados a agencia · somente leitura'}</h2>
            <p className="mt-0.5 text-xs leading-5 opacity-80">
              {canEditAfterRejection
                ? editReason || 'Revise o pedido e reenvie-o para uma nova rodada de cotacao.'
                : 'Locais, periodo, viajantes e dados administrativos permanecem preservados durante todo o fluxo.'}
            </p>
          </div>
        </div>
        {canEditAfterRejection && onEdit ? (
          <button type="button" className="bbt-button-primary shrink-0" onClick={onEdit}>
            <PencilLine className="h-4 w-4" />Editar solicitacao
          </button>
        ) : null}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <article className="bbt-card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-bbt-gray-100 p-5 dark:border-slate-700">
            <div>
              <p className="bbt-section-label">{service === 'car' ? 'Locacao solicitada' : 'Viagem rodoviaria solicitada'}</p>
              <h3 className="mt-1 flex items-center gap-2 text-lg font-bold text-bbt-primary dark:text-white">
                {service === 'car' ? <Car className="h-5 w-5 text-bbt-accent" /> : <BusFront className="h-5 w-5 text-bbt-accent" />}
                {service === 'car'
                  ? demand.detalhes_carro?.return_location_name || 'Local nao informado'
                  : demand.detalhes_rodoviario?.leg_snapshots?.at(-1)?.destination_city_name || 'Destino nao informado'}
              </h3>
            </div>
            <span className="rounded-full bg-bbt-accent/10 px-3 py-1.5 text-xs font-bold text-bbt-primary dark:text-white">Offline</span>
          </header>
          {service === 'car'
            ? <CarSnapshot demand={demand} />
            : <BusSnapshot demand={demand} />}
        </article>

        <aside className="space-y-3">
          <ReadonlyAccordion title="Viajantes" icon={UsersRound} summary={`${travelers.length} selecionado(s)`}>
            <ul className="space-y-2">
              {travelers.map((traveler, index) => (
                <li key={traveler.employee_id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                  <UserRound className="h-4 w-4 text-bbt-accent" />
                  <span className="text-sm font-semibold">{traveler.name}{index === 0 ? ' · principal' : ''}</span>
                </li>
              ))}
            </ul>
          </ReadonlyAccordion>
          <ReadonlyAccordion title="Dados adm./financeiros" icon={CreditCard} summary={demand.centro_custo || 'Centro de custo padrao'}>
            <Field label="Faturar para" value={companyName} />
            <Field label="Centro de custo" value={demand.centro_custo || 'Padrao da empresa'} />
            <Field label="Forma de pagamento" value={demand.forma_pagamento ? FORMAS_PAGAMENTO_LABEL[demand.forma_pagamento] : 'Nao informada'} />
          </ReadonlyAccordion>
          <ReadonlyAccordion title="Dados gerais" icon={Building2} summary={demand.solicitante_nome || 'Solicitante nao informado'}>
            <Field label="Solicitante" value={demand.solicitante_nome || 'Nao informado'} />
            <Field label="Prioridade" value={PRIORIDADE_LABEL[demand.prioridade]} />
            <Field label="Observacoes" value={demand.observacoes || 'Nenhuma observacao'} />
          </ReadonlyAccordion>
        </aside>
      </div>
    </section>
  )
}

function CarSnapshot({ demand }: { demand: CorporateDemandSnapshot }) {
  const details = demand.detalhes_carro
  const ground = details?.ground
  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <SnapshotCard icon={MapPin} label="Retirada" value={details?.pickup_location_name || ground?.pickupLocationText || 'Nao informada'} subtitle={dateTime(ground?.pickupAt)} />
        <SnapshotCard icon={MapPin} label="Devolucao" value={details?.return_location_name || ground?.returnLocationText || 'Nao informada'} subtitle={dateTime(ground?.returnAt)} />
      </div>
      <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Locadora" value={details?.supplier_name || details?.locadora || 'A definir na cotacao'} />
        <Field label="Categoria" value={ground?.desiredCategory || details?.categoria || 'Sem preferencia'} />
        <Field label="Cambio" value={ground?.automaticTransmission ? 'Automatico' : 'Sem preferencia'} />
        <Field label="Quilometragem" value={ground?.unlimitedMileage ? 'Livre preferencial' : 'Sem preferencia'} />
      </dl>
    </div>
  )
}

function BusSnapshot({ demand }: { demand: CorporateDemandSnapshot }) {
  const details = demand.detalhes_rodoviario
  const legs = details?.ground?.legs || []
  return (
    <div className="space-y-4 p-5">
      <ol className="space-y-3">
        {legs.map((leg, index) => {
          const snapshot = details?.leg_snapshots?.[index]
          return (
            <li key={`${leg.originCityId}:${leg.destinationCityId}:${index}`} className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
              <div className="flex items-center gap-2 text-sm font-bold text-bbt-primary dark:text-white">
                <BusFront className="h-4 w-4 text-bbt-accent" />Trecho {index + 1}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Origem" value={`${snapshot?.origin_city_name || 'Nao informada'} · ${snapshot?.origin_terminal_name || 'Terminal nao informado'}`} />
                <Field label="Destino" value={`${snapshot?.destination_city_name || 'Nao informado'} · ${snapshot?.destination_terminal_name || 'Terminal nao informado'}`} />
              </div>
              <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500"><CalendarClock className="h-4 w-4" />{formatDate(leg.departureDate)}{leg.earliestDeparture ? ` · a partir de ${leg.earliestDeparture}` : ''}</p>
            </li>
          )
        })}
      </ol>
      <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800 sm:grid-cols-3">
        <Field label="Classe" value={details?.ground?.preferredClass || 'Sem preferencia'} />
        <Field label="Assento" value={details?.ground?.seatPreference || 'Sem preferencia'} />
        <div className="flex items-center gap-2"><Accessibility className="h-4 w-4 text-bbt-accent" /><Field label="Acessibilidade" value={details?.ground?.accessibilityRequired ? 'Necessaria' : 'Nao solicitada'} /></div>
      </dl>
    </div>
  )
}

function SnapshotCard({ icon: Icon, label, value, subtitle }: { icon: typeof Car; label: string; value: string; subtitle: string }) {
  return <div className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700"><div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500"><Icon className="h-4 w-4 text-bbt-accent" />{label}</div><div className="mt-2 font-bold text-bbt-primary dark:text-white">{value}</div><div className="mt-1 text-xs text-slate-500">{subtitle}</div></div>
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="mb-3 last:mb-0"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</dd></div>
}

function ReadonlyAccordion({ title, icon: Icon, summary, children }: { title: string; icon: typeof Car; summary: string; children: React.ReactNode }) {
  return <details className="group overflow-hidden rounded-xl border border-bbt-gray-100 bg-white dark:border-slate-700 dark:bg-slate-900" open><summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bbt-accent/10 text-bbt-accent"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-bbt-primary dark:text-white">{title}</span><span className="block truncate text-xs text-slate-500">{summary}</span></span><ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" /></summary><div className="border-t border-bbt-gray-100 p-4 dark:border-slate-700">{children}</div></details>
}

function dateTime(value?: string): string {
  if (!value) return 'Data e hora nao informadas'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR')
}

export default GroundRequestReadonly

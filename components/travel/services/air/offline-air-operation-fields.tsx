'use client'

import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  CreditCard,
  FileLock2,
  Luggage,
  Plane,
  ReceiptText,
  ShieldCheck,
  TicketCheck,
  UserRound,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { DateTimeInput } from '@/components/ui/date-input'

import { AirlineLogo } from './airline-logo'
import { airQuoteTotalMinor, formatAirMoney } from './pricing'
import { createAirTicketDrafts, updateAirTicketDraft } from './ticket-drafts'
import type {
  OfflineAirApprovedSnapshot,
  OfflineAirOperationDraft,
  OfflineAirOperationMode,
  OfflineAirPaymentMethod,
} from './types'

export interface OfflineAirOperationFieldsProps {
  approvedSnapshot: OfflineAirApprovedSnapshot | null
  value: OfflineAirOperationDraft
  mode: OfflineAirOperationMode
  disabled?: boolean
  onChange: (value: OfflineAirOperationDraft) => void
}

const PAYMENT_METHODS: Array<{ value: OfflineAirPaymentMethod; label: string }> = [
  { value: 'faturado', label: 'Faturado' },
  { value: 'cartao_corporativo', label: 'Cartão corporativo' },
  { value: 'cartao_agencia', label: 'Cartão da agência' },
  { value: 'pix', label: 'Pix' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'outro', label: 'Outro' },
]

export function OfflineAirOperationFields({
  approvedSnapshot,
  value,
  mode,
  disabled = false,
  onChange,
}: OfflineAirOperationFieldsProps) {
  if (!approvedSnapshot) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-semibold">Opção aérea aprovada não carregada</div>
          <p className="mt-1 text-xs">Carregue a escolha aprovada da demanda antes de registrar reserva ou emissão. Itinerário e valores não devem ser digitados novamente.</p>
        </div>
      </div>
    )
  }

  const { demand, option } = approvedSnapshot
  const issuanceMode = mode === 'reservation_and_issue' || mode === 'issue_existing'

  function patch(patchValue: Partial<OfflineAirOperationDraft>) {
    onChange({ ...value, ...patchValue })
  }

  function patchTicket(passengerIndex: number, ticketNumber: string) {
    patch({
      tickets: updateAirTicketDraft(
        demand.passengers,
        value.tickets,
        passengerIndex,
        ticketNumber,
      ),
    })
  }

  const tickets = createAirTicketDrafts(demand.passengers, value.tickets)

  return (
    <div className="space-y-5" data-offline-air-operation-fields>
      <section className="overflow-hidden rounded-xl border border-emerald-200 bg-white dark:border-emerald-900/60 dark:bg-slate-900" data-locked-approved-air-snapshot>
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <div className="flex min-w-0 items-start gap-3">
            <AirlineLogo
              iataCode={option.validatingAirlineCode || option.segments[0]?.airlineCode}
              airlineName={option.validatingAirlineName || option.segments[0]?.airlineName}
              size="md"
              decorative
              className="rounded-md bg-white px-1 dark:bg-slate-900"
            />
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 font-bold text-emerald-900 dark:text-emerald-100">
                <ShieldCheck className="h-4 w-4" />
                Opção escolhida e aprovada
              </h3>
              <p className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-200/80">
                {demand.number} · {demand.companyName} · cotação imutável para a operação
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />Aéreo · Aprovada
          </span>
        </header>

        <div className="grid gap-px border-b border-slate-100 bg-slate-100 md:grid-cols-3 dark:border-slate-700 dark:bg-slate-700" data-air-request-summary>
          <SnapshotCell label="Solicitante" value={demand.requesterName || 'Não informado'} />
          <SnapshotCell
            label={demand.passengers.length === 1 ? 'Passageiro' : 'Passageiros'}
            value={demand.passengers.map((passenger) => passenger.name).join('\n') || 'Não informado'}
          />
          <SnapshotCell label="Solicitação" value={requestedItineraryLabel(demand.requestedSegments)} />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70">
              <tr>
                <th className="px-3 py-2 font-semibold">Data e hora</th>
                <th className="px-3 py-2 font-semibold">Trecho aprovado</th>
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
                  <td className="px-3 py-2 font-medium text-bbt-primary dark:text-white">
                    {locationLabel(segment.originCode, segment.originName)}
                    <span className="mx-1.5 text-slate-400">→</span>
                    {locationLabel(segment.destinationCode, segment.destinationName)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex min-w-40 items-center gap-2">
                      <AirlineLogo iataCode={segment.airlineCode} airlineName={segment.airlineName} size="xs" decorative />
                      <div>
                        <span className="block">{segment.airlineName || segment.airlineCode}</span>
                        <span className="block text-slate-500">{[segment.airlineCode, segment.flightNumber].filter(Boolean).join(' ')}</span>
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

        <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-700 dark:bg-slate-700">
          <SnapshotCell label="Tarifa" value={money(option.pricing.fare, option.pricing.currency)} />
          <SnapshotCell label="Taxas" value={money(option.pricing.taxes, option.pricing.currency)} />
          <SnapshotCell label="RAV" value={money(option.pricing.rav, option.pricing.currency)} />
          <SnapshotCell label="RAC" value={money(option.pricing.rac, option.pricing.currency)} />
          <SnapshotCell label="Prazo de emissão" value={formatDateTime(option.issuanceDeadline)} />
          <SnapshotCell label="Total aprovado" value={formatAirMoney(option.totalMinor ?? airQuoteTotalMinor(option.pricing), option.pricing.currency)} strong />
        </div>

        {(option.fareRules || option.cancellationPolicy || option.changePolicy) && (
          <div className="grid gap-3 border-t border-slate-100 p-3 text-xs lg:grid-cols-3 dark:border-slate-700">
            {option.fareRules && <PolicyBlock label="Regras tarifárias" value={option.fareRules} />}
            {option.cancellationPolicy && <PolicyBlock label="Cancelamento" value={option.cancellationPolicy} />}
            {option.changePolicy && <PolicyBlock label="Alteração" value={option.changePolicy} />}
          </div>
        )}

        <div className="flex items-start gap-2 border-t border-emerald-100 bg-emerald-50/40 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/10 dark:text-emerald-100">
          <FileLock2 className="mt-0.5 h-4 w-4 shrink-0" />
          Companhia, voos, horários, classe, bagagem, preço e políticas vêm da aprovação e permanecem bloqueados. Para alterá-los, retorne à cotação e abra uma nova rodada.
        </div>
      </section>

      <section className="bbt-card overflow-hidden" aria-labelledby="air-operational-fields-title">
        <header className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
          <h3 id="air-operational-fields-title" className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white">
            <TicketCheck className="h-4 w-4 text-bbt-accent" />
            Dados operacionais da {issuanceMode ? 'emissão' : 'reserva'}
          </h3>
          <p className="mt-1 text-xs text-slate-500">Somente confirmações obtidas na operação podem ser editadas nesta etapa.</p>
        </header>

        <div className="space-y-5 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Sistema de reserva *" icon={<Plane className="h-3.5 w-3.5" />}>
              <input className="bbt-input" value={value.reservationSystem} onChange={(event) => patch({ reservationSystem: event.target.value })} disabled={disabled} placeholder={option.reservationSystem || 'Ex.: Sabre, Amadeus, outros'} />
            </Field>
            <Field label="Localizador confirmado *">
              <input className="bbt-input uppercase" value={value.locator} onChange={(event) => patch({ locator: event.target.value.toUpperCase() })} disabled={disabled} placeholder={option.locator || 'ABC123'} />
            </Field>
          </div>

          {issuanceMode && (
            <div className="space-y-3 rounded-lg border border-cyan-100 bg-cyan-50/40 p-3 dark:border-cyan-950 dark:bg-cyan-950/10">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                <TicketCheck className="h-3.5 w-3.5" />
                Bilhetes por passageiro
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {demand.passengers.map((passenger, passengerIndex) => {
                  const ticket = tickets[passengerIndex]
                  const passengerSequence = passenger.sequence || passengerIndex + 1
                  const passengerLabel = [
                    passenger.name,
                    `Passageiro ${passengerSequence}`,
                    passenger.identificationCode,
                  ].filter(Boolean).join(' · ')
                  return (
                    <Field key={ticket.passengerId} label={passengerLabel} icon={<UserRound className="h-3.5 w-3.5" />}>
                      <input className="bbt-input uppercase" value={ticket.ticketNumber} onChange={(event) => patchTicket(passengerIndex, event.target.value.toUpperCase())} disabled={disabled} placeholder="Número do bilhete / e-ticket" />
                    </Field>
                  )
                })}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <TemporalField label="Emitido em *" icon={<CalendarCheck2 className="h-3.5 w-3.5" />}>
                  <DateTimeInput value={value.issuedAt} onInput={(event) => patch({ issuedAt: event.currentTarget.value })} disabled={disabled} />
                </TemporalField>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><ReceiptText className="h-3.5 w-3.5" />Valor a emitir</div>
                  <div className="mt-1 text-base font-bold text-bbt-primary dark:text-white">{formatAirMoney(option.totalMinor ?? airQuoteTotalMinor(option.pricing), option.pricing.currency)}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">Mantido conforme aprovação</div>
                </div>
              </div>
            </div>
          )}

          <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/30" data-air-administrative-details>
            <summary className="cursor-pointer text-sm font-semibold text-bbt-primary dark:text-white">
              Dados administrativos opcionais
            </summary>
            <p className="mt-1 text-xs text-slate-500">
              Já preenchemos estes dados com a cotação aprovada. Abra somente para informar um emissor diferente ou ajustar a confirmação e o pagamento.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Emissor / consolidador *">
                <input className="bbt-input" value={value.operationalSupplierName} onChange={(event) => patch({ operationalSupplierName: event.target.value })} disabled={disabled} placeholder={option.segments[0]?.airlineName || 'Fornecedor utilizado na reserva'} />
              </Field>
              <TemporalField label="Reserva confirmada em *" icon={<CalendarCheck2 className="h-3.5 w-3.5" />}>
                <DateTimeInput value={value.reservationConfirmedAt} onInput={(event) => patch({ reservationConfirmedAt: event.currentTarget.value })} disabled={disabled} />
              </TemporalField>
              {issuanceMode && (
                <>
                  <Field label="Forma de pagamento" icon={<CreditCard className="h-3.5 w-3.5" />}>
                    <select className="bbt-input" value={value.paymentMethod} onChange={(event) => patch({ paymentMethod: event.target.value as OfflineAirPaymentMethod })} disabled={disabled}>
                      {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Referência do pagamento">
                    <input className="bbt-input" value={value.paymentReference} onChange={(event) => patch({ paymentReference: event.target.value })} disabled={disabled} placeholder="Fatura, autorização, cartão mascarado..." />
                  </Field>
                </>
              )}
            </div>
          </details>

          <Field label="Observações operacionais">
            <textarea className="bbt-input min-h-24 resize-y" value={value.operationalNotes} onChange={(event) => patch({ operationalNotes: event.target.value })} disabled={disabled} placeholder="Contato com fornecedor, confirmação e informações necessárias à auditoria" />
          </Field>
        </div>
      </section>
    </div>
  )
}

function SnapshotCell({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`bg-white px-3 py-2 dark:bg-slate-900 ${strong ? 'text-emerald-800 dark:text-emerald-200' : ''}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-xs ${strong ? 'font-bold' : 'font-semibold'} whitespace-pre-wrap`}>{value}</div>
    </div>
  )
}

function PolicyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-xs text-slate-800 dark:text-slate-100">{value}</div>
    </div>
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

function TemporalField({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="block min-w-0 text-xs font-medium text-slate-600 dark:text-slate-300">
      <span className="mb-1 flex items-center gap-1.5">{icon}{label}</span>
      {children}
    </div>
  )
}

function money(value: string, currency: string): string {
  return formatAirMoney(airQuoteTotalMinor({ fare: value, taxes: '0', rav: '0', rac: '0' }), currency)
}

function locationLabel(code: string, name: string): string {
  return [code?.trim() ? `(${code.trim().toUpperCase()})` : '', name.trim()].filter(Boolean).join(' ')
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

function requestedItineraryLabel(segments: OfflineAirApprovedSnapshot['demand']['requestedSegments']): string {
  if (!segments.length) return 'Não informada'
  return segments.map((segment) => {
    const route = `${locationLabel(segment.originCode || '', segment.originName)} → ${locationLabel(segment.destinationCode || '', segment.destinationName)}`
    return [route, formatDateOnly(segment.departureDate), segment.preferredPeriod].filter(Boolean).join(' · ')
  }).join('\n')
}

function formatDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
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

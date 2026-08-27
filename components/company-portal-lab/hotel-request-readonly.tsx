'use client'

import {
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CreditCard,
  Hotel,
  LockKeyhole,
  MapPin,
  PencilLine,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import type { CorporateDemandSnapshot } from '@/lib/company-portal-lab/demand-projection'
import {
  companyPortalHotelTariffReferenceSnapshotSchema,
  searchCompanyPortalHotelTariffs,
  type CompanyPortalHotelTariffReferenceSnapshot,
} from '@/lib/company-portal-lab/hotel-tariff-search'
import { HOTEL_OCCUPANCIES, nightsBetween } from '@/lib/hotel-demand/model'
import { hotelDemandPreferredHotelIds } from '@/lib/hotel-demand/preferences'
import { formatDate } from '@/lib/utils'
import {
  FORMAS_PAGAMENTO_LABEL,
  PRIORIDADE_LABEL,
  type HotelDemandRoom,
} from '@/types'

interface HotelRequestReadonlyProps {
  demand: CorporateDemandSnapshot
  companyName: string
  canEditAfterRejection?: boolean
  editReason?: string | null
  onEdit?: () => void
}

export function HotelRequestReadonly({
  demand,
  companyName,
  canEditAfterRejection = false,
  editReason = null,
  onEdit,
}: HotelRequestReadonlyProps) {
  const { portalContext: activePortalContext } = useCompanyPortalContext()
  const details = demand.detalhes_hotel
  const rooms = details?.rooms || []
  const preferredHotelIds = useMemo(
    () => hotelDemandPreferredHotelIds(details),
    [details],
  )
  const tariffReference = useMemo(
    () => readHotelTariffReference(details?.preferences),
    [details?.preferences],
  )
  const [preferredHotelNames, setPreferredHotelNames] = useState<string[]>([])

  useEffect(() => {
    const referenceNames = new Map(tariffReference?.items.map((item) => [item.hotelId, item.name]) || [])
    if (preferredHotelIds.length && preferredHotelIds.every((id) => referenceNames.has(id))) {
      setPreferredHotelNames(preferredHotelIds.map((id) => referenceNames.get(id)!))
      return
    }
    const cityId = String(details?.city_id || '')
    if (!cityId || !preferredHotelIds.length) {
      setPreferredHotelNames([])
      return
    }
    const controller = new AbortController()
    void searchCompanyPortalHotelTariffs({
      scopeType: activePortalContext?.type,
      scopeId: activePortalContext?.id,
      companyId: demand.empresa_id,
      cityId,
      limit: 100,
    })
      .then((result) => {
        if (controller.signal.aborted) return
        const hotelById = new Map(result.items.map((hotel) => [hotel.hotelId, hotel.name]))
        setPreferredHotelNames(preferredHotelIds.map((id) => hotelById.get(id) || 'Hotel preferencial indisponível'))
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPreferredHotelNames(preferredHotelIds.map(() => 'Hotel preferencial cadastrado'))
        }
      })
    return () => controller.abort()
  }, [activePortalContext?.id, activePortalContext?.type, demand.empresa_id, details?.city_id, preferredHotelIds, tariffReference])

  const nights = nightsBetween(details?.data_checkin || '', details?.data_checkout || '')
  const guestCount = rooms.reduce((total, room) => total + room.guests.length, 0)
  const preferences = readablePreferences(details?.preferences)

  return (
    <section className="space-y-4" data-company-portal-hotel-request-snapshot>
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
                ? editReason || 'Revise a hospedagem solicitada e reenvie para uma nova cotação.'
                : 'Destino, hóspedes, preferências e dados financeiros ficam preservados durante cotação, escolha e aprovação.'}
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
                <p className="bbt-section-label">Hospedagem solicitada</p>
                <h3 className="mt-1 flex items-center gap-2 text-lg font-bold text-bbt-primary dark:text-white">
                  <MapPin className="h-5 w-5 text-bbt-accent" />
                  {details?.cidade || 'Destino não informado'}
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-bbt-accent/10 px-3 py-1.5 text-xs font-bold text-bbt-primary dark:text-white">
                <Hotel className="h-3.5 w-3.5" />Offline
              </span>
            </div>
          </div>

          <dl className="grid gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
            <ReadonlyField icon={CalendarDays} label="Check-in" value={details?.data_checkin ? formatDate(details.data_checkin) : 'Não informado'} />
            <ReadonlyField icon={CalendarDays} label="Check-out" value={details?.data_checkout ? formatDate(details.data_checkout) : 'Não informado'} />
            <ReadonlyField icon={BedDouble} label="Duração" value={nights > 0 ? `${nights} noite(s)` : 'Não informada'} />
            <ReadonlyField icon={UsersRound} label="Ocupação" value={`${rooms.length} quarto(s) · ${guestCount} hóspede(s)`} />
          </dl>

          <div className="space-y-4 p-4 sm:p-5">
            <section aria-labelledby="hotel-rooms-title">
              <h4 id="hotel-rooms-title" className="text-sm font-bold text-bbt-primary dark:text-white">Quartos e hóspedes</h4>
              {rooms.length ? (
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {rooms.map((room, index) => <RoomReadonly key={room.client_id} room={room} index={index} />)}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
                  Quartos não informados.
                </div>
              )}
            </section>

            {preferredHotelNames.length ? (
              <section className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800" aria-labelledby="preferred-hotels-title">
                <h4 id="preferred-hotels-title" className="text-xs font-bold uppercase tracking-wide text-slate-500">Hotéis preferenciais</h4>
                <ol className="mt-2 space-y-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {preferredHotelNames.map((name, index) => <li key={`${name}:${index}`}>{index + 1}. {name}</li>)}
                </ol>
              </section>
            ) : null}

            {tariffReference ? (
              <section
                className="rounded-xl border border-bbt-accent/30 bg-bbt-accent/5 p-4 dark:border-bbt-accent/40 dark:bg-bbt-accent/10"
                aria-labelledby="hotel-tariff-reference-title"
                data-company-portal-hotel-tariff-reference
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 id="hotel-tariff-reference-title" className="text-xs font-bold uppercase tracking-wide text-bbt-primary dark:text-white">
                      Referência do tarifário no envio
                    </h4>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Registrada em {formatReferenceTimestamp(tariffReference.capturedAt)}.
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-bbt-primary dark:bg-slate-900 dark:text-white">
                    {tariffReference.roomCount} quarto{tariffReference.roomCount === 1 ? '' : 's'} · {tariffReference.items.length} preferência{tariffReference.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {tariffReference.items.map((item) => (
                    <li key={item.hotelId} className="rounded-lg bg-white p-3 dark:bg-slate-900">
                      <div className="text-sm font-bold text-bbt-primary dark:text-white">{item.name}</div>
                      {item.priceStatus === 'available' && item.tariff ? (
                        <>
                          <div className="mt-1 text-sm font-black text-slate-800 dark:text-slate-100">
                            {formatReferenceCurrency(item.tariff.estimatedTotal, item.tariff.currency)} estimados
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {item.tariff.label} · {item.tariff.roomCategory} · {item.tariff.nights} noite{item.tariff.nights === 1 ? '' : 's'}
                          </div>
                        </>
                      ) : (
                        <div className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                          {item.priceStatus === 'under_review' ? 'Tarifa sob consulta' : 'Valor a confirmar'}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] leading-4 text-slate-500">{tariffReference.disclaimer}</p>
              </section>
            ) : null}

            <dl className="grid gap-3 sm:grid-cols-2">
              <CompactField label="Motivo da viagem" value={details?.purpose || 'Não informado'} multiline />
              <CompactField label="Acessibilidade" value={details?.accessibility_notes || 'Nenhuma necessidade informada'} multiline />
            </dl>

            {preferences.length ? (
              <section className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Preferências adicionais</h4>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {preferences.map((preference) => (
                    <li key={preference} className="rounded-full bg-bbt-accent/10 px-2.5 py-1 text-xs font-semibold text-bbt-primary dark:text-white">
                      {preference}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </article>

        <aside className="space-y-3">
          <ReadonlyAccordion
            title="Hóspede responsável"
            icon={UserRound}
            summary={demand.passageiro_nome || 'Não informado'}
            defaultOpen
          >
            <CompactField label="Responsável" value={demand.passageiro_nome || 'Não informado'} />
            <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <Check className="h-4 w-4" />Cadastro vinculado ao pedido
            </div>
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

function RoomReadonly({ room, index }: { room: HotelDemandRoom; index: number }) {
  const occupancy = HOTEL_OCCUPANCIES[room.occupancy_code]
  return (
    <article className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2">
        <h5 className="flex items-center gap-2 text-sm font-bold text-bbt-primary dark:text-white">
          <BedDouble className="h-4 w-4 text-bbt-accent" />Quarto {index + 1}
        </h5>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">{occupancy.label}</span>
      </div>
      <ul className="mt-3 space-y-2">
        {room.guests.map((guest) => (
          <li key={`${room.client_id}:${guest.slot_index}`} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
            <UserRound className="h-4 w-4 shrink-0 text-bbt-accent" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{guest.name}</div>
              <div className="text-[10px] text-slate-500">{guestRoleLabel(guest.role)} · {guest.is_external ? 'Acompanhante externo' : 'Viajante cadastrado'}</div>
            </div>
          </li>
        ))}
      </ul>
      {room.notes ? <p className="mt-3 text-xs leading-5 text-slate-500"><strong>Observações:</strong> {room.notes}</p> : null}
    </article>
  )
}

function guestRoleLabel(role: 'responsible' | 'companion' | 'guest'): string {
  if (role === 'responsible') return 'Responsável'
  if (role === 'companion') return 'Acompanhante'
  return 'Hóspede'
}

function readablePreferences(preferences: Record<string, unknown> | undefined): string[] {
  if (!preferences) return []
  return Object.entries(preferences).flatMap(([key, value]) => {
    if (key === 'hotelTariffReference') return []
    if (value === false || value === null || value === undefined || value === '') return []
    const label = key.replace(/_/g, ' ')
    if (value === true) return [label]
    if (typeof value === 'string' || typeof value === 'number') return [`${label}: ${value}`]
    if (Array.isArray(value)) return [`${label}: ${value.map(String).join(', ')}`]
    return []
  })
}

function readHotelTariffReference(
  preferences: Record<string, unknown> | undefined,
): CompanyPortalHotelTariffReferenceSnapshot | null {
  const parsed = companyPortalHotelTariffReferenceSnapshotSchema.safeParse(
    preferences?.hotelTariffReference,
  )
  return parsed.success ? parsed.data : null
}

function formatReferenceCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatReferenceTimestamp(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'data não disponível'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

function ReadonlyField({ icon: Icon, label, value }: { icon: typeof Hotel; label: string; value: string }) {
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
  icon: typeof Hotel
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

export default HotelRequestReadonly

'use client'

import {
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Hotel,
  Loader2,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  searchCompanyPortalHotelTariffs,
  type CompanyPortalHotelTariffOccupancyType,
  type CompanyPortalHotelTariffSearchItem,
} from '@/lib/company-portal-lab/hotel-tariff-search'
import { nightsBetween } from '@/lib/hotel-demand/model'
import {
  hotelDemandPreferredHotelIds,
  MAX_PREFERRED_HOTELS,
  preferredHotelPatch,
} from '@/lib/hotel-demand/preferences'
import type { DetalhesHotel } from '@/types'

interface HotelTariffSearchPanelProps {
  companyId: string
  scopeType?: 'company' | 'group'
  scopeId?: string
  value: DetalhesHotel
  onChange: React.Dispatch<React.SetStateAction<DetalhesHotel>>
  disabled?: boolean
}

interface SearchContext {
  companyId: string
  scopeType?: 'company' | 'group'
  scopeId?: string
  cityId: string
  checkIn: string
  checkOut: string
  occupancyType: CompanyPortalHotelTariffOccupancyType
  roomCount: number
}

export function HotelTariffSearchPanel({
  companyId,
  scopeType,
  scopeId,
  value,
  onChange,
  disabled = false,
}: HotelTariffSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CompanyPortalHotelTariffSearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [knownHotelNames, setKnownHotelNames] = useState<Record<string, string>>({})
  const requestSequence = useRef(0)
  const searchedRef = useRef(false)

  const preferredHotelIds = hotelDemandPreferredHotelIds(value)
  const preferredHotelIdSet = new Set(preferredHotelIds)
  const roomOccupancies = useMemo(() => Array.from(new Set(
    (value.rooms || []).map((room) => normalizeOccupancy(room.occupancy_code)),
  )), [value.rooms])
  const nights = nightsBetween(value.data_checkin || '', value.data_checkout || '')
  const context = useMemo<SearchContext | null>(() => {
    const cityId = String(value.city_id || '')
    const checkIn = String(value.data_checkin || '')
    const checkOut = String(value.data_checkout || '')
    const occupancyType = roomOccupancies[0]
    const roomCount = value.rooms?.length || 0
    if (!companyId || !cityId || !checkIn || !checkOut || nights < 1 || roomCount < 1 || roomOccupancies.length !== 1 || !occupancyType) {
      return null
    }
    return { companyId, scopeType, scopeId, cityId, checkIn, checkOut, occupancyType, roomCount }
  }, [companyId, nights, roomOccupancies, scopeId, scopeType, value.city_id, value.data_checkin, value.data_checkout, value.rooms])
  const contextFingerprint = context
    ? `${context.scopeType || ''}:${context.scopeId || ''}:${context.companyId}:${context.cityId}:${context.checkIn}:${context.checkOut}:${context.occupancyType}:${context.roomCount}`
    : ''

  useEffect(() => {
    requestSequence.current += 1
    setItems([])
    setError('')
    setSearched(false)
    setLoading(false)
    searchedRef.current = false
  }, [contextFingerprint])

  useEffect(() => {
    if (!searchedRef.current || !context) return
    const timer = window.setTimeout(() => {
      void runSearch(context, query.trim())
    }, query.trim() ? 300 : 0)
    return () => window.clearTimeout(timer)
    // runSearch is intentionally driven only by the stable search context/query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextFingerprint, query])

  async function runSearch(searchContext: SearchContext, hotelQuery: string) {
    const sequence = ++requestSequence.current
    setLoading(true)
    setError('')
    try {
      const result = await searchCompanyPortalHotelTariffs({
        ...searchContext,
        q: hotelQuery || undefined,
        limit: 30,
      })
      if (sequence !== requestSequence.current) return
      setItems(result.items)
      setKnownHotelNames((current) => ({
        ...current,
        ...Object.fromEntries(result.items.map((item) => [item.hotelId, item.name])),
      }))
      setSearched(true)
      searchedRef.current = true
    } catch (reason) {
      if (sequence !== requestSequence.current) return
      setItems([])
      setSearched(true)
      searchedRef.current = true
      setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o tarifário.')
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }

  function toggleHotel(hotelId: string) {
    onChange((current) => {
      const currentIds = hotelDemandPreferredHotelIds(current)
      const nextIds = currentIds.includes(hotelId)
        ? currentIds.filter((id) => id !== hotelId)
        : currentIds.length < MAX_PREFERRED_HOTELS
          ? [...currentIds, hotelId]
          : currentIds
      return { ...current, ...preferredHotelPatch(nextIds) }
    })
  }

  const prerequisiteMessage = searchPrerequisiteMessage(value, roomOccupancies, nights)

  return (
    <section
      className="mt-5 overflow-hidden rounded-xl border border-bbt-accent/30 bg-bbt-accent/5 dark:border-bbt-accent/40 dark:bg-bbt-accent/10"
      aria-labelledby="company-portal-hotel-tariff-title"
      data-company-portal-hotel-tariff-search
    >
      <header className="border-b border-bbt-accent/30 bg-white/70 p-4 dark:border-bbt-accent/40 dark:bg-slate-900/50 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bbt-accent/10 text-bbt-accent">
              <Search className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h3 id="company-portal-hotel-tariff-title" className="font-bold text-bbt-primary dark:text-white">
                Buscar no nosso tarifário
              </h3>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-slate-300">
                Consulte hotéis e valores offline de referência. A disponibilidade, as condições e o preço final serão confirmados pela agência na cotação.
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-bbt-accent/10 px-2.5 py-1 text-[11px] font-bold text-bbt-primary dark:text-white">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Tarifário offline
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Buscar hotel por nome, categoria ou endereço</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value.slice(0, 100))}
              className="bbt-input pl-9"
              placeholder="Digite hotel, categoria ou endereço"
              disabled={disabled || !context || loading}
            />
          </label>
          <button
            type="button"
            className="bbt-button-primary min-w-44 justify-center"
            disabled={disabled || !context || loading}
            onClick={() => context && void runSearch(context, query.trim())}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            {loading ? 'Consultando...' : 'Buscar no tarifário'}
          </button>
        </div>
        {!context && (
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300" role="status">
            {prerequisiteMessage}
          </p>
        )}
      </header>

      {preferredHotelIds.length > 0 && (
        <div className="border-b border-bbt-accent/30 px-4 py-3 dark:border-bbt-accent/40 sm:px-5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Hotéis adicionados como preferência</div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {preferredHotelIds.map((hotelId, index) => (
              <li key={hotelId} className="inline-flex min-h-9 items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-bbt-primary shadow-sm dark:bg-slate-900 dark:text-white">
                <span>{knownHotelNames[hotelId] || `Hotel preferencial ${index + 1}`}</span>
                <button
                  type="button"
                  onClick={() => toggleHotel(hotelId)}
                  disabled={disabled}
                  className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/30"
                  aria-label={`Remover ${knownHotelNames[hotelId] || `hotel preferencial ${index + 1}`}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200" role="alert">
          {error} Você ainda pode enviar o pedido sem hotel preferencial.
        </div>
      )}

      {searched && !loading && !error && items.length === 0 && (
        <div className="p-6 text-center">
          <Hotel className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Nenhum hotel encontrado neste tarifário.</p>
          <p className="mt-1 text-xs text-slate-500">O pedido pode seguir sem preferência para pesquisa manual da agência.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid gap-3 p-4 sm:p-5" aria-live="polite">
          {items.map((item) => (
            <HotelTariffCard
              key={item.hotelId}
              item={item}
              selected={preferredHotelIdSet.has(item.hotelId)}
              selectionDisabled={disabled || (!preferredHotelIdSet.has(item.hotelId) && preferredHotelIds.length >= MAX_PREFERRED_HOTELS)}
              onSelect={() => toggleHotel(item.hotelId)}
            />
          ))}
        </div>
      )}

      <footer className="border-t border-bbt-accent/30 bg-white/60 px-4 py-3 text-[11px] leading-4 text-slate-500 dark:border-bbt-accent/40 dark:bg-slate-900/30 dark:text-slate-400 sm:px-5">
        A consulta não realiza reserva e não garante disponibilidade. Até {MAX_PREFERRED_HOTELS} hotéis podem ser enviados como preferência para o consultor.
      </footer>
    </section>
  )
}

function HotelTariffCard({
  item,
  selected,
  selectionDisabled,
  onSelect,
}: {
  item: CompanyPortalHotelTariffSearchItem
  selected: boolean
  selectionDisabled: boolean
  onSelect: () => void
}) {
  const tariff = item.tariff
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900 md:flex">
      <HotelTariffGallery item={item} />
      <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-base font-black uppercase leading-tight text-bbt-primary dark:text-white">{item.name}</h4>
            <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{[item.address, item.city].filter(Boolean).join(' · ') || 'Localização cadastrada'}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {item.starRating && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{item.starRating} estrela{item.starRating === 1 ? '' : 's'}</span>}
            {item.category && <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">{item.category}</span>}
          </div>
        </div>

        {(item.amenities.length > 0 || tariff?.mealPlan) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {tariff?.mealPlan && <span className="inline-flex items-center gap-1"><Coffee className="h-3.5 w-3.5 text-bbt-accent" aria-hidden="true" />{tariff.mealPlan}</span>}
            {item.amenities.map((amenity) => <span key={amenity}>{amenity}</span>)}
          </div>
        )}

        <div className="mt-4 flex-1 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/80">
          {item.priceStatus === 'available' && tariff ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Diária de referência offline</div>
                  <div className="mt-0.5 text-xl font-black text-bbt-primary dark:text-white">
                    {formatCurrency(tariff.nightlyRate + tariff.nightlyTaxes, tariff.currency)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">diária + tributos cadastrados</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Total estimado · {tariff.roomCount} quarto{tariff.roomCount === 1 ? '' : 's'}
                  </div>
                  <div className="mt-0.5 text-lg font-black text-slate-800 dark:text-slate-100">{formatCurrency(tariff.estimatedTotal, tariff.currency)}</div>
                  <div className="text-[10px] text-slate-500">{tariff.nights} noite{tariff.nights === 1 ? '' : 's'}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                <span className="rounded-full bg-bbt-accent/10 px-2 py-1 text-bbt-primary dark:text-white">{tariff.label}</span>
                <span className="rounded-full bg-white px-2 py-1 text-slate-600 dark:bg-slate-900 dark:text-slate-300"><BedDouble className="mr-1 inline h-3 w-3" />{tariff.roomCategory}</span>
                <span className={tariff.refundable
                  ? 'rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'rounded-full bg-white px-2 py-1 text-slate-600 dark:bg-slate-900 dark:text-slate-300'}>
                  {tariff.refundable ? 'Reembolsável' : 'Não reembolsável'}
                </span>
              </div>
              {tariff.outsideValidity && <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">Referência fora da vigência regular; confirmação obrigatória pela agência.</p>}
            </>
          ) : (
            <div className="flex min-h-24 flex-col justify-center">
              <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {item.priceStatus === 'under_review' ? 'Tarifa sob consulta' : 'Valor a confirmar'}
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {item.priceStatus === 'under_review'
                  ? 'Existe referência interna, mas ela precisa ser convertida e validada pela agência antes de ser apresentada.'
                  : 'O hotel pode ser indicado como preferência para cotação manual.'}
              </p>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] leading-4 text-slate-500">Não é reserva nem confirmação de disponibilidade.</p>
          <button
            type="button"
            onClick={onSelect}
            disabled={selectionDisabled}
            aria-pressed={selected}
            className={selected
              ? 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-50 px-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'bbt-button-ghost justify-center text-sm'}
          >
            {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {selected ? 'Remover preferência' : 'Adicionar como preferência'}
          </button>
        </div>
      </div>
    </article>
  )
}

function HotelTariffGallery({ item }: { item: CompanyPortalHotelTariffSearchItem }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const images = item.images
  const safeIndex = images.length ? Math.min(activeIndex, images.length - 1) : 0
  const active = images[safeIndex]
  if (!active) {
    return (
      <div className="flex min-h-48 items-center justify-center bg-gradient-to-br from-bbt-accent/15 via-slate-100 to-bbt-primary/10 text-center dark:via-slate-800 md:min-h-full md:w-64 md:shrink-0 lg:w-72">
        <div className="p-6">
          <Hotel className="mx-auto h-10 w-10 text-bbt-primary/35 dark:text-white/30" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-300">Sem foto cadastrada</p>
        </div>
      </div>
    )
  }
  return (
    <div className="relative min-h-52 overflow-hidden bg-slate-100 dark:bg-slate-800 md:min-h-full md:w-64 md:shrink-0 lg:w-72">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={active.imageUrl} alt={active.altText || `${item.name} · foto ${safeIndex + 1}`} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/20 to-transparent px-3 pb-3 pt-10 text-white">
        <span className="min-w-0 truncate text-[10px] font-semibold">{active.scope === 'room' ? active.roomCategory || 'Foto do quarto' : 'Foto do hotel'}</span>
        <span className="shrink-0 rounded-full bg-black/40 px-2 py-0.5 text-[10px]">{safeIndex + 1}/{images.length}</span>
      </div>
      {images.length > 1 && (
        <>
          <button type="button" onClick={() => setActiveIndex((safeIndex - 1 + images.length) % images.length)} aria-label={`Foto anterior de ${item.name}`} className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/55 text-white hover:bg-slate-950/75"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setActiveIndex((safeIndex + 1) % images.length)} aria-label={`Próxima foto de ${item.name}`} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/55 text-white hover:bg-slate-950/75"><ChevronRight className="h-4 w-4" /></button>
        </>
      )}
    </div>
  )
}

function normalizeOccupancy(value: string): CompanyPortalHotelTariffOccupancyType | null {
  if (value === 'couple') return 'double'
  if (['single', 'double', 'twin', 'triple', 'quadruple', 'family'].includes(value)) {
    return value as CompanyPortalHotelTariffOccupancyType
  }
  return null
}

function searchPrerequisiteMessage(
  value: DetalhesHotel,
  occupancies: Array<CompanyPortalHotelTariffOccupancyType | null>,
  nights: number,
): string {
  if (!value.city_id) return 'Selecione a cidade para habilitar a consulta.'
  if (!value.data_checkin || !value.data_checkout || nights < 1) return 'Informe check-in e check-out válidos para consultar valores.'
  if (!value.rooms?.length) return 'Adicione pelo menos um quarto para consultar a ocupação.'
  if (occupancies.length !== 1 || !occupancies[0]) {
    return 'Para quartos com ocupações diferentes, o consultor montará os valores individualmente na cotação.'
  }
  return 'Complete os dados da hospedagem para consultar o tarifário.'
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

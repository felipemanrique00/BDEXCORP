'use client'

import {
  AlertTriangle,
  BedDouble,
  Building2,
  CalendarDays,
  CheckCircle2,
  Hotel,
  Loader2,
  Plus,
  ReceiptText,
  Send,
  Trash2,
  Users,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'

import { DateTimeInput } from '@/components/ui/date-input'
import { listHotelCatalog } from '@/lib/hotel-catalog/client'
import type { HotelCatalogItem, HotelCatalogSupplier } from '@/lib/hotel-catalog/types'
import { nightsBetween } from '@/lib/hotel-demand/model'
import { hotelDemandPreferredHotelIds } from '@/lib/hotel-demand/preferences'
import {
  listHotelRateSuggestions,
  type HotelRateSuggestion,
} from '@/lib/offline-travel/hotel-rate-suggestion'
import {
  buildPreferredHotelQuoteDrafts,
  preferredRoomType,
} from '@/lib/offline-travel/hotel-quote-draft'
import { moneyToMinorUnits, minorUnitsToMoney } from '@/lib/offline-travel/money'
import { createOfflineHotelQuoteFromServer } from '@/lib/offline-travel/quote-client'
import {
  offlineHotelQuoteCreateSchema,
  type OfflineHotelQuoteCreateInput,
} from '@/lib/offline-travel/quote-schema'
import type { Atendimento, Empresa, HotelDemandRoom } from '@/types'

const MIN_OPTIONS = 1
const MAX_OPTIONS = 10
const CURRENCY = 'BRL'
const ELIGIBLE_LIFECYCLE_STATUSES = new Set([
  'draft',
  'submitted',
  'approved_for_quotation',
  'quoting',
  'pending_choice',
])

export interface OfflineHotelQuoteContext {
  demandId: string
  lifecycleStatus: string
}

export interface OfflineHotelQuoteFormProps {
  demands: Atendimento[]
  companies: Empresa[]
  initialDemandId?: string
  onCompleted: () => void
  onContextChange?: (context: OfflineHotelQuoteContext) => void
}

interface QuoteOptionDraft {
  clientId: string
  hotelId: string
  hotelSupplierId: string
  supplierName: string
  supplierCode: string
  pricingMode: 'catalog' | 'manual_override' | 'manual'
  rateId: string
  rateVersion: number | null
  rateScopeLabel: string
  rateOutsideValidity: boolean
  outOfPeriodPolicy: 'block' | 'warn' | 'allow'
  roomCategory: string
  mealPlan: string
  nightlyRate: string
  nightlyTaxes: string
  serviceFee: string
  refundable: boolean
  cancellationDeadline: string
  cancellationPolicy: string
  paymentTerms: string
  notes: string
}

interface OptionPreview {
  nightlyRateMinor: number
  nightlyTaxesMinor: number
  serviceFeeMinor: number
  roomSubtotalMinor: number
  taxesSubtotalMinor: number
  totalMinor: number
}

export function OfflineHotelQuoteForm({
  demands,
  companies,
  initialDemandId,
  onCompleted,
  onContextChange,
}: OfflineHotelQuoteFormProps) {
  const [demandId, setDemandId] = useState('')
  const [options, setOptions] = useState<QuoteOptionDraft[]>(initialOptions)
  const [expiresAt, setExpiresAt] = useState('')
  const [policyJustification, setPolicyJustification] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [hotels, setHotels] = useState<HotelCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [preferredHotelWarning, setPreferredHotelWarning] = useState('')
  const [rateSuggestions, setRateSuggestions] = useState<HotelRateSuggestion[]>([])
  const [rateSuggestionMessage, setRateSuggestionMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const nextOptionNumberRef = useRef(MIN_OPTIONS + 1)
  const appliedInitialDemandRef = useRef('')
  const preparedDemandRef = useRef('')

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  )
  const eligibleDemands = useMemo(
    () => [...demands]
      .filter((demand) => isHotelDemand(demand))
      .filter((demand) => Boolean(demand.serial_os))
      .filter((demand) => companyById.has(demand.empresa_id))
      .filter((demand) => ELIGIBLE_LIFECYCLE_STATUSES.has(lifecycleStatus(demand)))
      .sort((left, right) => (
        String(right.updated_at || right.created_at).localeCompare(String(left.updated_at || left.created_at))
      )),
    [companyById, demands],
  )
  const selectedDemand = useMemo(
    () => eligibleDemands.find((demand) => demand.id === demandId) || null,
    [demandId, eligibleDemands],
  )
  const selectedCompany = selectedDemand ? companyById.get(selectedDemand.empresa_id) : undefined
  const hotelDetails = selectedDemand?.detalhes_hotel
  const rooms = useMemo(() => hotelDetails?.rooms || [], [hotelDetails?.rooms])
  const roomCount = rooms.length
  const guestCount = rooms.reduce((total, room) => total + room.guests.length, 0)
  const nights = nightsBetween(hotelDetails?.data_checkin || '', hotelDetails?.data_checkout || '')
  const catalogCityName = String(hotelDetails?.cidade || '').trim() || 'cidade da demanda'
  const catalogLocation = locationLabel(catalogCityName, hotels[0]?.subdivisionCode)
  const selectedOfferKeys = useMemo(
    () => new Set(options.flatMap((option) => (
      option.hotelId && option.hotelSupplierId
        ? [`${option.hotelId}:${option.hotelSupplierId}`]
        : []
    ))),
    [options],
  )

  useEffect(() => {
    const requested = String(initialDemandId || '').trim()
    if (!requested) {
      appliedInitialDemandRef.current = ''
      return
    }
    if (appliedInitialDemandRef.current === requested) return
    if (!eligibleDemands.some((demand) => demand.id === requested)) return
    appliedInitialDemandRef.current = requested
    setDemandId(requested)
    resetQuoteDraft()
  }, [eligibleDemands, initialDemandId])

  useEffect(() => {
    onContextChange?.({
      demandId,
      lifecycleStatus: selectedDemand ? lifecycleStatus(selectedDemand) : '',
    })
  }, [demandId, onContextChange, selectedDemand])

  useEffect(() => {
    const cityId = String(hotelDetails?.city_id || '').trim()
    if (!selectedDemand || !cityId) {
      setHotels([])
      setRateSuggestions([])
      setRateSuggestionMessage('')
      setPreferredHotelWarning('')
      setCatalogError(selectedDemand
        ? 'A demanda não possui uma cidade relacional válida para consultar o catálogo de hotéis.'
        : '')
      setCatalogLoading(false)
      return
    }

    let active = true
    setCatalogLoading(true)
    setCatalogError('')
    setHotels([])
    setRateSuggestions([])
    setRateSuggestionMessage('')
    void Promise.all([
      listHotelCatalog({ cityId, status: 'active', quotable: 'true', limit: '200' }),
      listHotelRateSuggestions(selectedDemand.id).catch((error: unknown) => ({
        demandId: selectedDemand.id,
        companyId: selectedDemand.empresa_id,
        groupId: null,
        checkIn: '',
        checkOut: '',
        occupancyType: null,
        items: [],
        manualReason: error instanceof Error
          ? error.message
          : 'As tarifas cadastradas nao puderam ser consultadas; preencha os valores manualmente.',
      })),
    ])
      .then(([items, suggestionResult]) => {
        if (!active) return
        const activeHotels = items
          .filter((hotel) => hotel.status === 'active' && hotel.cityId === cityId)
          .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
        const activeHotelIds = new Set(activeHotels.map((hotel) => hotel.id))
        const availableSuggestions = suggestionResult.items.filter((item) => activeHotelIds.has(item.hotelId))
        const suggestionByHotelId = new Map<string, HotelRateSuggestion>()
        for (const suggestion of availableSuggestions) {
          if (!suggestionByHotelId.has(suggestion.hotelId)) {
            suggestionByHotelId.set(suggestion.hotelId, suggestion)
          }
        }
        setHotels(activeHotels)
        setRateSuggestions(availableSuggestions)
        setRateSuggestionMessage(suggestionResult.manualReason || '')
        if (preparedDemandRef.current !== selectedDemand.id) {
          const preferredHotelIds = hotelDemandPreferredHotelIds(selectedDemand.detalhes_hotel)
          const prepared = buildPreferredHotelQuoteDrafts({
            preferredHotelIds,
            hotels: activeHotels,
            rooms,
          })
          const preparedOptions = prepared.drafts.length
            ? prepared.drafts.map((draft, index) => ({
                ...emptyOption(index + 1),
                ...draft,
                ...suggestionPatch(suggestionByHotelId.get(draft.hotelId)),
              }))
            : initialOptions()
          setOptions(preparedOptions)
          nextOptionNumberRef.current = preparedOptions.length + 1
          setPreferredHotelWarning(prepared.unavailableHotelIds.length
            ? `${prepared.unavailableHotelIds.length} hotel${prepared.unavailableHotelIds.length === 1 ? '' : 'is'} preferencial${prepared.unavailableHotelIds.length === 1 ? '' : 'is'} deixou${prepared.unavailableHotelIds.length === 1 ? '' : 'ram'} de estar disponível${prepared.unavailableHotelIds.length === 1 ? '' : 'is'} para cotação. As demais preferências foram mantidas.`
            : '')
          preparedDemandRef.current = selectedDemand.id
        }
        if (!activeHotels.length) {
          setCatalogError(
            `Nenhum hotel elegível para cotação foi encontrado em ${catalogCityName}. `
            + 'Verifique se o hotel está ativo e vinculado a um fornecedor comercial ativo de hotel.',
          )
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setCatalogError(error instanceof Error
          ? error.message
          : 'Não foi possível carregar os hotéis da cidade selecionada.')
      })
      .finally(() => {
        if (active) setCatalogLoading(false)
      })

    return () => {
      active = false
    }
  }, [catalogCityName, hotelDetails?.city_id, rooms, selectedDemand])

  function resetQuoteDraft() {
    setOptions(initialOptions())
    setExpiresAt('')
    setPolicyJustification('')
    setConfirmed(false)
    setPreferredHotelWarning('')
    setRateSuggestions([])
    setRateSuggestionMessage('')
    preparedDemandRef.current = ''
    nextOptionNumberRef.current = MIN_OPTIONS + 1
  }

  function selectDemand(nextDemandId: string) {
    setDemandId(nextDemandId)
    resetQuoteDraft()
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) return
    const nextNumber = nextOptionNumberRef.current
    nextOptionNumberRef.current += 1
    setOptions((current) => [...current, emptyOption(nextNumber)])
    setConfirmed(false)
  }

  function removeOption(clientId: string) {
    if (options.length <= MIN_OPTIONS) {
      toast.error('A cotação deve manter pelo menos uma opção.')
      return
    }
    setOptions((current) => current.filter((option) => option.clientId !== clientId))
    setConfirmed(false)
  }

  function patchOption(clientId: string, patch: Partial<QuoteOptionDraft>) {
    setOptions((current) => current.map((option) => (
      option.clientId === clientId
        ? {
            ...option,
            ...patch,
            pricingMode: option.pricingMode === 'catalog' && changesCatalogRate(patch)
              ? 'manual_override'
              : (patch.pricingMode || option.pricingMode),
          }
        : option
    )))
    setConfirmed(false)
  }

  function selectHotel(clientId: string, hotelId: string) {
    const hotel = hotels.find((item) => item.id === hotelId)
    const matchingRoomType = hotel
      ? preferredRoomType(hotel, rooms)
      : null
    const suggestion = rateSuggestions.find((item) => item.hotelId === hotelId)
    const defaultSupplier = hotel
      ? eligibleHotelSuppliers(hotel, hotelDetails?.data_checkin, hotelDetails?.data_checkout)[0]
      : undefined
    setOptions((current) => current.map((option) => option.clientId === clientId
      ? {
          ...emptyOptionDraft(option.clientId),
          hotelId,
          roomCategory: matchingRoomType?.name || matchingRoomType?.code || '',
          ...(suggestion ? suggestionPatch(suggestion) : supplierPatch(defaultSupplier)),
        }
      : option))
    setConfirmed(false)
  }

  function selectSupplier(clientId: string, hotelSupplierId: string) {
    setOptions((current) => current.map((option) => {
      if (option.clientId !== clientId) return option
      const hotel = hotels.find((item) => item.id === option.hotelId)
      const supplier = hotel
        ? eligibleHotelSuppliers(hotel, hotelDetails?.data_checkin, hotelDetails?.data_checkout)
          .find((item) => item.id === hotelSupplierId)
        : undefined
      const suggestion = rateSuggestions.find((item) => (
        item.hotelId === option.hotelId && item.hotelSupplierId === hotelSupplierId
      ))
      return {
        ...option,
        ...(!suggestion && option.rateId ? {
          mealPlan: '',
          nightlyRate: '',
          nightlyTaxes: '0',
          serviceFee: '0',
          refundable: false,
          cancellationPolicy: '',
          paymentTerms: '',
        } : {}),
        ...(suggestion ? suggestionPatch(suggestion) : supplierPatch(supplier)),
      }
    }))
    setConfirmed(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!selectedDemand?.serial_os || !selectedCompany) {
      toast.error('Selecione uma demanda de hotel válida antes de publicar a cotação.')
      return
    }
    if (nights < 1 || roomCount < 1) {
      toast.error('A demanda precisa ter período e quartos válidos antes da cotação.')
      return
    }
    if (catalogLoading) {
      toast.error('Aguarde o carregamento do catálogo de hotéis.')
      return
    }
    if (!confirmed) {
      toast.error('Confirme que revisou as opções antes de publicar.')
      return
    }

    const lifecycleVersion = positiveInteger(selectedDemand.relational_lifecycle_version)
    const rawInput = {
      demandId: selectedDemand.id,
      expectedLifecycleVersion: lifecycleVersion,
      expiresAt: localDateTimeToIso(expiresAt),
      policyJustification,
      confirmed: true,
      idempotencyKey: `offline-hotel-quote:${selectedDemand.id}:${crypto.randomUUID()}`,
      options: options.map((option) => ({
        clientId: option.clientId,
        hotelId: option.hotelId,
        hotelSupplierId: option.hotelSupplierId,
        pricingMode: option.pricingMode,
        rateReference: option.rateId && option.rateVersion
          ? { id: option.rateId, version: option.rateVersion }
          : undefined,
        roomCategory: option.roomCategory,
        mealPlan: option.mealPlan,
        nightlyRate: option.nightlyRate,
        nightlyTaxes: option.nightlyTaxes || '0',
        serviceFee: option.serviceFee || '0',
        refundable: option.refundable,
        cancellationDeadline: localDateTimeToIso(option.cancellationDeadline),
        cancellationPolicy: option.cancellationPolicy,
        paymentTerms: option.paymentTerms,
        notes: option.notes,
      })),
    }
    const candidate = offlineHotelQuoteCreateSchema.safeParse(rawInput)
    if (!candidate.success) {
      toast.error(candidate.error.issues[0]?.message || 'Revise os dados das opções de hotel.')
      return
    }

    setBusy(true)
    try {
      const result = await createOfflineHotelQuoteFromServer(candidate.data as OfflineHotelQuoteCreateInput)
      toast.success(
        `Cotação com ${result.options.length} ${result.options.length === 1 ? 'opção' : 'opções'} publicada para a OS ${result.demandNumber || selectedDemand.serial_os}.`,
      )
      resetQuoteDraft()
      setDemandId('')
      onCompleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível publicar a cotação de hotel.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bbt-card p-5" aria-labelledby="offline-hotel-quote-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
            <Hotel className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="bbt-section-label">Cotação offline de hotel</p>
            <h2 id="offline-hotel-quote-title" className="mt-1 font-semibold text-bbt-primary dark:text-white">
              Publicar opções para escolha do solicitante
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Cadastre de uma a dez alternativas. A publicação envia a demanda para escolha, sem criar reserva ou emissão.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800 dark:border-cyan-900/60 dark:bg-cyan-900/20 dark:text-cyan-200">
          Fluxo do consultor
        </span>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-5">
        <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
          <section className="rounded-lg border border-bbt-accent/25 bg-bbt-accent/5 p-4" aria-labelledby="hotel-quote-demand-title">
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Serial/OS de hotel *">
                <select
                  value={demandId}
                  onChange={(event) => selectDemand(event.target.value)}
                  className="bbt-input"
                  required
                >
                  <option value="">Selecione uma demanda elegível</option>
                  {eligibleDemands.map((demand) => (
                    <option key={demand.id} value={demand.id}>
                      {demand.serial_os} · {demand.passageiro_nome} · {companyById.get(demand.empresa_id)?.nome || 'Empresa não localizada'} · {statusLabel(lifecycleStatus(demand))}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Empresa vinculada">
                <div className="bbt-input flex items-center gap-2 bg-slate-50 text-sm dark:bg-slate-900/40">
                  <Building2 className="h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />
                  {selectedCompany?.nome || 'Selecione a OS para identificar a empresa'}
                </div>
              </Field>
            </div>

            {!eligibleDemands.length && (
              <div className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Nenhuma demanda de hotel está em uma etapa que aceite cotação.
              </div>
            )}

            {selectedDemand && (
              <DemandSummary
                demand={selectedDemand}
                rooms={rooms}
                nights={nights}
                guestCount={guestCount}
              />
            )}
          </section>

          {selectedDemand && (
            <>
              <section className="rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-700" aria-labelledby="hotel-quote-publication-title">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-bbt-accent" aria-hidden="true" />
                  <h3 id="hotel-quote-publication-title" className="font-semibold text-bbt-primary dark:text-white">
                    Publicação
                  </h3>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <TemporalField label="Validade da cotação">
                    <DateTimeInput
                      aria-label="Validade da cotação"
                      value={expiresAt}
                      onChange={(event) => {
                        setExpiresAt(event.target.value)
                        setConfirmed(false)
                      }}
                    />
                  </TemporalField>
                  <Field label="Justificativa de política">
                    <input
                      value={policyJustification}
                      onChange={(event) => {
                        setPolicyJustification(event.target.value)
                        setConfirmed(false)
                      }}
                      className="bbt-input"
                      placeholder="Informe quando a política exigir"
                      maxLength={2000}
                    />
                  </Field>
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="hotel-quote-options-title">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 id="hotel-quote-options-title" className="font-semibold text-bbt-primary dark:text-white">
                      Opções para comparação
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      O mesmo hotel pode ser cotado por fornecedores diferentes; a combinação hotel e fornecedor não pode se repetir.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addOption}
                    disabled={options.length >= MAX_OPTIONS || catalogLoading || Boolean(catalogError)}
                    className="bbt-button-ghost disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar opção
                  </button>
                </div>

                <div
                  className="rounded-lg border border-cyan-200 bg-cyan-50/60 px-4 py-3 text-sm text-cyan-950 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-100"
                  data-hotel-catalog-location={catalogLocation}
                >
                  <strong>Catálogo consultado:</strong> {catalogLocation}. Somente hotéis ativos desta cidade,
                  com fornecedor comercial de hotel ativo, podem ser usados na cotação.
                </div>

                {catalogLoading && (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carregando hotéis elegíveis em {catalogCityName}...
                  </div>
                )}
                {!catalogLoading && catalogError && (
                  <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {catalogError}
                  </div>
                )}
                {!catalogLoading && preferredHotelWarning && (
                  <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200" role="status">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {preferredHotelWarning}
                  </div>
                )}
                {!catalogLoading && rateSuggestionMessage && (
                  <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200" role="status">
                    <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />
                    {rateSuggestionMessage}
                  </div>
                )}

                {!catalogLoading && !catalogError && options.map((option, index) => (
                  <QuoteOptionEditor
                    key={option.clientId}
                    index={index}
                    option={option}
                    hotels={hotels}
                    selectedOfferKeys={selectedOfferKeys}
                    rateSuggestion={rateSuggestions.find((item) => (
                      item.hotelId === option.hotelId
                      && item.hotelSupplierId === option.hotelSupplierId
                    )) || null}
                    isRequesterPreferred={hotelDemandPreferredHotelIds(selectedDemand.detalhes_hotel).includes(option.hotelId)}
                    nights={nights}
                    roomCount={roomCount}
                    checkIn={hotelDetails?.data_checkin || ''}
                    checkOut={hotelDetails?.data_checkout || ''}
                    canRemove={options.length > MIN_OPTIONS}
                    onPatch={(patch) => patchOption(option.clientId, patch)}
                    onSelectHotel={(hotelId) => selectHotel(option.clientId, hotelId)}
                    onSelectSupplier={(hotelSupplierId) => selectSupplier(option.clientId, hotelSupplierId)}
                    onReapplySuggestion={(suggestion) => patchOption(option.clientId, suggestionPatch(suggestion))}
                    onRemove={() => removeOption(option.clientId)}
                  />
                ))}
              </section>

              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                confirmed
                  ? 'border-green-300 bg-green-50 dark:border-green-900/60 dark:bg-green-950/20'
                  : 'border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20'
              }`}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-green-600"
                />
                <span>
                  <span className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Confirmação humana obrigatória
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-slate-600 dark:text-slate-300">
                    Confirmo que revisei hotéis, quartos, valores, taxas, prazos e políticas. Ao publicar, as opções ficarão disponíveis para escolha do solicitante.
                  </span>
                </span>
              </label>
            </>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
          <p className="text-xs text-slate-500">
            O servidor recalculará os valores e validará demanda, hotéis, lifecycle, política e idempotência.
          </p>
          <button
            type="submit"
            disabled={busy || catalogLoading || Boolean(catalogError) || !selectedDemand || !confirmed}
            className="bbt-button-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {busy ? 'Publicando...' : 'Publicar cotação para escolha'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default OfflineHotelQuoteForm

function DemandSummary({
  demand,
  rooms,
  nights,
  guestCount,
}: {
  demand: Atendimento
  rooms: HotelDemandRoom[]
  nights: number
  guestCount: number
}) {
  const details = demand.detalhes_hotel
  return (
    <div className="mt-4 border-t border-bbt-accent/20 pt-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryItem icon={CalendarDays} label="Período" value={
          details?.data_checkin && details?.data_checkout
            ? `${formatDate(details.data_checkin)} a ${formatDate(details.data_checkout)}`
            : 'Não informado'
        } />
        <SummaryItem icon={ReceiptText} label="Diárias" value={nights > 0 ? String(nights) : 'Período inválido'} />
        <SummaryItem icon={BedDouble} label="Quartos" value={String(rooms.length)} />
        <SummaryItem icon={Users} label="Hóspedes" value={String(guestCount)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span className="rounded bg-white/80 px-2 py-1 dark:bg-slate-900/40">
          <strong>Destino:</strong> {details?.cidade || 'Não informado'}
        </span>
        <span className="rounded bg-white/80 px-2 py-1 dark:bg-slate-900/40">
          <strong>Status:</strong> {statusLabel(lifecycleStatus(demand))}
        </span>
        {rooms.map((room, index) => (
          <span key={room.client_id} className="rounded bg-white/80 px-2 py-1 dark:bg-slate-900/40">
            <strong>Quarto {index + 1}:</strong> {occupancyLabel(room.occupancy_code)} · {room.guests.map((guest) => guest.name).join(', ') || 'sem hóspedes'}
          </span>
        ))}
      </div>
    </div>
  )
}

function QuoteOptionEditor({
  index,
  option,
  hotels,
  selectedOfferKeys,
  rateSuggestion,
  isRequesterPreferred,
  nights,
  roomCount,
  checkIn,
  checkOut,
  canRemove,
  onPatch,
  onSelectHotel,
  onSelectSupplier,
  onReapplySuggestion,
  onRemove,
}: {
  index: number
  option: QuoteOptionDraft
  hotels: HotelCatalogItem[]
  selectedOfferKeys: ReadonlySet<string>
  rateSuggestion: HotelRateSuggestion | null
  isRequesterPreferred: boolean
  nights: number
  roomCount: number
  checkIn: string
  checkOut: string
  canRemove: boolean
  onPatch: (patch: Partial<QuoteOptionDraft>) => void
  onSelectHotel: (hotelId: string) => void
  onSelectSupplier: (hotelSupplierId: string) => void
  onReapplySuggestion: (suggestion: HotelRateSuggestion) => void
  onRemove: () => void
}) {
  const hotel = hotels.find((item) => item.id === option.hotelId)
  const preview = optionPreview(option, nights, roomCount)
  const datalistId = `hotel-quote-room-types-${option.clientId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  return (
    <article className="rounded-xl border border-bbt-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-bbt-accent">Opção {index + 1}</p>
            {isRequesterPreferred && (
              <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200">
                Preferência do solicitante
              </span>
            )}
            {option.rateScopeLabel && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                option.pricingMode === 'catalog'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
              }`}>
                {option.pricingMode === 'catalog'
                  ? option.rateScopeLabel
                  : `${option.rateScopeLabel} · editada`}
              </span>
            )}
          </div>
          <h4 className="mt-1 font-semibold text-bbt-primary dark:text-white">
            {hotel?.name || 'Selecione o hotel'}
          </h4>
          {hotel && (
            <p className="mt-1 text-xs text-slate-500">
              {[hotelLocationLabel(hotel), hotel.category, hotel.address].filter(Boolean).join(' · ') || 'Hotel cadastrado'}
            </p>
          )}
          {option.supplierName && (
            <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              Fornecedor: {option.supplierName}{option.supplierCode ? ` · ${option.supplierCode}` : ''}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="bbt-button-ghost h-9 px-3 text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
          aria-label={`Remover opção ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Remover
        </button>
      </div>

      {rateSuggestion && option.pricingMode === 'manual_override' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
          <span>Os dados cadastrados foram editados manualmente e serao publicados como excecao auditavel.</span>
          <button
            type="button"
            onClick={() => onReapplySuggestion(rateSuggestion)}
            className="rounded-md border border-amber-300 px-2.5 py-1 font-semibold hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
          >
            Reaplicar tarifa cadastrada
          </button>
        </div>
      )}
      {option.rateOutsideValidity && (
        <div className={`mt-3 flex gap-2 rounded-lg border px-3 py-2 text-xs ${
          option.outOfPeriodPolicy === 'warn'
            ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100'
            : 'border-cyan-200 bg-cyan-50 text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-100'
        }`} role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Tarifa fora da vigencia cadastrada, utilizada conforme a politica do vinculo ({
            option.outOfPeriodPolicy === 'warn' ? 'permitir com alerta' : 'permitir'
          }). Revise os valores antes de publicar.
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Hotel ativo *">
          <select
            value={option.hotelId}
            onChange={(event) => onSelectHotel(event.target.value)}
            className="bbt-input"
            required
          >
            <option value="">Selecione o hotel</option>
            {hotels.map((item) => (
              <option
                key={item.id}
                value={item.id}
              >
                {[item.name, hotelLocationLabel(item), item.category].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Fornecedor operacional *">
          <select
            value={option.hotelSupplierId}
            onChange={(event) => onSelectSupplier(event.target.value)}
            className="bbt-input"
            required
            disabled={!hotel}
          >
            <option value="">Selecione o fornecedor</option>
            {hotel ? eligibleHotelSuppliers(hotel, checkIn, checkOut).map((supplier) => (
              <option
                key={supplier.id}
                value={supplier.id}
                disabled={
                  supplier.id !== option.hotelSupplierId
                  && selectedOfferKeys.has(`${hotel.id}:${supplier.id}`)
                }
              >
                {supplier.supplierName}{supplier.supplierCode ? ` · ${supplier.supplierCode}` : ''}
              </option>
            )) : null}
          </select>
        </Field>

        <Field label="Categoria do quarto *">
          <input
            value={option.roomCategory}
            onChange={(event) => onPatch({ roomCategory: event.target.value })}
            className="bbt-input"
            placeholder="Ex.: Standard casal"
            list={datalistId}
            maxLength={200}
            required
          />
          <datalist id={datalistId}>
            {hotel?.roomTypes.filter((roomType) => roomType.isActive).map((roomType) => (
              <option key={roomType.id} value={roomType.name || roomType.code} />
            ))}
          </datalist>
        </Field>

        <Field label="Regime de alimentação">
          <input
            value={option.mealPlan}
            onChange={(event) => onPatch({ mealPlan: event.target.value })}
            className="bbt-input"
            placeholder="Ex.: Café da manhã"
            maxLength={200}
          />
        </Field>

        <Field label="Diária por quarto *">
          <MoneyInput value={option.nightlyRate} onChange={(value) => onPatch({ nightlyRate: value })} required />
        </Field>

        <Field label="Taxas por diária/quarto">
          <MoneyInput value={option.nightlyTaxes} onChange={(value) => onPatch({ nightlyTaxes: value })} />
        </Field>

        <Field label="Taxa de serviço da hospedagem">
          <MoneyInput value={option.serviceFee} onChange={(value) => onPatch({ serviceFee: value })} />
        </Field>

        <TemporalField label="Prazo para cancelamento">
          <DateTimeInput
            aria-label="Prazo para cancelamento"
            value={option.cancellationDeadline}
            onChange={(event) => onPatch({ cancellationDeadline: event.target.value })}
          />
        </TemporalField>

        <Field label="Condições de pagamento">
          <input
            value={option.paymentTerms}
            onChange={(event) => onPatch({ paymentTerms: event.target.value })}
            className="bbt-input"
            placeholder="Ex.: Faturado em 15 dias"
            maxLength={2000}
          />
        </Field>

        <label className="flex min-h-[68px] items-center gap-3 rounded-lg border border-bbt-gray-100 px-3 py-2 dark:border-slate-700">
          <input
            type="checkbox"
            checked={option.refundable}
            onChange={(event) => onPatch({ refundable: event.target.checked })}
            className="h-5 w-5 accent-bbt-accent"
          />
          <span>
            <span className="block text-sm font-semibold text-bbt-primary dark:text-white">Tarifa reembolsável</span>
            <span className="mt-0.5 block text-xs text-slate-500">Sujeita à política informada abaixo.</span>
          </span>
        </label>

        <div className="md:col-span-2 xl:col-span-3">
          <Field label="Política de cancelamento">
            <textarea
              value={option.cancellationPolicy}
              onChange={(event) => onPatch({ cancellationPolicy: event.target.value })}
              className="bbt-input min-h-20 py-2"
              placeholder="Descreva multas, prazos, no-show e condições de reembolso"
              maxLength={4000}
            />
          </Field>
        </div>

        <div className="md:col-span-2 xl:col-span-3">
          <Field label="Observações da opção">
            <textarea
              value={option.notes}
              onChange={(event) => onPatch({ notes: event.target.value })}
              className="bbt-input min-h-20 py-2"
              placeholder="Inclua detalhes relevantes para a comparação"
              maxLength={8000}
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3 dark:border-cyan-900/50 dark:bg-cyan-950/20">
        <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <PreviewValue label="Diárias dos quartos" value={formatMinor(preview.roomSubtotalMinor)} />
          <PreviewValue label="Taxas das diárias" value={formatMinor(preview.taxesSubtotalMinor)} />
          <PreviewValue label="Taxa de serviço" value={formatMinor(preview.serviceFeeMinor)} />
          <PreviewValue label="Total previsto" value={formatMinor(preview.totalMinor)} strong />
        </div>
        <p className="mt-2 text-[11px] text-cyan-900/75 dark:text-cyan-100/75">
          ({formatMinor(preview.nightlyRateMinor)} + {formatMinor(preview.nightlyTaxesMinor)}) × {Math.max(nights, 0)} noite{nights === 1 ? '' : 's'} × {roomCount} quarto{roomCount === 1 ? '' : 's'} + {formatMinor(preview.serviceFeeMinor)}
        </p>
      </div>
    </article>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  )
}

function TemporalField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
        {label}
      </span>
      {children}
    </div>
  )
}

function MoneyInput({
  value,
  onChange,
  required = false,
}: {
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-slate-400">
        R$
      </span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bbt-input pl-10"
        placeholder="0,00"
        required={required}
      />
    </div>
  )
}

function SummaryItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/80 p-3 dark:bg-slate-900/40">
      <Icon className="h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className="truncate text-sm font-semibold text-bbt-primary dark:text-white">{value}</div>
      </div>
    </div>
  )
}

function PreviewValue({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-cyan-900/70 dark:text-cyan-100/70">{label}</div>
      <div className={strong
        ? 'mt-0.5 text-base font-bold text-bbt-primary dark:text-white'
        : 'mt-0.5 font-semibold text-cyan-950 dark:text-cyan-50'}>
        {value}
      </div>
    </div>
  )
}

function initialOptions(): QuoteOptionDraft[] {
  return [emptyOption(1)]
}

function emptyOption(number: number): QuoteOptionDraft {
  return emptyOptionDraft(`hotel-option-${number}`)
}

function emptyOptionDraft(clientId: string): QuoteOptionDraft {
  return {
    clientId,
    hotelId: '',
    hotelSupplierId: '',
    supplierName: '',
    supplierCode: '',
    pricingMode: 'manual',
    rateId: '',
    rateVersion: null,
    rateScopeLabel: '',
    rateOutsideValidity: false,
    outOfPeriodPolicy: 'block',
    roomCategory: '',
    mealPlan: '',
    nightlyRate: '',
    nightlyTaxes: '0',
    serviceFee: '0',
    refundable: false,
    cancellationDeadline: '',
    cancellationPolicy: '',
    paymentTerms: '',
    notes: '',
  }
}

function suggestionPatch(suggestion: HotelRateSuggestion | undefined): Partial<QuoteOptionDraft> {
  if (!suggestion) return {}
  return {
    hotelSupplierId: suggestion.hotelSupplierId,
    supplierName: suggestion.supplierName,
    supplierCode: suggestion.supplierCode,
    pricingMode: 'catalog',
    rateId: suggestion.rateId,
    rateVersion: suggestion.rateVersion,
    rateScopeLabel: suggestion.scopeLabel,
    rateOutsideValidity: suggestion.outsideValidity,
    outOfPeriodPolicy: suggestion.outOfPeriodPolicy,
    roomCategory: suggestion.roomCategory,
    mealPlan: suggestion.mealPlan || '',
    nightlyRate: moneyField(suggestion.nightlyRate),
    nightlyTaxes: moneyField(suggestion.nightlyTaxes),
    serviceFee: moneyField(suggestion.serviceFee),
    refundable: suggestion.refundable,
    cancellationPolicy: suggestion.cancellationPolicy || '',
    paymentTerms: suggestion.paymentTerms || '',
  }
}

function supplierPatch(supplier: HotelCatalogSupplier | undefined): Partial<QuoteOptionDraft> {
  return {
    hotelSupplierId: supplier?.id || '',
    supplierName: supplier?.supplierName || '',
    supplierCode: supplier?.supplierCode || '',
    pricingMode: 'manual',
    rateId: '',
    rateVersion: null,
    rateScopeLabel: '',
    rateOutsideValidity: false,
    outOfPeriodPolicy: 'block',
  }
}

function moneyField(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function changesCatalogRate(patch: Partial<QuoteOptionDraft>): boolean {
  return [
    'roomCategory', 'mealPlan', 'nightlyRate', 'nightlyTaxes', 'serviceFee',
    'refundable', 'cancellationDeadline', 'cancellationPolicy', 'paymentTerms',
  ].some((key) => key in patch)
}

function optionPreview(option: QuoteOptionDraft, nights: number, roomCount: number): OptionPreview {
  const nightlyRateMinor = safeMinor(option.nightlyRate)
  const nightlyTaxesMinor = safeMinor(option.nightlyTaxes)
  const serviceFeeMinor = safeMinor(option.serviceFee)
  const multiplier = Math.max(0, nights) * Math.max(0, roomCount)
  const roomSubtotalMinor = nightlyRateMinor * multiplier
  const taxesSubtotalMinor = nightlyTaxesMinor * multiplier
  return {
    nightlyRateMinor,
    nightlyTaxesMinor,
    serviceFeeMinor,
    roomSubtotalMinor,
    taxesSubtotalMinor,
    totalMinor: roomSubtotalMinor + taxesSubtotalMinor + serviceFeeMinor,
  }
}

function safeMinor(value: string): number {
  if (!String(value || '').trim()) return 0
  try {
    return moneyToMinorUnits(value)
  } catch {
    return 0
  }
}

function formatMinor(value: number): string {
  return minorUnitsToMoney(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: CURRENCY,
  })
}

function hotelLocationLabel(hotel: HotelCatalogItem): string {
  return locationLabel(hotel.cityName, hotel.subdivisionCode)
}

function eligibleHotelSuppliers(
  hotel: HotelCatalogItem,
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): HotelCatalogSupplier[] {
  const start = String(checkIn || '').slice(0, 10)
  const endDate = new Date(`${String(checkOut || '').slice(0, 10)}T00:00:00Z`)
  const lastNight = Number.isFinite(endDate.getTime())
    ? new Date(endDate.getTime() - 86_400_000).toISOString().slice(0, 10)
    : ''
  return hotel.suppliers.filter((supplier) => (
    supplier.isActive
    && (!start || !supplier.validFrom || supplier.validFrom <= start)
    && (!lastNight || !supplier.validUntil || supplier.validUntil >= lastNight)
  ))
}

function locationLabel(city: string | null | undefined, subdivisionCode: string | null | undefined): string {
  const normalizedCity = String(city || '').trim()
  const normalizedSubdivision = String(subdivisionCode || '').trim().toUpperCase()
  if (normalizedCity && normalizedSubdivision) return `${normalizedCity}/${normalizedSubdivision}`
  return normalizedCity || normalizedSubdivision
}

function lifecycleStatus(demand: Atendimento): string {
  const relational = String(demand.relational_lifecycle_status || '').trim()
  if (relational) return relational
  if (demand.status === 'pendente') return 'draft'
  if (demand.status === 'em_andamento') return 'quoting'
  if (demand.status === 'aguardando_cliente') return 'pending_choice'
  return String(demand.status || '')
}

function isHotelDemand(demand: Atendimento): boolean {
  return String(demand.tipo_servico || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase() === 'hotel'
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Rascunho',
    submitted: 'Enviada',
    approved_for_quotation: 'Liberada para cotação',
    quoting: 'Em cotação',
    pending_choice: 'Aguardando escolha',
  }
  return labels[status] || status || 'Não informado'
}

function occupancyLabel(value: HotelDemandRoom['occupancy_code']): string {
  const labels: Record<HotelDemandRoom['occupancy_code'], string> = {
    single: 'Single',
    couple: 'Casal',
    double: 'Duplo',
    twin: 'Twin',
    triple: 'Triplo',
    quadruple: 'Quádruplo',
    family: 'Família',
  }
  return labels[value]
}

function localDateTimeToIso(value: string): string | undefined {
  const normalized = String(value || '').trim()
  if (!normalized) return undefined
  const parsed = new Date(normalized)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : normalized
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('pt-BR')
    : value
}

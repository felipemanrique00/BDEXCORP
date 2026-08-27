'use client'

import {
  AlertTriangle,
  BusFront,
  Car,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { DateTimeInput } from '@/components/ui/date-input'
import { DecimalInput } from '@/components/ui/decimal-input'
import {
  OfflineGroundQuoteClientError,
  createOfflineGroundQuoteFromServer,
  loadOfflineGroundQuoteCatalogFromServer,
  listOfflineGroundQuotesFromServer,
  selectOfflineGroundQuoteOptionFromServer,
} from '@/lib/offline-ground/quote-client'
import type {
  OfflineBusQuoteOptionInput,
  OfflineCarQuoteOptionInput,
  OfflineGroundQuoteListReadModel,
  OfflineGroundQuoteOptionReadModel,
  OfflineGroundQuoteReadModel,
  OfflineGroundQuoteService,
} from '@/lib/offline-ground/quote-schema'
import { localDateTimeWithZoneOffset } from '@/lib/offline-ground/timezone'

export interface GroundQuoteSupplierOption {
  id: string
  name: string
  code?: string | null
  service: OfflineGroundQuoteService
}

export interface GroundQuoteRentalLocationOption {
  id: string
  supplierId: string
  name: string
  cityName?: string | null
  addressText?: string | null
}

export interface GroundQuoteBusRouteOption {
  id: string
  supplierId: string
  routeCode: string
  originCityId: string
  destinationCityId: string
  originTerminalId?: string | null
  destinationTerminalId?: string | null
  originTimezone: string
  destinationTimezone: string
  label?: string | null
}

export interface GroundQuoteCatalog {
  suppliers: GroundQuoteSupplierOption[]
  rentalLocations?: GroundQuoteRentalLocationOption[]
  busRoutes?: GroundQuoteBusRouteOption[]
}

export type GroundQuoteRequestContext =
  | {
      service: 'locacao'
      pickupAt: string
      returnAt: string
    }
  | {
      service: 'rodoviario'
      legs: Array<{
        id?: string | null
        originCityId: string
        originCityName: string
        destinationCityId: string
        destinationCityName: string
        originTerminalId?: string | null
        destinationTerminalId?: string | null
        departureDate: string
        earliestDeparture?: string | null
      }>
    }

export interface GroundQuoteWorkspaceProps {
  demandId: string
  demandNumber: string
  service: OfflineGroundQuoteService
  lifecycleVersion: number
  requesterId?: string | null
  canOperateQuotes?: boolean
  canChoose?: boolean
  catalog?: GroundQuoteCatalog
  request?: GroundQuoteRequestContext
  onCompleted: () => void
}

export function GroundQuoteWorkspace({
  demandId,
  demandNumber,
  service,
  lifecycleVersion,
  requesterId,
  canOperateQuotes = false,
  canChoose,
  catalog,
  request,
  onCompleted,
}: GroundQuoteWorkspaceProps) {
  const [list, setList] = useState<OfflineGroundQuoteListReadModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [loadedCatalog, setLoadedCatalog] = useState<GroundQuoteCatalog | null>(null)
  const [catalogError, setCatalogError] = useState('')

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void listOfflineGroundQuotesFromServer(demandId, service)
      .then((result) => {
        if (active) setList(result)
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [demandId, reloadToken, service])

  useEffect(() => {
    if (!canOperateQuotes || catalog) {
      setLoadedCatalog(null)
      setCatalogError('')
      return
    }
    let active = true
    setCatalogError('')
    void loadOfflineGroundQuoteCatalogFromServer(demandId, service)
      .then((result) => {
        if (active) setLoadedCatalog(result)
      })
      .catch((caught: unknown) => {
        if (active) setCatalogError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [canOperateQuotes, catalog, demandId, service])

  const effectiveVersion = list?.lifecycleVersion || lifecycleVersion
  const currentQuote = useMemo(
    () => list?.quotes.find((quote) => quote.status === 'completed' || quote.status === 'selected') || null,
    [list],
  )
  const choiceAllowed = canChoose ?? Boolean(requesterId)
  const effectiveCatalog = catalog || loadedCatalog
  const canPublish = canOperateQuotes
    && Boolean(effectiveCatalog && request && request.service === service)
    && ['draft', 'submitted', 'approved_for_quotation', 'quoting', 'pending_choice', 'failed'].includes(
      list?.lifecycleStatus || '',
    )

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="ground-quote-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h3 id="ground-quote-title" className="flex items-center gap-2 font-bold text-slate-900">
            {service === 'locacao' ? <Car className="h-4 w-4 text-bbt-accent" /> : <BusFront className="h-4 w-4 text-bbt-accent" />}
            Cotacao offline - {serviceLabel(service)}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Pedido {demandNumber}. As opcoes, a escolha e a aprovacao permanecem vinculadas a esta demanda.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      {error && (
        <div className="m-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      )}
      {loading && !list && (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Consultando a rodada desta demanda...
        </div>
      )}

      {catalogError && (
        <div className="m-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Nao foi possivel carregar o catalogo verificado: {catalogError}
        </div>
      )}

      {canOperateQuotes && !canPublish && (!effectiveCatalog || !request) && !catalogError && (
        <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          O formulario do consultor sera habilitado quando o contexto estruturado do pedido e o catalogo aprovado forem informados.
        </div>
      )}

      {canPublish && effectiveCatalog && request && (
        <GroundQuoteConsultantForm
          demandId={demandId}
          service={service}
          lifecycleVersion={effectiveVersion}
          catalog={effectiveCatalog}
          request={request}
          onPublished={() => {
            reload()
            onCompleted()
          }}
        />
      )}

      {currentQuote && choiceAllowed && (
        <GroundQuoteChoicePanel
          quote={currentQuote}
          lifecycleVersion={effectiveVersion}
          onSelected={() => {
            reload()
            onCompleted()
          }}
        />
      )}

      {!loading && !error && !canPublish && !currentQuote && (
        <div className="p-6 text-center text-sm text-slate-500">
          Ainda nao ha uma rodada de cotacao disponivel para este pedido.
        </div>
      )}
    </section>
  )
}

interface ConsultantFormProps {
  demandId: string
  service: OfflineGroundQuoteService
  lifecycleVersion: number
  catalog: GroundQuoteCatalog
  request: GroundQuoteRequestContext
  onPublished: () => void
}

function GroundQuoteConsultantForm(props: ConsultantFormProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [carOptions, setCarOptions] = useState<OfflineCarQuoteOptionInput[]>([])
  const [busOptions, setBusOptions] = useState<OfflineBusQuoteOptionInput[]>([])
  const idempotencyKeyRef = useRef('')

  const optionsCount = props.service === 'locacao' ? carOptions.length : busOptions.length

  async function publish() {
    if (!confirmed) return toast.error('Confirme a revisao dos valores e das condicoes.')
    if (!optionsCount) return toast.error('Adicione pelo menos uma opcao a rodada.')
    const idempotencyKey = idempotencyKeyRef.current || operationKey('ground-quote')
    idempotencyKeyRef.current = idempotencyKey
    setSubmitting(true)
    try {
      if (props.service === 'locacao') {
        await createOfflineGroundQuoteFromServer({
          demandId: props.demandId,
          service: 'locacao',
          expectedLifecycleVersion: props.lifecycleVersion,
          confirmed: true,
          idempotencyKey,
          options: carOptions,
        })
      } else {
        await createOfflineGroundQuoteFromServer({
          demandId: props.demandId,
          service: 'rodoviario',
          expectedLifecycleVersion: props.lifecycleVersion,
          confirmed: true,
          idempotencyKey,
          options: busOptions,
        })
      }
      idempotencyKeyRef.current = ''
      setConfirmed(false)
      setCarOptions([])
      setBusOptions([])
      toast.success('Rodada de cotacao publicada para escolha.')
      props.onPublished()
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-bold text-slate-800">Preparar rodada para o solicitante</h4>
        <p className="mt-0.5 text-xs text-slate-500">
          Adicione ate 10 opcoes. Os totais sao validados novamente no servidor.
        </p>
      </div>
      {props.service === 'locacao' && props.request.service === 'locacao' ? (
        <CarOptionComposer
          catalog={props.catalog}
          request={props.request}
          onAdd={(option) => setCarOptions((current) => [...current, option].slice(0, 10))}
        />
      ) : props.service === 'rodoviario' && props.request.service === 'rodoviario' ? (
        <BusOptionComposer
          catalog={props.catalog}
          request={props.request}
          onAdd={(option) => setBusOptions((current) => [...current, option].slice(0, 10))}
        />
      ) : null}

      <div className="mt-4 space-y-2">
        {(props.service === 'locacao' ? carOptions : busOptions).map((option, index) => (
          <div key={option.clientId} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <div>
              <span className="font-semibold">Opcao {index + 1}</span>
              <span className="ml-2 text-slate-500">
                {props.service === 'locacao'
                  ? (option as OfflineCarQuoteOptionInput).details.categoryName
                  : (option as OfflineBusQuoteOptionInput).details.className}
              </span>
            </div>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={`Remover opcao ${index + 1}`}
              onClick={() => props.service === 'locacao'
                ? setCarOptions((current) => current.filter((item) => item.clientId !== option.clientId))
                : setBusOptions((current) => current.filter((item) => item.clientId !== option.clientId))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-start gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Revisei fornecedores, datas, valores, taxas e politicas desta rodada.
        </label>
        <button
          type="button"
          className="bbt-button-primary"
          disabled={submitting || !confirmed || !optionsCount}
          onClick={() => void publish()}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Publicar rodada ({optionsCount})
        </button>
      </div>
    </div>
  )
}

function CarOptionComposer({
  catalog,
  request,
  onAdd,
}: {
  catalog: GroundQuoteCatalog
  request: Extract<GroundQuoteRequestContext, { service: 'locacao' }>
  onAdd: (option: OfflineCarQuoteOptionInput) => void
}) {
  const suppliers = catalog.suppliers.filter((item) => item.service === 'locacao')
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const locations = (catalog.rentalLocations || []).filter((item) => item.supplierId === supplierId)
  const [pickupLocationId, setPickupLocationId] = useState('')
  const [returnLocationId, setReturnLocationId] = useState('')
  const [categoryName, setCategoryName] = useState('Economico')
  const [vehicleExample, setVehicleExample] = useState('')
  const [dailyAmount, setDailyAmount] = useState('0')
  const [protectionAmount, setProtectionAmount] = useState('0')
  const [feeAmount, setFeeAmount] = useState('0')
  const [taxAmount, setTaxAmount] = useState('0')
  const [mileagePolicy, setMileagePolicy] = useState('Quilometragem livre')
  const rentalDays = Math.max(1, Math.ceil(
    (Date.parse(request.returnAt) - Date.parse(request.pickupAt)) / 86_400_000,
  ))

  useEffect(() => {
    setPickupLocationId(locations[0]?.id || '')
    setReturnLocationId(locations[0]?.id || '')
  }, [supplierId]) // eslint-disable-line react-hooks/exhaustive-deps

  function add() {
    if (!supplierId || !pickupLocationId || !returnLocationId || !categoryName.trim()) {
      return toast.error('Preencha locadora, lojas e categoria do veiculo.')
    }
    const dailyAmountMinor = moneyMinor(dailyAmount)
    const protectionAmountMinor = moneyMinor(protectionAmount)
    const feeAmountMinor = moneyMinor(feeAmount)
    const taxAmountMinor = moneyMinor(taxAmount)
    onAdd({
      clientId: operationKey('car-option'),
      details: {
        supplierId,
        pickupLocationId,
        returnLocationId,
        categoryName: categoryName.trim(),
        vehicleExample: vehicleExample.trim() || undefined,
        rentalDays,
        dailyAmountMinor,
        protectionAmountMinor,
        feeAmountMinor,
        taxAmountMinor,
        totalAmountMinor: dailyAmountMinor * rentalDays
          + protectionAmountMinor + feeAmountMinor + taxAmountMinor,
        currency: 'BRL',
        mileagePolicy: mileagePolicy.trim() || undefined,
        protections: [],
        metadata: {},
      },
    })
  }

  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-4">
      <SelectField label="Locadora" value={supplierId} onChange={setSupplierId} options={suppliers.map((item) => ({ value: item.id, label: item.name }))} />
      <SelectField label="Loja de retirada" value={pickupLocationId} onChange={setPickupLocationId} options={locations.map(locationOption)} />
      <SelectField label="Loja de devolucao" value={returnLocationId} onChange={setReturnLocationId} options={locations.map(locationOption)} />
      <TextField label="Categoria" value={categoryName} onChange={setCategoryName} />
      <TextField label="Veiculo de referencia" value={vehicleExample} onChange={setVehicleExample} />
      <MoneyField label={`Diaria (${rentalDays}x)`} value={dailyAmount} onChange={setDailyAmount} />
      <MoneyField label="Protecoes" value={protectionAmount} onChange={setProtectionAmount} />
      <MoneyField label="Taxas" value={feeAmount} onChange={setFeeAmount} />
      <MoneyField label="Impostos" value={taxAmount} onChange={setTaxAmount} />
      <TextField label="Quilometragem" value={mileagePolicy} onChange={setMileagePolicy} />
      <div className="flex items-end md:col-span-2">
        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-bbt-accent px-4 text-sm font-bold text-bbt-primary hover:bg-bbt-accent/10" onClick={add}>
          <Plus className="h-4 w-4" /> Adicionar opcao
        </button>
      </div>
    </div>
  )
}

function BusOptionComposer({
  catalog,
  request,
  onAdd,
}: {
  catalog: GroundQuoteCatalog
  request: Extract<GroundQuoteRequestContext, { service: 'rodoviario' }>
  onAdd: (option: OfflineBusQuoteOptionInput) => void
}) {
  const suppliers = catalog.suppliers.filter((item) => item.service === 'rodoviario')
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const supplierRoutes = useMemo(
    () => (catalog.busRoutes || []).filter((item) => item.supplierId === supplierId),
    [catalog.busRoutes, supplierId],
  )
  const [routeIds, setRouteIds] = useState(() => request.legs.map((leg) => (
    supplierRoutes.find((route) => route.originCityId === leg.originCityId
      && route.destinationCityId === leg.destinationCityId)?.id || ''
  )))
  const [className, setClassName] = useState('Convencional')
  const [serviceNumber, setServiceNumber] = useState('')
  const [fareAmount, setFareAmount] = useState('0')
  const [taxAmount, setTaxAmount] = useState('0')
  const [feeAmount, setFeeAmount] = useState('0')
  const [refundable, setRefundable] = useState(false)
  const [times, setTimes] = useState(() => request.legs.map(initialLegTimes))

  useEffect(() => setRouteIds(request.legs.map((leg) => (
    supplierRoutes.find((route) => route.originCityId === leg.originCityId
      && route.destinationCityId === leg.destinationCityId)?.id || ''
  ))), [request.legs, supplierRoutes])

  function add() {
    if (!supplierId || routeIds.some((routeId) => !routeId) || !className.trim()) {
      return toast.error('Preencha empresa, linha de cada trecho e classe rodoviaria.')
    }
    const fareAmountMinor = moneyMinor(fareAmount)
    const taxAmountMinor = moneyMinor(taxAmount)
    const feeAmountMinor = moneyMinor(feeAmount)
    const segments = request.legs.map((leg, index) => {
      const route = supplierRoutes.find((item) => item.id === routeIds[index])!
      return {
        demandLegId: leg.id || undefined,
        routeId: route.id,
        originCityId: leg.originCityId,
        destinationCityId: leg.destinationCityId,
        originTerminalId: leg.originTerminalId || route.originTerminalId || undefined,
        destinationTerminalId: leg.destinationTerminalId || route.destinationTerminalId || undefined,
        departsAt: localDateTimeWithZoneOffset(times[index]?.departsAt || '', route.originTimezone),
        arrivesAt: localDateTimeWithZoneOffset(times[index]?.arrivesAt || '', route.destinationTimezone),
        serviceNumber: serviceNumber.trim() || undefined,
        className: className.trim(),
        metadata: {},
      }
    })
    onAdd({
      clientId: operationKey('bus-option'),
      details: {
        supplierId,
        routeId: routeIds.length === 1 ? routeIds[0] : undefined,
        serviceNumber: serviceNumber.trim() || undefined,
        className: className.trim(),
        baggagePieces: 1,
        refundable,
        fareAmountMinor,
        taxAmountMinor,
        feeAmountMinor,
        totalAmountMinor: fareAmountMinor + taxAmountMinor + feeAmountMinor,
        currency: 'BRL',
        segments,
        metadata: {},
      },
    })
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="grid gap-3 md:grid-cols-4">
        <SelectField label="Empresa rodoviaria" value={supplierId} onChange={setSupplierId} options={suppliers.map((item) => ({ value: item.id, label: item.name }))} />
        <TextField label="Classe" value={className} onChange={setClassName} />
        <TextField label="Numero do servico" value={serviceNumber} onChange={setServiceNumber} />
        <MoneyField label="Tarifa" value={fareAmount} onChange={setFareAmount} />
        <MoneyField label="Taxas" value={taxAmount} onChange={setTaxAmount} />
        <MoneyField label="Taxa de servico" value={feeAmount} onChange={setFeeAmount} />
        <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={refundable} onChange={(event) => setRefundable(event.target.checked)} />
          Reembolsavel
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {request.legs.map((leg, index) => (
          <div key={leg.id || `${leg.originCityId}:${leg.destinationCityId}:${index}`} className="rounded-lg bg-slate-50 p-3">
            <div className="mb-2 text-xs font-bold text-slate-700">
              {leg.originCityName} → {leg.destinationCityName}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <SelectField
                  label="Linha cadastrada"
                  value={routeIds[index] || ''}
                  onChange={(value) => setRouteIds((current) => current.map((routeId, routeIndex) => (
                    routeIndex === index ? value : routeId
                  )))}
                  options={supplierRoutes
                    .filter((route) => route.originCityId === leg.originCityId
                      && route.destinationCityId === leg.destinationCityId)
                    .map((route) => ({ value: route.id, label: route.label || route.routeCode }))}
                />
              </div>
              <DateTimeField label="Saida" value={times[index]?.departsAt || ''} onChange={(value) => setTimes((current) => replaceTime(current, index, 'departsAt', value))} />
              <DateTimeField label="Chegada" value={times[index]?.arrivesAt || ''} onChange={(value) => setTimes((current) => replaceTime(current, index, 'arrivesAt', value))} />
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-bbt-accent px-4 text-sm font-bold text-bbt-primary hover:bg-bbt-accent/10" onClick={add}>
        <Plus className="h-4 w-4" /> Adicionar opcao
      </button>
    </div>
  )
}

export function GroundQuoteChoicePanel({
  quote,
  lifecycleVersion,
  onSelected,
}: {
  quote: OfflineGroundQuoteReadModel
  lifecycleVersion: number
  onSelected: () => void
}) {
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const idempotencyKeysRef = useRef(new Map<string, string>())
  const selectable = quote.status === 'completed'
    && quote.lifecycleStatus === 'pending_choice'
    && !quote.selectedOptionId
    && (!quote.expiresAt || Date.parse(quote.expiresAt) > Date.now())

  async function select() {
    if (!selectable) return toast.error('Esta rodada nao esta mais disponivel para escolha.')
    if (!selectedOptionId || !confirmed) return toast.error('Selecione e confirme uma opcao.')
    const operation = `${quote.id}:${selectedOptionId}`
    const key = idempotencyKeysRef.current.get(operation) || operationKey('ground-selection')
    idempotencyKeysRef.current.set(operation, key)
    setSubmitting(true)
    try {
      const result = await selectOfflineGroundQuoteOptionFromServer({
        demandId: quote.demandId,
        quoteId: quote.id,
        optionId: selectedOptionId,
        expectedLifecycleVersion: lifecycleVersion,
        confirmed: true,
        idempotencyKey: key,
      })
      idempotencyKeysRef.current.delete(operation)
      toast.success(result.status === 'pending_approval'
        ? 'Escolha registrada e enviada para aprovacao.'
        : 'Escolha registrada e liberada para reserva.')
      onSelected()
    } catch (caught) {
      toast.error(errorMessage(caught))
      if (caught instanceof OfflineGroundQuoteClientError && caught.status === 409) onSelected()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-bbt-accent" />
        <h4 className="text-sm font-bold text-slate-800">Escolha da cotacao</h4>
        {quote.expiresAt && <span className="ml-auto text-xs text-slate-500">Valida ate {formatDateTime(quote.expiresAt)}</span>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {quote.options.map((option, index) => (
          <GroundOptionCard
            key={option.id}
            option={option}
            index={index}
            selected={selectedOptionId === option.id}
            disabled={!selectable || submitting}
            onSelect={() => {
              setSelectedOptionId(option.id)
              setConfirmed(false)
            }}
          />
        ))}
      </div>
      {selectable && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            Revisei itinerario/lojas, valores e politicas da opcao selecionada.
          </label>
          <button type="button" className="bbt-button-primary" disabled={!selectedOptionId || !confirmed || submitting} onClick={() => void select()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Escolher e continuar
          </button>
        </div>
      )}
    </div>
  )
}

function GroundOptionCard({
  option,
  index,
  selected,
  disabled,
  onSelect,
}: {
  option: OfflineGroundQuoteOptionReadModel
  index: number
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-xl border p-4 text-left transition ${selected ? 'border-bbt-accent bg-bbt-accent/10 ring-1 ring-bbt-accent' : 'border-slate-200 hover:border-bbt-accent'} disabled:cursor-default`}
      disabled={disabled}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-bbt-accent">Opcao {index + 1}</div>
          <div className="mt-1 font-bold text-slate-900">{option.supplierName}</div>
          <div className="text-sm text-slate-600">{option.title}</div>
        </div>
        <div className="text-right text-lg font-black text-slate-900">{formatMinor(option.totalAmountMinor, option.currency)}</div>
      </div>
      {option.service === 'locacao' ? (
        <div className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          <span>Retirada: {option.details.pickupLocationName}</span>
          <span>Devolucao: {option.details.returnLocationName}</span>
          <span>{option.details.rentalDays} diaria(s)</span>
          <span>{option.details.vehicleExample || option.details.categoryName}</span>
          {option.details.mileagePolicy && <span className="sm:col-span-2">{option.details.mileagePolicy}</span>}
        </div>
      ) : (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          <div>{option.details.className} · {option.details.baggagePieces} bagagem(ns)</div>
          {option.details.segments.map((segment) => (
            <div key={segment.id} className="rounded-lg bg-slate-50 px-2 py-1.5">
              {segment.originCityName} → {segment.destinationCityName} · {formatDateTime(segment.departsAt)}
            </div>
          ))}
        </div>
      )}
      {option.selectionStatus && (
        <div className="mt-3 text-xs font-semibold text-bbt-accent">Status da escolha: {selectionLabel(option.selectionStatus)}</div>
      )}
    </button>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <select className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
        {!options.length && <option value="">Nenhum cadastro disponivel</option>}
        {options.map((option) => <option key={option.value || 'empty'} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <input className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function MoneyField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {props.label}
      <DecimalInput
        value={props.value}
        onValueChange={props.onChange}
        prefix="R$"
        placeholder="0,00"
        className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
      />
    </label>
  )
}

function DateTimeField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {props.label}
      <DateTimeInput
        className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-2 text-sm"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  )
}

function locationOption(item: GroundQuoteRentalLocationOption) {
  return { value: item.id, label: [item.name, item.cityName].filter(Boolean).join(' - ') }
}

function initialLegTimes(leg: Extract<GroundQuoteRequestContext, { service: 'rodoviario' }>['legs'][number]) {
  const departure = `${leg.departureDate}T${String(leg.earliestDeparture || '08:00').slice(0, 5)}`
  const arrivalDate = new Date(departure)
  arrivalDate.setHours(arrivalDate.getHours() + 6)
  return { departsAt: departure, arrivesAt: localInputDateTime(arrivalDate) }
}

function replaceTime(current: Array<{ departsAt: string; arrivesAt: string }>, index: number, key: 'departsAt' | 'arrivesAt', value: string) {
  return current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)
}

function localInputDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function moneyMinor(value: string): number {
  const number = Number(String(value || '0').replace(',', '.'))
  if (!Number.isFinite(number) || number < 0) throw new Error('Informe valores monetarios validos.')
  return Math.round(number * 100)
}

function operationKey(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}:${random}`
}

function serviceLabel(service: OfflineGroundQuoteService): string {
  return service === 'locacao' ? 'Locacao de veiculo' : 'Rodoviario'
}

function selectionLabel(status: string): string {
  const labels: Record<string, string> = {
    selected: 'Selecionada',
    pending_approval: 'Aguardando aprovacao',
    approved: 'Aprovada',
    rejected: 'Rejeitada',
    superseded: 'Substituida',
  }
  return labels[status] || status
}

function formatMinor(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value / 100)
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Nao foi possivel concluir a operacao terrestre.'
}

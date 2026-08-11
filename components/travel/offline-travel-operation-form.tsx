'use client'

import {
  CheckCircle2,
  History,
  Loader2,
  PencilLine,
  Route,
  ShieldCheck,
  TicketCheck,
  WifiOff,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import { DateTimeInput } from '@/components/ui/date-input'
import { DecimalInput } from '@/components/ui/decimal-input'
import { formatDecimalInput } from '@/lib/decimal-input'
import {
  correctOfflineReservationFromServer,
  createOfflineReservationFromServer,
  getOfflineReservationFromServer,
  issueOfflineReservationFromServer,
} from '@/lib/offline-travel/client'
import { offlineServiceFromDemand, offlineServiceLabel } from '@/lib/offline-travel/catalog'
import { formatMinorUnits, moneyToMinorUnits, sumMoneyInputs } from '@/lib/offline-travel/money'
import { isOfflineDemandEligibleForOperation } from '@/lib/offline-travel/operation-eligibility'
import { hotelGuestNames } from '@/lib/offline-travel/hotel-guests'
import { listOfflineAirQuotesFromServer } from '@/lib/offline-travel/services/air/client'
import { listOfflineHotelQuotesFromServer } from '@/lib/offline-travel/quote-client'
import type { OfflineHotelQuoteOptionReadModel } from '@/lib/offline-travel/quote-schema'
import {
  OFFLINE_TRAVEL_PROVIDER,
  OFFLINE_TRAVEL_SERVICES,
  offlineIssueCreateSchema,
  offlineReservationCorrectionSchema,
  offlineReservationCreateSchema,
  type OfflineIssueCreateInput,
  type OfflinePaymentMethod,
  type OfflineTravelChannel,
  type OfflineTravelService,
} from '@/lib/offline-travel/schema'
import type { GovernedTravelReservationSummary } from '@/lib/travel/reservation-records'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { travelLifecycleStatusLabel } from '@/lib/travel-lifecycle/presentation'
import { userAccessKind } from '@/lib/user-access-kind'
import type { Atendimento, Empresa } from '@/types'
import { atendimentoToOfflineAirDemandSummary } from '@/components/travel/offline-air-demand-summary'
import {
  OfflineAirOperationFields,
  toOfflineAirQuoteOptionReadModel,
  type OfflineAirApprovedSnapshot,
  type OfflineAirOperationDraft,
} from '@/components/travel/services/air'
import { createAirTicketDrafts } from '@/components/travel/services/air/ticket-drafts'

export type OfflineOperation = 'reservation' | 'reservation_and_issue' | 'issue_existing' | 'correct_existing'

export interface OfflineTravelContext {
  demandId: string
  lifecycleStatus: string
  operation: OfflineOperation
}

interface OfflineTravelOperationFormProps {
  demands: Atendimento[]
  companies: Empresa[]
  reservations: GovernedTravelReservationSummary[]
  initialDemandId?: string
  onCompleted: () => void
  onContextChange?: (context: OfflineTravelContext) => void
}

interface DetailState {
  origin: string
  destination: string
  itemName: string
  description: string
  serviceNumber: string
  category: string
  className: string
  accommodation: string
  mealPlan: string
  pickupLocation: string
  returnLocation: string
  policyNumber: string
  coverage: string
}

interface SelectedHotelQuoteContext {
  quoteId: string
  demandNumber: string
  lifecycleStatus: string
  option: OfflineHotelQuoteOptionReadModel
}

interface SelectedAirQuoteContext {
  quoteId: string
  lifecycleStatus: string
  snapshot: OfflineAirApprovedSnapshot
  approvalInstanceId: string | null
  approvalStatus: string | null
}

type DetailKey = keyof DetailState
type DetailField = {
  key: DetailKey
  label: string
  placeholder: string
  kind?: 'text' | 'textarea'
}

const EMPTY_DETAILS: DetailState = {
  origin: '',
  destination: '',
  itemName: '',
  description: '',
  serviceNumber: '',
  category: '',
  className: '',
  accommodation: '',
  mealPlan: '',
  pickupLocation: '',
  returnLocation: '',
  policyNumber: '',
  coverage: '',
}

const EMPTY_AIR_OPERATION: OfflineAirOperationDraft = {
  reservationSystem: '',
  locator: '',
  operationalSupplierName: '',
  reservationConfirmedAt: '',
  issuedAt: '',
  tickets: [],
  paymentMethod: 'faturado',
  paymentReference: '',
  operationalNotes: '',
}

const OPERATION_OPTIONS: Array<{
  value: OfflineOperation
  label: string
  description: string
}> = [
  {
    value: 'reservation',
    label: 'Somente reserva',
    description: 'Registra a confirmação obtida fora dos conectores.',
  },
  {
    value: 'reservation_and_issue',
    label: 'Reservar e emitir',
    description: 'Registra a reserva e, em seguida, a emissão offline.',
  },
  {
    value: 'issue_existing',
    label: 'Emitir reserva existente',
    description: 'Emite uma reserva offline já confirmada.',
  },
  {
    value: 'correct_existing',
    label: 'Corrigir reserva',
    description: 'Corrige dados antes da emissão e registra o histórico.',
  },
]

const CHANNEL_OPTIONS: Array<{ value: OfflineTravelChannel; label: string }> = [
  { value: 'telefone', label: 'Telefone' },
  { value: 'email', label: 'E-mail' },
  { value: 'portal', label: 'Portal do fornecedor' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'balcao', label: 'Balcão' },
  { value: 'outro', label: 'Outro' },
]

const PAYMENT_OPTIONS: Array<{ value: OfflinePaymentMethod; label: string }> = [
  { value: 'faturado', label: 'Faturado' },
  { value: 'pix', label: 'Pix' },
  { value: 'cartao_corporativo', label: 'Cartão corporativo' },
  { value: 'cartao_agencia', label: 'Cartão da agência' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'outro', label: 'Outro' },
]

const DETAIL_FIELDS: Record<OfflineTravelService, DetailField[]> = {
  aereo: [
    { key: 'itemName', label: 'Companhia aérea', placeholder: 'Ex.: LATAM' },
    { key: 'origin', label: 'Origem *', placeholder: 'Cidade ou aeroporto' },
    { key: 'destination', label: 'Destino *', placeholder: 'Cidade ou aeroporto' },
    { key: 'serviceNumber', label: 'Voo / trecho', placeholder: 'Ex.: LA 3271' },
    { key: 'className', label: 'Classe', placeholder: 'Econômica, executiva...' },
    { key: 'category', label: 'Tarifa / bagagem', placeholder: 'Família tarifária e bagagem' },
  ],
  hotelaria: [
    { key: 'itemName', label: 'Hotel / hospedagem *', placeholder: 'Nome do estabelecimento' },
    { key: 'destination', label: 'Cidade *', placeholder: 'Cidade da hospedagem' },
    { key: 'accommodation', label: 'Acomodação', placeholder: 'SGL, DBL, categoria do quarto...' },
    { key: 'mealPlan', label: 'Regime', placeholder: 'Café da manhã, meia pensão...' },
    { key: 'category', label: 'Categoria', placeholder: 'Standard, superior...' },
  ],
  locacao: [
    { key: 'itemName', label: 'Locadora', placeholder: 'Nome da locadora' },
    { key: 'pickupLocation', label: 'Local de retirada *', placeholder: 'Agência, aeroporto ou endereço' },
    { key: 'returnLocation', label: 'Local de devolução *', placeholder: 'Agência, aeroporto ou endereço' },
    { key: 'category', label: 'Categoria do veículo', placeholder: 'Econômico, SUV...' },
    { key: 'serviceNumber', label: 'Condutor / contrato', placeholder: 'Condutor principal ou contrato' },
  ],
  rodoviario: [
    { key: 'itemName', label: 'Transportadora', placeholder: 'Empresa rodoviária' },
    { key: 'origin', label: 'Origem *', placeholder: 'Terminal ou cidade' },
    { key: 'destination', label: 'Destino *', placeholder: 'Terminal ou cidade' },
    { key: 'serviceNumber', label: 'Linha / bilhete', placeholder: 'Número da linha ou bilhete' },
    { key: 'className', label: 'Classe', placeholder: 'Convencional, executivo, leito...' },
    { key: 'category', label: 'Assento', placeholder: 'Número do assento' },
  ],
  ferroviario: [
    { key: 'itemName', label: 'Operadora ferroviária', placeholder: 'Nome da operadora' },
    { key: 'origin', label: 'Origem *', placeholder: 'Estação de origem' },
    { key: 'destination', label: 'Destino *', placeholder: 'Estação de destino' },
    { key: 'serviceNumber', label: 'Trem / bilhete', placeholder: 'Número do trem ou bilhete' },
    { key: 'className', label: 'Classe', placeholder: 'Classe de viagem' },
    { key: 'category', label: 'Vagão / assento', placeholder: 'Vagão e assento' },
  ],
  transfer: [
    { key: 'itemName', label: 'Fornecedor do transfer', placeholder: 'Nome do fornecedor' },
    { key: 'origin', label: 'Origem *', placeholder: 'Local de embarque' },
    { key: 'destination', label: 'Destino *', placeholder: 'Local de desembarque' },
    { key: 'serviceNumber', label: 'Veículo / referência', placeholder: 'Veículo, placa ou referência' },
    { key: 'category', label: 'Categoria', placeholder: 'Privativo, compartilhado...' },
  ],
  seguro: [
    { key: 'itemName', label: 'Seguradora / plano *', placeholder: 'Seguradora ou nome do plano' },
    { key: 'policyNumber', label: 'Apólice / certificado', placeholder: 'Número da apólice' },
    { key: 'destination', label: 'Destino da cobertura', placeholder: 'Brasil, Europa, mundial...' },
    { key: 'coverage', label: 'Coberturas', placeholder: 'Resumo das coberturas contratadas', kind: 'textarea' },
  ],
  pacotes: [
    { key: 'itemName', label: 'Pacote / produto *', placeholder: 'Nome do pacote' },
    { key: 'destination', label: 'Destino', placeholder: 'Destino principal' },
    { key: 'category', label: 'Operadora / categoria', placeholder: 'Operadora ou categoria' },
    { key: 'description', label: 'Componentes do pacote', placeholder: 'Hospedagem, transporte, passeios...', kind: 'textarea' },
  ],
  lazer: [
    { key: 'itemName', label: 'Produto de lazer *', placeholder: 'Passeio, ingresso ou experiência' },
    { key: 'destination', label: 'Local / destino', placeholder: 'Cidade ou local da atividade' },
    { key: 'serviceNumber', label: 'Sessão / ingresso', placeholder: 'Horário, sessão ou número do ingresso' },
    { key: 'description', label: 'Descrição', placeholder: 'Detalhes da atividade', kind: 'textarea' },
  ],
  maritimo: [
    { key: 'itemName', label: 'Companhia / embarcação *', placeholder: 'Companhia ou navio' },
    { key: 'origin', label: 'Porto de origem', placeholder: 'Porto de embarque' },
    { key: 'destination', label: 'Destino / itinerário', placeholder: 'Portos ou destino final' },
    { key: 'serviceNumber', label: 'Navio / viagem', placeholder: 'Nome do navio ou número da viagem' },
    { key: 'category', label: 'Cabine', placeholder: 'Categoria da cabine' },
    { key: 'className', label: 'Classe', placeholder: 'Classe ou tarifa' },
  ],
  outros: [
    { key: 'itemName', label: 'Produto / serviço *', placeholder: 'Nome do serviço' },
    { key: 'origin', label: 'Origem', placeholder: 'Origem, quando aplicável' },
    { key: 'destination', label: 'Destino', placeholder: 'Destino, quando aplicável' },
    { key: 'category', label: 'Categoria', placeholder: 'Categoria do serviço' },
    { key: 'description', label: 'Descrição *', placeholder: 'Descreva o serviço contratado', kind: 'textarea' },
  ],
}

export function OfflineTravelOperationForm({
  demands,
  companies,
  reservations,
  initialDemandId,
  onCompleted,
  onContextChange,
}: OfflineTravelOperationFormProps) {
  const [operation, setOperation] = useState<OfflineOperation>('reservation')
  const [demandId, setDemandId] = useState('')
  const [reservationId, setReservationId] = useState('')
  const [serviceKey, setServiceKey] = useState<OfflineTravelService>('hotelaria')
  const [supplierName, setSupplierName] = useState('')
  const [supplierCode, setSupplierCode] = useState('')
  const [externalReference, setExternalReference] = useState('')
  const [channel, setChannel] = useState<OfflineTravelChannel>('telefone')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [grossAmount, setGrossAmount] = useState('')
  const [taxAmount, setTaxAmount] = useState('0,00')
  const [currency, setCurrency] = useState('BRL')
  const [details, setDetails] = useState<DetailState>({ ...EMPTY_DETAILS })
  const [reservationEvidence, setReservationEvidence] = useState<Record<string, unknown>>({
    source: OFFLINE_TRAVEL_PROVIDER,
  })
  const [passengersText, setPassengersText] = useState('')
  const [notes, setNotes] = useState('')
  const [policyJustification, setPolicyJustification] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [reservationVersion, setReservationVersion] = useState<number | null>(null)
  const [revisionCount, setRevisionCount] = useState(0)
  const [loadingReservation, setLoadingReservation] = useState(false)
  const [selectedHotelQuote, setSelectedHotelQuote] = useState<SelectedHotelQuoteContext | null>(null)
  const [loadingSelectedHotelQuote, setLoadingSelectedHotelQuote] = useState(false)
  const [selectedHotelQuoteError, setSelectedHotelQuoteError] = useState('')
  const [selectedAirQuote, setSelectedAirQuote] = useState<SelectedAirQuoteContext | null>(null)
  const [loadingSelectedAirQuote, setLoadingSelectedAirQuote] = useState(false)
  const [selectedAirQuoteError, setSelectedAirQuoteError] = useState('')
  const [airOperation, setAirOperation] = useState<OfflineAirOperationDraft>({ ...EMPTY_AIR_OPERATION })

  const [issuedAt, setIssuedAt] = useState('')
  const [documentKind, setDocumentKind] = useState<OfflineIssueCreateInput['document']['kind']>('confirmacao')
  const [documentReference, setDocumentReference] = useState('')
  const [ticketNumber, setTicketNumber] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<OfflinePaymentMethod>('faturado')
  const [paymentReference, setPaymentReference] = useState('')
  const [generateVoucher, setGenerateVoucher] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const appliedInitialDemandRef = useRef('')
  const selectedHotelQuoteRequestRef = useRef(0)
  const selectedAirQuoteRequestRef = useRef(0)
  const operationRef = useRef<OfflineOperation>('reservation')
  const currentUser = typeof window !== 'undefined' ? getCurrentUser() : null
  const showTechnicalMetadata = Boolean(
    currentUser
    && (
      currentUser.platform_admin
      || (userAccessKind(currentUser) === 'internal' && hasPermission(currentUser, 'ver_auditoria'))
    ),
  )

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  )
  const availableDemands = useMemo(
    () => demands
      .filter((demand) => Boolean(demand.serial_os) && companyById.has(demand.empresa_id))
      .filter((demand) => isOfflineDemandEligibleForOperation({
        serviceKey: serviceFromDemand(demand),
        lifecycleStatus: String(demand.relational_lifecycle_status || demand.status || ''),
        operation,
      }))
      .sort((left, right) => (
        String(right.updated_at || right.created_at).localeCompare(String(left.updated_at || left.created_at))
      )),
    [companyById, demands, operation],
  )
  const selectedDemand = useMemo(
    () => availableDemands.find((demand) => demand.id === demandId) || null,
    [availableDemands, demandId],
  )
  const selectedCompany = selectedDemand ? companyById.get(selectedDemand.empresa_id) : undefined
  const eligibleReservations = useMemo(() => {
    if (!selectedDemand) return []
    return reservations
      .filter((reservation) => reservation.provider === OFFLINE_TRAVEL_PROVIDER)
      .filter((reservation) => reservation.status === 'reserved')
      .filter((reservation) => (
        reservation.demandId === selectedDemand.id
        || reservation.demandNumber === selectedDemand.serial_os
      ))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }, [reservations, selectedDemand])
  const selectedReservation = useMemo(
    () => eligibleReservations.find((reservation) => reservation.id === reservationId) || null,
    [eligibleReservations, reservationId],
  )
  const totalAmount = useMemo(
    () => sumMoneyInputs(grossAmount, taxAmount),
    [grossAmount, taxAmount],
  )
  const includesIssue = operation === 'reservation_and_issue' || operation === 'issue_existing'
  const createsReservation = operation === 'reservation' || operation === 'reservation_and_issue'
  const correctsReservation = operation === 'correct_existing'
  const usesExistingReservation = operation === 'issue_existing' || correctsReservation
  const showsReservationData = createsReservation || correctsReservation
  const locksSelectedHotelQuote = createsReservation && Boolean(selectedHotelQuote)
  const locksSelectedAirQuote = createsReservation && Boolean(selectedAirQuote)
  const locksSelectedCommercialQuote = locksSelectedHotelQuote || locksSelectedAirQuote
  const locksSelectedHotelGuests = locksSelectedHotelQuote && serviceKey === 'hotelaria'
  const requiresSelectedCommercialQuote = Boolean(
    createsReservation
    && selectedDemand
    && ['hotelaria', 'aereo'].includes(serviceKey)
    && lifecycleRequiresSelectedHotelQuote(
      String(selectedDemand.relational_lifecycle_status || selectedDemand.status || '').trim().toLowerCase(),
    ),
  )
  const quotedSupplierDiffers = Boolean(
    locksSelectedHotelQuote
    && selectedHotelQuote
    && normalizeText(supplierName) !== normalizeText(selectedHotelQuote.option.supplierName),
  )
  const startRequired = ['aereo', 'hotelaria', 'locacao', 'rodoviario', 'ferroviario', 'transfer', 'seguro', 'pacotes', 'maritimo']
    .includes(serviceKey)
  const endRequired = ['hotelaria', 'locacao', 'seguro', 'pacotes'].includes(serviceKey)

  useEffect(() => {
    onContextChange?.({
      demandId,
      lifecycleStatus: String(selectedDemand?.relational_lifecycle_status || selectedDemand?.status || ''),
      operation,
    })
  }, [demandId, onContextChange, operation, selectedDemand])

  useEffect(() => {
    const requested = String(initialDemandId || '').trim()
    if (!requested) {
      appliedInitialDemandRef.current = ''
      return
    }
    if (appliedInitialDemandRef.current === requested) return
    if (!availableDemands.some((demand) => demand.id === requested)) return
    appliedInitialDemandRef.current = requested
    if (demandId !== requested) selectDemand(requested)
  }, [availableDemands, demandId, initialDemandId])

  useEffect(() => {
    if (!demandId || availableDemands.some((demand) => demand.id === demandId)) return
    selectDemand('')
  }, [availableDemands, demandId])

  function applySelectedHotelQuote(
    context: SelectedHotelQuoteContext,
    demand: Atendimento,
  ) {
    const option = context.option
    const demandDetails = detailsFromDemand(demand)
    setServiceKey('hotelaria')
    setSupplierName(option.supplierName)
    setSupplierCode(option.supplierCode || '')
    setStartsAt(toLocalDateTimeInput(option.startsAt) || dateToLocalDateTime(startDateFromDemand(demand)))
    setEndsAt(toLocalDateTimeInput(option.endsAt) || dateToLocalDateTime(endDateFromDemand(demand)))
    setGrossAmount(moneyInput(option.breakdown.roomSubtotal + option.breakdown.serviceFee))
    setTaxAmount(moneyInput(option.breakdown.taxesSubtotal))
    setCurrency(option.breakdown.currency || 'BRL')
    setDetails({
      ...demandDetails,
      itemName: option.hotel.name,
      destination: option.hotel.cityName || demandDetails.destination,
      accommodation: option.roomCategory,
      mealPlan: option.mealPlan || '',
      category: option.hotel.category || '',
    })
    setReservationEvidence({
      source: OFFLINE_TRAVEL_PROVIDER,
      quoteId: context.quoteId,
      quoteOptionId: option.id,
      hotelId: option.hotelId,
      selectionStatus: option.selectionStatus,
      approvalStatus: option.approvalStatus,
    })
    setPassengersText(hotelGuestNames(demand).join('\n'))
  }

  async function loadSelectedHotelQuote(demand: Atendimento) {
    const requestId = selectedHotelQuoteRequestRef.current + 1
    selectedHotelQuoteRequestRef.current = requestId
    setSelectedHotelQuote(null)
    setSelectedHotelQuoteError('')

    if (serviceFromDemand(demand) !== 'hotelaria') {
      setLoadingSelectedHotelQuote(false)
      return
    }

    setLoadingSelectedHotelQuote(true)
    try {
      const result = await listOfflineHotelQuotesFromServer(demand.id)
      if (selectedHotelQuoteRequestRef.current !== requestId) return
      const quote = result.quotes.find((item) => (
        Boolean(item.selectedOptionId) || item.options.some((option) => option.selected)
      ))
      const option = quote?.options.find((item) => (
        item.id === quote.selectedOptionId || item.selected
      ))
      if (!quote || !option) {
        if (lifecycleRequiresSelectedHotelQuote(result.lifecycleStatus)) {
          setSelectedHotelQuoteError(
            'A demanda avançou para reserva, mas nenhuma opção formalmente escolhida foi localizada. Atualize a página antes de continuar.',
          )
        }
        return
      }

      const context: SelectedHotelQuoteContext = {
        quoteId: quote.id,
        demandNumber: quote.demandNumber,
        lifecycleStatus: result.lifecycleStatus || quote.lifecycleStatus,
        option,
      }
      setSelectedHotelQuote(context)
      if (operationRef.current === 'reservation' || operationRef.current === 'reservation_and_issue') {
        applySelectedHotelQuote(context, demand)
      }
    } catch (error) {
      if (selectedHotelQuoteRequestRef.current !== requestId) return
      setSelectedHotelQuoteError(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar a opção escolhida para esta demanda.',
      )
    } finally {
      if (selectedHotelQuoteRequestRef.current === requestId) setLoadingSelectedHotelQuote(false)
    }
  }

  function applySelectedAirQuote(
    context: SelectedAirQuoteContext,
    demand: Atendimento,
  ) {
    const option = context.snapshot.option
    const firstSegment = option.segments[0]
    const lastSegment = option.segments[option.segments.length - 1]
    const passengerNames = context.snapshot.demand.passengers.map((passenger) => passenger.name)
    const taxesAndFees = formatMinorUnits(
      moneyToMinorUnits(option.pricing.taxes || '0')
      + moneyToMinorUnits(option.pricing.rav || '0')
      + moneyToMinorUnits(option.pricing.rac || '0'),
    )
    const operationalSupplierName = option.segments[0]?.airlineName || 'Companhia aérea'
    const initialOperation: OfflineAirOperationDraft = {
      reservationSystem: option.reservationSystem,
      locator: option.locator,
      operationalSupplierName,
      reservationConfirmedAt: toLocalDateTimeInput(new Date().toISOString()),
      issuedAt: operationRef.current === 'reservation_and_issue'
        ? toLocalDateTimeInput(new Date().toISOString())
        : '',
      tickets: createAirTicketDrafts(context.snapshot.demand.passengers),
      paymentMethod: paymentMethod === 'dinheiro' ? 'outro' : paymentMethod,
      paymentReference: '',
      operationalNotes: String(demand.observacoes || ''),
    }
    setAirOperation(initialOperation)
    setServiceKey('aereo')
    setSupplierName(operationalSupplierName)
    setExternalReference(option.locator || '')
    setStartsAt(firstSegment?.departureAt || '')
    setEndsAt(lastSegment?.arrivalAt || '')
    setGrossAmount(option.pricing.fare)
    setTaxAmount(formatDecimalInput(taxesAndFees))
    setCurrency(option.pricing.currency || 'BRL')
    setDetails({
      ...detailsFromDemand(demand),
      itemName: operationalSupplierName,
      origin: airSegmentLocation(firstSegment?.originCode, firstSegment?.originName),
      destination: airSegmentLocation(lastSegment?.destinationCode, lastSegment?.destinationName),
      serviceNumber: option.segments
        .map((segment) => `${segment.airlineCode} ${segment.flightNumber}`.trim())
        .filter(Boolean)
        .join(' / '),
      className: firstSegment?.cabinClass || '',
      category: [option.fareFamily, `${firstSegment?.baggagePieces || 0} bagagem(ns)`]
        .filter(Boolean)
        .join(' · '),
    })
    setReservationEvidence({
      source: OFFLINE_TRAVEL_PROVIDER,
      quoteId: context.quoteId,
      quoteOptionId: option.id,
      approvalStatus: context.approvalStatus,
      approvedAirQuote: context.snapshot,
      reservationSystem: option.reservationSystem,
    })
    setPassengersText(passengerNames.join('\n'))
    setDocumentKind('bilhete')
    setDocumentReference(option.locator || '')
  }

  async function loadSelectedAirQuote(demand: Atendimento) {
    const requestId = selectedAirQuoteRequestRef.current + 1
    selectedAirQuoteRequestRef.current = requestId
    setSelectedAirQuote(null)
    setSelectedAirQuoteError('')

    if (serviceFromDemand(demand) !== 'aereo') {
      setLoadingSelectedAirQuote(false)
      return
    }

    setLoadingSelectedAirQuote(true)
    try {
      const result = await listOfflineAirQuotesFromServer(demand.id)
      if (selectedAirQuoteRequestRef.current !== requestId) return
      const quote = result.quotes.find((item) => (
        Boolean(item.selectedOptionId) || item.options.some((option) => option.selected)
      ))
      const serverOption = quote?.options.find((item) => (
        item.id === quote.selectedOptionId || item.selected
      ))
      if (!quote || !serverOption) {
        if (lifecycleRequiresSelectedHotelQuote(result.lifecycleStatus)) {
          setSelectedAirQuoteError(
            'A demanda avançou para reserva, mas nenhuma opção aérea formalmente escolhida foi localizada. Atualize a página antes de continuar.',
          )
        }
        return
      }
      const companyName = companyById.get(demand.empresa_id)?.nome || 'Empresa não localizada'
      const legacyDemandSummary = atendimentoToOfflineAirDemandSummary(demand, companyName)
      const relationalPassengers = [...(Array.isArray(result.passengers) ? result.passengers : [])]
        .sort((left, right) => left.sequence - right.sequence)
        .map((passenger) => ({
          id: passenger.demandTravelerId,
          demandTravelerId: passenger.demandTravelerId,
          employeeId: passenger.employeeId || undefined,
          sequence: passenger.sequence,
          identificationCode: passenger.identificationCode || undefined,
          name: passenger.name,
          type: 'adulto' as const,
        }))
      const context: SelectedAirQuoteContext = {
        quoteId: quote.id,
        lifecycleStatus: result.lifecycleStatus || quote.lifecycleStatus,
        approvalInstanceId: serverOption.approvalInstanceId,
        approvalStatus: serverOption.approvalStatus,
        snapshot: {
          demand: relationalPassengers.length
            ? { ...legacyDemandSummary, passengers: relationalPassengers }
            : legacyDemandSummary,
          quoteId: quote.id,
          selectedAt: serverOption.selectedAt,
          approvedAt: serverOption.approvedAt,
          option: toOfflineAirQuoteOptionReadModel(serverOption),
        },
      }
      setSelectedAirQuote(context)
      if (operationRef.current === 'correct_existing') {
        const option = context.snapshot.option
        setAirOperation((current) => ({
          ...current,
          reservationSystem: current.reservationSystem || option.reservationSystem,
          locator: current.locator || option.locator,
          operationalSupplierName: current.operationalSupplierName
            || option.segments[0]?.airlineName
            || 'Companhia aérea',
          tickets: createAirTicketDrafts(context.snapshot.demand.passengers, current.tickets),
        }))
      } else {
        applySelectedAirQuote(context, demand)
        if (operationRef.current === 'issue_existing') {
          const existing = reservations.find((reservation) => (
            reservation.provider === OFFLINE_TRAVEL_PROVIDER
            && reservation.status === 'reserved'
            && (reservation.demandId === demand.id || reservation.demandNumber === demand.serial_os)
          ))
          if (existing?.providerReference) {
            setExternalReference(existing.providerReference)
            setDocumentReference(existing.providerReference)
            setAirOperation((current) => ({ ...current, locator: existing.providerReference || current.locator }))
          }
        }
      }
    } catch (error) {
      if (selectedAirQuoteRequestRef.current !== requestId) return
      setSelectedAirQuoteError(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar a opção aérea escolhida para esta demanda.',
      )
    } finally {
      if (selectedAirQuoteRequestRef.current === requestId) setLoadingSelectedAirQuote(false)
    }
  }

  function changeOperation(nextOperation: OfflineOperation) {
    operationRef.current = nextOperation
    setOperation(nextOperation)
    setConfirmed(false)
    setCorrectionReason('')
    if (nextOperation !== 'issue_existing' && nextOperation !== 'correct_existing') {
      setReservationId('')
      setReservationVersion(null)
      setRevisionCount(0)
      if (selectedHotelQuote && selectedDemand) applySelectedHotelQuote(selectedHotelQuote, selectedDemand)
      if (selectedAirQuote && selectedDemand) applySelectedAirQuote(selectedAirQuote, selectedDemand)
      return
    }
    const matches = selectedDemand
      ? reservations.filter((reservation) => (
          reservation.provider === OFFLINE_TRAVEL_PROVIDER
          && reservation.status === 'reserved'
          && (reservation.demandId === selectedDemand.id || reservation.demandNumber === selectedDemand.serial_os)
        ))
      : []
    if (matches.length === 1) void selectReservation(matches[0].id, matches, nextOperation)
    else setReservationId('')
  }

  function selectDemand(nextDemandId: string) {
    const demand = availableDemands.find((item) => item.id === nextDemandId) || null
    selectedHotelQuoteRequestRef.current += 1
    selectedAirQuoteRequestRef.current += 1
    setDemandId(nextDemandId)
    setReservationId('')
    setReservationVersion(null)
    setRevisionCount(0)
    setConfirmed(false)
    setSelectedHotelQuote(null)
    setSelectedHotelQuoteError('')
    setLoadingSelectedHotelQuote(false)
    setSelectedAirQuote(null)
    setSelectedAirQuoteError('')
    setLoadingSelectedAirQuote(false)
    setAirOperation({ ...EMPTY_AIR_OPERATION })
    if (!demand) return

    const nextService = serviceFromDemand(demand)
    setServiceKey(nextService)
    setDocumentKind(defaultDocumentKind(nextService))
    setSupplierName('')
    setSupplierCode('')
    setExternalReference('')
    setDetails(detailsFromDemand(demand))
    setReservationEvidence({ source: OFFLINE_TRAVEL_PROVIDER })
    setPassengersText(
      nextService === 'hotelaria'
        ? hotelGuestNames(demand).join('\n')
        : demand.passageiro_nome || '',
    )
    setStartsAt(dateToLocalDateTime(startDateFromDemand(demand)))
    setEndsAt(dateToLocalDateTime(endDateFromDemand(demand)))
    const amount = Number(demand.valor_final || demand.valor_venda || demand.valor_cotacao || 0)
    setGrossAmount(amount > 0 ? String(amount) : '')
    setTaxAmount('0')
    setNotes(String(demand.observacoes || ''))

    void loadSelectedHotelQuote(demand)
    void loadSelectedAirQuote(demand)

    if (usesExistingReservation) {
      const matches = reservations.filter((reservation) => (
        reservation.provider === OFFLINE_TRAVEL_PROVIDER
        && reservation.status === 'reserved'
        && (reservation.demandId === demand.id || reservation.demandNumber === demand.serial_os)
      ))
      if (matches.length === 1) void selectReservation(matches[0].id, matches, operation)
    }
  }

  async function selectReservation(
    nextReservationId: string,
    source = eligibleReservations,
    mode: OfflineOperation = operation,
  ) {
    const reservation = source.find((item) => item.id === nextReservationId) || null
    setReservationId(nextReservationId)
    setReservationVersion(reservation?.version || null)
    setRevisionCount(0)
    setConfirmed(false)
    if (!reservation) return
    const nextService = normalizeService(reservation.service)
    setServiceKey(nextService)
    setDocumentKind(defaultDocumentKind(nextService))
    setDocumentReference(reservation.providerReference || '')
    setStartsAt(toLocalDateTimeInput(reservation.startAt))
    setEndsAt(toLocalDateTimeInput(reservation.endAt))
    setGrossAmount(String(reservation.grossAmount || reservation.finalAmount || ''))
    setTaxAmount(String(reservation.taxAmount || 0))
    setCurrency(reservation.currency || 'BRL')
    setPassengersText(reservation.passengerName || '')

    if (mode !== 'correct_existing') return
    setLoadingReservation(true)
    try {
      const detail = await getOfflineReservationFromServer(reservation.id)
      if (mode === 'correct_existing' && !detail.editable) {
        throw new Error('Esta reserva já foi emitida ou finalizada e não pode ser corrigida.')
      }
      setReservationVersion(detail.version)
      setRevisionCount(detail.history.length)
      setServiceKey(detail.serviceKey)
      setSupplierName(detail.supplierName)
      setSupplierCode(detail.supplierCode || '')
      setExternalReference(detail.externalReference)
      setDocumentReference(detail.externalReference)
      setChannel(detail.channel)
      setStartsAt(toLocalDateTimeInput(detail.startsAt))
      setEndsAt(toLocalDateTimeInput(detail.endsAt))
      setGrossAmount(String(detail.amounts.gross))
      setTaxAmount(String(detail.amounts.taxes))
      setCurrency(detail.amounts.currency)
      setDetails(detailStateFromRecord(detail.details))
      setReservationEvidence(detail.details.evidence || { source: OFFLINE_TRAVEL_PROVIDER })
      setPassengersText(Array.isArray(detail.details.passengers)
        ? detail.details.passengers.join('\n')
        : reservation.passengerName || '')
      setNotes(detail.notes || '')
      if (detail.serviceKey === 'aereo') {
        const evidence = detail.details.evidence || {}
        const reservationSystem = typeof evidence.reservationSystem === 'string'
          ? evidence.reservationSystem
          : ''
        const reservationConfirmedAt = typeof evidence.reservationConfirmedAt === 'string'
          ? toLocalDateTimeInput(evidence.reservationConfirmedAt)
          : ''
        setAirOperation((current) => ({
          ...current,
          reservationSystem: reservationSystem || current.reservationSystem,
          locator: detail.externalReference || current.locator,
          operationalSupplierName: detail.supplierName || current.operationalSupplierName,
          reservationConfirmedAt: reservationConfirmedAt || current.reservationConfirmedAt,
          operationalNotes: detail.notes || '',
        }))
      }
    } catch (error) {
      setReservationId('')
      setReservationVersion(null)
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a reserva offline.')
    } finally {
      setLoadingReservation(false)
    }
  }

  function changeService(nextService: OfflineTravelService) {
    setServiceKey(nextService)
    setDocumentKind(defaultDocumentKind(nextService))
    setConfirmed(false)
  }

  function updateDetail(key: DetailKey, value: string) {
    setDetails((current) => ({ ...current, [key]: value }))
  }

  function changeAirOperation(next: OfflineAirOperationDraft) {
    setAirOperation(next)
    setSupplierName(next.operationalSupplierName)
    setExternalReference(next.locator)
    setDocumentReference(next.locator)
    setIssuedAt(next.issuedAt)
    setPaymentMethod(next.paymentMethod)
    setPaymentReference(next.paymentReference)
    setNotes(next.operationalNotes)
    setTicketNumber(next.tickets[0]?.ticketNumber || '')
    setReservationEvidence((current) => ({
      ...current,
      reservationSystem: next.reservationSystem,
      reservationConfirmedAt: dateTimeToIso(next.reservationConfirmedAt) || null,
      airTickets: next.tickets,
    }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!selectedDemand?.serial_os) {
      toast.error('Selecione uma demanda com Serial/OS antes de continuar.')
      return
    }
    if (!selectedCompany) {
      toast.error('A empresa da demanda não está disponível no contexto atual.')
      return
    }
    if (requiresSelectedCommercialQuote && !selectedHotelQuote && !selectedAirQuote) {
      toast.error('Carregue a opção escolhida e aprovada antes de registrar a reserva.')
      return
    }
    if (
      createsReservation
      && selectedHotelQuote?.option.approvalInstanceId
      && selectedHotelQuote.option.approvalStatus !== 'approved'
    ) {
      toast.error('A escolha ainda não possui uma aprovação concluída para seguir à reserva.')
      return
    }
    if (
      createsReservation
      && selectedAirQuote?.approvalInstanceId
      && selectedAirQuote.approvalStatus !== 'approved'
    ) {
      toast.error('A escolha aérea ainda não possui uma aprovação concluída para seguir à reserva.')
      return
    }
    if (usesExistingReservation && !selectedReservation) {
      toast.error(correctsReservation
        ? 'Selecione uma reserva offline confirmada para corrigir.'
        : 'Selecione uma reserva offline confirmada para emitir.')
      return
    }
    if (!confirmed) {
      toast.error('Confirme explicitamente os dados e a execução da operação.')
      return
    }

    const submissionId = crypto.randomUUID()
    const lifecycleVersion = positiveInteger(selectedDemand.relational_lifecycle_version)
    const effectivePassengersText = locksSelectedHotelGuests
      ? hotelGuestNames(selectedDemand).join('\n')
      : passengersText
    const cleanDetails = reservationDetails(details, effectivePassengersText, reservationEvidence)
    if (serviceKey === 'aereo' && selectedAirQuote) {
      if (!airOperation.reservationSystem.trim() || !airOperation.locator.trim() || !airOperation.operationalSupplierName.trim()) {
        toast.error('Informe sistema de reserva, localizador e fornecedor operacional do aéreo.')
        return
      }
      if (includesIssue) {
        const missingTicket = airOperation.tickets.some((ticket) => !ticket.passengerName.trim() || !ticket.ticketNumber.trim())
        if (!airOperation.tickets.length || missingTicket) {
          toast.error('Informe o número do bilhete de cada passageiro antes de emitir.')
          return
        }
        if (!airOperation.issuedAt.trim()) {
          toast.error('Informe a data e hora da emissão aérea.')
          return
        }
      }
    }
    const reservationCandidate = createsReservation
      ? offlineReservationCreateSchema.safeParse({
          demandId: selectedDemand.id,
          serialOs: selectedDemand.serial_os,
          companyId: selectedDemand.empresa_id,
          expectedLifecycleVersion: lifecycleVersion,
          serviceKey,
          supplierName,
          supplierCode,
          externalReference,
          channel,
          startsAt: dateTimeToIso(startsAt),
          endsAt: dateTimeToIso(endsAt),
          amounts: {
            gross: grossAmount,
            taxes: taxAmount || '0',
            total: totalAmount,
            currency,
          },
          details: cleanDetails,
          notes,
          policyJustification,
          confirmed: true,
          idempotencyKey: `offline:${submissionId}:reservation`,
        })
      : null
    if (reservationCandidate && !reservationCandidate.success) {
      toast.error(firstValidationMessage(reservationCandidate.error.issues))
      return
    }

    const correctionCandidate = correctsReservation
      ? offlineReservationCorrectionSchema.safeParse({
          expectedVersion: reservationVersion,
          reason: correctionReason,
          serviceKey,
          supplierName,
          supplierCode,
          externalReference,
          channel,
          startsAt: dateTimeToIso(startsAt),
          endsAt: dateTimeToIso(endsAt),
          amounts: {
            gross: grossAmount,
            taxes: taxAmount || '0',
            total: totalAmount,
            currency,
          },
          details: cleanDetails,
          notes,
          confirmed: true,
        })
      : null
    if (correctionCandidate && !correctionCandidate.success) {
      toast.error(firstValidationMessage(correctionCandidate.error.issues))
      return
    }

    const issueCandidate = includesIssue
      ? offlineIssueCreateSchema.safeParse({
          demandId: selectedDemand.id,
          serialOs: selectedDemand.serial_os,
          expectedLifecycleVersion: lifecycleVersion,
          issuedAt: dateTimeToIso(issuedAt),
          supplierConfirmation: true,
          document: {
            kind: documentKind,
            reference: documentReference,
            ticketNumber,
          },
          payment: {
            method: paymentMethod,
            reference: paymentReference,
          },
          details: {
            serviceKey,
            serviceDetails: cleanDetails,
            operationSource: OFFLINE_TRAVEL_PROVIDER,
            reservationChannel: createsReservation ? channel : undefined,
            airTickets: serviceKey === 'aereo' ? airOperation.tickets : undefined,
            airReservationSystem: serviceKey === 'aereo' ? airOperation.reservationSystem : undefined,
            airReservationConfirmedAt: serviceKey === 'aereo'
              ? dateTimeToIso(airOperation.reservationConfirmedAt)
              : undefined,
          },
          notes,
          policyJustification,
          generateVoucher,
          confirmed: true,
          idempotencyKey: `offline:${submissionId}:issue`,
        })
      : null
    if (issueCandidate && !issueCandidate.success) {
      toast.error(firstValidationMessage(issueCandidate.error.issues))
      return
    }

    setBusy(true)
    let createdReservationId = ''
    try {
      if (correctionCandidate?.success && selectedReservation) {
        const corrected = await correctOfflineReservationFromServer(
          selectedReservation.id,
          correctionCandidate.data,
        )
        toast.success(showTechnicalMetadata
          ? `Reserva corrigida. Nova versão: ${corrected.version}.`
          : 'Reserva corrigida com histórico de auditoria registrado.')
        setReservationVersion(corrected.version)
        setRevisionCount((current) => current + 1)
        setCorrectionReason('')
        setConfirmed(false)
        onCompleted()
        return
      }
      if (reservationCandidate?.success) {
        const result = await createOfflineReservationFromServer(reservationCandidate.data)
        createdReservationId = result.reservationId
        if (operation === 'reservation') {
          toast.success(`Reserva offline registrada para a OS ${selectedDemand.serial_os}.`)
          setConfirmed(false)
          onCompleted()
          return
        }
        if (issueCandidate?.success) {
          issueCandidate.data.expectedLifecycleVersion = result.lifecycleVersion
        }
      }

      if (!issueCandidate?.success) {
        throw new Error('Os dados da emissão offline não foram preparados.')
      }
      const targetReservationId = createdReservationId || selectedReservation?.id || ''
      const issue = await issueOfflineReservationFromServer(targetReservationId, issueCandidate.data)
      const voucherMessage = issue.voucherId ? ` Voucher ${issue.voucherId} gerado.` : ''
      toast.success(`Emissão offline registrada para a OS ${selectedDemand.serial_os}.${voucherMessage}`)
      setConfirmed(false)
      onCompleted()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação offline.'
      const operationalError = error as { code?: string; status?: number } | null
      const approvalStateChanged = operationalError?.status === 409
        && Boolean(operationalError.code?.includes('APPROVAL'))
      if (createdReservationId && operation === 'reservation_and_issue') {
        toast.warning(`A reserva ${createdReservationId} foi criada, mas a emissão não foi concluída: ${message}`)
        onCompleted()
      } else {
        toast.error(message)
        if (approvalStateChanged) onCompleted()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bbt-card p-5" aria-labelledby="offline-travel-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <WifiOff className="h-5 w-5" />
          </span>
          <div>
            <p className="bbt-section-label">Operação manual governada</p>
            <h2 id="offline-travel-title" className="mt-1 font-semibold text-bbt-primary dark:text-white">
              Reserva e emissão offline
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Registre operações concluídas por telefone, e-mail ou portal externo sem acionar os conectores online.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          Canal offline
        </span>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-5">
        <fieldset disabled={busy || loadingReservation || loadingSelectedHotelQuote || loadingSelectedAirQuote} className="space-y-5 disabled:opacity-70">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Operação
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {OPERATION_OPTIONS.map((item) => {
                const active = operation === item.value
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => changeOperation(item.value)}
                    aria-pressed={active}
                    className={`rounded-lg border p-3 text-left transition ${
                      active
                        ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-white'
                        : 'border-bbt-gray-100 hover:border-bbt-accent/60 dark:border-slate-700'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-bbt-accent/25 bg-bbt-accent/5 p-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Serial/OS *">
                <select
                  value={demandId}
                  onChange={(event) => selectDemand(event.target.value)}
                  className="bbt-input"
                  required
                >
                  <option value="">Selecione uma demanda</option>
                  {availableDemands.map((demand) => (
                    <option key={demand.id} value={demand.id}>
                      {demand.serial_os} · {demand.passageiro_nome} · {companyById.get(demand.empresa_id)?.nome || 'Empresa não localizada'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Empresa vinculada">
                <div className="bbt-input flex items-center bg-slate-50 text-sm dark:bg-slate-900/40">
                  {selectedCompany?.nome || 'Selecione a OS para identificar a empresa'}
                </div>
              </Field>
            </div>
            {selectedDemand && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-bbt-accent/20 pt-3 text-xs text-slate-600 dark:text-slate-300">
                <span><strong>Viajante:</strong> {selectedDemand.passageiro_nome}</span>
                <span><strong>Status:</strong> {travelLifecycleStatusLabel(selectedDemand.relational_lifecycle_status || selectedDemand.status)}</span>
                {showTechnicalMetadata && (
                  <span><strong>Versão técnica:</strong> {selectedDemand.relational_lifecycle_version || '-'}</span>
                )}
              </div>
            )}
          </div>

          {selectedDemand && serviceKey === 'hotelaria' && loadingSelectedHotelQuote && (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 text-sm text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-200">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando a opção escolhida pelo solicitante...
            </div>
          )}

          {selectedDemand && serviceKey === 'hotelaria' && selectedHotelQuote && (
            <SelectedHotelQuoteSummary
              context={selectedHotelQuote}
              supplierName={supplierName}
              supplierDiffers={quotedSupplierDiffers}
              comparesOperationalSupplier={locksSelectedHotelQuote}
            />
          )}

          {selectedDemand && serviceKey === 'hotelaria' && selectedHotelQuoteError && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              <p className="font-semibold">A opção escolhida não pôde ser carregada.</p>
              <p className="mt-1">{selectedHotelQuoteError}</p>
            </div>
          )}

          {selectedDemand && serviceKey === 'aereo' && loadingSelectedAirQuote && (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 text-sm text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-200">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando a opção aérea escolhida pelo solicitante...
            </div>
          )}

          {selectedDemand && serviceKey === 'aereo' && selectedAirQuote && (
            <OfflineAirOperationFields
              approvedSnapshot={selectedAirQuote.snapshot}
              value={airOperation}
              mode={operation === 'reservation_and_issue'
                ? 'reservation_and_issue'
                : operation === 'issue_existing'
                  ? 'issue_existing'
                  : operation === 'correct_existing' ? 'correction' : 'reservation'}
              disabled={busy || loadingReservation}
              onChange={changeAirOperation}
            />
          )}

          {selectedDemand && serviceKey === 'aereo' && selectedAirQuoteError && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              <p className="font-semibold">A opção aérea escolhida não pôde ser carregada.</p>
              <p className="mt-1">{selectedAirQuoteError}</p>
            </div>
          )}

          {usesExistingReservation && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
              <Field label={correctsReservation ? 'Reserva a corrigir *' : 'Reserva offline confirmada *'}>
                <select
                  value={reservationId}
                  onChange={(event) => { void selectReservation(event.target.value) }}
                  className="bbt-input"
                  required
                  disabled={!selectedDemand || eligibleReservations.length === 0}
                >
                  <option value="">
                    {!selectedDemand
                      ? 'Selecione primeiro a OS'
                      : eligibleReservations.length
                        ? 'Selecione a reserva'
                        : 'Nenhuma reserva offline disponível para esta OS'}
                  </option>
                  {eligibleReservations.map((reservation) => (
                    <option key={reservation.id} value={reservation.id}>
                      {reservation.providerReference || 'Reserva offline sem localizador'} · {reservation.passengerName} · {travelLifecycleStatusLabel(reservation.status)}
                    </option>
                  ))}
                </select>
              </Field>
              {correctsReservation && selectedReservation && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-indigo-800 dark:text-indigo-200">
                  {showTechnicalMetadata && (
                    <span className="inline-flex items-center gap-1"><PencilLine className="h-3.5 w-3.5" /> Versão técnica {reservationVersion || selectedReservation.version}</span>
                  )}
                  <span className="inline-flex items-center gap-1"><History className="h-3.5 w-3.5" /> {revisionCount} correção(ões) registrada(s)</span>
                </div>
              )}
            </div>
          )}

          {!(serviceKey === 'aereo' && selectedAirQuote) && <div className="grid gap-4 md:grid-cols-2">
            <Field label="Serviço *">
              <select
                value={serviceKey}
                onChange={(event) => changeService(event.target.value as OfflineTravelService)}
                className="bbt-input"
                disabled={Boolean(selectedDemand)}
              >
                {OFFLINE_TRAVEL_SERVICES.map((service) => (
                  <option key={service} value={service}>{offlineServiceLabel(service)}</option>
                ))}
              </select>
            </Field>
            <Field label="Passageiros / hóspedes / segurados">
              <div>
                <textarea
                  value={passengersText}
                  onChange={(event) => setPassengersText(event.target.value)}
                  className={`bbt-input min-h-20 py-2 ${locksSelectedHotelGuests ? 'cursor-not-allowed bg-slate-50 dark:bg-slate-900/40' : ''}`}
                  placeholder="Um nome por linha"
                  readOnly={locksSelectedHotelGuests}
                  aria-readonly={locksSelectedHotelGuests}
                />
                {locksSelectedHotelGuests && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Hóspedes definidos na demanda aprovada. Para alterar, use a correção da reserva com motivo e auditoria.
                  </p>
                )}
              </div>
            </Field>
          </div>}

          {showsReservationData && !(serviceKey === 'aereo' && selectedAirQuote) && (
            <section className="space-y-4 rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-700" aria-labelledby="offline-reservation-data-title">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-bbt-accent" />
                <h3 id="offline-reservation-data-title" className="font-semibold text-bbt-primary dark:text-white">
                  Dados da reserva
                </h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Fornecedor operacional *">
                  <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} className="bbt-input" placeholder="Nome do fornecedor" required />
                </Field>
                <Field label="Código do fornecedor">
                  <input value={supplierCode} onChange={(event) => setSupplierCode(event.target.value)} className="bbt-input" placeholder="Código interno ou externo" />
                </Field>
                <Field label="Referência / localizador *">
                  <input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} className="bbt-input" placeholder="Confirmação, PNR ou contrato" required />
                </Field>
                <Field label="Canal *">
                  <select value={channel} onChange={(event) => setChannel(event.target.value as OfflineTravelChannel)} className="bbt-input">
                    {CHANNEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <TemporalField label={`Início${startRequired ? ' *' : ''}`}>
                  <DateTimeInput
                    aria-label={`Início${startRequired ? ' obrigatório' : ''}`}
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                    onInput={(event) => setStartsAt(event.currentTarget.value)}
                    className={locksSelectedHotelQuote ? 'cursor-not-allowed bg-slate-50 dark:bg-slate-900/40' : ''}
                    required={startRequired}
                    readOnly={locksSelectedHotelQuote}
                    aria-readonly={locksSelectedHotelQuote}
                  />
                </TemporalField>
                <TemporalField label={`Fim${endRequired ? ' *' : ''}`}>
                  <DateTimeInput
                    aria-label={`Fim${endRequired ? ' obrigatório' : ''}`}
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                    onInput={(event) => setEndsAt(event.currentTarget.value)}
                    className={locksSelectedHotelQuote ? 'cursor-not-allowed bg-slate-50 dark:bg-slate-900/40' : ''}
                    required={endRequired}
                    readOnly={locksSelectedHotelQuote}
                    aria-readonly={locksSelectedHotelQuote}
                  />
                </TemporalField>
              </div>
              {locksSelectedHotelQuote && selectedHotelQuote && (
                <div className={`rounded-md border px-3 py-2 text-xs ${
                  quotedSupplierDiffers
                    ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200'
                }`}>
                  <strong>Fornecedor cotado:</strong> {selectedHotelQuote.option.supplierName}
                  {selectedHotelQuote.option.supplierCode ? ` · ${selectedHotelQuote.option.supplierCode}` : ''}
                  <span className="ml-2 font-semibold">
                    {quotedSupplierDiffers
                      ? 'O fornecedor operacional diverge do cotado; a alteração ficará registrada.'
                      : 'O fornecedor operacional coincide com o cotado.'}
                  </span>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Tarifa *">
                  <DecimalInput value={grossAmount} onValueChange={setGrossAmount} prefix={currency || 'BRL'} className={locksSelectedHotelQuote ? 'cursor-not-allowed bg-slate-50 dark:bg-slate-900/40' : ''} placeholder="0,00" required readOnly={locksSelectedHotelQuote} aria-readonly={locksSelectedHotelQuote} />
                </Field>
                <Field label="Taxas">
                  <DecimalInput value={taxAmount} onValueChange={setTaxAmount} prefix={currency || 'BRL'} className={locksSelectedHotelQuote ? 'cursor-not-allowed bg-slate-50 dark:bg-slate-900/40' : ''} placeholder="0,00" readOnly={locksSelectedHotelQuote} aria-readonly={locksSelectedHotelQuote} />
                </Field>
                <Field label="Total *">
                  <input type="text" value={formatDecimalInput(totalAmount)} className="bbt-input bg-slate-50 font-semibold tabular-nums dark:bg-slate-900/40" placeholder="Calculado automaticamente" readOnly aria-readonly="true" />
                </Field>
                <Field label="Moeda *">
                  <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} className={`bbt-input uppercase ${locksSelectedHotelQuote ? 'cursor-not-allowed bg-slate-50 dark:bg-slate-900/40' : ''}`} maxLength={3} required readOnly={locksSelectedHotelQuote} aria-readonly={locksSelectedHotelQuote} />
                </Field>
              </div>
            </section>
          )}

          {correctsReservation && (
            <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20" aria-labelledby="offline-correction-reason-title">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                <h3 id="offline-correction-reason-title" className="font-semibold text-bbt-primary dark:text-white">
                  Motivo e histórico da correção
                </h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                O servidor confere o registro atual, impede alterações depois da emissão e grava os dados completos antes e depois.
              </p>
              <Field label="Motivo da correção *">
                <textarea
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  className="bbt-input min-h-24 py-2"
                  placeholder="Explique por que a reserva precisa ser corrigida"
                  minLength={3}
                  maxLength={2000}
                  required
                />
              </Field>
            </section>
          )}

          {!(serviceKey === 'aereo' && selectedAirQuote) && <section className="space-y-4 rounded-lg border border-bbt-gray-100 p-4 dark:border-slate-700" aria-labelledby="offline-service-details-title">
            <div className="flex items-center gap-2">
              <TicketCheck className="h-4 w-4 text-bbt-accent" />
              <h3 id="offline-service-details-title" className="font-semibold text-bbt-primary dark:text-white">
                Evidências de {offlineServiceLabel(serviceKey).toLowerCase()}
              </h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {DETAIL_FIELDS[serviceKey].map((field) => {
                const quoteFieldLocked = locksSelectedHotelQuote && isSelectedHotelQuoteField(field.key)
                const lockedClasses = quoteFieldLocked
                  ? 'cursor-not-allowed bg-slate-50 dark:bg-slate-900/40'
                  : ''
                return (
                  <Field key={field.key} label={field.label}>
                    {field.kind === 'textarea' ? (
                      <textarea
                        value={details[field.key]}
                        onChange={(event) => updateDetail(field.key, event.target.value)}
                        className={`bbt-input min-h-24 py-2 ${lockedClasses}`}
                        placeholder={field.placeholder}
                        readOnly={quoteFieldLocked}
                        aria-readonly={quoteFieldLocked}
                      />
                    ) : (
                      <input
                        value={details[field.key]}
                        onChange={(event) => updateDetail(field.key, event.target.value)}
                        className={`bbt-input ${lockedClasses}`}
                        placeholder={field.placeholder}
                        readOnly={quoteFieldLocked}
                        aria-readonly={quoteFieldLocked}
                      />
                    )}
                  </Field>
                )
              })}
            </div>
          </section>}

          {includesIssue && !(serviceKey === 'aereo' && selectedAirQuote) && (
            <section className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/10" aria-labelledby="offline-issue-data-title">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                <h3 id="offline-issue-data-title" className="font-semibold text-bbt-primary dark:text-white">
                  Dados da emissão
                </h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tipo de documento *">
                  <select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as OfflineIssueCreateInput['document']['kind'])} className="bbt-input">
                    <option value="bilhete">Bilhete</option>
                    <option value="confirmacao">Confirmação</option>
                    <option value="voucher">Voucher</option>
                    <option value="apolice">Apólice</option>
                    <option value="contrato">Contrato</option>
                    <option value="outro">Outro</option>
                  </select>
                </Field>
                <Field label="Referência do documento *">
                  <input value={documentReference} onChange={(event) => setDocumentReference(event.target.value)} className="bbt-input" placeholder="Número da confirmação, voucher ou apólice" required />
                </Field>
                <Field label="Número do bilhete">
                  <input value={ticketNumber} onChange={(event) => setTicketNumber(event.target.value)} className="bbt-input" placeholder="Quando aplicável" />
                </Field>
                <TemporalField label="Emitido em">
                  <DateTimeInput
                    aria-label="Emitido em"
                    value={issuedAt}
                    onChange={(event) => setIssuedAt(event.target.value)}
                    onInput={(event) => setIssuedAt(event.currentTarget.value)}
                  />
                </TemporalField>
                <Field label="Forma de pagamento *">
                  <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as OfflinePaymentMethod)} className="bbt-input">
                    {PAYMENT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="Referência do pagamento">
                  <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="bbt-input" placeholder="Fatura, autorização, transação..." />
                </Field>
              </div>
              <div className="flex flex-wrap gap-5 text-sm text-slate-700 dark:text-slate-200">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={generateVoucher} onChange={(event) => setGenerateVoucher(event.target.checked)} className="h-4 w-4 accent-bbt-accent" />
                  Gerar voucher automaticamente
                </label>
              </div>
            </section>
          )}

          {includesIssue && serviceKey === 'aereo' && selectedAirQuote && (
            <section className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/10" aria-labelledby="offline-air-document-title">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                  <div>
                    <h3 id="offline-air-document-title" className="font-semibold text-bbt-primary dark:text-white">
                      Voucher aéreo
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">O localizador e os bilhetes informados acima serão usados automaticamente.</p>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={generateVoucher} onChange={(event) => setGenerateVoucher(event.target.checked)} className="h-4 w-4 accent-bbt-accent" />
                  Gerar voucher completo
                </label>
              </div>
            </section>
          )}

          {serviceKey === 'aereo' && selectedAirQuote ? (
            <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
              <summary className="cursor-pointer text-sm font-semibold text-bbt-primary dark:text-white">Justificativa de política, se exigida</summary>
              <div className="mt-4">
                <Field label="Justificativa de política">
                  <textarea value={policyJustification} onChange={(event) => setPolicyJustification(event.target.value)} className="bbt-input min-h-24 py-2" placeholder="Preencha somente quando a política da empresa exigir" />
                </Field>
              </div>
            </details>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Justificativa de política">
                <textarea value={policyJustification} onChange={(event) => setPolicyJustification(event.target.value)} className="bbt-input min-h-24 py-2" placeholder="Informe quando a política exigir justificativa" />
              </Field>
              <Field label="Observações operacionais">
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="bbt-input min-h-24 py-2" placeholder="Detalhes internos e evidências adicionais" />
              </Field>
            </div>
          )}

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
                <CheckCircle2 className="h-4 w-4" /> Confirmação humana obrigatória
              </span>
              <span className="mt-1 block text-sm leading-5 text-slate-600 dark:text-slate-300">
                Confirmo que conferi a OS, o escopo da empresa e as evidências do fornecedor. Quando houver emissão, confirmo também que ela foi efetivamente concluída fora do sistema.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
          <p className="text-xs text-slate-500">
            O servidor validará novamente permissões, lifecycle, política e idempotência.
          </p>
          <button type="submit" disabled={busy || loadingReservation || loadingSelectedHotelQuote || loadingSelectedAirQuote || !confirmed} className="bbt-button-primary disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {busy ? 'Processando...' : submitLabel(operation)}
          </button>
        </div>
      </form>
    </section>
  )
}

export default OfflineTravelOperationForm

function SelectedHotelQuoteSummary({
  context,
  supplierName,
  supplierDiffers,
  comparesOperationalSupplier,
}: {
  context: SelectedHotelQuoteContext
  supplierName: string
  supplierDiffers: boolean
  comparesOperationalSupplier: boolean
}) {
  const option = context.option
  const breakdown = option.breakdown
  const location = [
    option.hotel.cityName,
    option.hotel.subdivisionCode,
    option.hotel.countryCode,
  ].filter(Boolean).join(' / ')

  return (
    <section
      className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20"
      aria-labelledby="selected-hotel-quote-title"
      data-selected-hotel-quote={option.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Opção formal do pedido
          </p>
          <h3 id="selected-hotel-quote-title" className="mt-1 font-semibold text-bbt-primary dark:text-white">
            Hotel escolhido pelo solicitante
          </h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Os dados cotados permanecem bloqueados durante a reserva para preservar o que foi escolhido e aprovado.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800 shadow-sm dark:bg-slate-900 dark:text-emerald-200">
          {quoteSelectionStatusLabel(option.selectionStatus, context.lifecycleStatus, option.approvalStatus)}
        </span>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <QuoteSummaryField label="Hotel" value={option.hotel.name} />
        <QuoteSummaryField label="Localidade" value={location || 'Não informada'} />
        <QuoteSummaryField label="Acomodação" value={option.roomCategory} />
        <QuoteSummaryField label="Regime" value={option.mealPlan || 'Não informado'} />
        <QuoteSummaryField label="Categoria" value={option.hotel.category || 'Não informada'} />
        <QuoteSummaryField label="Período" value={formatQuotePeriod(option.startsAt, option.endsAt)} />
        <QuoteSummaryField label="Quartos / diárias" value={`${breakdown.roomCount} quarto(s) · ${breakdown.nights} diária(s)`} />
        <QuoteSummaryField label="Diária" value={formatQuoteMoney(breakdown.nightlyRate, breakdown.currency)} />
        <QuoteSummaryField label="Taxas por diária" value={formatQuoteMoney(breakdown.nightlyTaxes, breakdown.currency)} />
        <QuoteSummaryField label="Taxas totais" value={formatQuoteMoney(breakdown.taxesSubtotal, breakdown.currency)} />
        <QuoteSummaryField label="Taxa de serviço" value={formatQuoteMoney(breakdown.serviceFee, breakdown.currency)} />
        <QuoteSummaryField label="Total aprovado" value={formatQuoteMoney(breakdown.total, breakdown.currency)} highlight />
      </dl>

      <div className="grid gap-3 border-t border-emerald-200 pt-3 text-sm dark:border-emerald-900/60 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Fornecedor cotado</p>
          <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
            {option.supplierName}{option.supplierCode ? ` · ${option.supplierCode}` : ''}
          </p>
          {comparesOperationalSupplier && (
            <p className={`mt-1 text-xs font-semibold ${supplierDiffers ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
              {supplierDiffers
                ? `Fornecedor operacional alterado para ${supplierName || 'não informado'}.`
                : 'Fornecedor operacional igual ao cotado.'}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cancelamento</p>
          <p className="mt-1 text-slate-700 dark:text-slate-200">
            {option.refundable ? 'Reembolsável' : 'Não reembolsável'}
            {option.cancellationDeadline ? ` · até ${formatQuoteDateTime(option.cancellationDeadline)}` : ''}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {option.cancellationPolicy || 'Política de cancelamento não informada.'}
          </p>
        </div>
      </div>
    </section>
  )
}

function QuoteSummaryField({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="rounded-md bg-white/80 px-3 py-2 dark:bg-slate-900/50">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-1 ${highlight ? 'font-bold text-bbt-primary dark:text-white' : 'font-semibold text-slate-800 dark:text-slate-100'}`}>
        {value}
      </dd>
    </div>
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

function submitLabel(operation: OfflineOperation): string {
  if (operation === 'reservation_and_issue') return 'Registrar reserva e emissão'
  if (operation === 'issue_existing') return 'Registrar emissão offline'
  if (operation === 'correct_existing') return 'Salvar correção da reserva'
  return 'Registrar reserva offline'
}

function serviceFromDemand(demand: Atendimento): OfflineTravelService {
  return offlineServiceFromDemand(String(demand.tipo_servico || '')) || 'outros'
}

function normalizeService(value: string): OfflineTravelService {
  const normalized = normalizeText(value)
  const aliases: Record<string, OfflineTravelService> = {
    air: 'aereo',
    aereo: 'aereo',
    hotel: 'hotelaria',
    hotelaria: 'hotelaria',
    car: 'locacao',
    carro: 'locacao',
    locacao: 'locacao',
    bus: 'rodoviario',
    rodoviario: 'rodoviario',
    rail: 'ferroviario',
    ferroviario: 'ferroviario',
    transfer: 'transfer',
    insurance: 'seguro',
    seguro: 'seguro',
    package: 'pacotes',
    pacotes: 'pacotes',
    leisure: 'lazer',
    lazer: 'lazer',
    maritime: 'maritimo',
    maritimo: 'maritimo',
    service: 'outros',
    other: 'outros',
    outros: 'outros',
  }
  return aliases[normalized] || 'outros'
}

function defaultDocumentKind(service: OfflineTravelService): OfflineIssueCreateInput['document']['kind'] {
  if (['aereo', 'rodoviario', 'ferroviario'].includes(service)) return 'bilhete'
  if (service === 'seguro') return 'apolice'
  if (['pacotes', 'lazer', 'maritimo'].includes(service)) return 'voucher'
  return 'confirmacao'
}

function detailsFromDemand(demand: Atendimento): DetailState {
  return {
    ...EMPTY_DETAILS,
    origin: demand.detalhes_aereo?.origem || demand.detalhes_carro?.cidade_retirada || '',
    destination:
      demand.detalhes_aereo?.destino
      || demand.detalhes_hotel?.cidade
      || demand.detalhes_pacote?.destino
      || '',
    itemName:
      demand.detalhes_hotel?.hotel_nome
      || demand.detalhes_carro?.locadora
      || demand.detalhes_pacote?.descricao
      || demand.detalhes_aereo?.cia_aerea
      || '',
    serviceNumber: demand.detalhes_aereo?.numero_voo || '',
    category: demand.detalhes_carro?.categoria || '',
    className: demand.detalhes_aereo?.classe || '',
    accommodation: demand.detalhes_hotel?.tipo_apto || '',
  }
}

function startDateFromDemand(demand: Atendimento): string {
  return demand.detalhes_aereo?.data_ida
    || demand.detalhes_hotel?.data_checkin
    || demand.detalhes_carro?.data_retirada
    || demand.detalhes_pacote?.data_ida
    || ''
}

function endDateFromDemand(demand: Atendimento): string {
  return demand.detalhes_aereo?.data_volta
    || demand.detalhes_hotel?.data_checkout
    || demand.detalhes_carro?.data_devolucao
    || demand.detalhes_pacote?.data_volta
    || ''
}

function reservationDetails(
  details: DetailState,
  passengersText: string,
  evidence: Record<string, unknown>,
) {
  const clean = Object.fromEntries(
    Object.entries(details)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => Boolean(value)),
  )
  const passengers = passengersText
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    ...clean,
    passengers: passengers.length ? passengers : undefined,
    evidence: { ...evidence, source: OFFLINE_TRAVEL_PROVIDER },
  }
}

function detailStateFromRecord(value: Record<string, unknown>): DetailState {
  return Object.fromEntries(
    Object.keys(EMPTY_DETAILS).map((key) => [key, String(value[key] || '')]),
  ) as unknown as DetailState
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function firstValidationMessage(issues: Array<{ message: string }>): string {
  return issues[0]?.message || 'Revise os campos obrigatórios da operação offline.'
}

function dateTimeToIso(value: string): string | undefined {
  if (!value.trim()) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : value
}

function dateToLocalDateTime(value: string): string {
  if (!value) return ''
  const dateOnly = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? `${dateOnly}T12:00` : ''
}

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function isSelectedHotelQuoteField(field: DetailKey): boolean {
  return ['itemName', 'destination', 'accommodation', 'mealPlan', 'category'].includes(field)
}

function moneyInput(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : '0,00'
}

function formatQuoteMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
  }).format(Number.isFinite(value) ? value : 0)
}

function formatQuoteDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Data não informada'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function formatQuotePeriod(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return 'Não informado'
  const start = startsAt ? formatQuoteDateTime(startsAt) : 'início não informado'
  const end = endsAt ? formatQuoteDateTime(endsAt) : 'fim não informado'
  return `${start} – ${end}`
}

function quoteSelectionStatusLabel(
  selectionStatus: string | null,
  lifecycleStatus: string,
  approvalStatus: string | null,
): string {
  if (approvalStatus === 'approved') return 'Escolha aprovada'
  if (approvalStatus === 'rejected') return 'Escolha rejeitada'
  if (
    selectionStatus === 'approved'
    || ['approved', 'reserving', 'reserved', 'pending_issuance', 'issuing', 'issued', 'closed']
      .includes(lifecycleStatus)
  ) return 'Escolha aprovada'
  if (selectionStatus === 'pending_approval') return 'Escolha vinculada à aprovação'
  if (selectionStatus === 'selected') return 'Escolha confirmada'
  if (selectionStatus === 'rejected') return 'Escolha rejeitada'
  return 'Opção escolhida'
}

function lifecycleRequiresSelectedHotelQuote(lifecycleStatus: string): boolean {
  return [
    'pending_cost_approval',
    'approved',
    'reserving',
    'reserved',
    'pending_issuance',
    'issuing',
    'issued',
    'closed',
  ].includes(lifecycleStatus)
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function airSegmentLocation(code: string | undefined, name: string | undefined): string {
  return [code?.trim().toUpperCase(), name?.trim()].filter(Boolean).join(' - ')
}

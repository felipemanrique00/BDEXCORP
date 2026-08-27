'use client'

import {
  AlertCircle,
  BusFront,
  Car,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  MapPin,
  Send,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import { DateInput, DateTimeInput, TimeInput } from '@/components/ui/date-input'
import {
  CompanyPortalDemandClientError,
  createCompanyPortalDemand,
  getCompanyPortalDemand,
  updateCompanyPortalDemand,
} from '@/lib/company-portal-lab/demand-client'
import type {
  CorporateDemandDetail,
  CorporateDemandSnapshot,
} from '@/lib/company-portal-lab/demand-projection'
import type {
  CompanyPortalTravelOrderItem,
  CompanyPortalTravelOrderRequester,
} from '@/lib/company-portal-lab/travel-order'
import {
  listCompanyPortalAgencyDemandOptions,
  type AgencyDemandRequesterOption,
  type AgencyDemandTravelerOption,
} from '@/lib/company-portal-lab/agency-options-client'
import { canCreateAgencyAssistedDemand } from '@/lib/demands/agency-assistance'
import { todayISODate } from '@/lib/date'
import {
  listGroundRequestCatalogFromServer,
  type GroundBusTerminalOption,
  type GroundRentalLocationOption,
} from '@/lib/offline-ground/catalog-client'
import { localDateTimeWithZoneOffset } from '@/lib/offline-ground/timezone'
import {
  portalBusRequestDetailsSchema,
  portalCarRequestDetailsSchema,
} from '@/lib/offline-ground/request-model'
import { createEntityId } from '@/lib/ids'
import { userAccessKind } from '@/lib/user-access-kind'
import { searchTravelers } from '@/lib/travelers/client'
import type {
  Atendimento,
  DetalhesCarro,
  DetalhesRodoviario,
  Empresa,
  FormaPagamento,
  Prioridade,
} from '@/types'

import type { GroundPortalService } from './ground-portal-contract'
import {
  GROUND_REQUEST_CORRECTION_REASON_MIN_LENGTH,
  buildGroundRequestCorrectionDemand,
  clone,
  normalizeGroundRequestCorrectionReason,
} from './ground-request-correction-contract'

interface GroundOfflineRequestFormBaseProps {
  service: GroundPortalService
  companies: Empresa[]
  initialCompanyId?: string
  onCancel: () => void
  onCompanyChange?: (companyId: string) => void
}

export type GroundOfflineRequestFormProps = GroundOfflineRequestFormBaseProps & (
  | {
      editingItem: CorporateDemandDetail
      onUpdated: (item: CorporateDemandDetail) => void
      onCreated?: never
      draftItem?: never
      travelOrderNumber?: never
      travelOrderRequester?: never
      onSaveDraftItem?: never
      onDirtyChange?: never
    }
  | {
      editingItem?: undefined
      onUpdated?: never
      onCreated: (demand: CorporateDemandSnapshot) => void
      draftItem?: never
      travelOrderNumber?: never
      travelOrderRequester?: never
      onSaveDraftItem?: never
      onDirtyChange?: never
    }
  | {
      editingItem?: undefined
      onUpdated?: never
      onCreated?: never
      draftItem?: CompanyPortalTravelOrderItem | null
      travelOrderNumber: string
      travelOrderRequester: CompanyPortalTravelOrderRequester
      onSaveDraftItem: (demand: CorporateDemandSnapshot) => Promise<void>
      onDirtyChange?: (dirty: boolean) => void
    }
)

interface CostCenterOption { id: string; code: string; name: string }

export function GroundOfflineRequestForm({
  service,
  companies,
  initialCompanyId,
  editingItem,
  onCancel,
  onCreated,
  onUpdated,
  onCompanyChange,
  draftItem,
  travelOrderNumber,
  travelOrderRequester,
  onSaveDraftItem,
  onDirtyChange,
}: GroundOfflineRequestFormProps) {
  const { portalContext: activePortalContext, user } = useCompanyPortalContext()
  const demandScope = useMemo(() => activePortalContext ? {
    scopeType: activePortalContext.type,
    scopeId: activePortalContext.id,
  } : {}, [activePortalContext])
  const internalUser = Boolean(user && userAccessKind(user) === 'internal')
  const agencyAssisted = Boolean(user && canCreateAgencyAssistedDemand({
    platformAdmin: user.platform_admin === true,
    roleKey: user.role_key || (user.role === 'master' ? 'tenant_admin' : null),
  }))
  const draftDemand = draftItem?.demand
  const draftMode = typeof onSaveDraftItem === 'function'
  const [companyId, setCompanyId] = useState(() => (
    editingItem?.companyId
    || draftDemand?.empresa_id
    || (initialCompanyId && companies.some((candidate) => candidate.id === initialCompanyId)
      ? initialCompanyId
      : companies[0]?.id || '')
  ))
  const company = companies.find((item) => item.id === companyId) || null
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [locations, setLocations] = useState<GroundRentalLocationOption[]>([])
  const [terminals, setTerminals] = useState<GroundBusTerminalOption[]>([])
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [requesters, setRequesters] = useState<AgencyDemandRequesterOption[]>([])
  const [travelers, setTravelers] = useState<AgencyDemandTravelerOption[]>([])
  const [requesterId, setRequesterId] = useState(() => String(editingItem?.demand.solicitante_id || draftDemand?.solicitante_id || ''))
  const [selfRequester, setSelfRequester] = useState<{ id: string; name: string } | null>(null)
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([])
  const [costCenterId, setCostCenterId] = useState<string | null>(() => editingItem?.demand.cost_center_id || draftDemand?.cost_center_id || company?.centro_custo_padrao_id || null)
  const [costCenterCode, setCostCenterCode] = useState(() => editingItem?.demand.centro_custo || draftDemand?.centro_custo || company?.centro_custo_padrao || '')
  const [paymentMethod, setPaymentMethod] = useState<FormaPagamento>(() => editingItem?.demand.forma_pagamento || draftDemand?.forma_pagamento || 'IV')
  const [priority, setPriority] = useState<Prioridade>(() => editingItem?.demand.prioridade || draftDemand?.prioridade || 'media')
  const [observations, setObservations] = useState(() => editingItem?.demand.observacoes || draftDemand?.observacoes || '')
  const [correctionReason, setCorrectionReason] = useState('')
  const [saving, setSaving] = useState(false)
  const demandIdRef = useRef(draftDemand?.id || createEntityId('at'))
  const correctionAttemptRef = useRef<{ fingerprint: string; idempotencyKey: string; demand: Atendimento } | null>(null)

  const carInitial = editingItem?.demand.detalhes_carro || draftDemand?.detalhes_carro
  const [pickupLocationId, setPickupLocationId] = useState(() => carInitial?.ground?.pickupLocationId || '')
  const [returnLocationId, setReturnLocationId] = useState(() => carInitial?.ground?.returnLocationId || '')
  const [pickupAt, setPickupAt] = useState(() => groundRequestCivilDateTime(carInitial?.ground?.pickupAt))
  const [returnAt, setReturnAt] = useState(() => groundRequestCivilDateTime(carInitial?.ground?.returnAt))
  const [driverId, setDriverId] = useState(() => carInitial?.primary_driver?.employee_id || '')
  const [category, setCategory] = useState(() => carInitial?.ground?.desiredCategory || '')
  const [automatic, setAutomatic] = useState(() => carInitial?.ground?.automaticTransmission === true)
  const [airConditioning, setAirConditioning] = useState(() => carInitial?.ground?.airConditioning !== false)
  const [unlimitedMileage, setUnlimitedMileage] = useState(() => carInitial?.ground?.unlimitedMileage === true)

  const busInitial = editingItem?.demand.detalhes_rodoviario || draftDemand?.detalhes_rodoviario
  const [tripType, setTripType] = useState<'one_way' | 'round_trip'>(() => busInitial?.ground?.tripType === 'round_trip' ? 'round_trip' : 'one_way')
  const [originTerminalId, setOriginTerminalId] = useState(() => busInitial?.ground?.legs[0]?.originTerminalId || '')
  const [destinationTerminalId, setDestinationTerminalId] = useState(() => busInitial?.ground?.legs[0]?.destinationTerminalId || '')
  const [departureDate, setDepartureDate] = useState(() => busInitial?.ground?.legs[0]?.departureDate || '')
  const [departureTime, setDepartureTime] = useState(() => busInitial?.ground?.legs[0]?.earliestDeparture || '')
  const [returnDate, setReturnDate] = useState(() => busInitial?.ground?.legs[1]?.departureDate || '')
  const [returnTime, setReturnTime] = useState(() => busInitial?.ground?.legs[1]?.earliestDeparture || '')
  const [selectedTravelerIds, setSelectedTravelerIds] = useState(() => busInitial?.travelers?.map((item) => item.employee_id) || [])
  const [preferredClass, setPreferredClass] = useState(() => busInitial?.ground?.preferredClass || '')
  const [seatPreference, setSeatPreference] = useState(() => busInitial?.ground?.seatPreference || '')
  const [accessibilityRequired, setAccessibilityRequired] = useState(() => busInitial?.ground?.accessibilityRequired === true)

  const selectedRequester = useMemo(() => {
    if (editingItem) return {
      id: String(editingItem.demand.solicitante_id || ''),
      name: editingItem.demand.solicitante_nome || 'Solicitante do pedido',
      hasActivePortalAccess: true,
    }
    if (draftMode && travelOrderRequester) return {
      id: travelOrderRequester.id,
      name: travelOrderRequester.name,
      hasActivePortalAccess: true,
    }
    if (!internalUser) return selfRequester ? { ...selfRequester, hasActivePortalAccess: true } : null
    return requesters.find((item) => item.id === requesterId)
      || (draftDemand?.solicitante_id && String(draftDemand.solicitante_id) === requesterId
        ? {
            id: requesterId,
            name: String(draftDemand.solicitante_nome || 'Solicitante do pedido'),
            hasActivePortalAccess: true,
          }
        : null)
  }, [draftDemand, draftMode, editingItem, internalUser, requesterId, requesters, selfRequester, travelOrderRequester])

  useEffect(() => {
    if (editingItem || draftMode) return
    if (!companies.some((item) => item.id === companyId)) setCompanyId(companies[0]?.id || '')
  }, [companies, companyId, draftMode, editingItem])

  useEffect(() => {
    if (!draftDemand) return
    const carDetails = draftDemand.detalhes_carro
    const busDetails = draftDemand.detalhes_rodoviario

    setCompanyId(draftDemand.empresa_id)
    setRequesterId(String(draftDemand.solicitante_id || ''))
    setCostCenterId(draftDemand.cost_center_id || null)
    setCostCenterCode(draftDemand.centro_custo || '')
    setPaymentMethod(draftDemand.forma_pagamento || 'IV')
    setPriority(draftDemand.prioridade || 'media')
    setObservations(draftDemand.observacoes || '')

    setPickupLocationId(carDetails?.ground?.pickupLocationId || '')
    setReturnLocationId(carDetails?.ground?.returnLocationId || '')
    setPickupAt(groundRequestCivilDateTime(carDetails?.ground?.pickupAt))
    setReturnAt(groundRequestCivilDateTime(carDetails?.ground?.returnAt))
    setDriverId(carDetails?.primary_driver?.employee_id || '')
    setCategory(carDetails?.ground?.desiredCategory || '')
    setAutomatic(carDetails?.ground?.automaticTransmission === true)
    setAirConditioning(carDetails?.ground?.airConditioning !== false)
    setUnlimitedMileage(carDetails?.ground?.unlimitedMileage === true)

    setTripType(busDetails?.ground?.tripType === 'round_trip' ? 'round_trip' : 'one_way')
    setOriginTerminalId(busDetails?.ground?.legs[0]?.originTerminalId || '')
    setDestinationTerminalId(busDetails?.ground?.legs[0]?.destinationTerminalId || '')
    setDepartureDate(busDetails?.ground?.legs[0]?.departureDate || '')
    setDepartureTime(busDetails?.ground?.legs[0]?.earliestDeparture || '')
    setReturnDate(busDetails?.ground?.legs[1]?.departureDate || '')
    setReturnTime(busDetails?.ground?.legs[1]?.earliestDeparture || '')
    setSelectedTravelerIds(busDetails?.travelers?.map((item) => item.employee_id) || [])
    setPreferredClass(busDetails?.ground?.preferredClass || '')
    setSeatPreference(busDetails?.ground?.seatPreference || '')
    setAccessibilityRequired(busDetails?.ground?.accessibilityRequired === true)

    demandIdRef.current = draftDemand.id
    onDirtyChange?.(false)
  }, [draftDemand, onDirtyChange])

  useEffect(() => { if (companyId) onCompanyChange?.(companyId) }, [companyId, onCompanyChange])

  useEffect(() => {
    if (!companyId) return
    const controller = new AbortController()
    setCatalogLoading(true)
    setCatalogError('')
    void listGroundRequestCatalogFromServer({ service, signal: controller.signal })
      .then((catalog) => {
        if (catalog.service === 'car') { setLocations(catalog.rentalLocations); setTerminals([]) }
        else { setTerminals(catalog.busTerminals); setLocations([]) }
      })
      .catch((error) => { if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : 'Falha ao carregar catalogo.') })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => controller.abort()
  }, [companyId, service])

  useEffect(() => {
    if (!companyId) return
    const controller = new AbortController()
    setParticipantsLoading(true)
    const request = internalUser
      ? listCompanyPortalAgencyDemandOptions(companyId, { participant: 'all', limit: 100 })
          .then((result) => ({ requesters: result.requesters, travelers: result.travelers }))
      : searchTravelers({ companyId, limit: 100 }, controller.signal)
          .then((items) => ({ requesters: [] as AgencyDemandRequesterOption[], travelers: items }))
    void request
      .then((result) => { if (!controller.signal.aborted) { setRequesters(result.requesters); setTravelers(result.travelers) } })
      .catch(() => { if (!controller.signal.aborted) { setRequesters([]); setTravelers([]) } })
      .finally(() => { if (!controller.signal.aborted) setParticipantsLoading(false) })
    return () => controller.abort()
  }, [companyId, internalUser])

  useEffect(() => {
    if (!companyId) return
    const controller = new AbortController()
    void fetch(`/api/cost-centers?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok || payload?.ok !== true) return setCostCenters([])
        setCostCenters((Array.isArray(payload.items) ? payload.items : []).flatMap((item: any): CostCenterOption[] => {
          const id = String(item?.projectionId || item?.projection_id || item?.companyCostCenterId || '')
          const code = String(item?.code || '').trim()
          return id && code && item?.isActive !== false ? [{ id, code, name: String(item?.name || code) }] : []
        }))
      })
      .catch(() => { if (!controller.signal.aborted) setCostCenters([]) })
    return () => controller.abort()
  }, [companyId])

  useEffect(() => {
    if (editingItem || draftMode || internalUser || !companyId) { setSelfRequester(null); return }
    const controller = new AbortController()
    void fetch(`/api/me/requester-profile?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        const profile = payload?.profile
        setSelfRequester(response.ok && payload?.ok === true && profile?.id
          ? { id: String(profile.id), name: String(profile.name || profile.id) }
          : null)
      })
      .catch(() => { if (!controller.signal.aborted) setSelfRequester(null) })
    return () => controller.abort()
  }, [companyId, draftMode, editingItem, internalUser])

  useEffect(() => {
    if (editingItem || draftMode) return
    setRequesterId('')
    setCostCenterId(company?.centro_custo_padrao_id || null)
    setCostCenterCode(company?.centro_custo_padrao || '')
  }, [company?.centro_custo_padrao, company?.centro_custo_padrao_id, companyId, draftMode, editingItem])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !company || !selectedRequester?.id) return toast.error('Selecione a empresa e o solicitante responsavel.')
    if (!editingItem && internalUser && !selectedRequester.hasActivePortalAccess) return toast.error('O solicitante precisa ter acesso ativo ao portal.')

    const built = service === 'car' ? buildCarDetails() : buildBusDetails()
    if (!built.ok) return toast.error(built.error)
    const primary = service === 'car' ? built.car!.primary_driver : built.bus!.travelers![0]!
    if (!primary) return toast.error('Selecione ao menos um viajante para o pedido.')
    const values = {
      ...(service === 'car' ? { carDetails: built.car } : { busDetails: built.bus }),
      paymentMethod,
      costCenterId,
      costCenterCode,
      observations,
      priority,
    }

    if (editingItem) {
      const reason = normalizeGroundRequestCorrectionReason(correctionReason)
      if (!reason) return toast.error(`Explique a correcao em pelo menos ${GROUND_REQUEST_CORRECTION_REASON_MIN_LENGTH} caracteres e duas palavras.`)
      const fingerprint = JSON.stringify({ version: editingItem.version, reason, values })
      if (correctionAttemptRef.current?.fingerprint !== fingerprint) {
        correctionAttemptRef.current = {
          fingerprint,
          idempotencyKey: `demand:ground-correction:${editingItem.id}:${editingItem.version}:${createEntityId('idem')}`,
          demand: buildGroundRequestCorrectionDemand(editingItem, values, new Date().toISOString()),
        }
      }
      setSaving(true)
      try {
        const attempt = correctionAttemptRef.current
      const result = await updateCompanyPortalDemand(editingItem.id, {
          demand: attempt.demand,
          expectedVersion: editingItem.version,
          reason,
          idempotencyKey: attempt.idempotencyKey,
      }, demandScope)
        correctionAttemptRef.current = null
        toast.success(`Pedido ${result.item.demandNumber} corrigido e reenviado.`)
        onUpdated?.(result.item)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Nao foi possivel salvar a correcao.')
      } finally { setSaving(false) }
      return
    }

    const now = new Date().toISOString()
    const demand: Atendimento = {
      id: draftDemand?.id || demandIdRef.current,
      empresa_id: companyId,
      solicitante_id: selectedRequester.id,
      solicitante_nome: selectedRequester.name,
      agency_assisted: agencyAssisted || undefined,
      booking_mode: 'offline',
      funcionario_id: primary.employee_id,
      passageiro_nome: primary.name,
      tipo_servico: service === 'car' ? 'Carro' : 'Rodoviário',
      valor_cotacao: 0,
      agente_user_id: user.id,
      status: 'pendente',
      prioridade: priority,
      origem: 'Portal',
      observacoes: observations.trim(),
      data_atendimento: todayISODate(),
      forma_pagamento: paymentMethod,
      cost_center_id: costCenterId,
      centro_custo: costCenterCode.trim() || undefined,
      ...(service === 'car' ? { detalhes_carro: built.car } : { detalhes_rodoviario: built.bus }),
      created_at: now,
    }
    setSaving(true)
    try {
      if (onSaveDraftItem) {
        const { agente_user_id: internalAgentUserId, ...corporateDraft } = demand
        void internalAgentUserId
        await onSaveDraftItem(corporateDraft)
        onDirtyChange?.(false)
        const serviceLabel = service === 'car' ? 'Locacao' : 'Rodoviario'
        toast.success(draftItem
          ? `${serviceLabel} atualizado no Pedido.`
          : `${serviceLabel} salvo e adicionado ao Pedido.`)
        return
      }
      const result = await createCompanyPortalDemand(demand, demandScope)
      demandIdRef.current = createEntityId('at')
      toast.success(`Pedido ${result.demand.serial_os || result.demand.id} enviado para cotacao offline.`)
      onCreated?.(result.demand)
    } catch (error) {
      if (draftMode) {
        toast.error(error instanceof Error ? error.message : 'Nao foi possivel salvar o servico no Pedido.')
        return
      }
      if (error instanceof CompanyPortalDemandClientError && ['REQUEST_TIMEOUT', 'NETWORK_ERROR'].includes(error.code || '')) {
        try {
          const recovered = await getCompanyPortalDemand(demand.id, demandScope)
          demandIdRef.current = createEntityId('at')
          onCreated?.(recovered.demand)
          return
        } catch { /* preserve idempotent id */ }
      }
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel enviar o pedido.')
    } finally { setSaving(false) }
  }

  function buildCarDetails(): { ok: true; car: DetalhesCarro; bus?: never } | { ok: false; error: string } {
    const pickup = locations.find((item) => item.id === pickupLocationId)
    const returning = locations.find((item) => item.id === returnLocationId)
    const driver = travelers.find((item) => item.id === driverId)
    if (!pickup || !returning) return { ok: false, error: 'Selecione lojas aprovadas de retirada e devolucao.' }
    if (pickup.supplierId !== returning.supplierId) return { ok: false, error: 'Retirada e devolucao precisam ser da mesma locadora.' }
    if (!driver) return { ok: false, error: 'Selecione o motorista principal na base de viajantes.' }
    const candidate = {
      ground: {
        pickupLocationId: pickup.id,
        returnLocationId: returning.id,
        pickupAt: localDateTimeWithZoneOffset(pickupAt, pickup.timezone),
        returnAt: localDateTimeWithZoneOffset(returnAt, returning.timezone),
        desiredCategory: category.trim() || undefined,
        automaticTransmission: automatic,
        airConditioning,
        unlimitedMileage,
        preferences: {},
        notes: observations.trim() || undefined,
      },
      primary_driver: { employee_id: driver.id, name: driver.name, ...(driver.email ? { email: driver.email } : {}) },
      pickup_location_name: locationLabel(pickup),
      return_location_name: locationLabel(returning),
      supplier_name: pickup.supplierName,
      locadora: pickup.supplierName,
      cidade_retirada: pickup.cityName || undefined,
      data_retirada: pickupAt.slice(0, 10),
      data_devolucao: returnAt.slice(0, 10),
      categoria: category.trim() || undefined,
    }
    const parsed = portalCarRequestDetailsSchema.safeParse(candidate)
    return parsed.success ? { ok: true, car: candidate } : { ok: false, error: parsed.error.issues[0]?.message || 'Revise a locacao.' }
  }

  function buildBusDetails(): { ok: true; bus: DetalhesRodoviario; car?: never } | { ok: false; error: string } {
    const origin = terminals.find((item) => item.id === originTerminalId)
    const destination = terminals.find((item) => item.id === destinationTerminalId)
    const chosenTravelers = selectedTravelerIds.flatMap((id) => {
      const traveler = travelers.find((item) => item.id === id)
      return traveler ? [{ employee_id: traveler.id, name: traveler.name, ...(traveler.email ? { email: traveler.email } : {}) }] : []
    })
    if (!origin || !destination || origin.cityId === destination.cityId) return { ok: false, error: 'Selecione terminais aprovados em cidades diferentes.' }
    if (!departureDate || !chosenTravelers.length) return { ok: false, error: 'Informe a data e selecione ao menos um viajante.' }
    if (tripType === 'round_trip' && (!returnDate || returnDate < departureDate)) return { ok: false, error: 'Informe uma data de retorno igual ou posterior a ida.' }
    const firstLeg = {
      originCityId: origin.cityId,
      destinationCityId: destination.cityId,
      originTerminalId: origin.id,
      destinationTerminalId: destination.id,
      departureDate,
      ...(departureTime ? { earliestDeparture: departureTime } : {}),
    }
    const legs = tripType === 'round_trip'
      ? [firstLeg, {
          originCityId: destination.cityId,
          destinationCityId: origin.cityId,
          originTerminalId: destination.id,
          destinationTerminalId: origin.id,
          departureDate: returnDate,
          ...(returnTime ? { earliestDeparture: returnTime } : {}),
        }]
      : [firstLeg]
    const firstSnapshot = {
      origin_city_name: origin.cityName,
      destination_city_name: destination.cityName,
      origin_terminal_name: origin.name,
      destination_terminal_name: destination.name,
    }
    const candidate = {
      ground: {
        tripType,
        preferredClass: preferredClass.trim() || undefined,
        seatPreference: seatPreference.trim() || undefined,
        accessibilityRequired,
        preferences: {},
        notes: observations.trim() || undefined,
        legs,
      },
      travelers: chosenTravelers,
      leg_snapshots: tripType === 'round_trip'
        ? [firstSnapshot, {
            origin_city_name: destination.cityName,
            destination_city_name: origin.cityName,
            origin_terminal_name: destination.name,
            destination_terminal_name: origin.name,
          }]
        : [firstSnapshot],
    }
    const parsed = portalBusRequestDetailsSchema.safeParse(candidate)
    return parsed.success ? { ok: true, bus: candidate } : { ok: false, error: parsed.error.issues[0]?.message || 'Revise os trechos rodoviarios.' }
  }

  function selectTripType(next: 'one_way' | 'round_trip') {
    setTripType(next)
    if (draftMode) onDirtyChange?.(true)
  }

  const ServiceIcon = service === 'car' ? Car : BusFront
  const serviceLabel = service === 'car' ? 'Locação' : 'Rodoviário'
  const requestLabel = service === 'car' ? 'locação de veículo' : 'viagem rodoviária'
  const emptyCatalog = !catalogLoading && (service === 'car' ? locations.length === 0 : terminals.length === 0)
  return (
    <form
      onSubmit={submit}
      onChange={() => draftMode && onDirtyChange?.(true)}
      onInput={() => draftMode && onDirtyChange?.(true)}
      className="space-y-5"
      data-company-portal-ground-form
      data-service={service}
      data-travel-order-item-form={draftMode ? service : undefined}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="bbt-section-label">
            {editingItem
              ? `Pedido ${editingItem.demandNumber} · correção autorizada`
              : (draftMode ? `Pedido ${travelOrderNumber} · rascunho privado` : 'Portal Empresa · canal offline')}
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-bbt-primary dark:text-white">
            <ServiceIcon className="h-6 w-6 text-bbt-accent" />
            {editingItem
              ? `Corrigir solicitação de ${requestLabel}`
              : (draftMode
                  ? (draftItem ? `Editar ${serviceLabel} do Pedido` : `Adicionar ${serviceLabel} ao Pedido`)
                  : `Nova solicitação de ${requestLabel}`)}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {draftMode
              ? 'Salve este serviço no rascunho. A agência só terá acesso após o envio do Pedido completo.'
              : 'O pedido completo segue em um único snapshot para cotação, escolha, aprovação e emissão.'}
          </p>
        </div>
        <button type="button" className="bbt-button-ghost" onClick={onCancel}>
          {draftMode ? 'Voltar ao resumo' : 'Voltar às demandas'}
        </button>
      </header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bbt-card space-y-5 p-5 sm:p-6">
          {editingItem ? <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800"><LockKeyhole className="h-4 w-4 text-bbt-accent" />Empresa, solicitante e tipo de servico permanecem fixos.</div> : null}
          {companies.length > 1 && !editingItem && !draftMode ? <label className="block max-w-md text-xs font-semibold"><span className="mb-1 block">Empresa</span><select className="bbt-input" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label> : null}
          {catalogLoading ? <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-5 text-sm dark:bg-slate-800"><Loader2 className="h-4 w-4 animate-spin" />Carregando catalogo aprovado...</div> : null}
          {catalogError || emptyCatalog ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert"><strong>Catalogo indisponivel para selecao.</strong><p className="mt-1 text-xs">{catalogError || 'Ainda nao ha registros ativos e verificados. Cadastros pendentes de revisao nao sao liberados ao solicitante.'}</p></div> : null}
          {service === 'car' ? (
            <div className="space-y-5"><h2 className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white"><Car className="h-5 w-5 text-bbt-accent" />Retirada, devolucao e preferencias</h2><div className="grid gap-4 md:grid-cols-2"><SelectField label="Loja de retirada *" value={pickupLocationId} onChange={setPickupLocationId} options={locations.map((item) => ({ value: item.id, label: locationLabel(item) }))} /><SelectField label="Loja de devolucao *" value={returnLocationId} onChange={setReturnLocationId} options={locations.filter((item) => !pickupLocationId || item.supplierId === locations.find((entry) => entry.id === pickupLocationId)?.supplierId).map((item) => ({ value: item.id, label: locationLabel(item) }))} /><TemporalField label="Retirada *" kind="datetime" value={pickupAt} onChange={setPickupAt} /><TemporalField label="Devolucao *" kind="datetime" value={returnAt} onChange={setReturnAt} /><SelectField label="Motorista principal *" value={driverId} onChange={setDriverId} options={travelers.map((item) => ({ value: item.id, label: item.name }))} /><InputField label="Categoria preferencial" value={category} onChange={setCategory} placeholder="Ex.: economico automatico" /></div><div className="grid gap-3 sm:grid-cols-3"><CheckField label="Cambio automatico" checked={automatic} onChange={setAutomatic} /><CheckField label="Ar-condicionado" checked={airConditioning} onChange={setAirConditioning} /><CheckField label="Quilometragem livre" checked={unlimitedMileage} onChange={setUnlimitedMileage} /></div></div>
          ) : (
            <div className="space-y-5"><h2 className="flex items-center gap-2 font-bold text-bbt-primary dark:text-white"><BusFront className="h-5 w-5 text-bbt-accent" />Trechos e preferencias</h2><div className="flex gap-2"><button type="button" onClick={() => selectTripType('one_way')} className={tripType === 'one_way' ? 'bbt-button-primary' : 'bbt-button-ghost'}>Um trecho</button><button type="button" onClick={() => selectTripType('round_trip')} className={tripType === 'round_trip' ? 'bbt-button-primary' : 'bbt-button-ghost'}>Ida e volta</button></div><div className="grid gap-4 md:grid-cols-2"><SelectField label="Terminal de origem *" value={originTerminalId} onChange={setOriginTerminalId} options={terminals.map((item) => ({ value: item.id, label: terminalLabel(item) }))} /><SelectField label="Terminal de destino *" value={destinationTerminalId} onChange={setDestinationTerminalId} options={terminals.filter((item) => item.id !== originTerminalId).map((item) => ({ value: item.id, label: terminalLabel(item) }))} /><TemporalField label="Data de ida *" kind="date" value={departureDate} onChange={setDepartureDate} /><TemporalField label="Horario preferencial" kind="time" value={departureTime} onChange={setDepartureTime} />{tripType === 'round_trip' ? <><TemporalField label="Data de retorno *" kind="date" value={returnDate} onChange={setReturnDate} /><TemporalField label="Horario de retorno" kind="time" value={returnTime} onChange={setReturnTime} /></> : null}<InputField label="Classe preferencial" value={preferredClass} onChange={setPreferredClass} placeholder="Ex.: executivo" /><InputField label="Preferencia de assento" value={seatPreference} onChange={setSeatPreference} placeholder="Ex.: janela" /></div><CheckField label="Necessita recurso de acessibilidade" checked={accessibilityRequired} onChange={setAccessibilityRequired} /><div><p className="mb-2 text-xs font-bold uppercase text-slate-500">Viajantes *</p><div className="grid gap-2 sm:grid-cols-2">{travelers.map((item) => <label key={item.id} className="flex items-center gap-2 rounded-lg border border-bbt-gray-100 p-3 text-sm font-semibold dark:border-slate-700"><input type="checkbox" checked={selectedTravelerIds.includes(item.id)} onChange={(event) => setSelectedTravelerIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.name}</label>)}</div></div></div>
          )}
        </div>
        <aside className="space-y-3 xl:sticky xl:top-4"><Panel title="Catalogo e viajantes" icon={UsersRound} complete={!emptyCatalog && travelers.length > 0}><p>{participantsLoading ? 'Carregando viajantes...' : `${travelers.length} viajante(s) ativo(s) disponivel(is).`}</p><p className="mt-2 text-xs text-slate-500">Somente lojas e terminais revisados sao selecionaveis.</p></Panel><Panel title="Dados adm./financeiros" icon={WalletCards} complete={Boolean(company && paymentMethod)}><label className="block text-xs font-semibold"><span className="mb-1 block">Faturar para</span><input className="bbt-input" value={company?.nome || ''} disabled /></label><label className="mt-3 block text-xs font-semibold"><span className="mb-1 block">Centro de custo</span><select className="bbt-input" value={costCenterId || ''} onChange={(event) => { const selected = costCenters.find((item) => item.id === event.target.value); setCostCenterId(selected?.id || null); setCostCenterCode(selected?.code || '') }}><option value="">Sem centro de custo</option>{costCenters.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label className="mt-3 block text-xs font-semibold"><span className="mb-1 block">Forma de pagamento</span><select className="bbt-input" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as FormaPagamento)}><option value="IV">Faturado</option><option value="PX">Pix</option><option value="CP">Cartao proprio</option><option value="CC">Cartao corporativo</option></select></label></Panel><Panel title="Dados gerais" icon={AlertCircle} complete={Boolean(selectedRequester?.id)}>{editingItem || draftMode ? <p className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800"><strong>Solicitante fixo:</strong> {selectedRequester?.name}</p> : internalUser ? <SelectField label="Solicitante *" value={requesterId} onChange={setRequesterId} options={requesters.filter((item) => item.hasActivePortalAccess).map((item) => ({ value: item.id, label: item.name }))} /> : <p className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800">Solicitante: <strong>{selfRequester?.name || 'Nao vinculado'}</strong></p>}<label className="mt-3 block text-xs font-semibold"><span className="mb-1 block">Prioridade</span><select className="bbt-input" value={priority} onChange={(event) => setPriority(event.target.value as Prioridade)}><option value="baixa">Baixa</option><option value="media">Media</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label><label className="mt-3 block text-xs font-semibold"><span className="mb-1 block">Observacoes para a agencia</span><textarea className="bbt-input min-h-24" value={observations} onChange={(event) => setObservations(event.target.value)} maxLength={4000} /></label>{editingItem ? <label className="mt-3 block text-xs font-semibold"><span className="mb-1 block">Motivo da correcao *</span><textarea className="bbt-input min-h-24" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} required minLength={GROUND_REQUEST_CORRECTION_REASON_MIN_LENGTH} maxLength={1000} data-ground-correction-reason /></label> : null}</Panel></aside>
      </div>
      <footer className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bbt-gray-100 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <MapPin className="h-4 w-4 text-bbt-accent" />
          {draftMode ? 'Rascunho privado · ainda não enviado à agência.' : 'Canal Offline · dados bloqueados após o envio.'}
        </div>
        <button type="submit" className="bbt-button-primary min-w-56" disabled={saving || catalogLoading || emptyCatalog}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {saving
            ? (editingItem ? 'Salvando correção...' : (draftMode ? 'Salvando no Pedido...' : 'Salvando...'))
            : (editingItem
                ? 'Salvar correção e reenviar'
                : (draftMode
                    ? (draftItem ? 'Salvar alterações no pedido' : 'Salvar e adicionar ao pedido')
                    : 'Enviar para cotação da agência'))}
        </button>
      </footer>
    </form>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) { return <label className="block text-xs font-semibold"><span className="mb-1 block">{label}</span><select className="bbt-input" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Selecione</option>{options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> }
function InputField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className="block text-xs font-semibold"><span className="mb-1 block">{label}</span><input className="bbt-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label> }
function TemporalField({ label, kind, value, onChange }: { label: string; kind: 'date' | 'time' | 'datetime'; value: string; onChange: (value: string) => void }) {
  const shared = { value, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) }
  return <label className="block text-xs font-semibold"><span className="mb-1 block">{label}</span>{kind === 'date' ? <DateInput {...shared} /> : kind === 'time' ? <TimeInput {...shared} /> : <DateTimeInput {...shared} />}</label>
}
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-center gap-2 rounded-lg border border-bbt-gray-100 p-3 text-sm font-semibold dark:border-slate-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label> }
function Panel({ title, icon: Icon, complete, children }: { title: string; icon: typeof Car; complete: boolean; children: React.ReactNode }) { return <section className="rounded-xl border border-bbt-gray-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><header className="mb-3 flex items-center gap-2"><Icon className="h-4 w-4 text-bbt-accent" /><h3 className="flex-1 text-sm font-bold text-bbt-primary dark:text-white">{title}</h3>{complete ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}</header>{children}</section> }
function locationLabel(item: GroundRentalLocationOption) { return `${item.supplierName} · ${item.name}${item.cityName ? ` · ${item.cityName}` : ''}` }
function terminalLabel(item: GroundBusTerminalOption) { return `${item.cityName} · ${item.name}` }
export function groundRequestCivilDateTime(value?: string): string {
  if (!value) return ''
  const civilTime = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return civilTime ? `${civilTime[1]}T${civilTime[2]}` : value.slice(0, 16)
}

export default GroundOfflineRequestForm

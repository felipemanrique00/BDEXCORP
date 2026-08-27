'use client'

import {
  AlertCircle,
  BedDouble,
  Building2,
  CheckCircle2,
  ChevronDown,
  Hotel,
  LockKeyhole,
  Loader2,
  Plus,
  Send,
  Trash2,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import { HotelTariffSearchPanel } from '@/components/company-portal-lab/hotel-tariff-search-panel'
import { HotelDemandConfigurator } from '@/components/travel/hotel-demand-configurator'
import {
  HotelTravelerSlotPicker,
  useHotelTravelerManagementCapabilities,
} from '@/components/travel/hotel-traveler-slot-picker'
import {
  listCompanyPortalAgencyDemandOptions,
  type AgencyDemandRequesterOption,
} from '@/lib/company-portal-lab/agency-options-client'
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
import { canCreateAgencyAssistedDemand } from '@/lib/demands/agency-assistance'
import { todayISODate } from '@/lib/date'
import {
  hotelDetailsWithRooms,
  resizeHotelDemandRooms,
} from '@/lib/hotel-demand/form'
import {
  createEmptyHotelRoom,
  HOTEL_OCCUPANCIES,
  hotelDemandDetailsSchema,
  hotelDemandPrimaryGuest,
  nightsBetween,
  type HotelOccupancyCode,
  type HotelDemandDetailsInput,
} from '@/lib/hotel-demand/model'
import {
  hotelDemandPreferredHotelIds,
  preferredHotelPatch,
} from '@/lib/hotel-demand/preferences'
import { createEntityId } from '@/lib/ids'
import { userAccessKind } from '@/lib/user-access-kind'
import type {
  Atendimento,
  DetalhesHotel,
  Empresa,
  FormaPagamento,
  HotelDemandGuest,
  HotelDemandRoom,
  Prioridade,
} from '@/types'
import {
  HOTEL_REQUEST_CORRECTION_REASON_MIN_LENGTH,
  buildHotelRequestCorrectionDemand,
  hotelRequestCorrectionInitialValues,
  normalizeHotelRequestCorrectionReason,
} from './hotel-request-correction-contract'

interface HotelOfflineRequestFormBaseProps {
  companies: Empresa[]
  initialCompanyId?: string
  onCancel: () => void
  onCompanyChange?: (companyId: string) => void
}

export type HotelOfflineRequestFormProps = HotelOfflineRequestFormBaseProps & (
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

interface CostCenterOption {
  id: string
  code: string
  name: string
}

interface RequesterChoice {
  id: string
  name: string
  email: string
  hasActivePortalAccess: boolean
}

function initialHotelDetails(): DetalhesHotel {
  return {
    cidade: '',
    data_checkin: '',
    data_checkout: '',
    preferences: {},
    needs_review: true,
    rooms: [createEmptyHotelRoom()],
  }
}

export function HotelOfflineRequestForm({
  companies,
  initialCompanyId,
  onCancel,
  onCreated,
  editingItem,
  onUpdated,
  onCompanyChange,
  draftItem,
  travelOrderNumber,
  travelOrderRequester,
  onSaveDraftItem,
  onDirtyChange,
}: HotelOfflineRequestFormProps) {
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
  const correctionInitial = editingItem
    ? hotelRequestCorrectionInitialValues(editingItem)
    : null
  const [companyId, setCompanyId] = useState(() => (
    correctionInitial?.companyId
    || draftDemand?.empresa_id
    || (initialCompanyId && companies.some((company) => company.id === initialCompanyId)
      ? initialCompanyId
      : companies[0]?.id || '')
  ))
  const company = companies.find((candidate) => candidate.id === companyId) || null
  const [details, setDetails] = useState<DetalhesHotel>(() => correctionInitial?.details || draftDemand?.detalhes_hotel || initialHotelDetails())
  const [paymentMethod, setPaymentMethod] = useState<FormaPagamento>(() => correctionInitial?.paymentMethod || draftDemand?.forma_pagamento || 'IV')
  const [costCenterId, setCostCenterId] = useState<string | null>(() => correctionInitial?.costCenterId || draftDemand?.cost_center_id || null)
  const [costCenterCode, setCostCenterCode] = useState(() => correctionInitial?.costCenterCode || draftDemand?.centro_custo || '')
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([])
  const [costCentersLoading, setCostCentersLoading] = useState(false)
  const [observations, setObservations] = useState(() => correctionInitial?.observations || draftDemand?.observacoes || '')
  const [priority, setPriority] = useState<Prioridade>(() => correctionInitial?.priority || draftDemand?.prioridade || 'media')
  const [requesters, setRequesters] = useState<AgencyDemandRequesterOption[]>([])
  const [requesterSearch, setRequesterSearch] = useState('')
  const [requesterId, setRequesterId] = useState(() => String(draftDemand?.solicitante_id || ''))
  const [requesterLoading, setRequesterLoading] = useState(false)
  const [requesterError, setRequesterError] = useState('')
  const [selfRequester, setSelfRequester] = useState<RequesterChoice | null>(null)
  const [correctionReason, setCorrectionReason] = useState('')
  const [saving, setSaving] = useState(false)
  const demandIdRef = useRef(draftDemand?.id || createEntityId('at'))
  const correctionAttemptRef = useRef<{
    fingerprint: string
    idempotencyKey: string
    demand: Atendimento
  } | null>(null)
  const updateDetails = useCallback<React.Dispatch<React.SetStateAction<DetalhesHotel>>>((next) => {
    setDetails(next)
    if (draftMode) onDirtyChange?.(true)
  }, [draftMode, onDirtyChange])

  const roomCount = details.rooms?.length || 0
  const guestCount = useMemo(
    () => (details.rooms || []).reduce((total, room) => total + room.guests.length, 0),
    [details.rooms],
  )
  const selectedRequester = useMemo<RequesterChoice | null>(() => {
    if (editingItem) {
      const persistedRequesterId = String(editingItem.demand.solicitante_id || '')
      return persistedRequesterId
        ? {
            id: persistedRequesterId,
            name: String(editingItem.demand.solicitante_nome || 'Solicitante do pedido'),
            email: '',
            hasActivePortalAccess: true,
          }
        : null
    }
    if (draftMode && travelOrderRequester) return {
      id: travelOrderRequester.id,
      name: travelOrderRequester.name,
      email: '',
      hasActivePortalAccess: true,
    }
    if (!internalUser) return selfRequester
    const selected = requesters.find((requester) => requester.id === requesterId)
    return selected
      ? {
          id: selected.id,
          name: selected.name,
          email: selected.email,
          hasActivePortalAccess: selected.hasActivePortalAccess,
        }
      : (draftDemand?.solicitante_id && String(draftDemand.solicitante_id) === requesterId
          ? {
              id: requesterId,
              name: String(draftDemand.solicitante_nome || 'Solicitante do pedido'),
              email: '',
              hasActivePortalAccess: true,
            }
          : null)
  }, [draftDemand, draftMode, editingItem, internalUser, requesterId, requesters, selfRequester, travelOrderRequester])
  const guestsComplete = guestCount > 0 && details.needs_review !== true
  const administrativeComplete = Boolean(companyId && paymentMethod)
  const generalComplete = Boolean(selectedRequester?.id)

  useEffect(() => {
    if (editingItem) {
      if (companyId !== editingItem.companyId) setCompanyId(editingItem.companyId)
      return
    }
    if (!companyId || companies.some((candidate) => candidate.id === companyId)) return
    setCompanyId(companies[0]?.id || '')
  }, [companies, companyId, editingItem])

  useEffect(() => {
    if (editingItem || draftItem) return
    setDetails(initialHotelDetails())
    setRequesterId('')
    setRequesterSearch('')
    setRequesters([])
    setRequesterError('')
    setCostCenterId(company?.centro_custo_padrao_id || null)
    setCostCenterCode(company?.centro_custo_padrao || '')
  }, [company?.centro_custo_padrao, company?.centro_custo_padrao_id, companyId, draftItem, editingItem])

  useEffect(() => {
    if (!editingItem) return
    const initial = hotelRequestCorrectionInitialValues(editingItem)
    setCompanyId(initial.companyId)
    setDetails(initial.details)
    setPaymentMethod(initial.paymentMethod)
    setCostCenterId(initial.costCenterId)
    setCostCenterCode(initial.costCenterCode)
    setObservations(initial.observations)
    setPriority(initial.priority)
    setCorrectionReason('')
    correctionAttemptRef.current = null
  }, [editingItem])

  useEffect(() => {
    if (!draftDemand) return
    setCompanyId(draftDemand.empresa_id)
    setDetails(draftDemand.detalhes_hotel || initialHotelDetails())
    setPaymentMethod(draftDemand.forma_pagamento || 'IV')
    setCostCenterId(draftDemand.cost_center_id || null)
    setCostCenterCode(draftDemand.centro_custo || '')
    setObservations(draftDemand.observacoes || '')
    setPriority(draftDemand.prioridade || 'media')
    setRequesterId(String(draftDemand.solicitante_id || ''))
    demandIdRef.current = draftDemand.id
    onDirtyChange?.(false)
  }, [draftDemand, onDirtyChange])

  useEffect(() => {
    if (companyId) onCompanyChange?.(companyId)
  }, [companyId, onCompanyChange])

  useEffect(() => {
    if (!companyId) {
      setCostCenters([])
      return
    }
    const controller = new AbortController()
    setCostCentersLoading(true)
    void fetch(`/api/cost-centers?companyId=${encodeURIComponent(companyId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload?.ok !== true) throw new Error('Falha ao carregar centros de custo.')
        const next = (Array.isArray(payload.items) ? payload.items : []).flatMap((item: any): CostCenterOption[] => {
          const id = String(item?.projectionId || item?.projection_id || item?.companyCostCenterId || '')
          const code = String(item?.code || '').trim()
          if (!id || !code || item?.isActive === false) return []
          return [{ id, code, name: String(item?.name || code) }]
        })
        setCostCenters(next)
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setCostCenters([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setCostCentersLoading(false)
      })
    return () => controller.abort()
  }, [companyId])

  useEffect(() => {
    if (editingItem || draftMode || !agencyAssisted || !companyId) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setRequesterLoading(true)
      setRequesterError('')
      void listCompanyPortalAgencyDemandOptions(companyId, {
        participant: 'requesters',
        requesterQ: requesterSearch.trim() || undefined,
        limit: 50,
      })
        .then((result) => {
          if (!controller.signal.aborted) setRequesters(result.requesters)
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          setRequesters([])
          setRequesterError(error instanceof Error ? error.message : 'Não foi possível buscar solicitantes.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setRequesterLoading(false)
        })
    }, requesterSearch.trim() ? 250 : 0)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [agencyAssisted, companyId, draftMode, editingItem, requesterSearch])

  useEffect(() => {
    if (editingItem || draftMode || internalUser || !companyId) {
      setSelfRequester(null)
      return
    }
    const controller = new AbortController()
    setRequesterLoading(true)
    setRequesterError('')
    void fetch(`/api/me/requester-profile?companyId=${encodeURIComponent(companyId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload?.ok !== true) {
          throw new Error(String(payload?.error || 'Não foi possível validar o solicitante deste acesso.'))
        }
        const profile = payload.profile
        setSelfRequester(profile && typeof profile.id === 'string'
          ? {
              id: String(profile.id),
              name: String(profile.name || profile.id),
              email: String(profile.email || ''),
              hasActivePortalAccess: profile.hasActivePortalAccess === true,
            }
          : null)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setSelfRequester(null)
        setRequesterError(error instanceof Error ? error.message : 'Não foi possível validar o solicitante.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setRequesterLoading(false)
      })
    return () => controller.abort()
  }, [companyId, draftMode, editingItem, internalUser])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !companyId || !company) return toast.error('Selecione uma empresa válida.')
    if (!selectedRequester?.id) {
      return toast.error(internalUser
        ? 'Selecione o solicitante responsável pela escolha da cotação.'
        : 'Seu acesso não está vinculado a um cadastro de solicitante nesta empresa.')
    }
    if (!editingItem && internalUser && !selectedRequester.hasActivePortalAccess) {
      return toast.error('O solicitante selecionado precisa ter acesso ativo ao portal.')
    }

    const parsed = hotelDemandDetailsSchema.safeParse(details)
    if (!parsed.success) {
      return toast.error(parsed.error.issues[0]?.message || 'Revise os dados da hospedagem e dos hóspedes.')
    }
    const normalizedDetails = normalizedHotelDetails(parsed.data)
    const primaryGuest = hotelDemandPrimaryGuest(parsed.data)
    if (!primaryGuest?.name) return toast.error('Informe o hóspede responsável pela hospedagem.')

    if (editingItem) {
      const reason = normalizeHotelRequestCorrectionReason(correctionReason)
      if (!reason) {
        return toast.error(`Explique a correção em pelo menos ${HOTEL_REQUEST_CORRECTION_REASON_MIN_LENGTH} caracteres e duas palavras.`)
      }
      const correctionValues = {
        details: normalizedDetails,
        paymentMethod,
        costCenterId,
        costCenterCode,
        observations,
        priority,
      }
      const fingerprint = JSON.stringify({
        version: editingItem.version,
        reason,
        correctionValues,
      })
      if (correctionAttemptRef.current?.fingerprint !== fingerprint) {
        correctionAttemptRef.current = {
          fingerprint,
          idempotencyKey: `demand:hotel-request-correction:${editingItem.id}:${editingItem.version}:${createEntityId('idem')}`,
          demand: buildHotelRequestCorrectionDemand(editingItem, correctionValues, new Date().toISOString()),
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
        toast.success(`Pedido ${result.item.demandNumber || result.item.id} corrigido e reenviado para o fluxo.`)
        onUpdated(result.item)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a correção do pedido.')
      } finally {
        setSaving(false)
      }
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
      funcionario_id: primaryGuest.employee_id || null,
      passageiro_nome: primaryGuest.name.trim(),
      tipo_servico: 'Hotel',
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
      detalhes_hotel: normalizedDetails,
      created_at: now,
    }

    setSaving(true)
    try {
      if (onSaveDraftItem) {
        const { agente_user_id: internalAgentUserId, ...corporateDraft } = demand
        void internalAgentUserId
        await onSaveDraftItem(corporateDraft)
        onDirtyChange?.(false)
        toast.success(draftItem ? 'Hotel atualizado no Pedido.' : 'Hotel salvo e adicionado ao Pedido.')
        return
      }
      const result = await createCompanyPortalDemand(demand, demandScope)
      demandIdRef.current = createEntityId('at')
      toast.success(`Pedido ${result.demand.serial_os || result.demand.id} enviado para cotação offline.`)
      onCreated(result.demand)
    } catch (error) {
      if (draftMode) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o Hotel no Pedido.')
        return
      }
      if (
        onCreated
        && error instanceof CompanyPortalDemandClientError
        && ['REQUEST_TIMEOUT', 'NETWORK_ERROR'].includes(error.code || '')
      ) {
        try {
          const recovered = await getCompanyPortalDemand(demand.id, demandScope)
          demandIdRef.current = createEntityId('at')
          toast.success(`Pedido ${recovered.demandNumber || recovered.id} confirmado pelo servidor.`)
          onCreated(recovered.demand)
          return
        } catch {
          // Preserve the id so a retry remains idempotent.
        }
      }
      toast.error(error instanceof Error ? error.message : 'Não foi possível enviar o pedido.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      onChange={() => draftMode && onDirtyChange?.(true)}
      onInput={() => draftMode && onDirtyChange?.(true)}
      className="space-y-5"
      data-company-portal-hotel-form
      data-travel-order-item-form={draftMode ? 'hotel' : undefined}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="bbt-section-label">
            {editingItem
              ? `Pedido ${editingItem.demandNumber} · correção autorizada`
              : (draftMode ? `Pedido ${travelOrderNumber} · rascunho privado` : 'Portal Empresa · canal offline')}
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-bbt-primary dark:text-white">
            <Hotel className="h-6 w-6 text-bbt-accent" />
            {editingItem
              ? 'Corrigir solicitação de hospedagem'
              : (draftMode ? (draftItem ? 'Editar Hotel do Pedido' : 'Adicionar Hotel ao Pedido') : 'Nova solicitação de hospedagem')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {editingItem
              ? 'Revise o pedido devolvido, explique a correção e reenvie-o ao fluxo.'
              : (draftMode
                  ? 'Salve este serviço no Pedido. A agência só receberá os serviços quando você enviar o Pedido completo.'
                  : 'Destino, quartos, hóspedes, preferências e dados administrativos seguem juntos para a agência.')}
          </p>
        </div>
        <button type="button" onClick={onCancel} className="bbt-button-ghost">
          {draftMode ? 'Voltar ao resumo' : 'Voltar às demandas'}
        </button>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bbt-card p-4 sm:p-6">
          <HotelDemandConfigurator
            companyId={companyId}
            value={details}
            onChange={updateDetails}
            disabled={saving}
            showGuests={false}
            showPreferredHotelSelector={false}
            showAccessibility={false}
          />
          <HotelTariffSearchPanel
            companyId={companyId}
            scopeType={demandScope.scopeType}
            scopeId={demandScope.scopeId}
            value={details}
            onChange={updateDetails}
            disabled={saving}
          />
        </div>

        <aside className="space-y-3 xl:sticky xl:top-4">
          <Accordion
            title="Quartos e hóspedes"
            icon={UsersRound}
            summary={guestsComplete ? `${roomCount} quarto(s) · ${guestCount} hóspede(s)` : 'Dados pendentes'}
            complete={guestsComplete}
            defaultOpen
          >
            <HotelRoomsSidebarEditor
              companyId={companyId}
              value={details}
              onChange={updateDetails}
              disabled={saving}
            />
          </Accordion>

          <Accordion
            title="Dados adm./financeiros"
            icon={WalletCards}
            summary={administrativeComplete ? 'Completo' : 'Pendente'}
            complete={administrativeComplete}
          >
            <div className="space-y-3">
              {editingItem && (
                <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bbt-accent" aria-hidden="true" />
                  <span>Empresa e solicitante são preservados durante a correção.</span>
                </div>
              )}
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="mb-1 flex items-center gap-2"><Building2 className="h-3.5 w-3.5" />Empresa a cobrar</span>
                {companies.length > 1 && !editingItem && !draftMode ? (
                  <select className="bbt-input" value={companyId} onChange={(event) => setCompanyId(event.target.value)} disabled={saving}>
                    {companies.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.nome}</option>)}
                  </select>
                ) : (
                  <input className="bbt-input" value={company?.nome || editingItem?.companyName || ''} disabled />
                )}
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="mb-1 flex items-center gap-2">Centro de custo {costCentersLoading && <Loader2 className="h-3 w-3 animate-spin" />}</span>
                <select
                  className="bbt-input"
                  value={costCenterId || ''}
                  disabled={saving || costCentersLoading}
                  onChange={(event) => {
                    const selected = costCenters.find((item) => item.id === event.target.value)
                    setCostCenterId(selected?.id || null)
                    setCostCenterCode(selected?.code || '')
                  }}
                >
                  <option value="">Sem centro de custo</option>
                  {costCenterId && !costCenters.some((item) => item.id === costCenterId) && (
                    <option value={costCenterId}>{costCenterCode || 'Centro de custo atual'} · atual</option>
                  )}
                  {costCenters.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="mb-1 block">Forma de pagamento</span>
                <select className="bbt-input" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as FormaPagamento)} disabled={saving}>
                  <option value="IV">Faturado</option>
                  <option value="PX">Pix</option>
                  <option value="CP">Cartão próprio</option>
                  <option value="CC">Cartão corporativo</option>
                </select>
              </label>
            </div>
          </Accordion>

          <Accordion
            title="Dados gerais"
            icon={AlertCircle}
            summary={generalComplete ? 'Solicitante identificado' : 'Solicitante pendente'}
            complete={generalComplete}
            defaultOpen={Boolean(editingItem) || internalUser}
          >
            <div className="space-y-3">
              {editingItem || draftMode ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-3.5 w-3.5" />Solicitante fixo</div>
                  <div className="mt-1">{selectedRequester?.name || 'Solicitante não identificado'}</div>
                </div>
              ) : internalUser ? (
                <>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <span className="mb-1 block">Buscar solicitante</span>
                    <input className="bbt-input" value={requesterSearch} onChange={(event) => setRequesterSearch(event.target.value)} placeholder="Nome ou e-mail" disabled={saving} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <span className="mb-1 flex items-center gap-2">Solicitante * {requesterLoading && <Loader2 className="h-3 w-3 animate-spin" />}</span>
                    <select className="bbt-input" value={requesterId} onChange={(event) => setRequesterId(event.target.value)} disabled={saving || requesterLoading}>
                      <option value="">Selecione quem fará a escolha</option>
                      {requesters.map((requester) => (
                        <option key={requester.id} value={requester.id} disabled={!requester.hasActivePortalAccess}>
                          {requester.name}{requester.hasActivePortalAccess ? '' : ' · sem acesso ao portal'}
                        </option>
                      ))}
                    </select>
                  </label>
                  {requesterError && <p className="text-xs text-red-600" role="alert">{requesterError}</p>}
                </>
              ) : (
                <div className={`rounded-lg border p-3 text-xs ${selfRequester ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  <div className="flex items-center gap-2 font-semibold">Solicitante {requesterLoading && <Loader2 className="h-3 w-3 animate-spin" />}</div>
                  <div className="mt-1">{selfRequester?.name || 'Cadastro de solicitante não localizado para este acesso.'}</div>
                  {requesterError && <div className="mt-1" role="alert">{requesterError}</div>}
                </div>
              )}
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="mb-1 block">Prioridade</span>
                <select className="bbt-input" value={priority} onChange={(event) => setPriority(event.target.value as Prioridade)} disabled={saving}>
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                  <option value="urgente">Urgente</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="mb-1 block">Acessibilidade e preferências gerais</span>
                <textarea
                  className="bbt-input min-h-24 resize-y"
                  value={details.accessibility_notes || ''}
                  onChange={(event) => updateDetails((current) => ({ ...current, accessibility_notes: event.target.value }))}
                  disabled={saving}
                  placeholder="Mobilidade, alergias, necessidades especiais ou preferências relevantes"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="mb-1 block">Observações para a agência</span>
                <textarea className="bbt-input min-h-28 resize-y" value={observations} onChange={(event) => setObservations(event.target.value)} maxLength={4000} disabled={saving} placeholder="Preferências, restrições e contexto do pedido" />
              </label>
              {editingItem && (
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span className="mb-1 block">Motivo da correção *</span>
                  <textarea
                    className="bbt-input min-h-24 resize-y"
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                    minLength={HOTEL_REQUEST_CORRECTION_REASON_MIN_LENGTH}
                    maxLength={1000}
                    required
                    disabled={saving}
                    data-hotel-correction-reason
                    placeholder="Ex.: Ajustei o período conforme orientação do aprovador."
                  />
                  <span className="mt-1 block font-normal text-slate-500">O motivo ficará no histórico auditável do pedido.</span>
                </label>
              )}
            </div>
          </Accordion>
        </aside>
      </div>

      <footer className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bbt-gray-100 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <BedDouble className="h-4 w-4 text-bbt-accent" />
          Canal <strong className="text-bbt-primary dark:text-white">Offline</strong> · {editingItem
            ? 'a correção substituirá as cotações anteriores e reiniciará a etapa adequada.'
            : (draftMode ? 'rascunho privado; ainda não enviado à agência.' : 'o tarifário e os hotéis preferenciais apoiarão a cotação do consultor.')}
        </div>
        <button type="submit" className="bbt-button-primary min-w-56" disabled={saving || !companies.length}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {saving
            ? (editingItem ? 'Salvando correção...' : (draftMode ? 'Salvando no Pedido...' : 'Enviando pedido...'))
            : (editingItem
                ? 'Salvar correção e reenviar'
                : (draftMode ? (draftItem ? 'Salvar alterações no pedido' : 'Salvar e adicionar ao pedido') : 'Enviar para cotação da agência'))}
        </button>
      </footer>
    </form>
  )
}

interface HotelRoomsSidebarEditorProps {
  companyId: string
  value: DetalhesHotel
  onChange: React.Dispatch<React.SetStateAction<DetalhesHotel>>
  disabled: boolean
}

function HotelRoomsSidebarEditor({
  companyId,
  value,
  onChange,
  disabled,
}: HotelRoomsSidebarEditorProps) {
  const rooms = useMemo(() => value.rooms?.length ? value.rooms : [], [value.rooms])
  const selectedEmployeeIds = useMemo(
    () => new Set(rooms.flatMap((room) => room.guests).flatMap((guest) => guest.employee_id ? [guest.employee_id] : [])),
    [rooms],
  )
  const travelerManagement = useHotelTravelerManagementCapabilities(companyId)
  const guestCount = rooms.reduce((total, room) => total + room.guests.length, 0)

  useEffect(() => {
    if (rooms.length) return
    onChange((current) => current.rooms?.length
      ? current
      : hotelDetailsWithRooms(current, [createEmptyHotelRoom()]))
  }, [onChange, rooms.length])

  function setRooms(nextRooms: HotelDemandRoom[]) {
    onChange((current) => hotelDetailsWithRooms(current, nextRooms))
  }

  function patchRoom(clientId: string, updater: (room: HotelDemandRoom) => HotelDemandRoom) {
    setRooms(rooms.map((room) => room.client_id === clientId ? updater(room) : room))
  }

  function changeRoomCount(nextCount: number) {
    if (
      nextCount < rooms.length
      && rooms.slice(nextCount).some(roomHasFilledData)
      && !window.confirm('Reduzir a quantidade removerá hóspedes e observações dos últimos quartos. Continuar?')
    ) return
    setRooms(resizeHotelDemandRooms(rooms, nextCount))
  }

  function changeRoomOccupancy(clientId: string, occupancyCode: HotelOccupancyCode) {
    const room = rooms.find((candidate) => candidate.client_id === clientId)
    if (!room || room.occupancy_code === occupancyCode) return

    const nextGuests = guestsCompatibleWithOccupancy(room.guests, occupancyCode)
    const removedGuestCount = room.guests.length - nextGuests.length
    const clearsHotelPreferences = hotelDemandPreferredHotelIds(value).length > 0
    if (removedGuestCount > 0 || clearsHotelPreferences) {
      const consequences = [
        removedGuestCount > 0
          ? (removedGuestCount === 1
              ? '1 hospede incompativel sera removido'
              : `${removedGuestCount} hospedes incompativeis serao removidos`)
          : null,
        clearsHotelPreferences ? 'as preferencias do tarifario serao limpas para uma nova busca' : null,
      ].filter(Boolean).join(' e ')
      if (!window.confirm(`Alterar a ocupacao: ${consequences}. Continuar?`)) return
    }

    onChange((current) => {
      const nextRooms = (current.rooms || rooms).map((candidate) => candidate.client_id === clientId
        ? { ...candidate, occupancy_code: occupancyCode, guests: nextGuests }
        : candidate)
      const next = hotelDetailsWithRooms(current, nextRooms)
      if (!clearsHotelPreferences) return next
      const preferences = { ...(next.preferences || {}) }
      delete preferences.hotelTariffReference
      return {
        ...next,
        ...preferredHotelPatch([]),
        preferences,
      }
    })
  }

  return (
    <div className="space-y-3" data-company-portal-hotel-sidebar-rooms>
      <div className="rounded-lg bg-bbt-accent/5 p-3 text-xs leading-5 text-slate-600 dark:bg-bbt-accent/10 dark:text-slate-300">
        Defina a ocupação e vincule cada hóspede antes de enviar o pedido à agência.
      </div>

      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span className="mb-1 block">Quantidade de quartos</span>
          <select
            className="bbt-input"
            value={Math.max(1, rooms.length)}
            disabled={disabled}
            onChange={(event) => changeRoomCount(Number(event.target.value))}
            aria-label="Quantidade de quartos"
          >
            {Array.from({ length: 30 }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="bbt-button-ghost h-10 shrink-0 px-3"
          disabled={disabled || rooms.length >= 30}
          onClick={() => setRooms([...rooms, createEmptyHotelRoom()])}
          aria-label="Adicionar quarto"
          title="Adicionar quarto"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs text-slate-500" aria-live="polite">
        {rooms.length} quarto{rooms.length === 1 ? '' : 's'} · {guestCount} hóspede{guestCount === 1 ? '' : 's'}
      </p>

      <div className="space-y-2">
        {rooms.map((room, roomIndex) => {
          const occupancy = HOTEL_OCCUPANCIES[room.occupancy_code]
          return (
            <details
              key={room.client_id}
              className="group/room overflow-visible rounded-lg border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/30"
              open={roomIndex === 0 || undefined}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 [&::-webkit-details-marker]:hidden">
                <BedDouble className="h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-bbt-primary dark:text-white">Quarto {roomIndex + 1}</span>
                  <span className="block truncate text-[11px] text-slate-500">{occupancy.label}</span>
                </span>
                <ChevronDown className="h-4 w-4 text-slate-400 transition group-open/room:rotate-180" aria-hidden="true" />
              </summary>

              <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <span className="mb-1 block">Tipo de acomodação / ocupação</span>
                    <select
                      value={room.occupancy_code}
                      disabled={disabled}
                      onChange={(event) => changeRoomOccupancy(
                        room.client_id,
                        event.target.value as HotelOccupancyCode,
                      )}
                      className="bbt-input"
                      aria-label={`Ocupação do quarto ${roomIndex + 1}`}
                    >
                      {Object.entries(HOTEL_OCCUPANCIES).map(([code, option]) => (
                        <option key={code} value={code}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  {rooms.length > 1 && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (
                          roomHasFilledData(room)
                          && !window.confirm(`Remover o quarto ${roomIndex + 1} e seus hóspedes?`)
                        ) return
                        setRooms(rooms.filter((candidate) => candidate.client_id !== room.client_id))
                      }}
                      className="mb-0.5 rounded-lg p-2 text-red-600 transition hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/30"
                      title={`Remover quarto ${roomIndex + 1}`}
                      aria-label={`Remover quarto ${roomIndex + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {occupancy.slots.map((slot) => {
                  const guest = room.guests.find((candidate) => candidate.slot_index === slot.index)
                  return (
                    <HotelTravelerSlotPicker
                      key={slot.index}
                      companyId={companyId}
                      label={`${slot.label}${slot.required ? ' *' : ' (opcional)'}`}
                      allowsExternal={slot.allowsExternal}
                      required={slot.required}
                      role={slot.role}
                      slotIndex={slot.index}
                      value={guest}
                      disabled={disabled || !companyId}
                      excludedEmployeeIds={selectedEmployeeIds}
                      capabilities={travelerManagement}
                      surface="subtle"
                      onChange={(nextGuest) => patchRoom(room.client_id, (current) => ({
                        ...current,
                        guests: [
                          ...current.guests.filter((candidate) => candidate.slot_index !== slot.index),
                          ...(nextGuest ? [nextGuest] : []),
                        ].sort((left, right) => left.slot_index - right.slot_index),
                      }))}
                    />
                  )
                })}

                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span className="mb-1 block">Observações do quarto</span>
                  <input
                    value={room.notes || ''}
                    disabled={disabled}
                    onChange={(event) => patchRoom(room.client_id, (current) => ({ ...current, notes: event.target.value }))}
                    className="bbt-input"
                    placeholder="Ex.: camas separadas, berço, andar baixo"
                  />
                </label>
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function normalizedHotelDetails(details: HotelDemandDetailsInput): DetalhesHotel {
  const guests = details.rooms.flatMap((room) => room.guests)
  return {
    ...details,
    num_hospedes: guests.length,
    tipo_apto: legacyRoomType(details.rooms[0]),
    noites: nightsBetween(details.data_checkin, details.data_checkout),
    needs_review: false,
  }
}

function guestsCompatibleWithOccupancy(
  guests: HotelDemandGuest[],
  occupancyCode: HotelOccupancyCode,
): HotelDemandGuest[] {
  const slots = HOTEL_OCCUPANCIES[occupancyCode].slots
  return guests.filter((guest) => {
    const slot = slots.find((candidate) => candidate.index === guest.slot_index)
    return Boolean(slot)
      && slot?.role === guest.role
      && (!guest.is_external || slot.allowsExternal)
  })
}

function legacyRoomType(room: HotelDemandRoom | undefined): 'SGL' | 'DBL' | 'TPL' {
  if (!room || room.occupancy_code === 'single') return 'SGL'
  if (room.occupancy_code === 'triple') return 'TPL'
  return 'DBL'
}

function roomHasFilledData(room: HotelDemandRoom): boolean {
  return room.guests.length > 0 || Boolean(room.notes?.trim())
}

function Accordion({
  title,
  icon: Icon,
  summary,
  complete,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: typeof Hotel
  summary: string
  complete: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="group overflow-visible rounded-xl border border-bbt-gray-100 bg-white dark:border-slate-700 dark:bg-slate-900" open={defaultOpen || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bbt-accent/10 text-bbt-accent"><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-bbt-primary dark:text-white">{title}</span>
          <span className="block truncate text-xs text-slate-500">{summary}</span>
        </span>
        {complete && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Seção completa" />}
        <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-bbt-gray-100 p-4 dark:border-slate-700">{children}</div>
    </details>
  )
}

export default HotelOfflineRequestForm

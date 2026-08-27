'use client'

import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  LockKeyhole,
  Loader2,
  Plane,
  Send,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import { AirDemandConfigurator } from '@/components/travel/air-demand-configurator'
import { AirDemandPassengers } from '@/components/travel/air-demand-passengers'
import {
  airPassengerProfileIssueLabel,
  airPassengersFromDetails,
  withAirPassengers,
  type AirPassengerValidationState,
} from '@/lib/air-demand/passenger-selection'
import {
  type AgencyDemandRequesterOption,
  listCompanyPortalAgencyDemandOptions,
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
import { createEntityId } from '@/lib/ids'
import { userAccessKind } from '@/lib/user-access-kind'
import { detalhesAereoSchema } from '@/lib/validators'
import type {
  Atendimento,
  DetalhesAereo,
  Empresa,
  FormaPagamento,
  Prioridade,
} from '@/types'
import {
  AIR_REQUEST_CORRECTION_REASON_MIN_LENGTH,
  airRequestCorrectionInitialValues,
  buildAirRequestCorrectionDemand,
  normalizeAirRequestCorrectionReason,
} from './air-request-correction-contract'

interface AirOfflineRequestFormBaseProps {
  companies: Empresa[]
  initialCompanyId?: string
  onCancel: () => void
  onCompanyChange?: (companyId: string) => void
}

export type AirOfflineRequestFormProps = AirOfflineRequestFormBaseProps & (
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

const INITIAL_AIR_DETAILS: DetalhesAereo = {
  trip_type: 'one_way',
  classe: 'Econômica',
  baggage_pieces: 0,
  trechos: [{
    sequence: 1,
    direction: 'outbound',
    origin: '',
    destination: '',
    departure_date: '',
  }],
}

const EMPTY_PASSENGER_VALIDATION: AirPassengerValidationState = {
  passengerCount: 0,
  blockingIssues: [],
  pendingVerificationIds: [],
  lookupErrors: [],
}

export function AirOfflineRequestForm({
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
}: AirOfflineRequestFormProps) {
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
    ? airRequestCorrectionInitialValues(editingItem)
    : null
  const [companyId, setCompanyId] = useState(() => (
    correctionInitial?.companyId
    || draftDemand?.empresa_id
    || (initialCompanyId && companies.some((company) => company.id === initialCompanyId)
      ? initialCompanyId
      : companies[0]?.id || '')
  ))
  const company = companies.find((candidate) => candidate.id === companyId) || null
  const [details, setDetails] = useState<DetalhesAereo>(() => correctionInitial?.details || draftDemand?.detalhes_aereo || INITIAL_AIR_DETAILS)
  const [passengerValidation, setPassengerValidation] = useState<AirPassengerValidationState>(EMPTY_PASSENGER_VALIDATION)
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
  const updateDetails = useCallback<React.Dispatch<React.SetStateAction<DetalhesAereo>>>((next) => {
    setDetails(next)
    if (draftMode) onDirtyChange?.(true)
  }, [draftMode, onDirtyChange])

  const passengers = useMemo(() => airPassengersFromDetails(details), [details])
  const selectedRequester = useMemo<RequesterChoice | null>(() => {
    if (editingItem) {
      const requesterId = String(editingItem.demand.solicitante_id || '')
      return requesterId
        ? {
            id: requesterId,
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
  const travelersComplete = passengers.length > 0
    && passengerValidation.pendingVerificationIds.length === 0
    && passengerValidation.blockingIssues.length === 0
    && passengerValidation.lookupErrors.length === 0
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
    setDetails(INITIAL_AIR_DETAILS)
    setPassengerValidation(EMPTY_PASSENGER_VALIDATION)
    setRequesterId('')
    setRequesterSearch('')
    setRequesters([])
    setRequesterError('')
    setCostCenterId(company?.centro_custo_padrao_id || null)
    setCostCenterCode(company?.centro_custo_padrao || '')
  }, [company?.centro_custo_padrao, company?.centro_custo_padrao_id, companyId, draftItem, editingItem])

  useEffect(() => {
    if (!editingItem) return
    const initial = airRequestCorrectionInitialValues(editingItem)
    setCompanyId(initial.companyId)
    setDetails(initial.details)
    setPassengerValidation(EMPTY_PASSENGER_VALIDATION)
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
    setDetails(draftDemand.detalhes_aereo || INITIAL_AIR_DETAILS)
    setPassengerValidation(EMPTY_PASSENGER_VALIDATION)
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

  function setPassengers(next: ReturnType<typeof airPassengersFromDetails>) {
    updateDetails((current) => withAirPassengers(
      current as DetalhesAereo & Record<string, unknown>,
      next,
    ))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !companyId || !company) return toast.error('Selecione uma empresa válida.')
    if (!selectedRequester?.id) {
      return toast.error(internalUser
        ? 'Selecione o solicitante responsável pela escolha da cotação.'
        : 'Seu acesso não está vinculado a um cadastro de solicitante nesta empresa.')
    }
    if (!editingItem && internalUser && selectedRequester && !selectedRequester.hasActivePortalAccess) {
      return toast.error('O solicitante selecionado precisa ter acesso ativo ao portal.')
    }
    if (!passengers.length) return toast.error('Adicione ao menos um passageiro.')
    if (passengerValidation.pendingVerificationIds.length) {
      return toast.error('Aguarde a conferência cadastral dos passageiros.')
    }
    if (passengerValidation.blockingIssues.length) {
      const issue = passengerValidation.blockingIssues[0]
      return toast.error(`Complete o cadastro de ${issue.name}: ${issue.issues.map(airPassengerProfileIssueLabel).join(', ')}.`)
    }
    if (passengerValidation.lookupErrors.length) {
      return toast.error(passengerValidation.lookupErrors[0].message)
    }
    const parsed = detalhesAereoSchema.safeParse(details)
    if (!parsed.success || !parsed.data.trechos?.length) {
      return toast.error(parsed.success
        ? 'Informe ao menos um trecho completo.'
        : parsed.error.issues[0]?.message || 'Revise os dados do itinerário.')
    }

    const primaryPassenger = passengers[0]
    const primaryPassengerName = String(primaryPassenger.name || '').trim()
    if (!primaryPassengerName) return toast.error('O passageiro principal está sem nome completo.')
    if (editingItem) {
      const reason = normalizeAirRequestCorrectionReason(correctionReason)
      if (!reason) {
        return toast.error(`Explique a correção em pelo menos ${AIR_REQUEST_CORRECTION_REASON_MIN_LENGTH} caracteres e duas palavras.`)
      }
      const correctionValues = {
        details: withAirPassengers(
          {
            ...details,
            ...parsed.data,
            trechos: parsed.data.trechos,
          } as DetalhesAereo & Record<string, unknown>,
          passengers,
        ),
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
          idempotencyKey: `demand:request-correction:${editingItem.id}:${editingItem.version}:${createEntityId('idem')}`,
          demand: buildAirRequestCorrectionDemand(
            editingItem,
            correctionValues,
            new Date().toISOString(),
          ),
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
      funcionario_id: primaryPassenger.employee_id,
      passageiro_nome: primaryPassengerName,
      tipo_servico: 'Aéreo',
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
      detalhes_aereo: withAirPassengers(
        parsed.data as DetalhesAereo & Record<string, unknown>,
        passengers,
      ),
      created_at: now,
    }

    setSaving(true)
    try {
      if (onSaveDraftItem) {
        const { agente_user_id: internalAgentUserId, ...corporateDraft } = demand
        void internalAgentUserId
        await onSaveDraftItem(corporateDraft)
        onDirtyChange?.(false)
        toast.success(draftItem ? 'Aéreo atualizado no Pedido.' : 'Aéreo salvo e adicionado ao Pedido.')
        return
      }
      const result = await createCompanyPortalDemand(demand, demandScope)
      demandIdRef.current = createEntityId('at')
      toast.success(`Pedido ${result.demand.serial_os || result.demand.id} enviado para cotação offline.`)
      onCreated(result.demand)
    } catch (error) {
      if (draftMode) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o Aéreo no Pedido.')
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
          // Preserve the draft id so the next attempt remains idempotent.
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
      data-company-portal-air-form
      data-travel-order-item-form={draftMode ? 'air' : undefined}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="bbt-section-label">
            {editingItem
              ? `Pedido ${editingItem.demandNumber} · correção autorizada`
              : (draftMode ? `Pedido ${travelOrderNumber} · rascunho privado` : 'Laboratório · portal offline')}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-bbt-primary dark:text-white">
            {editingItem
              ? 'Corrigir solicitação aérea'
              : (draftMode ? (draftItem ? 'Editar Aéreo do Pedido' : 'Adicionar Aéreo ao Pedido') : 'Nova solicitação aérea')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {editingItem
              ? 'Revise o pedido rejeitado, informe o motivo da correção e reenvie-o ao fluxo.'
              : (draftMode
                  ? 'Salve este serviço no Pedido. A agência só receberá os serviços quando você enviar o Pedido completo.'
                  : 'Preencha o pedido uma vez e envie todas as informações para a cotação da agência.')}
          </p>
        </div>
        <button type="button" onClick={onCancel} className="bbt-button-ghost">
          {draftMode ? 'Voltar ao resumo' : 'Voltar às demandas'}
        </button>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bbt-card p-4 sm:p-6">
          {editingItem ? (
            <div className="mb-5 flex max-w-md items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-bbt-accent" aria-hidden="true" />
              <div>
                <strong className="block text-bbt-primary dark:text-white">Empresa e solicitante preservados</strong>
                <span>{company?.nome || editingItem.companyName} · {selectedRequester?.name || 'Solicitante do pedido'}</span>
              </div>
            </div>
          ) : companies.length > 1 && !draftMode && (
            <label className="mb-5 block max-w-md text-xs font-semibold text-slate-600 dark:text-slate-300">
              <span className="mb-1.5 flex items-center gap-2"><Building2 className="h-4 w-4" />Empresa</span>
              <select className="bbt-input" value={companyId} onChange={(event) => setCompanyId(event.target.value)} disabled={saving}>
                {companies.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.nome}</option>)}
              </select>
            </label>
          )}
          <AirDemandConfigurator
            value={details}
            onChange={updateDetails}
            companyId={companyId}
            showPassengers={false}
            disabled={saving}
          />
        </div>

        <aside className="space-y-3 xl:sticky xl:top-4">
          <Accordion
            title="Viajantes"
            icon={UsersRound}
            summary={travelersComplete ? `${passengers.length} selecionado(s)` : 'Seleção pendente'}
            complete={travelersComplete}
            defaultOpen
          >
            <AirDemandPassengers
              companyId={companyId}
              value={passengers}
              onChange={setPassengers}
              onValidationChange={setPassengerValidation}
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
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="mb-1 block">Faturar para</span>
                <input className="bbt-input" value={company?.nome || ''} disabled />
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
                  <div className="flex items-center gap-2 font-semibold">
                    <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Solicitante fixo
                  </div>
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
                  <div className="flex items-center gap-2 font-semibold">
                    Solicitante {requesterLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  </div>
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
                    minLength={AIR_REQUEST_CORRECTION_REASON_MIN_LENGTH}
                    maxLength={1000}
                    required
                    disabled={saving}
                    data-air-correction-reason
                    placeholder="Ex.: Ajustei a data de ida conforme orientação do aprovador."
                  />
                  <span className="mt-1 block font-normal text-slate-500">
                    Explique objetivamente o que mudou; o motivo ficará no histórico do pedido.
                  </span>
                </label>
              )}
            </div>
          </Accordion>
        </aside>
      </div>

      <footer className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bbt-gray-100 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="text-xs text-slate-500">
          Canal <strong className="text-bbt-primary dark:text-white">Offline</strong> · {editingItem
            ? 'o pedido corrigido retornará automaticamente à etapa adequada.'
            : (draftMode ? 'rascunho privado; ainda não enviado à agência.' : 'a agência publicará as opções para sua escolha.')}
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

function Accordion({
  title,
  icon: Icon,
  summary,
  complete,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: typeof Plane
  summary: string
  complete: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="group overflow-hidden rounded-xl border border-bbt-gray-100 bg-white dark:border-slate-700 dark:bg-slate-900" open={defaultOpen || undefined}>
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

export default AirOfflineRequestForm

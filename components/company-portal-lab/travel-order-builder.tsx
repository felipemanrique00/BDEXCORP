'use client'

import {
  AlertCircle,
  BedDouble,
  BusFront,
  Car,
  CheckCircle2,
  ClipboardList,
  Edit3,
  Loader2,
  LockKeyhole,
  Plane,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import {
  createCompanyPortalTravelOrder,
  CompanyPortalTravelOrderClientError,
  deleteCompanyPortalTravelOrderItem,
  getCompanyPortalTravelOrder,
  getCompanyPortalRequesterSelfProfile,
  submitCompanyPortalTravelOrder,
  upsertCompanyPortalTravelOrderItem,
} from '@/lib/company-portal-lab/travel-order-client'
import type { CorporateDemandSnapshot } from '@/lib/company-portal-lab/demand-projection'
import type {
  CompanyPortalTravelOrder,
  CompanyPortalTravelOrderItem,
  CompanyPortalTravelOrderScope,
  TravelOrderServiceType,
} from '@/lib/company-portal-lab/travel-order'
import { createEntityId } from '@/lib/ids'
import type { Empresa } from '@/types'

import { AirOfflineRequestForm } from './air-offline-request-form'
import { GroundOfflineRequestForm } from './ground-offline-request-form'
import { HotelOfflineRequestForm } from './hotel-offline-request-form'
import {
  canSubmitTravelOrder,
  createOrReuseTravelOrderItemSaveAttempt,
  incompleteTravelOrderItems,
  travelOrderItemSaveWasCommitted,
  travelOrderItemsByService,
  travelOrderNavigationNeedsConfirmation,
  type TravelOrderItemSaveAttempt,
} from './travel-order-builder-state'

type BuilderTab = 'summary' | TravelOrderServiceType

export interface TravelOrderBuilderProps {
  companies: Empresa[]
  initialCompanyId?: string
  initialOrderId?: string
  initialService?: TravelOrderServiceType
  createIntentId?: string
  onCancel: () => void
  onSubmitted: (order: CompanyPortalTravelOrder) => void
  onOrderChange?: (order: CompanyPortalTravelOrder) => void
}

interface MutationAttempt {
  fingerprint: string
  idempotencyKey: string
}

interface PendingOrderCreate {
  identity: string
  promise: Promise<CompanyPortalTravelOrder>
}

const SERVICE_META: Record<TravelOrderServiceType, {
  label: string
  shortLabel: string
  icon: typeof Plane
}> = {
  air: { label: 'Aéreo', shortLabel: 'Aéreo', icon: Plane },
  hotel: { label: 'Hotel', shortLabel: 'Hotel', icon: BedDouble },
  car: { label: 'Locação', shortLabel: 'Locação', icon: Car },
  bus: { label: 'Rodoviário', shortLabel: 'Rodoviário', icon: BusFront },
}

const TRAVEL_ORDER_SERVICES: readonly TravelOrderServiceType[] = ['air', 'hotel', 'car', 'bus']

export function TravelOrderBuilder({
  companies,
  initialCompanyId,
  initialOrderId,
  initialService,
  createIntentId,
  onCancel,
  onSubmitted,
  onOrderChange,
}: TravelOrderBuilderProps) {
  const { portalContext: activePortalContext } = useCompanyPortalContext()
  const scopeType = activePortalContext?.type
  const scopeId = activePortalContext?.id
  const scope = useMemo<CompanyPortalTravelOrderScope>(() => scopeType && scopeId ? {
    scopeType,
    scopeId,
  } : {}, [scopeId, scopeType])
  const scopeFingerprint = `${scopeType || ''}:${scopeId || ''}`
  const companyId = useMemo(() => {
    if (initialCompanyId && companies.some((company) => company.id === initialCompanyId)) {
      return initialCompanyId
    }
    return companies[0]?.id || ''
  }, [companies, initialCompanyId])

  const [order, setOrder] = useState<CompanyPortalTravelOrder | null>(null)
  const [selfRequester, setSelfRequester] = useState<CompanyPortalTravelOrder['requester'] | null>(null)
  const [activeTab, setActiveTab] = useState<BuilderTab>(() => initialService || 'summary')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [deletingItemId, setDeletingItemId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const initialServiceRef = useRef(initialService)
  const loadSequenceRef = useRef(0)
  const orderRef = useRef<CompanyPortalTravelOrder | null>(null)
  const orderIdentityRef = useRef('')
  const selfRequesterIdentityRef = useRef('')
  const currentIdentityRef = useRef('')
  const fallbackCreateIntentRef = useRef('')
  const createAttemptRef = useRef<MutationAttempt | null>(null)
  const createPromiseRef = useRef<PendingOrderCreate | null>(null)
  const saveAttemptRef = useRef<TravelOrderItemSaveAttempt | null>(null)
  const deleteAttemptRef = useRef<MutationAttempt | null>(null)
  const submitAttemptRef = useRef<MutationAttempt | null>(null)
  const onOrderChangeRef = useRef(onOrderChange)

  if (!fallbackCreateIntentRef.current) fallbackCreateIntentRef.current = createEntityId('intent')
  const effectiveCreateIntentId = createIntentId || fallbackCreateIntentRef.current
  const builderIdentity = initialOrderId
    ? `draft:${scopeFingerprint}:${companyId}:${initialOrderId}`
    : `new:${scopeFingerprint}:${companyId}:${effectiveCreateIntentId}`
  currentIdentityRef.current = builderIdentity

  useEffect(() => {
    onOrderChangeRef.current = onOrderChange
  }, [onOrderChange])

  const commitOrder = useCallback((next: CompanyPortalTravelOrder, identity: string): boolean => {
    if (currentIdentityRef.current !== identity) return false
    orderRef.current = next
    orderIdentityRef.current = identity
    setOrder(next)
    onOrderChangeRef.current?.(next)
    return true
  }, [])

  const loadOrder = useCallback(async () => {
    const sequence = ++loadSequenceRef.current
    const identity = builderIdentity
    const isCurrent = () => (
      loadSequenceRef.current === sequence && currentIdentityRef.current === identity
    )
    if (!companyId || !scope.scopeType || !scope.scopeId) {
      orderRef.current = null
      orderIdentityRef.current = ''
      selfRequesterIdentityRef.current = ''
      setOrder(null)
      setSelfRequester(null)
      setLoadError('Selecione uma empresa autorizada para iniciar o Pedido.')
      setLoading(false)
      return
    }

    if (
      initialOrderId
      && orderRef.current?.id === initialOrderId
      && orderIdentityRef.current === identity
    ) {
      setLoadError('')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      if (initialOrderId) {
        const next = await getCompanyPortalTravelOrder(initialOrderId, scope)
        if (!isCurrent()) return
        selfRequesterIdentityRef.current = ''
        setSelfRequester(null)
        commitOrder(next, identity)
        setActiveTab(next.status === 'draft' && next.capabilities.canEdit && initialServiceRef.current
          ? initialServiceRef.current
          : 'summary')
      } else {
        orderRef.current = null
        orderIdentityRef.current = ''
        setOrder(null)
        const requester = await getCompanyPortalRequesterSelfProfile(companyId)
        if (!isCurrent()) return
        if (!requester) {
          throw new Error('Seu usuario precisa estar vinculado como solicitante ativo desta empresa.')
        }
        selfRequesterIdentityRef.current = identity
        setSelfRequester(requester)
        setActiveTab(initialServiceRef.current || 'summary')
      }
      setDirty(false)
    } catch (error) {
      if (!isCurrent()) return
      orderRef.current = null
      orderIdentityRef.current = ''
      selfRequesterIdentityRef.current = ''
      setOrder(null)
      setSelfRequester(null)
      setLoadError(error instanceof Error ? error.message : 'Não foi possível abrir o rascunho do Pedido.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [builderIdentity, commitOrder, companyId, initialOrderId, scope])

  useEffect(() => {
    void loadOrder()
    return () => {
      loadSequenceRef.current += 1
    }
  }, [loadOrder])

  useEffect(() => {
    if (!dirty) return
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventAccidentalExit)
    return () => window.removeEventListener('beforeunload', preventAccidentalExit)
  }, [dirty])

  const identityOrder = orderIdentityRef.current === builderIdentity ? order : null
  const identityRequester = selfRequesterIdentityRef.current === builderIdentity ? selfRequester : null
  const virtualOrder = useMemo<CompanyPortalTravelOrder | null>(() => {
    const company = companies.find((item) => item.id === companyId)
    if (!identityRequester || !company) return null
    return {
      id: `virtual-${effectiveCreateIntentId}`,
      orderNumber: 'a criar',
      companyId,
      companyName: company.nome,
      requester: identityRequester,
      status: 'draft',
      aggregateStatus: 'draft',
      version: 0,
      services: [],
      itemCount: 0,
      items: [],
      capabilities: { canEdit: true, canSubmit: true },
      createdAt: '',
      updatedAt: '',
      submittedAt: null,
    }
  }, [companies, companyId, effectiveCreateIntentId, identityRequester])
  const displayedOrder = identityOrder || virtualOrder
  const itemByService = useMemo(() => travelOrderItemsByService(displayedOrder), [displayedOrder])
  const incompleteItems = useMemo(() => incompleteTravelOrderItems(displayedOrder), [displayedOrder])
  const canSubmit = canSubmitTravelOrder(identityOrder)
  const canEdit = Boolean(displayedOrder && displayedOrder.status === 'draft' && displayedOrder.capabilities.canEdit)

  const ensurePersistedOrder = useCallback(async (): Promise<CompanyPortalTravelOrder> => {
    const identity = builderIdentity
    if (currentIdentityRef.current !== identity) {
      throw new Error('O contexto do Pedido mudou. Revise os dados antes de salvar.')
    }
    if (orderRef.current && orderIdentityRef.current === identity) return orderRef.current
    if (!selfRequester || selfRequesterIdentityRef.current !== identity) {
      throw new Error('Seu usuario precisa estar vinculado como solicitante ativo desta empresa.')
    }
    if (!companyId || !scope.scopeType || !scope.scopeId) {
      throw new Error('Selecione uma empresa autorizada para iniciar o Pedido.')
    }
    if (createPromiseRef.current?.identity === identity) return createPromiseRef.current.promise

    const fingerprint = JSON.stringify({ companyId, scope, createIntentId: effectiveCreateIntentId })
    if (createAttemptRef.current?.fingerprint !== fingerprint) {
      createAttemptRef.current = {
        fingerprint,
        idempotencyKey: `company-portal:travel-order:create:${effectiveCreateIntentId}`,
      }
    }
    const attempt = createAttemptRef.current
    const promise = createCompanyPortalTravelOrder({
      companyId,
      idempotencyKey: attempt.idempotencyKey,
    }, scope).then((created) => {
      if (createAttemptRef.current === attempt) createAttemptRef.current = null
      if (currentIdentityRef.current !== identity) {
        throw new Error('O contexto do Pedido mudou durante a criacao. Tente novamente no contexto atual.')
      }
      orderRef.current = created.order
      orderIdentityRef.current = identity
      return created.order
    })
    createPromiseRef.current = { identity, promise }
    try {
      return await promise
    } finally {
      if (createPromiseRef.current?.identity === identity && createPromiseRef.current.promise === promise) {
        createPromiseRef.current = null
      }
    }
  }, [builderIdentity, companyId, effectiveCreateIntentId, scope, selfRequester])

  const navigateTo = useCallback((next: BuilderTab) => {
    if (next === activeTab) return
    if (next !== 'summary' && (!displayedOrder || displayedOrder.status !== 'draft' || !displayedOrder.capabilities.canEdit)) {
      toast.info('O Pedido está em envio e não aceita mais alterações.')
      return
    }
    if (
      travelOrderNavigationNeedsConfirmation(dirty, activeTab, next)
      && !window.confirm('Há alterações não salvas neste serviço. Deseja descartá-las e trocar de aba?')
    ) return
    setDirty(false)
    setAddMenuOpen(false)
    setActiveTab(next)
  }, [activeTab, dirty, displayedOrder])

  async function saveItem(serviceType: TravelOrderServiceType, demand: CorporateDemandSnapshot) {
    const identity = builderIdentity
    const expectedCompanyId = identityOrder?.companyId || companyId
    if (demand.empresa_id !== expectedCompanyId) {
      throw new Error('A empresa do servico deve ser a mesma empresa do Pedido.')
    }
    const targetOrder = await ensurePersistedOrder()
    if (currentIdentityRef.current !== identity || orderIdentityRef.current !== identity) {
      throw new Error('O contexto do Pedido mudou. Revise os dados antes de salvar.')
    }
    if (targetOrder.status !== 'draft' || !targetOrder.capabilities.canEdit) {
      throw new Error('Este Pedido não está mais disponível para edição.')
    }
    if (demand.empresa_id !== targetOrder.companyId) {
      throw new Error('A empresa do serviço deve ser a mesma empresa do Pedido.')
    }
    const currentItem = targetOrder.items.find((item) => item.serviceType === serviceType)
    const nextIdempotencyKey = !currentItem && targetOrder.itemCount === 0
      ? `company-portal:travel-order:item:${effectiveCreateIntentId}:${serviceType}`
      : `company-portal:travel-order:item:${createEntityId('idem')}`
    const attempt = createOrReuseTravelOrderItemSaveAttempt({
      current: saveAttemptRef.current,
      orderId: targetOrder.id,
      orderVersion: targetOrder.version,
      serviceType,
      item: currentItem,
      demand,
      nextIdempotencyKey,
    })
    saveAttemptRef.current = attempt
    try {
      const result = await upsertCompanyPortalTravelOrderItem(targetOrder.id, {
        itemId: attempt.itemId,
        serviceType,
        demand: attempt.demand,
        expectedVersion: attempt.expectedVersion,
        idempotencyKey: attempt.idempotencyKey,
      }, scope)
      if (currentIdentityRef.current !== identity) {
        throw new Error('O contexto do Pedido mudou durante o salvamento.')
      }
      if (saveAttemptRef.current === attempt) saveAttemptRef.current = null
      if (!commitOrder(result.order, identity)) return
      setDirty(false)
      setActiveTab('summary')
    } catch (error) {
      if (currentIdentityRef.current !== identity) throw error
      if (
        error instanceof CompanyPortalTravelOrderClientError
        && ['REQUEST_TIMEOUT', 'NETWORK_ERROR'].includes(error.code || '')
      ) {
        try {
          const recovered = await getCompanyPortalTravelOrder(targetOrder.id, scope)
          if (
            currentIdentityRef.current === identity
            && travelOrderItemSaveWasCommitted(recovered, serviceType, attempt)
          ) {
            if (saveAttemptRef.current === attempt) saveAttemptRef.current = null
            if (!commitOrder(recovered, identity)) return
            setDirty(false)
            setActiveTab('summary')
            return
          }
        } catch {
          // Preserve the exact payload and key. A second click safely replays this attempt.
        }
      }
      throw error
    }
  }

  async function removeItem(item: CompanyPortalTravelOrderItem) {
    const identity = builderIdentity
    const targetOrder = identityOrder
    if (!targetOrder || !targetOrder.capabilities.canEdit || deletingItemId) return
    if (!window.confirm(`Remover ${SERVICE_META[item.serviceType].label} deste Pedido?`)) return

    const fingerprint = JSON.stringify({
      orderId: targetOrder.id,
      itemId: item.id,
      itemVersion: item.version,
    })
    if (deleteAttemptRef.current?.fingerprint !== fingerprint) {
      deleteAttemptRef.current = {
        fingerprint,
        idempotencyKey: `company-portal:travel-order:item-delete:${createEntityId('idem')}`,
      }
    }
    setDeletingItemId(item.id)
    try {
      const result = await deleteCompanyPortalTravelOrderItem(targetOrder.id, item.id, {
        expectedVersion: item.version,
        idempotencyKey: deleteAttemptRef.current.idempotencyKey,
      }, scope)
      if (currentIdentityRef.current !== identity) return
      deleteAttemptRef.current = null
      commitOrder(result.order, identity)
      toast.success(`${SERVICE_META[item.serviceType].label} removido do Pedido.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível remover o serviço.')
    } finally {
      setDeletingItemId('')
    }
  }

  async function submitOrder() {
    const identity = builderIdentity
    const targetOrder = identityOrder
    if (!targetOrder || !canSubmit || submitting) return
    const fingerprint = JSON.stringify({ orderId: targetOrder.id, version: targetOrder.version })
    if (submitAttemptRef.current?.fingerprint !== fingerprint) {
      submitAttemptRef.current = {
        fingerprint,
        idempotencyKey: `company-portal:travel-order:submit:${createEntityId('idem')}`,
      }
    }

    setSubmitting(true)
    try {
      const result = await submitCompanyPortalTravelOrder(targetOrder.id, {
        expectedVersion: targetOrder.version,
        idempotencyKey: submitAttemptRef.current.idempotencyKey,
      }, scope)
      if (currentIdentityRef.current !== identity) return
      submitAttemptRef.current = null
      commitOrder(result.order, identity)
      if (result.order.status === 'submitted') {
        toast.success(`Pedido ${result.order.orderNumber} enviado com ${result.order.itemCount} serviço(s).`)
        onSubmitted(result.order)
      } else {
        toast.info(`O envio do Pedido ${result.order.orderNumber} foi iniciado. Use “Continuar envio” para concluir.`)
      }
    } catch (error) {
      try {
        const recovered = await getCompanyPortalTravelOrder(targetOrder.id, scope)
        if (currentIdentityRef.current !== identity) return
        if (recovered.status === 'submitted') {
          submitAttemptRef.current = null
          commitOrder(recovered, identity)
          toast.success(`Pedido ${recovered.orderNumber} confirmado pelo servidor.`)
          onSubmitted(recovered)
          return
        }
        if (recovered.status === 'submitting') {
          submitAttemptRef.current = null
          commitOrder(recovered, identity)
          toast.info(`O Pedido ${recovered.orderNumber} está em envio. Clique em “Continuar envio” para retomar.`)
          return
        }
      } catch {
        // Keep the idempotency key so the same submit can be retried safely.
      }
      toast.error(error instanceof Error ? error.message : 'Não foi possível enviar o Pedido.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="bbt-card flex min-h-64 items-center justify-center gap-3 p-8 text-sm text-slate-500" data-travel-order-loading>
        <Loader2 className="h-5 w-5 animate-spin text-bbt-accent" />
        {initialOrderId ? 'Abrindo rascunho privado do Pedido...' : 'Preparando novo Pedido...'}
      </div>
    )
  }

  if (!displayedOrder || loadError) {
    return (
      <div className="bbt-card mx-auto max-w-xl p-6 text-center" data-travel-order-error>
        <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
        <h1 className="mt-3 text-lg font-bold text-bbt-primary dark:text-white">Não foi possível abrir o Pedido</h1>
        <p className="mt-2 text-sm text-slate-500">{loadError || 'Rascunho não encontrado.'}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="bbt-button-ghost" onClick={onCancel}>Voltar</button>
          <button type="button" className="bbt-button-primary" onClick={() => void loadOrder()}>
            <RefreshCw className="h-4 w-4" />Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  const orderCompany = companies.find((company) => company.id === displayedOrder.companyId)
  const fixedCompanies = orderCompany ? [orderCompany] : companies.filter((company) => company.id === displayedOrder.companyId)
  const virtual = identityOrder === null

  return (
    <section
      className="space-y-4"
      data-company-portal-travel-order-builder
      data-order-id={virtual ? undefined : displayedOrder.id}
      data-order-persisted={virtual ? 'false' : 'true'}
    >
      <header className="bbt-card overflow-visible p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="bbt-section-label">
              {virtual ? 'Novo Pedido · ainda não criado' : `Pedido ${displayedOrder.orderNumber} · rascunho privado`}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-bbt-primary dark:text-white">Monte todos os serviços da viagem</h1>
            <p className="mt-1 text-sm text-slate-500">
              Salve Aéreo, Hotel, Locação e Rodoviário no mesmo Pedido. A agência não verá nada antes do envio final.
            </p>
            {virtual && (
              <p className="mt-2 text-xs font-semibold text-bbt-accent" data-travel-order-lazy-create>
                Nenhum Pedido foi gravado ainda. O rascunho será criado ao salvar o primeiro serviço.
              </p>
            )}
          </div>
          <button type="button" className="bbt-button-ghost" onClick={() => {
            if (dirty && !window.confirm('Sair e descartar as alterações ainda não salvas?')) return
            onCancel()
          }}>Voltar às demandas</button>
        </div>

        <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label="Serviços do Pedido">
          <OrderTab active={activeTab === 'summary'} onClick={() => navigateTo('summary')}>
            <ClipboardList className="h-4 w-4" />Resumo
          </OrderTab>
          {TRAVEL_ORDER_SERVICES.map((serviceType) => {
            const meta = SERVICE_META[serviceType]
            const Icon = meta.icon
            const saved = itemByService.has(serviceType)
            return (
            <OrderTab key={serviceType} active={activeTab === serviceType} disabled={!canEdit} onClick={() => navigateTo(serviceType)}>
                <Icon className="h-4 w-4" />{meta.shortLabel}
                {saved && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-label="Salvo" />}
              </OrderTab>
            )
          })}
          <div className="relative">
            <OrderTab active={false} disabled={!canEdit} onClick={() => setAddMenuOpen((current) => !current)}>
              <Plus className="h-4 w-4" />Adicionar serviço
            </OrderTab>
            {addMenuOpen && (
              <div className="absolute left-0 top-full z-30 mt-2 min-w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {TRAVEL_ORDER_SERVICES.map((serviceType) => {
                  const meta = SERVICE_META[serviceType]
                  const Icon = meta.icon
                  return (
                    <button
                      key={serviceType}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => navigateTo(serviceType)}
                    >
                      <Icon className="h-4 w-4 text-bbt-accent" />
                      {itemByService.has(serviceType) ? `Editar ${meta.label}` : `Adicionar ${meta.label}`}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </nav>
      </header>

      <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bbt-gray-100 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95" data-travel-order-sticky-summary>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <LockKeyhole className="h-4 w-4 shrink-0 text-bbt-accent" />
          <strong className="text-bbt-primary dark:text-white">{virtual ? 'Novo Pedido' : `Pedido ${displayedOrder.orderNumber}`}</strong>
          <span>· {displayedOrder.companyName}</span>
          <span>· {displayedOrder.itemCount} serviço{displayedOrder.itemCount === 1 ? '' : 's'} salvo{displayedOrder.itemCount === 1 ? '' : 's'}</span>
          {dirty && <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">alterações não salvas</span>}
        </div>
        <button type="button" className="bbt-button-ghost h-8 px-3 text-xs" onClick={() => navigateTo('summary')}>
          Revisar Pedido
        </button>
      </div>

      {activeTab === 'summary' ? (
        <OrderReview
          order={displayedOrder}
          incompleteItems={incompleteItems}
          canSubmit={canSubmit}
          canEdit={canEdit}
          submitting={submitting}
          deletingItemId={deletingItemId}
          onEdit={navigateTo}
          onRemove={(item) => void removeItem(item)}
          onAdd={navigateTo}
          onSubmit={() => void submitOrder()}
        />
      ) : activeTab === 'air' ? (
        <AirOfflineRequestForm
          key={`${builderIdentity}:air:${itemByService.get('air')?.version || 'new'}`}
          companies={fixedCompanies}
          initialCompanyId={displayedOrder.companyId}
          draftItem={itemByService.get('air') || null}
          travelOrderNumber={displayedOrder.orderNumber}
          travelOrderRequester={displayedOrder.requester}
          onSaveDraftItem={(demand) => saveItem('air', demand)}
          onDirtyChange={setDirty}
          onCancel={() => navigateTo('summary')}
        />
      ) : activeTab === 'hotel' ? (
        <HotelOfflineRequestForm
          key={`${builderIdentity}:hotel:${itemByService.get('hotel')?.version || 'new'}`}
          companies={fixedCompanies}
          initialCompanyId={displayedOrder.companyId}
          draftItem={itemByService.get('hotel') || null}
          travelOrderNumber={displayedOrder.orderNumber}
          travelOrderRequester={displayedOrder.requester}
          onSaveDraftItem={(demand) => saveItem('hotel', demand)}
          onDirtyChange={setDirty}
          onCancel={() => navigateTo('summary')}
        />
      ) : activeTab === 'car' || activeTab === 'bus' ? (
        <GroundOfflineRequestForm
          key={`${builderIdentity}:${activeTab}:${itemByService.get(activeTab)?.version || 'new'}`}
          service={activeTab}
          companies={fixedCompanies}
          initialCompanyId={displayedOrder.companyId}
          draftItem={itemByService.get(activeTab) || null}
          travelOrderNumber={displayedOrder.orderNumber}
          travelOrderRequester={displayedOrder.requester}
          onSaveDraftItem={(demand) => saveItem(activeTab, demand)}
          onDirtyChange={setDirty}
          onCancel={() => navigateTo('summary')}
        />
      ) : null}
    </section>
  )
}

function OrderTab({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${active
        ? 'border-bbt-accent bg-bbt-accent text-white'
        : 'border-slate-200 bg-white text-slate-600 hover:border-bbt-accent/50 hover:text-bbt-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}
    >
      {children}
    </button>
  )
}

function OrderReview({
  order,
  incompleteItems,
  canSubmit,
  canEdit,
  submitting,
  deletingItemId,
  onEdit,
  onRemove,
  onAdd,
  onSubmit,
}: {
  order: CompanyPortalTravelOrder
  incompleteItems: CompanyPortalTravelOrderItem[]
  canSubmit: boolean
  canEdit: boolean
  submitting: boolean
  deletingItemId: string
  onEdit: (serviceType: TravelOrderServiceType) => void
  onRemove: (item: CompanyPortalTravelOrderItem) => void
  onAdd: (serviceType: TravelOrderServiceType) => void
  onSubmit: () => void
}) {
  const missingServices = TRAVEL_ORDER_SERVICES.filter((serviceType) => (
    !order.items.some((item) => item.serviceType === serviceType)
  ))

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]" data-travel-order-review>
      <div className="space-y-3">
        {order.items.length ? order.items.map((item) => (
          <OrderItemCard
            key={item.id}
            item={item}
            deleting={deletingItemId === item.id}
            canEdit={canEdit}
            onEdit={() => onEdit(item.serviceType)}
            onRemove={() => onRemove(item)}
          />
        )) : (
          <div className="bbt-card border-dashed p-8 text-center">
            <ClipboardList className="mx-auto h-9 w-9 text-slate-300" />
            <h2 className="mt-3 font-bold text-bbt-primary dark:text-white">Pedido ainda sem serviços</h2>
            <p className="mt-1 text-sm text-slate-500">Adicione e salve ao menos um serviço antes do envio.</p>
          </div>
        )}

        {canEdit && missingServices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {missingServices.map((serviceType) => {
              const meta = SERVICE_META[serviceType]
              const Icon = meta.icon
              return (
                <button key={serviceType} type="button" className="bbt-button-ghost" onClick={() => onAdd(serviceType)}>
                  <Plus className="h-4 w-4" /><Icon className="h-4 w-4" />Adicionar {meta.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <aside className="bbt-card space-y-4 p-5 xl:sticky xl:top-20" data-travel-order-submit-summary>
        <div>
          <p className="bbt-section-label">Revisão final</p>
          <h2 className="mt-1 text-lg font-bold text-bbt-primary dark:text-white">Enviar Pedido completo</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Um único envio abre todos os serviços salvos para a agência.
          </p>
        </div>

        <dl className="space-y-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
          <div className="flex justify-between gap-3"><dt className="text-slate-500">Pedido</dt><dd className="font-bold">{order.orderNumber}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">Empresa</dt><dd className="text-right font-semibold">{order.companyName}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">Serviços</dt><dd className="font-semibold">{order.itemCount}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">Visibilidade</dt><dd className="font-semibold text-amber-700">Privado</dd></div>
        </dl>

        {incompleteItems.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="alert">
            <div className="flex items-center gap-2 font-bold"><AlertCircle className="h-4 w-4" />Complete antes de enviar</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {incompleteItems.flatMap((item) => item.completeness.issues.map((issue) => (
                <li key={`${item.id}:${issue}`}>{SERVICE_META[item.serviceType].label}: {issue}</li>
              ))) }
            </ul>
          </div>
        )}

        {!order.items.length && (
          <p className="rounded-xl border border-slate-200 p-3 text-xs text-slate-500">Salve ao menos um serviço para habilitar o envio.</p>
        )}

        <button
          type="button"
          className="bbt-button-primary w-full justify-center"
          disabled={!canSubmit || submitting}
          onClick={onSubmit}
          data-travel-order-submit
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting
            ? 'Enviando Pedido...'
            : (order.status === 'submitting'
                ? 'Continuar envio'
                : `Enviar Pedido com ${order.itemCount} serviço${order.itemCount === 1 ? '' : 's'}`)}
        </button>
        <p className="text-center text-[11px] leading-4 text-slate-500">
          Após o envio, os dados ficam bloqueados e cada serviço segue seu próprio fluxo.
        </p>
      </aside>
    </div>
  )
}

function OrderItemCard({
  item,
  deleting,
  canEdit,
  onEdit,
  onRemove,
}: {
  item: CompanyPortalTravelOrderItem
  deleting: boolean
  canEdit: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const meta = SERVICE_META[item.serviceType]
  const Icon = meta.icon
  const summary = orderItemSummary(item)
  return (
    <article className="bbt-card p-4 sm:p-5" data-travel-order-item={item.serviceType}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bbt-accent/10 text-bbt-accent"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold text-bbt-primary dark:text-white">{meta.label}</h2>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${item.completeness.complete
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-800'}`}>
              {item.completeness.complete ? 'Pronto para envio' : 'Revisar'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{summary.title}</p>
          <p className="mt-1 text-xs text-slate-500">{summary.detail}</p>
          {!item.completeness.complete && item.completeness.issues.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-700">{item.completeness.issues.join(' · ')}</p>
          )}
        </div>
        {canEdit && <div className="flex shrink-0 gap-2">
          <button type="button" className="bbt-button-ghost h-9 px-3 text-xs" onClick={onEdit}>
            <Edit3 className="h-3.5 w-3.5" />Editar
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            onClick={onRemove}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Remover
          </button>
        </div>}
      </div>
    </article>
  )
}

function orderItemSummary(item: CompanyPortalTravelOrderItem): { title: string; detail: string } {
  const demand = item.demand
  if (item.serviceType === 'air') {
    const segments = demand.detalhes_aereo?.trechos || []
    const first = segments[0]
    const last = segments[segments.length - 1]
    const route = first?.origin && last?.destination
      ? `${first.origin} → ${last.destination}`
      : 'Itinerário a confirmar'
    const dates = segments.map((segment) => segment.departure_date).filter(Boolean)
    const passengerCount = demand.detalhes_aereo?.passengers?.length || (demand.passageiro_nome ? 1 : 0)
    return {
      title: route,
      detail: `${dates.length ? dates.join(' · ') : 'Datas não informadas'} · ${passengerCount} passageiro${passengerCount === 1 ? '' : 's'}`,
    }
  }

  if (item.serviceType === 'hotel') {
    const details = demand.detalhes_hotel
    const roomCount = details?.rooms?.length || 0
    const guestCount = details?.rooms?.reduce((total, room) => total + room.guests.length, 0) || details?.num_hospedes || 0
    return {
      title: details?.cidade || 'Destino a confirmar',
      detail: `${details?.data_checkin || 'Check-in pendente'} → ${details?.data_checkout || 'Check-out pendente'} · ${roomCount} quarto${roomCount === 1 ? '' : 's'} · ${guestCount} hóspede${guestCount === 1 ? '' : 's'}`,
    }
  }

  if (item.serviceType === 'car') {
    const details = demand.detalhes_carro
    const pickup = details?.pickup_location_name || details?.ground?.pickupLocationText || 'Retirada a confirmar'
    const returning = details?.return_location_name || details?.ground?.returnLocationText || 'Devolução a confirmar'
    const pickupAt = details?.ground?.pickupAt || details?.data_retirada || 'Data de retirada pendente'
    const returnAt = details?.ground?.returnAt || details?.data_devolucao || 'Data de devolução pendente'
    return {
      title: `${pickup} → ${returning}`,
      detail: `${pickupAt} → ${returnAt} · Motorista: ${details?.primary_driver?.name || demand.passageiro_nome || 'a confirmar'}`,
    }
  }

  const details = demand.detalhes_rodoviario
  const legs = details?.ground?.legs || []
  const snapshots = details?.leg_snapshots || []
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  const route = first?.origin_city_name && last?.destination_city_name
    ? `${first.origin_city_name} → ${last.destination_city_name}`
    : 'Itinerário rodoviário a confirmar'
  const dates = legs.map((leg) => leg.departureDate).filter(Boolean)
  const travelerCount = details?.travelers?.length || (demand.passageiro_nome ? 1 : 0)
  return {
    title: route,
    detail: `${dates.length ? dates.join(' · ') : 'Datas não informadas'} · ${travelerCount} viajante${travelerCount === 1 ? '' : 's'}`,
  }
}

export default TravelOrderBuilder

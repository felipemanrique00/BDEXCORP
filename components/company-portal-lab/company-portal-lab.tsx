'use client'

import {
  AlertTriangle,
  BedDouble,
  Building2,
  BusFront,
  CalendarDays,
  Car,
  Check,
  ClipboardList,
  Filter,
  LockKeyhole,
  Loader2,
  Plane,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AirOfflineRequestForm } from '@/components/company-portal-lab/air-offline-request-form'
import { AirOperationWorkspace } from '@/components/company-portal-lab/air-operation-workspace'
import { AirRequestReadonly } from '@/components/company-portal-lab/air-request-readonly'
import { AirVoucherWorkspace } from '@/components/company-portal-lab/air-voucher-workspace'
import { GroundDemandFlow } from '@/components/company-portal-lab/ground-demand-flow'
import {
  groundPortalService,
  isOfflineGroundPortalItem,
} from '@/components/company-portal-lab/ground-portal-contract'
import { HotelDemandFlow } from '@/components/company-portal-lab/hotel-demand-flow'
import { HotelOfflineRequestForm } from '@/components/company-portal-lab/hotel-offline-request-form'
import {
  isOfflineHotelPortalItem,
} from '@/components/company-portal-lab/hotel-portal-contract'
import {
  CompanyPortalDemandStickyHeader,
  CompanyPortalLabShell,
} from '@/components/company-portal-lab/company-portal-chrome'
import { TravelOrderBuilder } from '@/components/company-portal-lab/travel-order-builder'
import { useCompanyPortalContext } from '@/components/company-portal-lab/use-company-portal-context'
import { OfflineAirQuoteChoiceWorkspace } from '@/components/travel/offline-air-quote-choice-workspace'
import { OfflineAirQuoteWorkspace } from '@/components/travel/offline-air-quote-workspace'
import { CorporateDemandApprovalPanel } from '@/components/company-portal-lab/corporate-demand-approval-panel'
import { hasPermission } from '@/lib/auth'
import {
  getCompanyPortalDemand,
  listCompanyPortalDemands,
} from '@/lib/company-portal-lab/demand-client'
import {
  getCompanyPortalTravelOrder,
  listCompanyPortalTravelOrders,
} from '@/lib/company-portal-lab/travel-order-client'
import type {
  CompanyPortalTravelOrder,
  CompanyPortalTravelOrderReference,
  CompanyPortalTravelOrderSummary,
} from '@/lib/company-portal-lab/travel-order'
import {
  aggregateCompanyPortalOrderStatus,
  groupCompanyPortalBoardEntries,
  type CompanyPortalBoardEntry,
} from '@/lib/company-portal-lab/travel-order-presentation'
import {
  resolveCompanyPortalBoardBrandingScope,
  resolveCompanyPortalInitialCompanyId,
} from '@/lib/company-portal-lab/branding-scope'
import { corporateDemandAsAtendimento } from '@/lib/company-portal-lab/demand-projection'
import type {
  CorporateDemandDetail,
  CorporateDemandListItem,
} from '@/lib/company-portal-lab/demand-projection'
import { canCreateAgencyAssistedDemand } from '@/lib/demands/agency-assistance'
import { createEntityId } from '@/lib/ids'
import {
  COMPANY_PORTAL_DEMAND_STEPS,
  COMPANY_PORTAL_KANBAN_COLUMNS,
  COMPANY_PORTAL_KANBAN_COLUMN_LABELS,
  describeCompanyPortalDemandStatus,
  type CompanyPortalDemandCtaAction,
  type CompanyPortalDemandCapabilities,
  type CompanyPortalDemandStatusPresentation,
  type CompanyPortalPersona,
  type CompanyPortalStatusTone,
} from '@/lib/company-portal-lab/demand-status'
import { isRequesterUser, userAccessKind } from '@/lib/user-access-kind'
import { formatDate } from '@/lib/utils'
import type {
  CorporateCompanyAccessSummary,
  Empresa,
  Permissoes,
  Prioridade,
  User,
} from '@/types'

const PRIORITIES: Array<{ value: 'all' | Prioridade; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'urgente', label: 'Urgente' },
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
]

type CompanyPortalService = 'all' | 'air' | 'hotel' | 'car' | 'bus'
type CreatableCompanyPortalService = Exclude<CompanyPortalService, 'all'>

const PORTAL_SERVICE_FILTERS: Array<{
  value: CompanyPortalService
  label: string
  icon: typeof Plane
  available: boolean
}> = [
  { value: 'all', label: 'Todos', icon: Check, available: true },
  { value: 'air', label: 'Aéreo', icon: Plane, available: true },
  { value: 'hotel', label: 'Hotel', icon: BedDouble, available: true },
  { value: 'car', label: 'Locação', icon: Car, available: true },
  { value: 'bus', label: 'Rodoviário', icon: BusFront, available: true },
]

export function CompanyPortalLab() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    access,
    portalContext,
    portalCompanyIds,
    portalIncludesCompany,
    user,
  } = useCompanyPortalContext()
  const [items, setItems] = useState<CorporateDemandListItem[]>([])
  const [travelOrders, setTravelOrders] = useState<CompanyPortalTravelOrderSummary[]>([])
  const [detailItem, setDetailItem] = useState<CorporateDemandDetail | null>(null)
  const [detailOrder, setDetailOrder] = useState<CompanyPortalTravelOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const demandListRequestSequence = useRef(0)
  const [search, setSearch] = useState(() => searchParams.get('q') || '')
  const [priority, setPriority] = useState<'all' | Prioridade>(() => (
    normalizePriority(searchParams.get('priority'))
  ))
  const [companyFilter, setCompanyFilter] = useState(() => searchParams.get('company') || '')
  const selectedDemandId = searchParams.get('demand') || ''
  const selectedOrderId = searchParams.get('order') || ''
  const draftOrderId = searchParams.get('draft') || ''
  const serviceFilter = normalizeServiceFilter(searchParams.get('service'))
  const newDemandService = normalizeCreatableService(searchParams.get('new'))
  const creatingTravelOrder = searchParams.get('new') === 'order'
    || Boolean(newDemandService)
  const requestedCreateIntentId = normalizeCreateIntentId(searchParams.get('intent'))
  const generatedCreateIntentRef = useRef('')
  if (creatingTravelOrder && !draftOrderId && !requestedCreateIntentId && !generatedCreateIntentRef.current) {
    generatedCreateIntentRef.current = createEntityId('intent')
  }
  const createIntentId = requestedCreateIntentId || generatedCreateIntentRef.current

  const visibleCompanies = useMemo(
    () => (access?.companies || [])
      .filter((company) => (
        portalCompanyIds.has(company.companyId)
        && (company.permissions.ver_demandas || company.permissions.criar_demandas)
      ))
      .map(companyAccessToEmpresa),
    [access?.companies, portalCompanyIds],
  )
  const createCompanies = useMemo(
    () => visibleCompanies.filter((company) => (
      portalIncludesCompany(company.id, 'criar_demandas')
      && portalIncludesCompany(company.id, 'ver_demandas')
    )),
    [portalIncludesCompany, visibleCompanies],
  )
  const companyById = useMemo(
    () => new Map(visibleCompanies.map((company) => [company.id, company])),
    [visibleCompanies],
  )
  const persona = resolvePersona(user)
  const capabilitiesForCompany = useCallback((companyId: string) => resolveCapabilities(
    user,
    (permission) => portalIncludesCompany(companyId, permission),
  ), [portalIncludesCompany, user])
  const canCreate = Boolean(
    user
    && hasPermission(user, 'criar_demandas')
    && createCompanies.length
    && (
      userAccessKind(user) !== 'internal'
      || canCreateAgencyAssistedDemand({
        platformAdmin: user.platform_admin === true,
        roleKey: user.role_key || (user.role === 'master' ? 'tenant_admin' : null),
      })
    )
  )
  const boardSearchParams = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search.trim())
    if (companyFilter) params.set('company', companyFilter)
    if (priority !== 'all') params.set('priority', priority)
    if (serviceFilter !== 'all') params.set('service', serviceFilter)
    return params.toString()
  }, [companyFilter, priority, search, serviceFilter])
  const boardBrandingScope = resolveCompanyPortalBoardBrandingScope({
    companyFilter,
    context: portalContext,
    companyIds: visibleCompanies.map((company) => company.id),
  })
  const initialCompanyId = resolveCompanyPortalInitialCompanyId({
    companyFilter,
    context: portalContext,
    companyIds: createCompanies.map((company) => company.id),
  })
  const [newDemandCompanyId, setNewDemandCompanyId] = useState(initialCompanyId)

  useEffect(() => {
    if (!creatingTravelOrder) return
    if (newDemandCompanyId && createCompanies.some((company) => company.id === newDemandCompanyId)) return
    setNewDemandCompanyId(initialCompanyId)
  }, [createCompanies, creatingTravelOrder, initialCompanyId, newDemandCompanyId])

  useEffect(() => {
    if (!creatingTravelOrder || draftOrderId || requestedCreateIntentId || !createIntentId) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('intent', createIntentId)
    router.replace(`/dashboard/portal-empresa-lab?${params}`)
  }, [createIntentId, creatingTravelOrder, draftOrderId, requestedCreateIntentId, router, searchParams])

  const loadDemands = useCallback(async () => {
    const requestSequence = demandListRequestSequence.current + 1
    demandListRequestSequence.current = requestSequence
    setLoading(true)
    setError('')
    try {
      const [result, orderResult] = await Promise.all([
        listCompanyPortalDemands({
          scopeType: portalContext?.type,
          scopeId: portalContext?.id,
          companyId: companyFilter || undefined,
          limit: 200,
        }),
        listCompanyPortalTravelOrders({
          scopeType: portalContext?.type,
          scopeId: portalContext?.id,
          companyId: companyFilter || undefined,
          limit: 200,
        }),
      ])
      if (demandListRequestSequence.current !== requestSequence) return
      setItems(result.items.filter(isCompanyPortalOfflineItem))
      setTravelOrders(orderResult.items)
    } catch (cause) {
      if (demandListRequestSequence.current !== requestSequence) return
      setItems([])
      setTravelOrders([])
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as demandas.')
    } finally {
      if (demandListRequestSequence.current === requestSequence) setLoading(false)
    }
  }, [companyFilter, portalContext?.id, portalContext?.type])

  useEffect(() => () => {
    demandListRequestSequence.current += 1
  }, [])

  useEffect(() => {
    void reloadToken
    void loadDemands()
  }, [loadDemands, reloadToken])

  useEffect(() => {
    if (!selectedDemandId || selectedOrderId) {
      setDetailItem(null)
      return
    }
    let active = true
    setDetailLoading(true)
    setError('')
    void getCompanyPortalDemand(selectedDemandId, {
      scopeType: portalContext?.type,
      scopeId: portalContext?.id,
    })
      .then((item) => {
        if (!active) return
        if (!isCompanyPortalOfflineItem(item)) {
          setDetailItem(null)
          setError('Este pedido nÃ£o pertence a um fluxo offline disponÃ­vel no Portal Empresa.')
          return
        }
        const travelOrder = demandTravelOrderReference(item)
        if (travelOrder?.status === 'submitted') {
          const params = new URLSearchParams(boardSearchParams)
          params.set('order', travelOrder.id)
          router.replace(`/dashboard/portal-empresa-lab?${params}`)
          return
        }
        setDetailItem(item)
      })
      .catch((cause) => {
        if (!active) return
        setDetailItem(null)
        setError(cause instanceof Error ? cause.message : 'Não foi possível abrir esta demanda.')
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [boardSearchParams, portalContext?.id, portalContext?.type, reloadToken, router, selectedDemandId, selectedOrderId])

  useEffect(() => {
    if (!selectedOrderId) {
      setDetailOrder(null)
      return
    }
    let active = true
    setDetailLoading(true)
    setError('')
    void getCompanyPortalTravelOrder(selectedOrderId, {
      scopeType: portalContext?.type,
      scopeId: portalContext?.id,
    })
      .then((order) => {
        if (!active) return
        if (order.status !== 'submitted') {
          setDetailOrder(null)
          setError('Este pedido ainda é um rascunho privado. Abra-o pela seção de rascunhos para continuar o preenchimento.')
          return
        }
        setDetailOrder(order)
      })
      .catch((cause) => {
        if (!active) return
        setDetailOrder(null)
        setError(cause instanceof Error ? cause.message : 'Não foi possível abrir este pedido.')
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [portalContext?.id, portalContext?.type, reloadToken, selectedOrderId])

  useEffect(() => {
    if (companyFilter && !visibleCompanies.some((company) => company.id === companyFilter)) {
      setCompanyFilter('')
    }
  }, [companyFilter, visibleCompanies])

  function openBoard() {
    generatedCreateIntentRef.current = ''
    const params = new URLSearchParams(searchParams.toString())
    params.delete('demand')
    params.delete('order')
    params.delete('draft')
    params.delete('new')
    params.delete('intent')
    router.push(`/dashboard/portal-empresa-lab${params.size ? `?${params}` : ''}`)
  }

  function openNewDemand() {
    setNewDemandCompanyId(initialCompanyId)
    const params = new URLSearchParams(boardSearchParams)
    params.set('new', serviceFilter === 'all' ? 'order' : serviceFilter)
    const intentId = createEntityId('intent')
    generatedCreateIntentRef.current = intentId
    params.set('intent', intentId)
    router.push(`/dashboard/portal-empresa-lab?${params}`)
  }

  function handleBuilderOrderChange(order: CompanyPortalTravelOrder) {
    setNewDemandCompanyId(order.companyId)
    if (order.itemCount < 1) return
    if (draftOrderId === order.id && !searchParams.has('intent')) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('new', 'order')
    params.set('draft', order.id)
    params.delete('intent')
    params.delete('demand')
    params.delete('order')
    router.replace(`/dashboard/portal-empresa-lab?${params}`)
  }

  function handleOrderSubmitted(order: CompanyPortalTravelOrder) {
    setReloadToken((current) => current + 1)
    const params = new URLSearchParams(searchParams.toString())
    params.delete('new')
    params.delete('draft')
    params.delete('intent')
    params.delete('demand')
    params.set('order', order.id)
    router.replace(`/dashboard/portal-empresa-lab?${params}`)
  }

  if (creatingTravelOrder) {
    return (
      <CompanyPortalLabShell scope={newDemandCompanyId ? { type: 'company', id: newDemandCompanyId } : boardBrandingScope}>
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
          <TravelOrderBuilder
            companies={createCompanies}
            initialCompanyId={initialCompanyId}
            initialOrderId={draftOrderId || undefined}
            initialService={newDemandService || undefined}
            createIntentId={createIntentId || undefined}
            onOrderChange={handleBuilderOrderChange}
            onCancel={openBoard}
            onSubmitted={handleOrderSubmitted}
          />
        </main>
      </CompanyPortalLabShell>
    )
  }

  if (selectedOrderId) {
    const selectedOrderCompanyId = detailOrder?.companyId
      || travelOrders.find((order) => order.id === selectedOrderId)?.companyId
      || ''
    return (
      <CompanyPortalLabShell scope={selectedOrderCompanyId ? { type: 'company', id: selectedOrderCompanyId } : boardBrandingScope}>
        <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">
          {detailLoading && !detailOrder ? (
            <LoadingState label="Abrindo pedido..." />
          ) : error && !detailOrder ? (
            <ErrorState message={error} onRetry={() => setReloadToken((current) => current + 1)} />
          ) : detailOrder ? (
            <TravelOrderDetail
              order={detailOrder}
              persona={persona}
              companyById={companyById}
              capabilitiesForCompany={capabilitiesForCompany}
              onBack={openBoard}
              onRefresh={() => {
                setDetailOrder(null)
                setReloadToken((current) => current + 1)
              }}
            />
          ) : null}
        </main>
      </CompanyPortalLabShell>
    )
  }

  if (selectedDemandId) {
    const selectedDemandCompanyId = detailItem?.companyId
      || items.find((item) => item.id === selectedDemandId)?.companyId
      || ''
    return (
      <CompanyPortalLabShell scope={selectedDemandCompanyId ? { type: 'company', id: selectedDemandCompanyId } : boardBrandingScope}>
        <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">
          {detailLoading && !detailItem ? (
            <LoadingState label="Abrindo demanda..." />
          ) : error && !detailItem ? (
            <ErrorState message={error} onRetry={() => setReloadToken((current) => current + 1)} />
          ) : detailItem ? (
            <DemandDetail
              item={detailItem}
              company={companyById.get(detailItem.companyId) || fallbackCompany(detailItem)}
              persona={persona}
              capabilities={demandCapabilities(
                detailItem,
                capabilitiesForCompany(detailItem.companyId),
              )}
              onBack={openBoard}
              onRefresh={() => {
                setDetailItem(null)
                setReloadToken((current) => current + 1)
              }}
            />
          ) : null}
        </main>
      </CompanyPortalLabShell>
    )
  }

  const privateDrafts = travelOrders.filter((order) => (
    order.status !== 'submitted'
    && (order.capabilities.canEdit || order.capabilities.canSubmit)
    && (order.itemCount > 0 || order.services.length > 0)
  ))

  return (
    <CompanyPortalLabShell scope={boardBrandingScope}>
      <main className="mx-auto w-full max-w-[1800px] space-y-4 p-4 sm:p-6" data-company-portal-lab>
        <header className="bbt-card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-bbt-gray-100 p-4 sm:p-5 dark:border-slate-700">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-bbt-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-bbt-accent">Laboratório</span>
              <span className="text-xs text-slate-500">Canal offline</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-bbt-primary dark:text-white">Pedidos de viagem</h1>
            <p className="mt-1 text-sm text-slate-500">Um pedido pode reunir vários serviços, cada um com cotação, aprovação, emissão e voucher próprios.</p>
          </div>
          {canCreate && (
            <button type="button" onClick={openNewDemand} className="bbt-button-primary min-w-44">
              <Plus className="h-4 w-4" />Novo pedido
            </button>
          )}
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-[minmax(240px,1fr)_220px_180px_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              className="bbt-input pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar pedido, OS, viajante, empresa, destino..."
              aria-label="Buscar pedidos"
            />
          </label>
          <label className="relative block">
            <Building2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <select className="bbt-input pl-9" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} aria-label="Filtrar por empresa">
              <option value="">Todas as empresas</option>
              {visibleCompanies.map((company) => <option key={company.id} value={company.id}>{company.nome}</option>)}
            </select>
          </label>
          <label className="relative block">
            <Filter className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <select className="bbt-input pl-9" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} aria-label="Filtrar por prioridade">
              {PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setReloadToken((current) => current + 1)} className="bbt-button-ghost" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-bbt-gray-100 px-4 py-3 dark:border-slate-700" aria-label="Filtrar por serviço">
          {PORTAL_SERVICE_FILTERS.map((service) => {
            const Icon = service.icon
            const params = new URLSearchParams(boardSearchParams)
            if (service.value === 'all') params.delete('service')
            else params.set('service', service.value)
            return (
              <Link
                key={service.value}
                href={`/dashboard/portal-empresa-lab${params.size ? `?${params}` : ''}`}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${serviceFilter === service.value
                  ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary'
                  : 'border-bbt-gray-100 bg-white text-slate-600 hover:border-bbt-accent dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}
                aria-current={serviceFilter === service.value ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" />{service.label}
                {!service.available && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 dark:bg-slate-800">em implantação</span>}
              </Link>
            )
          })}
        </div>
        </header>

        {error ? (
          <ErrorState message={error} onRetry={() => setReloadToken((current) => current + 1)} />
        ) : loading && !items.length ? (
          <LoadingState label="Carregando pedidos..." />
        ) : (
          <>
            <PrivateTravelOrderDrafts orders={privateDrafts} searchParams={boardSearchParams} />
            <DemandKanban
              items={items}
              persona={persona}
              capabilitiesForCompany={capabilitiesForCompany}
              searchParams={boardSearchParams}
              search={search}
              priority={priority}
              serviceFilter={serviceFilter}
            />
          </>
        )}
      </main>
    </CompanyPortalLabShell>
  )
}

function PrivateTravelOrderDrafts({
  orders,
  searchParams,
}: {
  orders: CompanyPortalTravelOrderSummary[]
  searchParams: string
}) {
  if (!orders.length) return null
  return (
    <section className="bbt-card overflow-hidden" aria-labelledby="private-drafts-title" data-private-travel-order-drafts>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <div>
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-bbt-accent" />
            <h2 id="private-drafts-title" className="font-bold text-bbt-primary dark:text-white">Rascunhos privados</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">Somente você vê estes pedidos antes do envio único para a agência.</p>
        </div>
        <span className="rounded-full bg-bbt-accent/10 px-2.5 py-1 text-xs font-bold text-bbt-accent">{orders.length}</span>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {orders.map((order) => (
          <Link
            key={order.id}
            href={travelOrderDraftHref(searchParams, order.id)}
            className="rounded-xl border border-dashed border-bbt-accent/40 bg-bbt-accent/5 p-3 transition hover:border-bbt-accent hover:bg-bbt-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bbt-accent"
            aria-label={`Continuar rascunho ${order.orderNumber}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-bbt-primary dark:text-white">Pedido {order.orderNumber}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{order.companyName} · atualizado {formatDateTime(order.updatedAt)}</p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                {order.status === 'submitting' ? 'Continuar envio' : 'Em preenchimento'}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {order.services.map((service) => (
                <span key={service} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
                  <ServiceGlyph service={service} />{portalServiceName(service)}
                </span>
              ))}
              {!order.services.length && <span className="text-xs text-slate-500">Nenhum serviço adicionado</span>}
            </div>
            <p className="mt-3 text-xs font-semibold text-bbt-accent">Continuar preenchimento →</p>
          </Link>
        ))}
      </div>
    </section>
  )
}

function DemandKanban({
  items,
  persona,
  capabilitiesForCompany,
  searchParams,
  search,
  priority,
  serviceFilter,
}: {
  items: CorporateDemandListItem[]
  persona: CompanyPortalPersona
  capabilitiesForCompany: (companyId: string) => CompanyPortalDemandCapabilities
  searchParams: string
  search: string
  priority: 'all' | Prioridade
  serviceFilter: CompanyPortalService
}) {
  const statusById = useMemo(() => new Map(items.map((item) => [
    item.id,
    describeCompanyPortalDemandStatus({
      lifecycleStatus: item.lifecycleStatus,
      operationalStatus: item.operationalStatus,
      persona,
      capabilities: demandCapabilities(item, capabilitiesForCompany(item.companyId)),
      activeApprovalInstanceId: item.hasActiveApproval ? 'active' : null,
      requestAdjustmentAllowed: item.requestAdjustmentOpen,
      requestAdjustmentReason: item.requestAdjustmentReason,
    }),
  ])), [capabilitiesForCompany, items, persona])

  const entries = useMemo(() => groupCompanyPortalBoardEntries(items, statusById).filter((entry) => (
    boardEntryMatches(entry, { search, priority, serviceFilter })
  )), [items, priority, search, serviceFilter, statusById])

  return (
    <section className="grid min-h-[520px] auto-cols-[minmax(285px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3 xl:grid-flow-row xl:grid-cols-5" aria-label="Pedidos por etapa">
      {COMPANY_PORTAL_KANBAN_COLUMNS.map((column) => {
        const columnItems = entries.filter((entry) => entry.status.kanbanColumn === column)
        return (
          <div key={column} className="min-w-0 rounded-2xl bg-slate-100/80 p-2 dark:bg-slate-900/50">
            <header className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-bold ${COLUMN_HEADER_CLASSES[column]}`}>
              <span>{COMPANY_PORTAL_KANBAN_COLUMN_LABELS[column]}</span>
              <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs">{columnItems.length}</span>
            </header>
            <div className="space-y-2">
              {columnItems.map((entry) => (
                <TravelOrderCard
                  key={entry.key}
                  entry={entry}
                  href={entry.orderId
                    ? travelOrderHref(searchParams, entry.orderId)
                    : demandHref(searchParams, entry.demands[0]!.item.id)}
                />
              ))}
              {!columnItems.length && (
                <div className="rounded-xl border border-dashed border-slate-200 p-7 text-center text-xs text-slate-400 dark:border-slate-700">Sem demandas</div>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}

function TravelOrderCard({
  entry,
  href,
}: {
  entry: CompanyPortalBoardEntry
  href: string
}) {
  const primary = entry.demands[0]!.item
  const travelers = uniqueText(entry.demands.map(({ item }) => item.passengerName))
  const destinations = uniqueText(entry.demands.map(({ item }) => portalDestinationLabel(item)))
  const travelerLabel = travelers.length === 1 ? travelers[0]! : `${travelers.length} viajantes`
  const destinationLabel = destinations.length === 1 ? destinations[0]! : destinations.join(' · ')
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-bbt-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bbt-accent dark:border-slate-700 dark:bg-slate-900"
      aria-label={`Abrir ${entry.kind === 'order' ? 'pedido' : 'demanda'} ${entry.orderNumber} de ${travelerLabel}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bbt-accent/10 text-bbt-accent">
          {entry.kind === 'order' ? <ClipboardList className="h-4 w-4" /> : <ServiceGlyph service={portalService(primary)} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-bbt-primary dark:text-white">{travelerLabel || 'Viajante não informado'}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">
            {entry.kind === 'order' ? `Pedido ${entry.orderNumber} · ${entry.itemCount} serviços` : `${entry.orderNumber} · ${portalServiceLabel(primary)}`} · {entry.companyName}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Serviços e status do pedido">
        {entry.demands.map(({ item, status }) => (
          <span key={item.id} className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${TONE_BADGE_CLASSES[status.tone]}`}>
            <ServiceGlyph service={portalService(item)} />
            <span>{portalServiceLabel(item)}</span>
            {entry.kind === 'order' && <span className="max-w-28 truncate opacity-75">· {status.statusLabel}</span>}
          </span>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800">
        <div className="truncate font-semibold text-slate-700 dark:text-slate-200">{destinationLabel}</div>
        <div className="mt-1 flex items-center gap-1 text-slate-500"><CalendarDays className="h-3 w-3" />{travelOrderDateLabel(entry)}</div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${TONE_BADGE_CLASSES[entry.status.tone]}`}>{entry.status.statusLabel}</span>
        <span className="text-right text-[10px] text-slate-500">{entry.status.waitingOnLabel ? `Aguardando: ${entry.status.waitingOnLabel}` : 'Sem ação pendente'}</span>
      </div>
      {entry.status.nextAction && <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">{entry.status.nextAction}</p>}
    </Link>
  )
}

function TravelOrderDetail({
  order,
  persona,
  companyById,
  capabilitiesForCompany,
  onBack,
  onRefresh,
}: {
  order: CompanyPortalTravelOrder
  persona: CompanyPortalPersona
  companyById: Map<string, Empresa>
  capabilitiesForCompany: (companyId: string) => CompanyPortalDemandCapabilities
  onBack: () => void
  onRefresh: () => void
}) {
  const childItems = order.items.filter((item) => item.childDemand)
  const statusByItemId = new Map(childItems.map((orderItem) => {
    const child = orderItem.childDemand!
    return [orderItem.id, describeCompanyPortalDemandStatus({
      lifecycleStatus: child.lifecycleStatus,
      operationalStatus: child.operationalStatus,
      persona,
      capabilities: demandCapabilities(child, capabilitiesForCompany(child.companyId)),
      activeApprovalInstanceId: child.hasActiveApproval ? 'active' : null,
      requestAdjustmentAllowed: child.requestAdjustmentOpen,
      requestAdjustmentReason: child.requestAdjustmentReason,
    })]
  }))
  const aggregateStatus = aggregateCompanyPortalOrderStatus(Array.from(statusByItemId.values()))
  const initiallySelected = childItems.find((item) => statusByItemId.get(item.id)?.kanbanColumn === 'waiting_client')
    || childItems.find((item) => !['completed', 'canceled'].includes(statusByItemId.get(item.id)?.kanbanColumn || ''))
    || childItems[0]
  const [selectedItemId, setSelectedItemId] = useState(initiallySelected?.id || '')
  const selectedItem = childItems.find((item) => item.id === selectedItemId) || initiallySelected

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedItemId) setSelectedItemId(selectedItem.id)
  }, [selectedItem, selectedItemId])

  return (
    <div className="space-y-5" data-company-portal-travel-order-detail>
      <CompanyPortalDemandStickyHeader
        demandNumber={order.orderNumber}
        serviceTypeLabel={order.services.map(portalServiceName).join(' + ') || 'Pedido de viagem'}
        statusLabel={aggregateStatus.statusLabel}
        scope={{ type: 'company', id: order.companyId }}
        onBack={onBack}
        onRefresh={onRefresh}
      />

      <section className={`overflow-hidden rounded-2xl border ${TONE_PANEL_CLASSES[aggregateStatus.tone]}`} aria-labelledby="travel-order-status-title">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-75">
              <ClipboardList className="h-4 w-4" />Pedido {order.orderNumber} · {order.itemCount} serviços · Offline
            </div>
            <h1 id="travel-order-status-title" className="mt-2 text-2xl font-bold">{aggregateStatus.statusLabel}</h1>
            <p className="mt-1 text-sm">{aggregateStatus.nextAction || 'Acompanhe abaixo o andamento individual de cada serviço.'}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs opacity-80">
              <span><strong>Empresa:</strong> {order.companyName}</span>
              <span><strong>Aguardando:</strong> {aggregateStatus.waitingOnLabel || 'Ninguém'}</span>
              <span><strong>Atualizado:</strong> {formatDateTime(order.updatedAt)}</span>
            </div>
          </div>
          <div className="rounded-xl bg-white/70 px-4 py-3 text-center shadow-sm dark:bg-slate-900/60">
            <strong className="block text-xl">{aggregateStatus.completedItemCount}/{order.itemCount}</strong>
            <span className="text-[11px] opacity-75">serviços encerrados</span>
          </div>
        </div>
      </section>

      <section className="bbt-card p-4" aria-labelledby="travel-order-items-title">
        <div className="mb-3">
          <h2 id="travel-order-items-title" className="font-bold text-bbt-primary dark:text-white">Serviços deste pedido</h2>
          <p className="mt-1 text-xs text-slate-500">Cada serviço mantém sua própria cotação, escolha, aprovação, emissão e voucher.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {order.items.map((orderItem) => {
            const child = orderItem.childDemand
            const status = statusByItemId.get(orderItem.id)
            const selected = orderItem.id === selectedItem?.id
            return (
              <button
                key={orderItem.id}
                type="button"
                disabled={!child}
                onClick={() => child && setSelectedItemId(orderItem.id)}
                className={`rounded-xl border p-3 text-left transition ${selected
                  ? 'border-bbt-accent bg-bbt-accent/10 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-bbt-accent dark:border-slate-700 dark:bg-slate-900'} disabled:cursor-not-allowed disabled:opacity-60`}
                aria-pressed={selected}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bbt-accent/10 text-bbt-accent"><ServiceGlyph service={orderItem.serviceType} /></span>
                    <div className="min-w-0">
                      <p className="font-bold text-bbt-primary dark:text-white">{portalServiceName(orderItem.serviceType)}</p>
                      <p className="truncate text-[11px] text-slate-500">{child ? `OS ${child.demandNumber}` : 'Aguardando vínculo operacional'}</p>
                    </div>
                  </div>
                  {status && <span className={`max-w-40 rounded-full px-2 py-1 text-right text-[10px] font-bold ${TONE_BADGE_CLASSES[status.tone]}`}>{status.statusLabel}</span>}
                </div>
                {status && (
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                    {status.waitingOnLabel ? `Aguardando ${status.waitingOnLabel}. ` : ''}{status.nextAction}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {selectedItem?.childDemand ? (
        <section id={`order-service-${selectedItem.id}`} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-950/20" aria-label={`Fluxo de ${portalServiceName(selectedItem.serviceType)}`}>
          <DemandDetail
            item={selectedItem.childDemand}
            company={companyById.get(order.companyId) || fallbackCompany(selectedItem.childDemand)}
            persona={persona}
            capabilities={demandCapabilities(
              selectedItem.childDemand,
              capabilitiesForCompany(selectedItem.childDemand.companyId),
            )}
            onBack={onBack}
            onRefresh={onRefresh}
            embedded
          />
        </section>
      ) : (
        <div className="bbt-card p-6 text-center text-sm text-slate-500">Os serviços deste pedido ainda estão sendo vinculados. Atualize para continuar.</div>
      )}
    </div>
  )
}

interface DemandDetailProps {
  item: CorporateDemandDetail
  company: Empresa
  persona: CompanyPortalPersona
  capabilities: CompanyPortalDemandCapabilities
  onBack: () => void
  onRefresh: () => void
  embedded?: boolean
}

function DemandDetail(props: DemandDetailProps) {
  if (isOfflineHotelPortalItem(props.item)) return <HotelDemandDetail {...props} />
  if (isOfflineGroundPortalItem(props.item)) return <GroundDemandDetail {...props} />
  return <AirDemandDetail {...props} />
}

function AirDemandDetail({
  item,
  company,
  persona,
  capabilities,
  onBack,
  onRefresh,
  embedded = false,
}: DemandDetailProps) {
  const [editingRequest, setEditingRequest] = useState(false)
  const status = describeCompanyPortalDemandStatus({
    lifecycleStatus: item.lifecycleStatus,
    operationalStatus: item.operationalStatus,
    persona,
    capabilities,
    activeApprovalInstanceId: item.hasActiveApproval ? 'active' : null,
    requestAdjustmentAllowed: item.requestAdjustmentOpen,
    requestAdjustmentReason: item.requestAdjustmentReason,
  })
  const showQuoteWorkspace = persona === 'consultant'
    && capabilities.canPrepareQuotation
    && ['draft', 'submitted', 'approved_for_quotation', 'quoting', 'pending_choice', 'failed'].includes(item.lifecycleStatus)
  const showChoiceWorkspace = item.capabilities.canChooseQuote
  const showApprovalWorkspace = item.capabilities.canDecideAssignedApproval
    && (
      ['pending_merit_approval', 'pending_cost_approval'].includes(item.lifecycleStatus)
      || item.hasActiveApproval
    )
  const showOperationWorkspace = persona === 'consultant'
    && !item.hasActiveApproval
    && (
      (capabilities.canReserve && ['approved', 'reserving'].includes(item.lifecycleStatus))
      || (capabilities.canIssue && ['approved', 'reserving', 'reserved', 'pending_issuance'].includes(item.lifecycleStatus))
    )
  const showVoucherWorkspace = capabilities.canViewVoucher
    && ['issued', 'partially_issued', 'closed'].includes(item.lifecycleStatus)
  const canEditAfterRejection = item.capabilities.canCorrectRequest
  const actionHref = detailActionHref(status.cta?.action)
  const secondaryActionHref = detailActionHref(status.secondaryCta?.action)

  useEffect(() => {
    if (!canEditAfterRejection) setEditingRequest(false)
  }, [canEditAfterRejection])

  return (
    <div className="space-y-5" data-company-portal-demand-detail>
      {!embedded && (
        <CompanyPortalDemandStickyHeader
          demandNumber={item.demandNumber}
          serviceTypeLabel="Aéreo"
          statusLabel={status.statusLabel}
          scope={{ type: 'company', id: item.companyId }}
          onBack={onBack}
          onRefresh={onRefresh}
        />
      )}

      <section className={`overflow-hidden rounded-2xl border ${TONE_PANEL_CLASSES[status.tone]}`} aria-labelledby="demand-status-title">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-75">
              <Plane className="h-4 w-4" />Aéreo · Offline · {item.demandNumber}
            </div>
            <h2 id="demand-status-title" className="mt-2 text-2xl font-bold">{status.statusLabel}</h2>
            <p className="mt-1 text-sm">{status.nextAction || 'Nenhuma ação pendente neste momento.'}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs opacity-80">
              <span><strong>Aguardando:</strong> {status.waitingOnLabel || 'Ninguém'}</span>
              <span><strong>Atualizado:</strong> {formatDateTime(item.updatedAt)}</span>
            </div>
          </div>
          {(status.cta || status.secondaryCta) && (
            <div className="flex flex-wrap justify-end gap-2">
              {status.cta?.action === 'edit_request' ? (
                <button type="button" onClick={() => setEditingRequest(true)} className="bbt-button-primary justify-center">
                  {status.cta.label}
                </button>
              ) : actionHref && status.cta ? (
                <Link href={actionHref} className="bbt-button-primary justify-center">{status.cta.label}</Link>
              ) : null}
              {status.secondaryCta?.action === 'edit_request' ? (
                <button type="button" onClick={() => setEditingRequest(true)} className="bbt-button-outline justify-center">
                  {status.secondaryCta.label}
                </button>
              ) : secondaryActionHref && status.secondaryCta ? (
                <Link href={secondaryActionHref} className="bbt-button-outline justify-center">{status.secondaryCta.label}</Link>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <DemandStepper status={status} />

      <div id="request-action" className="scroll-mt-24">
        {editingRequest && canEditAfterRejection ? (
          <AirOfflineRequestForm
            companies={[company]}
            initialCompanyId={item.companyId}
            editingItem={item}
            onCancel={() => setEditingRequest(false)}
            onUpdated={() => {
              setEditingRequest(false)
              onRefresh()
            }}
          />
        ) : (
          <AirRequestReadonly
            demand={item.demand}
            companyName={item.companyName}
            canEditAfterRejection={canEditAfterRejection}
            editReason={item.requestAdjustmentReason}
            onEdit={canEditAfterRejection ? () => setEditingRequest(true) : undefined}
          />
        )}
      </div>

      {!editingRequest && showChoiceWorkspace && (
        <div id="choice-action" className="scroll-mt-24">
          <OfflineAirQuoteChoiceWorkspace
            demands={[corporateDemandAsAtendimento(item.demand)]}
            companies={[company]}
            requesterId={item.demand.solicitante_id || null}
            focusDemandId={item.id}
            discoverServerDemands={false}
            onCompleted={onRefresh}
          />
        </div>
      )}

      {!editingRequest && showQuoteWorkspace && (
        <div id="quote-action" className="scroll-mt-24">
          <OfflineAirQuoteWorkspace
            demands={[corporateDemandAsAtendimento(item.demand)]}
            companies={[company]}
            initialDemandId={item.id}
            onCompleted={onRefresh}
          />
        </div>
      )}

      {!editingRequest && showApprovalWorkspace && (
        <div id="approval-action" className="scroll-mt-24">
          <CorporateDemandApprovalPanel
            refreshToken={item.version}
            demandId={item.id}
            onDecided={onRefresh}
          />
        </div>
      )}

      {!editingRequest && showOperationWorkspace && (
        <div id="operation-action" className="scroll-mt-24">
          <AirOperationWorkspace demand={item.demand} company={company} onCompleted={onRefresh} />
        </div>
      )}

      {!editingRequest && showVoucherWorkspace && (
        <div id="voucher-action" className="scroll-mt-24">
          <AirVoucherWorkspace
            demandId={item.id}
            companyId={item.companyId}
            canSendVoucher={capabilities.canSendVoucher === true}
          />
        </div>
      )}
    </div>
  )
}

function HotelDemandDetail({
  item,
  company,
  persona,
  capabilities,
  onBack,
  onRefresh,
  embedded = false,
}: DemandDetailProps) {
  const [editRequestToken, setEditRequestToken] = useState(0)
  const [editingRequest, setEditingRequest] = useState(false)
  const status = describeCompanyPortalDemandStatus({
    lifecycleStatus: item.lifecycleStatus,
    operationalStatus: item.operationalStatus,
    persona,
    capabilities,
    activeApprovalInstanceId: item.hasActiveApproval ? 'active' : null,
    requestAdjustmentAllowed: item.requestAdjustmentOpen,
    requestAdjustmentReason: item.requestAdjustmentReason,
  })
  const actionHref = detailActionHref(status.cta?.action)
  const secondaryActionHref = detailActionHref(status.secondaryCta?.action)

  function requestEdit() {
    setEditRequestToken((current) => current + 1)
  }

  return (
    <div className="space-y-5" data-company-portal-demand-detail data-service="hotel">
      {!embedded && (
        <CompanyPortalDemandStickyHeader
          demandNumber={item.demandNumber}
          serviceTypeLabel="Hotel"
          statusLabel={status.statusLabel}
          scope={{ type: 'company', id: item.companyId }}
          onBack={onBack}
          onRefresh={onRefresh}
        />
      )}

      <section className={`overflow-hidden rounded-2xl border ${TONE_PANEL_CLASSES[status.tone]}`} aria-labelledby="demand-status-title">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-75">
              <BedDouble className="h-4 w-4" />Hotel · Offline · {item.demandNumber}
            </div>
            <h2 id="demand-status-title" className="mt-2 text-2xl font-bold">{status.statusLabel}</h2>
            <p className="mt-1 text-sm">{status.nextAction || 'Nenhuma ação pendente neste momento.'}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs opacity-80">
              <span><strong>Aguardando:</strong> {status.waitingOnLabel || 'Ninguém'}</span>
              <span><strong>Atualizado:</strong> {formatDateTime(item.updatedAt)}</span>
            </div>
          </div>
          {!editingRequest && (status.cta || status.secondaryCta) && (
            <div className="flex flex-wrap justify-end gap-2">
              {status.cta?.action === 'edit_request' ? (
                <button type="button" onClick={requestEdit} className="bbt-button-primary justify-center">{status.cta.label}</button>
              ) : actionHref && status.cta ? (
                <Link href={actionHref} className="bbt-button-primary justify-center">{status.cta.label}</Link>
              ) : null}
              {status.secondaryCta?.action === 'edit_request' ? (
                <button type="button" onClick={requestEdit} className="bbt-button-outline justify-center">{status.secondaryCta.label}</button>
              ) : secondaryActionHref && status.secondaryCta ? (
                <Link href={secondaryActionHref} className="bbt-button-outline justify-center">{status.secondaryCta.label}</Link>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <DemandStepper status={status} />
      <HotelDemandFlow
        item={item}
        company={company}
        persona={persona}
        capabilities={capabilities}
        onRefresh={onRefresh}
        editRequestToken={editRequestToken}
        onEditingChange={setEditingRequest}
      />
    </div>
  )
}

function GroundDemandDetail({
  item,
  company,
  persona,
  capabilities,
  onBack,
  onRefresh,
  embedded = false,
}: DemandDetailProps) {
  const [editRequestToken, setEditRequestToken] = useState(0)
  const [editingRequest, setEditingRequest] = useState(false)
  const service = groundPortalService(item)
  const serviceTypeLabel = service === 'car' ? 'Carro' : 'Rodoviário'
  const ServiceIcon = service === 'car' ? Car : BusFront
  const status = describeCompanyPortalDemandStatus({
    lifecycleStatus: item.lifecycleStatus,
    operationalStatus: item.operationalStatus,
    persona,
    capabilities,
    activeApprovalInstanceId: item.hasActiveApproval ? 'active' : null,
    requestAdjustmentAllowed: item.requestAdjustmentOpen,
    requestAdjustmentReason: item.requestAdjustmentReason,
  })
  const actionHref = detailActionHref(status.cta?.action)
  const secondaryActionHref = detailActionHref(status.secondaryCta?.action)

  function requestEdit() {
    setEditRequestToken((current) => current + 1)
  }

  return (
    <div className="space-y-5" data-company-portal-demand-detail data-service={service || 'ground'}>
      {!embedded && (
        <CompanyPortalDemandStickyHeader
          demandNumber={item.demandNumber}
          serviceTypeLabel={serviceTypeLabel}
          statusLabel={status.statusLabel}
          scope={{ type: 'company', id: item.companyId }}
          onBack={onBack}
          onRefresh={onRefresh}
        />
      )}

      <section className={`overflow-hidden rounded-2xl border ${TONE_PANEL_CLASSES[status.tone]}`} aria-labelledby="demand-status-title">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-75">
              <ServiceIcon className="h-4 w-4" />{serviceTypeLabel} · Offline · {item.demandNumber}
            </div>
            <h2 id="demand-status-title" className="mt-2 text-2xl font-bold">{status.statusLabel}</h2>
            <p className="mt-1 text-sm">{status.nextAction || 'Nenhuma ação pendente neste momento.'}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs opacity-80">
              <span><strong>Aguardando:</strong> {status.waitingOnLabel || 'Ninguém'}</span>
              <span><strong>Atualizado:</strong> {formatDateTime(item.updatedAt)}</span>
            </div>
          </div>
          {!editingRequest && (status.cta || status.secondaryCta) && (
            <div className="flex flex-wrap justify-end gap-2">
              {status.cta?.action === 'edit_request' ? (
                <button type="button" onClick={requestEdit} className="bbt-button-primary justify-center">{status.cta.label}</button>
              ) : actionHref && status.cta ? (
                <Link href={actionHref} className="bbt-button-primary justify-center">{status.cta.label}</Link>
              ) : null}
              {status.secondaryCta?.action === 'edit_request' ? (
                <button type="button" onClick={requestEdit} className="bbt-button-outline justify-center">{status.secondaryCta.label}</button>
              ) : secondaryActionHref && status.secondaryCta ? (
                <Link href={secondaryActionHref} className="bbt-button-outline justify-center">{status.secondaryCta.label}</Link>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <DemandStepper status={status} />
      <GroundDemandFlow
        item={item}
        company={company}
        persona={persona}
        capabilities={capabilities}
        onRefresh={onRefresh}
        editRequestToken={editRequestToken}
        onEditingChange={setEditingRequest}
      />
    </div>
  )
}

function DemandStepper({ status }: { status: CompanyPortalDemandStatusPresentation }) {
  return (
    <section className="bbt-card overflow-x-auto p-4" aria-label="Etapas da demanda">
      <ol className="flex min-w-[720px] items-start">
        {COMPANY_PORTAL_DEMAND_STEPS.map((step, index) => {
          const completed = status.activeStepIndex !== null && index < status.activeStepIndex
          const active = index === status.activeStepIndex
          return (
            <li key={step.key} className="relative flex flex-1 flex-col items-center text-center">
              {index > 0 && <span className={`absolute right-1/2 top-4 h-0.5 w-full ${completed || active ? 'bg-bbt-accent' : 'bg-slate-200 dark:bg-slate-700'}`} />}
              <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold ${completed
                ? 'border-bbt-accent bg-bbt-accent text-white'
                : active
                  ? 'border-bbt-accent bg-white text-bbt-accent dark:bg-slate-900'
                  : 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900'}`}>
                {completed ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span className={`mt-2 text-xs font-semibold ${active ? 'text-bbt-primary dark:text-white' : 'text-slate-500'}`}>{step.label}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function LoadingState({ label }: { label: string }) {
  return <div className="bbt-card flex min-h-56 items-center justify-center gap-2 p-8 text-sm text-slate-500" role="status"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bbt-card flex min-h-44 flex-col items-center justify-center gap-3 border-red-200 p-8 text-center text-red-700" role="alert">
      <AlertTriangle className="h-6 w-6" />
      <div className="font-semibold">{message}</div>
      <button type="button" onClick={onRetry} className="bbt-button-outline">Tentar novamente</button>
    </div>
  )
}

function resolvePersona(user: User | null): CompanyPortalPersona {
  if (!user) return 'observer'
  if (userAccessKind(user) === 'internal') return 'consultant'
  if (isRequesterUser(user)) return 'requester'
  if (hasPermission(user, 'decidir_aprovacoes') || hasPermission(user, 'aprovar_demandas')) return 'approver'
  if (hasPermission(user, 'criar_demandas')) return 'requester'
  return 'observer'
}

function resolveCapabilities(
  user: User | null,
  companyAllows?: (permission: keyof Permissoes) => boolean,
): CompanyPortalDemandCapabilities {
  if (!user) return {}
  const allows = (permission: keyof Permissoes) => (
    hasPermission(user, permission)
    && (companyAllows ? companyAllows(permission) : true)
  )
  return {
    canPrepareQuotation: allows('operar_cotacoes') && allows('ver_reservas'),
    canChooseQuote: isRequesterUser(user) && allows('criar_demandas') && allows('ver_reservas'),
    canApprove: allows('ver_aprovacoes') && (allows('decidir_aprovacoes') || allows('aprovar_demandas')),
    canReserve: allows('operar_reservas'),
    canIssue: allows('operar_emissoes'),
    canViewVoucher: allows('ver_vouchers'),
    canSendVoucher: userAccessKind(user) === 'internal' && allows('ver_vouchers') && allows('operar_reservas'),
    canRetry: userAccessKind(user) === 'internal' && allows('operar_reservas'),
    canEditRequest: (isRequesterUser(user) || userAccessKind(user) === 'internal') && allows('criar_demandas'),
  }
}

function detailActionHref(action: CompanyPortalDemandCtaAction | undefined): string | null {
  switch (action) {
    case 'prepare_quotation':
    case 'continue_quotation':
    case 'retry':
      return '#quote-action'
    case 'choose_quote':
      return '#choice-action'
    case 'review_approval':
      return '#approval-action'
    case 'start_reservation':
    case 'continue_reservation':
    case 'issue':
    case 'continue_issuance':
      return '#operation-action'
    case 'view_voucher':
    case 'send_voucher':
      return '#voucher-action'
    case 'edit_request':
      return '#request-action'
    default:
      return null
  }
}

function demandHref(current: string, demandId: string): string {
  const params = new URLSearchParams(current)
  params.delete('new')
  params.delete('draft')
  params.delete('order')
  params.set('demand', demandId)
  return `/dashboard/portal-empresa-lab?${params}`
}

function travelOrderHref(current: string, orderId: string): string {
  const params = new URLSearchParams(current)
  params.delete('new')
  params.delete('draft')
  params.delete('demand')
  params.set('order', orderId)
  return `/dashboard/portal-empresa-lab?${params}`
}

function travelOrderDraftHref(current: string, orderId: string): string {
  const params = new URLSearchParams(current)
  params.delete('demand')
  params.delete('order')
  params.set('new', 'order')
  params.set('draft', orderId)
  params.delete('intent')
  return `/dashboard/portal-empresa-lab?${params}`
}

function demandTravelOrderReference(item: CorporateDemandListItem): CompanyPortalTravelOrderReference | null {
  return (item as CorporateDemandListItem & { travelOrder?: CompanyPortalTravelOrderReference | null }).travelOrder || null
}

function boardEntryMatches(
  entry: CompanyPortalBoardEntry,
  filters: {
    search: string
    priority: 'all' | Prioridade
    serviceFilter: CompanyPortalService
  },
): boolean {
  if (filters.serviceFilter !== 'all' && !entry.services.includes(filters.serviceFilter)) return false
  if (filters.priority !== 'all' && !entry.demands.some(({ item }) => item.priority === filters.priority)) return false
  const query = normalizeText(filters.search)
  if (!query) return true
  return [
    entry.orderNumber,
    entry.companyName,
    ...entry.demands.flatMap(({ item }) => [
      item.demandNumber,
      item.passengerName,
      item.requesterName,
      item.destination,
      portalDestinationLabel(item),
      portalServiceLabel(item),
    ]),
  ].some((value) => normalizeText(value).includes(query))
}

function isOfflineAirItem(item: CorporateDemandListItem): boolean {
  const service = normalizeText(item.serviceType)
  return (service === 'aereo' || service === 'air') && item.bookingMode !== 'online'
}

function isCompanyPortalOfflineItem(item: CorporateDemandListItem): boolean {
  return item.bookingMode !== 'online'
    && (isOfflineAirItem(item) || isOfflineHotelPortalItem(item) || ['car', 'bus'].includes(portalService(item)))
}

function portalService(item: CorporateDemandListItem): Exclude<CompanyPortalService, 'all'> | 'other' {
  const service = normalizeText(item.serviceType)
  if (service === 'aereo' || service === 'air') return 'air'
  if (service === 'hotel' || service === 'hotelaria' || service.includes('hosped')) return 'hotel'
  if (service === 'car' || service === 'carro' || service.includes('locacao')) return 'car'
  if (service === 'bus' || service.includes('rodovi')) return 'bus'
  return 'other'
}

function portalServiceLabel(item: CorporateDemandListItem): string {
  return ({ air: 'Aéreo', hotel: 'Hotel', car: 'Locação', bus: 'Rodoviário', other: 'Outro' } as const)[portalService(item)]
}

function portalServiceName(service: string): string {
  return ({ air: 'Aéreo', hotel: 'Hotel', car: 'Locação', bus: 'Rodoviário' } as Record<string, string>)[service] || 'Serviço'
}

function ServiceGlyph({ service }: { service: string }) {
  if (service === 'hotel') return <BedDouble className="h-3.5 w-3.5" />
  if (service === 'car') return <Car className="h-3.5 w-3.5" />
  if (service === 'bus') return <BusFront className="h-3.5 w-3.5" />
  return <Plane className="h-3.5 w-3.5" />
}

function portalServiceIcon(item: CorporateDemandListItem): typeof Plane {
  const service = portalService(item)
  if (service === 'hotel') return BedDouble
  if (service === 'car') return Car
  if (service === 'bus') return BusFront
  return Plane
}

function portalDestinationLabel(item: CorporateDemandListItem): string {
  return item.destinationLabel || item.destination || 'Destino não informado'
}

function travelOrderDateLabel(entry: CompanyPortalBoardEntry): string {
  const starts = entry.demands.map(({ item }) => item.travelStartDate).filter(isTextValue).sort()
  const ends = entry.demands.map(({ item }) => item.travelEndDate || item.travelStartDate).filter(isTextValue).sort()
  if (!starts.length) return 'Data não informada'
  const start = starts[0]!
  const end = ends[ends.length - 1] || start
  return end !== start ? `${formatDate(start)} a ${formatDate(end)}` : formatDate(start)
}

function uniqueText(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function isTextValue(value: string | null): value is string {
  return Boolean(value)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Não informado'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function normalizePriority(value: string | null): 'all' | Prioridade {
  return value && ['urgente', 'alta', 'media', 'baixa'].includes(value)
    ? value as Prioridade
    : 'all'
}

function normalizeServiceFilter(value: string | null): CompanyPortalService {
  return value && ['air', 'hotel', 'car', 'bus'].includes(value)
    ? value as CompanyPortalService
    : 'all'
}

function normalizeCreatableService(value: string | null): CreatableCompanyPortalService | null {
  return value && ['air', 'hotel', 'car', 'bus'].includes(value)
    ? value as CreatableCompanyPortalService
    : null
}

function normalizeCreateIntentId(value: string | null): string | null {
  return value && /^intent-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function fallbackCompany(item: CorporateDemandListItem): Empresa {
  return {
    id: item.companyId,
    nome: item.companyName,
    cnpj: '',
    endereco: '',
    responsavel: '',
    email_responsavel: '',
    telefone: '',
    centro_custo_padrao: '',
    ativa: true,
    created_at: item.updatedAt,
  }
}

function companyAccessToEmpresa(company: CorporateCompanyAccessSummary): Empresa {
  return {
    id: company.companyId,
    nome: company.companyName,
    cnpj: '',
    endereco: '',
    responsavel: '',
    email_responsavel: '',
    telefone: '',
    centro_custo_padrao: '',
    ativa: true,
    created_at: '',
  }
}

function demandCapabilities(
  item: CorporateDemandListItem,
  base: CompanyPortalDemandCapabilities,
): CompanyPortalDemandCapabilities {
  return {
    ...base,
    canChooseQuote: item.capabilities.canChooseQuote,
    canApprove: item.capabilities.canDecideAssignedApproval,
    canEditRequest: item.capabilities.canCorrectRequest,
  }
}

const COLUMN_HEADER_CLASSES = {
  pending: 'bg-slate-600 text-white',
  in_progress: 'bg-blue-600 text-white',
  waiting_client: 'bg-amber-500 text-white',
  completed: 'bg-emerald-600 text-white',
  canceled: 'bg-red-500 text-white',
} as const

const TONE_BADGE_CLASSES: Record<CompanyPortalStatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
}

const TONE_PANEL_CLASSES: Record<CompanyPortalStatusTone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
  info: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
  danger: 'border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100',
}

export default CompanyPortalLab

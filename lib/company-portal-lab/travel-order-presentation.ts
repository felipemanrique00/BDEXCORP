import type {
  CompanyPortalDemandStatusPresentation,
  CompanyPortalKanbanColumn,
  CompanyPortalStatusTone,
} from '@/lib/company-portal-lab/demand-status'
import type { CorporateDemandListItem } from '@/lib/company-portal-lab/demand-projection'

export interface CompanyPortalTravelOrderReferenceLike {
  id: string
  orderNumber: string
  status: 'draft' | 'submitting' | 'submitted'
  itemCount: number
  services: string[]
}

export interface CompanyPortalBoardDemand {
  item: CorporateDemandListItem
  status: CompanyPortalDemandStatusPresentation
}

export interface CompanyPortalOrderStatusPresentation {
  kanbanColumn: CompanyPortalKanbanColumn
  statusLabel: string
  waitingOnLabel: string | null
  nextAction: string | null
  tone: CompanyPortalStatusTone
  completedItemCount: number
  actionItemCount: number
}

export interface CompanyPortalBoardEntry {
  key: string
  kind: 'order' | 'legacy'
  orderId: string | null
  orderNumber: string
  companyId: string
  companyName: string
  itemCount: number
  services: string[]
  demands: CompanyPortalBoardDemand[]
  status: CompanyPortalOrderStatusPresentation
  updatedAt: string
}

type OrderAwareDemand = CorporateDemandListItem & {
  travelOrder?: CompanyPortalTravelOrderReferenceLike | null
}

/**
 * Groups only submitted child demands. Private drafts are projected by the
 * travel-order endpoint and intentionally never enter the shared Kanban.
 */
export function groupCompanyPortalBoardEntries(
  demands: readonly CorporateDemandListItem[],
  statuses: ReadonlyMap<string, CompanyPortalDemandStatusPresentation>,
): CompanyPortalBoardEntry[] {
  const grouped = new Map<string, CompanyPortalBoardDemand[]>()
  const orderReferences = new Map<string, CompanyPortalTravelOrderReferenceLike>()

  for (const item of demands) {
    const reference = (item as OrderAwareDemand).travelOrder
    const status = statuses.get(item.id)
    if (!status) continue
    const key = reference?.status === 'submitted' ? `order:${reference.id}` : `legacy:${item.id}`
    const current = grouped.get(key) || []
    current.push({ item, status })
    grouped.set(key, current)
    if (reference?.status === 'submitted') orderReferences.set(key, reference)
  }

  return Array.from(grouped.entries())
    .map(([key, children]) => {
      children.sort((left, right) => servicePosition(left.item.serviceType) - servicePosition(right.item.serviceType))
      const first = children[0]!
      const reference = orderReferences.get(key)
      const services = unique([
        ...(reference?.services || []),
        ...children.map(({ item }) => normalizeService(item.serviceType)),
      ].filter(Boolean))
      return {
        key,
        kind: reference ? 'order' as const : 'legacy' as const,
        orderId: reference?.id || null,
        orderNumber: reference?.orderNumber || first.item.demandNumber,
        companyId: first.item.companyId,
        companyName: first.item.companyName,
        itemCount: reference ? Math.max(reference.itemCount, children.length) : 1,
        services,
        demands: children,
        status: aggregateCompanyPortalOrderStatus(children.map(({ status }) => status)),
        updatedAt: children.reduce(
          (latest, child) => latestTimestamp(latest, child.item.updatedAt),
          first.item.updatedAt,
        ),
      }
    })
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
}

export function aggregateCompanyPortalOrderStatus(
  statuses: readonly CompanyPortalDemandStatusPresentation[],
): CompanyPortalOrderStatusPresentation {
  if (!statuses.length) {
    return {
      kanbanColumn: 'pending',
      statusLabel: 'Pedido sem serviços enviados',
      waitingOnLabel: null,
      nextAction: null,
      tone: 'neutral',
      completedItemCount: 0,
      actionItemCount: 0,
    }
  }

  if (statuses.length === 1) return singleStatus(statuses[0]!)

  const completedItemCount = statuses.filter(({ kanbanColumn }) => (
    kanbanColumn === 'completed' || kanbanColumn === 'canceled'
  )).length
  const waitingStatuses = statuses.filter(({ kanbanColumn }) => kanbanColumn === 'waiting_client')
  const actionItemCount = waitingStatuses.length
  const allCanceled = statuses.every(({ kanbanColumn }) => kanbanColumn === 'canceled')
  const allClosed = completedItemCount === statuses.length
  const uniqueLabels = unique(statuses.map(({ statusLabel }) => statusLabel))

  if (allCanceled) {
    return orderStatus('canceled', 'Pedido cancelado', null, 'Todos os serviços deste pedido foram cancelados.', 'danger', completedItemCount, 0)
  }
  if (allClosed) {
    const label = statuses.every(({ kanbanColumn }) => kanbanColumn === 'completed')
      ? 'Todos os serviços finalizados'
      : 'Serviços encerrados'
    return orderStatus('completed', label, null, `${completedItemCount} de ${statuses.length} serviços encerrados.`, 'success', completedItemCount, 0)
  }
  if (waitingStatuses.length) {
    const waitingOnLabels = unique(waitingStatuses.map(({ waitingOnLabel }) => waitingOnLabel).filter(isText))
    const waitingOnLabel = waitingOnLabels.length === 1 ? waitingOnLabels[0]! : 'Cliente'
    return orderStatus(
      'waiting_client',
      waitingStatuses.length === 1 ? '1 serviço aguarda sua ação' : `${waitingStatuses.length} serviços aguardam sua ação`,
      waitingOnLabel,
      `Abra o pedido e acompanhe separadamente ${waitingStatuses.length} de ${statuses.length} serviços.`,
      'warning',
      completedItemCount,
      waitingStatuses.length,
    )
  }
  const attentionStatuses = statuses.filter(({ tone, kanbanColumn }) => tone === 'danger' && kanbanColumn !== 'canceled')
  if (attentionStatuses.length) {
    return orderStatus(
      statuses.some(({ kanbanColumn }) => kanbanColumn === 'in_progress') ? 'in_progress' : 'pending',
      attentionStatuses.length === 1 ? '1 serviço requer atenção' : `${attentionStatuses.length} serviços requerem atenção`,
      commonWaitingOn(attentionStatuses),
      `Abra o pedido para revisar ${attentionStatuses.length} de ${statuses.length} serviços.`,
      'danger',
      completedItemCount,
      attentionStatuses.length,
    )
  }
  if (statuses.some(({ kanbanColumn }) => kanbanColumn === 'in_progress')) {
    return orderStatus(
      'in_progress',
      completedItemCount ? `${completedItemCount} de ${statuses.length} serviços finalizados` : 'Pedido em andamento',
      commonWaitingOn(statuses),
      'Os serviços seguem etapas independentes dentro deste pedido.',
      'info',
      completedItemCount,
      0,
    )
  }
  if (statuses.some(({ kanbanColumn }) => kanbanColumn === 'pending')) {
    return orderStatus(
      'pending',
      uniqueLabels.length === 1 ? uniqueLabels[0]! : 'Pedido recebido pela agência',
      commonWaitingOn(statuses),
      'A agência deve analisar os serviços enviados.',
      'neutral',
      completedItemCount,
      0,
    )
  }

  return orderStatus('pending', 'Pedido em acompanhamento', commonWaitingOn(statuses), null, 'neutral', completedItemCount, 0)
}

function singleStatus(status: CompanyPortalDemandStatusPresentation): CompanyPortalOrderStatusPresentation {
  return {
    kanbanColumn: status.kanbanColumn,
    statusLabel: status.statusLabel,
    waitingOnLabel: status.waitingOnLabel,
    nextAction: status.nextAction,
    tone: status.tone,
    completedItemCount: status.kanbanColumn === 'completed' || status.kanbanColumn === 'canceled' ? 1 : 0,
    actionItemCount: status.kanbanColumn === 'waiting_client' ? 1 : 0,
  }
}

function orderStatus(
  kanbanColumn: CompanyPortalKanbanColumn,
  statusLabel: string,
  waitingOnLabel: string | null,
  nextAction: string | null,
  tone: CompanyPortalStatusTone,
  completedItemCount: number,
  actionItemCount: number,
): CompanyPortalOrderStatusPresentation {
  return { kanbanColumn, statusLabel, waitingOnLabel, nextAction, tone, completedItemCount, actionItemCount }
}

function commonWaitingOn(statuses: readonly CompanyPortalDemandStatusPresentation[]): string | null {
  const labels = unique(statuses.map(({ waitingOnLabel }) => waitingOnLabel).filter(isText))
  return labels.length === 1 ? labels[0]! : labels.length ? 'Várias etapas' : null
}

function normalizeService(value: string): string {
  const service = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (service === 'aereo' || service === 'air') return 'air'
  if (service === 'hotel' || service === 'hotelaria' || service.includes('hosped')) return 'hotel'
  if (service === 'car' || service === 'carro' || service.includes('locacao')) return 'car'
  if (service === 'bus' || service.includes('rodovi')) return 'bus'
  return service
}

function servicePosition(value: string): number {
  return ['air', 'hotel', 'car', 'bus'].indexOf(normalizeService(value))
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function isText(value: string | null): value is string {
  return Boolean(value)
}

function latestTimestamp(left: string, right: string): string {
  return timestamp(right) > timestamp(left) ? right : left
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

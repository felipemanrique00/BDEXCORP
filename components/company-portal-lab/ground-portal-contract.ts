import type {
  CompanyPortalDemandCapabilities,
  CompanyPortalPersona,
} from '@/lib/company-portal-lab/demand-status'
import type { CorporateDemandListItem } from '@/lib/company-portal-lab/demand-projection'

export type GroundPortalService = 'car' | 'bus'

export interface GroundPortalFlowVisibility {
  canEditAfterRejection: boolean
  showQuoteWorkspace: boolean
  showApprovalWorkspace: boolean
  showOperationWorkspace: boolean
  showVoucherWorkspace: boolean
}

export function groundPortalService(item: CorporateDemandListItem): GroundPortalService | null {
  const service = normalize(item.serviceType)
  if (['car', 'carro', 'locacao', 'locacao de veiculo'].includes(service)) return 'car'
  if (['bus', 'rodoviario', 'onibus', 'passagem rodoviaria'].includes(service)) return 'bus'
  return null
}

export function isOfflineGroundPortalItem(item: CorporateDemandListItem): boolean {
  return Boolean(groundPortalService(item))
    && item.bookingMode !== 'online'
}

export function groundPortalDestinationLabel(item: CorporateDemandListItem): string {
  return String(item.destinationLabel || item.destination || '').trim()
    || 'Destino nao informado'
}

export function resolveGroundPortalFlowVisibility(
  item: CorporateDemandListItem,
  persona: CompanyPortalPersona,
  capabilities: CompanyPortalDemandCapabilities,
): GroundPortalFlowVisibility {
  const lifecycle = String(item.lifecycleStatus || '').trim().toLowerCase()
  return {
    canEditAfterRejection: item.capabilities.canCorrectRequest,
    showQuoteWorkspace: (persona === 'consultant' || persona === 'requester')
      && (capabilities.canPrepareQuotation === true || capabilities.canChooseQuote === true)
      && ['draft', 'submitted', 'approved_for_quotation', 'quoting', 'pending_choice', 'failed'].includes(lifecycle),
    showApprovalWorkspace: item.capabilities.canDecideAssignedApproval
      && (['pending_merit_approval', 'pending_cost_approval'].includes(lifecycle)
        || item.hasActiveApproval),
    showOperationWorkspace: persona === 'consultant'
      && !item.hasActiveApproval
      && ((capabilities.canReserve === true && ['approved', 'reserving'].includes(lifecycle))
        || (capabilities.canIssue === true
          && ['approved', 'reserving', 'reserved', 'pending_issuance'].includes(lifecycle))),
    showVoucherWorkspace: capabilities.canViewVoucher === true
      && ['issued', 'partially_issued', 'closed'].includes(lifecycle),
  }
}

function normalize(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

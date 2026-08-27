import type { CorporateDemandListItem } from '@/lib/company-portal-lab/demand-projection'
import type {
  CompanyPortalDemandCapabilities,
  CompanyPortalPersona,
} from '@/lib/company-portal-lab/demand-status'

export interface HotelPortalFlowVisibility {
  canEditAfterRejection: boolean
  showQuoteWorkspace: boolean
  showChoiceWorkspace: boolean
  showApprovalWorkspace: boolean
  showOperationWorkspace: boolean
  showVoucherWorkspace: boolean
}

export function isOfflineHotelPortalItem(item: CorporateDemandListItem): boolean {
  const service = normalizeText(item.serviceType)
  return (
    service === 'hotel'
    || service === 'hotelaria'
    || service.includes('hosped')
  ) && item.bookingMode !== 'online'
}

export function hotelPortalDestinationLabel(item: CorporateDemandListItem): string {
  return String(item.destinationLabel || item.destination || '').trim()
    || 'Destino não informado'
}

export function resolveHotelPortalFlowVisibility(
  item: CorporateDemandListItem,
  persona: CompanyPortalPersona,
  capabilities: CompanyPortalDemandCapabilities,
): HotelPortalFlowVisibility {
  const lifecycleStatus = String(item.lifecycleStatus || '').trim().toLowerCase()
  const canEditAfterRejection = item.capabilities.canCorrectRequest

  return {
    canEditAfterRejection,
    showQuoteWorkspace: persona === 'consultant'
      && capabilities.canPrepareQuotation === true
      && ['draft', 'submitted', 'approved_for_quotation', 'quoting', 'pending_choice', 'failed'].includes(lifecycleStatus),
    showChoiceWorkspace: item.capabilities.canChooseQuote,
    showApprovalWorkspace: item.capabilities.canDecideAssignedApproval
      && (
        ['pending_merit_approval', 'pending_cost_approval'].includes(lifecycleStatus)
        || item.hasActiveApproval
      ),
    showOperationWorkspace: persona === 'consultant'
      && !item.hasActiveApproval
      && (
        (capabilities.canReserve === true && ['approved', 'reserving'].includes(lifecycleStatus))
        || (
          capabilities.canIssue === true
          && ['approved', 'reserving', 'reserved', 'pending_issuance'].includes(lifecycleStatus)
        )
      ),
    showVoucherWorkspace: capabilities.canViewVoucher === true
      && ['issued', 'partially_issued', 'closed'].includes(lifecycleStatus),
  }
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

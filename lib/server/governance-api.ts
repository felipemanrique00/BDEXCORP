import 'server-only'

import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

import { AiChatHistoryError } from '@/lib/server/ai-chat-history-service'
import { AiAgentOperationError } from '@/lib/server/ai-agent-operation-service'
import { AiActionServiceError } from '@/lib/server/ai-action-service'
import { AiConfigServiceError } from '@/lib/server/ai-config-service'
import { AiGatewayError } from '@/lib/server/ai-gateway-service'
import { ApprovalWorkflowError } from '@/lib/approvals'
import { AutomationServiceError } from '@/lib/server/automation-service'
import { TechIntegrationError } from '@/lib/integrations/tech/tech-errors'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import { CorporateFinanceServiceError } from '@/lib/server/corporate-finance-service'
import { CorporateBrandingServiceError } from '@/lib/server/corporate-branding-error'
import { CommercialSupplierServiceError } from '@/lib/server/commercial-supplier-service'
import { CostCenterServiceError } from '@/lib/server/cost-center-service'
import { DemandServiceError } from '@/lib/server/demand-service'
import { DemandTransferError } from '@/lib/server/demand-transfer-service'
import { DomainRolloutError } from '@/lib/server/domain-rollout-service'
import { EmployeeIdentityError } from '@/lib/server/employee-identity-service'
import { FinanceServiceError } from '@/lib/server/finance-service'
import { GeographyServiceError } from '@/lib/server/geography-service'
import { HotelCatalogServiceError } from '@/lib/server/hotel-catalog-service'
import { IntegrationCompanyMappingError } from '@/lib/server/integration-company-mapping-service'
import { IntegrationProviderServiceError } from '@/lib/server/integration-provider-service'
import { IntelligenceServiceError } from '@/lib/server/intelligence-service'
import { KnowledgeServiceError } from '@/lib/server/knowledge-service'
import { logError } from '@/lib/server/logger'
import { ManualHotelBookingError } from '@/lib/server/manual-hotel-booking-service'
import { OperationalCommunicationError } from '@/lib/server/operational-communication-service'
import { OfflineTravelError } from '@/lib/server/offline-travel-service'
import { PolicyServiceError } from '@/lib/server/policy-service'
import { ReconciliationServiceError } from '@/lib/server/reconciliation-service'
import { ReportSnapshotError } from '@/lib/server/report-snapshot-service'
import { TravelGovernanceError } from '@/lib/server/travel-governance-service'
import { TravelOperationReconciliationError } from '@/lib/server/travel-operation-reconciliation-service'
import { TravelRefundError } from '@/lib/server/travel-refund-service'
import { VoucherServiceError } from '@/lib/server/voucher-service'
import { VoucherPresentationServiceError } from '@/lib/server/voucher-presentation-service'
import { WintourEmissorMappingError } from '@/lib/server/wintour-emissor-mapping-service'
import { TravelLifecycleError } from '@/lib/travel-lifecycle'
import { EnterpriseWorkflowError } from '@/lib/workflows'

export function governanceErrorResponse(error: unknown, requestId: string): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', error: 'Dados invalidos.', details: error.flatten(), requestId },
      { status: 400, headers: { 'X-Request-Id': requestId } },
    )
  }
  if (
    error instanceof PolicyServiceError
    || error instanceof ApprovalWorkflowError
    || error instanceof EnterpriseWorkflowError
    || error instanceof TravelLifecycleError
    || error instanceof EmployeeIdentityError
    || error instanceof TravelRefundError
    || error instanceof TravelOperationReconciliationError
    || error instanceof VoucherServiceError
    || error instanceof VoucherPresentationServiceError
    || error instanceof CorporateBrandingServiceError
  ) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message, requestId },
      { status: error.status, headers: { 'X-Request-Id': requestId } },
    )
  }
  if (error instanceof TechIntegrationError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message, requestId },
      { status: error.status, headers: { 'X-Request-Id': requestId } },
    )
  }
  if (
    error instanceof DemandServiceError
    || error instanceof CommercialSupplierServiceError
    || error instanceof CostCenterServiceError
    || error instanceof DemandTransferError
    || error instanceof DomainRolloutError
    || error instanceof FinanceServiceError
    || error instanceof GeographyServiceError
    || error instanceof HotelCatalogServiceError
    || error instanceof CorporateFinanceServiceError
    || error instanceof ManualHotelBookingError
    || error instanceof IntegrationCompanyMappingError
    || error instanceof IntegrationProviderServiceError
    || error instanceof ReconciliationServiceError
    || error instanceof TravelGovernanceError
    || error instanceof WintourEmissorMappingError
    || error instanceof AiChatHistoryError
    || error instanceof AiAgentOperationError
    || error instanceof AiActionServiceError
    || error instanceof OperationalCommunicationError
    || error instanceof OfflineTravelError
    || error instanceof AiConfigServiceError
    || error instanceof AiGatewayError
    || error instanceof ReportSnapshotError
    || error instanceof AutomationServiceError
    || error instanceof KnowledgeServiceError
    || error instanceof IntelligenceServiceError
  ) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message, details: error.details, requestId },
      { status: error.status, headers: { 'X-Request-Id': requestId } },
    )
  }
  if (error instanceof CorporateAccessDeniedError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message, requestId },
      { status: 403, headers: { 'X-Request-Id': requestId } },
    )
  }
  logError('governance_api_failed', error, { requestId, errorCode: 'GOVERNANCE_API_FAILED' })
  return NextResponse.json(
    { ok: false, code: 'INTERNAL_ERROR', error: 'Nao foi possivel concluir a operacao.', requestId },
    { status: 500, headers: { 'X-Request-Id': requestId } },
  )
}

export function governanceBodyErrorResponse(
  error: { error: string; status: number },
  requestId: string,
): NextResponse {
  return NextResponse.json(
    { ok: false, code: error.status === 413 ? 'BODY_TOO_LARGE' : 'INVALID_JSON', error: error.error, requestId },
    { status: error.status, headers: { 'X-Request-Id': requestId } },
  )
}

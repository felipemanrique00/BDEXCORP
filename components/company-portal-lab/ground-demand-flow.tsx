'use client'

import { useEffect, useMemo, useState } from 'react'

import { CorporateDemandApprovalPanel } from '@/components/company-portal-lab/corporate-demand-approval-panel'
import type { GroundQuoteRequestContext } from '@/components/company-portal-lab/ground-quote-workspace'
import { GroundQuoteWorkspace } from '@/components/company-portal-lab/ground-quote-workspace'
import type {
  CompanyPortalDemandCapabilities,
  CompanyPortalPersona,
} from '@/lib/company-portal-lab/demand-status'
import type { CorporateDemandDetail } from '@/lib/company-portal-lab/demand-projection'
import type { Empresa } from '@/types'

import { GroundOfflineRequestForm } from './ground-offline-request-form'
import { GroundOperationWorkspace } from './ground-operation-workspace'
import {
  groundPortalService,
  resolveGroundPortalFlowVisibility,
} from './ground-portal-contract'
import { GroundRequestReadonly } from './ground-request-readonly'
import { GroundVoucherWorkspace } from './ground-voucher-workspace'

export interface GroundDemandFlowProps {
  item: CorporateDemandDetail
  company: Empresa
  persona: CompanyPortalPersona
  capabilities: CompanyPortalDemandCapabilities
  onRefresh: () => void
  editRequestToken?: number
  onEditingChange?: (editing: boolean) => void
}

/**
 * Corpo completo de Carro/Rodoviario para uma demanda aberta. O pai mantem o
 * chrome corporativo, o cabecalho Pedido | Servico | Status e o stepper comum.
 */
export function GroundDemandFlow({
  item,
  company,
  persona,
  capabilities,
  onRefresh,
  editRequestToken = 0,
  onEditingChange,
}: GroundDemandFlowProps) {
  const service = groundPortalService(item)
  const visibility = resolveGroundPortalFlowVisibility(item, persona, capabilities)
  const [editingRequest, setEditingRequest] = useState(false)

  useEffect(() => {
    if (!visibility.canEditAfterRejection) setEditingRequest(false)
  }, [visibility.canEditAfterRejection])

  useEffect(() => {
    if (editRequestToken > 0 && visibility.canEditAfterRejection) setEditingRequest(true)
  }, [editRequestToken, visibility.canEditAfterRejection])

  useEffect(() => { onEditingChange?.(editingRequest) }, [editingRequest, onEditingChange])

  const quoteRequest = useMemo<GroundQuoteRequestContext | undefined>(() => {
    if (service === 'car') {
      const ground = item.demand.detalhes_carro?.ground
      return ground ? { service: 'locacao', pickupAt: ground.pickupAt, returnAt: ground.returnAt } : undefined
    }
    if (service === 'bus') {
      const details = item.demand.detalhes_rodoviario
      if (!details?.ground?.legs.length) return undefined
      return {
        service: 'rodoviario',
        legs: details.ground.legs.map((leg, index) => ({
          originCityId: leg.originCityId,
          originCityName: details.leg_snapshots?.[index]?.origin_city_name || 'Origem',
          destinationCityId: leg.destinationCityId,
          destinationCityName: details.leg_snapshots?.[index]?.destination_city_name || 'Destino',
          originTerminalId: leg.originTerminalId || null,
          destinationTerminalId: leg.destinationTerminalId || null,
          departureDate: leg.departureDate,
          earliestDeparture: leg.earliestDeparture || null,
        })),
      }
    }
    return undefined
  }, [item.demand.detalhes_carro, item.demand.detalhes_rodoviario, service])

  if (!service) return null
  const quoteService = service === 'car' ? 'locacao' : 'rodoviario'
  return (
    <div className="space-y-5" data-company-portal-ground-flow data-service={service}>
      <div id="request-action" className="scroll-mt-24">
        {editingRequest && visibility.canEditAfterRejection ? (
          <GroundOfflineRequestForm
            service={service}
            companies={[company]}
            initialCompanyId={item.companyId}
            editingItem={item}
            onCancel={() => setEditingRequest(false)}
            onUpdated={() => { setEditingRequest(false); onRefresh() }}
          />
        ) : (
          <GroundRequestReadonly
            demand={item.demand}
            companyName={item.companyName}
            service={service}
            canEditAfterRejection={visibility.canEditAfterRejection}
            editReason={item.requestAdjustmentReason}
            onEdit={visibility.canEditAfterRejection ? () => setEditingRequest(true) : undefined}
          />
        )}
      </div>

      {!editingRequest && visibility.showQuoteWorkspace ? (
        <div id="quote-action" className="scroll-mt-24">
          <GroundQuoteWorkspace
            demandId={item.id}
            demandNumber={item.demandNumber}
            service={quoteService}
            lifecycleVersion={item.lifecycleVersion}
            requesterId={item.demand.solicitante_id || null}
            canOperateQuotes={persona === 'consultant' && capabilities.canPrepareQuotation === true}
            canChoose={item.capabilities.canChooseQuote}
            request={quoteRequest}
            onCompleted={onRefresh}
          />
        </div>
      ) : null}

      {!editingRequest && visibility.showApprovalWorkspace ? (
        <div id="approval-action" className="scroll-mt-24">
          <CorporateDemandApprovalPanel refreshToken={item.version} demandId={item.id} onDecided={onRefresh} />
        </div>
      ) : null}

      {!editingRequest && visibility.showOperationWorkspace ? (
        <div id="operation-action" className="scroll-mt-24">
          <GroundOperationWorkspace demand={item.demand} company={company} service={quoteService} onCompleted={onRefresh} />
        </div>
      ) : null}

      {!editingRequest && visibility.showVoucherWorkspace ? (
        <div id="voucher-action" className="scroll-mt-24">
          <GroundVoucherWorkspace
            demandId={item.id}
            companyId={item.companyId}
            service={quoteService}
            canSendVoucher={capabilities.canSendVoucher === true}
          />
        </div>
      ) : null}
    </div>
  )
}

export default GroundDemandFlow

'use client'

import { useEffect, useState } from 'react'

import { CorporateDemandApprovalPanel } from '@/components/company-portal-lab/corporate-demand-approval-panel'
import { HotelOfflineRequestForm } from '@/components/company-portal-lab/hotel-offline-request-form'
import { HotelOperationWorkspace } from '@/components/company-portal-lab/hotel-operation-workspace'
import {
  resolveHotelPortalFlowVisibility,
} from '@/components/company-portal-lab/hotel-portal-contract'
import { HotelRequestReadonly } from '@/components/company-portal-lab/hotel-request-readonly'
import { HotelVoucherWorkspace } from '@/components/company-portal-lab/hotel-voucher-workspace'
import { OfflineHotelQuoteForm } from '@/components/travel/offline-hotel-quote-form'
import { OfflineQuoteChoicePanel } from '@/components/travel/offline-quote-choice-panel'
import { corporateDemandAsAtendimento } from '@/lib/company-portal-lab/demand-projection'
import type { CorporateDemandDetail } from '@/lib/company-portal-lab/demand-projection'
import type {
  CompanyPortalDemandCapabilities,
  CompanyPortalPersona,
} from '@/lib/company-portal-lab/demand-status'
import type { Empresa } from '@/types'

export interface HotelDemandFlowProps {
  item: CorporateDemandDetail
  company: Empresa
  persona: CompanyPortalPersona
  capabilities: CompanyPortalDemandCapabilities
  onRefresh: () => void
  /** Lets the parent status CTA request the governed correction form. */
  editRequestToken?: number
  onEditingChange?: (editing: boolean) => void
}

/**
 * Complete hotel body for an already opened company-portal demand. The parent
 * keeps the branded shell, sticky Pedido/status header and common stepper.
 */
export function HotelDemandFlow({
  item,
  company,
  persona,
  capabilities,
  onRefresh,
  editRequestToken = 0,
  onEditingChange,
}: HotelDemandFlowProps) {
  const [editingRequest, setEditingRequest] = useState(false)
  const visibility = resolveHotelPortalFlowVisibility(item, persona, capabilities)

  useEffect(() => {
    if (!visibility.canEditAfterRejection) setEditingRequest(false)
  }, [visibility.canEditAfterRejection])

  useEffect(() => {
    if (editRequestToken > 0 && visibility.canEditAfterRejection) setEditingRequest(true)
  }, [editRequestToken, visibility.canEditAfterRejection])

  useEffect(() => {
    onEditingChange?.(editingRequest)
  }, [editingRequest, onEditingChange])

  return (
    <div className="space-y-5" data-company-portal-hotel-flow>
      <div id="request-action" className="scroll-mt-24">
        {editingRequest && visibility.canEditAfterRejection ? (
          <HotelOfflineRequestForm
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
          <HotelRequestReadonly
            demand={item.demand}
            companyName={item.companyName}
            canEditAfterRejection={visibility.canEditAfterRejection}
            editReason={item.requestAdjustmentReason}
            onEdit={visibility.canEditAfterRejection ? () => setEditingRequest(true) : undefined}
          />
        )}
      </div>

      {!editingRequest && visibility.showChoiceWorkspace && (
        <div id="choice-action" className="scroll-mt-24">
          <OfflineQuoteChoicePanel
            demands={[corporateDemandAsAtendimento(item.demand)]}
            requesterId={item.demand.solicitante_id || null}
            focusDemandId={item.id}
            discoverServerDemands={false}
            onCompleted={onRefresh}
          />
        </div>
      )}

      {!editingRequest && visibility.showQuoteWorkspace && (
        <div id="quote-action" className="scroll-mt-24">
          <OfflineHotelQuoteForm
            demands={[corporateDemandAsAtendimento(item.demand)]}
            companies={[company]}
            initialDemandId={item.id}
            onCompleted={onRefresh}
          />
        </div>
      )}

      {!editingRequest && visibility.showApprovalWorkspace && (
        <div id="approval-action" className="scroll-mt-24">
          <CorporateDemandApprovalPanel
            refreshToken={item.version}
            demandId={item.id}
            onDecided={onRefresh}
          />
        </div>
      )}

      {!editingRequest && visibility.showOperationWorkspace && (
        <div id="operation-action" className="scroll-mt-24">
          <HotelOperationWorkspace demand={item.demand} company={company} onCompleted={onRefresh} />
        </div>
      )}

      {!editingRequest && visibility.showVoucherWorkspace && (
        <div id="voucher-action" className="scroll-mt-24">
          <HotelVoucherWorkspace
            demandId={item.id}
            companyId={item.companyId}
            canSendVoucher={capabilities.canSendVoucher === true}
          />
        </div>
      )}
    </div>
  )
}

export default HotelDemandFlow

'use client'

import { AirVoucherWorkspace } from '@/components/company-portal-lab/air-voucher-workspace'
import type { OfflineGroundQuoteService } from '@/lib/offline-ground/quote-schema'

export interface GroundVoucherWorkspaceProps {
  demandId: string
  companyId: string
  service: OfflineGroundQuoteService
  canSendVoucher?: boolean
}

/**
 * O voucher persistido e o envio por e-mail sao neutros por servico. Este
 * wrapper preserva a identidade do Portal Empresa e restringe a consulta a
 * uma unica demanda terrestre.
 */
export function GroundVoucherWorkspace({
  demandId,
  companyId,
  service,
  canSendVoucher = false,
}: GroundVoucherWorkspaceProps) {
  return (
    <div data-company-portal-ground-voucher={service}>
      <AirVoucherWorkspace
        demandId={demandId}
        companyId={companyId}
        canSendVoucher={canSendVoucher}
      />
    </div>
  )
}

'use client'

import { AirVoucherWorkspace } from '@/components/company-portal-lab/air-voucher-workspace'

interface HotelVoucherWorkspaceProps {
  demandId: string
  companyId: string
  canSendVoucher?: boolean
}

/**
 * Voucher persistence and presentation are service-neutral. This wrapper keeps
 * the hotel portal explicit while reusing the exact document and e-mail flow.
 */
export function HotelVoucherWorkspace(props: HotelVoucherWorkspaceProps) {
  return (
    <div data-company-portal-hotel-voucher>
      <AirVoucherWorkspace {...props} />
    </div>
  )
}

export default HotelVoucherWorkspace

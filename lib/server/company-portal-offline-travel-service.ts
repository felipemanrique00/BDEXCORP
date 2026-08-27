import 'server-only'

import {
  offlineIssueCreateSchema,
  type OfflineIssueResult,
} from '@/lib/offline-travel/schema'
import { issueOfflineReservation } from '@/lib/server/offline-travel-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

/**
 * Corporate portal emissions always finish with a voucher. The server owns
 * this policy so a modified browser payload cannot disable voucher creation.
 */
export async function issueCompanyPortalOfflineReservation(
  principal: RequestPrincipal,
  reservationId: string,
  rawInput: unknown,
): Promise<OfflineIssueResult> {
  const input = offlineIssueCreateSchema.parse(rawInput)
  return issueOfflineReservation(principal, reservationId, {
    ...input,
    generateVoucher: true,
  })
}

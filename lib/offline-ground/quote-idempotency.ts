import type { OfflineGroundQuoteCreateInput } from '@/lib/offline-ground/quote-schema'
import { sha256 } from '@/lib/policy'

export interface OfflineGroundQuoteMaterialPayload {
  service: OfflineGroundQuoteCreateInput['service']
  expiresAt: string | null
  policyJustification: string | null
  options: OfflineGroundQuoteCreateInput['options']
}

/**
 * Keeps every field that can change the commercial meaning of an offline
 * ground quote. The schema has already trimmed text and applied defaults; the
 * policy SHA-256 helper then serializes object keys deterministically while
 * preserving option/segment order.
 */
export function offlineGroundQuoteMaterialPayload(
  input: OfflineGroundQuoteCreateInput,
): OfflineGroundQuoteMaterialPayload {
  return {
    service: input.service,
    expiresAt: input.expiresAt || null,
    policyJustification: input.policyJustification || null,
    options: input.options,
  }
}

export function offlineGroundQuoteMaterialHash(
  input: OfflineGroundQuoteCreateInput,
): string {
  return sha256(offlineGroundQuoteMaterialPayload(input))
}

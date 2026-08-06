import { describe, expect, it } from 'vitest'

import { isOfflineDemandEligibleForOperation } from '@/lib/offline-travel/operation-eligibility'

describe('offline travel operation eligibility', () => {
  it('only exposes hotel demands to reservation after the formal choice is approved', () => {
    for (const lifecycleStatus of [
      'draft',
      'submitted',
      'approved_for_quotation',
      'quoting',
      'pending_choice',
      'pending_cost_approval',
    ]) {
      expect(isOfflineDemandEligibleForOperation({
        serviceKey: 'hotelaria',
        lifecycleStatus,
        operation: 'reservation',
      })).toBe(false)
    }

    expect(isOfflineDemandEligibleForOperation({
      serviceKey: 'hotelaria',
      lifecycleStatus: 'approved',
      operation: 'reservation',
    })).toBe(true)
    expect(isOfflineDemandEligibleForOperation({
      serviceKey: 'hotelaria',
      lifecycleStatus: 'reserving',
      operation: 'reservation_and_issue',
    })).toBe(true)
  })

  it('preserves the existing preparation path for non-hotel services', () => {
    for (const serviceKey of ['aereo', 'locacao', 'rodoviario', 'outros'] as const) {
      expect(isOfflineDemandEligibleForOperation({
        serviceKey,
        lifecycleStatus: 'submitted',
        operation: 'reservation',
      })).toBe(true)
      expect(isOfflineDemandEligibleForOperation({
        serviceKey,
        lifecycleStatus: 'pending_choice',
        operation: 'reservation_and_issue',
      })).toBe(true)
    }
  })

  it('only exposes confirmed reservations to issuance and correction', () => {
    for (const operation of ['issue_existing', 'correct_existing'] as const) {
      expect(isOfflineDemandEligibleForOperation({
        serviceKey: 'hotelaria',
        lifecycleStatus: 'reserved',
        operation,
      })).toBe(true)
      expect(isOfflineDemandEligibleForOperation({
        serviceKey: 'aereo',
        lifecycleStatus: 'pending_issuance',
        operation,
      })).toBe(true)
      expect(isOfflineDemandEligibleForOperation({
        serviceKey: 'hotelaria',
        lifecycleStatus: 'approved',
        operation,
      })).toBe(false)
      expect(isOfflineDemandEligibleForOperation({
        serviceKey: 'outros',
        lifecycleStatus: 'issued',
        operation,
      })).toBe(false)
    }
  })
})

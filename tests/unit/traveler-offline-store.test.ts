import { describe, expect, it } from 'vitest'

import {
  sanitizeTravelerOverviewForOffline,
  travelerOfflineOwnerKey,
} from '@/lib/traveler/offline-store'
import type { TravelerPortalOverview } from '@/lib/traveler/types'

describe('traveler offline storage', () => {
  it('scopes snapshots to the authenticated tenant and user', () => {
    expect(travelerOfflineOwnerKey({ tenantId: ' tenant-a ', userId: ' user-1 ' }))
      .toBe('tenant-a:user-1')
    expect(travelerOfflineOwnerKey({ tenantId: 'tenant-a', userId: 'user-1' }))
      .not.toBe(travelerOfflineOwnerKey({ tenantId: 'tenant-a', userId: 'user-2' }))
  })

  it('keeps only bounded traveler fields and approved URLs', () => {
    const sanitized = sanitizeTravelerOverviewForOffline(overviewFixture())
    const reservation = sanitized.upcomingTrips[0].reservations[0]
    const vouchers = sanitized.upcomingTrips[0].vouchers

    expect(sanitized.profiles).toHaveLength(10)
    expect(sanitized.upcomingTrips).toHaveLength(100)
    expect(sanitized.pastTrips).toHaveLength(100)
    expect(reservation.checkInUrl).toBeNull()
    expect(vouchers[0].downloadUrl).toBe('/api/traveler/vouchers/voucher-1/download')
    expect(vouchers[1].downloadUrl).toBeNull()
    expect(JSON.stringify(sanitized)).not.toMatch(/password|provider_payload|markup/i)
  })
})

function overviewFixture(): TravelerPortalOverview {
  const trip = {
    id: 'trip-1',
    demandId: 'demand-1',
    demandNumber: 'OS-1',
    companyId: 'company-1',
    companyName: 'Empresa Teste',
    destination: 'Goiania',
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    status: 'confirmed',
    serviceType: 'air',
    updatedAt: '2026-07-24T12:00:00.000Z',
    reservations: [{
      id: 'reservation-1',
      serviceType: 'air',
      provider: 'Provider',
      reference: 'ABC123',
      status: 'confirmed',
      startAt: '2026-08-01T12:00:00.000Z',
      endAt: null,
      origin: 'GYN',
      destination: 'GRU',
      flightNumber: 'BBT123',
      terminal: '1',
      gate: '2',
      hotelName: null,
      address: null,
      checkInUrl: 'javascript:alert(1)',
    }],
    vouchers: [{
      id: 'voucher-1',
      code: 'V-1',
      status: 'issued',
      issuedAt: '2026-07-24T12:00:00.000Z',
      hasFile: true,
      downloadUrl: '/api/traveler/vouchers/voucher-1/download',
    }, {
      id: 'voucher-2',
      code: 'V-2',
      status: 'issued',
      issuedAt: null,
      hasFile: true,
      downloadUrl: 'https://attacker.invalid/voucher.pdf',
    }],
    updates: [],
  }
  return {
    generatedAt: '2026-07-24T12:00:00.000Z',
    identitySource: 'requester',
    profiles: Array.from({ length: 12 }, (_, index) => ({
      id: `employee-${index}`,
      identificationCode: String(1000 + index),
      name: `Pessoa ${index}`,
      documentMasked: '*******1234',
      email: `pessoa-${index}@test.invalid`,
      phone: null,
      jobTitle: null,
      department: null,
      costCenter: null,
      companyId: 'company-1',
      companyName: 'Empresa Teste',
    })),
    upcomingTrips: Array.from({ length: 105 }, (_, index) => ({
      ...trip,
      id: `trip-upcoming-${index}`,
    })),
    pastTrips: Array.from({ length: 105 }, (_, index) => ({
      ...trip,
      id: `trip-past-${index}`,
    })),
    support: {
      label: 'Suporte',
      phone: '+55 11 99999-9999',
      email: 'suporte@test.invalid',
      emergencyPhone: null,
    },
  }
}

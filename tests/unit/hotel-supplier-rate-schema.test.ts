import { describe, expect, it } from 'vitest'

import {
  canonicalNightlyAmount,
  createHotelSupplierLinkSchema,
  createHotelSupplierRateSchema,
  updateHotelSupplierRateSchema,
} from '@/lib/hotel-supplier-rates/schema'

const ROOM_TYPE_ID = '7b1d4fb0-146b-4c4f-83d2-2b0e02cc7559'

describe('hotel supplier link and rate schemas', () => {
  it('normalizes a complete supplier-hotel link and validates its period', () => {
    expect(createHotelSupplierLinkSchema.parse({
      hotelId: 'hotel-a',
      reservationEmail: 'reservas@hotel.test',
      paymentMethods: ['faturado', 'cartao virtual'],
      validFrom: '2026-09-01',
      validUntil: '2026-12-31',
      outOfPeriodPolicy: 'warn',
    })).toMatchObject({
      hotelId: 'hotel-a',
      priority: 100,
      billingEnabled: false,
      outOfPeriodPolicy: 'warn',
      isActive: true,
    })

    expect(createHotelSupplierLinkSchema.safeParse({
      hotelId: 'hotel-a',
      validFrom: '2026-12-31',
      validUntil: '2026-09-01',
    }).success).toBe(false)
  })

  it('rejects duplicate payment methods regardless of case', () => {
    expect(createHotelSupplierLinkSchema.safeParse({
      hotelId: 'hotel-a',
      paymentMethods: ['Faturado', 'faturado'],
    }).success).toBe(false)
  })

  it('accepts agreementAmount as the canonical nightly rate and normalizes money', () => {
    const parsed = createHotelSupplierRateSchema.parse({
      roomTypeId: ROOM_TYPE_ID,
      code: 'CORP-SGL',
      validFrom: '2026-09-01',
      validUntil: '2026-12-31',
      rackAmount: '450,00',
      agreementAmount: '330,50',
      taxAmount: '40,26',
      serviceFeeAmount: 15,
      currency: 'brl',
      scopeType: 'restricted',
      scopeTargets: [
        { type: 'company', id: 'company-a' },
        { type: 'group', id: 'group-a' },
      ],
    })

    expect(canonicalNightlyAmount(parsed)).toBe(330.5)
    expect(parsed).toMatchObject({
      rackAmount: 450,
      agreementAmount: 330.5,
      taxAmount: 40.26,
      serviceFeeAmount: 15,
      currency: 'BRL',
      scopeType: 'restricted',
    })
  })

  it('enforces global and restricted scope invariants', () => {
    const base = {
      roomTypeId: ROOM_TYPE_ID,
      code: 'CORP-SGL',
      validFrom: '2026-09-01',
      validUntil: '2026-12-31',
      nightlyAmount: 330,
    }
    expect(createHotelSupplierRateSchema.safeParse({
      ...base,
      scopeType: 'global',
      scopeTargets: [{ type: 'company', id: 'company-a' }],
    }).success).toBe(false)
    expect(createHotelSupplierRateSchema.safeParse({
      ...base,
      scopeType: 'restricted',
      scopeTargets: [],
    }).success).toBe(false)
    expect(createHotelSupplierRateSchema.safeParse({
      ...base,
      scopeType: 'restricted',
      scopeTargets: [
        { type: 'company', id: 'company-a' },
        { type: 'company', id: 'company-a' },
      ],
    }).success).toBe(false)
  })

  it('supports optimistic suspension without requiring a destructive mutation', () => {
    expect(updateHotelSupplierRateSchema.parse({
      expectedVersion: 3,
      isSuspended: true,
    })).toEqual({ expectedVersion: 3, isSuspended: true })
    expect(updateHotelSupplierRateSchema.safeParse({
      expectedVersion: 0,
      isSuspended: true,
    }).success).toBe(false)
  })
})

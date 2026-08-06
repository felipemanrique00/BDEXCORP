import { describe, expect, it } from 'vitest'

import {
  offlineHotelQuoteCreateSchema,
  offlineHotelQuoteOptionSchema,
  offlineQuoteSelectionSchema,
} from '@/lib/offline-travel/quote-schema'

const DEFAULT_LINK_ID = '30b91ae0-475f-47e1-90d8-d71d8c12fa1d'

function option(clientId: string, hotelId: string) {
  return {
    clientId,
    hotelId,
    hotelSupplierId: DEFAULT_LINK_ID,
    roomCategory: 'Apartamento standard',
    mealPlan: 'Cafe da manha',
    nightlyRate: '330.00',
    nightlyTaxes: '40,26',
    serviceFee: 15,
    refundable: false,
    cancellationDeadline: '2026-08-03T15:00:00-03:00',
    cancellationPolicy: 'Cancelamento sem custo ate o prazo informado.',
    paymentTerms: 'Faturado em 15 dias.',
    notes: 'Opcao recebida por e-mail.',
  }
}

function quoteInput() {
  return {
    demandId: 'demand-hotel-1',
    expectedLifecycleVersion: 4,
    expiresAt: '2026-08-04T15:00:00-03:00',
    policyJustification: 'Cotacao offline solicitada pelo cliente.',
    confirmed: true,
    idempotencyKey: 'hotel-quote-create-001',
    options: [
      option('option-client-1', 'hotel-1'),
      option('option-client-2', 'hotel-2'),
    ],
  }
}

describe('offline hotel quote schemas', () => {
  it('normalizes monetary values and applies zero defaults', () => {
    const parsed = offlineHotelQuoteOptionSchema.parse({
      clientId: 'option-client-1',
      hotelId: 'hotel-1',
      hotelSupplierId: DEFAULT_LINK_ID,
      roomCategory: 'Single',
      nightlyRate: '330,50',
      refundable: true,
    })

    expect(parsed.nightlyRate).toBe(330.5)
    expect(parsed.nightlyTaxes).toBe(0)
    expect(parsed.serviceFee).toBe(0)
    expect(parsed.mealPlan).toBeUndefined()
  })

  it('rejects negative, imprecise and invalid monetary values', () => {
    for (const nightlyRate of [-1, '10.001', 'valor-invalido']) {
      expect(offlineHotelQuoteOptionSchema.safeParse({
        clientId: 'option-client-1',
        hotelId: 'hotel-1',
        hotelSupplierId: DEFAULT_LINK_ID,
        roomCategory: 'Single',
        nightlyRate,
        refundable: true,
      }).success).toBe(false)
    }
  })

  it('accepts one to ten unique quote options', () => {
    const parsed = offlineHotelQuoteCreateSchema.parse({
      ...quoteInput(),
      options: [option('option-client-1', 'hotel-1')],
    })

    expect(parsed.options).toHaveLength(1)
    expect(parsed.options[0]).toMatchObject({
      nightlyRate: 330,
      nightlyTaxes: 40.26,
      serviceFee: 15,
    })
  })

  it('tracks a catalog rate and allows the same property from different supplier links', () => {
    const first = {
      ...option('client-1', 'same-hotel'),
      hotelSupplierId: '30b91ae0-475f-47e1-90d8-d71d8c12fa1d',
      pricingMode: 'catalog',
      rateReference: {
        id: '9b355867-dd1b-4ac9-9b78-cb0ee91ff1d9',
        version: 3,
      },
    }
    const second = {
      ...option('client-2', 'same-hotel'),
      hotelSupplierId: '4bc81556-02b8-40c3-b42d-b1421379c66c',
      pricingMode: 'manual',
    }
    const parsed = offlineHotelQuoteCreateSchema.parse({
      ...quoteInput(),
      options: [first, second],
    })

    expect(parsed.options[0]).toMatchObject({
      pricingMode: 'catalog',
      rateReference: { version: 3 },
    })
    expect(parsed.options[1].pricingMode).toBe('manual')
  })

  it('requires supplier and version provenance for a catalog rate', () => {
    expect(offlineHotelQuoteOptionSchema.safeParse({
      ...option('client-1', 'hotel-1'),
      pricingMode: 'catalog',
    }).success).toBe(false)
    expect(offlineHotelQuoteOptionSchema.safeParse({
      ...option('client-1', 'hotel-1'),
      pricingMode: 'manual_override',
    }).success).toBe(false)
    expect(offlineHotelQuoteOptionSchema.safeParse({
      ...option('client-1', 'hotel-1'),
      hotelSupplierId: '30b91ae0-475f-47e1-90d8-d71d8c12fa1d',
      pricingMode: 'manual',
      rateReference: { id: '9b355867-dd1b-4ac9-9b78-cb0ee91ff1d9', version: 1 },
    }).success).toBe(false)
  })

  it('rejects too few or too many options', () => {
    expect(offlineHotelQuoteCreateSchema.safeParse({
      ...quoteInput(),
      options: [],
    }).success).toBe(false)
    expect(offlineHotelQuoteCreateSchema.safeParse({
      ...quoteInput(),
      options: Array.from({ length: 11 }, (_, index) => option(`client-${index}`, `hotel-${index}`)),
    }).success).toBe(false)
  })

  it('rejects duplicate client and hotel identifiers', () => {
    const duplicateClient = offlineHotelQuoteCreateSchema.safeParse({
      ...quoteInput(),
      options: [option('same-client', 'hotel-1'), option('same-client', 'hotel-2')],
    })
    expect(duplicateClient.success).toBe(false)
    if (!duplicateClient.success) {
      expect(duplicateClient.error.issues.some((issue) => issue.path.join('.') === 'options.1.clientId')).toBe(true)
    }

    const duplicateHotel = offlineHotelQuoteCreateSchema.safeParse({
      ...quoteInput(),
      options: [option('client-1', 'same-hotel'), option('client-2', 'same-hotel')],
    })
    expect(duplicateHotel.success).toBe(false)
    if (!duplicateHotel.success) {
      expect(duplicateHotel.error.issues.some((issue) => issue.path.join('.') === 'options.1.hotelId')).toBe(true)
    }
  })

  it('requires ISO dates, confirmation and bounded idempotency', () => {
    expect(offlineHotelQuoteCreateSchema.safeParse({ ...quoteInput(), expiresAt: '04/08/2026' }).success).toBe(false)
    expect(offlineHotelQuoteCreateSchema.safeParse({ ...quoteInput(), confirmed: false }).success).toBe(false)
    expect(offlineHotelQuoteCreateSchema.safeParse({ ...quoteInput(), idempotencyKey: '1234567' }).success).toBe(false)
    expect(offlineHotelQuoteCreateSchema.safeParse({ ...quoteInput(), idempotencyKey: 'x'.repeat(201) }).success).toBe(false)
  })

  it('validates quote selection identifiers and lifecycle version', () => {
    const valid = {
      demandId: 'demand-hotel-1',
      quoteId: '30b91ae0-475f-47e1-90d8-d71d8c12fa1d',
      optionId: '9b355867-dd1b-4ac9-9b78-cb0ee91ff1d9',
      expectedLifecycleVersion: 5,
      confirmed: true,
      idempotencyKey: 'hotel-quote-select-001',
    }
    expect(offlineQuoteSelectionSchema.parse(valid).expectedLifecycleVersion).toBe(5)
    expect(offlineQuoteSelectionSchema.safeParse({ ...valid, quoteId: 'not-a-uuid' }).success).toBe(false)
    expect(offlineQuoteSelectionSchema.safeParse({ ...valid, optionId: 'not-a-uuid' }).success).toBe(false)
    expect(offlineQuoteSelectionSchema.safeParse({ ...valid, expectedLifecycleVersion: 0 }).success).toBe(false)
    expect(offlineQuoteSelectionSchema.safeParse({ ...valid, confirmed: false }).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { calculateAirQuotePricing } from '@/lib/offline-travel/services/air/pricing'

describe('offline air quote pricing', () => {
  it('sums fare, taxes, RAV and RAC in minor units', () => {
    expect(calculateAirQuotePricing({
      fare: '3.678,74'.replace('.', ''),
      taxes: '110,96',
      rav: 0,
      rac: '15.00',
    })).toEqual({
      fareMinor: 367874,
      taxesMinor: 11096,
      ravMinor: 0,
      racMinor: 1500,
      totalMinor: 380470,
      fare: 3678.74,
      taxes: 110.96,
      rav: 0,
      rac: 15,
      total: 3804.7,
    })
  })

  it('defaults optional charge lines to zero', () => {
    expect(calculateAirQuotePricing({ fare: '399.90' })).toMatchObject({
      totalMinor: 39990,
      total: 399.9,
      taxes: 0,
      rav: 0,
      rac: 0,
    })
  })

  it('rejects negative and imprecise monetary values', () => {
    expect(() => calculateAirQuotePricing({ fare: -1 })).toThrow()
    expect(() => calculateAirQuotePricing({ fare: '10.001' })).toThrow()
  })
})

import { describe, expect, it } from 'vitest'

import { techCreateQuote, techCreateReservation } from '@/lib/integrations/tech/tech-adapter'

describe('Tech Travel capability safeguards', () => {
  it('rejects reservation execution without explicit confirmation', async () => {
    await expect(techCreateReservation({ service: 'aereo', confirmed: false })).rejects.toMatchObject({
      code: 'TECH_RESERVATION_CONFIRMATION_REQUIRED',
      status: 409,
    })
  })

  it('rejects quote services without a documented availability endpoint', async () => {
    await expect(techCreateQuote({ service: 'locacao' })).rejects.toMatchObject({
      code: 'TECH_QUOTE_CAPABILITY_UNAVAILABLE',
      status: 501,
    })
  })

  it('rejects reservation services without a documented creation endpoint', async () => {
    await expect(techCreateReservation({ service: 'locacao', confirmed: true })).rejects.toMatchObject({
      code: 'TECH_RESERVATION_CAPABILITY_UNAVAILABLE',
      status: 501,
    })
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const serviceSource = readFileSync(
  resolve(process.cwd(), 'lib/server/offline-quote-service.ts'),
  'utf8',
)

describe('offline hotel quote round integrity', () => {
  it('supersedes older unselected rounds without deleting their history', () => {
    expect(serviceSource).toContain('supersedePreviousOfflineHotelQuoteRounds(')
    expect(serviceSource).toMatch(/update travel_quotes previous_quote[\s\S]*status = 'expired'/)
    expect(serviceSource).toContain("previous_quote.status in ('pending', 'completed')")
    expect(serviceSource).toContain('travel_quote_selections selection')
    expect(serviceSource).toContain("'travel.quote.superseded'")
    expect(serviceSource).not.toMatch(/delete from travel_quotes/i)
  })

  it('serializes selection with publication and requires the latest round', () => {
    const demandLock = serviceSource.indexOf(
      'const demand = await loadQuoteDemand(client, principal.tenantId, input.demandId, true)',
    )
    const optionLock = serviceSource.indexOf(
      'const option = await loadSelectionContext(client, principal.tenantId, input)',
      demandLock,
    )

    expect(demandLock).toBeGreaterThan(-1)
    expect(optionLock).toBeGreaterThan(demandLock)
    expect(serviceSource).toContain('as is_current_round')
    expect(serviceSource).toContain('OFFLINE_SELECTION_QUOTE_NOT_CURRENT')
  })

  it('rejects failed, expired and already selected rounds explicitly', () => {
    expect(serviceSource).toContain('OFFLINE_SELECTION_ALREADY_EXISTS')
    expect(serviceSource).toContain('OFFLINE_SELECTION_QUOTE_EXPIRED')
    expect(serviceSource).toContain('OFFLINE_SELECTION_QUOTE_FAILED')
    expect(serviceSource).toContain("option.quote_status !== 'completed'")
    expect(serviceSource).not.toContain("['completed', 'selected'].includes(option.quote_status)")
  })
})

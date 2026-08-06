import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const portalSource = readFileSync(
  resolve(process.cwd(), 'app/dashboard/portal-empresa/page.tsx'),
  'utf8',
)
const choicePanelSource = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-quote-choice-panel.tsx'),
  'utf8',
)

describe('offline hotel quote choice UI', () => {
  it('is exposed only to the authenticated requester profile', () => {
    expect(portalSource).toContain('isRequesterUser(authenticatedUser)')
    expect(portalSource).toContain('<OfflineQuoteChoicePanel')
  })

  it('uses exact requester ownership when the requester id is available', () => {
    expect(choicePanelSource).toContain("String(demand.solicitante_id || '') !== exactRequesterId")
    expect(choicePanelSource).toContain('if (!isHotelDemand(demand) || isClosedDemand(demand)) continue')
    expect(choicePanelSource).toContain("String(list.lifecycleStatus || '') !== 'pending_choice'")
    expect(choicePanelSource).not.toContain('solicitante_nome ===')
    expect(choicePanelSource).not.toContain('passageiro_nome ===')
  })

  it('refreshes pending choices from the relational server instead of trusting stale browser state', () => {
    expect(choicePanelSource).toContain("listDemandsFromServer({ lifecycleStatus: 'pending_choice', limit: 200 })")
    expect(choicePanelSource).toContain('result.items.map((item) => item.demand)')
    expect(choicePanelSource).toContain('[...demands, ...serverDemands]')
  })

  it('exposes only the current eligible quote round to the requester', () => {
    expect(choicePanelSource).toContain('const currentQuote = (list.quotes || [])[0]')
    expect(choicePanelSource).toContain("currentQuote.status !== 'completed'")
    expect(choicePanelSource).toContain('isQuoteExpired(currentQuote, Date.now())')
    expect(choicePanelSource).toContain('hasActiveSelection(currentQuote)')
    expect(choicePanelSource).not.toContain('for (const quote of list.quotes || [])')
  })

  it('silently omits server-denied demands and sends a governed idempotent selection', () => {
    expect(choicePanelSource).toContain('REQUESTER_HIDDEN_STATUSES = new Set([403, 404])')
    expect(choicePanelSource).toContain('selectOfflineQuoteOptionFromServer({')
    expect(choicePanelSource).toContain('expectedLifecycleVersion: lifecycleVersion')
    expect(choicePanelSource).toContain('idempotencyKey,')
    expect(choicePanelSource).toContain('confirmed: true')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const portal = read('components/company-portal-lab/company-portal-lab.tsx')

describe('company portal multi-service order board', () => {
  it('opens one private builder and resumes an owned draft without exposing it in the Kanban', () => {
    expect(portal).toContain('<TravelOrderBuilder')
    expect(portal).toContain('initialOrderId={draftOrderId || undefined}')
    expect(portal).toContain('data-private-travel-order-drafts')
    expect(portal).toContain("order.status !== 'submitted'")
    expect(portal).toContain('(order.capabilities.canEdit || order.capabilities.canSubmit)')
    expect(portal).toContain("params.set('draft', orderId)")
    expect(portal).toContain("params.set('new', 'order')")
  })

  it('keeps creation lazy, carries a stable intent and canonicalizes only after the first item', () => {
    const draftCreated = portal.slice(
      portal.indexOf('function handleBuilderOrderChange'),
      portal.indexOf('function handleOrderSubmitted'),
    )
    expect(portal).toContain("params.set('intent', intentId)")
    expect(portal).toContain('createIntentId={createIntentId || undefined}')
    expect(portal).not.toContain('onDraftCreated=')
    expect(draftCreated).toContain('if (order.itemCount < 1')
    expect(draftCreated).toContain("params.set('draft', order.id)")
    expect(draftCreated).toContain("params.delete('intent')")
  })

  it('hides only legacy empty parent drafts while preserving every draft with a saved service', () => {
    expect(portal).toContain('(order.itemCount > 0 || order.services.length > 0)')
  })

  it('groups public child demands by Pedido and keeps legacy cards addressable by demand', () => {
    expect(portal).toContain('groupCompanyPortalBoardEntries(items, statusById)')
    expect(portal).toContain("entry.kind === 'order'")
    expect(portal).toContain('? travelOrderHref(searchParams, entry.orderId)')
    expect(portal).toContain(': demandHref(searchParams, entry.demands[0]!.item.id)')
  })

  it('opens the parent Pedido and lets each child retain its own lifecycle workspace', () => {
    expect(portal).toContain('getCompanyPortalTravelOrder(selectedOrderId')
    expect(portal).toContain('<TravelOrderDetail')
    expect(portal).toContain('Cada serviço mantém sua própria cotação, escolha, aprovação, emissão e voucher.')
    expect(portal).toContain('<DemandDetail')
    expect(portal).toContain('embedded')
    expect(portal).toContain("if (travelOrder?.status === 'submitted')")
    expect(portal).toContain("params.set('order', travelOrder.id)")
  })

  it('opens Aéreo, Hotel, Locação and Rodoviário in the same private Pedido builder', () => {
    expect(portal).toContain('|| Boolean(newDemandService)')
    expect(portal).toContain("params.set('new', serviceFilter === 'all' ? 'order' : serviceFilter)")
    expect(portal).toContain('initialService={newDemandService || undefined}')
    expect(portal).not.toContain('<GroundOfflineRequestForm')
  })
})

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createCompanyPortalTravelOrder,
  getCompanyPortalRequesterSelfProfile,
} from '@/lib/company-portal-lab/travel-order-client'

describe('company portal travel-order client', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the canonical requester profile without mutating a travel order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      profile: {
        id: 'requester-a',
        name: 'Maria Solicitante',
        email: 'maria@example.com',
        hasActivePortalAccess: true,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCompanyPortalRequesterSelfProfile('company a')).resolves.toEqual({
      id: 'requester-a',
      name: 'Maria Solicitante',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/me/requester-profile?companyId=company%20a')
    expect(init.method).toBeUndefined()
    expect(init.cache).toBe('no-store')
  })

  it('sends the same stable idempotency key in the create header and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      order: { id: 'order-a' },
      replayed: false,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const idempotencyKey = 'company-portal:travel-order:create:intent-12345678'
    await createCompanyPortalTravelOrder({ companyId: 'company-a', idempotencyKey }, {
      scopeType: 'company',
      scopeId: 'company-a',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/company-portal/travel-orders?scopeType=company&scopeId=company-a')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(idempotencyKey)
    expect(JSON.parse(String(init.body))).toEqual({ companyId: 'company-a', idempotencyKey })
  })
})

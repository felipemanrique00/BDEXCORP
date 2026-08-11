import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listAgencyDemandOptionsFromServer } from '@/lib/demands-client'

describe('agency demand participant options client', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends requesterQ, participant and a bounded limit to the endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      companyId: 'company-a',
      requesters: [{
        id: 'requester-a',
        employeeId: 'employee-a',
        name: 'Maria Solicitante',
        email: 'maria@example.com',
        department: 'Financeiro',
        costCenter: 'FIN-001',
      }],
      requesterTotal: 1,
      travelers: [],
      travelerTotal: 0,
      limit: 100,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listAgencyDemandOptionsFromServer('company-a', {
      requesterQ: '  Maria  ',
      participant: 'requesters',
      limit: 500,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const query = new URL(url, 'http://localhost').searchParams
    expect(query.get('companyId')).toBe('company-a')
    expect(query.get('requesterQ')).toBe('Maria')
    expect(query.get('participant')).toBe('requesters')
    expect(query.get('limit')).toBe('100')
    expect(query.has('travelerQ')).toBe(false)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store' })
    expect(result).toMatchObject({
      requesterTotal: 1,
      travelerTotal: 0,
      limit: 100,
    })
  })
})

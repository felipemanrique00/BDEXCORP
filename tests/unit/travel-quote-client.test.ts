import { afterEach, describe, expect, it, vi } from 'vitest'

import { listTravelQuotesFromServer } from '@/lib/travel/quote-client'
import { listTravelReservationsFromServer } from '@/lib/travel/reservation-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('travel quote client', () => {
  it('sends only the requested context selector and pagination to the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, items: [], total: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    await listTravelQuotesFromServer({
      groupId: 'group-01',
      status: 'completed',
      limit: 40,
      offset: 20,
    }, controller.signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    const search = new URL(String(url), 'http://localhost').searchParams
    expect(Object.fromEntries(search)).toEqual({
      groupId: 'group-01',
      status: 'completed',
      limit: '40',
      offset: '20',
    })
    expect(init).toMatchObject({
      cache: 'no-store',
      signal: controller.signal,
    })
  })

  it('surfaces the server authorization error instead of returning a local fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: 'Grupo fora do escopo autorizado.' }),
    }))

    await expect(listTravelQuotesFromServer({ groupId: 'group-denied' }))
      .rejects.toThrow('Grupo fora do escopo autorizado.')
  })

  it('uses the server-scoped company selector when listing real reservations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, items: [], total: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await listTravelReservationsFromServer({
      companyId: 'company-01',
      status: 'reserved',
      limit: 25,
    })

    const [url] = fetchMock.mock.calls[0]
    const search = new URL(String(url), 'http://localhost').searchParams
    expect(Object.fromEntries(search)).toEqual({
      companyId: 'company-01',
      status: 'reserved',
      limit: '25',
      offset: '0',
    })
  })
})

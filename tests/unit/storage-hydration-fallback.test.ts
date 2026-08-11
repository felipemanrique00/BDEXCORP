import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  hydrateServerStorage,
  hydrateServerStorageWithResult,
  applyDomainApiValueLocally,
  safeRemove,
  safeSetRaw,
} from '@/lib/storage-quota'

function createLocalStorage(initialEntries: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initialEntries))
  return {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
    removeItem: vi.fn((key: string) => entries.delete(key)),
  }
}

function createDeferredResponse() {
  let resolve!: (response: { ok: boolean; json: () => Promise<unknown> }) => void
  const promise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('shared storage hydration fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('aceita o cache local quando a API desabilita explicitamente o storage compartilhado', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: false, entries: {} }),
    })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(hydrateServerStorage(false, ['bbt-data-v4'])).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('mantem erro HTTP como falha real de hidratacao', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    await expect(hydrateServerStorage(false, ['bbt-data-v4'])).resolves.toBe(false)
  })

  it('descarta uma resposta remota iniciada antes de um set local compartilhado', async () => {
    const deferred = createDeferredResponse()
    const localStorage = createLocalStorage()
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    })
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(deferred.promise))

    const hydration = hydrateServerStorageWithResult(true, ['bbt-data-v4'])
    expect(safeSetRaw('bbt-data-v4', JSON.stringify({ source: 'local' }))).toBe(true)
    deferred.resolve({
      ok: true,
      json: async () => ({ scoped: true, entries: { 'bbt-data-v4': { source: 'remote' } } }),
    })

    await expect(hydration).resolves.toBe('superseded')
    expect(localStorage.getItem('bbt-data-v4')).toBe(JSON.stringify({ source: 'local' }))
  })

  it('descarta uma resposta remota iniciada antes de um remove local compartilhado', async () => {
    const deferred = createDeferredResponse()
    const localStorage = createLocalStorage({
      'bbt-data-v4': JSON.stringify({ source: 'local' }),
    })
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    })
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(deferred.promise))

    const hydration = hydrateServerStorageWithResult(true, ['bbt-data-v4'])
    safeRemove('bbt-data-v4')
    deferred.resolve({
      ok: true,
      json: async () => ({ scoped: true, entries: { 'bbt-data-v4': { source: 'remote' } } }),
    })

    await expect(hydration).resolves.toBe('superseded')
    expect(localStorage.getItem('bbt-data-v4')).toBeNull()
  })

  it('exclui do retry nao forcado uma chave alterada pelo dominio depois da falha', async () => {
    const localStorage = createLocalStorage()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    })
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('fetch', fetchMock)

    await expect(hydrateServerStorageWithResult(false, ['bbt-data-v4'])).resolves.toBe('failed')
    expect(applyDomainApiValueLocally('bbt-data-v4', { source: 'domain-api' })).toBe(true)
    await expect(hydrateServerStorageWithResult(false, ['bbt-data-v4'])).resolves.toBe('hydrated')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(localStorage.getItem('bbt-data-v4')).toBe(JSON.stringify({ source: 'domain-api' }))
  })
})

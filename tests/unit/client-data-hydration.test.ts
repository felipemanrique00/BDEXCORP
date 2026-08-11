import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hydrateServerStorageWithResult: vi.fn(),
  flushPendingRemoteStorage: vi.fn(),
  rehydrate: vi.fn(),
}))

vi.mock('@/lib/storage-quota', () => ({
  hydrateServerStorageWithResult: mocks.hydrateServerStorageWithResult,
  flushPendingRemoteStorage: mocks.flushPendingRemoteStorage,
}))

vi.mock('@/lib/store', () => ({
  useStore: {
    persist: {
      rehydrate: mocks.rehydrate,
    },
  },
}))

import { hydrateApplicationData } from '@/lib/client-data-hydration'

describe('client data hydration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.hydrateServerStorageWithResult.mockReset()
    mocks.flushPendingRemoteStorage.mockReset()
    mocks.flushPendingRemoteStorage.mockResolvedValue(true)
    mocks.rehydrate.mockReset()
    mocks.rehydrate.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('repete sem force uma hidratacao que falhou, preservando mutacoes feitas durante a espera', async () => {
    mocks.hydrateServerStorageWithResult
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('hydrated')

    const hydration = hydrateApplicationData(false, ['bbt-data-v4'])
    await vi.advanceTimersByTimeAsync(350)

    await expect(hydration).resolves.toBe(true)
    expect(mocks.hydrateServerStorageWithResult).toHaveBeenNthCalledWith(1, false, ['bbt-data-v4'])
    expect(mocks.hydrateServerStorageWithResult).toHaveBeenNthCalledWith(2, false, ['bbt-data-v4'])
    expect(mocks.flushPendingRemoteStorage).not.toHaveBeenCalled()
    expect(mocks.rehydrate).toHaveBeenCalledOnce()
  })

  it('nao repete uma hidratacao forcada e preserva o resultado da falha', async () => {
    mocks.hydrateServerStorageWithResult.mockResolvedValue('failed')

    await expect(hydrateApplicationData(true, ['bbt-data-v4'])).resolves.toBe(false)
    expect(mocks.hydrateServerStorageWithResult).toHaveBeenCalledOnce()
    expect(mocks.rehydrate).toHaveBeenCalledOnce()
  })

  it('confirma a mutacao concorrente e refaz apenas a hidratacao nao forcada', async () => {
    mocks.hydrateServerStorageWithResult
      .mockResolvedValueOnce('superseded')
      .mockResolvedValueOnce('hydrated')

    await expect(hydrateApplicationData(false, ['bbt-data-v4'])).resolves.toBe(true)

    expect(mocks.flushPendingRemoteStorage).toHaveBeenCalledOnce()
    expect(mocks.hydrateServerStorageWithResult).toHaveBeenNthCalledWith(1, false, ['bbt-data-v4'])
    expect(mocks.hydrateServerStorageWithResult).toHaveBeenNthCalledWith(2, false, ['bbt-data-v4'])
    expect(mocks.hydrateServerStorageWithResult).not.toHaveBeenCalledWith(true, ['bbt-data-v4'])
    expect(mocks.rehydrate).toHaveBeenCalledOnce()
  })

  it('nao faz leitura forcada quando a mutacao concorrente nao pode ser confirmada', async () => {
    mocks.hydrateServerStorageWithResult.mockResolvedValue('superseded')
    mocks.flushPendingRemoteStorage.mockResolvedValue(false)

    await expect(hydrateApplicationData(false, ['bbt-data-v4'])).resolves.toBe(false)

    expect(mocks.hydrateServerStorageWithResult).toHaveBeenCalledOnce()
    expect(mocks.flushPendingRemoteStorage).toHaveBeenCalledOnce()
  })
})

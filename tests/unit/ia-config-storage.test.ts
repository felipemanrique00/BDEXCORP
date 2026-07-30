import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getIAConfig,
  saveIAConfig,
  type IAConfig,
} from '@/lib/ia-config-storage'

describe('AI configuration client storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serializes writes so an older request cannot overwrite a newer configuration', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetchMock)

    const configA = config({ assuntosBloqueados: 'primeiro' })
    const configB = config({ assuntosBloqueados: 'segundo' })
    const saveA = saveIAConfig(configA)
    const saveB = saveIAConfig(configB)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    first.resolve(jsonResponse({ config: configA }))
    await expect(saveA).resolves.toEqual(configA)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    second.resolve(jsonResponse({ config: configB }))
    await expect(saveB).resolves.toEqual(configB)

    expect(getIAConfig()).toEqual(configB)
  })
})

function config(overrides: Partial<IAConfig> = {}): IAConfig {
  return {
    scope: 'tudo',
    permitirInternet: true,
    permitirCriarDemandas: true,
    permitirCadastrarHoteis: true,
    permitirReservasTech: true,
    permitirFinanceiro: false,
    exigirConfirmacaoExecucao: true,
    assuntosBloqueados: '',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

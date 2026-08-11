'use client'

import { useStore } from '@/lib/store'
import {
  flushPendingRemoteStorage,
  hydrateServerStorageWithResult,
  type StorageHydrationResult,
} from '@/lib/storage-quota'
import type { SharedStorageKey } from '@/lib/storage-keys'

type PersistableStore = typeof useStore & {
  persist?: {
    rehydrate?: () => Promise<void> | void
  }
}

const HYDRATION_RETRY_DELAY_MS = 350

/**
 * Loads shared storage first and then refreshes Zustand from the merged local copy.
 * Without the second step, mounted pages can keep stale data until a full reload.
 */
export async function hydrateApplicationData(
  force = false,
  keys?: readonly SharedStorageKey[],
): Promise<boolean> {
  let result = await hydrateServerStorageWithResult(force, keys)

  if (result === 'superseded') {
    result = await recoverSupersededHydration(keys)
  } else if (result === 'failed' && !force) {
    // Em desenvolvimento, a primeira compilacao de uma rota/API pode ultrapassar
    // o timeout do cliente. A nova tentativa continua nao forcada: uma mutacao
    // de dominio ocorrida durante a espera marca sua chave como hidratada e deve
    // ser excluida da leitura, em vez de ser substituida por uma resposta antiga.
    await waitForHydrationRetry()
    result = await hydrateServerStorageWithResult(false, keys)
    if (result === 'superseded') result = await recoverSupersededHydration(keys)
  }

  if (!keys || keys.includes('bbt-data-v4')) {
    try {
      await (useStore as PersistableStore).persist?.rehydrate?.()
    } catch (error) {
      console.warn('[storage] Falha ao reidratar os dados da aplicacao.', error)
    }
  }

  return isSuccessfulHydration(result)
}

async function recoverSupersededHydration(
  keys?: readonly SharedStorageKey[],
): Promise<StorageHydrationResult> {
  // A resposta remota foi capturada antes de uma mutacao local. Confirma-se a
  // escrita pendente antes de buscar somente chaves ainda nao hidratadas. Usar
  // force aqui poderia limpar e substituir justamente a mutacao mais recente.
  if (!await flushPendingRemoteStorage()) return 'failed'
  return hydrateServerStorageWithResult(false, keys)
}

function isSuccessfulHydration(result: StorageHydrationResult): boolean {
  return result === 'hydrated' || result === 'local'
}

function waitForHydrationRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, HYDRATION_RETRY_DELAY_MS))
}

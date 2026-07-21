'use client'

import { useStore } from '@/lib/store'
import { hydrateServerStorage } from '@/lib/storage-quota'
import type { SharedStorageKey } from '@/lib/storage-keys'

type PersistableStore = typeof useStore & {
  persist?: {
    rehydrate?: () => Promise<void> | void
  }
}

/**
 * Loads shared storage first and then refreshes Zustand from the merged local copy.
 * Without the second step, mounted pages can keep stale data until a full reload.
 */
export async function hydrateApplicationData(
  force = false,
  keys?: readonly SharedStorageKey[],
): Promise<boolean> {
  const hydrated = await hydrateServerStorage(force, keys)

  if (!keys || keys.includes('bbt-data-v4')) {
    try {
      await (useStore as PersistableStore).persist?.rehydrate?.()
    } catch (error) {
      console.warn('[storage] Falha ao reidratar os dados da aplicacao.', error)
    }
  }

  return hydrated
}

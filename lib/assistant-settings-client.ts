'use client'

import type { AssistantSetting } from '@/lib/assistant/types'

const SETTINGS_CACHE_TTL_MS = 60_000

let settingsCache: AssistantSetting | null = null
let settingsCacheAt = 0
let settingsRequest: Promise<AssistantSetting | null> | null = null

export function getAssistantSettingsClient(forceRefresh = false): Promise<AssistantSetting | null> {
  const now = Date.now()
  if (!forceRefresh && settingsCache && now - settingsCacheAt < SETTINGS_CACHE_TTL_MS) {
    return Promise.resolve(settingsCache)
  }
  if (settingsRequest) return settingsRequest

  settingsRequest = fetch('/api/assistant/settings', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return null
      const payload = await response.json()
      if (!payload?.ok || !payload?.settings) return null
      settingsCache = payload.settings as AssistantSetting
      settingsCacheAt = Date.now()
      return settingsCache
    })
    .catch(() => null)
    .finally(() => {
      settingsRequest = null
    })

  return settingsRequest
}

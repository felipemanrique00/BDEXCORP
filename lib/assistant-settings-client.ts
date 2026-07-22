'use client'

import type { AssistantSetting } from '@/lib/assistant/types'
import { reportClientFailure } from '@/lib/client-observability'

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
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (!payload?.ok || !payload?.settings) throw new Error('Resposta de configuracao invalida.')
      settingsCache = payload.settings as AssistantSetting
      settingsCacheAt = Date.now()
      return settingsCache
    })
    .catch((error) => {
      reportClientFailure('assistant_settings_load_failed', error, { component: 'assistant-settings-client' })
      return null
    })
    .finally(() => {
      settingsRequest = null
    })

  return settingsRequest
}

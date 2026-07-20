import { getStorageEntries, setStorageEntries } from '@/lib/server-db'
import { maskSensitive } from '@/lib/integrations/tech/tech-errors'
import type { IntegrationLogEntry } from '@/lib/integrations/types'

export const TECH_LOG_STORAGE_KEY = 'bbt-tech-integration-logs-v1'

export async function logTechIntegration(
  entry: Omit<IntegrationLogEntry, 'id' | 'provider' | 'createdAt'>,
): Promise<IntegrationLogEntry> {
  const log: IntegrationLogEntry = {
    ...entry,
    id: `tech_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'tech-ttravel',
    metadata: entry.metadata ? maskSensitive(entry.metadata) : undefined,
    createdAt: new Date().toISOString(),
  }

  try {
    const entries = await getStorageEntries()
    const current = Array.isArray(entries[TECH_LOG_STORAGE_KEY]) ? (entries[TECH_LOG_STORAGE_KEY] as IntegrationLogEntry[]) : []
    await setStorageEntries({ [TECH_LOG_STORAGE_KEY]: [...current, log].slice(-1000) })
  } catch (error) {
    console.warn('[tech-log] Falha ao gravar log de integração:', error)
  }

  return log
}

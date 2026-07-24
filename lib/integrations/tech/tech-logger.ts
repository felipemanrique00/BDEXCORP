import 'server-only'

import { maskSensitive } from '@/lib/integrations/tech/tech-errors'
import type { IntegrationLogEntry } from '@/lib/integrations/types'
import { createEntityId } from '@/lib/ids'
import { appendIntegrationActionLog } from '@/lib/server/integration-action-log-service'
import { getRequestContext } from '@/lib/server/request-context'

export const TECH_LOG_STORAGE_KEY = 'bbt-tech-integration-logs-v1'

export async function logTechIntegration(
  entry: Omit<IntegrationLogEntry, 'id' | 'provider' | 'createdAt'>,
): Promise<IntegrationLogEntry> {
  const log: IntegrationLogEntry = {
    ...entry,
    id: createEntityId('tech_log', '_'),
    provider: 'tech-ttravel',
    metadata: entry.metadata ? maskSensitive(entry.metadata) : undefined,
    createdAt: new Date().toISOString(),
  }

  const context = getRequestContext()
  if (context) {
    try {
      await appendIntegrationActionLog(context.principal, {
        providerKey: 'tech-ttravel',
        providerName: 'Tech Travel / TTravel Connect',
        action: entry.action,
        status: entry.status === 'success' ? 'success' : entry.status === 'error' ? 'failure' : 'pending',
        message: entry.message,
        endpoint: entry.endpoint,
        durationMs: entry.durationMs,
        payloadRedacted: maskSensitive({
          requestId: entry.requestId || context.requestId,
          metadata: entry.metadata || {},
        }),
      })
    } catch (error) {
      console.warn('[tech-log] Falha ao gravar log relacional de integração:', error)
    }
  }

  return log
}

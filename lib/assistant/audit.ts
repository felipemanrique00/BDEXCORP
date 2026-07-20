import { ASSISTANT_KEYS, appendAssistantList, createId, getAssistantValue } from '@/lib/assistant/storage'
import type { AssistantAuditLog, AssistantToolLog } from '@/lib/assistant/types'

export async function createAssistantAuditLog(
  log: Omit<AssistantAuditLog, 'id' | 'createdAt'>,
): Promise<AssistantAuditLog> {
  const created: AssistantAuditLog = {
    ...log,
    id: createId('aud'),
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.auditLogs, created, 1000)
  return created
}

export async function createAssistantToolLog(
  log: Omit<AssistantToolLog, 'id' | 'createdAt'>,
): Promise<AssistantToolLog> {
  const created: AssistantToolLog = {
    ...log,
    id: createId('tool-log'),
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.toolLogs, created, 1000)
  return created
}

export async function getAssistantAuditLogs(limit = 200): Promise<AssistantAuditLog[]> {
  const logs = await getAssistantValue<AssistantAuditLog[]>(ASSISTANT_KEYS.auditLogs, [])
  return logs.slice(0, limit)
}

export async function getAssistantToolLogs(limit = 200): Promise<AssistantToolLog[]> {
  const logs = await getAssistantValue<AssistantToolLog[]>(ASSISTANT_KEYS.toolLogs, [])
  return logs.slice(0, limit)
}

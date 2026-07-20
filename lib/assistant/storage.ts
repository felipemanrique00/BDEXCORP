import { getStorageEntries, setStorageEntries } from '@/lib/server-db'

export const ASSISTANT_KEYS = {
  settings: 'bbt-assistant-settings-v1',
  tools: 'bbt-assistant-tools-v1',
  auditLogs: 'bbt-assistant-audit-logs-v1',
  toolLogs: 'bbt-assistant-tool-logs-v1',
  conversations: 'bbt-assistant-conversations-v1',
  messageQueue: 'bbt-assistant-message-queue-v1',
  whatsappSession: 'bbt-assistant-whatsapp-session-v1',
  whatsappLogs: 'bbt-assistant-whatsapp-logs-v1',
  generatedDocuments: 'bbt-assistant-generated-documents-v1',
  voucherSendLogs: 'bbt-assistant-voucher-send-logs-v1',
  audioTranscriptions: 'bbt-assistant-audio-transcriptions-v1',
  audioGenerations: 'bbt-assistant-audio-generations-v1',
  securityEvents: 'bbt-assistant-security-events-v1',
  humanHandoffs: 'bbt-assistant-human-handoffs-v1',
  integrationLogs: 'bbt-assistant-integration-logs-v1',
} as const

export type AssistantStorageKey = (typeof ASSISTANT_KEYS)[keyof typeof ASSISTANT_KEYS]

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function getAssistantValue<T>(key: AssistantStorageKey, fallback: T): Promise<T> {
  const entries = await getStorageEntries()
  const value = entries[key]
  return value === undefined || value === null ? fallback : (value as T)
}

export async function setAssistantValue<T>(key: AssistantStorageKey, value: T): Promise<void> {
  await setStorageEntries({ [key]: value })
}

export async function appendAssistantList<T extends { createdAt?: string }>(
  key: AssistantStorageKey,
  item: T,
  limit = 500,
): Promise<T[]> {
  const current = await getAssistantValue<T[]>(key, [])
  const next = [item, ...current].slice(0, limit)
  await setAssistantValue(key, next)
  return next
}

export async function getRawAppKv<T>(key: string, fallback: T): Promise<T> {
  const entries = await getStorageEntries()
  return entries[key] === undefined || entries[key] === null ? fallback : (entries[key] as T)
}

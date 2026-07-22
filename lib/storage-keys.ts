export const SYSTEM_STORAGE_META_KEY = 'bbt-system-meta-v1'

export const RESETTABLE_SHARED_STORAGE_KEYS = [
  'bbt-data-v4',
  'bbt-atendimentos',
  'bbt-vouchers-emitidos',
  'bbt-vouchers-last-numero',
  'bbt-vouchers-gerados',
  'bbt-voucher-sequencia',
  'bbt-emissoes',
  'bbt-supplier-integrations-v1',
  'bbt-supplier-action-logs-v1',
  'bbt-supplier-reservations-v1',
  'bbt-tech-integration-logs-v1',
  'bbt-tech-travel-quotes-v1',
  'bbt-tech-travel-reservations-v1',
  'bbt-tech-provider-company-links-v1',
  'bbt-tech-emission-company-mapping-v1',
  'bbt-wintour-imports-v1',
  'bbt-wintour-emissor-map-v1',
  'bbt-financeiro',
  'bbt-corporate-finance',
  'bbt-solicitantes-empresa',
  'bbt-aprovacoes',
  'bbt-transferencias',
  'bbt-transacoes',
  'bbt-auditoria',
  'bbt-alertas',
  'bbt-alertas-resolvidos',
  'bbt-caixa-entrada',
  'bbt-fila-importacao',
  'bbt-mensagens-thread',
  'bbt-ia-config-v12',
  'bbt-ia-chat-historico-v12',
  'bbt-resumos-executivos-v12',
  'bbt-travel-desk-v11',
  'bbt-ai-agent-runs',
  'bbt-ai-agent-tasks',
  'bbt-ai-agent-approvals',
  'bbt-ai-agent-quotes',
  'bbt-ai-agent-memories',
  'bbt-assistant-settings-v1',
  'bbt-assistant-tools-v1',
  'bbt-assistant-audit-logs-v1',
  'bbt-assistant-tool-logs-v1',
  'bbt-assistant-conversations-v1',
  'bbt-assistant-message-queue-v1',
  'bbt-assistant-whatsapp-session-v1',
  'bbt-assistant-whatsapp-logs-v1',
  'bbt-assistant-generated-documents-v1',
  'bbt-assistant-voucher-send-logs-v1',
  'bbt-assistant-audio-transcriptions-v1',
  'bbt-assistant-audio-generations-v1',
  'bbt-assistant-security-events-v1',
  'bbt-assistant-human-handoffs-v1',
  'bbt-assistant-integration-logs-v1',
] as const

export const SHARED_STORAGE_KEYS = [
  ...RESETTABLE_SHARED_STORAGE_KEYS,
  SYSTEM_STORAGE_META_KEY,
] as const

export type SharedStorageKey = (typeof SHARED_STORAGE_KEYS)[number]

export function isSharedStorageKey(key: string): key is SharedStorageKey {
  return (SHARED_STORAGE_KEYS as readonly string[]).includes(key)
}

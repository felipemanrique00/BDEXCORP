import { getAssistantSettings } from '@/lib/assistant/settings'
import { ASSISTANT_KEYS, appendAssistantList, createId, getAssistantValue, setAssistantValue } from '@/lib/assistant/storage'
import type { WhatsAppSessionState } from '@/lib/assistant/types'

export async function getWhatsAppSession(): Promise<WhatsAppSessionState> {
  const settings = await getAssistantSettings()
  const saved = await getAssistantValue<WhatsAppSessionState | null>(ASSISTANT_KEYS.whatsappSession, null)
  return saved || {
    id: 'default',
    mode: settings.whatsapp.mode,
    provider: settings.whatsapp.provider,
    status: 'disconnected',
    updatedAt: new Date().toISOString(),
  }
}

export async function startWhatsAppConnection(): Promise<WhatsAppSessionState> {
  const settings = await getAssistantSettings()
  const state: WhatsAppSessionState = {
    id: 'default',
    mode: settings.whatsapp.mode,
    provider: settings.whatsapp.provider,
    status: 'waiting_qr',
    qrCode: createQrPayload(settings.whatsapp.mode, settings.whatsapp.provider),
    expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await setAssistantValue(ASSISTANT_KEYS.whatsappSession, state)
  await appendWhatsAppLog('connect_requested', 'Conexao WhatsApp solicitada. Configure o provedor real no servidor para ativar envio e leitura automaticos.', state)
  return state
}

export async function disconnectWhatsApp(): Promise<WhatsAppSessionState> {
  const current = await getWhatsAppSession()
  const next: WhatsAppSessionState = {
    ...current,
    status: 'disconnected',
    qrCode: undefined,
    lastDisconnectAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await setAssistantValue(ASSISTANT_KEYS.whatsappSession, next)
  await appendWhatsAppLog('disconnect', 'Sessao desconectada pelo painel.', next)
  return next
}

export async function markWhatsAppManualConnected(number = '+55 00 00000-0000'): Promise<WhatsAppSessionState> {
  const current = await getWhatsAppSession()
  const next: WhatsAppSessionState = {
    ...current,
    status: 'connected',
    connectedNumber: number,
    qrCode: undefined,
    lastConnectionAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await setAssistantValue(ASSISTANT_KEYS.whatsappSession, next)
  await appendWhatsAppLog('manual_connected', 'Conexao marcada manualmente como ativa para controle operacional.', next)
  return next
}

export async function getWhatsAppLogs(limit = 100): Promise<Array<Record<string, unknown>>> {
  const logs = await getAssistantValue<Array<Record<string, unknown>>>(ASSISTANT_KEYS.whatsappLogs, [])
  return logs.slice(0, limit)
}

async function appendWhatsAppLog(event: string, message: string, state: WhatsAppSessionState): Promise<void> {
  await appendAssistantList(ASSISTANT_KEYS.whatsappLogs, {
    id: createId('wa-log'),
    event,
    message,
    status: state.status,
    mode: state.mode,
    provider: state.provider,
    createdAt: new Date().toISOString(),
  }, 500)
}

function createQrPayload(mode: string, provider: string): string {
  if (mode === 'production' && provider === 'whatsapp_web') {
    return `BBT_WHATSAPP_WEB_ADAPTER:${Date.now()}`
  }
  return `BBT_WHATSAPP_${mode.toUpperCase()}_${Date.now()}`
}

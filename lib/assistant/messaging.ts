import { getAssistantSettings } from '@/lib/assistant/settings'
import { ASSISTANT_KEYS, appendAssistantList, createId, getAssistantValue, setAssistantValue } from '@/lib/assistant/storage'
import { getServerEnvironment } from '@/lib/server/environment'
import type { WhatsAppSessionState } from '@/lib/assistant/types'

const PROVIDER_TIMEOUT_MS = 10_000

export class WhatsAppUnavailableError extends Error {}

export async function getWhatsAppSession(): Promise<WhatsAppSessionState> {
  const settings = await getAssistantSettings()
  const saved = await getAssistantValue<WhatsAppSessionState | null>(ASSISTANT_KEYS.whatsappSession, null)
  const base = saved || {
    id: 'default' as const,
    mode: settings.whatsapp.mode,
    provider: settings.whatsapp.provider,
    status: 'disconnected' as const,
    updatedAt: new Date().toISOString(),
  }
  const environment = getServerEnvironment()
  if (!environment.WHATSAPP_ENABLED) {
    return { ...base, status: 'disconnected', qrCode: undefined, error: undefined, updatedAt: new Date().toISOString() }
  }

  try {
    const payload = await evolutionRequest('GET', `/instance/connectionState/${encodeURIComponent(requireEvolutionConfig().instanceId)}`)
    const providerState = readString(payload, ['instance', 'state']) || readString(payload, ['state'])
    const status = mapEvolutionState(providerState)
    const next: WhatsAppSessionState = {
      ...base,
      status,
      qrCode: status === 'waiting_qr' ? base.qrCode : undefined,
      error: undefined,
      lastConnectionAt: status === 'connected' ? base.lastConnectionAt || new Date().toISOString() : base.lastConnectionAt,
      updatedAt: new Date().toISOString(),
    }
    await setAssistantValue(ASSISTANT_KEYS.whatsappSession, next)
    return next
  } catch (error) {
    const next: WhatsAppSessionState = {
      ...base,
      status: 'error',
      qrCode: undefined,
      error: error instanceof Error ? error.message : 'Falha ao consultar o provedor WhatsApp.',
      updatedAt: new Date().toISOString(),
    }
    await setAssistantValue(ASSISTANT_KEYS.whatsappSession, next)
    return next
  }
}

export async function startWhatsAppConnection(): Promise<WhatsAppSessionState> {
  const settings = await getAssistantSettings()
  const config = requireEvolutionConfig()
  const payload = await evolutionRequest('GET', `/instance/connect/${encodeURIComponent(config.instanceId)}`)
  const providerState = readString(payload, ['instance', 'state']) || readString(payload, ['state'])
  const qrCode = readString(payload, ['code']) || readString(payload, ['qrcode', 'code']) || readString(payload, ['base64'])
  const status = mapEvolutionState(providerState || (qrCode ? 'connecting' : ''))
  if (status !== 'connected' && !qrCode) {
    throw new WhatsAppUnavailableError('O provedor nao retornou QR Code nem confirmou uma conexao ativa.')
  }

  const state: WhatsAppSessionState = {
    id: 'default',
    mode: settings.whatsapp.mode,
    provider: settings.whatsapp.provider,
    status,
    qrCode: status === 'connected' ? undefined : qrCode,
    expiresAt: status === 'connected' ? undefined : new Date(Date.now() + 2 * 60_000).toISOString(),
    lastConnectionAt: status === 'connected' ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  }
  await setAssistantValue(ASSISTANT_KEYS.whatsappSession, state)
  await appendWhatsAppLog('connect_requested', 'Conexao solicitada ao provedor Evolution API.', state)
  return state
}

export async function disconnectWhatsApp(): Promise<WhatsAppSessionState> {
  const current = await getWhatsAppSession()
  if (current.status !== 'disconnected') {
    const config = requireEvolutionConfig()
    await evolutionRequest('DELETE', `/instance/logout/${encodeURIComponent(config.instanceId)}`)
  }
  const next: WhatsAppSessionState = {
    ...current,
    status: 'disconnected',
    qrCode: undefined,
    error: undefined,
    lastDisconnectAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await setAssistantValue(ASSISTANT_KEYS.whatsappSession, next)
  await appendWhatsAppLog('disconnect', 'Sessao desconectada no provedor.', next)
  return next
}

export async function getWhatsAppLogs(limit = 100): Promise<Array<Record<string, unknown>>> {
  const logs = await getAssistantValue<Array<Record<string, unknown>>>(ASSISTANT_KEYS.whatsappLogs, [])
  return logs.slice(0, limit)
}

async function evolutionRequest(method: 'GET' | 'DELETE', path: string): Promise<unknown> {
  const config = requireEvolutionConfig()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetch(new URL(path, ensureTrailingSlash(config.baseUrl)), {
      method,
      headers: { apikey: config.apiKey, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      throw new WhatsAppUnavailableError(`Evolution API respondeu HTTP ${response.status}.`)
    }
    return payload
  } catch (error) {
    if (error instanceof WhatsAppUnavailableError) throw error
    throw new WhatsAppUnavailableError(error instanceof Error ? error.message : 'Falha de comunicacao com a Evolution API.')
  } finally {
    clearTimeout(timeout)
  }
}

function requireEvolutionConfig(): { baseUrl: string; apiKey: string; instanceId: string } {
  const environment = getServerEnvironment()
  if (!environment.WHATSAPP_ENABLED) throw new WhatsAppUnavailableError('Integracao WhatsApp desativada no servidor.')
  if (!environment.WHATSAPP_API_BASE_URL || !environment.WHATSAPP_API_KEY || !environment.WHATSAPP_INSTANCE_ID) {
    throw new WhatsAppUnavailableError('Configuracao da Evolution API incompleta.')
  }
  return {
    baseUrl: environment.WHATSAPP_API_BASE_URL,
    apiKey: environment.WHATSAPP_API_KEY,
    instanceId: environment.WHATSAPP_INSTANCE_ID,
  }
}

function mapEvolutionState(state?: string): WhatsAppSessionState['status'] {
  const normalized = String(state || '').trim().toLowerCase()
  if (['open', 'connected'].includes(normalized)) return 'connected'
  if (['connecting', 'qrcode', 'qr'].includes(normalized)) return 'waiting_qr'
  if (['close', 'closed', 'disconnected'].includes(normalized)) return 'disconnected'
  return 'error'
}

function readString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined
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

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

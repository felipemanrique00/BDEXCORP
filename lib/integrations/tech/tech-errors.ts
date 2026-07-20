export class TechIntegrationError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message)
    this.name = 'TechIntegrationError'
    this.status = options.status || 502
    this.code = options.code || 'TECH_INTEGRATION_ERROR'
    this.details = options.details
  }
}

export function techErrorMessage(payload: any): string | null {
  const errors = [
    ...(Array.isArray(payload?.Informacoes?.Erro) ? payload.Informacoes.Erro : []),
    ...(Array.isArray(payload?.Informcacoes?.Erro) ? payload.Informcacoes.Erro : []),
    ...(Array.isArray(payload?.Informacoes?.Erros) ? payload.Informacoes.Erros : []),
  ]
  const message = errors
    .map((item: any) => item?.Descricao || item?.descricao || item?.Mensagem || item?.message || String(item || ''))
    .filter(Boolean)
    .join(' | ')
  if (message) return message
  if (payload?.Erro) return String(payload.Erro)
  if (payload?.erro) return String(payload.erro)
  if (payload?.error) return String(payload.error)
  return null
}

export function assertTechPayloadOk(payload: unknown): void {
  const message = techErrorMessage(payload)
  if (message) {
    throw new TechIntegrationError(message, { code: 'TECH_PAYLOAD_ERROR', details: payload })
  }
}

export function publicTechError(error: unknown): { ok: false; error: string; code: string; details?: unknown } {
  if (error instanceof TechIntegrationError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      details: safeDetails(error.details),
    }
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Falha na integração Tech Travel.',
    code: 'TECH_UNKNOWN_ERROR',
  }
}

function safeDetails(details: unknown): unknown {
  if (!details || typeof details !== 'object') return details
  return maskSensitive(details)
}

export function maskSensitive<T>(value: T): T {
  if (Array.isArray(value)) return value.map(maskSensitive) as T
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^(key|chave)$/i.test(key) || /senha|password|apikey|api_key|token|cvv|codigoSeguranca|numeroCartao|cartao/i.test(key)) {
      out[key] = item ? '***' : item
    } else {
      out[key] = maskSensitive(item)
    }
  }
  return out as T
}

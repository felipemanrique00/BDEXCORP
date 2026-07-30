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

export type TechMutationOperation = 'reserve' | 'issue' | 'cancel' | 'cancel-ticket'
export type TechMutationFailureStatus = 'failed' | 'requires_reconciliation'

const SUCCESS_KEYS = new Set(['success', 'sucesso', 'ok', 'confirmado'])
const FAILURE_KEYS = new Set(['error', 'erro', 'errors', 'erros'])
const SUCCESS_STATUSES = new Set([
  'success',
  'sucesso',
  'ok',
  'confirmed',
  'confirmado',
  'completed',
  'concluido',
  'issued',
  'emitido',
  'cancelled',
  'canceled',
  'cancelado',
])
const FAILURE_STATUSES = new Set([
  'failed',
  'failure',
  'falha',
  'error',
  'erro',
  'rejected',
  'rejeitado',
  'denied',
  'negado',
])
const REFERENCE_KEYS: Record<TechMutationOperation, Set<string>> = {
  reserve: new Set(['idos', 'localizador', 'locator', 'reservationid', 'idreserva']),
  issue: new Set(['idemissao', 'idos', 'numerobilhete', 'bilhete', 'ticketnumber', 'eticket', 'protocolo', 'protocol']),
  cancel: new Set(['idcancelamento', 'protocolo', 'protocol']),
  'cancel-ticket': new Set(['idcancelamento', 'protocolo', 'protocol']),
}

export function techErrorMessage(payload: unknown): string | null {
  const root = asRecord(payload)
  const informations = asRecord(root.Informacoes)
  const misspelledInformations = asRecord(root.Informcacoes)
  const errors = [
    ...asArray(informations.Erro),
    ...asArray(misspelledInformations.Erro),
    ...asArray(informations.Erros),
  ]
  const message = errors
    .map(errorItemMessage)
    .filter(Boolean)
    .join(' | ')
  if (message) return message
  for (const key of ['Erro', 'erro', 'error']) {
    const value = root[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function assertTechPayloadOk(payload: unknown): void {
  const message = techErrorMessage(payload)
  if (message) {
    throw new TechIntegrationError(message, { code: 'TECH_PAYLOAD_ERROR', details: payload })
  }
}

export function assertTechMutationConfirmed(
  payload: unknown,
  operation: TechMutationOperation,
): void {
  const signal = mutationConfirmationSignal(payload, operation)
  if (signal === 'confirmed') return
  if (signal === 'rejected') {
    throw new TechIntegrationError('A Tech Travel rejeitou a operacao.', {
      status: 502,
      code: 'TECH_MUTATION_REJECTED',
      details: responseShape(payload),
    })
  }
  throw new TechIntegrationError(
    'A Tech Travel nao retornou uma confirmacao verificavel. Reconcilie antes de repetir.',
    {
      status: 502,
      code: 'TECH_MUTATION_RESPONSE_UNCONFIRMED',
      details: responseShape(payload),
    },
  )
}

export function isTechMutationOutcomeUncertain(error: unknown): boolean {
  return classifyTechMutationFailure(error) === 'requires_reconciliation'
}

export function classifyTechMutationFailure(error: unknown): TechMutationFailureStatus {
  if (!error || typeof error !== 'object') return 'failed'
  const candidate = error as { code?: unknown; status?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  if ([
    'TECH_TIMEOUT',
    'TECH_FETCH_ERROR',
    'TECH_MUTATION_RESPONSE_UNCONFIRMED',
  ].includes(code)) {
    return 'requires_reconciliation'
  }
  return code === 'TECH_HTTP_ERROR' && Number(candidate.status) >= 500
    ? 'requires_reconciliation'
    : 'failed'
}

export function publicTechError(error: unknown): { ok: false; error: string; code: string; details?: unknown } {
  if (error instanceof TechIntegrationError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
    }
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Falha na integração Tech Travel.',
    code: 'TECH_UNKNOWN_ERROR',
  }
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

function mutationConfirmationSignal(
  payload: unknown,
  operation: TechMutationOperation,
  depth = 0,
): 'confirmed' | 'rejected' | 'unknown' {
  if (payload === true) return 'confirmed'
  if (payload === false) return 'rejected'
  if (payload === null || payload === undefined || depth > 8) return 'unknown'
  if (typeof payload === 'string') return textSignal(payload)
  if (typeof payload === 'number') return 'unknown'
  if (Array.isArray(payload)) {
    let confirmed = false
    for (const item of payload.slice(0, 100)) {
      const signal = mutationConfirmationSignal(item, operation, depth + 1)
      if (signal === 'rejected') return 'rejected'
      if (signal === 'confirmed') confirmed = true
    }
    return confirmed ? 'confirmed' : 'unknown'
  }
  if (typeof payload !== 'object') return 'unknown'

  const record = payload as Record<string, unknown>
  let confirmed = false
  for (const [rawKey, value] of Object.entries(record)) {
    const key = normalizeKey(rawKey)
    if (FAILURE_KEYS.has(key) && hasFailureValue(value)) return 'rejected'
    if (SUCCESS_KEYS.has(key)) {
      if (value === false || normalizeKey(String(value)) === 'false') return 'rejected'
      if (value === true || normalizeKey(String(value)) === 'true') confirmed = true
    }
    if (['status', 'situacao', 'resultado'].includes(key) && typeof value === 'string') {
      const status = normalizeKey(value)
      if (FAILURE_STATUSES.has(status)) return 'rejected'
      if (SUCCESS_STATUSES.has(status)) confirmed = true
    }
    if (REFERENCE_KEYS[operation].has(key) && hasReferenceValue(value)) confirmed = true
    if (['mensagem', 'message', 'descricao'].includes(key) && typeof value === 'string') {
      const signal = textSignal(value)
      if (signal === 'rejected') return 'rejected'
      if (signal === 'confirmed') confirmed = true
    }
  }
  if (confirmed) return 'confirmed'

  let nestedConfirmation = false
  for (const value of Object.values(record)) {
    const signal = mutationConfirmationSignal(value, operation, depth + 1)
    if (signal === 'rejected') return 'rejected'
    if (signal === 'confirmed') nestedConfirmation = true
  }
  return nestedConfirmation ? 'confirmed' : 'unknown'
}

function textSignal(value: string): 'confirmed' | 'rejected' | 'unknown' {
  const normalized = normalizeKey(value)
  if (!normalized) return 'unknown'
  if (/(erro|falha|nao|negad|rejeitad|invalid)/.test(normalized)) return 'rejected'
  if (/(sucesso|confirmad|concluid|emitid|cancelad|realizad)/.test(normalized)) return 'confirmed'
  return SUCCESS_STATUSES.has(normalized) ? 'confirmed' : 'unknown'
}

function errorItemMessage(value: unknown): string {
  const item = asRecord(value)
  for (const key of ['Descricao', 'descricao', 'Mensagem', 'message']) {
    const message = item[key]
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return typeof value === 'string' ? value.trim() : ''
}

function responseShape(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (value && typeof value === 'object') {
    return { type: 'object', keys: Object.keys(value as Record<string, unknown>).slice(0, 40) }
  }
  return { type: typeof value }
}

function hasReferenceValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return typeof value === 'number' && Number.isFinite(value)
}

function hasFailureValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return value === true
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === null || value === undefined ? [] : [value]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

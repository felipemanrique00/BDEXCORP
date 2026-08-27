import 'server-only'

import { z } from 'zod'

const optionalBooleanValue = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return value
}, z.boolean()).optional()
const emptyStringAsUndefined = (value: unknown) => (
  typeof value === 'string' && value.trim() === '' ? undefined : value
)
const optionalString = z.preprocess(emptyStringAsUndefined, z.string().optional())
const optionalTrimmedString = z.preprocess(
  emptyStringAsUndefined,
  z.string().trim().min(1).optional(),
)
const optionalWintourPin = z.preprocess(
  emptyStringAsUndefined,
  z.string().trim().regex(/^[\x21-\x7E]{1,128}$/).optional(),
)
const optionalUuid = z.preprocess(emptyStringAsUndefined, z.string().uuid().optional())
const optionalUrl = z.preprocess(emptyStringAsUndefined, z.string().url().optional())
const optionalEmail = z.preprocess(emptyStringAsUndefined, z.string().email().optional())
const positiveInteger = z.coerce.number().int().positive()

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: optionalUrl,
  APP_VERSION: optionalTrimmedString,
  ALLOW_INSECURE_LOCALHOST: optionalBooleanValue.default(false),
  DATABASE_URL: optionalString,
  DATABASE_SSL: optionalBooleanValue.default(false),
  POSTGRES_POOL_MAX: positiveInteger.max(50).default(10),
  POSTGRES_CONNECT_TIMEOUT_MS: positiveInteger.max(60_000).default(5_000),
  POSTGRES_STATEMENT_TIMEOUT_MS: positiveInteger.max(120_000).default(30_000),
  AUTOMATION_WORKER_ENABLED: optionalBooleanValue.default(true),
  AUTOMATION_WORKER_INTERVAL_MS: positiveInteger.min(1_000).max(300_000).default(5_000),
  AUTOMATION_WORKER_BATCH_SIZE: positiveInteger.max(100).default(25),
  WINTOUR_SYNC_ENABLED: optionalBooleanValue.default(false),
  WINTOUR_TENANT_ID: optionalUuid,
  WINTOUR_AUTO_SEND: optionalBooleanValue.default(false),
  WINTOUR_PROTOCOL_POLL_ENABLED: optionalBooleanValue.default(false),
  WINTOUR_PIN: optionalWintourPin,
  WINTOUR_TIMEOUT_MS: positiveInteger.min(1_000).max(60_000).default(30_000),
  WINTOUR_WORKER_INTERVAL_MS: positiveInteger.min(5_000).max(300_000).default(30_000),
  WINTOUR_WORKER_BATCH_SIZE: positiveInteger.max(100).default(25),
  OFFLINE_TRAVEL_ENABLED: optionalBooleanValue.default(false),
  AUTH_SECRET: optionalString,
  AUTH_SESSION_HOURS: positiveInteger.max(24 * 30).default(12),
  AUTH_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('bbt_session'),
  MFA_ADMIN_REQUIRED: optionalBooleanValue.default(true),
  MFA_LOCAL_BYPASS: optionalBooleanValue.default(false),
  MFA_ENCRYPTION_KEY: optionalTrimmedString,
  MFA_ISSUER: z.string().trim().min(2).max(80).default('BBT Corporativo'),
  MFA_CHALLENGE_MINUTES: positiveInteger.min(2).max(30).default(10),
  MFA_MAX_ATTEMPTS: positiveInteger.min(3).max(10).default(6),
  STORAGE_ROOT: z.string().min(1).default('.bbt-storage/files'),
  MAX_UPLOAD_BYTES: positiveInteger.max(100 * 1024 * 1024).default(15 * 1024 * 1024),
  SMTP_ENABLED: optionalBooleanValue.default(false),
  SMTP_HOST: optionalString,
  SMTP_PORT: positiveInteger.max(65_535).default(587),
  SMTP_SECURE: optionalBooleanValue.default(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalEmail,
  SMTP_FROM_NAME: z.string().trim().min(1).max(120).default('BBT Corporativo'),
  PASSWORD_RESET_MINUTES: positiveInteger.max(24 * 60).default(30),
  WHATSAPP_ENABLED: optionalBooleanValue.default(false),
  WHATSAPP_PROVIDER: z.enum(['evolution_api']).default('evolution_api'),
  WHATSAPP_API_BASE_URL: optionalUrl,
  WHATSAPP_API_KEY: optionalString,
  WHATSAPP_INSTANCE_ID: z.preprocess(
    emptyStringAsUndefined,
    z.string().trim().min(1).max(160).optional(),
  ),
  TECH_API_ENABLED: optionalBooleanValue.default(false),
  TECH_API_BASE_URL: optionalUrl,
  TECH_API_LOGIN: optionalString,
  TECH_API_PASSWORD: optionalString,
  TECH_API_KEY: optionalString,
  TECH_REPORTS_ENABLED: optionalBooleanValue.default(false),
  TECH_REPORTS_BASE_URL: optionalUrl,
  TECH_REPORTS_KEY: optionalString,
})

export type ServerEnvironment = z.infer<typeof environmentSchema>

let cachedEnvironment: ServerEnvironment | null = null

export function getServerEnvironment(): ServerEnvironment {
  if (cachedEnvironment) return cachedEnvironment

  const parsed = environmentSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(`Configuracao de ambiente invalida: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`)
  }

  validateLocalMfaBypassEnvironment(parsed.data)
  validateWintourEnvironment(parsed.data)
  validateProductionEnvironment(parsed.data)
  cachedEnvironment = parsed.data
  return cachedEnvironment
}

function validateWintourEnvironment(environment: ServerEnvironment): void {
  const errors: string[] = []
  if ((environment.WINTOUR_AUTO_SEND || environment.WINTOUR_PROTOCOL_POLL_ENABLED) && !environment.WINTOUR_SYNC_ENABLED) {
    errors.push('WINTOUR_SYNC_ENABLED deve estar habilitado antes do envio ou consulta automatica')
  }
  if (environment.WINTOUR_SYNC_ENABLED && !environment.WINTOUR_PIN) {
    errors.push('WINTOUR_PIN e obrigatorio quando WINTOUR_SYNC_ENABLED=true')
  }
  if (environment.WINTOUR_SYNC_ENABLED && !environment.WINTOUR_TENANT_ID) {
    errors.push('WINTOUR_TENANT_ID e obrigatorio quando WINTOUR_SYNC_ENABLED=true')
  }
  if (errors.length) throw new Error(`Configuracao Wintour bloqueada: ${errors.join('; ')}`)
}

export function validateServerEnvironment(): void {
  getServerEnvironment()
}

export function resetEnvironmentCacheForTests(): void {
  if (process.env.NODE_ENV === 'test') cachedEnvironment = null
}

export function isLocalMfaBypassEnabled(): boolean {
  const environment = getServerEnvironment()
  return environment.MFA_LOCAL_BYPASS === true &&
    environment.MFA_ADMIN_REQUIRED === true &&
    environment.ALLOW_INSECURE_LOCALHOST === true &&
    Boolean(environment.APP_URL && isLoopbackHttpUrl(environment.APP_URL))
}

function validateLocalMfaBypassEnvironment(environment: ServerEnvironment): void {
  if (!environment.MFA_LOCAL_BYPASS) return

  const errors: string[] = []
  if (!environment.MFA_ADMIN_REQUIRED) {
    errors.push('MFA_ADMIN_REQUIRED deve permanecer habilitado')
  }
  if (!environment.ALLOW_INSECURE_LOCALHOST) {
    errors.push('ALLOW_INSECURE_LOCALHOST deve estar explicitamente habilitado')
  }
  if (!environment.APP_URL || !isLoopbackHttpUrl(environment.APP_URL)) {
    errors.push('APP_URL deve usar HTTP e apontar estritamente para localhost ou loopback')
  }

  if (errors.length) {
    throw new Error(`MFA_LOCAL_BYPASS bloqueado: ${errors.join('; ')}`)
  }
}

function validateProductionEnvironment(environment: ServerEnvironment): void {
  if (environment.NODE_ENV !== 'production') return

  const errors: string[] = []
  if (!environment.DATABASE_URL || !/^postgres(?:ql)?:\/\//i.test(environment.DATABASE_URL)) {
    errors.push('DATABASE_URL deve apontar para PostgreSQL')
  }
  if (!environment.AUTH_SECRET || environment.AUTH_SECRET.length < 32 || /change|default|example|secret/i.test(environment.AUTH_SECRET)) {
    errors.push('AUTH_SECRET deve ter ao menos 32 caracteres aleatorios e nao pode ser padrao')
  }
  if (!environment.MFA_ADMIN_REQUIRED) {
    errors.push('MFA_ADMIN_REQUIRED deve permanecer habilitado em producao')
  }
  if (!environment.MFA_ENCRYPTION_KEY || !isValidMfaEncryptionKey(environment.MFA_ENCRYPTION_KEY)) {
    errors.push('MFA_ENCRYPTION_KEY deve conter exatamente 32 bytes em Base64')
  }
  const localTestUrlAllowed = Boolean(
    environment.ALLOW_INSECURE_LOCALHOST &&
    environment.APP_URL &&
    isLoopbackHttpUrl(environment.APP_URL),
  )
  if (!environment.APP_URL || (!isSecurePublicUrl(environment.APP_URL) && !localTestUrlAllowed)) {
    errors.push('APP_URL deve ser uma URL HTTPS publica')
  }
  if (!environment.APP_VERSION) errors.push('APP_VERSION e obrigatoria em producao')
  if (environment.SMTP_ENABLED) {
    if (!environment.SMTP_HOST) errors.push('SMTP_HOST e obrigatorio quando SMTP_ENABLED=true')
    if (!environment.SMTP_USER) errors.push('SMTP_USER e obrigatorio quando SMTP_ENABLED=true')
    if (!environment.SMTP_PASSWORD) errors.push('SMTP_PASSWORD e obrigatorio quando SMTP_ENABLED=true')
    if (!environment.SMTP_FROM) errors.push('SMTP_FROM e obrigatorio quando SMTP_ENABLED=true')
  }
  if (environment.WHATSAPP_ENABLED) {
    if (!environment.WHATSAPP_API_BASE_URL) errors.push('WHATSAPP_API_BASE_URL e obrigatorio quando WHATSAPP_ENABLED=true')
    if (!environment.WHATSAPP_API_KEY) errors.push('WHATSAPP_API_KEY e obrigatorio quando WHATSAPP_ENABLED=true')
    if (!environment.WHATSAPP_INSTANCE_ID) errors.push('WHATSAPP_INSTANCE_ID e obrigatorio quando WHATSAPP_ENABLED=true')
  }
  if (environment.TECH_API_ENABLED) {
    if (!environment.TECH_API_BASE_URL) errors.push('TECH_API_BASE_URL e obrigatorio quando TECH_API_ENABLED=true')
    if (!environment.TECH_API_LOGIN || !environment.TECH_API_PASSWORD || !environment.TECH_API_KEY) {
      errors.push('Credenciais TECH_API sao obrigatorias quando TECH_API_ENABLED=true')
    }
  }
  if (environment.TECH_REPORTS_ENABLED) {
    if (!environment.TECH_REPORTS_BASE_URL || !environment.TECH_REPORTS_KEY) {
      errors.push('TECH_REPORTS_BASE_URL e TECH_REPORTS_KEY sao obrigatorios quando TECH_REPORTS_ENABLED=true')
    }
  }

  if (errors.length) throw new Error(`Ambiente de producao bloqueado: ${errors.join('; ')}`)
}

function isSecurePublicUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)
  } catch {
    return false
  }
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' &&
      !url.username &&
      !url.password &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

function isValidMfaEncryptionKey(value: string): boolean {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64').length === 32
  } catch {
    return false
  }
}

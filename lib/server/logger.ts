import 'server-only'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  requestId?: string
  tenantId?: string
  userId?: string
  route?: string
  status?: number
  durationMs?: number
  errorCode?: string
  [key: string]: unknown
}

const REDACTED_KEYS = /password|secret|token|cookie|authorization|api[_-]?key|credential/i

export function logInfo(message: string, context: LogContext = {}): void {
  writeLog('info', message, context)
}

export function logWarn(message: string, context: LogContext = {}): void {
  writeLog('warn', message, context)
}

export function logError(message: string, error: unknown, context: LogContext = {}): void {
  writeLog('error', message, {
    ...context,
    error: normalizeError(error),
  })
}

export function logDebug(message: string, context: LogContext = {}): void {
  if (process.env.LOG_LEVEL !== 'debug') return
  writeLog('debug', message, context)
}

function writeLog(level: LogLevel, message: string, context: LogContext): void {
  const entry = JSON.stringify(redact({
    timestamp: new Date().toISOString(),
    level,
    environment: process.env.NODE_ENV || 'development',
    service: 'bbt-corporativo',
    version: process.env.APP_VERSION || process.env.npm_package_version || 'unknown',
    message,
    ...context,
  }))

  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: typeof (error as NodeJS.ErrnoException).code === 'string'
        ? (error as NodeJS.ErrnoException).code
        : undefined,
    }
  }
  return { message: String(error) }
}

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) return value.map((item) => redact(item, seen))

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    REDACTED_KEYS.test(key) ? '[redacted]' : redact(item, seen),
  ]))
}

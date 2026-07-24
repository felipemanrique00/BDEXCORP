import 'server-only'

import { queryDatabase, withTenantTransaction } from '@/lib/server/database'
import { logError } from '@/lib/server/logger'
import { getRequestContext } from '@/lib/server/request-context'

export type AuditResult = 'success' | 'denied' | 'failure'

export interface AuditEvent {
  action: string
  result: AuditResult
  tenantId?: string | null
  actorUserId?: string | null
  requestId?: string | null
  entityType?: string | null
  entityId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  const context = getRequestContext()
  const tenantId = event.tenantId === undefined ? context?.principal.tenantId || null : event.tenantId
  const actorUserId = event.actorUserId === undefined ? context?.principal.user.id || null : event.actorUserId
  const requestId = event.requestId === undefined ? context?.requestId || null : event.requestId

  try {
    const values = [
      tenantId,
      actorUserId,
      isUuid(requestId) ? requestId : null,
      event.action,
      event.entityType || null,
      event.entityId || null,
      event.result,
      normalizeIp(event.ipAddress),
      truncate(event.userAgent, 512),
      JSON.stringify(sanitizeMetadata(event.metadata || {})),
    ]
    if (tenantId) {
      await withTenantTransaction(tenantId, (client) => client.query(AUDIT_INSERT_SQL, values))
    } else {
      await queryDatabase(AUDIT_INSERT_SQL, values)
    }
  } catch (error) {
    logError('audit_log_write_failed', error, {
      errorCode: 'AUDIT_WRITE_FAILED',
      action: event.action,
      tenantId: tenantId || undefined,
      userId: actorUserId || undefined,
    })
    if (isCriticalAuditAction(event.action)) throw error
  }
}

const AUDIT_INSERT_SQL = `insert into audit_logs (
  tenant_id, actor_user_id, request_id, action, entity_type, entity_id,
  result, ip_address, user_agent, metadata
) values ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, $10::jsonb)`

function isCriticalAuditAction(action: string): boolean {
  return /^(auth\.|platform\.|system\.reset|user\.|finance\.|reservation\.|emission\.|policy\.|approval\.|workflow\.|travel\.lifecycle\.)/.test(action)
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /password|secret|token|cookie|authorization|credential|api[_-]?key/i
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key,
    sensitive.test(key) ? '[redacted]' : normalizeMetadataValue(value),
  ]))
}

function normalizeMetadataValue(value: unknown): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.slice(0, 100).map(normalizeMetadataValue)
  if (value && typeof value === 'object') return sanitizeMetadata(value as Record<string, unknown>)
  return String(value)
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null
  return value.slice(0, max)
}

function normalizeIp(value: string | null | undefined): string | null {
  const candidate = value?.split(',')[0]?.trim()
  if (!candidate) return null
  return /^[0-9a-f:.]+$/i.test(candidate) ? candidate : null
}

function isUuid(value: string | null): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

import 'server-only'

import type { PoolClient } from 'pg'

import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const WintourProviderKey = 'wintour'
const LegacyStorageKey = 'bbt-wintour-emissor-map-v1'
const LegacyMigrationLimit = 5_000

interface WintourEmissorMappingRow {
  id: string
  external_actor_code: string
  user_id: string
  user_name: string
  updated_at: Date | string
}

export interface WintourEmissorMapping {
  id: string
  codigo: string
  user_id: string
  user_name: string
  updated_at: string
}

export class WintourEmissorMappingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WintourEmissorMappingError'
  }
}

export async function listWintourEmissorMappings(
  principal: RequestPrincipal,
): Promise<WintourEmissorMapping[]> {
  requireMappingPermission(principal)

  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<WintourEmissorMappingRow>(
      `select mapping.id, mapping.external_actor_code, mapping.user_id,
              target.name as user_name, mapping.updated_at
       from integration_actor_mappings mapping
       join tenant_memberships membership
         on membership.tenant_id = mapping.tenant_id
        and membership.user_id = mapping.user_id
        and membership.status = 'active'
       join users target
         on target.id = mapping.user_id
        and target.status = 'active'
        and target.deleted_at is null
       where mapping.tenant_id = $1
         and mapping.provider_key = $2
         and mapping.status = 'active'
       order by mapping.external_actor_code`,
      [principal.tenantId, WintourProviderKey],
    )
    return result.rows.map(mapRow)
  })
}

export async function upsertWintourEmissorMapping(
  principal: RequestPrincipal,
  input: { codigo: string; userId: string },
): Promise<WintourEmissorMapping> {
  requireMappingPermission(principal)
  const codigo = normalizeCode(input.codigo)
  if (!isUuid(input.userId)) {
    throw new WintourEmissorMappingError(
      'WINTOUR_EMISSOR_USER_INVALID',
      'Identificador do agente invalido.',
      400,
    )
  }

  const mapping = await withTenantTransaction(principal.tenantId, async (client) => {
    await bootstrapLegacyMappings(client, principal)
    const target = await client.query<{ user_id: string; user_name: string }>(
      `select membership.user_id, target.name as user_name
       from tenant_memberships membership
       join users target
         on target.id = membership.user_id
        and target.status = 'active'
        and target.deleted_at is null
       where membership.tenant_id = $1
         and membership.user_id = $2
         and membership.status = 'active'`,
      [principal.tenantId, input.userId],
    )
    if (!target.rows[0]) {
      throw new WintourEmissorMappingError(
        'WINTOUR_EMISSOR_USER_NOT_FOUND',
        'O agente selecionado nao possui acesso ativo neste tenant.',
        422,
      )
    }

    const result = await client.query<WintourEmissorMappingRow>(
      `insert into integration_actor_mappings (
         tenant_id, provider_key, external_actor_code, user_id, status,
         metadata, created_by, updated_by
       ) values ($1, $2, $3, $4, 'active', $5::jsonb, $6, $6)
       on conflict (tenant_id, provider_key, external_actor_code) do update set
         user_id = excluded.user_id,
         status = 'active',
         metadata = integration_actor_mappings.metadata || excluded.metadata,
         updated_by = excluded.updated_by,
         updated_at = now()
       returning id, external_actor_code, user_id,
                 $7::text as user_name, updated_at`,
      [
        principal.tenantId,
        WintourProviderKey,
        codigo,
        input.userId,
        JSON.stringify({ source: 'wintour_import_ui' }),
        principal.user.id,
        target.rows[0].user_name,
      ],
    )
    return mapRow(result.rows[0])
  })

  await writeAuditEvent({
    action: 'integration.wintour_emissor_mapping.upsert',
    result: 'success',
    entityType: 'integration_actor_mapping',
    entityId: mapping.id,
    metadata: {
      codigo: mapping.codigo,
      targetUserId: mapping.user_id,
    },
  })
  return mapping
}

export async function deleteWintourEmissorMapping(
  principal: RequestPrincipal,
  codigoInput: string,
): Promise<boolean> {
  requireMappingPermission(principal)
  const codigo = normalizeCode(codigoInput)

  const deleted = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ id: string; user_id: string }>(
      `delete from integration_actor_mappings
       where tenant_id = $1
         and provider_key = $2
         and external_actor_code = $3
       returning id, user_id`,
      [principal.tenantId, WintourProviderKey, codigo],
    )
    return result.rows[0] || null
  })

  if (!deleted) return false
  await writeAuditEvent({
    action: 'integration.wintour_emissor_mapping.delete',
    result: 'success',
    entityType: 'integration_actor_mapping',
    entityId: deleted.id,
    metadata: {
      codigo,
      targetUserId: deleted.user_id,
    },
  })
  return true
}

async function bootstrapLegacyMappings(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<void> {
  const source = await client.query<{ value: unknown }>(
    'select value from app_kv where tenant_id = $1 and key = $2',
    [principal.tenantId, LegacyStorageKey],
  )
  const candidates = legacyCandidates(source.rows[0]?.value)
  if (!candidates.length) return

  const userIds = Array.from(new Set(candidates.map((item) => item.userId)))
  const targets = await client.query<{ user_id: string }>(
    `select membership.user_id
     from tenant_memberships membership
     join users target
       on target.id = membership.user_id
      and target.status = 'active'
      and target.deleted_at is null
     where membership.tenant_id = $1
       and membership.user_id = any($2::uuid[])
       and membership.status = 'active'`,
    [principal.tenantId, userIds],
  )
  const validUsers = new Set(targets.rows.map((row) => row.user_id))

  for (const candidate of candidates) {
    if (!validUsers.has(candidate.userId)) continue
    await client.query(
      `insert into integration_actor_mappings (
         tenant_id, provider_key, external_actor_code, user_id, status,
         metadata, created_by, updated_by
       ) values ($1, $2, $3, $4, 'active', $5::jsonb, $6, $6)
       on conflict (tenant_id, provider_key, external_actor_code) do nothing`,
      [
        principal.tenantId,
        WintourProviderKey,
        candidate.codigo,
        candidate.userId,
        JSON.stringify({ source: 'legacy_app_kv', migratedAt: new Date().toISOString() }),
        principal.user.id,
      ],
    )
  }
}

function legacyCandidates(value: unknown): Array<{ codigo: string; userId: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const candidates: Array<{ codigo: string; userId: string }> = []

  for (const [sourceCode, sourceValue] of Object.entries(value).slice(0, LegacyMigrationLimit)) {
    if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) continue
    const record = sourceValue as Record<string, unknown>
    const userId = typeof record.user_id === 'string' ? record.user_id.trim() : ''
    if (!isUuid(userId)) continue
    try {
      candidates.push({
        codigo: normalizeCode(typeof record.codigo === 'string' ? record.codigo : sourceCode),
        userId,
      })
    } catch {
      // Registros legados invalidos permanecem preservados para revisao manual.
    }
  }
  return candidates
}

function normalizeCode(value: string): string {
  const code = String(value || '').trim().toUpperCase()
  if (!code || code.length > 120 || /[\u0000-\u001f\u007f]/.test(code)) {
    throw new WintourEmissorMappingError(
      'WINTOUR_EMISSOR_CODE_INVALID',
      'Codigo de emissor Wintour invalido.',
      400,
    )
  }
  return code
}

function requireMappingPermission(principal: RequestPrincipal): void {
  if (principal.platformAdmin || principal.roleKey === 'tenant_admin') return

  throw new WintourEmissorMappingError(
    'WINTOUR_EMISSOR_MAPPING_DENIED',
    'Apenas administradores do tenant podem gerenciar emissores Wintour.',
    403,
  )
}

function mapRow(row: WintourEmissorMappingRow): WintourEmissorMapping {
  return {
    id: row.id,
    codigo: row.external_actor_code,
    user_id: row.user_id,
    user_name: row.user_name,
    updated_at: new Date(row.updated_at).toISOString(),
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

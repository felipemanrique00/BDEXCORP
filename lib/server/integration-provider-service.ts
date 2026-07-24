import 'server-only'

import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { integrationRegistry } from '@/lib/integrations/registry'
import {
  getTechConfig,
  techConfigured,
  TECH_PROVIDER_ID,
} from '@/lib/integrations/tech/tech-config'
import { maskSensitive } from '@/lib/integrations/tech/tech-errors'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type {
  SupplierActionLog,
  SupplierAuthType,
  SupplierCapability,
  SupplierIntegration,
  SupplierMode,
  SupplierService,
  SupplierStatus,
} from '@/lib/supplier-integrations'

const serviceSchema = z.enum([
  'aereo',
  'hotelaria',
  'locacao',
  'pacotes',
  'lazer',
  'transfer',
  'seguro',
  'outros',
])

const capabilitySchema = z.enum([
  'pesquisa',
  'cotacao',
  'reserva',
  'emissao',
  'cancelamento',
  'remarcacao',
  'voucher',
  'importacao',
  'status',
  'faturamento',
])

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().trim().url().max(1000).optional(),
)

const optionalEnvironmentName = z.preprocess(
  emptyToUndefined,
  z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,119}$/).optional(),
)

export const integrationProviderInputSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/).optional(),
  nome: z.string().trim().min(2).max(200),
  tipo: z.enum(['consolidadora', 'operadora', 'fornecedor_direto', 'ota', 'gds', 'outro']),
  servicos: z.array(serviceSchema).min(1).max(8),
  capacidades: z.array(capabilitySchema).max(10),
  modo: z.enum(['api', 'portal_assistido', 'email', 'manual']),
  status: z.enum(['ativo', 'pendente_configuracao', 'inativo', 'falha']),
  prioridade: z.number().int().min(0).max(1000),
  portal_url: optionalUrl,
  api_base_url: optionalUrl,
  auth_type: z.enum(['none', 'api_key', 'bearer', 'basic', 'oauth2', 'portal']),
  env_base_url: optionalEnvironmentName,
  env_token: optionalEnvironmentName,
  contato_suporte: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  observacoes: z.preprocess(emptyToUndefined, z.string().trim().max(4000).optional()),
  mapeamento: z.record(z.string().max(1000)).optional(),
  version: z.number().int().positive().optional(),
}).strict()

export type IntegrationProviderInput = z.infer<typeof integrationProviderInputSchema>

interface IntegrationProviderRow extends QueryResultRow {
  id: string
  provider_key: string
  name: string
  provider_type: 'consolidator' | 'operator' | 'direct_supplier' | 'ota' | 'gds' | 'other'
  services: string[]
  capabilities: string[]
  mode: 'api' | 'assisted_portal' | 'email' | 'manual'
  status: 'active' | 'pending_configuration' | 'inactive' | 'failed'
  priority: number
  portal_url: string | null
  api_base_url: string | null
  auth_type: SupplierAuthType
  base_url_env_name: string | null
  credential_env_name: string | null
  support_contact: string | null
  notes: string | null
  mapping: Record<string, string>
  system_managed: boolean
  version: string | number
  created_at: string | Date
  updated_at: string | Date
}

interface IntegrationActionLogRow extends QueryResultRow {
  id: string
  provider_key: string
  provider_name: string
  action: string
  service: string | null
  status: 'success' | 'pending' | 'failure'
  message: string
  payload_redacted: Record<string, unknown>
  created_at: string | Date
}

export interface IntegrationProviderRecord extends SupplierIntegration {
  database_id?: string
  version?: number
  system_managed?: boolean
}

export class IntegrationProviderServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'IntegrationProviderServiceError'
  }
}

export async function listIntegrationProviders(
  principal: RequestPrincipal,
): Promise<IntegrationProviderRecord[]> {
  const rows = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<IntegrationProviderRow>(
      `select id, provider_key, name, provider_type, services, capabilities,
              mode, status, priority, portal_url, api_base_url, auth_type,
              base_url_env_name, credential_env_name, support_contact, notes,
              mapping, system_managed, version, created_at, updated_at
       from integration_providers
       where tenant_id = $1 and deleted_at is null
       order by priority desc, name`,
      [principal.tenantId],
    )
    return result.rows
  })

  const providers = rows.map((row) => mapProvider(row, canManageProviderCatalog(principal)))
  if (!providers.some((provider) => provider.id === TECH_PROVIDER_ID)) {
    providers.push(defaultTechProvider(canManageProviderCatalog(principal)))
  }
  return providers.sort((left, right) => right.prioridade - left.prioridade || left.nome.localeCompare(right.nome))
}

export async function upsertIntegrationProvider(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<IntegrationProviderRecord> {
  requireProviderCatalogAdmin(principal)
  const input = integrationProviderInputSchema.parse(rawInput)
  const providerKey = input.id || slugProviderKey(input.nome)
  const normalized = normalizeProviderInput(providerKey, input)

  const provider = await withTenantTransaction(principal.tenantId, async (client) => {
    const currentResult = await client.query<IntegrationProviderRow>(
      `select id, provider_key, name, provider_type, services, capabilities,
              mode, status, priority, portal_url, api_base_url, auth_type,
              base_url_env_name, credential_env_name, support_contact, notes,
              mapping, system_managed, version, created_at, updated_at
       from integration_providers
       where tenant_id = $1 and provider_key = $2 and deleted_at is null
       for update`,
      [principal.tenantId, providerKey],
    )
    const current = currentResult.rows[0]
    if (current && input.version && Number(current.version) !== input.version) {
      throw new IntegrationProviderServiceError(
        'INTEGRATION_PROVIDER_VERSION_CONFLICT',
        'O conector foi alterado por outro usuario. Atualize a pagina.',
        409,
        { currentVersion: Number(current.version) },
      )
    }

    const result = current
      ? await client.query<IntegrationProviderRow>(
          `update integration_providers set
             name = $4,
             provider_type = $5,
             services = $6::text[],
             capabilities = $7::text[],
             mode = $8,
             status = $9,
             priority = $10,
             portal_url = $11,
             api_base_url = $12,
             auth_type = $13,
             base_url_env_name = $14,
             credential_env_name = $15,
             support_contact = $16,
             notes = $17,
             mapping = $18::jsonb,
             version = version + 1,
             updated_by = $19,
             updated_at = now()
           where tenant_id = $1 and id = $3 and provider_key = $2
           returning id, provider_key, name, provider_type, services, capabilities,
                     mode, status, priority, portal_url, api_base_url, auth_type,
                     base_url_env_name, credential_env_name, support_contact, notes,
                     mapping, system_managed, version, created_at, updated_at`,
          providerParameters(principal, current.id, providerKey, normalized),
        )
      : await client.query<IntegrationProviderRow>(
          `insert into integration_providers (
             tenant_id, provider_key, name, provider_type, services, capabilities,
             mode, status, priority, portal_url, api_base_url, auth_type,
             base_url_env_name, credential_env_name, support_contact, notes,
             mapping, system_managed, created_by, updated_by
           ) values (
             $1, $2, $4, $5, $6::text[], $7::text[], $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18::jsonb, $20, $19, $19
           )
           returning id, provider_key, name, provider_type, services, capabilities,
                     mode, status, priority, portal_url, api_base_url, auth_type,
                     base_url_env_name, credential_env_name, support_contact, notes,
                     mapping, system_managed, version, created_at, updated_at`,
          providerParameters(principal, null, providerKey, normalized),
        )
    return mapProvider(result.rows[0], true)
  })

  await writeAuditEvent({
    action: 'integration.provider.upsert',
    result: 'success',
    entityType: 'integration_provider',
    entityId: provider.database_id || provider.id,
    metadata: {
      providerKey: provider.id,
      status: provider.status,
      mode: provider.modo,
      version: provider.version,
    },
  })
  return provider
}

export async function deactivateIntegrationProvider(
  principal: RequestPrincipal,
  providerKeyInput: string,
  expectedVersion?: number,
): Promise<boolean> {
  requireProviderCatalogAdmin(principal)
  const providerKey = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/).parse(providerKeyInput)
  if (providerKey === TECH_PROVIDER_ID) {
    throw new IntegrationProviderServiceError(
      'SYSTEM_PROVIDER_CANNOT_BE_DELETED',
      'O conector principal da Tech Travel pode ser inativado, mas nao removido.',
      409,
    )
  }

  const deleted = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ id: string; version: string | number }>(
      `select id, version
       from integration_providers
       where tenant_id = $1 and provider_key = $2 and deleted_at is null
       for update`,
      [principal.tenantId, providerKey],
    )
    const current = result.rows[0]
    if (!current) return null
    if (expectedVersion && Number(current.version) !== expectedVersion) {
      throw new IntegrationProviderServiceError(
        'INTEGRATION_PROVIDER_VERSION_CONFLICT',
        'O conector foi alterado por outro usuario. Atualize a pagina.',
        409,
        { currentVersion: Number(current.version) },
      )
    }
    await client.query(
      `update integration_providers set
         status = 'inactive',
         deleted_at = now(),
         version = version + 1,
         updated_by = $3,
         updated_at = now()
       where tenant_id = $1 and id = $2`,
      [principal.tenantId, current.id, principal.user.id],
    )
    return current
  })

  if (!deleted) return false
  await writeAuditEvent({
    action: 'integration.provider.deactivate',
    result: 'success',
    entityType: 'integration_provider',
    entityId: deleted.id,
    metadata: { providerKey },
  })
  return true
}

export async function testIntegrationProvider(
  principal: RequestPrincipal,
  providerKeyInput: string,
): Promise<SupplierActionLog> {
  requireProviderCatalogAdmin(principal)
  const providerKey = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/).parse(providerKeyInput)
  const provider = (await listIntegrationProviders(principal)).find((item) => item.id === providerKey)
  if (!provider) {
    throw new IntegrationProviderServiceError(
      'INTEGRATION_PROVIDER_NOT_FOUND',
      'Conector nao encontrado.',
      404,
    )
  }

  const startedAt = Date.now()
  let status: IntegrationActionLogRow['status'] = 'pending'
  let message = 'Conector cadastrado sem teste automatizado disponivel.'
  let payload: Record<string, unknown> = {}
  if (providerKey === TECH_PROVIDER_ID) {
    const health = await integrationRegistry.tech.health()
    status = health.connected ? 'success' : health.configured ? 'failure' : 'pending'
    message = health.message
    payload = maskSensitive({
      configured: health.configured,
      connected: health.connected,
      mode: health.mode,
      capabilities: health.capabilities,
    })
  }

  const row = await withTenantTransaction(principal.tenantId, async (client) => {
    const providerRow = await client.query<{ id: string }>(
      `select id from integration_providers
       where tenant_id = $1 and provider_key = $2 and deleted_at is null`,
      [principal.tenantId, providerKey],
    )
    const result = await client.query<IntegrationActionLogRow>(
      `insert into integration_action_logs (
         tenant_id, provider_id, provider_key, provider_name, action, status,
         message, duration_ms, payload_redacted, actor_user_id
       ) values ($1, $2, $3, $4, 'test', $5, $6, $7, $8::jsonb, $9)
       returning id, provider_key, provider_name, action, service, status,
                 message, payload_redacted, created_at`,
      [
        principal.tenantId,
        providerRow.rows[0]?.id || null,
        providerKey,
        provider.nome,
        status,
        message,
        Date.now() - startedAt,
        JSON.stringify(payload),
        principal.user.id,
      ],
    )
    return result.rows[0]
  })

  await writeAuditEvent({
    action: 'integration.provider.test',
    result: status === 'failure' ? 'failure' : 'success',
    entityType: 'integration_provider',
    entityId: provider.database_id || provider.id,
    metadata: { providerKey, status },
  })
  return mapActionLog(row)
}

export async function listIntegrationProviderLogs(
  principal: RequestPrincipal,
  limit: number,
): Promise<SupplierActionLog[]> {
  requireProviderCatalogAdmin(principal)
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<IntegrationActionLogRow>(
      `select id, provider_key, provider_name, action, service, status,
              message, payload_redacted, created_at
       from integration_action_logs
       where tenant_id = $1
       order by created_at desc, id desc
       limit $2`,
      [principal.tenantId, limit],
    )
    return result.rows.map(mapActionLog)
  })
}

export function canManageProviderCatalog(principal: RequestPrincipal): boolean {
  return principal.platformAdmin || principal.roleKey === 'tenant_admin'
}

function requireProviderCatalogAdmin(principal: RequestPrincipal): void {
  if (!canManageProviderCatalog(principal)) {
    throw new IntegrationProviderServiceError(
      'INTEGRATION_PROVIDER_ADMIN_REQUIRED',
      'Acesso restrito a administracao do tenant.',
      403,
    )
  }
}

function normalizeProviderInput(providerKey: string, input: IntegrationProviderInput) {
  const isTech = providerKey === TECH_PROVIDER_ID
  const status = input.modo === 'api' && !isTech && input.status === 'ativo'
    ? 'pendente_configuracao'
    : input.status
  return {
    ...input,
    status,
    systemManaged: isTech,
  }
}

function providerParameters(
  principal: RequestPrincipal,
  databaseId: string | null,
  providerKey: string,
  input: ReturnType<typeof normalizeProviderInput>,
): unknown[] {
  return [
    principal.tenantId,
    providerKey,
    databaseId,
    input.nome,
    providerTypeToDatabase(input.tipo),
    [...new Set(input.servicos)],
    [...new Set(input.capacidades)],
    providerModeToDatabase(input.modo),
    providerStatusToDatabase(input.status),
    input.prioridade,
    input.portal_url || null,
    input.api_base_url || null,
    input.auth_type,
    input.env_base_url || null,
    input.env_token || null,
    input.contato_suporte || null,
    input.observacoes || null,
    JSON.stringify(input.mapeamento || {}),
    principal.user.id,
    input.systemManaged,
  ]
}

function mapProvider(row: IntegrationProviderRow, includeAdministrativeFields: boolean): IntegrationProviderRecord {
  return {
    id: row.provider_key,
    database_id: row.id,
    nome: row.name,
    tipo: providerTypeFromDatabase(row.provider_type),
    servicos: row.services.filter(isSupplierService),
    capacidades: row.capabilities.filter(isSupplierCapability),
    modo: providerModeFromDatabase(row.mode),
    status: providerStatusFromDatabase(row.status),
    prioridade: Number(row.priority),
    portal_url: row.portal_url || undefined,
    api_base_url: row.api_base_url || undefined,
    auth_type: row.auth_type,
    env_base_url: includeAdministrativeFields ? row.base_url_env_name || undefined : undefined,
    env_token: includeAdministrativeFields ? row.credential_env_name || undefined : undefined,
    contato_suporte: includeAdministrativeFields ? row.support_contact || undefined : undefined,
    observacoes: includeAdministrativeFields ? row.notes || undefined : undefined,
    mapeamento: includeAdministrativeFields ? row.mapping || {} : undefined,
    system_managed: row.system_managed,
    version: Number(row.version),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  }
}

function defaultTechProvider(includeAdministrativeFields: boolean): IntegrationProviderRecord {
  const config = getTechConfig()
  return {
    id: TECH_PROVIDER_ID,
    nome: 'Tech Travel / TTravel Connect',
    tipo: 'consolidadora',
    servicos: ['aereo', 'hotelaria', 'locacao', 'pacotes', 'lazer', 'transfer', 'seguro', 'outros'],
    capacidades: ['importacao', 'status'],
    modo: 'api',
    status: techConfigured(config) ? 'ativo' : 'pendente_configuracao',
    prioridade: 100,
    portal_url: 'https://www.ttravel.com.br/connect/',
    api_base_url: config.baseUrl,
    auth_type: 'api_key',
    env_base_url: includeAdministrativeFields ? 'TECH_API_BASE_URL' : undefined,
    env_token: includeAdministrativeFields ? 'TECH_API_KEY' : undefined,
    observacoes: includeAdministrativeFields
      ? 'Operacoes transacionais dependem dos endpoints e credenciais homologados pela Tech Travel.'
      : undefined,
    system_managed: true,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function mapActionLog(row: IntegrationActionLogRow): SupplierActionLog {
  return {
    id: row.id,
    supplier_id: row.provider_key,
    supplier_name: row.provider_name,
    action: row.action === 'test' ? 'teste' : row.action as SupplierCapability,
    service: isSupplierService(row.service) ? row.service : undefined,
    status: row.status === 'success' ? 'sucesso' : row.status === 'failure' ? 'falha' : 'pendente',
    message: row.message,
    payload: row.payload_redacted,
    created_at: toIso(row.created_at),
  }
}

function providerTypeToDatabase(value: SupplierIntegration['tipo']): IntegrationProviderRow['provider_type'] {
  return {
    consolidadora: 'consolidator',
    operadora: 'operator',
    fornecedor_direto: 'direct_supplier',
    ota: 'ota',
    gds: 'gds',
    outro: 'other',
  }[value] as IntegrationProviderRow['provider_type']
}

function providerTypeFromDatabase(value: IntegrationProviderRow['provider_type']): SupplierIntegration['tipo'] {
  return {
    consolidator: 'consolidadora',
    operator: 'operadora',
    direct_supplier: 'fornecedor_direto',
    ota: 'ota',
    gds: 'gds',
    other: 'outro',
  }[value] as SupplierIntegration['tipo']
}

function providerModeToDatabase(value: SupplierMode): IntegrationProviderRow['mode'] {
  return value === 'portal_assistido' ? 'assisted_portal' : value
}

function providerModeFromDatabase(value: IntegrationProviderRow['mode']): SupplierMode {
  return value === 'assisted_portal' ? 'portal_assistido' : value
}

function providerStatusToDatabase(value: SupplierStatus): IntegrationProviderRow['status'] {
  return {
    ativo: 'active',
    pendente_configuracao: 'pending_configuration',
    inativo: 'inactive',
    falha: 'failed',
  }[value] as IntegrationProviderRow['status']
}

function providerStatusFromDatabase(value: IntegrationProviderRow['status']): SupplierStatus {
  return {
    active: 'ativo',
    pending_configuration: 'pendente_configuracao',
    inactive: 'inativo',
    failed: 'falha',
  }[value] as SupplierStatus
}

function isSupplierService(value: unknown): value is SupplierService {
  return serviceSchema.safeParse(value).success
}

function isSupplierCapability(value: unknown): value is SupplierCapability {
  return capabilitySchema.safeParse(value).success
}

function slugProviderKey(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  if (slug.length >= 2) return slug
  throw new IntegrationProviderServiceError(
    'INVALID_INTEGRATION_PROVIDER_KEY',
    'Nome insuficiente para identificar o conector.',
    400,
  )
}

function emptyToUndefined(value: unknown): unknown {
  return typeof value === 'string' && !value.trim() ? undefined : value
}

function toIso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

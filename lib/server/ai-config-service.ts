import 'server-only'

import { IA_CONFIG_DEFAULT, type IAConfig } from '@/lib/ia-config'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const LegacyStorageKey = 'bbt-ia-config-v12'

export class AiConfigServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AiConfigServiceError'
  }
}

export async function getTenantAiConfig(principal: RequestPrincipal): Promise<IAConfig> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const existing = await client.query<{ config: unknown }>(
      'select config from tenant_ai_settings where tenant_id = $1',
      [principal.tenantId],
    )
    if (existing.rows[0]) return parseConfig(existing.rows[0].config)

    const legacy = await client.query<{ value: unknown }>(
      'select value from app_kv where tenant_id = $1 and key = $2',
      [principal.tenantId, LegacyStorageKey],
    )
    const config = parseConfig(legacy.rows[0]?.value)
    await client.query(
      `insert into tenant_ai_settings (
         tenant_id, config, updated_by_user_id
       ) values ($1, $2::jsonb, $3)
       on conflict (tenant_id) do nothing`,
      [principal.tenantId, JSON.stringify(config), principal.user.id],
    )
    return config
  })
}

export async function updateTenantAiConfig(
  principal: RequestPrincipal,
  config: IAConfig,
): Promise<IAConfig> {
  if (
    !principal.user.permissoes?.alterar_configuracoes
    && !principal.user.permissoes?.gerenciar_usuarios
    && !principal.platformAdmin
    && principal.roleKey !== 'tenant_admin'
  ) {
    throw new AiConfigServiceError(
      'AI_CONFIG_UPDATE_DENIED',
      'Seu perfil nao pode alterar as configuracoes da IA.',
      403,
    )
  }
  const normalized = parseConfig(config)
  await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      `insert into tenant_ai_settings (
         tenant_id, config, updated_by_user_id
       ) values ($1, $2::jsonb, $3)
       on conflict (tenant_id) do update set
         config = excluded.config,
         updated_by_user_id = excluded.updated_by_user_id,
         version = tenant_ai_settings.version + 1`,
      [principal.tenantId, JSON.stringify(normalized), principal.user.id],
    )
  })
  await writeAuditEvent({
    action: 'assistant.ai_config.update',
    result: 'success',
    entityType: 'tenant_ai_settings',
    entityId: principal.tenantId,
  })
  return normalized
}

function parseConfig(value: unknown): IAConfig {
  const item = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const scope = ['tudo', 'sistema_viagens', 'restrito'].includes(String(item.scope))
    ? item.scope as IAConfig['scope']
    : IA_CONFIG_DEFAULT.scope
  return {
    scope,
    permitirInternet: boolean(item.permitirInternet, IA_CONFIG_DEFAULT.permitirInternet),
    permitirCriarDemandas: boolean(item.permitirCriarDemandas, IA_CONFIG_DEFAULT.permitirCriarDemandas),
    permitirCadastrarHoteis: boolean(item.permitirCadastrarHoteis, IA_CONFIG_DEFAULT.permitirCadastrarHoteis),
    permitirReservasTech: boolean(item.permitirReservasTech, IA_CONFIG_DEFAULT.permitirReservasTech),
    permitirFinanceiro: boolean(item.permitirFinanceiro, IA_CONFIG_DEFAULT.permitirFinanceiro),
    exigirConfirmacaoExecucao: boolean(
      item.exigirConfirmacaoExecucao,
      IA_CONFIG_DEFAULT.exigirConfirmacaoExecucao,
    ),
    assuntosBloqueados: typeof item.assuntosBloqueados === 'string'
      ? item.assuntosBloqueados.trim().slice(0, 2_000)
      : IA_CONFIG_DEFAULT.assuntosBloqueados,
  }
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

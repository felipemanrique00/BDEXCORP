import 'server-only'

import { randomUUID } from 'node:crypto'

import { hashPassword } from '@/lib/security/password'
import { assertStrongPassword, type RequestSecurityMetadata } from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  applyDatabaseSecurityContext,
  queryDatabase,
  withDatabaseSecurityContext,
  withTenantTransaction,
} from '@/lib/server/database'
import { emailConfigured, sendTransactionalEmail } from '@/lib/server/email'
import {
  activateEmployeeAuthorizerLinksForInvite,
  EmployeeAuthorizerInviteValidationError,
} from '@/lib/server/employee-authorizer-service'
import { getServerEnvironment } from '@/lib/server/environment'
import { logError } from '@/lib/server/logger'
import { createOpaqueToken, hashSecureToken } from '@/lib/server/secure-token'
import type { RequestPrincipal } from '@/lib/server/request-context'

export interface PlatformPlan {
  id: string
  key: string
  name: string
  status: string
  maxUsers: number | null
  maxStorageBytes: number | null
  maxMonthlyOperations: number | null
  entitlements: Record<string, boolean>
}

export interface PlatformTenant {
  id: string
  name: string
  slug: string
  status: string
  planId: string
  planName: string
  subscriptionStatus: string
  billingMode: string
  createdAt: string
  suspendedAt: string | null
  usage: {
    users: number
    storageBytes: number
    monthlyOperations: number
  }
}

interface TenantRow {
  id: string
  name: string
  slug: string
  status: string
  plan_id: string
  plan_name: string
  subscription_status: string
  billing_mode: string
  created_at: Date
  suspended_at: Date | null
}

export class PlatformConflictError extends Error {}
export class PlatformNotFoundError extends Error {}
export class PlatformConfigurationError extends Error {}
export class InvalidInviteError extends Error {
  constructor() {
    super('Convite invalido ou expirado.')
  }
}

export async function acceptUserInvite(
  token: string,
  password: string,
  metadata: RequestSecurityMetadata,
): Promise<void> {
  assertStrongPassword(password)
  const passwordHash = await hashPassword(password)
  const tokenHash = hashSecureToken(token, 'user-invite')
  const accepted = await withDatabaseSecurityContext({ inviteTokenHash: tokenHash }, async (client) => {
    const result = await client.query<{
      id: string
      tenant_id: string
      user_id: string
      membership_id: string
    }>(
      `select id, tenant_id, user_id, membership_id
       from user_invites
       where token_hash = $1 and accepted_at is null and expires_at > now()
       for update`,
      [tokenHash],
    )
    const invite = result.rows[0]
    if (!invite) throw new InvalidInviteError()
    await applyDatabaseSecurityContext(client, {
      tenantId: invite.tenant_id,
      identityUserId: invite.user_id,
    })
    await client.query(
      `update user_credentials set password_hash = $2, password_updated_at = now(),
         must_change_password = false, failed_attempts = 0, locked_until = null
       where user_id = $1`,
      [invite.user_id, passwordHash],
    )
    await client.query(
      `update users set status = 'active', email_verified_at = coalesce(email_verified_at, now()) where id = $1`,
      [invite.user_id],
    )
    await client.query(
      `update tenant_memberships set status = 'active' where id = $1 and tenant_id = $2`,
      [invite.membership_id, invite.tenant_id],
    )
    try {
      await activateEmployeeAuthorizerLinksForInvite(client, invite)
    } catch (error) {
      if (error instanceof EmployeeAuthorizerInviteValidationError) throw new InvalidInviteError()
      throw error
    }
    await client.query('update user_invites set accepted_at = now() where id = $1', [invite.id])
    return invite
  })
  await writeAuditEvent({
    action: 'auth.invite_accept',
    result: 'success',
    tenantId: accepted.tenant_id,
    actorUserId: accepted.user_id,
    requestId: metadata.requestId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    entityType: 'membership',
    entityId: accepted.membership_id,
  })
}

export async function listPlatformPlans(): Promise<PlatformPlan[]> {
  const result = await queryDatabase<{
    id: string
    plan_key: string
    name: string
    status: string
    max_users: number | null
    max_storage_bytes: string | number | null
    max_monthly_operations: number | null
    entitlements: Record<string, unknown>
  }>('select * from plans order by name')
  return result.rows.map((row) => ({
    id: row.id,
    key: row.plan_key,
    name: row.name,
    status: row.status,
    maxUsers: row.max_users,
    maxStorageBytes: row.max_storage_bytes === null ? null : Number(row.max_storage_bytes),
    maxMonthlyOperations: row.max_monthly_operations,
    entitlements: booleanRecord(row.entitlements),
  }))
}

export async function upsertPlatformPlan(input: {
  id?: string
  key: string
  name: string
  active: boolean
  maxUsers: number | null
  maxStorageBytes: number | null
  maxMonthlyOperations: number | null
  entitlements: Record<string, boolean>
}): Promise<PlatformPlan> {
  const result = await queryDatabase<{ id: string }>(
    input.id
      ? `update plans set plan_key = $2, name = $3, status = $4,
           max_users = $5, max_storage_bytes = $6, max_monthly_operations = $7, entitlements = $8::jsonb
         where id = $1 returning id`
      : `insert into plans (id, plan_key, name, status, max_users, max_storage_bytes, max_monthly_operations, entitlements)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning id`,
    [
      input.id || randomUUID(),
      input.key,
      input.name,
      input.active ? 'active' : 'inactive',
      input.maxUsers,
      input.maxStorageBytes,
      input.maxMonthlyOperations,
      JSON.stringify(input.entitlements),
    ],
  )
  if (!result.rows[0]) throw new PlatformNotFoundError('Plano nao encontrado.')
  return (await listPlatformPlans()).find((plan) => plan.id === result.rows[0].id)!
}

export async function listPlatformTenants(principal: RequestPrincipal): Promise<PlatformTenant[]> {
  const result = await withDatabaseSecurityContext(
    { platformAdminUserId: principal.user.id },
    (client) => client.query<TenantRow>(
      `select t.id, t.name, t.slug::text, t.status, t.created_at, t.suspended_at,
         p.id as plan_id, p.name as plan_name, s.status as subscription_status, s.billing_mode
       from tenants t
       join tenant_subscriptions s on s.tenant_id = t.id
       join plans p on p.id = s.plan_id
       order by t.created_at desc`,
    ),
  )
  const tenants: PlatformTenant[] = []
  for (const row of result.rows) {
    const usage = await withTenantTransaction(row.id, async (client) => {
      const values = await client.query<{
        users: string
        storage_bytes: string
        monthly_operations: string
      }>(
        `select
           (select count(*) from tenant_memberships where tenant_id = $1 and status in ('active', 'invited'))::text as users,
           (
             coalesce((select sum(pg_column_size(value)) from app_kv where tenant_id = $1), 0) +
             coalesce((select sum(size_bytes) from stored_files where tenant_id = $1 and status = 'active'), 0)
           )::bigint::text as storage_bytes,
           coalesce((
             select operations_created from tenant_usage_monthly
             where tenant_id = $1 and month_start = date_trunc('month', current_date)::date
           ), 0)::text as monthly_operations`,
        [row.id],
      )
      return values.rows[0]
    })
    tenants.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      planId: row.plan_id,
      planName: row.plan_name,
      subscriptionStatus: row.subscription_status,
      billingMode: row.billing_mode,
      createdAt: row.created_at.toISOString(),
      suspendedAt: row.suspended_at?.toISOString() || null,
      usage: {
        users: Number(usage?.users || 0),
        storageBytes: Number(usage?.storage_bytes || 0),
        monthlyOperations: Number(usage?.monthly_operations || 0),
      },
    })
  }
  return tenants
}

export async function createPlatformTenant(
  principal: RequestPrincipal,
  input: {
    name: string
    slug: string
    planId: string
    adminName: string
    adminEmail: string
  },
): Promise<PlatformTenant> {
  if (!emailConfigured()) throw new PlatformConfigurationError('SMTP deve estar configurado para enviar o convite do administrador.')
  const environment = getServerEnvironment()
  if (!environment.APP_URL) throw new PlatformConfigurationError('APP_URL obrigatorio para criar o tenant.')

  const tenantId = randomUUID()
  const userId = randomUUID()
  const membershipId = randomUUID()
  const inviteToken = createOpaqueToken()
  const inviteHash = hashSecureToken(inviteToken, 'user-invite')
  const unusablePasswordHash = await hashPassword(createOpaqueToken(48))

  try {
    await withDatabaseSecurityContext({ platformAdminUserId: principal.user.id }, async (client) => {
      const plan = await client.query('select id from plans where id = $1 and status = $2', [input.planId, 'active'])
      if (!plan.rowCount) throw new PlatformNotFoundError('Plano ativo nao encontrado.')
      const duplicateTenant = await client.query('select 1 from tenants where slug = $1', [input.slug])
      if (duplicateTenant.rowCount) throw new PlatformConflictError('Ja existe tenant com este identificador.')
      const duplicateUser = await client.query('select 1 from users where email = $1 and deleted_at is null', [input.adminEmail])
      if (duplicateUser.rowCount) throw new PlatformConflictError('O e-mail do administrador ja pertence a outra conta.')

      await client.query(
        `insert into tenants (id, name, slug, status) values ($1, $2, $3, 'active')`,
        [tenantId, input.name, input.slug],
      )
      await applyDatabaseSecurityContext(client, { tenantId })
      await client.query(
        `insert into tenant_subscriptions (tenant_id, plan_id, status, billing_mode)
         values ($1, $2, 'active', 'manual')`,
        [tenantId, input.planId],
      )
      await client.query(
        `insert into tenant_domain_rollouts (
           tenant_id, domain_key, read_mode, write_mode, status, metadata
         )
         select
           $1,
           domain_key,
            'relational',
            'relational',
            'active',
            '{"source":"platform-tenant-create","relationalDefault":true}'::jsonb
         from unnest($2::text[]) domain_key`,
        [tenantId, ['approvals', 'demands', 'emissions', 'finance', 'requesters', 'vouchers']],
      )
      const roles = await createTenantRoles(client, tenantId)
      await client.query(
        `insert into users (id, email, name, status) values ($1, $2, $3, 'invited')`,
        [userId, input.adminEmail, input.adminName],
      )
      await client.query(
        `insert into user_credentials (user_id, password_hash, must_change_password)
         values ($1, $2, true)`,
        [userId, unusablePasswordHash],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id, status, profile_key)
         values ($1, $2, $3, $4, 'invited', 'lider')`,
        [membershipId, tenantId, userId, roles.tenant_admin],
      )
      await client.query(
        `insert into user_invites (tenant_id, user_id, membership_id, token_hash, expires_at, created_by)
         values ($1, $2, $3, $4, now() + interval '72 hours', $5)`,
        [tenantId, userId, membershipId, inviteHash, principal.user.id],
      )
    })

    const inviteUrl = new URL('/aceitar-convite', environment.APP_URL)
    inviteUrl.searchParams.set('token', inviteToken)
    await sendTransactionalEmail({
      to: input.adminEmail,
      subject: 'Convite para o BBT Corporativo',
      text: `Ola, ${input.adminName}. Voce foi convidado para administrar ${input.name}. Defina sua senha em: ${inviteUrl.toString()}\n\nO link expira em 72 horas.`,
      html: `<p>Ola, ${escapeHtml(input.adminName)}.</p><p>Voce foi convidado para administrar <strong>${escapeHtml(input.name)}</strong>.</p><p><a href="${escapeHtml(inviteUrl.toString())}">Aceitar convite e definir senha</a></p><p>O link expira em 72 horas.</p>`,
    })
  } catch (error) {
    await cleanupFailedTenantCreation(principal, tenantId, userId)
    throw error
  }

  await writeAuditEvent({
    action: 'platform.tenant_create',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'tenant',
    entityId: tenantId,
    metadata: { targetTenantId: tenantId, planId: input.planId, billingMode: 'manual' },
  })
  return (await listPlatformTenants(principal)).find((tenant) => tenant.id === tenantId)!
}

export async function updatePlatformTenant(
  principal: RequestPrincipal,
  tenantId: string,
  input: { status: 'trial' | 'active' | 'suspended' | 'cancelled'; planId: string },
): Promise<PlatformTenant> {
  await withDatabaseSecurityContext(
    { tenantId, platformAdminUserId: principal.user.id },
    async (client) => {
      const plan = await client.query('select 1 from plans where id = $1 and status = $2', [input.planId, 'active'])
      if (!plan.rowCount) throw new PlatformNotFoundError('Plano ativo nao encontrado.')
      const tenant = await client.query(
        `update tenants set status = $2, suspended_at = case when $2 = 'suspended' then now() else null end
         where id = $1 returning id`,
        [tenantId, input.status],
      )
      if (!tenant.rowCount) throw new PlatformNotFoundError('Tenant nao encontrado.')
      const subscriptionStatus = input.status === 'trial' ? 'trial' : input.status === 'active' ? 'active' : input.status
      await client.query(
        `update tenant_subscriptions set plan_id = $2, status = $3,
           cancelled_at = case when $3 = 'cancelled' then now() else null end
         where tenant_id = $1`,
        [tenantId, input.planId, subscriptionStatus],
      )
    },
  )
  await writeAuditEvent({
    action: 'platform.tenant_update',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'tenant',
    entityId: tenantId,
    metadata: { targetTenantId: tenantId, status: input.status, planId: input.planId },
  })
  const updated = (await listPlatformTenants(principal)).find((tenant) => tenant.id === tenantId)
  if (!updated) throw new PlatformNotFoundError('Tenant nao encontrado.')
  return updated
}

async function createTenantRoles(client: import('pg').PoolClient, tenantId: string): Promise<Record<string, string>> {
  const definitions = tenantRoleDefinitions()
  const ids: Record<string, string> = {}
  for (const definition of definitions) {
    const role = await client.query<{ id: string }>(
      `insert into roles (tenant_id, role_key, name, description, system_role)
       values ($1, $2, $3, $4, true) returning id`,
      [tenantId, definition.key, definition.name, definition.description],
    )
    ids[definition.key] = role.rows[0].id
    if (definition.key === 'tenant_admin') {
      await client.query(
        `insert into role_permissions (role_id, permission_key, allowed)
         select $1, permission_key, true from permissions`,
        [role.rows[0].id],
      )
      continue
    }
    for (const permission of definition.permissions) {
      await client.query(
        'insert into role_permissions (role_id, permission_key, allowed) values ($1, $2, true)',
        [role.rows[0].id, permission],
      )
    }
  }
  return ids
}

function tenantRoleDefinitions() {
  const all = [
    'ver_financeiro', 'editar_financeiro', 'cadastrar_empresas', 'cadastrar_funcionarios',
    'cadastrar_hoteis', 'editar_politicas', 'gerar_relatorios', 'importar_planilhas',
    'ver_produtividade_todos', 'gerenciar_usuarios', 'excluir_demandas', 'aprovar_demandas',
  ]
  return [
    { key: 'tenant_admin', name: 'Administrador do tenant', description: 'Administracao integral do ambiente', permissions: all },
    { key: 'agent', name: 'Agente', description: 'Operacao de viagens', permissions: ['cadastrar_funcionarios', 'operar_cotacoes', 'operar_reservas', 'operar_emissoes', 'operar_cancelamentos', 'gerenciar_integracoes', 'ver_politicas', 'ver_aprovacoes'] },
    { key: 'financial_manager', name: 'Gestor financeiro', description: 'Gestao financeira e relatorios', permissions: ['ver_financeiro', 'editar_financeiro', 'gerar_relatorios', 'importar_planilhas', 'ver_produtividade_todos', 'aprovar_demandas', 'operar_cotacoes', 'ver_politicas', 'ver_aprovacoes', 'decidir_aprovacoes'] },
    { key: 'supervisor', name: 'Supervisor', description: 'Supervisao operacional', permissions: ['ver_financeiro', 'cadastrar_empresas', 'cadastrar_funcionarios', 'cadastrar_hoteis', 'editar_politicas', 'gerar_relatorios', 'importar_planilhas', 'ver_produtividade_todos', 'aprovar_demandas', 'operar_cotacoes', 'operar_reservas', 'operar_emissoes', 'operar_cancelamentos', 'gerenciar_integracoes', 'ver_politicas', 'gerenciar_politicas', 'simular_politicas', 'ver_aprovacoes', 'decidir_aprovacoes', 'gerenciar_workflows'] },
    { key: 'operator', name: 'Operacional', description: 'Operacao com acesso controlado', permissions: ['operar_cotacoes', 'operar_reservas', 'operar_emissoes', 'operar_cancelamentos', 'gerenciar_integracoes', 'ver_politicas', 'ver_aprovacoes'] },
    { key: 'company_admin', name: 'Administrador de empresa', description: 'Administracao restrita as empresas vinculadas', permissions: ['cadastrar_funcionarios', 'gerar_relatorios', 'aprovar_demandas', 'ver_politicas', 'gerenciar_politicas', 'simular_politicas', 'ver_aprovacoes', 'decidir_aprovacoes', 'gerenciar_workflows', 'gerenciar_delegacoes'] },
    { key: 'requester', name: 'Solicitante', description: 'Criacao e acompanhamento de demandas', permissions: ['ver_politicas', 'ver_aprovacoes'] },
    { key: 'readonly', name: 'Somente leitura', description: 'Consulta sem alteracoes', permissions: ['gerar_relatorios', 'ver_politicas', 'ver_aprovacoes'] },
  ]
}

async function cleanupFailedTenantCreation(
  principal: RequestPrincipal,
  tenantId: string,
  userId: string,
): Promise<void> {
  try {
    await withDatabaseSecurityContext(
      { tenantId, platformAdminUserId: principal.user.id },
      async (client) => {
        await client.query('delete from tenant_subscriptions where tenant_id = $1', [tenantId])
        await client.query('delete from tenants where id = $1', [tenantId])
        await client.query(
          'delete from users where id = $1 and not exists (select 1 from tenant_memberships where user_id = $1)',
          [userId],
        )
      },
    )
  } catch (error) {
    logError('tenant_creation_cleanup_failed', error, {
      errorCode: 'TENANT_CREATION_CLEANUP_FAILED',
      tenantId,
      userId,
    })
  }
}

function booleanRecord(value: Record<string, unknown> | null): Record<string, boolean> {
  if (!value) return {}
  return Object.fromEntries(Object.entries(value).map(([key, enabled]) => [key, enabled === true]))
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character)
}

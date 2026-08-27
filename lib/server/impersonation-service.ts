import 'server-only'

import { loadPrincipalForAuthenticatedUser } from '@/lib/server/auth-service'
import { mergePermissions } from '@/lib/corporate-access'
import { allowedImpersonationActions } from '@/lib/impersonation-action-policy'
import { writeAuditEvent, writeAuditEventInTransaction } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import { isLocalMfaBypassEnabled } from '@/lib/server/environment'
import type {
  RequestPrincipal,
  RequestPrincipalRepresentation,
  SupportImpersonationMode,
} from '@/lib/server/request-context'
import type { CorporateProfile } from '@/types'

const MAX_TTL_MS = 15 * 60 * 1_000
const TARGET_ROLE_KEYS = ['company_admin', 'requester', 'readonly'] as const
const ACTOR_ROLE_KEYS = ['tenant_admin', 'supervisor', 'agent', 'operator'] as const

export interface ImpersonationSecurityMetadata {
  requestId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface StartImpersonationInput {
  targetMembershipId: string
  companyId: string
  mode: SupportImpersonationMode
  reason: string
  reference?: string | null
}

export interface ImpersonationTarget {
  userId: string
  membershipId: string
  name: string
  email: string
  roleKey: string
  corporateProfile?: CorporateProfile
  companyId: string | null
  companyIds: string[]
  groupIds: string[]
  companyScopes: Array<{
    companyId: string
    label: string
    allowedActions: string[]
  }>
}

interface TargetIdentityRow {
  user_id: string
  membership_id: string
  name: string
  email: string
  role_key: string
}

interface ActiveImpersonationRow {
  id: string
  target_user_id: string
  target_membership_id: string
  mode: SupportImpersonationMode
  reason: string
  reference: string | null
  allowed_actions: string[]
  company_ids: string[]
  status: string
  started_at: Date
  expires_at: Date
}

export class ImpersonationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ImpersonationError'
  }
}

export function currentRepresentation(principal: RequestPrincipal): RequestPrincipalRepresentation | null {
  return principal.representation || null
}

export function canManageImpersonations(principal: RequestPrincipal): boolean {
  const actor = principal.actor || principal
  return actor.user.ativo !== false
    && ACTOR_ROLE_KEYS.includes(actor.roleKey as typeof ACTOR_ROLE_KEYS[number])
    && actor.user.permissoes?.gerenciar_personificacoes === true
}

export function hasRecentActorMfa(principal: RequestPrincipal, now = Date.now()): boolean {
  if (isLocalMfaBypassEnabled()) return true
  const verifiedAt = principal.mfaVerifiedAt ? Date.parse(principal.mfaVerifiedAt) : Number.NaN
  return principal.authenticationLevel === 'mfa'
    && Number.isFinite(verifiedAt)
    && verifiedAt <= now
    && now - verifiedAt <= MAX_TTL_MS
}

export async function resolveActiveImpersonation(
  actor: RequestPrincipal,
  impersonationId: string | null | undefined,
): Promise<RequestPrincipal> {
  if (!impersonationId) return actor
  const row = await withTenantTransaction(actor.tenantId, async (client) => {
    const result = await client.query<ActiveImpersonationRow>(
      `select id, target_user_id, target_membership_id, mode, reason, reference,
              allowed_actions, company_ids, status, started_at, expires_at
       from support_impersonations
       where id = $1 and tenant_id = $2 and actor_session_id = $3
       limit 1`,
      [impersonationId, actor.tenantId, actor.sessionId],
    )
    return result.rows[0] || null
  })
  if (!row || row.status !== 'active') {
    await clearStaleSessionLink(actor, impersonationId)
    return actor
  }
  if (row.expires_at.getTime() <= Date.now()) {
    await expireImpersonation(actor, row, 'ttl_expired')
    return actor
  }
  if (!canManageImpersonations(actor)) {
    await expireImpersonation(actor, row, 'actor_permission_revoked')
    return actor
  }
  const target = await loadPrincipalForAuthenticatedUser(row.target_user_id, actor.tenantId, row.target_membership_id)
  if (!target || target.platformAdmin || !TARGET_ROLE_KEYS.includes(target.roleKey as never)) {
    await expireImpersonation(actor, row, 'target_inactive')
    return actor
  }
  const currentCompanyIds = new Set(representationCompanyScope(actor, target))
  if (row.company_ids.length !== 1 || row.company_ids.some((companyId) => !currentCompanyIds.has(companyId))) {
    await expireImpersonation(actor, row, 'company_scope_changed')
    return actor
  }
  const currentActions = new Set<string>(allowedImpersonationActions(actor, target, row.company_ids))
  if (row.allowed_actions.some((action) => !currentActions.has(action))) {
    await expireImpersonation(actor, row, 'action_scope_changed')
    return actor
  }
  const representation = representationFor(
    row.id, actor, target, row.mode, row.reason, row.reference,
    row.allowed_actions, row.company_ids, row.started_at, row.expires_at,
  )
  const restrictedTarget = restrictPrincipalToRepresentationCompanies(target, row.company_ids)
  return {
    ...restrictedTarget,
    sessionId: actor.sessionId,
    authenticationLevel: actor.authenticationLevel,
    mfaVerifiedAt: actor.mfaVerifiedAt,
    actor: {
      sessionId: actor.sessionId,
      membershipId: actor.membershipId,
      roleKey: actor.roleKey,
      platformAdmin: actor.platformAdmin,
      user: actor.user,
    },
    representation,
  }
}

function restrictPrincipalToRepresentationCompanies(
  target: RequestPrincipal,
  companyIds: string[],
): RequestPrincipal {
  const allowed = new Set(companyIds)
  const access = target.corporateAccess
  if (!access) {
    return {
      ...target,
      user: {
        ...target.user,
        company_id: allowed.has(target.user.company_id || '') ? target.user.company_id : companyIds[0] || null,
        empresa_ids: companyIds,
      },
    }
  }
  const companies = access.companies.filter((company) => allowed.has(company.companyId))
  const groups = access.groups.flatMap((group) => {
    const scopedCompanyIds = group.companyIds.filter((companyId) => allowed.has(companyId))
    return scopedCompanyIds.length ? [{ ...group, companyIds: scopedCompanyIds }] : []
  })
  const contexts = access.contexts.flatMap((context) => {
    const scopedCompanyIds = context.companyIds.filter((companyId) => allowed.has(companyId))
    return scopedCompanyIds.length ? [{ ...context, companyIds: scopedCompanyIds }] : []
  })
  const defaultContext = access.defaultContext
    && contexts.some((context) => context.type === access.defaultContext!.type && context.id === access.defaultContext!.id)
    ? access.defaultContext
    : contexts[0] ? { type: contexts[0].type, id: contexts[0].id } : null
  const corporateAccess = {
    ...access,
    tenantWide: false,
    companyIds,
    groupIds: groups.map((group) => group.groupId),
    companies,
    groups,
    contexts,
    defaultContext,
  }
  const permissions = {
    ...mergePermissions(companies.map((company) => company.permissions)),
    gerenciar_personificacoes: false,
  }
  const allowedGroupIds = new Set(corporateAccess.groupIds)
  const authorizationGrants = target.authorizationGrants?.filter((grant) => {
    if (grant.permission === 'gerenciar_personificacoes') return false
    if (grant.companyId && !allowed.has(grant.companyId)) return false
    if (grant.scopeType === 'company') return allowed.has(grant.scopeId)
    if (grant.scopeType === 'group') return allowedGroupIds.has(grant.scopeId)
    if (grant.scopeType === 'tenant') return true
    if (grant.scopeType === 'user') return grant.scopeId === target.user.id
    return Boolean(grant.companyId && allowed.has(grant.companyId))
  })
  return {
    ...target,
    corporateAccess,
    authorizationGrants,
    user: {
      ...target.user,
      permissoes: permissions,
      company_id: allowed.has(target.user.company_id || '') ? target.user.company_id : companyIds[0] || null,
      empresa_ids: companyIds,
      grupo_ids: corporateAccess.groupIds,
      corporate_access: corporateAccess,
    },
  }
}

export async function listImpersonationTargets(
  principal: RequestPrincipal,
  search = '',
  limit = 30,
  metadata: ImpersonationSecurityMetadata = {},
): Promise<ImpersonationTarget[]> {
  await assertActorEligible(principal, metadata, 'list_targets')
  if (principal.representation) throw new ImpersonationError('Encerre a personificacao atual.', 'IMPERSONATION_ALREADY_ACTIVE', 409)
  const normalizedSearch = search.trim().slice(0, 120)
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 30))
  const rows = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<TargetIdentityRow>(
      `select u.id as user_id, m.id as membership_id, u.name, u.email::text, r.role_key
       from tenant_memberships m
       join users u on u.id = m.user_id
       join roles r on r.id = m.role_id and (r.tenant_id = m.tenant_id or r.tenant_id is null)
       where m.tenant_id = $1
         and m.status = 'active'
         and u.status = 'active'
         and u.deleted_at is null
         and u.platform_admin = false
         and r.role_key = any($2::text[])
         and u.id <> $3
         and ($4 = '' or u.name ilike '%' || $4 || '%' or u.email::text ilike '%' || $4 || '%')
       order by u.name, u.email
       limit $5`,
      [principal.tenantId, TARGET_ROLE_KEYS, principal.user.id, normalizedSearch, Math.min(250, safeLimit * 5)],
    )
    return result.rows
  })
  const hydrated = await Promise.all(rows.map(async (row) => {
    const target = await loadPrincipalForAuthenticatedUser(row.user_id, principal.tenantId, row.membership_id)
    if (!target) return null
    const companyIds = representationCompanyScope(principal, target)
    return companyIds.length ? toTarget(principal, target, companyIds) : null
  }))
  return hydrated.filter((target): target is ImpersonationTarget => Boolean(target)).slice(0, safeLimit)
}

export async function startImpersonation(
  principal: RequestPrincipal,
  input: StartImpersonationInput,
  metadata: ImpersonationSecurityMetadata = {},
): Promise<RequestPrincipalRepresentation> {
  await assertActorEligible(principal, metadata, 'start')
  if (principal.representation) throw new ImpersonationError('Ja existe uma personificacao ativa.', 'IMPERSONATION_ALREADY_ACTIVE', 409)
  const reason = input.reason.trim()
  const reference = input.reference?.trim() || null
  if (reason.length < 10 || reason.length > 500) {
    throw new ImpersonationError('Informe um motivo entre 10 e 500 caracteres.', 'IMPERSONATION_REASON_INVALID', 400)
  }
  if (!['test', 'operate'].includes(input.mode)) {
    throw new ImpersonationError('Modo de personificacao invalido.', 'IMPERSONATION_MODE_INVALID', 400)
  }
  if (input.mode === 'operate' && !reference) {
    throw new ImpersonationError('Informe a referencia do atendimento.', 'IMPERSONATION_REFERENCE_REQUIRED', 400)
  }
  if (reference && reference.length > 160) {
    throw new ImpersonationError('Referencia muito longa.', 'IMPERSONATION_REFERENCE_INVALID', 400)
  }

  const identity = await loadTargetIdentity(principal, input.targetMembershipId)
  if (!identity) {
    await auditDenied(principal, metadata, 'target_invalid')
    throw new ImpersonationError('Usuario corporativo alvo indisponivel.', 'IMPERSONATION_TARGET_INVALID', 404)
  }
  const target = await loadPrincipalForAuthenticatedUser(identity.user_id, principal.tenantId, identity.membership_id)
  if (!target || target.platformAdmin || target.user.id === principal.user.id || !TARGET_ROLE_KEYS.includes(target.roleKey as never)) {
    await auditDenied(principal, metadata, 'target_invalid')
    throw new ImpersonationError('Usuario corporativo alvo indisponivel.', 'IMPERSONATION_TARGET_INVALID', 404)
  }
  const sharedCompanyIds = representationCompanyScope(principal, target)
  if (!sharedCompanyIds.length) {
    await auditDenied(principal, metadata, 'target_company_scope_empty')
    throw new ImpersonationError('O alvo nao compartilha empresas autorizadas com o operador.', 'IMPERSONATION_COMPANY_SCOPE_DENIED', 403)
  }
  const selectedCompanyId = typeof input.companyId === 'string' ? input.companyId.trim() : ''
  if (!selectedCompanyId || !sharedCompanyIds.includes(selectedCompanyId)) {
    await auditDenied(principal, metadata, 'selected_company_scope_denied')
    throw new ImpersonationError(
      'A empresa selecionada nao pertence ao escopo compartilhado com o usuario alvo.',
      'IMPERSONATION_COMPANY_SCOPE_DENIED',
      403,
    )
  }
  const companyIds = [selectedCompanyId]
  const allowedActions = input.mode === 'operate'
    ? allowedImpersonationActions(principal, target, companyIds)
    : []
  if (input.mode === 'operate' && !allowedActions.length) {
    await auditDenied(principal, metadata, 'target_has_no_operational_actions')
    throw new ImpersonationError(
      'O usuario alvo nao possui acoes operacionais disponiveis nas empresas compartilhadas.',
      'IMPERSONATION_ACTION_SCOPE_EMPTY',
      422,
    )
  }
  const startedAt = new Date()
  const expiresAt = new Date(startedAt.getTime() + MAX_TTL_MS)

  const created = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into support_impersonations (
         tenant_id, actor_session_id, actor_user_id, actor_membership_id,
         target_user_id, target_membership_id, mode, reason, reference,
         allowed_actions, company_ids, started_at, expires_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id`,
      [
        principal.tenantId, principal.sessionId, principal.user.id, principal.membershipId,
        target.user.id, target.membershipId, input.mode, reason, reference,
        allowedActions, companyIds, startedAt, expiresAt,
      ],
    )
    const id = result.rows[0].id
    const linked = await client.query(
      `update user_sessions set active_impersonation_id = $2
       where id = $1 and tenant_id = $3 and status = 'active' and active_impersonation_id is null`,
      [principal.sessionId, id, principal.tenantId],
    )
    if (linked.rowCount !== 1) throw new ImpersonationError('Sessao indisponivel para personificacao.', 'IMPERSONATION_SESSION_INVALID', 409)
    await writeAuditEventInTransaction(client, {
      action: 'auth.impersonation.start', result: 'success', tenantId: principal.tenantId,
      actorUserId: principal.user.id, requestId: metadata.requestId, entityType: 'support_impersonation', entityId: id,
      ipAddress: metadata.ipAddress, userAgent: metadata.userAgent,
      metadata: { targetUserId: target.user.id, targetMembershipId: target.membershipId, companyId: selectedCompanyId, mode: input.mode, reference, reason },
    })
    return id
  })

  return representationFor(created, principal, target, input.mode, reason, reference, allowedActions, companyIds, startedAt, expiresAt)
}

export async function stopImpersonation(
  principal: RequestPrincipal,
  endReason = 'Encerrada pelo operador.',
  metadata: ImpersonationSecurityMetadata = {},
): Promise<void> {
  const actor = principal.actor
  const representation = principal.representation
  if (!actor || !representation) throw new ImpersonationError('Nao existe personificacao ativa.', 'IMPERSONATION_NOT_ACTIVE', 409)
  const normalizedReason = endReason.trim().slice(0, 200) || 'Encerrada pelo operador.'
  await withTenantTransaction(principal.tenantId, async (client) => {
    const ended = await client.query(
      `update support_impersonations
       set status = 'stopped', ended_at = now(), end_reason = $4
       where id = $1 and tenant_id = $2 and actor_session_id = $3 and status = 'active'`,
      [representation.id, principal.tenantId, actor.sessionId, normalizedReason],
    )
    if (ended.rowCount !== 1) throw new ImpersonationError('A personificacao ja foi encerrada.', 'IMPERSONATION_NOT_ACTIVE', 409)
    await client.query(
      `update user_sessions set active_impersonation_id = null
       where id = $1 and tenant_id = $2 and active_impersonation_id = $3`,
      [actor.sessionId!, principal.tenantId, representation.id],
    )
    await writeAuditEventInTransaction(client, {
      action: 'auth.impersonation.stop', result: 'success', tenantId: principal.tenantId,
      actorUserId: actor.user.id, requestId: metadata.requestId, entityType: 'support_impersonation', entityId: representation.id,
      ipAddress: metadata.ipAddress, userAgent: metadata.userAgent,
      metadata: { targetUserId: representation.subject.id, mode: representation.mode, endReason: normalizedReason },
    })
  })
}

async function assertActorEligible(
  principal: RequestPrincipal,
  metadata: ImpersonationSecurityMetadata,
  operation: string,
): Promise<void> {
  if (!canManageImpersonations(principal)) {
    await auditDenied(principal, metadata, `${operation}:permission`)
    throw new ImpersonationError('Permissao de personificacao insuficiente.', 'IMPERSONATION_PERMISSION_DENIED', 403)
  }
  if (!hasRecentActorMfa(principal)) {
    await auditDenied(principal, metadata, `${operation}:mfa`)
    throw new ImpersonationError('Confirme o MFA novamente para personificar.', 'IMPERSONATION_MFA_REQUIRED', 403)
  }
}

async function auditDenied(principal: RequestPrincipal, metadata: ImpersonationSecurityMetadata, reason: string): Promise<void> {
  const actor = principal.actor || principal
  await writeAuditEvent({
    action: 'auth.impersonation.denied', result: 'denied', tenantId: principal.tenantId,
    actorUserId: actor.user.id, requestId: metadata.requestId,
    ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, metadata: { reason },
  })
}

async function clearStaleSessionLink(actor: RequestPrincipal, impersonationId: string): Promise<void> {
  await withTenantTransaction(actor.tenantId, (client) => client.query(
    `update user_sessions set active_impersonation_id = null
     where id = $1 and tenant_id = $2 and active_impersonation_id = $3`,
    [actor.sessionId, actor.tenantId, impersonationId],
  ))
}

async function expireImpersonation(
  actor: RequestPrincipal,
  row: ActiveImpersonationRow,
  endReason: string,
): Promise<void> {
  await withTenantTransaction(actor.tenantId, async (client) => {
    await client.query(
      `update support_impersonations
       set status = 'expired', ended_at = now(), end_reason = $4
       where id = $1 and tenant_id = $2 and actor_session_id = $3 and status = 'active'`,
      [row.id, actor.tenantId, actor.sessionId, endReason],
    )
    await client.query(
      `update user_sessions set active_impersonation_id = null
       where id = $1 and tenant_id = $2 and active_impersonation_id = $3`,
      [actor.sessionId, actor.tenantId, row.id],
    )
    await writeAuditEventInTransaction(client, {
      action: 'auth.impersonation.expire', result: 'success', tenantId: actor.tenantId,
      actorUserId: actor.user.id, entityType: 'support_impersonation', entityId: row.id,
      metadata: { targetUserId: row.target_user_id, mode: row.mode, endReason },
    })
  })
}

async function loadTargetIdentity(principal: RequestPrincipal, membershipId: string): Promise<TargetIdentityRow | null> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<TargetIdentityRow>(
      `select u.id as user_id, m.id as membership_id, u.name, u.email::text, r.role_key
       from tenant_memberships m
       join users u on u.id = m.user_id
       join roles r on r.id = m.role_id and (r.tenant_id = m.tenant_id or r.tenant_id is null)
       where m.id = $1 and m.tenant_id = $2 and m.status = 'active'
         and u.status = 'active' and u.deleted_at is null and u.platform_admin = false
         and r.role_key = any($3::text[]) and u.id <> $4
       limit 1`,
      [membershipId, principal.tenantId, TARGET_ROLE_KEYS, principal.user.id],
    )
    return result.rows[0] || null
  })
}

function toTarget(actor: RequestPrincipal, target: RequestPrincipal, companyIds: string[]): ImpersonationTarget {
  return {
    userId: target.user.id, membershipId: target.membershipId, name: target.user.name, email: target.user.email,
    roleKey: target.roleKey, corporateProfile: target.user.corporate_profile,
    companyId: companyIds.includes(target.user.company_id || '') ? target.user.company_id : companyIds[0] || null,
    companyIds,
    groupIds: target.corporateAccess?.groupIds || target.user.grupo_ids || [],
    companyScopes: companyIds.map((companyId) => ({
      companyId,
      label: companyScopeLabel(target, companyId),
      allowedActions: allowedImpersonationActions(actor, target, [companyId]),
    })),
  }
}

function companyScopeLabel(target: RequestPrincipal, companyId: string): string {
  return target.corporateAccess?.companies.find((company) => company.companyId === companyId)?.companyName
    || `Empresa ${companyId}`
}

function representationCompanyScope(actor: RequestPrincipal, target: RequestPrincipal): string[] {
  const targetCompanyIds = target.corporateAccess?.companyIds || target.user.empresa_ids || []
  const actorTenantWide = actor.platformAdmin || actor.roleKey === 'tenant_admin' || actor.corporateAccess?.tenantWide === true
  if (actorTenantWide) return [...new Set(targetCompanyIds)]
  const actorCompanyIds = new Set(actor.corporateAccess?.companyIds || actor.user.empresa_ids || [])
  return [...new Set(targetCompanyIds.filter((companyId) => actorCompanyIds.has(companyId)))]
}

function representationFor(
  id: string, actor: RequestPrincipal, target: RequestPrincipal, mode: SupportImpersonationMode,
  reason: string, reference: string | null, allowedActions: string[], companyIds: string[],
  startedAt: Date, expiresAt: Date,
): RequestPrincipalRepresentation {
  return {
    id, mode,
    actor: { id: actor.user.id, name: actor.user.name, email: actor.user.email, roleKey: actor.roleKey },
    subject: {
      id: target.user.id, name: target.user.name, email: target.user.email, roleKey: target.roleKey,
      membershipId: target.membershipId, corporateProfile: target.user.corporate_profile,
    },
    reason, reference, allowedActions, companyIds,
    startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(),
  }
}

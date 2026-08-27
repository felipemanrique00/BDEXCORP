import 'server-only'

import type { PoolClient } from 'pg'

import type { RequestPrincipal } from '@/lib/server/request-context'

export interface OperateRepresentationContext {
  id: string
  actorUserId: string
  targetUserId: string
}

export class SupportRepresentationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 403,
  ) {
    super(message)
    this.name = 'SupportRepresentationError'
  }
}

/**
 * Revalidates an operate representation against the authoritative database row.
 * The request principal is deliberately not sufficient for a mutating operation:
 * stopping/expiring the context must make the next write fail closed.
 */
export async function requireActiveOperateRepresentation(
  client: PoolClient,
  principal: RequestPrincipal,
  input: { action: 'demand.create' | 'quote.select' | 'approval.decide'; companyId: string; targetUserId: string },
): Promise<OperateRepresentationContext> {
  const representation = principal.representation
  const actorUserId = principal.actor?.user.id
  const actorSessionId = principal.actor?.sessionId || principal.sessionId
  if (!representation || !actorUserId || representation.mode !== 'operate') {
    throw new SupportRepresentationError(
      'SUPPORT_REPRESENTATION_OPERATE_REQUIRED',
      'Esta operacao exige uma personificacao operacional ativa.',
    )
  }
  if (!principal.actor?.user.permissoes?.gerenciar_personificacoes) {
    throw new SupportRepresentationError(
      'SUPPORT_REPRESENTATION_ACTOR_DENIED',
      'O ator real nao possui permissao para executar personificacao operacional.',
    )
  }
  if (representation.subject.id !== input.targetUserId
      || !representation.allowedActions.includes(input.action)
      || !representation.companyIds.includes(input.companyId)
      || Date.parse(representation.expiresAt) <= Date.now()) {
    throw new SupportRepresentationError(
      'SUPPORT_REPRESENTATION_SCOPE_DENIED',
      'A personificacao nao autoriza esta acao para o usuario ou empresa informados.',
    )
  }

  const result = await client.query<{
    id: string
    actor_user_id: string
    target_user_id: string
  }>(
    `select context.id, context.actor_user_id, context.target_user_id
     from support_impersonations context
     join user_sessions actor_session
       on actor_session.id = context.actor_session_id
      and actor_session.tenant_id = context.tenant_id
      and actor_session.status = 'active'
      and actor_session.active_impersonation_id = context.id
     join tenant_memberships actor_membership
       on actor_membership.id = context.actor_membership_id
      and actor_membership.tenant_id = context.tenant_id
      and actor_membership.user_id = context.actor_user_id
      and actor_membership.status = 'active'
     join users actor_user
       on actor_user.id = context.actor_user_id
      and actor_user.status = 'active'
      and actor_user.deleted_at is null
     join roles actor_role
       on actor_role.id = actor_membership.role_id
      and (actor_role.tenant_id = context.tenant_id or actor_role.tenant_id is null)
      and actor_role.role_key = any(array['tenant_admin', 'supervisor', 'agent', 'operator']::text[])
     left join role_permissions actor_permission
       on actor_permission.role_id = actor_role.id
      and actor_permission.permission_key = 'gerenciar_personificacoes'
     join tenant_memberships target_membership
       on target_membership.id = context.target_membership_id
      and target_membership.tenant_id = context.tenant_id
      and target_membership.user_id = context.target_user_id
      and target_membership.status = 'active'
     join users target_user
       on target_user.id = context.target_user_id
      and target_user.status = 'active'
      and target_user.deleted_at is null
     where context.tenant_id = $1 and context.id = $2
       and context.actor_session_id = $3
       and context.actor_user_id = $4
       and context.target_user_id = $5
       and context.mode = 'operate' and context.status = 'active'
       and context.started_at <= now() and context.expires_at > now()
       and $6 = any(context.allowed_actions)
       and $7 = any(context.company_ids)
       and coalesce(
         case
           when actor_membership.custom_permissions ? 'gerenciar_personificacoes'
             then (actor_membership.custom_permissions->>'gerenciar_personificacoes')::boolean
           else actor_permission.allowed
         end,
         false
       )
     for share of context`,
    [
      principal.tenantId,
      representation.id,
      actorSessionId,
      actorUserId,
      input.targetUserId,
      input.action,
      input.companyId,
    ],
  )
  const context = result.rows[0]
  if (!context) {
    throw new SupportRepresentationError(
      'SUPPORT_REPRESENTATION_STALE',
      'A personificacao expirou, foi encerrada ou perdeu o escopo necessario.',
    )
  }
  return { id: context.id, actorUserId: context.actor_user_id, targetUserId: context.target_user_id }
}

export function realActorUserId(principal: RequestPrincipal): string {
  return principal.actor?.user.id || principal.user.id
}

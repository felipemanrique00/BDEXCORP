import type { CorporateAccessSummary, Permissoes, User } from '@/types'

export type ControlledImpersonationAction =
  | 'demand.create'
  | 'demand.correct'
  | 'quote.select'
  | 'approval.decide'

export interface ImpersonationPermissionPrincipal {
  corporateAccess?: CorporateAccessSummary
  user: Pick<User, 'company_id' | 'empresa_ids' | 'permissoes'>
}

interface ActionPermissionPolicy {
  action: ControlledImpersonationAction
  actorPermission: keyof Permissoes
  targetPermission: keyof Permissoes
}

const ACTION_PERMISSION_POLICIES: readonly ActionPermissionPolicy[] = [
  {
    action: 'demand.create',
    actorPermission: 'criar_demandas',
    targetPermission: 'criar_demandas',
  },
  {
    action: 'demand.correct',
    actorPermission: 'criar_demandas',
    targetPermission: 'criar_demandas',
  },
  {
    action: 'quote.select',
    actorPermission: 'operar_cotacoes',
    // A escolha continua sendo um ato do solicitante representado. A rota e o
    // perfil requester a governam por criar_demandas; operar_cotacoes e a
    // capacidade operacional adicional exigida do consultor real.
    targetPermission: 'criar_demandas',
  },
  {
    action: 'approval.decide',
    actorPermission: 'decidir_aprovacoes',
    targetPermission: 'decidir_aprovacoes',
  },
]

export function allowedImpersonationActions(
  actor: ImpersonationPermissionPrincipal,
  target: ImpersonationPermissionPrincipal,
  companyIds: readonly string[],
): ControlledImpersonationAction[] {
  const scope = uniqueIds(companyIds)
  if (!scope.length) return []

  return ACTION_PERMISSION_POLICIES.flatMap((policy) => (
    hasPermissionInEveryCompany(actor, scope, policy.actorPermission)
      && hasPermissionInEveryCompany(target, scope, policy.targetPermission)
      ? [policy.action]
      : []
  ))
}

function hasPermissionInEveryCompany(
  principal: ImpersonationPermissionPrincipal,
  companyIds: readonly string[],
  permission: keyof Permissoes,
): boolean {
  return companyIds.every((companyId) => permissionForCompany(principal, companyId, permission))
}

function permissionForCompany(
  principal: ImpersonationPermissionPrincipal,
  companyId: string,
  permission: keyof Permissoes,
): boolean {
  if (principal.corporateAccess) {
    return principal.corporateAccess.companies
      .find((company) => company.companyId === companyId)
      ?.permissions[permission] === true
  }

  const legacyCompanyIds = new Set([
    principal.user.company_id || '',
    ...(principal.user.empresa_ids || []),
  ].filter(Boolean))
  return legacyCompanyIds.has(companyId) && principal.user.permissoes?.[permission] === true
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

import 'server-only'

import type { RequestPrincipal } from '@/lib/server/request-context'
import type {
  AuthorizationScopeGrant,
  Permissoes,
} from '@/types'

export type AuthorizationAction =
  | 'read'
  | 'list'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'approve'
  | 'publish'
  | 'execute'
  | 'issue'
  | 'cancel'
  | 'settle'
  | 'manage'
  | 'reset'
  | 'use'

export type AuthorizationResource =
  | 'account'
  | 'session'
  | 'navigation'
  | 'corporate_context'
  | 'companies'
  | 'catalogs'
  | 'cost_centers'
  | 'employees'
  | 'requesters'
  | 'demands'
  | 'approvals'
  | 'quotes'
  | 'reservations'
  | 'emissions'
  | 'vouchers'
  | 'finance'
  | 'budgets'
  | 'reports'
  | 'users'
  | 'access_grants'
  | 'policies'
  | 'workflows'
  | 'automations'
  | 'integrations'
  | 'files'
  | 'ai'
  | 'audit'
  | 'intelligence'
  | 'search'
  | 'traveler_portal'
  | 'settings'
  | 'system'
  | 'platform'
  | 'legacy_storage'
  | 'generic'

export interface AuthorizationScope {
  tenantId?: string | null
  groupId?: string | null
  companyId?: string | null
  organizationalUnitId?: string | null
  costCenterId?: string | null
  projectId?: string | null
  ownerUserId?: string | null
}

export interface AuthorizationRequest {
  action: AuthorizationAction
  resource: AuthorizationResource
  scope?: AuthorizationScope
  currentState?: string | null
  allowedStates?: readonly string[]
  requestedFields?: readonly string[]
  requiredPermission?: keyof Permissoes
  requiredAnyPermissions?: readonly (keyof Permissoes)[]
  allowSelf?: boolean
  allowPlatformAdmin?: boolean
  allowEmptyCompanyScope?: boolean
}

export interface AuthorizationDecision {
  allowed: boolean
  code: string
  reason: string
  permission: keyof Permissoes | null
  companyIds: string[]
  matchedGrantIds: string[]
}

type ResourcePolicy = Partial<Record<AuthorizationAction, keyof Permissoes | 'self' | 'authenticated'>>

const RESOURCE_POLICIES: Record<AuthorizationResource, ResourcePolicy> = {
  account: { read: 'self', update: 'self' },
  session: { read: 'self', create: 'self', update: 'self', delete: 'self' },
  navigation: { read: 'authenticated', list: 'authenticated' },
  corporate_context: { read: 'ver_empresas', list: 'ver_empresas', update: 'ver_empresas' },
  companies: {
    read: 'ver_empresas',
    list: 'ver_empresas',
    create: 'cadastrar_empresas',
    update: 'gerenciar_empresas_grupo',
    delete: 'gerenciar_empresas_grupo',
    manage: 'gerenciar_empresas_grupo',
  },
  catalogs: {
    read: 'ver_reservas',
    list: 'ver_reservas',
    create: 'cadastrar_hoteis',
    update: 'cadastrar_hoteis',
    delete: 'cadastrar_hoteis',
    manage: 'cadastrar_hoteis',
  },
  cost_centers: {
    read: 'ver_centros_custo',
    list: 'ver_centros_custo',
    create: 'gerenciar_centros_custo',
    update: 'gerenciar_centros_custo',
    delete: 'gerenciar_centros_custo',
    manage: 'gerenciar_centros_custo',
  },
  employees: {
    read: 'ver_funcionarios',
    list: 'ver_funcionarios',
    create: 'gerenciar_funcionarios',
    update: 'gerenciar_funcionarios',
    delete: 'gerenciar_funcionarios',
  },
  requesters: {
    read: 'ver_solicitantes',
    list: 'ver_solicitantes',
    create: 'gerenciar_solicitantes',
    update: 'gerenciar_solicitantes',
    delete: 'gerenciar_solicitantes',
  },
  demands: {
    read: 'ver_demandas',
    list: 'ver_demandas',
    create: 'criar_demandas',
    update: 'criar_demandas',
    delete: 'excluir_demandas',
    approve: 'aprovar_demandas',
  },
  approvals: {
    read: 'ver_aprovacoes',
    list: 'ver_aprovacoes',
    create: 'criar_demandas',
    update: 'decidir_aprovacoes',
    approve: 'decidir_aprovacoes',
    manage: 'gerenciar_workflows',
    execute: 'executar_workflows',
  },
  quotes: {
    read: 'ver_reservas',
    list: 'ver_reservas',
    create: 'operar_cotacoes',
    update: 'operar_cotacoes',
    execute: 'operar_cotacoes',
  },
  reservations: {
    read: 'ver_reservas',
    list: 'ver_reservas',
    create: 'operar_reservas',
    update: 'operar_reservas',
    cancel: 'operar_cancelamentos',
    issue: 'operar_emissoes',
  },
  emissions: {
    read: 'ver_emissoes',
    list: 'ver_emissoes',
    create: 'operar_emissoes',
    update: 'operar_emissoes',
    issue: 'operar_emissoes',
    cancel: 'operar_cancelamentos',
  },
  vouchers: {
    read: 'ver_vouchers',
    list: 'ver_vouchers',
    create: 'operar_reservas',
    update: 'operar_reservas',
    delete: 'operar_cancelamentos',
  },
  finance: {
    read: 'ver_financeiro',
    list: 'ver_financeiro',
    create: 'editar_financeiro',
    update: 'editar_financeiro',
    delete: 'editar_financeiro',
    settle: 'editar_financeiro',
  },
  budgets: {
    read: 'ver_orcamentos',
    list: 'ver_orcamentos',
    create: 'gerenciar_orcamentos',
    update: 'gerenciar_orcamentos',
    delete: 'gerenciar_orcamentos',
    manage: 'gerenciar_orcamentos',
  },
  reports: {
    read: 'ver_relatorios',
    list: 'ver_relatorios',
    create: 'gerar_relatorios',
    delete: 'gerar_relatorios',
    export: 'exportar_relatorios',
  },
  users: {
    read: 'gerenciar_usuarios',
    list: 'gerenciar_usuarios',
    create: 'gerenciar_usuarios',
    update: 'gerenciar_usuarios',
    delete: 'gerenciar_usuarios',
    manage: 'gerenciar_usuarios',
  },
  access_grants: {
    read: 'gerenciar_vinculos_acesso',
    list: 'gerenciar_vinculos_acesso',
    create: 'gerenciar_vinculos_acesso',
    update: 'gerenciar_vinculos_acesso',
    delete: 'gerenciar_vinculos_acesso',
    manage: 'gerenciar_vinculos_acesso',
  },
  policies: {
    read: 'ver_politicas',
    list: 'ver_politicas',
    create: 'gerenciar_politicas',
    update: 'gerenciar_politicas',
    delete: 'gerenciar_politicas',
    execute: 'simular_politicas',
    publish: 'publicar_politicas',
  },
  workflows: {
    read: 'ver_workflows',
    list: 'ver_workflows',
    create: 'gerenciar_workflows',
    update: 'gerenciar_workflows',
    delete: 'gerenciar_workflows',
    execute: 'executar_workflows',
    publish: 'gerenciar_workflows',
  },
  automations: {
    read: 'executar_automacoes',
    list: 'executar_automacoes',
    create: 'gerenciar_automacoes',
    update: 'gerenciar_automacoes',
    delete: 'gerenciar_automacoes',
    execute: 'executar_automacoes',
    publish: 'gerenciar_automacoes',
  },
  integrations: {
    read: 'gerenciar_integracoes',
    list: 'gerenciar_integracoes',
    create: 'gerenciar_integracoes',
    update: 'gerenciar_integracoes',
    delete: 'gerenciar_integracoes',
    execute: 'gerenciar_integracoes',
  },
  files: {
    read: 'ver_arquivos',
    list: 'ver_arquivos',
    create: 'gerenciar_arquivos',
    update: 'gerenciar_arquivos',
    delete: 'gerenciar_arquivos',
  },
  ai: {
    read: 'usar_ia',
    list: 'usar_ia',
    create: 'usar_ia',
    update: 'gerenciar_ia',
    delete: 'usar_ia',
    execute: 'usar_ia',
    use: 'usar_ia',
    manage: 'gerenciar_ia',
  },
  audit: { read: 'ver_auditoria', list: 'ver_auditoria' },
  intelligence: {
    read: 'ver_inteligencia',
    list: 'ver_inteligencia',
    update: 'gerenciar_ia',
    manage: 'gerenciar_ia',
  },
  search: { read: 'usar_busca_global', list: 'usar_busca_global', use: 'usar_busca_global' },
  traveler_portal: {
    read: 'acessar_portal_viajante',
    list: 'acessar_portal_viajante',
    create: 'acessar_portal_viajante',
    update: 'acessar_portal_viajante',
  },
  settings: {
    read: 'alterar_configuracoes',
    create: 'alterar_configuracoes',
    update: 'alterar_configuracoes',
    manage: 'alterar_configuracoes',
  },
  system: {
    read: 'gerenciar_usuarios',
    update: 'gerenciar_usuarios',
    reset: 'gerenciar_usuarios',
    manage: 'gerenciar_usuarios',
  },
  platform: {},
  legacy_storage: {
    read: 'ver_empresas',
    list: 'ver_empresas',
    update: 'ver_empresas',
    delete: 'gerenciar_usuarios',
  },
  generic: {},
}

const COMPANY_SCOPED_RESOURCES = new Set<AuthorizationResource>([
  'cost_centers',
  'employees',
  'requesters',
  'demands',
  'approvals',
  'quotes',
  'reservations',
  'emissions',
  'vouchers',
  'finance',
  'budgets',
  'reports',
  'files',
  'intelligence',
  'traveler_portal',
])

const SENSITIVE_FIELDS: Partial<Record<AuthorizationResource, Record<string, keyof Permissoes>>> = {
  demands: {
    valor_custo: 'ver_financeiro',
    markup_valor: 'ver_financeiro',
    markup_percentual: 'ver_financeiro',
    observacoes_internas: 'ver_financeiro',
    wintour_dados: 'gerenciar_integracoes',
  },
  reservations: {
    provider_payload: 'gerenciar_integracoes',
    provider_credentials: 'gerenciar_integracoes',
    valor_custo: 'ver_financeiro',
    markup_valor: 'ver_financeiro',
  },
  emissions: {
    raw: 'gerenciar_integracoes',
    valor_custo: 'ver_financeiro',
    markup_valor: 'ver_financeiro',
    lucro: 'ver_financeiro',
    margem: 'ver_financeiro',
  },
  reports: {
    valor_custo: 'ver_financeiro',
    markup_valor: 'ver_financeiro',
    lucro: 'ver_financeiro',
    margem: 'ver_financeiro',
  },
  integrations: {
    api_key: 'gerenciar_integracoes',
    token: 'gerenciar_integracoes',
    secret: 'gerenciar_integracoes',
    credentials: 'gerenciar_integracoes',
  },
  users: {
    custom_permissions: 'gerenciar_vinculos_acesso',
    role_key: 'gerenciar_vinculos_acesso',
    platform_admin: 'gerenciar_vinculos_acesso',
  },
}

export class AuthorizationDeniedError extends Error {
  readonly status = 403

  constructor(
    public readonly code: string,
    message: string,
    public readonly decision?: AuthorizationDecision,
  ) {
    super(message)
    this.name = 'AuthorizationDeniedError'
  }
}

export function authorizeOrThrow(
  principal: RequestPrincipal,
  request: AuthorizationRequest,
): AuthorizationDecision {
  const decision = evaluateAuthorization(principal, request)
  if (!decision.allowed) {
    throw new AuthorizationDeniedError(decision.code, decision.reason, decision)
  }
  return decision
}

export function evaluateAuthorization(
  principal: RequestPrincipal | null,
  request: AuthorizationRequest,
): AuthorizationDecision {
  const denied = (
    code: string,
    reason: string,
    permission: keyof Permissoes | null = request.requiredPermission || null,
    companyIds: string[] = [],
    matchedGrantIds: string[] = [],
  ): AuthorizationDecision => ({ allowed: false, code, reason, permission, companyIds, matchedGrantIds })

  if (!principal || principal.user.ativo === false || principal.user.status === 'blocked' || principal.user.status === 'inactive') {
    return denied('AUTHORIZATION_ACTOR_INACTIVE', 'Usuario ausente ou inativo.')
  }

  const scope = request.scope || {}
  if (scope.tenantId && scope.tenantId !== principal.tenantId) {
    return denied('AUTHORIZATION_TENANT_DENIED', 'O recurso pertence a outro tenant.')
  }

  if (request.allowedStates?.length && (!request.currentState || !request.allowedStates.includes(request.currentState))) {
    return denied('AUTHORIZATION_STATE_DENIED', 'O estado atual nao permite esta operacao.')
  }

  if (scope.ownerUserId && scope.ownerUserId !== principal.user.id && request.allowSelf) {
    return denied('AUTHORIZATION_OWNER_DENIED', 'O recurso pertence a outro usuario.')
  }

  if (request.resource === 'generic') {
    return denied('AUTHORIZATION_POLICY_MISSING', 'A rota nao possui uma politica de autorizacao explicita.')
  }

  const requiredAnyPermissions = request.requiredPermission
    ? []
    : [...new Set(request.requiredAnyPermissions || [])]
  if (requiredAnyPermissions.length) {
    const decisions = requiredAnyPermissions.map((permission) => evaluateAuthorization(principal, {
      ...request,
      requiredPermission: permission,
      requiredAnyPermissions: undefined,
    }))
    const allowed = decisions.find((decision) => decision.allowed)
    if (allowed) return allowed
    return denied(
      'AUTHORIZATION_ANY_PERMISSION_DENIED',
      'Nenhuma das permissoes alternativas autoriza esta operacao.',
      null,
      [...new Set(decisions.flatMap((decision) => decision.companyIds))],
      [...new Set(decisions.flatMap((decision) => decision.matchedGrantIds))],
    )
  }

  const policy = RESOURCE_POLICIES[request.resource]
  const policyPermission = request.requiredPermission || policy?.[request.action] || null
  if (!policyPermission) {
    if (request.resource === 'platform' && request.allowPlatformAdmin && principal.platformAdmin) {
      return allowedDecision(null, [], [])
    }
    return denied('AUTHORIZATION_POLICY_MISSING', 'Nenhuma politica permite esta acao sobre o recurso.')
  }

  if (policyPermission === 'self') {
    const ownerMatches = !scope.ownerUserId || scope.ownerUserId === principal.user.id
    return ownerMatches
      ? allowedDecision(null, [], [])
      : denied('AUTHORIZATION_OWNER_DENIED', 'A operacao de autoatendimento pertence a outro usuario.')
  }

  if (policyPermission === 'authenticated') {
    return allowedDecision(null, accessibleCompanyIds(principal), [])
  }

  const permission = policyPermission
  const companyResolution = resolveCompanyScope(principal, scope, permission)
  if (!companyResolution.allowed) {
    return denied(companyResolution.code, companyResolution.reason, permission)
  }
  if (
    COMPANY_SCOPED_RESOURCES.has(request.resource)
    && companyResolution.companyIds.length === 0
    && !request.allowEmptyCompanyScope
  ) {
    return denied(
      'AUTHORIZATION_COMPANY_SCOPE_REQUIRED',
      'A operacao exige ao menos uma empresa autorizada.',
      permission,
    )
  }

  const grants = principal.authorizationGrants || []
  const grantCandidates = grants.filter((grant) => (
    grant.permission === permission
    && (grant.resource === '*' || grant.resource === request.resource)
    && (grant.actions.includes('*') || grant.actions.includes(request.action))
  ))
  const matchingGrants = grantCandidates.filter((grant) => scopeGrantMatches(grant, principal, scope))
  const matchedGrantIds = matchingGrants.map((grant) => grant.id)

  const matchingDeny = matchingGrants.find((grant) => grant.effect === 'deny' && grantConditionsMatch(grant, request))
  if (matchingDeny) {
    return denied(
      'AUTHORIZATION_EXPLICIT_DENY',
      'Um limite de acesso explicito impede esta operacao.',
      permission,
      companyResolution.companyIds,
      [matchingDeny.id],
    )
  }

  const boundaries = grantCandidates.filter((grant) => grant.isBoundary)
  if (boundaries.length) {
    const boundaryAllow = matchingGrants.find((grant) => (
      grant.isBoundary && grant.effect === 'allow' && grantConditionsMatch(grant, request)
    ))
    if (!boundaryAllow) {
      return denied(
        'AUTHORIZATION_SCOPE_BOUNDARY_DENIED',
        'O recurso esta fora do limite organizacional concedido.',
        permission,
        companyResolution.companyIds,
        matchedGrantIds,
      )
    }
  }

  const hasBasePermission = companyResolution.hasPermission || Boolean(principal.user.permissoes?.[permission])
  const explicitAllow = matchingGrants.some((grant) => grant.effect === 'allow' && grantConditionsMatch(grant, request))
  if (!hasBasePermission && !explicitAllow) {
    return denied(
      'AUTHORIZATION_PERMISSION_DENIED',
      'Permissao funcional insuficiente.',
      permission,
      companyResolution.companyIds,
      matchedGrantIds,
    )
  }

  const deniedSensitiveField = deniedField(principal, request)
  if (deniedSensitiveField) {
    return denied(
      'AUTHORIZATION_FIELD_DENIED',
      `O campo ${deniedSensitiveField} exige permissao adicional.`,
      permission,
      companyResolution.companyIds,
      matchedGrantIds,
    )
  }

  const fieldRestrictedAllows = matchingGrants.filter((grant) => (
    grant.effect === 'allow' && grant.fieldNames.length > 0 && grantConditionsMatch(grant, request)
  ))
  if (fieldRestrictedAllows.length && request.requestedFields?.length) {
    const allowedFields = new Set(fieldRestrictedAllows.flatMap((grant) => grant.fieldNames.map(normalizeField)))
    if (request.requestedFields.some((field) => !allowedFields.has(normalizeField(field)))) {
      return denied(
        'AUTHORIZATION_FIELD_BOUNDARY_DENIED',
        'A operacao solicita campos fora do limite concedido.',
        permission,
        companyResolution.companyIds,
        matchedGrantIds,
      )
    }
  }

  return allowedDecision(permission, companyResolution.companyIds, matchedGrantIds)
}

export async function authorizationForApiRequest(
  request: Request,
  explicitPermission?: keyof Permissoes,
  explicitAnyPermissions?: readonly (keyof Permissoes)[],
): Promise<AuthorizationRequest> {
  const url = new URL(request.url)
  const payload = await readAuthorizationPayload(request)
  const sources = authorizationSources(payload)
  const resource = inferApiResource(url.pathname)
  const action = inferApiAction(request.method, url.pathname, payload)
  const companyId = firstQueryValue(url, ['companyId', 'company_id', 'empresa', 'empresaId', 'empresa_id'])
    || firstObjectValue(sources, ['companyId', 'company_id', 'empresaId', 'empresa_id'])
  const groupId = firstQueryValue(url, ['groupId', 'group_id', 'grupo', 'grupoId', 'grupo_id'])
    || firstObjectValue(sources, ['groupId', 'group_id', 'grupoId', 'grupo_id', 'businessGroupId', 'business_group_id'])
  return {
    action,
    resource,
    requiredPermission: explicitPermission,
    requiredAnyPermissions: explicitAnyPermissions,
    scope: {
      tenantId: firstObjectValue(sources, ['tenantId', 'tenant_id']),
      companyId,
      groupId,
      organizationalUnitId: firstObjectValue(sources, [
        'organizationalUnitId',
        'organizational_unit_id',
        'orgUnitId',
        'org_unit_id',
      ]),
      costCenterId: firstObjectValue(sources, [
        'costCenterId',
        'cost_center_id',
        'centroCustoId',
        'centro_custo_id',
      ]),
      projectId: firstObjectValue(sources, ['projectId', 'project_id', 'projetoId', 'projeto_id']),
      ownerUserId: firstObjectValue(sources, ['ownerUserId', 'owner_user_id', 'userId', 'user_id']),
    },
    requestedFields: payload ? Object.keys(payload) : undefined,
    allowSelf: resource === 'account' || resource === 'session',
    allowPlatformAdmin: resource === 'platform',
  }
}

function inferApiResource(pathname: string): AuthorizationResource {
  const path = pathname.toLowerCase()
  if (path.startsWith('/api/platform/')) return 'platform'
  if (path.startsWith('/api/auth/change-password')) return 'account'
  if (path.startsWith('/api/auth/mfa')) return 'account'
  if (path.startsWith('/api/auth/impersonation')) return 'session'
  if (path.startsWith('/api/auth/logout')) return 'session'
  if (path.startsWith('/api/me/corporate-contexts')) return 'corporate_context'
  if (path.startsWith('/api/me/requester-profile')) return 'requesters'
  if (path.startsWith('/api/me/effective-branding') || path.startsWith('/api/me/branding-logo')) return 'navigation'
  if (path.startsWith('/api/navigation-summary')) return 'navigation'
  if (path.startsWith('/api/company-portal/offline-travel/reservations') && path.includes('/issue')) return 'emissions'
  if (path.startsWith('/api/company-portal/hotel-media')) return 'catalogs'
  if (path.startsWith('/api/company-portal/hotel-tariff-search')) return 'catalogs'
  if (path.startsWith('/api/company-portal/travel-orders')) return 'demands'
  if (path.startsWith('/api/company-portal/demands')) return 'demands'
  if (path.startsWith('/api/company-portal/approvals')) return 'approvals'
  if (path.startsWith('/api/company-portal/vouchers')) return 'vouchers'
  if (path.startsWith('/api/companies/') && path.endsWith('/approvers')) return 'access_grants'
  if (path.startsWith('/api/users/directory')) return 'approvals'
  if (path.startsWith('/api/users/') && path.includes('/access')) return 'access_grants'
  if (path.startsWith('/api/users')) return 'users'
  if (
    path.startsWith('/api/commercial-suppliers')
    || path.startsWith('/api/hotel-catalog')
    || path.startsWith('/api/geography')
  ) return 'catalogs'
  if (path.startsWith('/api/cost-centers') || path.startsWith('/api/cost-center-plans')) return 'cost_centers'
  if (path.startsWith('/api/demands') || path.startsWith('/api/operations/communications')) return 'demands'
  if (path.startsWith('/api/employees')) return 'employees'
  if (path.startsWith('/api/solicitantes')) return 'requesters'
  if (path.startsWith('/api/approvals/workflows')) return 'workflows'
  if (path.startsWith('/api/approvals')) return 'approvals'
  if (path.startsWith('/api/offline-travel/ground')) return 'quotes'
  if (path.startsWith('/api/offline-travel/air/quotes')) return 'quotes'
  if (path.startsWith('/api/offline-travel/hotel-rate-suggestions')) return 'quotes'
  if (path.startsWith('/api/offline-travel/quotes')) return 'quotes'
  if (path.startsWith('/api/offline-travel/reservations') && path.includes('/issue')) return 'emissions'
  if (path.startsWith('/api/offline-travel/reservations')) return 'reservations'
  if (path.startsWith('/api/travel/quotes')) return 'quotes'
  if (path.startsWith('/api/travel/reservations')) return 'reservations'
  if (path.startsWith('/api/travel/refunds')) return 'finance'
  if (path.startsWith('/api/travel/operations')) return 'integrations'
  if (path.startsWith('/api/emissions')) return 'emissions'
  if (path.startsWith('/api/voucher-presentation-settings')) return 'settings'
  if (path.startsWith('/api/brand-identity-settings')) return 'settings'
  if (path.startsWith('/api/vouchers')) return 'vouchers'
  if (path.startsWith('/api/finance') || path.startsWith('/api/reconciliation')) return 'finance'
  if (path.startsWith('/api/report-snapshots')) return 'reports'
  if (path.startsWith('/api/policies')) return 'policies'
  if (path.startsWith('/api/workflows')) return 'workflows'
  if (path.startsWith('/api/automations')) return 'automations'
  if (path.startsWith('/api/integrations') || path.startsWith('/api/travel/tech')) return 'integrations'
  if (path.startsWith('/api/files')) return 'files'
  if (path.startsWith('/api/ia') || path.startsWith('/api/assistant')) return 'ai'
  if (path.startsWith('/api/audit')) return 'audit'
  if (path.startsWith('/api/intelligence')) return 'intelligence'
  if (path.startsWith('/api/search')) return 'search'
  if (path.startsWith('/api/traveler')) return 'traveler_portal'
  if (path.startsWith('/api/system/reset')) return 'system'
  if (path.startsWith('/api/system/data-summary')) return 'system'
  if (path.startsWith('/api/system/domain-rollouts')) return 'system'
  if (path.startsWith('/api/system')) return 'settings'
  if (path.startsWith('/api/storage')) return 'legacy_storage'
  return 'generic'
}

function inferApiAction(
  method: string,
  pathname: string,
  payload: Record<string, unknown> | null,
): AuthorizationAction {
  const path = pathname.toLowerCase()
  const normalizedMethod = method.toUpperCase()
  const routeAction = ROUTE_ACTION_OVERRIDES[`${normalizedMethod} ${path}`]
  if (routeAction) return routeAction
  if (path.includes('/transition') && /publish/i.test(path)) return 'publish'
  const requestedTransition = firstObjectValue(authorizationSources(payload), [
    'transition',
    'action',
    'operation',
    'status',
  ])?.toLowerCase()
  if (requestedTransition && ['publish', 'published', 'activate', 'active'].includes(requestedTransition)) return 'publish'
  if (requestedTransition && ['approve', 'approved'].includes(requestedTransition)) return 'approve'
  if (requestedTransition && ['issue', 'issued', 'emitir', 'emitido'].includes(requestedTransition)) return 'issue'
  if (requestedTransition && ['cancel', 'cancelled', 'canceled', 'cancelar', 'cancelado'].includes(requestedTransition)) return 'cancel'
  if (requestedTransition && ['execute', 'run', 'retry', 'reprocess'].includes(requestedTransition)) return 'execute'
  if (path.includes('/decision')) return 'approve'
  if (path.includes('/issue')) return 'issue'
  if (path.includes('/cancel')) return 'cancel'
  if (path.includes('/settle') || path.includes('/resolve')) return 'settle'
  if (path.includes('/simulate') || path.includes('/test')) return 'execute'
  if (path.includes('/reset')) return 'reset'
  switch (normalizedMethod) {
    case 'GET':
      return 'read'
    case 'POST':
      return 'create'
    case 'PUT':
    case 'PATCH':
      return 'update'
    case 'DELETE':
      return 'delete'
    default:
      return 'read'
  }
}

const ROUTE_ACTION_OVERRIDES: Readonly<Record<string, AuthorizationAction>> = {
  'POST /api/auth/change-password': 'update',
  'POST /api/auth/logout': 'delete',
  'POST /api/auth/mfa/recovery-codes': 'update',
  'POST /api/auth/mfa/step-up': 'update',
}

function resolveCompanyScope(
  principal: RequestPrincipal,
  scope: AuthorizationScope,
  permission: keyof Permissoes,
): { allowed: boolean; hasPermission: boolean; companyIds: string[]; code: string; reason: string } {
  const companies = principal.corporateAccess?.companies || []
  if (scope.companyId) {
    const company = companies.find((item) => item.companyId === scope.companyId)
    if (!company) {
      return {
        allowed: false,
        hasPermission: false,
        companyIds: [],
        code: 'AUTHORIZATION_COMPANY_DENIED',
        reason: 'Empresa fora do escopo autorizado.',
      }
    }
    if (scope.groupId && company.groupId !== scope.groupId) {
      return {
        allowed: false,
        hasPermission: false,
        companyIds: [],
        code: 'AUTHORIZATION_GROUP_COMPANY_MISMATCH',
        reason: 'A empresa nao pertence ao grupo informado.',
      }
    }
    return {
      allowed: true,
      hasPermission: Boolean(company.permissions[permission]),
      companyIds: [company.companyId],
      code: 'AUTHORIZED',
      reason: 'Empresa autorizada.',
    }
  }

  if (scope.groupId) {
    const group = principal.corporateAccess?.groups.find((item) => item.groupId === scope.groupId)
    if (!group) {
      return {
        allowed: false,
        hasPermission: false,
        companyIds: [],
        code: 'AUTHORIZATION_GROUP_DENIED',
        reason: 'Grupo fora do escopo autorizado.',
      }
    }
    const permitted = group.companyIds.filter((companyId) => (
      companies.find((company) => company.companyId === companyId)?.permissions[permission]
    ))
    return {
      allowed: true,
      hasPermission: permitted.length > 0,
      companyIds: permitted,
      code: 'AUTHORIZED',
      reason: 'Grupo autorizado.',
    }
  }

  const permitted = companies.filter((company) => company.permissions[permission]).map((company) => company.companyId)
  return {
    allowed: true,
    hasPermission: permitted.length > 0,
    companyIds: permitted,
    code: 'AUTHORIZED',
    reason: 'Escopo corporativo calculado.',
  }
}

function accessibleCompanyIds(principal: RequestPrincipal): string[] {
  return [...(principal.corporateAccess?.companyIds || principal.user.empresa_ids || [])]
}

function scopeGrantMatches(
  grant: AuthorizationScopeGrant,
  principal: RequestPrincipal,
  scope: AuthorizationScope,
): boolean {
  if (grant.companyId && scope.companyId && grant.companyId !== scope.companyId) return false
  switch (grant.scopeType) {
    case 'tenant':
      return grant.scopeId === principal.tenantId
    case 'group':
      if (scope.groupId) return grant.scopeId === scope.groupId
      if (scope.companyId) {
        return principal.corporateAccess?.companies.some((company) => (
          company.companyId === scope.companyId && company.groupId === grant.scopeId
        )) || false
      }
      return false
    case 'company':
      return grant.scopeId === scope.companyId
    case 'organizational_unit':
      return grant.scopeId === scope.organizationalUnitId
    case 'cost_center':
      return grant.scopeId === scope.costCenterId
    case 'project':
      return grant.scopeId === scope.projectId
    case 'user':
      return grant.scopeId === scope.ownerUserId
    default:
      return false
  }
}

function grantConditionsMatch(grant: AuthorizationScopeGrant, request: AuthorizationRequest): boolean {
  const allowedStates = Array.isArray(grant.conditions.allowedStates)
    ? grant.conditions.allowedStates.filter((value): value is string => typeof value === 'string')
    : []
  if (allowedStates.length && (!request.currentState || !allowedStates.includes(request.currentState))) return false
  return true
}

function deniedField(principal: RequestPrincipal, request: AuthorizationRequest): string | null {
  const fieldPolicies = SENSITIVE_FIELDS[request.resource]
  if (!fieldPolicies || !request.requestedFields?.length) return null
  for (const rawField of request.requestedFields) {
    const field = normalizeField(rawField)
    const required = fieldPolicies[field]
    if (required && !principal.user.permissoes?.[required]) return rawField
  }
  return null
}

function normalizeField(value: string): string {
  return value.trim().toLowerCase()
}

function firstQueryValue(url: URL, keys: string[]): string | null {
  for (const key of keys) {
    const value = url.searchParams.get(key)?.trim()
    if (value) return value
  }
  return null
}

async function readAuthorizationPayload(request: Request): Promise<Record<string, unknown> | null> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return null
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return null

  try {
    const value: unknown = await request.clone().json()
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function authorizationSources(payload: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!payload) return []
  const nestedKeys = ['data', 'input', 'scope', 'context']
  return [
    payload,
    ...nestedKeys
      .map((key) => payload[key])
      .filter(isRecord),
  ]
}

function firstObjectValue(sources: Record<string, unknown>[], keys: string[]): string | null {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function allowedDecision(
  permission: keyof Permissoes | null,
  companyIds: string[],
  matchedGrantIds: string[],
): AuthorizationDecision {
  return {
    allowed: true,
    code: 'AUTHORIZED',
    reason: 'Operacao autorizada.',
    permission,
    companyIds,
    matchedGrantIds,
  }
}

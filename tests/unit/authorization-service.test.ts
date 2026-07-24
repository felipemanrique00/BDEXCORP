import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  AuthorizationDeniedError,
  authorizeOrThrow,
  authorizationForApiRequest,
  evaluateAuthorization,
} from '@/lib/server/authorization-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { AuthorizationScopeGrant } from '@/types'

describe('fine-grained authorization', () => {
  it('nega por padrao recurso e acao sem politica', () => {
    const decision = evaluateAuthorization(principal(), {
      resource: 'generic',
      action: 'update',
    })

    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_POLICY_MISSING',
    })
  })

  it('nao permite que uma permissao antiga libere recurso sem classificacao', () => {
    const decision = evaluateAuthorization(principal(), {
      resource: 'generic',
      action: 'update',
      requiredPermission: 'ver_demandas',
    })

    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_POLICY_MISSING',
    })
  })

  it('impede acesso a empresa fora do escopo mesmo com permissao global', () => {
    const actor = principal()
    actor.user.permissoes = {
      ...actor.user.permissoes!,
      ver_demandas: true,
    }

    expect(() => authorizeOrThrow(actor, {
      resource: 'demands',
      action: 'read',
      scope: { tenantId: 'tenant-a', companyId: 'company-b' },
    })).toThrowError(expect.objectContaining({
      code: 'AUTHORIZATION_COMPANY_DENIED',
    }))
  })

  it('aplica deny explicito antes do perfil permitido', () => {
    const actor = principal([grant({
      id: 'deny-finance-company-a',
      effect: 'deny',
      permission: 'ver_financeiro',
      resource: 'finance',
      actions: ['read'],
      scopeType: 'company',
      scopeId: 'company-a',
      companyId: 'company-a',
    })])

    const decision = evaluateAuthorization(actor, {
      resource: 'finance',
      action: 'read',
      scope: { companyId: 'company-a' },
    })

    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_EXPLICIT_DENY',
      matchedGrantIds: ['deny-finance-company-a'],
    })
  })

  it('restringe centro de custo quando existe boundary', () => {
    const actor = principal([grant({
      id: 'cost-center-boundary',
      permission: 'ver_demandas',
      resource: 'demands',
      actions: ['read'],
      scopeType: 'cost_center',
      scopeId: 'cost-center-a',
      companyId: 'company-a',
      isBoundary: true,
    })])

    expect(evaluateAuthorization(actor, {
      resource: 'demands',
      action: 'read',
      scope: { companyId: 'company-a', costCenterId: 'cost-center-b' },
    }).code).toBe('AUTHORIZATION_SCOPE_BOUNDARY_DENIED')

    expect(evaluateAuthorization(actor, {
      resource: 'demands',
      action: 'read',
      scope: { companyId: 'company-a', costCenterId: 'cost-center-a' },
    }).allowed).toBe(true)
  })

  it('protege campos financeiros em recursos operacionais', () => {
    const actor = principal()
    actor.user.permissoes = {
      ...actor.user.permissoes!,
      ver_financeiro: false,
    }

    expect(() => authorizeOrThrow(actor, {
      resource: 'reports',
      action: 'read',
      scope: { companyId: 'company-a' },
      requestedFields: ['valor_final', 'markup_valor'],
    })).toThrowError(AuthorizationDeniedError)
  })

  it('nao aceita tenant informado pelo cliente quando diverge da sessao', () => {
    expect(evaluateAuthorization(principal(), {
      resource: 'demands',
      action: 'read',
      scope: { tenantId: 'tenant-b', companyId: 'company-a' },
    }).code).toBe('AUTHORIZATION_TENANT_DENIED')
  })

  it('nega dominio empresarial quando nao existe empresa acessivel', () => {
    const actor = principal()
    actor.corporateAccess = {
      ...actor.corporateAccess!,
      companyIds: [],
      groupIds: [],
      companies: [],
      groups: [],
    }
    actor.user.permissoes = {
      ...actor.user.permissoes!,
      ver_demandas: true,
    }

    expect(evaluateAuthorization(actor, {
      resource: 'demands',
      action: 'read',
    }).code).toBe('AUTHORIZATION_COMPANY_SCOPE_REQUIRED')
  })

  it('permite somente consultas explicitamente preparadas para escopo empresarial vazio', () => {
    const actor = principal()
    actor.corporateAccess = {
      ...actor.corporateAccess!,
      companyIds: [],
      groupIds: [],
      companies: [],
      groups: [],
    }
    actor.user.permissoes = {
      ...actor.user.permissoes!,
      ver_demandas: true,
    }

    expect(evaluateAuthorization(actor, {
      resource: 'demands',
      action: 'list',
      requiredPermission: 'ver_demandas',
      allowEmptyCompanyScope: true,
    })).toMatchObject({
      allowed: true,
      companyIds: [],
    })
  })

  it('extrai escopo e campos do corpo JSON sem consumir a requisicao original', async () => {
    const request = new Request('http://localhost/api/demands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'tenant-a',
        companyId: 'company-a',
        costCenterId: 'cost-center-a',
        markup_valor: 125,
      }),
    })

    await expect(authorizationForApiRequest(request)).resolves.toMatchObject({
      resource: 'demands',
      action: 'create',
      scope: {
        tenantId: 'tenant-a',
        companyId: 'company-a',
        costCenterId: 'cost-center-a',
      },
      requestedFields: expect.arrayContaining(['companyId', 'markup_valor']),
    })
    await expect(request.json()).resolves.toMatchObject({ companyId: 'company-a' })
  })

  it('classifica o diretorio de usuarios como apoio de aprovacoes', async () => {
    await expect(authorizationForApiRequest(
      new Request('http://localhost/api/users/directory'),
    )).resolves.toMatchObject({
      resource: 'approvals',
      action: 'read',
    })
  })
})

function principal(grants: AuthorizationScopeGrant[] = []): RequestPrincipal {
  const permissions = {
    ...permissionsForCorporateProfile('group_finance', {}),
    ver_demandas: true,
    ver_relatorios: true,
  }
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'financial_manager',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    authorizationGrants: grants,
    corporateAccess: {
      tenantWide: false,
      companyIds: ['company-a'],
      groupIds: ['group-a'],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_selected'],
        profiles: ['group_finance'],
        permissions,
      }],
      groups: [{
        groupId: 'group-a',
        groupName: 'Grupo A',
        companyIds: ['company-a'],
        canViewConsolidated: true,
        accessModes: ['selected_companies'],
        profiles: ['group_finance'],
      }],
      contexts: [],
      defaultContext: { type: 'company', id: 'company-a' },
      refreshedAt: new Date().toISOString(),
    },
    user: {
      id: 'user-a',
      email: 'finance@example.test',
      name: 'Financeiro',
      role: 'company_admin',
      company_id: 'company-a',
      ativo: true,
      permissoes: permissions,
    },
  }
}

function grant(overrides: Partial<AuthorizationScopeGrant>): AuthorizationScopeGrant {
  return {
    id: 'grant-a',
    effect: 'allow',
    permission: 'ver_demandas',
    resource: 'demands',
    actions: ['read'],
    scopeType: 'company',
    scopeId: 'company-a',
    companyId: 'company-a',
    fieldNames: [],
    isBoundary: false,
    conditions: {},
    ...overrides,
  }
}

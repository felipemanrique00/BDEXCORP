import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  getSessionPrincipalFromRequest: vi.fn(),
  writeAuditEvent: vi.fn(),
  enterRequestContext: vi.fn(),
  runWithRequestContext: vi.fn((_context, operation: () => unknown) => operation()),
}))

vi.mock('@/lib/server-auth', () => ({
  getSessionPrincipalFromRequest: mocks.getSessionPrincipalFromRequest,
}))
vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))
vi.mock('@/lib/server/auth-service', () => ({
  getClientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/server/environment', () => ({
  getServerEnvironment: () => ({ APP_URL: 'http://localhost' }),
}))
vi.mock('@/lib/server/logger', () => ({
  logError: vi.fn(),
}))
vi.mock('@/lib/server/rate-limit', () => ({
  consumeRateLimit: vi.fn(),
}))
vi.mock('@/lib/server/request-context', () => ({
  enterRequestContext: mocks.enterRequestContext,
  runWithRequestContext: mocks.runWithRequestContext,
}))

import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'

describe('API tenant administration guard', () => {
  beforeEach(() => {
    mocks.getSessionPrincipalFromRequest.mockReset()
    mocks.writeAuditEvent.mockReset()
    mocks.enterRequestContext.mockReset()
    mocks.runWithRequestContext.mockClear()
  })

  it('nega administrador corporativo mesmo quando ele gerencia usuarios de uma empresa', async () => {
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(principal({
      roleKey: 'company_admin',
      platformAdmin: false,
    }))

    const result = await guardApiRequest(new Request('http://localhost/api/admin'), {
      requireAuth: true,
      tenantAdmin: true,
      authorization: { resource: 'navigation', action: 'read' },
    })

    expect(result.response?.status).toBe(403)
    await expect(result.response?.json()).resolves.toMatchObject({ code: 'TENANT_ADMIN_REQUIRED' })
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'access.denied',
      metadata: expect.objectContaining({ reason: 'tenant_admin_required' }),
    }))
  })

  it('autoriza administrador do tenant', async () => {
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(principal({
      roleKey: 'tenant_admin',
      platformAdmin: false,
    }))

    const result = await guardApiRequest(new Request('http://localhost/api/admin'), {
      requireAuth: true,
      tenantAdmin: true,
      authorization: { resource: 'navigation', action: 'read' },
    })

    expect(result.response).toBeUndefined()
    expect(mocks.enterRequestContext).toHaveBeenCalledOnce()
  })

  it('autoriza administrador da plataforma sem promover outros papeis', async () => {
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(principal({
      roleKey: 'company_admin',
      platformAdmin: true,
    }))

    const result = await guardApiRequest(new Request('http://localhost/api/admin'), {
      requireAuth: true,
      tenantAdmin: true,
      authorization: { resource: 'navigation', action: 'read' },
    })

    expect(result.response).toBeUndefined()
  })

  it('executa operacoes dependentes de contexto dentro do escopo autenticado', async () => {
    const actor = principal({
      roleKey: 'tenant_admin',
      platformAdmin: false,
    })
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(actor)
    const result = await guardApiRequest(new Request('http://localhost/api/navigation-summary'), {
      requireAuth: true,
      authorization: { resource: 'navigation', action: 'read' },
    })

    const value = runInApiGuardContext(result, () => 'ok')

    expect(value).toBe('ok')
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { requestId: result.requestId, principal: actor },
      expect.any(Function),
    )
  })

  it('nao aceita o papel visual legado master no lugar do papel interno da membership', async () => {
    const corporatePrincipal = principal({ roleKey: 'company_admin', platformAdmin: false })
    corporatePrincipal.user.role = 'master'
    corporatePrincipal.user.permissoes = {
      ...corporatePrincipal.user.permissoes!,
      operar_emissoes: true,
    }
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(corporatePrincipal)

    const result = await guardApiRequest(new Request('http://localhost/api/travel/reservations/123/issue'), {
      requireAuth: true,
      permission: 'operar_emissoes',
      roleKeys: ['tenant_admin', 'agent', 'supervisor', 'operator'],
    })

    expect(result.response?.status).toBe(403)
    await expect(result.response?.json()).resolves.toMatchObject({ code: 'MEMBERSHIP_ROLE_DENIED' })
  })

  it.each([
    '/api/auth/change-password',
    '/api/auth/mfa/recovery-codes',
  ])('autoriza autoatendimento autenticado em %s', async (path) => {
    const actor = principal({
      roleKey: 'company_viewer',
      platformAdmin: false,
    })
    actor.user.must_change_password = true
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(actor)

    const result = await guardApiRequest(new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: '{}',
    }))

    expect(result.response).toBeUndefined()
    expect(result.user?.id).toBe(actor.user.id)
  })
})

function principal(overrides: Pick<RequestPrincipal, 'roleKey' | 'platformAdmin'>): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: 'user-a',
      email: 'admin@tenant.invalid',
      name: 'Administrador corporativo',
      role: 'company_admin',
      company_id: 'company-a',
      ativo: true,
      permissoes: { gerenciar_usuarios: true } as RequestPrincipal['user']['permissoes'],
    },
    ...overrides,
  }
}

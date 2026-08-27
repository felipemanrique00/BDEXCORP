import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  getSessionPrincipalFromRequest: vi.fn(),
  writeAuditEvent: vi.fn(),
  enterRequestContext: vi.fn(),
  consumeRateLimit: vi.fn(),
  listMappings: vi.fn(),
  upsertMapping: vi.fn(),
  deleteMapping: vi.fn(),
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
  consumeRateLimit: mocks.consumeRateLimit,
}))
vi.mock('@/lib/server/request-context', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/request-context')>()
  return {
    ...original,
    enterRequestContext: mocks.enterRequestContext,
  }
})
vi.mock('@/lib/server/wintour-emissor-mapping-service', () => ({
  deleteWintourEmissorMapping: mocks.deleteMapping,
  listWintourEmissorMappings: mocks.listMappings,
  upsertWintourEmissorMapping: mocks.upsertMapping,
}))

import {
  DELETE,
  GET,
  PUT,
} from '@/app/api/integrations/wintour/emissor-mappings/route'

const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222'
const mapping = {
  id: '33333333-3333-4333-8333-333333333333',
  codigo: 'EMISSOR-01',
  user_id: TARGET_USER_ID,
  user_name: 'Agente BBT',
  updated_at: '2026-07-23T12:00:00.000Z',
}

describe('Wintour emissor mapping route authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 20,
      retryAfterSeconds: 0,
    })
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(principal({
      roleKey: 'tenant_admin',
      platformAdmin: false,
    }))
    mocks.listMappings.mockResolvedValue([mapping])
    mocks.upsertMapping.mockResolvedValue(mapping)
    mocks.deleteMapping.mockResolvedValue(true)
  })

  it('allows a tenant administrator to list, upsert, and delete tenant-global mappings', async () => {
    const getResponse = await GET(request('GET'))
    const putResponse = await PUT(request('PUT', { codigo: 'EMISSOR-01', userId: TARGET_USER_ID }))
    const deleteResponse = await DELETE(request('DELETE', { codigo: 'EMISSOR-01' }))

    expect([getResponse.status, putResponse.status, deleteResponse.status]).toEqual([200, 200, 200])
    expect(mocks.listMappings).toHaveBeenCalledOnce()
    expect(mocks.upsertMapping).toHaveBeenCalledOnce()
    expect(mocks.deleteMapping).toHaveBeenCalledOnce()
  })

  it('allows a platform administrator through the canonical tenant-administration guard', async () => {
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(principal({
      roleKey: 'company_admin',
      platformAdmin: true,
    }))

    const response = await GET(request('GET'))

    expect(response.status).toBe(200)
    expect(mocks.listMappings).toHaveBeenCalledOnce()
  })

  it.each([
    ['GET', GET],
    ['PUT', PUT],
    ['DELETE', DELETE],
  ] as const)('denies a company administrator with broad company permissions on %s', async (method, handler) => {
    mocks.getSessionPrincipalFromRequest.mockResolvedValue(principal({
      roleKey: 'company_admin',
      platformAdmin: false,
    }))

    const body = method === 'PUT'
      ? { codigo: 'EMISSOR-01', userId: TARGET_USER_ID }
      : method === 'DELETE'
        ? { codigo: 'EMISSOR-01' }
        : undefined
    const response = await handler(request(method, body))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'TENANT_ADMIN_REQUIRED' })
    expect(mocks.listMappings).not.toHaveBeenCalled()
    expect(mocks.upsertMapping).not.toHaveBeenCalled()
    expect(mocks.deleteMapping).not.toHaveBeenCalled()
  })

  it.each([
    ['PUT', PUT, { codigo: 'EMISSOR-01', userId: TARGET_USER_ID }],
    ['DELETE', DELETE, { codigo: 'EMISSOR-01' }],
  ] as const)('rejects a cross-origin %s before invoking the mapping service', async (method, handler, body) => {
    const response = await handler(request(method, body, 'https://attacker.invalid'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_ORIGIN' })
    expect(mocks.upsertMapping).not.toHaveBeenCalled()
    expect(mocks.deleteMapping).not.toHaveBeenCalled()
  })
})

function request(
  method: string,
  body?: Record<string, unknown>,
  origin = 'http://localhost',
): Request {
  return new Request('http://localhost/api/integrations/wintour/emissor-mappings', {
    method,
    headers: body
      ? { 'Content-Type': 'application/json', Origin: origin }
      : { Origin: origin },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function principal(overrides: Pick<RequestPrincipal, 'roleKey' | 'platformAdmin'>): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: overrides.roleKey,
    platformAdmin: overrides.platformAdmin,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'usuario@tenant.invalid',
      name: 'Usuario',
      role: 'company_admin',
      company_id: '55555555-5555-4555-8555-555555555555',
      ativo: true,
      permissoes: {
        gerenciar_integracoes: true,
        gerenciar_usuarios: true,
        importar_planilhas: true,
      } as RequestPrincipal['user']['permissoes'],
    },
  }
}

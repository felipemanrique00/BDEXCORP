import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => {
  class CorporateAccessDeniedError extends Error {}
  class RequesterServiceError extends Error {
    status = 400
    code = 'REQUESTER_ERROR'
  }
  class UserConflictError extends Error {}
  class UserInvitationUnavailableError extends Error {}
  return {
    CorporateAccessDeniedError,
    RequesterServiceError,
    UserConflictError,
    UserInvitationUnavailableError,
    createTenantUser: vi.fn(),
    getTenantUser: vi.fn(),
    guardApiRequest: vi.fn(),
    hasServerPermission: vi.fn(),
    listCompanyRequesters: vi.fn(),
    mergeUserCorporateAccess: vi.fn(),
    resendTenantUserInvite: vi.fn(),
    setTenantUserActive: vi.fn(),
    upsertCompanyRequester: vi.fn(),
    validateRequesterMutation: vi.fn(),
  }
})

vi.mock('@/lib/security/api-guard', () => ({
  guardApiRequest: mocks.guardApiRequest,
  hasServerPermission: mocks.hasServerPermission,
}))
vi.mock('@/lib/server/corporate-access-admin-service', () => ({
  mergeUserCorporateAccess: mocks.mergeUserCorporateAccess,
}))
vi.mock('@/lib/server/corporate-access-service', () => ({
  CorporateAccessDeniedError: mocks.CorporateAccessDeniedError,
}))
vi.mock('@/lib/server/requester-service', () => ({
  listCompanyRequesters: mocks.listCompanyRequesters,
  RequesterServiceError: mocks.RequesterServiceError,
  upsertCompanyRequester: mocks.upsertCompanyRequester,
  validateRequesterMutation: mocks.validateRequesterMutation,
}))
vi.mock('@/lib/server/user-service', () => ({
  createTenantUser: mocks.createTenantUser,
  getTenantUser: mocks.getTenantUser,
  resendTenantUserInvite: mocks.resendTenantUserInvite,
  setTenantUserActive: mocks.setTenantUserActive,
  UserConflictError: mocks.UserConflictError,
  UserInvitationUnavailableError: mocks.UserInvitationUnavailableError,
}))

import { POST } from '@/app/api/solicitantes/empresa/route'

describe('requester invitation fallback', () => {
  const principal = {
    tenantId: '00000000-0000-4000-8000-000000000001',
    user: {
      id: 'admin-user',
      permissoes: {
        gerenciar_solicitantes: true,
        gerenciar_usuarios: true,
      },
    },
  } as RequestPrincipal

  const requester = {
    id: 'requester-1',
    company_id: 'company-1',
    user_id: null,
    funcionario_id: null,
    nome: 'Pessoa Solicitante',
    email: 'pessoa@example.com',
    telefone: '',
    cargo: '',
    departamento: '',
    centro_custo: '',
    status: 'ativo' as const,
    pode_criar_demanda: true,
    pode_ver_vouchers: true,
    pode_ver_financeiro: false,
    limite_por_solicitacao: 0,
    created_at: '2026-07-24T00:00:00.000Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardApiRequest.mockResolvedValue({
      principal,
      user: principal.user,
      requestId: 'request-requester',
      response: null,
    })
    mocks.hasServerPermission.mockReturnValue(true)
    mocks.validateRequesterMutation.mockResolvedValue({
      payload: {
        ...requester,
        id: undefined,
        created_at: undefined,
      },
      editingId: requester.id,
      existingUserId: null,
    })
    mocks.getTenantUser.mockResolvedValue(null)
    mocks.resendTenantUserInvite.mockResolvedValue(undefined)
    mocks.setTenantUserActive.mockImplementation(async (_principal, _userId, active) => ({
      id: 'existing-user',
      status: active ? 'active' : 'inactive',
      ativo: active,
    }))
    mocks.createTenantUser.mockRejectedValue(
      new mocks.UserInvitationUnavailableError('SMTP deve estar configurado para enviar convites.'),
    )
    mocks.upsertCompanyRequester.mockResolvedValue({
      requester,
      requesters: [requester],
      created: false,
    })
  })

  it('saves the requester and returns a warning when SMTP is unavailable', async () => {
    const response = await POST(new Request('http://localhost/api/solicitantes/empresa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: requester.id,
        criarAcesso: true,
        solicitante: {
          company_id: requester.company_id,
          user_id: null,
          funcionario_id: null,
          nome: requester.nome,
          email: requester.email,
          telefone: '',
          cargo: '',
          departamento: '',
          centro_custo: '',
          status: 'ativo',
          pode_criar_demanda: true,
          pode_ver_vouchers: true,
          pode_ver_financeiro: false,
          limite_por_solicitacao: 0,
        },
      }),
    }))

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      warning: {
        code: 'REQUESTER_SAVED_INVITATION_PENDING',
      },
    })
    expect(mocks.upsertCompanyRequester).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        user_id: null,
        email: requester.email,
      }),
      requester.id,
    )
  })

  it('resends an invitation when an existing requester account is still invited', async () => {
    mocks.createTenantUser.mockResolvedValue({
      user: {
        id: 'existing-user',
        status: 'invited',
        ativo: false,
      },
      existing: true,
      invited: true,
    })
    mocks.upsertCompanyRequester.mockResolvedValue({
      requester: { ...requester, user_id: 'existing-user' },
      requesters: [{ ...requester, user_id: 'existing-user' }],
      created: false,
    })

    const response = await POST(requesterMutationRequest({
      criarAcesso: true,
      userId: null,
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.resendTenantUserInvite).toHaveBeenCalledWith(principal, 'existing-user')
    expect(body.access).toEqual({
      state: 'invited',
      invitationSent: true,
      existing: true,
    })
  })

  it('reactivates an inactive existing requester account instead of reporting a new invitation', async () => {
    mocks.createTenantUser.mockResolvedValue({
      user: {
        id: 'existing-user',
        status: 'inactive',
        ativo: false,
      },
      existing: true,
      invited: false,
    })
    mocks.upsertCompanyRequester.mockResolvedValue({
      requester: { ...requester, user_id: 'existing-user' },
      requesters: [{ ...requester, user_id: 'existing-user' }],
      created: false,
    })

    const response = await POST(requesterMutationRequest({
      criarAcesso: true,
      userId: null,
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.setTenantUserActive).toHaveBeenCalledWith(principal, 'existing-user', true)
    expect(body.access).toEqual({
      state: 'active',
      invitationSent: false,
      existing: true,
    })
  })

  it('preserves an existing login link when the actor cannot manage users', async () => {
    mocks.hasServerPermission.mockReturnValue(false)
    mocks.validateRequesterMutation.mockResolvedValue({
      payload: {
        ...requester,
        id: undefined,
        created_at: undefined,
        user_id: '33333333-3333-4333-8333-333333333333',
      },
      editingId: requester.id,
      existingUserId: '33333333-3333-4333-8333-333333333333',
    })

    const response = await POST(requesterMutationRequest({
      criarAcesso: false,
      userId: '33333333-3333-4333-8333-333333333333',
    }))

    expect(response.status).toBe(200)
    expect(mocks.upsertCompanyRequester).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        user_id: '33333333-3333-4333-8333-333333333333',
      }),
      requester.id,
    )
  })

  it('rejects changing a requester login link without user-management permission', async () => {
    mocks.hasServerPermission.mockReturnValue(false)
    mocks.validateRequesterMutation.mockResolvedValue({
      payload: {
        ...requester,
        id: undefined,
        created_at: undefined,
        user_id: '44444444-4444-4444-8444-444444444444',
      },
      editingId: requester.id,
      existingUserId: '33333333-3333-4333-8333-333333333333',
    })

    const response = await POST(requesterMutationRequest({
      criarAcesso: false,
      userId: '44444444-4444-4444-8444-444444444444',
    }))

    expect(response.status).toBe(403)
    expect(mocks.upsertCompanyRequester).not.toHaveBeenCalled()
  })

  it('does not combine user and access-link permissions across companies', async () => {
    mocks.hasServerPermission.mockReturnValue(true)
    mocks.guardApiRequest.mockResolvedValue({
      principal: {
        ...principal,
        corporateAccess: {
          tenantWide: false,
          companyIds: ['company-1', 'company-2'],
          groupIds: [],
          companies: [
            {
              companyId: 'company-1',
              permissions: {
                gerenciar_usuarios: true,
                gerenciar_vinculos_acesso: false,
              },
            },
            {
              companyId: 'company-2',
              permissions: {
                gerenciar_usuarios: true,
                gerenciar_vinculos_acesso: true,
              },
            },
          ],
          groups: [],
          contexts: [],
          defaultContext: null,
          refreshedAt: new Date(0).toISOString(),
        },
      } as unknown as RequestPrincipal,
      user: principal.user,
      requestId: 'request-requester',
      response: null,
    })
    mocks.validateRequesterMutation.mockResolvedValue({
      payload: {
        ...requester,
        id: undefined,
        created_at: undefined,
        user_id: '44444444-4444-4444-8444-444444444444',
      },
      editingId: requester.id,
      existingUserId: null,
    })

    const response = await POST(requesterMutationRequest({
      criarAcesso: false,
      userId: '44444444-4444-4444-8444-444444444444',
    }))

    expect(response.status).toBe(403)
    expect(mocks.upsertCompanyRequester).not.toHaveBeenCalled()
  })

  function requesterMutationRequest({
    criarAcesso,
    userId,
  }: {
    criarAcesso: boolean
    userId: string | null
  }): Request {
    return new Request('http://localhost/api/solicitantes/empresa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: requester.id,
        criarAcesso,
        solicitante: {
          company_id: requester.company_id,
          user_id: userId,
          funcionario_id: null,
          nome: requester.nome,
          email: requester.email,
          telefone: '',
          cargo: '',
          departamento: '',
          centro_custo: '',
          status: 'ativo',
          pode_criar_demanda: true,
          pode_ver_vouchers: true,
          pode_ver_financeiro: false,
          limite_por_solicitacao: 0,
        },
      }),
    })
  }
})

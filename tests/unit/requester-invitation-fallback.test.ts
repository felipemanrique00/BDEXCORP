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
    })
    mocks.getTenantUser.mockResolvedValue(null)
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
})

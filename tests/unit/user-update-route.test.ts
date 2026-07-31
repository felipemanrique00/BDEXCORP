import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class CorporateAccessDeniedError extends Error {}
  class UserConflictError extends Error {}
  class UserInvitationUnavailableError extends Error {}
  class UserNotFoundError extends Error {}
  return {
    CorporateAccessDeniedError,
    UserConflictError,
    UserInvitationUnavailableError,
    UserNotFoundError,
    createTenantUser: vi.fn(),
    guardApiRequest: vi.fn(),
    listTenantInternalPermissionBases: vi.fn(),
    listTenantUsers: vi.fn(),
    setTenantUserActive: vi.fn(),
    updateTenantUser: vi.fn(),
    writeAuditEvent: vi.fn(),
  }
})

vi.mock('@/lib/security/api-guard', () => ({
  guardApiRequest: mocks.guardApiRequest,
}))
vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))
vi.mock('@/lib/server/corporate-access-service', () => ({
  CorporateAccessDeniedError: mocks.CorporateAccessDeniedError,
}))
vi.mock('@/lib/server/user-service', () => ({
  createTenantUser: mocks.createTenantUser,
  listTenantInternalPermissionBases: mocks.listTenantInternalPermissionBases,
  listTenantUsers: mocks.listTenantUsers,
  setTenantUserActive: mocks.setTenantUserActive,
  updateTenantUser: mocks.updateTenantUser,
  UserConflictError: mocks.UserConflictError,
  UserInvitationUnavailableError: mocks.UserInvitationUnavailableError,
  UserNotFoundError: mocks.UserNotFoundError,
}))

import { POST } from '@/app/api/users/route'
import { PATCH } from '@/app/api/users/[id]/route'

describe('POST/PATCH /api/users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardApiRequest.mockResolvedValue({
      principal: { tenantId: 'tenant-1', user: { id: 'leader-1' } },
      user: { id: 'leader-1' },
      requestId: 'request-user-update',
      response: null,
    })
    mocks.updateTenantUser.mockResolvedValue({
      id: 'danilo',
      role: 'master',
      perfil_bbt: 'supervisor',
    })
    mocks.setTenantUserActive.mockResolvedValue({
      id: 'danilo',
      ativo: false,
    })
    mocks.createTenantUser.mockResolvedValue({
      user: {
        id: 'corporate-user',
        role: 'company_admin',
        perfil_bbt: 'operacional',
        corporate_profile: 'manager',
      },
      existing: false,
      invited: false,
    })
  })

  it('routes a complete profile change through updateTenantUser even when active is present', async () => {
    const payload = {
      name: 'Danilo',
      email: 'danilo@example.com',
      role: 'master',
      profile: 'supervisor',
      permissions: {},
      companyIds: [],
      groupIds: [],
      active: true,
    }

    const response = await PATCH(
      new Request('http://localhost/api/users/danilo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ id: 'danilo' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.updateTenantUser).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'danilo',
      payload,
    )
    expect(mocks.setTenantUserActive).not.toHaveBeenCalled()
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.update',
      metadata: { role: 'master', profile: 'supervisor' },
    }))
  })

  it('uses the status-only path only when active is the sole field', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/users/danilo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }),
      { params: Promise.resolve({ id: 'danilo' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.setTenantUserActive).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'danilo',
      false,
    )
    expect(mocks.updateTenantUser).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'perfil interno em role corporativa',
      payload: {
        name: 'Corporate User',
        email: 'corporate@example.com',
        role: 'company_admin',
        profile: 'supervisor',
        corporateAccess: corporateAccess(),
      },
    },
    {
      label: 'acesso corporativo em role interna',
      payload: {
        name: 'Internal User',
        email: 'internal@example.com',
        role: 'master',
        profile: 'supervisor',
        corporateAccess: corporateAccess(),
      },
    },
    {
      label: 'role interna sem perfil interno',
      payload: {
        name: 'Internal User',
        email: 'internal@example.com',
        role: 'master',
      },
    },
    {
      label: 'role corporativa sem configuracao corporativa',
      payload: {
        name: 'Corporate User',
        email: 'corporate@example.com',
        role: 'company_admin',
      },
    },
    {
      label: 'role corporativa misturada com escopo e permissoes internas',
      payload: {
        name: 'Corporate User',
        email: 'corporate@example.com',
        role: 'company_admin',
        permissions: {},
        companyId: null,
        companyIds: [],
        groupIds: [],
        corporateAccess: corporateAccess(),
      },
    },
  ])('rejects $label in both POST and full PATCH', async ({ payload }) => {
    const createResponse = await POST(new Request('http://localhost/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
    const updateResponse = await PATCH(
      new Request('http://localhost/api/users/corporate-user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ id: 'corporate-user' }) },
    )

    expect(createResponse.status).toBe(400)
    expect(updateResponse.status).toBe(400)
    expect(mocks.createTenantUser).not.toHaveBeenCalled()
    expect(mocks.updateTenantUser).not.toHaveBeenCalled()
  })

  it('accepts the coherent corporate payload in both POST and full PATCH', async () => {
    const payload = {
      name: 'Corporate User',
      email: 'corporate@example.com',
      role: 'company_admin',
      corporateAccess: corporateAccess(),
      active: true,
    }

    const createResponse = await POST(new Request('http://localhost/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
    const updateResponse = await PATCH(
      new Request('http://localhost/api/users/corporate-user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ id: 'corporate-user' }) },
    )

    expect(createResponse.status).toBe(201)
    expect(updateResponse.status).toBe(200)
    expect(mocks.createTenantUser).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      payload,
    )
    expect(mocks.updateTenantUser).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'corporate-user',
      payload,
    )
  })

  it('preserves the collaborator role used by the requester corporate flow', async () => {
    const payload = {
      name: 'Requester User',
      email: 'requester@example.com',
      role: 'colaborador' as const,
      corporateAccess: corporateAccess('requester'),
      active: true,
    }

    const response = await POST(new Request('http://localhost/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))

    expect(response.status).toBe(201)
    expect(mocks.createTenantUser).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      payload,
    )
  })
})

function corporateAccess(profile: 'manager' | 'requester' = 'manager') {
  return {
    groupGrants: [],
    companyGrants: [{
      companyId: 'company-a',
      profile,
      permissionOverrides: {},
      status: 'active',
    }],
    defaultContext: { type: 'company', id: 'company-a' },
  }
}

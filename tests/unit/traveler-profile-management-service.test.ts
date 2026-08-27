import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  writeAuditEvent: vi.fn(),
  syncCorporateDirectoryFromStorage: vi.fn(),
  resolveSettings: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

vi.mock('@/lib/server/corporate-directory-sync', () => ({
  syncCorporateDirectoryFromStorage: mocks.syncCorporateDirectoryFromStorage,
}))

vi.mock('@/lib/server/traveler-management-settings-service', () => ({
  resolveTravelerManagementSettingsForCompanies: mocks.resolveSettings,
}))

import {
  completeManagedTravelerProfile,
  createManagedTraveler,
} from '@/lib/server/traveler-profile-management-service'

describe('traveler profile management service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) => (
        operation({ query: mocks.query })
      ),
    )
    mocks.writeAuditEvent.mockResolvedValue(undefined)
    mocks.syncCorporateDirectoryFromStorage.mockResolvedValue(undefined)
    mocks.resolveSettings.mockResolvedValue(new Map([
      ['company-a', { allowRequesterTravelerManagement: true }],
    ]))
  })

  it('does not extend the requester setting to another corporate profile', async () => {
    const actor = principal({
      roleKey: 'readonly',
      role: 'company_admin',
      corporateProfile: 'executive_assistant',
      permissions: permissions({ criar_demandas: true }),
    })

    await expect(createManagedTraveler(actor, validCreateInput())).rejects.toMatchObject({
      code: 'TRAVELER_MANAGEMENT_PERMISSION_DENIED',
      status: 403,
    })

    expect(mocks.resolveSettings).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('keeps requester creation disabled when the effective company setting is false', async () => {
    mocks.resolveSettings.mockResolvedValue(new Map([
      ['company-a', { allowRequesterTravelerManagement: false }],
    ]))

    await expect(createManagedTraveler(requesterPrincipal(), validCreateInput())).rejects.toMatchObject({
      code: 'TRAVELER_REQUESTER_MANAGEMENT_DISABLED',
      status: 403,
    })

    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('lets an internal flow operator create a traveler without broad employee-management permissions', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // CPF availability
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ current_value: 1001 }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ value: { state: { funcionarios: [] }, version: 1 } }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // app_kv write
      .mockResolvedValueOnce({ rowCount: 1, rows: [employeeRow()] })

    const actor = principal({
      roleKey: 'operator',
      role: 'master',
      corporateProfile: 'executive_assistant',
      permissions: permissions({ criar_demandas: true }),
    })

    const item = await createManagedTraveler(actor, validCreateInput())

    expect(item).toMatchObject({ companyId: 'company-a', profileIssues: [] })
    expect(mocks.resolveSettings).not.toHaveBeenCalled()
    expect(mocks.writeAuditEvent.mock.calls[0]?.[0]).toMatchObject({
      metadata: { authorizationSource: 'agency_permission' },
    })
  })

  it('creates a requester-managed traveler atomically without putting PII in the audit event', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // CPF availability
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ current_value: 1001 }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ value: { state: { funcionarios: [] }, version: 1 } }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // app_kv write
      .mockResolvedValueOnce({ rowCount: 1, rows: [employeeRow()] })

    const item = await createManagedTraveler(requesterPrincipal(), validCreateInput())

    expect(item).toMatchObject({
      companyId: 'company-a',
      name: 'Maria da Silva',
      profileIssues: [],
    })
    const syncedStorage = mocks.syncCorporateDirectoryFromStorage.mock.calls[0]?.[2]
    expect(syncedStorage).toMatchObject({
      state: {
        funcionarios: [expect.objectContaining({
          company_id: 'company-a',
          cpf: '52998224725',
          data_nascimento: '1990-05-20',
        })],
      },
    })
    const audit = mocks.writeAuditEvent.mock.calls[0]?.[0]
    expect(audit).toMatchObject({
      action: 'traveler.profile.create',
      entityType: 'employee',
      metadata: {
        companyId: 'company-a',
        changedFields: ['name', 'cpf', 'birthDate'],
        authorizationSource: 'requester_setting',
        profileComplete: true,
      },
    })
    expect(audit.metadata).not.toHaveProperty('identificationCode')
    expect(JSON.stringify(audit.metadata)).not.toContain('52998224725')
    expect(JSON.stringify(audit.metadata)).not.toContain('1990-05-20')
  })

  it('hides an employee outside the actor company scope behind a not-found response', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // scoped employee lookup

    await expect(completeManagedTravelerProfile(
      requesterPrincipal(),
      'employee-from-another-company',
      { cpf: '52998224725' },
    )).rejects.toMatchObject({
      code: 'TRAVELER_NOT_FOUND',
      status: 404,
    })

    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('company_id = any($3::text[])'),
      [TENANT_ID, 'employee-from-another-company', ['company-a']],
    )
    expect(mocks.resolveSettings).not.toHaveBeenCalled()
  })

  it('does not let a requester alter the traveler name through the missing-profile endpoint', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [employeeRow({
        full_name: 'Maria',
        document_number: null,
        metadata: {},
      })] })

    await expect(completeManagedTravelerProfile(
      requesterPrincipal(),
      'employee-a',
      { name: 'Maria da Silva' },
    )).rejects.toMatchObject({
      code: 'TRAVELER_REQUESTER_NAME_CHANGE_DENIED',
      status: 403,
    })

    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('does not overwrite an already populated CPF', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [employeeRow()] })

    await expect(completeManagedTravelerProfile(
      requesterPrincipal(),
      'employee-a',
      { cpf: '11144477735' },
    )).rejects.toMatchObject({
      code: 'TRAVELER_PROFILE_FIELD_ALREADY_SET',
      status: 409,
    })

    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.writeAuditEvent).not.toHaveBeenCalled()
  })

  it('fills a missing CPF and restores a missing legacy projection without exposing it in audit', async () => {
    const current = employeeRow({ document_number: null })
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [current] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // CPF availability
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // employee update
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ value: { state: { funcionarios: [] }, version: 3 } }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // app_kv write
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [employeeRow({ document_number: '52998224725' })],
      })

    const item = await completeManagedTravelerProfile(
      requesterPrincipal(),
      'employee-a',
      { cpf: '529.982.247-25' },
    )

    expect(item.profileIssues).toEqual([])
    const storageWrite = mocks.query.mock.calls[5]
    const persisted = JSON.parse(storageWrite[1][1])
    expect(persisted).toMatchObject({
      state: {
        funcionarios: [expect.objectContaining({
          id: 'employee-a',
          company_id: 'company-a',
          cpf: '52998224725',
          data_nascimento: '1990-05-20',
        })],
      },
    })
    const audit = mocks.writeAuditEvent.mock.calls[0]?.[0]
    expect(audit.metadata).toEqual({
      companyId: 'company-a',
      changedFields: ['cpf'],
      authorizationSource: 'requester_setting',
      profileComplete: true,
    })
    expect(JSON.stringify(audit.metadata)).not.toContain('52998224725')
  })
})

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

function requesterPrincipal(): RequestPrincipal {
  return principal({
    roleKey: 'requester',
    role: 'colaborador',
    corporateProfile: 'requester',
    permissions: permissions({ criar_demandas: true }),
  })
}

function principal(input: {
  roleKey: string
  role: 'master' | 'company_admin' | 'colaborador'
  corporateProfile: 'requester' | 'executive_assistant'
  permissions: Permissoes
}): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: TENANT_ID,
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: input.roleKey,
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds: ['company-a'],
      groupIds: [],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: [input.corporateProfile],
        permissions: input.permissions,
      }],
      groups: [],
      contexts: [],
      defaultContext: { type: 'company', id: 'company-a' },
      refreshedAt: '2026-08-11T12:00:00.000Z',
    },
    user: {
      id: USER_ID,
      email: 'actor@test.invalid',
      name: 'Actor',
      role: input.role,
      role_key: input.roleKey,
      company_id: 'company-a',
      corporate_profile: input.corporateProfile,
      corporate_access: undefined,
      permissoes: input.permissions,
    },
  }
}

function permissions(overrides: Partial<Permissoes>): Permissoes {
  return {
    ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
    cadastrar_funcionarios: false,
    gerenciar_funcionarios: false,
    ...overrides,
  }
}

function validCreateInput() {
  return {
    companyId: 'company-a',
    name: 'Maria da Silva',
    cpf: '529.982.247-25',
    birthDate: '1990-05-20',
  }
}

function employeeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'employee-a',
    company_id: 'company-a',
    identification_code: '1001',
    full_name: 'Maria da Silva',
    document_number: '52998224725',
    email: 'maria@test.invalid',
    phone: null,
    job_title: null,
    department: null,
    cost_center_id: null,
    cost_center: null,
    registration_code: null,
    metadata: { birthDate: '1990-05-20' },
    ...overrides,
  }
}

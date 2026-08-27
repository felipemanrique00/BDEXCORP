import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import {
  emptyTravelerManagementDeclared,
  mergeTravelerManagementDeclared,
  resolveTravelerManagementSettings,
  travelerManagementPatchSchema,
} from '@/lib/travelers/management-settings'
import {
  hasFullGroupTravelerManagementPermission,
  resolveTravelerManagementSettingsForCompanies,
} from '@/lib/server/traveler-management-settings-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { Permissoes } from '@/types'

describe('traveler management settings', () => {
  it('blocks requester management by default', () => {
    expect(resolveTravelerManagementSettings({})).toEqual({
      allowRequesterTravelerManagement: false,
      sources: { allowRequesterTravelerManagement: 'system' },
      groupId: null,
    })
  })

  it('resolves company over group over system and preserves the source', () => {
    expect(resolveTravelerManagementSettings({
      company: { allowRequesterTravelerManagement: null },
      group: { allowRequesterTravelerManagement: true },
      groupId: 'group-a',
    })).toEqual({
      allowRequesterTravelerManagement: true,
      sources: { allowRequesterTravelerManagement: 'group' },
      groupId: 'group-a',
    })
    expect(resolveTravelerManagementSettings({
      company: { allowRequesterTravelerManagement: false },
      group: { allowRequesterTravelerManagement: true },
      groupId: 'group-a',
    })).toEqual({
      allowRequesterTravelerManagement: false,
      sources: { allowRequesterTravelerManagement: 'company' },
      groupId: 'group-a',
    })
  })

  it('supports a partial versioned patch and explicit inheritance', () => {
    expect(mergeTravelerManagementDeclared(
      { allowRequesterTravelerManagement: true },
      { allowRequesterTravelerManagement: null },
    )).toEqual({ allowRequesterTravelerManagement: null })
    expect(mergeTravelerManagementDeclared(
      { allowRequesterTravelerManagement: true },
      {},
    )).toEqual({ allowRequesterTravelerManagement: true })
    expect(emptyTravelerManagementDeclared()).toEqual({
      allowRequesterTravelerManagement: null,
    })
    expect(travelerManagementPatchSchema.safeParse({ values: {} }).success).toBe(false)
    expect(travelerManagementPatchSchema.safeParse({
      values: { allowRequesterTravelerManagement: true },
    }).success).toBe(false)
    expect(travelerManagementPatchSchema.safeParse({
      values: { allowRequesterTravelerManagement: null },
      expectedVersion: 2,
    }).success).toBe(true)
  })

  it('requires the requested permission in every active company for a group change', () => {
    const permissions = {
      ver_funcionarios: true,
      alterar_configuracoes: true,
    } as Permissoes
    const principal = {
      roleKey: 'company_admin',
      platformAdmin: false,
      corporateAccess: {
        companies: [
          { companyId: 'company-a', permissions },
          { companyId: 'company-b', permissions: { ...permissions, alterar_configuracoes: false } },
        ],
      },
    } as unknown as RequestPrincipal

    expect(hasFullGroupTravelerManagementPermission(
      principal,
      ['company-a', 'company-b'],
      'ver_funcionarios',
    )).toBe(true)
    expect(hasFullGroupTravelerManagementPermission(
      principal,
      ['company-a', 'company-b'],
      'alterar_configuracoes',
    )).toBe(false)
    expect(hasFullGroupTravelerManagementPermission(
      { ...principal, roleKey: 'tenant_admin' },
      [],
      'alterar_configuracoes',
    )).toBe(true)
  })

  it('resolves multiple companies in one tenant-scoped query', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          company_id: 'company-a',
          group_id: 'group-a',
          company_allow_requester_traveler_management: null,
          group_allow_requester_traveler_management: true,
        },
        {
          company_id: 'company-b',
          group_id: 'group-a',
          company_allow_requester_traveler_management: false,
          group_allow_requester_traveler_management: true,
        },
      ],
    })
    const resolved = await resolveTravelerManagementSettingsForCompanies(
      { query } as unknown as PoolClient,
      'tenant-a',
      ['company-a', 'company-a', 'company-b'],
    )

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[1]).toEqual(['tenant-a', ['company-a', 'company-b']])
    expect(resolved.get('company-a')).toMatchObject({
      allowRequesterTravelerManagement: true,
      sources: { allowRequesterTravelerManagement: 'group' },
    })
    expect(resolved.get('company-b')).toMatchObject({
      allowRequesterTravelerManagement: false,
      sources: { allowRequesterTravelerManagement: 'company' },
    })
  })
})

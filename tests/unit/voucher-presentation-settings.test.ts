import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import {
  emptyVoucherPresentationDeclared,
  mergeVoucherPresentationDeclared,
  requiresSanitizedVoucherRendering,
  resolveVoucherPresentationSettings,
  voucherPresentationPatchSchema,
} from '@/lib/vouchers/presentation'
import {
  attachVoucherPresentationSettings,
  hasFullGroupCompanyPermission,
  resolveVoucherPresentationSettingsForCompanies,
} from '@/lib/server/voucher-presentation-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { Permissoes, VoucherEmitido } from '@/types'

describe('voucher presentation settings', () => {
  it('requires a sanitized artifact whenever at least one section is hidden', () => {
    expect(requiresSanitizedVoucherRendering({
      showConfirmedValues: true,
      showCancellationTerms: true,
      showAdministrativeData: true,
    })).toBe(false)
    expect(requiresSanitizedVoucherRendering({
      showConfirmedValues: false,
      showCancellationTerms: true,
      showAdministrativeData: true,
    })).toBe(true)
  })

  it('keeps the current voucher behavior when no scope declares an override', () => {
    expect(resolveVoucherPresentationSettings({})).toEqual({
      showConfirmedValues: true,
      showCancellationTerms: true,
      showAdministrativeData: true,
      sources: {
        showConfirmedValues: 'system',
        showCancellationTerms: 'system',
        showAdministrativeData: 'system',
      },
      groupId: null,
    })
  })

  it('resolves each field independently with company over group over system', () => {
    expect(resolveVoucherPresentationSettings({
      company: {
        showConfirmedValues: null,
        showCancellationTerms: true,
        showAdministrativeData: false,
      },
      group: {
        showConfirmedValues: false,
        showCancellationTerms: false,
        showAdministrativeData: true,
      },
      groupId: 'group-01',
    })).toEqual({
      showConfirmedValues: false,
      showCancellationTerms: true,
      showAdministrativeData: false,
      sources: {
        showConfirmedValues: 'group',
        showCancellationTerms: 'company',
        showAdministrativeData: 'company',
      },
      groupId: 'group-01',
    })
  })

  it('supports partial PATCH while preserving explicit null inheritance', () => {
    const current = {
      showConfirmedValues: false,
      showCancellationTerms: true,
      showAdministrativeData: false,
    }
    expect(mergeVoucherPresentationDeclared(current, {
      showCancellationTerms: null,
    })).toEqual({
      showConfirmedValues: false,
      showCancellationTerms: null,
      showAdministrativeData: false,
    })
    expect(emptyVoucherPresentationDeclared()).toEqual({
      showConfirmedValues: null,
      showCancellationTerms: null,
      showAdministrativeData: null,
    })
    expect(voucherPresentationPatchSchema.safeParse({ values: {} }).success).toBe(false)
    expect(voucherPresentationPatchSchema.safeParse({
      values: { showConfirmedValues: null },
      expectedVersion: 2,
    }).success).toBe(true)
  })

  it('requires the requested permission in every active company for a group change', () => {
    const permissions = {
      ver_vouchers: true,
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

    expect(hasFullGroupCompanyPermission(
      principal,
      ['company-a', 'company-b'],
      'ver_vouchers',
    )).toBe(true)
    expect(hasFullGroupCompanyPermission(
      principal,
      ['company-a', 'company-b'],
      'alterar_configuracoes',
    )).toBe(false)
    expect(hasFullGroupCompanyPermission(
      { ...principal, roleKey: 'tenant_admin' },
      [],
      'alterar_configuracoes',
    )).toBe(true)
  })

  it('resolves multiple companies in one tenant-scoped query and attaches the result', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        company_id: 'company-a',
        group_id: 'group-a',
        company_show_confirmed_values: null,
        company_show_cancellation_terms: false,
        company_show_administrative_data: null,
        group_show_confirmed_values: false,
        group_show_cancellation_terms: true,
        group_show_administrative_data: null,
      }],
    })
    const client = { query } as unknown as PoolClient
    const resolved = await resolveVoucherPresentationSettingsForCompanies(
      client,
      'tenant-a',
      ['company-a', 'company-a'],
    )
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[1]).toEqual(['tenant-a', ['company-a']])
    expect(resolved.get('company-a')).toMatchObject({
      showConfirmedValues: false,
      showCancellationTerms: false,
      showAdministrativeData: true,
      groupId: 'group-a',
    })

    query.mockClear()
    const voucher = {
      id: 'H-1',
      numero: '1',
      tipo: 'Hotel',
      status: 'emitido',
      empresa_id: 'company-a',
      passageiro_nome: 'Pessoa Teste',
      fornecedor_nome: 'Hotel Teste',
      total: 100,
      emitido_por_user_id: 'user-a',
      emitido_por_user_name: 'Agente',
      created_at: '2026-08-05T12:00:00.000Z',
    } satisfies VoucherEmitido
    const [presented] = await attachVoucherPresentationSettings(
      client,
      'tenant-a',
      [voucher],
    )
    expect(presented.presentation_settings?.sources).toEqual({
      showConfirmedValues: 'group',
      showCancellationTerms: 'company',
      showAdministrativeData: 'system',
    })
    expect((voucher as VoucherEmitido).presentation_settings).toBeUndefined()
  })
})

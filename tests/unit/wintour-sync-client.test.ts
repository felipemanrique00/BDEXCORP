import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  WINTOUR_UPDATE_FIELDS,
  getWintourSyncDashboardFromServer,
  saveWintourSyncSettingsOnServer,
  wintourUiStateFromStatus,
} from '@/lib/wintour-sync-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Wintour outbound client', () => {
  it('normalizes safe relational summaries without requiring source snapshots', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      dashboard: {
        settings: {
          enabled: true,
          agencyName: 'BBT Corporativo',
          syncFrom: '2026-08-01T00:00:00.000Z',
          maxAttempts: 3,
          discoveryBatchSize: 100,
          version: 2,
          updatedAt: '2026-08-21T10:00:00.000Z',
        },
        availableCompanies: [{ id: 'company-a', name: 'Empresa A', customerCode: 'CLI-01' }],
        saleLinks: [{
          id: '11111111-1111-4111-8111-111111111111',
          companyId: 'company-a',
          emissionId: 'emission-with-a-long-identifier',
          idvExterno: '19',
          wintourSaleNumber: null,
          state: 'ready',
          blockedReasons: [],
          version: 4,
          updatedAt: '2026-08-21T10:00:00.000Z',
        }],
        jobs: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const dashboard = await getWintourSyncDashboardFromServer({ limit: 500 })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/wintour/sync?limit=200',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(dashboard.settings).toMatchObject({
      agencyName: 'BBT Corporativo',
      syncFrom: '2026-08-01',
    })
    expect(dashboard.availableCompanies).toEqual([
      { id: 'company-a', name: 'Empresa A', customerCode: 'CLI-01' },
    ])
    expect(dashboard.jobs[0]).toMatchObject({
      uiState: 'ready',
      preparable: true,
      saleLinkVersion: 4,
      companyName: 'Empresa A',
    })
    expect(JSON.stringify(dashboard)).not.toContain('sourceSnapshot')
  })

  it('sends an optimistic settings update with an ISO start date', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      settings: {
        enabled: true,
        agencyName: 'BBT Corporativo',
        syncFrom: '2026-08-01T00:00:00.000Z',
        maxAttempts: 3,
        discoveryBatchSize: 100,
        version: 8,
        updatedAt: '2026-08-21T10:00:00.000Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await saveWintourSyncSettingsOnServer({
      enabled: true,
      agencyName: 'BBT Corporativo',
      syncFrom: '2026-08-01',
      maxAttempts: 3,
      discoveryBatchSize: 100,
      branchId: null,
      branchName: null,
      freeField: null,
      productCodes: { air: null, hotel: null, car: null, bus: null },
      paymentMethodCodes: {
        faturado: 'IV',
        pix: 'PX',
        cartao_corporativo: null,
        cartao_agencia: null,
        transferencia: null,
        dinheiro: 'CA',
        outro: null,
      },
      serviceRouteTypes: { air: 1, hotel: 2, car: 3, bus: null },
      tariffNetDefault: null,
      accountDefaults: {
        issuer: null,
        promoter: null,
        manager: null,
        supplier: null,
        agencyCostCenter: null,
        cardCp: null,
        cardMp: null,
        additionalFee: null,
        additionalFee2: null,
        issuanceFee: null,
      },
      customerAction: 'none',
      autoSend: false,
      autoPoll: false,
      companyMappings: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        wintourAccountCode: 'CLI-01',
      }],
      version: 7,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      agencyName: 'BBT Corporativo',
      syncFrom: '2026-08-01T00:00:00.000Z',
      expectedVersion: 7,
      paymentMethodCodes: { faturado: 'IV', pix: 'PX', dinheiro: 'CA' },
      companyMappings: [{ companyId: 'company-a', wintourAccountCode: 'CLI-01' }],
    })
    expect(String(init.body)).not.toContain('updatedAt')
    expect(String(init.body)).not.toContain('Empresa A')
  })

  it('prioritizes a source-changed link over a historical completed job', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      dashboard: {
        settings: null,
        availableCompanies: [{ id: 'company-a', name: 'Empresa A' }],
        saleLinks: [{
          id: '11111111-1111-4111-8111-111111111111',
          companyId: 'company-a',
          emissionId: 'emission-a',
          idvExterno: '19',
          wintourSaleNumber: '987654',
          state: 'manual_review',
          blockedReasons: ['source_changed_after_wintour_link'],
          version: 6,
          updatedAt: '2026-08-21T11:00:00.000Z',
        }],
        jobs: [{
          id: '22222222-2222-4222-8222-222222222222',
          saleLinkId: '11111111-1111-4111-8111-111111111111',
          operation: 'create',
          state: 'completed',
          version: 4,
          preparedAt: '2026-08-21T10:00:00.000Z',
          updatedAt: '2026-08-21T10:30:00.000Z',
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const dashboard = await getWintourSyncDashboardFromServer()

    expect(dashboard.jobs[0]).toMatchObject({
      status: 'manual_review',
      uiState: 'manual_review',
      humanActionRequired: true,
      blockedReasons: ['source_changed_after_wintour_link'],
    })
  })

  it('covers every allowlisted DGR-046 field and maps operational states', () => {
    expect(WINTOUR_UPDATE_FIELDS).toHaveLength(47)
    expect(new Set(WINTOUR_UPDATE_FIELDS.map((field) => field.code)).size).toBe(47)
    expect(wintourUiStateFromStatus('ambiguous')).toBe('ambiguous')
    expect(wintourUiStateFromStatus('received')).toBe('protocol')
    expect(wintourUiStateFromStatus('failed')).toBe('manual_review')
    expect(wintourUiStateFromStatus('completed')).toBe('completed')
    expect(wintourUiStateFromStatus('completed', {
      blockedReasons: ['source_changed_after_wintour_link'],
    })).toBe('blocked')
    expect(wintourUiStateFromStatus('blocked', { blockedReasons: ['missing_mapping'] })).toBe('blocked')
  })
})

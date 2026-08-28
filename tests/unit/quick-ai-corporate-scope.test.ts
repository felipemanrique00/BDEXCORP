import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Atendimento, VoucherEmitido } from '@/types'

const storage = vi.hoisted(() => ({
  atendimentos: [] as Atendimento[],
  vouchers: [] as VoucherEmitido[],
}))

vi.mock('@/lib/atendimentos-storage', () => ({
  getAllAtendimentos: () => storage.atendimentos,
}))

vi.mock('@/lib/vouchers-emitidos-storage', () => ({
  getAllVouchersEmitidos: () => storage.vouchers,
}))

vi.mock('@/lib/supplier-integrations', () => ({
  getSupplierIntegrations: () => [],
  selectSuppliersForService: () => [],
  supplierSummaryForAI: () => [],
}))

import { buildSystemContext } from '@/lib/ia-system-actions'

const popupSource = readFileSync(
  resolve(process.cwd(), 'components/ai/quick-ai-popup.tsx'),
  'utf8',
)

describe('Quick AI corporate scope', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
    storage.atendimentos = [
      { id: 'demand-a', empresa_id: 'company-a', passageiro_nome: 'A' } as Atendimento,
      { id: 'demand-b', empresa_id: 'company-b', passageiro_nome: 'B' } as Atendimento,
    ]
    storage.vouchers = [
      { id: 'voucher-a', empresa_id: 'company-a', passageiro_nome: 'A' } as VoucherEmitido,
      { id: 'voucher-b', empresa_id: 'company-b', passageiro_nome: 'B' } as VoucherEmitido,
    ]
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes only selected companies authorized for AI and scopes each store collection by permission', () => {
    expect(popupSource).toContain('const { companyIdsList, includesCompany } = useCorporateCompanyScope()')
    expect(popupSource).toContain("includesCompany(companyId, 'usar_ia')")
    expect(popupSource).toContain("includesCompany(empresa.id, 'ver_empresas')")
    expect(popupSource).toContain("includesCompany(funcionario.company_id, 'ver_funcionarios')")
    expect(popupSource).toContain("includesCompany(politica.company_id, 'ver_politicas')")
    expect(popupSource).toContain('empresas: empresasEscopoIA')
    expect(popupSource).toContain('funcionarios: funcionariosEscopoIA')
    expect(popupSource).toContain('politicas: politicasEscopoIA')
    expect(popupSource).toContain('companyIds: companyIdsEscopoIA')
    expect(popupSource).toContain("companyIdsEscopoIA.filter((companyId) => includesCompany(companyId, 'ver_demandas'))")
    expect(popupSource).toContain("companyIdsEscopoIA.filter((companyId) => includesCompany(companyId, 'ver_vouchers'))")
    expect(popupSource).toContain('demandCompanyIds: demandCompanyIdsEscopoIA')
    expect(popupSource).toContain('voucherCompanyIds: voucherCompanyIdsEscopoIA')
    expect(popupSource).not.toContain('politicas,\n        allowInternet')
  })

  it('filters demands, vouchers and the unified index by the explicit company scope', () => {
    const context = buildSystemContext({
      empresas: [],
      funcionarios: [],
      hoteis: [],
      companyIds: ['company-a'],
    })

    expect(context.atendimentos.map((item) => item.id)).toEqual(['demand-a'])
    expect(context.vouchers.map((item) => item.id)).toEqual(['voucher-a'])
    expect(context.unifiedIndex.map((item) => item.id)).toEqual(['demand-a', 'voucher-a'])
  })

  it('keeps heterogeneous demand and voucher permissions isolated per company', () => {
    const context = buildSystemContext({
      empresas: [],
      funcionarios: [],
      hoteis: [],
      companyIds: ['company-a', 'company-b'],
      demandCompanyIds: ['company-a'],
      voucherCompanyIds: ['company-b'],
    })

    expect(context.atendimentos.map((item) => item.id)).toEqual(['demand-a'])
    expect(context.vouchers.map((item) => item.id)).toEqual(['voucher-b'])
    expect(context.unifiedIndex.map((item) => item.id)).toEqual(['demand-a', 'voucher-b'])
    expect(context.atendimentos.some((item) => item.id === 'demand-b')).toBe(false)
    expect(context.vouchers.some((item) => item.id === 'voucher-a')).toBe(false)
  })

  it('treats an empty explicit scope as no visible company data', () => {
    const context = buildSystemContext({
      empresas: [],
      funcionarios: [],
      hoteis: [],
      companyIds: [],
    })

    expect(context.atendimentos).toEqual([])
    expect(context.vouchers).toEqual([])
  })

  it('keeps legacy callers without companyIds backward compatible', () => {
    const context = buildSystemContext({
      empresas: [],
      funcionarios: [],
      hoteis: [],
    })

    expect(context.atendimentos.map((item) => item.id)).toEqual(['demand-a', 'demand-b'])
    expect(context.vouchers.map((item) => item.id)).toEqual(['voucher-a', 'voucher-b'])
  })
})

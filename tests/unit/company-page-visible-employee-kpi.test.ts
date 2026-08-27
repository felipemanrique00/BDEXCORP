import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  metrics: [] as Array<{ label: string; value: number; icon?: unknown }>,
}))

vi.mock('@/lib/store', () => ({
  useStore: () => ({
    empresas: [
      {
        id: 'company-visible',
        nome: 'Empresa visível',
        cnpj: '',
        endereco: '',
        responsavel: '',
        email_responsavel: '',
        telefone: '',
        centro_custo_padrao: '',
        ativa: true,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'company-hidden',
        nome: 'Empresa oculta',
        cnpj: '',
        endereco: '',
        responsavel: '',
        email_responsavel: '',
        telefone: '',
        centro_custo_padrao: '',
        ativa: true,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    gruposEmpresariais: [],
    funcionarios: [
      { id: 'employee-visible-a', company_id: 'company-visible' },
      { id: 'employee-hidden', company_id: 'company-hidden' },
      { id: 'employee-visible-b', company_id: 'company-visible' },
    ],
    addEmpresa: vi.fn(),
    updateEmpresa: vi.fn(),
    deleteEmpresa: vi.fn(),
  }),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => ({ id: 'user-test', role: 'master' }),
}))

vi.mock('@/lib/company-creation-access', () => ({
  canCreateCompanyWithoutGroup: () => false,
  companyGroupIdsAvailableForCreation: () => new Set<string>(),
}))

vi.mock('@/components/corporate-context-provider', () => ({
  useCorporateCompanyScope: () => ({
    includesCompany: (companyId: string) => companyId === 'company-visible',
  }),
  useCorporateContext: () => ({ refreshAccess: vi.fn() }),
}))

vi.mock('@/components/ui/page-hero', () => ({
  PageHero: ({ metrics }: { metrics: Array<{ label: string; value: number; icon?: unknown }> }) => {
    mocks.metrics = metrics
    return createElement('div', { 'data-testid': 'page-hero' })
  },
}))

vi.mock('@/components/ui/search-input', () => ({ SearchInput: () => null }))
vi.mock('@/components/ui/whatsapp-button', () => ({ WhatsAppButton: () => null }))
vi.mock('@/components/ui/modal', () => ({ Modal: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }))
vi.mock('@/components/ui/config-cobranca-modal', () => ({ ConfigCobrancaModal: () => null }))
vi.mock('@/components/ai/ai-assistant-fab', () => ({ AIAssistantFab: () => null }))
vi.mock('@/lib/storage-quota', () => ({ flushPendingRemoteStorageWithResult: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import EmpresasPage from '../../app/dashboard/empresas/page'

describe('company directory employee KPI', () => {
  beforeEach(() => {
    mocks.metrics = []
  })

  it('counts only employees belonging to companies visible to the current user', () => {
    renderToStaticMarkup(createElement(EmpresasPage))

    expect(mocks.metrics.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Cadastradas', value: 1 },
      { label: 'Funcionários', value: 2 },
    ])
  })
})

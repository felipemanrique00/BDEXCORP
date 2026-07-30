import { describe, expect, it } from 'vitest'

import {
  filterSuppliersByService,
  selectSuppliersFromCatalog,
  type SupplierIntegration,
} from '@/lib/supplier-integrations'

describe('supplier catalog selection', () => {
  it('filters inactive or unrelated providers and orders by readiness and priority', () => {
    const providers = [
      provider({ id: 'pending-high', status: 'pendente_configuracao', prioridade: 100 }),
      provider({ id: 'active-low', status: 'ativo', prioridade: 10 }),
      provider({ id: 'active-high', status: 'ativo', prioridade: 90 }),
      provider({ id: 'inactive', status: 'inativo', prioridade: 200 }),
      provider({ id: 'hotel', servicos: ['hotelaria'], prioridade: 300 }),
    ]

    expect(filterSuppliersByService(providers, 'aereo').map((item) => item.id)).toEqual([
      'active-high',
      'active-low',
      'pending-high',
    ])
  })

  it('recommends only providers able to search or quote and respects the limit', () => {
    const providers = [
      provider({ id: 'status-only', capacidades: ['status'], prioridade: 100 }),
      provider({ id: 'quote', capacidades: ['cotacao'], prioridade: 90 }),
      provider({ id: 'search', capacidades: ['pesquisa'], prioridade: 80 }),
      provider({ id: 'second-quote', capacidades: ['cotacao'], prioridade: 70 }),
    ]

    expect(selectSuppliersFromCatalog(providers, 'aereo', 2).map((item) => item.id)).toEqual([
      'quote',
      'search',
    ])
  })
})

function provider(
  overrides: Partial<SupplierIntegration> & Pick<SupplierIntegration, 'id'>,
): SupplierIntegration {
  const result: SupplierIntegration = {
    nome: overrides.id,
    id: overrides.id,
    tipo: 'outro',
    servicos: ['aereo'],
    capacidades: ['cotacao'],
    modo: 'api',
    status: 'ativo',
    prioridade: 50,
    auth_type: 'bearer',
    created_at: '2026-07-23T12:00:00.000Z',
  }
  return { ...result, ...overrides }
}

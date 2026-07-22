import { describe, expect, it } from 'vitest'

import {
  testarSupplierConnector,
  type SupplierIntegration,
} from '@/lib/supplier-integrations'

function supplier(overrides: Partial<SupplierIntegration> = {}): SupplierIntegration {
  return {
    id: 'supplier-test',
    nome: 'Fornecedor testado',
    tipo: 'consolidadora',
    servicos: ['aereo'],
    capacidades: ['importacao', 'status'],
    modo: 'api',
    status: 'pendente_configuracao',
    prioridade: 10,
    auth_type: 'api_key',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('testarSupplierConnector', () => {
  it('nunca declara sucesso apenas porque uma URL foi informada', () => {
    const result = testarSupplierConnector(supplier({ api_base_url: 'https://fornecedor.invalid/api' }))

    expect(result.status).toBe('pendente')
    expect(result.message).toContain('adaptador oficial')
  })

  it('retorna falha quando não existe configuração verificável', () => {
    const result = testarSupplierConnector(supplier())

    expect(result.status).toBe('falha')
  })
})

import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import {
  canonicalizePortalGroundDemandInTransaction,
} from '@/lib/server/offline-ground-demand-service'

const IDS = {
  employee: 'employee-1',
  employee2: 'employee-2',
  pickup: '00000000-0000-4000-8000-000000000001',
  returning: '00000000-0000-4000-8000-000000000002',
  originTerminal: '00000000-0000-4000-8000-000000000003',
  destinationTerminal: '00000000-0000-4000-8000-000000000004',
  originCity: '00000000-0000-4000-8000-000000000005',
  destinationCity: '00000000-0000-4000-8000-000000000006',
}

describe('Pedido multi-servico ground canonicalization', () => {
  it('replaces client-controlled driver, supplier and rental location snapshots', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from employees')) return { rows: [{
        id: IDS.employee,
        full_name: 'Motorista Canonico',
        email: 'motorista@empresa.test',
        phone: null,
      }] }
      if (sql.includes('from rental_locations')) return { rows: [
        {
          id: IDS.pickup,
          supplier_id: 'supplier-1',
          supplier_name: 'Movida',
          name: 'Loja Aeroporto',
          city_id: IDS.originCity,
          city_name: 'Sao Paulo',
        },
        {
          id: IDS.returning,
          supplier_id: 'supplier-1',
          supplier_name: 'Movida',
          name: 'Loja Centro',
          city_id: IDS.destinationCity,
          city_name: 'Campinas',
        },
      ] }
      throw new Error(`query inesperada: ${sql}`)
    })
    const result = await canonicalizePortalGroundDemandInTransaction(
      { query } as unknown as PoolClient,
      {
        tenantId: 'tenant-1',
        companyId: 'company-1',
        service: 'car',
        demand: {
          passageiro_nome: 'Nome Forjado',
          detalhes_carro: {
            ground: {
              pickupLocationId: IDS.pickup,
              returnLocationId: IDS.returning,
              pickupAt: '2026-09-01T10:00:00-03:00',
              returnAt: '2026-09-03T10:00:00-03:00',
              preferences: { token: 'nao persistir' },
            },
            primary_driver: { employee_id: IDS.employee, name: 'Nome Forjado' },
            pickup_location_name: 'Loja Forjada',
            return_location_name: 'Outra Loja Forjada',
            supplier_name: 'Fornecedor Forjado',
          },
        },
      },
    )
    expect(result.passageiro_nome).toBe('Motorista Canonico')
    expect(result.funcionario_id).toBe(IDS.employee)
    expect(result.detalhes_carro).toMatchObject({
      supplier_name: 'Movida',
      primary_driver: {
        employee_id: IDS.employee,
        name: 'Motorista Canonico',
        email: 'motorista@empresa.test',
      },
      pickup_location_name: 'Movida · Loja Aeroporto · Sao Paulo',
      return_location_name: 'Movida · Loja Centro · Campinas',
      ground: { preferences: {} },
    })
  })

  it('rebuilds traveler and terminal snapshots from company/catalog data', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from employees')) return { rows: [
        { id: IDS.employee, full_name: 'Viajante Um', email: null, phone: null },
        { id: IDS.employee2, full_name: 'Viajante Dois', email: 'dois@empresa.test', phone: null },
      ] }
      if (sql.includes('from bus_terminals')) return { rows: [
        { id: IDS.originTerminal, city_id: IDS.originCity, name: 'Tietê', city_name: 'Sao Paulo' },
        { id: IDS.destinationTerminal, city_id: IDS.destinationCity, name: 'Rodoviaria', city_name: 'Campinas' },
      ] }
      throw new Error(`query inesperada: ${sql}`)
    })
    const result = await canonicalizePortalGroundDemandInTransaction(
      { query } as unknown as PoolClient,
      {
        tenantId: 'tenant-1',
        companyId: 'company-1',
        service: 'bus',
        demand: busDemand(),
      },
    )
    expect(result.passageiro_nome).toBe('Viajante Um')
    expect(result.detalhes_rodoviario).toMatchObject({
      ground: { preferences: {} },
      travelers: [
        { employee_id: IDS.employee, name: 'Viajante Um' },
        { employee_id: IDS.employee2, name: 'Viajante Dois', email: 'dois@empresa.test' },
      ],
      leg_snapshots: [{
        origin_city_name: 'Sao Paulo',
        destination_city_name: 'Campinas',
        origin_terminal_name: 'Tietê',
        destination_terminal_name: 'Rodoviaria',
      }],
    })
  })

  it('fails closed when a terminal does not belong to the declared city', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from employees')) return { rows: [
        { id: IDS.employee, full_name: 'Viajante Um', email: null, phone: null },
        { id: IDS.employee2, full_name: 'Viajante Dois', email: null, phone: null },
      ] }
      if (sql.includes('from bus_terminals')) return { rows: [
        { id: IDS.originTerminal, city_id: IDS.destinationCity, name: 'Terminal Incorreto', city_name: 'Campinas' },
        { id: IDS.destinationTerminal, city_id: IDS.destinationCity, name: 'Rodoviaria', city_name: 'Campinas' },
      ] }
      throw new Error(`query inesperada: ${sql}`)
    })
    await expect(canonicalizePortalGroundDemandInTransaction(
      { query } as unknown as PoolClient,
      {
        tenantId: 'tenant-1',
        companyId: 'company-1',
        service: 'bus',
        demand: busDemand(),
      },
    )).rejects.toMatchObject({
      code: 'GROUND_BUS_TERMINAL_CITY_MISMATCH',
      status: 422,
    })
  })
})

function busDemand(): Record<string, unknown> {
  return {
    passageiro_nome: 'Nome Forjado',
    detalhes_rodoviario: {
      ground: {
        tripType: 'one_way',
        accessibilityRequired: false,
        preferences: { internalFoo: 'nao persistir' },
        legs: [{
          originCityId: IDS.originCity,
          destinationCityId: IDS.destinationCity,
          originTerminalId: IDS.originTerminal,
          destinationTerminalId: IDS.destinationTerminal,
          departureDate: '2026-09-01',
        }],
      },
      travelers: [
        { employee_id: IDS.employee, name: 'Forjado Um' },
        { employee_id: IDS.employee2, name: 'Forjado Dois' },
      ],
      leg_snapshots: [{
        origin_city_name: 'Origem Forjada',
        destination_city_name: 'Destino Forjado',
      }],
    },
  }
}

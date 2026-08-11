import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { AirDemandDetailsInput } from '@/lib/air-demand/model'
import {
  persistAirDemandDetailsInTransaction,
} from '@/lib/server/air-demand-service'

const details: AirDemandDetailsInput = {
  tripType: 'round_trip',
  cabinClass: 'economy',
  preferredAirlineCodes: ['LA'],
  directOnly: false,
  baggageRequired: true,
  preferences: { baggagePieces: 1, flexibleDates: false },
  legs: [
    {
      sequence: 1,
      originCode: 'REC',
      originName: 'Recife',
      destinationCode: 'GYN',
      destinationName: 'Goiânia',
      departureDate: '2030-08-11',
      earliestDeparture: '02:00',
      latestDeparture: '09:00',
    },
    {
      sequence: 2,
      originCode: 'GYN',
      originName: 'Goiânia',
      destinationCode: 'REC',
      destinationName: 'Recife',
      departureDate: '2030-08-14',
      earliestDeparture: null,
      latestDeparture: null,
    },
  ],
}

describe('air demand relational persistence', () => {
  it('upserts the demand detail and replaces its ordered legs in the same client', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValue({ rows: [] })
    const client = { query } as unknown as PoolClient

    await persistAirDemandDetailsInTransaction(client, {
      tenantId: 'tenant-a',
      demandId: 'demand-a',
      companyId: 'company-a',
      actorUserId: 'user-a',
      details,
    })

    expect(query).toHaveBeenCalledTimes(5)
    expect(String(query.mock.calls[1][0])).toContain('insert into air_demand_details')
    expect(String(query.mock.calls[2][0])).toContain('delete from air_demand_legs')
    expect(String(query.mock.calls[3][0])).toContain('insert into air_demand_legs')
    expect(query.mock.calls[3][1]).toEqual(expect.arrayContaining(['REC', 'GYN', '2030-08-11']))
    expect(query.mock.calls[4][1]).toEqual(expect.arrayContaining([2, 'GYN', 'REC', '2030-08-14']))
  })

  it('does not persist outside the tenant/company scope of the demand', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const client = { query } as unknown as PoolClient

    await expect(persistAirDemandDetailsInTransaction(client, {
      tenantId: 'tenant-a',
      demandId: 'demand-a',
      companyId: 'company-b',
      actorUserId: 'user-a',
      details,
    })).rejects.toMatchObject({
      code: 'AIR_DEMAND_SCOPE_MISMATCH',
      status: 409,
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('canonicalizes and persists every explicitly selected passenger', async () => {
    const query = vi.fn(async (sqlValue: unknown, _values?: unknown[]) => {
      const sql = String(sqlValue)
      if (sql.includes('from demands')) return { rows: [{ exists: 1 }] }
      if (sql.includes('from employees employee')) {
        return {
          rows: [
            {
              id: 'employee-a',
              full_name: 'Maria da Silva',
              document_number: '52998224725',
              email: 'maria@example.com',
              phone: '5511999999999',
              metadata: { birthDate: '1990-05-20' },
            },
            {
              id: 'employee-b',
              full_name: 'Joao Souza',
              document_number: '11144477735',
              email: 'joao@example.com',
              phone: null,
              metadata: { birthDate: '1985-02-10' },
            },
          ],
        }
      }
      if (sql.includes('select traveler.id')) {
        return {
          rows: [{
            id: '017e8372-a4bb-4c91-a174-f2320a0e0daa',
            employee_id: 'employee-a',
            deleted_at: null,
          }],
        }
      }
      return { rows: [], rowCount: 1 }
    })
    const client = { query } as unknown as PoolClient

    await persistAirDemandDetailsInTransaction(client, {
      tenantId: 'tenant-a',
      demandId: 'demand-a',
      companyId: 'company-a',
      actorUserId: 'user-a',
      details: {
        ...details,
        passengers: [
          { employeeId: 'employee-a', name: 'Maria da Silva' },
          { employeeId: 'employee-b', name: 'Joao Souza' },
        ],
      },
    })

    const statements = query.mock.calls.map(([sql]) => String(sql))
    expect(statements.some((sql) => sql.includes('update demand_travelers set'))).toBe(true)
    expect(statements.some((sql) => sql.includes('traveler_sequence = $8'))).toBe(true)
    expect(statements.some((sql) => sql.includes('first_name_snapshot = $10'))).toBe(true)
    expect(statements.some((sql) => sql.includes('insert into demand_travelers'))).toBe(true)
    expect(query.mock.calls.flatMap((call) => call[1] || [])).toContain('52998224725')
    expect(query.mock.calls.flatMap((call) => call[1] || [])).toEqual(expect.arrayContaining([1, 2]))
  })

  it('blocks air use when a selected employee lacks the mandatory profile fields', async () => {
    const query = vi.fn(async (sqlValue: unknown, _values?: unknown[]) => {
      const sql = String(sqlValue)
      if (sql.includes('from demands')) return { rows: [{ exists: 1 }] }
      if (sql.includes('from employees employee')) {
        return {
          rows: [{
            id: 'employee-a',
            full_name: 'Mononimo',
            document_number: null,
            email: null,
            phone: null,
            metadata: {},
          }],
        }
      }
      return { rows: [], rowCount: 1 }
    })
    const client = { query } as unknown as PoolClient

    await expect(persistAirDemandDetailsInTransaction(client, {
      tenantId: 'tenant-a',
      demandId: 'demand-a',
      companyId: 'company-a',
      actorUserId: 'user-a',
      details: {
        ...details,
        passengers: [{ employeeId: 'employee-a', name: 'Mononimo' }],
      },
    })).rejects.toMatchObject({
      code: 'AIR_DEMAND_PASSENGER_PROFILE_INCOMPLETE',
      status: 422,
      details: {
        passengers: [{
          employeeId: 'employee-a',
          fields: ['cpf', 'birth_date', 'last_name'],
        }],
      },
    })
  })
})

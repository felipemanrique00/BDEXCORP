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
})

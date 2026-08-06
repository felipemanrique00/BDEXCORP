import { describe, expect, it } from 'vitest'

import {
  airDemandDetailsIssues,
  parseAirDemandDetails,
} from '@/lib/air-demand/model'

function roundTrip() {
  return {
    trip_type: 'round_trip',
    classe: 'Econômica Premium',
    preferred_airlines: ['latam', 'gol'],
    baggage_pieces: 1,
    direct_only: true,
    flexible_dates: false,
    flexible_times: true,
    internacional: false,
    trechos: [
      {
        sequence: 1,
        origin: 'REC - Recife',
        destination: 'GYN - Goiânia',
        departure_date: '2030-08-11',
        earliest_time: '02:00',
        latest_time: '09:00',
      },
      {
        sequence: 2,
        origin: 'GYN - Goiânia',
        destination: 'REC - Recife',
        departure_date: '2030-08-14',
        earliest_time: '',
        latest_time: '',
      },
    ],
  }
}

describe('air demand model', () => {
  it('normalizes a requested itinerary for relational persistence', () => {
    const parsed = parseAirDemandDetails(roundTrip())

    expect(parsed).toMatchObject({
      tripType: 'round_trip',
      cabinClass: 'premium_economy',
      preferredAirlineCodes: ['LATAM', 'GOL'],
      directOnly: true,
      baggageRequired: true,
    })
    expect(parsed?.legs).toEqual([
      expect.objectContaining({ sequence: 1, originCode: 'REC', originName: 'Recife', destinationCode: 'GYN' }),
      expect.objectContaining({ sequence: 2, originCode: 'GYN', destinationCode: 'REC', departureDate: '2030-08-14' }),
    ])
  })

  it('reports a clear field path when an airport is not identified by IATA', () => {
    const invalid = roundTrip()
    invalid.trechos[0].origin = 'Recife'

    expect(parseAirDemandDetails(invalid)).toBeNull()
    expect(airDemandDetailsIssues(invalid)).toContainEqual({
      path: 'trechos.0.origin',
      message: expect.stringContaining('IATA'),
    })
  })

  it('rejects discontinuous sequences, reversed dates and equal airports', () => {
    const invalid = roundTrip()
    invalid.trechos[1] = {
      ...invalid.trechos[1],
      sequence: 3,
      origin: 'REC',
      destination: 'REC',
      departure_date: '2030-08-10',
    }

    const issues = airDemandDetailsIssues(invalid)
    expect(issues.some((issue) => issue.path === 'trechos.1.sequence')).toBe(true)
    expect(issues.some((issue) => issue.path === 'trechos.1.destination')).toBe(true)
    expect(issues.some((issue) => issue.path === 'trechos.1.departure_date')).toBe(true)
  })

  it('requires the number of legs compatible with the trip type', () => {
    const invalid = { ...roundTrip(), trip_type: 'one_way' }
    expect(airDemandDetailsIssues(invalid)).toContainEqual({
      path: 'trechos',
      message: expect.stringContaining('Somente ida'),
    })
  })
})

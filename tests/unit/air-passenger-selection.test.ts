import { describe, expect, it } from 'vitest'

import {
  airPassengerNameIssues,
  airPassengersFromDetails,
  MAX_AIR_PASSENGERS,
  normalizeAirPassengerProfileIssues,
  normalizeAirPassengers,
  withAirPassengers,
} from '@/lib/air-demand/passenger-selection'

describe('air passenger selection', () => {
  it('normalizes IDs, removes duplicates and enforces the request limit', () => {
    const input = Array.from({ length: MAX_AIR_PASSENGERS + 5 }, (_, index) => ({
      employee_id: ` employee-${index} `,
      name: ` Viajante ${index} `,
    }))
    input.splice(2, 0, { employee_id: 'employee-1', name: 'Duplicado' })

    const passengers = normalizeAirPassengers(input)

    expect(passengers).toHaveLength(MAX_AIR_PASSENGERS)
    expect(passengers[0]).toEqual({ employee_id: 'employee-0', name: 'Viajante 0' })
    expect(passengers.filter((item) => item.employee_id === 'employee-1')).toHaveLength(1)
  })

  it('uses the legacy primary only when the structured list is absent', () => {
    expect(airPassengersFromDetails({}, {
      employee_id: 'employee-legacy',
      name: 'Maria Legado',
    })).toEqual([{ employee_id: 'employee-legacy', name: 'Maria Legado' }])

    expect(airPassengersFromDetails({
      passengers: [{ employee_id: 'employee-new', name: 'Ana Estruturada' }],
    }, {
      employee_id: 'employee-legacy',
      name: 'Maria Legado',
    })).toEqual([{ employee_id: 'employee-new', name: 'Ana Estruturada' }])
  })

  it('preserves air details while replacing the selected passenger order', () => {
    expect(withAirPassengers({ trip_type: 'one_way', baggage_pieces: 1 }, [
      { employee_id: 'employee-b', name: 'Bruna Silva' },
      { employee_id: 'employee-a', name: 'Ana Souza' },
    ])).toEqual({
      trip_type: 'one_way',
      baggage_pieces: 1,
      passengers: [
        { employee_id: 'employee-b', name: 'Bruna Silva' },
        { employee_id: 'employee-a', name: 'Ana Souza' },
      ],
    })
  })

  it('surfaces CPF, birth date and incomplete passenger names before submission', () => {
    expect(normalizeAirPassengerProfileIssues(
      ['cpf', 'data_nascimento', { code: 'given-name' }],
      'Maria',
    )).toEqual(['last_name', 'cpf', 'birth_date', 'first_name'])
    expect(airPassengerNameIssues('Maria da Silva')).toEqual([])
  })
})

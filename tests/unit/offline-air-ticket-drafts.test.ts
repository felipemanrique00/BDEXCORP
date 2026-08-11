import { describe, expect, it } from 'vitest'

import {
  createAirTicketDrafts,
  updateAirTicketDraft,
} from '@/components/travel/services/air/ticket-drafts'

describe('offline air ticket drafts', () => {
  it('keeps homonymous passengers independent through their demand traveler IDs', () => {
    const passengers = [
      {
        demandTravelerId: 'demand-traveler-a',
        employeeId: 'employee-a',
        name: 'Maria da Silva',
      },
      {
        demandTravelerId: 'demand-traveler-b',
        employeeId: 'employee-b',
        name: 'Maria da Silva',
      },
    ]

    const secondUpdated = updateAirTicketDraft(
      passengers,
      createAirTicketDrafts(passengers),
      1,
      'TICKET-B',
    )
    const bothUpdated = updateAirTicketDraft(passengers, secondUpdated, 0, 'TICKET-A')

    expect(bothUpdated).toEqual([
      {
        passengerId: 'demand-traveler:demand-traveler-a',
        demandTravelerId: 'demand-traveler-a',
        passengerName: 'Maria da Silva',
        ticketNumber: 'TICKET-A',
      },
      {
        passengerId: 'demand-traveler:demand-traveler-b',
        demandTravelerId: 'demand-traveler-b',
        passengerName: 'Maria da Silva',
        ticketNumber: 'TICKET-B',
      },
    ])
  })

  it('preserves old name-only drafts in occurrence order and gives legacy passengers stable keys', () => {
    const passengers = [{ name: 'Pessoa Igual' }, { name: 'Pessoa Igual' }]
    const reconciled = createAirTicketDrafts(passengers, [
      { passengerId: '', passengerName: 'Pessoa Igual', ticketNumber: 'OLD-1' },
      { passengerId: '', passengerName: 'Pessoa Igual', ticketNumber: 'OLD-2' },
    ])

    expect(reconciled.map((item) => item.passengerId)).toEqual([
      'legacy:1:pessoa igual',
      'legacy:2:pessoa igual',
    ])
    expect(reconciled.map((item) => item.ticketNumber)).toEqual(['OLD-1', 'OLD-2'])
  })
})

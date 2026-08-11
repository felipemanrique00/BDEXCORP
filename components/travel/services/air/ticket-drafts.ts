import type {
  OfflineAirPassengerSummary,
  OfflineAirTicketDraft,
} from './types'

export function airPassengerStableId(
  passenger: OfflineAirPassengerSummary,
  index: number,
): string {
  const demandTravelerId = text(passenger.demandTravelerId)
  if (demandTravelerId) return `demand-traveler:${demandTravelerId}`

  const employeeId = text(passenger.employeeId || passenger.id)
  if (employeeId) return `employee:${employeeId}`

  return `legacy:${index + 1}:${normalizeName(passenger.name) || 'passageiro'}`
}

/**
 * Reconciles persisted drafts with the current passenger order without using a
 * passenger name as the primary key. The name queue is only a compatibility
 * fallback for drafts saved before passenger identifiers were introduced.
 */
export function createAirTicketDrafts(
  passengers: readonly OfflineAirPassengerSummary[],
  current: readonly OfflineAirTicketDraft[] = [],
): OfflineAirTicketDraft[] {
  const used = new Set<number>()

  return passengers.map((passenger, passengerIndex) => {
    const passengerId = airPassengerStableId(passenger, passengerIndex)
    const demandTravelerId = text(passenger.demandTravelerId) || undefined
    const matchIndex = findUnused(current, used, (ticket) => ticket.passengerId === passengerId)
      ?? (demandTravelerId
        ? findUnused(current, used, (ticket) => ticket.demandTravelerId === demandTravelerId)
        : undefined)
      ?? findUnused(current, used, (ticket) => (
        normalizeName(ticket.passengerName) === normalizeName(passenger.name)
      ))
    const existing = matchIndex === undefined ? undefined : current[matchIndex]
    if (matchIndex !== undefined) used.add(matchIndex)

    return {
      passengerId,
      ...(demandTravelerId ? { demandTravelerId } : {}),
      passengerName: passenger.name,
      ticketNumber: existing?.ticketNumber || '',
    }
  })
}

export function updateAirTicketDraft(
  passengers: readonly OfflineAirPassengerSummary[],
  current: readonly OfflineAirTicketDraft[],
  passengerIndex: number,
  ticketNumber: string,
): OfflineAirTicketDraft[] {
  return createAirTicketDrafts(passengers, current).map((ticket, index) => (
    index === passengerIndex ? { ...ticket, ticketNumber } : ticket
  ))
}

function findUnused(
  tickets: readonly OfflineAirTicketDraft[],
  used: ReadonlySet<number>,
  predicate: (ticket: OfflineAirTicketDraft) => boolean,
): number | undefined {
  const index = tickets.findIndex((ticket, candidateIndex) => (
    !used.has(candidateIndex) && predicate(ticket)
  ))
  return index < 0 ? undefined : index
}

function normalizeName(value: string): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

import { getStorageEntries, setStorageEntries } from '@/lib/server-db'
import type { TravelQuote, TravelReservation } from '@/lib/integrations/types'

export const TRAVEL_QUOTES_KEY = 'bbt-tech-travel-quotes-v1'
export const TRAVEL_RESERVATIONS_KEY = 'bbt-tech-travel-reservations-v1'

export async function saveTravelQuote(quote: TravelQuote): Promise<TravelQuote> {
  const entries = await getStorageEntries()
  const current = Array.isArray(entries[TRAVEL_QUOTES_KEY]) ? (entries[TRAVEL_QUOTES_KEY] as TravelQuote[]) : []
  await setStorageEntries({ [TRAVEL_QUOTES_KEY]: upsertById(current, quote).slice(-500) })
  return quote
}

export async function getTravelQuote(id: string): Promise<TravelQuote | null> {
  const entries = await getStorageEntries()
  const current = Array.isArray(entries[TRAVEL_QUOTES_KEY]) ? (entries[TRAVEL_QUOTES_KEY] as TravelQuote[]) : []
  return current.find((item) => item.id === id) || null
}

export async function saveTravelReservation(reservation: TravelReservation): Promise<TravelReservation> {
  const entries = await getStorageEntries()
  const current = Array.isArray(entries[TRAVEL_RESERVATIONS_KEY]) ? (entries[TRAVEL_RESERVATIONS_KEY] as TravelReservation[]) : []
  await setStorageEntries({ [TRAVEL_RESERVATIONS_KEY]: upsertById(current, reservation).slice(-500) })
  return reservation
}

export async function getTravelReservation(id: string): Promise<TravelReservation | null> {
  const entries = await getStorageEntries()
  const current = Array.isArray(entries[TRAVEL_RESERVATIONS_KEY]) ? (entries[TRAVEL_RESERVATIONS_KEY] as TravelReservation[]) : []
  return current.find((item) => item.id === id) || null
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((current) => current.id === item.id)
  if (idx >= 0) {
    const next = list.slice()
    next[idx] = item
    return next
  }
  return [...list, item]
}

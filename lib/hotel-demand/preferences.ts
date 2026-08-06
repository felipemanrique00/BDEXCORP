import type { DetalhesHotel } from '@/types'

export const MAX_PREFERRED_HOTELS = 10

/**
 * Retorna a lista canonica de preferencias preservando a ordem informada.
 * `preferred_hotel_id` permanece como ponte de leitura para demandas antigas.
 */
export function hotelDemandPreferredHotelIds(
  details: Pick<DetalhesHotel, 'preferred_hotel_id' | 'preferred_hotel_ids'> | null | undefined,
): string[] {
  const candidates = details?.preferred_hotel_ids?.length
    ? details.preferred_hotel_ids
    : details?.preferred_hotel_id
      ? [details.preferred_hotel_id]
      : []
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    const id = String(candidate || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= MAX_PREFERRED_HOTELS) break
  }
  return result
}

export function preferredHotelPatch(ids: readonly string[]): Pick<
  DetalhesHotel,
  'preferred_hotel_id' | 'preferred_hotel_ids'
> {
  const normalized = hotelDemandPreferredHotelIds({ preferred_hotel_ids: [...ids] })
  return {
    preferred_hotel_ids: normalized.length ? normalized : undefined,
    preferred_hotel_id: normalized[0],
  }
}

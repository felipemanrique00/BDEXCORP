const DEMAND_FOCUS_QUERY_KEY = 'id'
const LEGACY_DEMAND_FOCUS_QUERY_KEY = 'focus'

export function demandFocusHref(demandId: string): string {
  return `/dashboard/demandas?${DEMAND_FOCUS_QUERY_KEY}=${encodeURIComponent(demandId.trim())}`
}

export function demandFocusIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search)
  return normalized(params.get(DEMAND_FOCUS_QUERY_KEY))
    || normalized(params.get(LEGACY_DEMAND_FOCUS_QUERY_KEY))
}

function normalized(value: string | null): string | null {
  const result = value?.trim() || ''
  return result || null
}

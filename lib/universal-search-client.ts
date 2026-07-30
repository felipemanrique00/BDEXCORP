import type {
  UniversalSearchKind,
  UniversalSearchResult,
} from '@/lib/universal-search-contract'

interface UniversalSearchClientOptions {
  signal?: AbortSignal
  limit?: number
  types?: UniversalSearchKind[]
}

export async function searchUniversalClient(
  query: string,
  options: UniversalSearchClientOptions = {},
): Promise<UniversalSearchResult> {
  const search = new URLSearchParams({
    q: query,
    limit: String(options.limit || 12),
  })
  if (options.types?.length) search.set('types', options.types.join(','))

  const response = await fetch(`/api/search?${search.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: options.signal,
  })
  const body = await response.json().catch(() => null) as (
    UniversalSearchResult & { error?: string }
  ) | null
  if (!response.ok || !body) {
    throw new Error(body?.error || 'Nao foi possivel concluir a busca.')
  }
  return body
}

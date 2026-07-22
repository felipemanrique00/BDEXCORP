import { getTechConfig, type TechConfig } from '@/lib/integrations/tech/tech-config'
import { assertTechPayloadOk, maskSensitive, TechIntegrationError } from '@/lib/integrations/tech/tech-errors'

export interface TechRequestOptions {
  method?: 'GET' | 'POST'
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  timeoutMs?: number
  requestId?: string
  skipPayloadAssertion?: boolean
}

export interface TechResponse<T = unknown> {
  data: T
  endpoint: string
  durationMs: number
}

export async function techRequest<T = unknown>(
  endpoint: string,
  options: TechRequestOptions = {},
  config: TechConfig = getTechConfig(),
): Promise<TechResponse<T>> {
  const method = options.method || (options.body ? 'POST' : 'GET')
  const url = buildUrl(config.baseUrl, endpoint, options.query)
  const controller = new AbortController()
  const startedAt = Date.now()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || config.timeoutMs)

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(options.requestId ? { 'X-BBT-Request-Id': options.requestId } : {}),
      },
      body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })

    const rawText = await response.text()
    const data = parseResponse(rawText)
    if (!response.ok) {
      throw new TechIntegrationError(`Tech Travel retornou HTTP ${response.status}.`, {
        status: response.status,
        code: 'TECH_HTTP_ERROR',
        details: { endpoint, request: maskSensitive(options.body), response: data || rawText },
      })
    }
    if (!options.skipPayloadAssertion) assertTechPayloadOk(data)
    return { data: data as T, endpoint: url, durationMs: Date.now() - startedAt }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new TechIntegrationError('Tempo limite excedido ao chamar a Tech Travel.', {
        status: 504,
        code: 'TECH_TIMEOUT',
        details: { endpoint, timeoutMs: options.timeoutMs || config.timeoutMs },
      })
    }
    if (error instanceof TechIntegrationError) throw error
    throw new TechIntegrationError(error?.message || 'Falha ao chamar a Tech Travel.', {
      code: 'TECH_FETCH_ERROR',
      details: { endpoint, request: maskSensitive(options.body) },
    })
  } finally {
    clearTimeout(timeout)
  }
}

function buildUrl(baseUrl: string, endpoint: string, query?: TechRequestOptions['query']): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const url = new URL(`${baseUrl}${cleanEndpoint}`)
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function parseResponse(rawText: string): unknown {
  if (!rawText) return null
  try {
    return JSON.parse(rawText)
  } catch {
    return rawText
  }
}

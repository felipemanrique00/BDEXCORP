export class GovernanceClientError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly status: number,
    public readonly requestId: string | null,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'GovernanceClientError'
  }
}

interface GovernancePayload {
  ok?: boolean
  code?: unknown
  error?: unknown
  requestId?: unknown
  details?: unknown
  [key: string]: unknown
}

export async function requestGovernanceJson<T extends GovernancePayload>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, {
      ...init,
      cache: init.cache || 'no-store',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
    })
    const payload = await readPayload(response)
    if (!response.ok || payload.ok !== true) {
      throw new GovernanceClientError(
        stringValue(payload.error) || 'Não foi possível concluir a operação.',
        stringValue(payload.code),
        response.status,
        stringValue(payload.requestId) || response.headers.get('X-Request-Id'),
        payload.details,
      )
    }
    return payload as T
  } catch (error) {
    if (error instanceof GovernanceClientError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new GovernanceClientError(
        'O servidor demorou para responder. Atualize a consulta antes de repetir uma ação.',
        'REQUEST_TIMEOUT',
        504,
        null,
      )
    }
    throw new GovernanceClientError(
      error instanceof Error ? error.message : 'Falha de comunicação com o servidor.',
      'NETWORK_ERROR',
      503,
      null,
    )
  } finally {
    clearTimeout(timeout)
  }
}

export function governanceJsonBody(body: unknown, headers: HeadersInit = {}): Pick<RequestInit, 'body' | 'headers'> {
  return {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  }
}

async function readPayload(response: Response): Promise<GovernancePayload> {
  try {
    const value: unknown = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as GovernancePayload
      : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

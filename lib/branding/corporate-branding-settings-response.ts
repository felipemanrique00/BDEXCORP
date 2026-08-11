import {
  corporateBrandingConfigurationSchema,
  type CorporateBrandingConfiguration,
} from '@/lib/corporate-branding'

interface ConfigurationResponsePayload {
  ok?: boolean
  configuration?: unknown
  error?: string
  requestId?: string
}

export async function readCorporateBrandingConfigurationResponse(
  response: Response,
  fallbackMessage: string,
): Promise<CorporateBrandingConfiguration> {
  const payload = await readJsonPayload(response)
  const payloadRequestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : ''
  const requestId = response.headers.get('x-request-id')?.trim() || payloadRequestId
  const apiError = typeof payload?.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : fallbackMessage

  if (!response.ok || !payload?.ok || !payload.configuration) {
    throw new Error(withResponseContext(apiError, response.status, requestId))
  }

  const configuration = corporateBrandingConfigurationSchema.safeParse(payload.configuration)
  if (!configuration.success) {
    throw new Error(withResponseContext(fallbackMessage, response.status, requestId))
  }
  return configuration.data
}

async function readJsonPayload(response: Response): Promise<ConfigurationResponsePayload | null> {
  const contentType = response.headers.get('content-type')?.toLowerCase() || ''
  if (!contentType.includes('application/json')) return null

  const payload = await response.json().catch(() => null)
  return isRecord(payload) ? payload : null
}

function withResponseContext(message: string, status: number, requestId: string): string {
  const context = [`HTTP ${status}`]
  if (requestId) context.push(`protocolo ${requestId}`)
  return `${message} (${context.join('; ')})`
}

function isRecord(value: unknown): value is ConfigurationResponsePayload {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

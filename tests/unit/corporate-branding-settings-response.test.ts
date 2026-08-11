import { describe, expect, it } from 'vitest'

import { readCorporateBrandingConfigurationResponse } from '@/lib/branding/corporate-branding-settings-response'

const configuration = {
  scopeType: 'company' as const,
  scopeId: 'company-a',
  declared: {
    displayName: null,
    logoFileId: null,
    logoAlt: null,
    primaryColor: null,
    accentColor: null,
    sidebarColor: null,
    documentLegalName: null,
    documentNumber: null,
  },
  effective: {
    scopeType: 'company' as const,
    scopeId: 'company-a',
    groupId: null,
    version: null,
    updatedAt: null,
    displayName: 'Empresa A',
    logoUrl: '/brand/bbt-logo-light.png',
    logoAlt: 'Empresa A',
    primaryColor: '#20265A',
    accentColor: '#21BFC5',
    sidebarColor: '#20265A',
    documentLegalName: 'Empresa A Ltda.',
    documentNumber: null,
    source: 'company' as const,
    sources: {
      displayName: 'company' as const,
      logoUrl: 'system' as const,
      logoAlt: 'company' as const,
      primaryColor: 'system' as const,
      accentColor: 'system' as const,
      sidebarColor: 'system' as const,
      documentLegalName: 'company' as const,
      documentNumber: 'company' as const,
    },
  },
  version: null,
  updatedAt: null,
}

describe('corporate branding settings response', () => {
  it('parses a valid JSON configuration', async () => {
    const response = jsonResponse({ ok: true, configuration })

    await expect(readCorporateBrandingConfigurationResponse(response, 'Falha ao carregar.'))
      .resolves.toEqual(configuration)
  })

  it('reports HTTP status and request id for a non-JSON response without exposing HTML', async () => {
    const response = new Response('<html><body>detalhe interno sensivel</body></html>', {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Request-Id': 'request-500',
      },
    })

    const error = await readError(response)

    expect(error.message).toBe('Falha ao carregar. (HTTP 500; protocolo request-500)')
    expect(error.message).not.toContain('detalhe interno sensivel')
    expect(error.message).not.toContain('<html>')
  })

  it('preserves a JSON API error and reads a request id from the payload', async () => {
    const response = jsonResponse(
      { ok: false, error: 'Permissao insuficiente.', requestId: 'request-403' },
      403,
    )

    await expect(readCorporateBrandingConfigurationResponse(response, 'Falha ao carregar.'))
      .rejects.toThrow('Permissao insuficiente. (HTTP 403; protocolo request-403)')
  })

  it('does not expose schema internals when a successful payload is malformed', async () => {
    const response = jsonResponse(
      { ok: true, configuration: { scopeType: 'company' } },
      200,
      { 'X-Request-Id': 'request-invalid' },
    )

    const error = await readError(response)

    expect(error.message).toBe('Falha ao carregar. (HTTP 200; protocolo request-invalid)')
    expect(error.message).not.toContain('Zod')
    expect(error.message).not.toContain('scopeId')
  })
})

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

async function readError(response: Response): Promise<Error> {
  try {
    await readCorporateBrandingConfigurationResponse(response, 'Falha ao carregar.')
    throw new Error('A resposta deveria ter falhado.')
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return error
  }
}

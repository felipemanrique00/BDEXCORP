import type { APIRequestContext } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateTotpSecret } from '@/lib/security/totp'
import { authenticateAdministrativeTestUser } from '@/tests/support/authenticate-admin'

const previousSecret = process.env.E2E_ADMIN_TOTP_SECRET
const previousRunId = process.env.E2E_RUN_ID

afterEach(() => {
  if (previousSecret === undefined) delete process.env.E2E_ADMIN_TOTP_SECRET
  else process.env.E2E_ADMIN_TOTP_SECRET = previousSecret
  if (previousRunId === undefined) delete process.env.E2E_RUN_ID
  else process.env.E2E_RUN_ID = previousRunId
  vi.useRealTimers()
})

describe('administrative E2E authentication', () => {
  it('serializes concurrent MFA uses and reserves distinct TOTP codes', async () => {
    process.env.E2E_ADMIN_TOTP_SECRET = generateTotpSecret()
    process.env.E2E_RUN_ID = `concurrent-${process.pid}-${Date.now()}`
    const verificationCodes: string[] = []
    let challenges = 0
    const request = {
      post: vi.fn(async (url: string, options: { data?: Record<string, unknown> }) => {
        if (url === '/api/auth/login') {
          challenges += 1
          return response(202, {
            code: 'MFA_REQUIRED',
            challengeToken: `challenge-${challenges}`,
          })
        }
        if (url === '/api/auth/mfa/verify') {
          verificationCodes.push(String(options.data?.code || ''))
          return response(200, { ok: true })
        }
        throw new Error(`Endpoint inesperado: ${url}`)
      }),
    } as unknown as APIRequestContext
    const credentials = {
      email: `admin-${process.pid}-${Date.now()}@example.invalid`,
      password: 'irrelevant-test-password',
      baseUrl: 'http://127.0.0.1:3000',
    }

    await Promise.all([
      authenticateAdministrativeTestUser(request, credentials),
      authenticateAdministrativeTestUser(request, credentials),
    ])

    expect(verificationCodes).toHaveLength(2)
    expect(new Set(verificationCodes).size).toBe(2)
  })

  it('requires the configured secret for an already enrolled account', async () => {
    delete process.env.E2E_ADMIN_TOTP_SECRET
    process.env.E2E_RUN_ID = `missing-secret-${process.pid}-${Date.now()}`
    const request = {
      post: vi.fn(async () => response(202, {
        code: 'MFA_REQUIRED',
        challengeToken: 'challenge-existing-account',
      })),
    } as unknown as APIRequestContext

    await expect(authenticateAdministrativeTestUser(request, {
      email: `enrolled-${process.pid}-${Date.now()}@example.invalid`,
      password: 'irrelevant-test-password',
      baseUrl: 'http://127.0.0.1:3000',
    })).rejects.toThrow('E2E_ADMIN_TOTP_SECRET e obrigatoria')
  })

  it('does not reuse the TOTP step state from a previous E2E execution', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T15:00:15.000Z'))
    process.env.E2E_ADMIN_TOTP_SECRET = generateTotpSecret()
    const verificationCodes: string[] = []
    let challenges = 0
    const request = {
      post: vi.fn(async (url: string, options: { data?: Record<string, unknown> }) => {
        if (url === '/api/auth/login') {
          challenges += 1
          return response(202, {
            code: 'MFA_REQUIRED',
            challengeToken: `rerun-challenge-${challenges}`,
          })
        }
        if (url === '/api/auth/mfa/verify') {
          verificationCodes.push(String(options.data?.code || ''))
          return response(200, { ok: true })
        }
        throw new Error(`Endpoint inesperado: ${url}`)
      }),
    } as unknown as APIRequestContext
    const credentials = {
      email: `rerun-${process.pid}@example.invalid`,
      password: 'irrelevant-test-password',
      baseUrl: 'http://127.0.0.1:3000',
    }

    process.env.E2E_RUN_ID = `first-run-${process.pid}`
    await authenticateAdministrativeTestUser(request, credentials)
    process.env.E2E_RUN_ID = `second-run-${process.pid}`
    await authenticateAdministrativeTestUser(request, credentials)

    expect(verificationCodes).toHaveLength(2)
    expect(verificationCodes[1]).toBe(verificationCodes[0])
  })
})

function response(status: number, body: Record<string, unknown>) {
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    json: async () => body,
  }
}

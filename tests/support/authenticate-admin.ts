import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { APIRequestContext } from '@playwright/test'

import { generateTotp } from '../../lib/security/totp'

const TOTP_PERIOD_MS = 30_000
const LOCK_POLL_MS = 100
const LOCK_TIMEOUT_MS = 90_000
const STALE_LOCK_MS = 120_000

export async function authenticateAdministrativeTestUser(
  request: APIRequestContext,
  credentials: { email: string; password: string; baseUrl: string },
): Promise<void> {
  const lock = await acquireAuthenticationLock(credentials)
  try {
    await authenticateWithLock(request, credentials, lock.statePath)
  } finally {
    await lock.release()
  }
}

async function authenticateWithLock(
  request: APIRequestContext,
  credentials: { email: string; password: string; baseUrl: string },
  statePath: string,
): Promise<void> {
  const headers = {
    origin: new URL(credentials.baseUrl).origin,
    referer: `${credentials.baseUrl.replace(/\/$/, '')}/login`,
  }
  const login = await request.post('/api/auth/login', {
    data: {
      email: credentials.email,
      password: credentials.password,
    },
    headers,
  })
  if (login.status() === 200) return

  const loginBody = await responseBody(login)
  if (
    login.status() !== 202 ||
    !['MFA_ENROLLMENT_REQUIRED', 'MFA_REQUIRED'].includes(text(loginBody.code)) ||
    !text(loginBody.challengeToken)
  ) {
    throw new Error(`Login administrativo E2E falhou com HTTP ${login.status()}: ${text(loginBody.code) || 'sem codigo'}.`)
  }

  const challengeToken = text(loginBody.challengeToken)
  const configuredSecret = String(process.env.E2E_ADMIN_TOTP_SECRET || '').trim()
  let secret = configuredSecret
  if (text(loginBody.code) === 'MFA_ENROLLMENT_REQUIRED') {
    if (configuredSecret) {
      throw new Error(
        'A conta E2E nao foi inscrita com E2E_ADMIN_TOTP_SECRET. Execute o setup seguro do ambiente antes dos testes.',
      )
    }
    const enrollment = await request.post('/api/auth/mfa/enroll', {
      data: { challengeToken },
      headers,
    })
    const enrollmentBody = await responseBody(enrollment)
    if (!enrollment.ok() || !text(enrollmentBody.secret)) {
      throw new Error(`Inscricao MFA E2E falhou com HTTP ${enrollment.status()}.`)
    }
    secret = text(enrollmentBody.secret)
  }
  if (!secret) {
    throw new Error(
      'A conta E2E ja possui MFA. E2E_ADMIN_TOTP_SECRET e obrigatoria para autenticar de forma deterministica.',
    )
  }

  let step = await nextAvailableTotpStep(statePath)
  let verification = await verifyMfaStep(request, headers, challengeToken, secret, step)
  let verificationBody = await responseBody(verification)
  if (!verification.ok() && text(verificationBody.code) === 'MFA_CODE_INVALID') {
    await waitUntilCurrentStep(step)
    step += 1
    verification = await verifyMfaStep(request, headers, challengeToken, secret, step)
    verificationBody = await responseBody(verification)
  }
  if (!verification.ok()) {
    throw new Error(
      `Verificacao MFA E2E falhou com HTTP ${verification.status()}: ` +
      `${text(verificationBody.code) || 'sem codigo'}.`,
    )
  }
  await writeFile(statePath, String(step), 'utf8')
}

async function responseBody(response: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function verifyMfaStep(
  request: APIRequestContext,
  headers: Record<string, string>,
  challengeToken: string,
  secret: string,
  step: number,
) {
  return request.post('/api/auth/mfa/verify', {
    data: {
      challengeToken,
      code: generateTotp(secret, { timestampMs: step * TOTP_PERIOD_MS }),
    },
    headers,
  })
}

async function nextAvailableTotpStep(statePath: string): Promise<number> {
  const previousStep = Number(await readFile(statePath, 'utf8').catch(() => ''))
  const lastStep = Number.isSafeInteger(previousStep) && previousStep >= 0 ? previousStep : -1
  let currentStep = Math.floor(Date.now() / TOTP_PERIOD_MS)
  const targetStep = Math.max(currentStep, lastStep + 1)
  if (targetStep > currentStep + 1) {
    await waitUntilCurrentStep(targetStep - 1)
    currentStep = Math.floor(Date.now() / TOTP_PERIOD_MS)
  }
  return Math.max(currentStep, lastStep + 1)
}

async function waitUntilCurrentStep(targetStep: number): Promise<void> {
  const waitMs = Math.max(0, targetStep * TOTP_PERIOD_MS - Date.now() + 100)
  if (waitMs > TOTP_PERIOD_MS + 500) {
    throw new Error('Estado TOTP E2E invalido: passo reservado esta distante do relogio atual.')
  }
  if (waitMs > 0) await delay(waitMs)
}

async function acquireAuthenticationLock(
  credentials: { email: string; baseUrl: string },
): Promise<{ statePath: string; release(): Promise<void> }> {
  const executionId = String(process.env.E2E_RUN_ID || '').trim() || `local-parent-${process.ppid}`
  const executionNamespace = createHash('sha256').update(executionId).digest('hex').slice(0, 24)
  const directory = path.join(tmpdir(), 'bbt-e2e-auth', executionNamespace)
  await mkdir(directory, { recursive: true })
  const key = createHash('sha256')
    .update(`${credentials.baseUrl.replace(/\/$/, '')}\0${credentials.email.trim().toLowerCase()}`)
    .digest('hex')
  const lockPath = path.join(directory, `${key}.lock`)
  const statePath = path.join(directory, `${key}.step`)
  const startedAt = Date.now()

  while (true) {
    try {
      const handle = await open(lockPath, 'wx')
      return {
        statePath,
        async release() {
          await handle.close()
          await rm(lockPath, { force: true })
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const details = await stat(lockPath).catch(() => null)
      if (details && Date.now() - details.mtimeMs > STALE_LOCK_MS) {
        await rm(lockPath, { force: true })
        continue
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error('Tempo esgotado aguardando autenticacao administrativa E2E.')
      }
      await delay(LOCK_POLL_MS)
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

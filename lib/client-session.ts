'use client'

import type { User } from '@/types'
import type { ImpersonationActorSession, ImpersonationRepresentation } from '@/lib/impersonation-client'

export interface ServerSessionState {
  user: User | null
  requireSession: boolean
  reachable: boolean
  actor: ImpersonationActorSession | null
  representation: ImpersonationRepresentation | null
  canStartRepresentation: boolean
}

export interface ServerLoginResult {
  user: User | null
  reachable: boolean
  error?: string
  code?: string
  mfa?: {
    mode: 'verify' | 'enroll'
    challengeToken: string
    expiresAt: string
  }
  recoveryCodes?: string[]
}

export interface MfaEnrollmentResult {
  ok: boolean
  reachable: boolean
  secret?: string
  provisioningUri?: string
  expiresAt?: string
  error?: string
}

const UNAVAILABLE_SESSION: ServerSessionState = {
  user: null,
  requireSession: true,
  reachable: false,
  actor: null,
  representation: null,
  canStartRepresentation: false,
}

export async function fetchServerSession(): Promise<ServerSessionState> {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' })
    if (!response.ok) return UNAVAILABLE_SESSION

    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload.requireSession !== 'boolean') return UNAVAILABLE_SESSION

    return {
      user: payload.user || null,
      requireSession: payload.requireSession,
      reachable: true,
      actor: payload.actor || null,
      representation: payload.representation || null,
      canStartRepresentation: payload.canStartRepresentation === true,
    }
  } catch {
    return UNAVAILABLE_SESSION
  }
}

export async function authenticateWithServer(email: string, password: string, tenant?: string): Promise<ServerLoginResult> {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, tenant: tenant?.trim().toLowerCase() || undefined }),
    })
    const payload = await response.json().catch(() => null)
    if (
      response.status === 202 &&
      (payload?.code === 'MFA_REQUIRED' || payload?.code === 'MFA_ENROLLMENT_REQUIRED') &&
      typeof payload?.challengeToken === 'string'
    ) {
      return {
        user: null,
        reachable: true,
        error: typeof payload.error === 'string' ? payload.error : undefined,
        code: payload.code,
        mfa: {
          mode: payload.code === 'MFA_ENROLLMENT_REQUIRED' ? 'enroll' : 'verify',
          challengeToken: payload.challengeToken,
          expiresAt: typeof payload.challengeExpiresAt === 'string' ? payload.challengeExpiresAt : '',
        },
      }
    }
    if (!response.ok || !payload?.user) {
      return {
        user: null,
        reachable: true,
        error: typeof payload?.error === 'string' ? payload.error : undefined,
        code: typeof payload?.code === 'string' ? payload.code : undefined,
      }
    }
    return { user: payload.user as User, reachable: true }
  } catch {
    return { user: null, reachable: false }
  }
}

export async function startMfaEnrollmentWithServer(challengeToken: string): Promise<MfaEnrollmentResult> {
  try {
    const response = await fetch('/api/auth/mfa/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.secret || !payload?.provisioningUri) {
      return {
        ok: false,
        reachable: true,
        error: typeof payload?.error === 'string' ? payload.error : 'Nao foi possivel iniciar o autenticador.',
      }
    }
    return {
      ok: true,
      reachable: true,
      secret: payload.secret,
      provisioningUri: payload.provisioningUri,
      expiresAt: payload.expiresAt,
    }
  } catch {
    return { ok: false, reachable: false, error: 'Servico de autenticacao indisponivel.' }
  }
}

export async function verifyMfaWithServer(
  challengeToken: string,
  code: string,
): Promise<ServerLoginResult> {
  try {
    const response = await fetch('/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, code }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.user) {
      return {
        user: null,
        reachable: true,
        error: typeof payload?.error === 'string' ? payload.error : undefined,
        code: typeof payload?.code === 'string' ? payload.code : undefined,
      }
    }
    return {
      user: payload.user as User,
      reachable: true,
      recoveryCodes: Array.isArray(payload.recoveryCodes)
        ? payload.recoveryCodes.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
    }
  } catch {
    return { user: null, reachable: false }
  }
}

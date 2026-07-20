'use client'

import type { User } from '@/types'

export interface ServerSessionState {
  user: User | null
  requireSession: boolean
  reachable: boolean
}

export interface ServerLoginResult {
  user: User | null
  reachable: boolean
  error?: string
}

const UNAVAILABLE_SESSION: ServerSessionState = {
  user: null,
  requireSession: true,
  reachable: false,
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
    }
  } catch {
    return UNAVAILABLE_SESSION
  }
}

export async function authenticateWithServer(email: string, password: string): Promise<ServerLoginResult> {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.user) {
      return {
        user: null,
        reachable: true,
        error: typeof payload?.error === 'string' ? payload.error : undefined,
      }
    }
    return { user: payload.user as User, reachable: true }
  } catch {
    return { user: null, reachable: false }
  }
}

import 'server-only'

import { createHmac, randomBytes } from 'node:crypto'

import { getServerEnvironment } from '@/lib/server/environment'

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashSecureToken(token: string, purpose: string): string {
  const secret = getServerEnvironment().AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET obrigatorio para tokens seguros.')
  return createHmac('sha256', secret).update(`${purpose}\0${token}`).digest('hex')
}

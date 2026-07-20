import { NextResponse } from 'next/server'

import { SUPER_MASTER, getServerSuperMasterPassword } from '@/lib/auth-constants'
import { getStorageEntries, setStorageEntries } from '@/lib/server-db'
import { guardApiRequest } from '@/lib/security/api-guard'
import { isPasswordHash, verifyPassword } from '@/lib/security/password'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { sessionCookieName, sessionMaxAgeSeconds, signSession } from '@/lib/server-auth'
import type { User } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ContaLocal {
  user: User
  password: string
}

export async function POST(request: Request) {
  const guard = guardApiRequest(request, {
    requireAuth: false,
    rateLimit: { key: 'auth-login:post', limit: 10, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const body = await readJsonBody<{ email?: unknown; password?: unknown }>(request, 16 * 1024)
    const email = String(body?.email || '').trim().toLowerCase()
    const password = String(body?.password || '')

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: 'Informe e-mail e senha.' }, { status: 400 })
    }

    const user = await autenticar(email, password)
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Credenciais invalidas.' }, { status: 401 })
    }

    const response = NextResponse.json({ ok: true, user })
    const protocol = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '')
    response.cookies.set(sessionCookieName(), signSession(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: protocol === 'https',
      maxAge: sessionMaxAgeSeconds(),
      path: '/',
    })
    return response
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) {
      return NextResponse.json({ ok: false, error: bodyError.message }, { status: bodyError.status })
    }
    console.error('[auth:login]', error)
    return NextResponse.json({ ok: false, error: 'Falha no login.' }, { status: 500 })
  }
}

async function autenticar(email: string, password: string): Promise<User | null> {
  const superPassword = getServerSuperMasterPassword()
  if (email === SUPER_MASTER.email.toLowerCase() && superPassword && password === superPassword) {
    return { ...SUPER_MASTER }
  }

  const entries = await getStorageEntries()
  const contas = Array.isArray(entries['bbt-users-v4']) ? entries['bbt-users-v4'] as ContaLocal[] : []
  const conta = contas.find(
    (item) => item?.user?.email?.toLowerCase() === email && item.user.ativo !== false,
  )

  if (!conta || !(await verifyPassword(password, conta.password))) return null
  if (!isPasswordHash(conta.password)) await setStorageEntries({ 'bbt-users-v4': contas })

  return conta.user
}

import { NextResponse } from 'next/server'

import { SUPER_MASTER } from '@/lib/auth-constants'
import { getStorageEntries, setStorageEntries } from '@/lib/server-db'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { empresasPermitidasParaUsuario } from '@/lib/grupos'
import type { SolicitanteEmpresa, User, UserRole } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ContaLocal {
  user: User
  password: string
}

const USERS_KEY = 'bbt-users-v4'
const SOLICITANTES_KEY = 'bbt-solicitantes-empresa'

export async function POST(request: Request) {
  const guard = guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'solicitantes-empresa:post', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<any>(request, 256 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = input.body
    const payload = normalizeSolicitantePayload(body?.solicitante || body)
    const editingId = String(body?.id || body?.editingId || '').trim()
    const criarAcesso = Boolean(body?.criarAcesso)
    const password = String(body?.password || '')

    if (!payload.company_id) return NextResponse.json({ ok: false, error: 'Empresa obrigatoria.' }, { status: 400 })
    if (!payload.nome) return NextResponse.json({ ok: false, error: 'Nome obrigatorio.' }, { status: 400 })
    if (!payload.email || !/.+@.+\..+/.test(payload.email)) {
      return NextResponse.json({ ok: false, error: 'E-mail invalido.' }, { status: 400 })
    }

    const entries = await getStorageEntries()
    if (!canManageCompanyAccess(guard.user, payload.company_id, entries)) {
      return NextResponse.json({ ok: false, error: 'Permissao insuficiente para esta empresa.' }, { status: 403 })
    }
    const users = Array.isArray(entries[USERS_KEY]) ? (entries[USERS_KEY] as ContaLocal[]) : []
    const solicitantes = Array.isArray(entries[SOLICITANTES_KEY]) ? (entries[SOLICITANTES_KEY] as SolicitanteEmpresa[]) : []

    let userId = payload.user_id || null
    if (criarAcesso) {
      const userResult = upsertPortalUser({
        users,
        payload,
        password,
        currentUserId: userId,
        forcePassword: !editingId && !userId,
      })
      if (!userResult.ok) return NextResponse.json({ ok: false, error: userResult.error }, { status: 400 })
      userId = userResult.user!.id
    }

    const now = new Date().toISOString()
    const existingIndex = editingId
      ? solicitantes.findIndex((item) => item.id === editingId)
      : solicitantes.findIndex((item) => item.company_id === payload.company_id && item.email.toLowerCase() === payload.email.toLowerCase())

    const saved: SolicitanteEmpresa = {
      ...(existingIndex >= 0 ? solicitantes[existingIndex] : {}),
      ...payload,
      user_id: userId,
      id: existingIndex >= 0 ? solicitantes[existingIndex].id : `sol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      created_at: existingIndex >= 0 ? solicitantes[existingIndex].created_at : now,
      updated_at: now,
    }

    if (existingIndex >= 0) solicitantes[existingIndex] = saved
    else solicitantes.push(saved)

    await setStorageEntries({
      [USERS_KEY]: users,
      [SOLICITANTES_KEY]: solicitantes,
    })

    return NextResponse.json({
      ok: true,
      solicitante: saved,
      solicitantes: solicitantes.filter((item) => item.company_id === payload.company_id),
    })
  } catch (error) {
    console.error('[solicitantes:empresa]', error)
    return NextResponse.json({ ok: false, error: 'Falha ao salvar solicitante.' }, { status: 500 })
  }
}

function normalizeSolicitantePayload(input: any): Omit<SolicitanteEmpresa, 'id' | 'created_at' | 'updated_at'> {
  return {
    company_id: String(input?.company_id || '').trim(),
    user_id: input?.user_id || null,
    funcionario_id: input?.funcionario_id || null,
    nome: String(input?.nome || '').trim(),
    email: String(input?.email || '').trim().toLowerCase(),
    telefone: String(input?.telefone || '').trim(),
    cargo: String(input?.cargo || '').trim(),
    departamento: String(input?.departamento || '').trim(),
    centro_custo: String(input?.centro_custo || '').trim(),
    status: input?.status === 'bloqueado' || input?.status === 'pendente' ? input.status : 'ativo',
    pode_criar_demanda: input?.pode_criar_demanda !== false,
    pode_ver_vouchers: input?.pode_ver_vouchers !== false,
    pode_ver_financeiro: Boolean(input?.pode_ver_financeiro),
    limite_por_solicitacao: Number(input?.limite_por_solicitacao || 0),
    observacoes: input?.observacoes ? String(input.observacoes) : undefined,
  }
}

function canManageCompanyAccess(user: User | null, companyId: string, entries: Record<string, unknown>): boolean {
  if (!user) return false
  const persisted = entries['bbt-data-v4'] as any
  const state = persisted?.state || persisted || {}
  const empresas = Array.isArray(state.empresas) ? state.empresas : []
  const grupos = Array.isArray(state.gruposEmpresariais) ? state.gruposEmpresariais : []
  if (user.role === 'company_admin' && user.company_id !== companyId) return false
  return empresasPermitidasParaUsuario(user, empresas, grupos).some((empresa) => empresa.id === companyId)
}

function upsertPortalUser(args: {
  users: ContaLocal[]
  payload: Omit<SolicitanteEmpresa, 'id' | 'created_at' | 'updated_at'>
  password: string
  currentUserId?: string | null
  forcePassword: boolean
}): { ok: boolean; user?: User; error?: string } {
  const { users, payload, password, currentUserId, forcePassword } = args
  const email = payload.email.toLowerCase()
  if (password && password.length < 8) {
    return { ok: false, error: 'A senha deve ter pelo menos 8 caracteres.' }
  }
  if (email === SUPER_MASTER.email.toLowerCase()) return { ok: false, error: 'E-mail reservado ao super master.' }
  const existingIndex = users.findIndex((item) => item.user.id === currentUserId || item.user.email.toLowerCase() === email)

  if (existingIndex >= 0) {
    const current = users[existingIndex]
    users[existingIndex] = {
      user: {
        ...current.user,
        name: payload.nome,
        email,
        role: normalizePortalRole(current.user.role),
        company_id: payload.company_id,
        ativo: payload.status !== 'bloqueado',
      },
      password: password && password.length >= 8 ? password : current.password,
    }
    return { ok: true, user: users[existingIndex].user }
  }

  if (forcePassword && password.length < 8) {
    return { ok: false, error: 'Senha de pelo menos 8 caracteres obrigatoria para criar login.' }
  }

  const user: User = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    email,
    name: payload.nome,
    role: 'colaborador',
    company_id: payload.company_id,
    ativo: payload.status !== 'bloqueado',
    created_at: new Date().toISOString(),
  }
  users.push({ user, password })
  return { ok: true, user }
}

function normalizePortalRole(role: UserRole): UserRole {
  return role === 'master' ? 'colaborador' : role
}

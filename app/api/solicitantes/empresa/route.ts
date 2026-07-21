import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { getStorageEntries, setStorageEntries } from '@/lib/server-db'
import { guardApiRequest, hasServerPermission } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { empresasPermitidasParaUsuario } from '@/lib/grupos'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  createTenantUser,
  getTenantUser,
  updateTenantUser,
  UserConflictError,
} from '@/lib/server/user-service'
import type { SolicitanteEmpresa, User } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOLICITANTES_KEY = 'bbt-solicitantes-empresa'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
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
    const solicitantes = Array.isArray(entries[SOLICITANTES_KEY]) ? (entries[SOLICITANTES_KEY] as SolicitanteEmpresa[]) : []

    let userId = payload.user_id || null
    if (criarAcesso) {
      if (!hasServerPermission(guard.user, 'gerenciar_usuarios')) {
        return NextResponse.json({ ok: false, error: 'Permissao para gerenciar usuarios obrigatoria.' }, { status: 403 })
      }
      if (password.length < 12) {
        return NextResponse.json({ ok: false, error: 'A senha deve ter pelo menos 12 caracteres.' }, { status: 400 })
      }

      const existingUser = userId ? await getTenantUser(guard.principal!, userId) : null
      const portalUser = existingUser
        ? await updateTenantUser(guard.principal!, existingUser.id, {
            email: payload.email,
            name: payload.nome,
            password,
            role: 'colaborador',
            companyId: payload.company_id,
            active: payload.status !== 'bloqueado',
          })
        : await createTenantUser(guard.principal!, {
            email: payload.email,
            name: payload.nome,
            password,
            role: 'colaborador',
            companyId: payload.company_id,
            active: payload.status !== 'bloqueado',
          })
      userId = portalUser.id
    }

    const now = new Date().toISOString()
    const existingIndex = editingId
      ? solicitantes.findIndex((item) => item.id === editingId)
      : solicitantes.findIndex((item) => item.company_id === payload.company_id && item.email.toLowerCase() === payload.email.toLowerCase())

    const saved: SolicitanteEmpresa = {
      ...(existingIndex >= 0 ? solicitantes[existingIndex] : {}),
      ...payload,
      user_id: userId,
      id: existingIndex >= 0 ? solicitantes[existingIndex].id : `sol_${randomUUID()}`,
      created_at: existingIndex >= 0 ? solicitantes[existingIndex].created_at : now,
      updated_at: now,
    }

    if (existingIndex >= 0) solicitantes[existingIndex] = saved
    else solicitantes.push(saved)

    await setStorageEntries({ [SOLICITANTES_KEY]: solicitantes })

    await writeAuditEvent({
      action: existingIndex >= 0 ? 'requester.update' : 'requester.create',
      result: 'success',
      entityType: 'requester',
      entityId: saved.id,
      metadata: { companyId: saved.company_id, portalAccess: criarAcesso, userId },
    })

    return NextResponse.json({
      ok: true,
      solicitante: saved,
      solicitantes: solicitantes.filter((item) => item.company_id === payload.company_id),
    })
  } catch (error) {
    if (error instanceof UserConflictError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    }
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

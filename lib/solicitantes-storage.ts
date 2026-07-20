'use client'

import type { SolicitanteEmpresa } from '@/types'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'

const STORAGE_KEY = 'bbt-solicitantes-empresa'

function nowIso(): string {
  return new Date().toISOString()
}

function novoId(): string {
  return `sol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function load(): SolicitanteEmpresa[] {
  if (typeof window === 'undefined') return []
  return loadJSON<SolicitanteEmpresa[]>(STORAGE_KEY, [])
}

function save(list: SolicitanteEmpresa[]): boolean {
  return safeSetJSON(STORAGE_KEY, list.slice(-10000))
}

function emailNorm(email: string): string {
  return String(email || '').trim().toLowerCase()
}

export function getAllSolicitantesEmpresa(): SolicitanteEmpresa[] {
  return load().sort((a, b) => a.nome.localeCompare(b.nome))
}

export function getSolicitantesPorEmpresa(companyId: string): SolicitanteEmpresa[] {
  return getAllSolicitantesEmpresa().filter((s) => s.company_id === companyId)
}

export function getSolicitanteById(id: string): SolicitanteEmpresa | undefined {
  return load().find((s) => s.id === id)
}

export function getSolicitantePorEmail(companyId: string, email: string): SolicitanteEmpresa | undefined {
  const norm = emailNorm(email)
  return load().find((s) => s.company_id === companyId && emailNorm(s.email) === norm)
}

export function addSolicitanteEmpresa(
  data: Omit<SolicitanteEmpresa, 'id' | 'created_at' | 'updated_at'>,
): SolicitanteEmpresa | null {
  if (!data.company_id) {
    if (typeof console !== 'undefined') console.warn('[solicitantes] company_id obrigatório')
    return null
  }
  if (!data.nome) {
    if (typeof console !== 'undefined') console.warn('[solicitantes] nome obrigatório')
    return null
  }
  if (!data.email) {
    if (typeof console !== 'undefined') console.warn('[solicitantes] email obrigatório')
    return null
  }
  const list = load()
  const norm = emailNorm(data.email)
  const existingIndex = list.findIndex((s) => s.company_id === data.company_id && emailNorm(s.email) === norm)
  const payload: SolicitanteEmpresa = {
    ...data,
    email: norm,
    id: existingIndex >= 0 ? list[existingIndex].id : novoId(),
    status: data.status || 'ativo',
    pode_criar_demanda: data.pode_criar_demanda !== false,
    pode_ver_vouchers: data.pode_ver_vouchers !== false,
    pode_ver_financeiro: Boolean(data.pode_ver_financeiro),
    created_at: existingIndex >= 0 ? list[existingIndex].created_at : nowIso(),
    updated_at: existingIndex >= 0 ? nowIso() : undefined,
  }
  if (existingIndex >= 0) list[existingIndex] = { ...list[existingIndex], ...payload }
  else list.push(payload)

  // V15: usar try direto pra detectar falha real e logar
  try {
    const ok = save(list)
    if (!ok && typeof console !== 'undefined') {
      console.warn('[solicitantes] safeSetJSON retornou false — tentando salvar direto no localStorage como fallback.')
      // Fallback bruto: localStorage direto sem queue remoto
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
          if (typeof console !== 'undefined') console.info('[solicitantes] Fallback localStorage OK.')
        } catch (e) {
          if (typeof console !== 'undefined') console.error('[solicitantes] Fallback localStorage tambem falhou:', e)
          return null
        }
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.error('[solicitantes] Erro inesperado salvando:', e)
    return null
  }
  return payload
}

export function updateSolicitanteEmpresa(id: string, patch: Partial<SolicitanteEmpresa>): SolicitanteEmpresa | null {
  const list = load()
  const idx = list.findIndex((s) => s.id === id)
  if (idx < 0) return null
  list[idx] = {
    ...list[idx],
    ...patch,
    email: patch.email ? emailNorm(patch.email) : list[idx].email,
    updated_at: nowIso(),
  }
  save(list)
  return list[idx]
}

export function removerSolicitanteEmpresa(id: string): boolean {
  return save(load().filter((s) => s.id !== id))
}

export function bloquearSolicitanteEmpresa(id: string): SolicitanteEmpresa | null {
  return updateSolicitanteEmpresa(id, { status: 'bloqueado' })
}

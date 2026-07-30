'use client'

import type { SolicitanteEmpresa } from '@/types'
import { applyDomainApiValueLocally, loadJSON } from '@/lib/storage-quota'

const STORAGE_KEY = 'bbt-solicitantes-empresa'

function load(): SolicitanteEmpresa[] {
  if (typeof window === 'undefined') return []
  return loadJSON<SolicitanteEmpresa[]>(STORAGE_KEY, [])
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

export function aplicarSolicitantesEmpresaDoServidor(
  companyId: string,
  solicitantes: SolicitanteEmpresa[],
): boolean {
  const otherCompanies = load().filter((item) => item.company_id !== companyId)
  const companyItems = solicitantes
    .filter((item) => item.company_id === companyId)
    .sort((a, b) => a.nome.localeCompare(b.nome))
  return applyDomainApiValueLocally(STORAGE_KEY, [...otherCompanies, ...companyItems])
}

import type { Empresa, GrupoEmpresarial, User } from '@/types'
import { createEntityId } from '@/lib/ids'

export type EscopoGrupoUsuario = {
  podeAcessar: boolean
  podeVerConsolidado: boolean
  empresaIdsPermitidas: string[]
}

export function normalizarListaIds(ids?: Array<string | null | undefined>): string[] {
  return Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)))
}

export function gerarIdGrupoEmpresarial(): string {
  return createEntityId('grp')
}

export function getEmpresaGrupoId(empresa: Empresa, grupos: GrupoEmpresarial[]): string | null {
  if (empresa.grupo_id && grupos.some((grupo) => grupo.id === empresa.grupo_id)) return empresa.grupo_id
  const porLista = grupos.find((grupo) => grupo.empresa_ids.includes(empresa.id))
  return porLista?.id || null
}

export function getEmpresasDoGrupo(
  grupoId: string,
  empresas: Empresa[],
  grupos: GrupoEmpresarial[],
): Empresa[] {
  const grupo = grupos.find((item) => item.id === grupoId)
  if (!grupo) return []
  const ids = new Set(normalizarListaIds([...grupo.empresa_ids, ...empresas.filter((empresa) => empresa.grupo_id === grupoId).map((empresa) => empresa.id)]))
  return empresas.filter((empresa) => ids.has(empresa.id))
}

export function sincronizarGruposComEmpresas(
  grupos: GrupoEmpresarial[],
  empresas: Empresa[],
): GrupoEmpresarial[] {
  const empresaIds = new Set(empresas.map((empresa) => empresa.id))
  const gruposValidos = grupos.map((grupo) => ({
    ...grupo,
    empresa_ids: normalizarListaIds(grupo.empresa_ids).filter((id) => empresaIds.has(id)),
  }))

  const porId = new Map(gruposValidos.map((grupo) => [grupo.id, grupo]))
  empresas.forEach((empresa) => {
    if (!empresa.grupo_id) return
    const grupo = porId.get(empresa.grupo_id)
    if (!grupo) return
    grupo.empresa_ids = normalizarListaIds([...grupo.empresa_ids, empresa.id])
  })

  return gruposValidos
}

export function aplicarVinculoEmpresaGrupo(
  grupos: GrupoEmpresarial[],
  empresaId: string,
  grupoId?: string | null,
): GrupoEmpresarial[] {
  const target = String(grupoId || '').trim()
  return grupos.map((grupo) => {
    const semEmpresa = grupo.empresa_ids.filter((id) => id !== empresaId)
    const empresa_ids = grupo.id === target ? normalizarListaIds([...semEmpresa, empresaId]) : semEmpresa
    return {
      ...grupo,
      empresa_ids,
      updated_at: grupo.id === target || grupo.empresa_ids.length !== semEmpresa.length ? new Date().toISOString() : grupo.updated_at,
    }
  })
}

export function hasScopedAccess(user: User | null): boolean {
  if (!user) return false
  return normalizarListaIds(user.empresa_ids).length > 0 || normalizarListaIds(user.grupo_ids).length > 0 || Boolean(user.company_id)
}

export function empresasPermitidasParaUsuario(
  user: User | null,
  empresas: Empresa[],
  grupos: GrupoEmpresarial[],
): Empresa[] {
  if (!user) return []
  if (user.role === 'master' && !hasScopedAccess(user)) return empresas

  const permitidas = new Set<string>()
  if (user.company_id) permitidas.add(user.company_id)
  normalizarListaIds(user.empresa_ids).forEach((id) => permitidas.add(id))

  const grupoIds = new Set(normalizarListaIds(user.grupo_ids))
  grupos.forEach((grupo) => {
    if (!grupoIds.has(grupo.id)) return
    grupo.empresa_ids.forEach((empresaId) => permitidas.add(empresaId))
  })

  empresas.forEach((empresa) => {
    if (empresa.grupo_id && grupoIds.has(empresa.grupo_id)) permitidas.add(empresa.id)
  })

  return empresas.filter((empresa) => permitidas.has(empresa.id))
}

export function usuarioPodeAcessarEmpresa(
  user: User | null,
  empresaId: string | null | undefined,
  empresas: Empresa[],
  grupos: GrupoEmpresarial[],
): boolean {
  if (!empresaId) return false
  return empresasPermitidasParaUsuario(user, empresas, grupos).some((empresa) => empresa.id === empresaId)
}

export function usuarioPodeAcessarGrupo(
  user: User | null,
  grupo: GrupoEmpresarial | null | undefined,
): boolean {
  if (!user || !grupo) return false
  if (user.role === 'master' && !hasScopedAccess(user)) return true
  if (normalizarListaIds(user.grupo_ids).includes(grupo.id)) return true
  if (user.company_id && grupo.empresa_ids.includes(user.company_id)) return true
  return normalizarListaIds(user.empresa_ids).some((empresaId) => grupo.empresa_ids.includes(empresaId))
}

export function resolverEscopoGrupoUsuario(
  user: User | null,
  grupo: GrupoEmpresarial | null | undefined,
  empresas: Empresa[],
): EscopoGrupoUsuario {
  if (!user || !grupo) return { podeAcessar: false, podeVerConsolidado: false, empresaIdsPermitidas: [] }

  const empresasGrupo = empresas
    .filter((empresa) => empresa.grupo_id === grupo.id || grupo.empresa_ids.includes(empresa.id))
    .map((empresa) => empresa.id)
  const grupoIds = normalizarListaIds(user.grupo_ids)

  if (user.role === 'master' && !hasScopedAccess(user)) {
    return { podeAcessar: true, podeVerConsolidado: true, empresaIdsPermitidas: empresasGrupo }
  }

  if (grupoIds.includes(grupo.id)) {
    return { podeAcessar: true, podeVerConsolidado: true, empresaIdsPermitidas: empresasGrupo }
  }

  const diretas = new Set(normalizarListaIds(user.empresa_ids))
  if (user.company_id) diretas.add(user.company_id)
  const empresaIdsPermitidas = empresasGrupo.filter((empresaId) => diretas.has(empresaId))
  return {
    podeAcessar: empresaIdsPermitidas.length > 0,
    podeVerConsolidado: false,
    empresaIdsPermitidas,
  }
}

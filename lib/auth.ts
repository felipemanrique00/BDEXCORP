import type { Empresa, GrupoEmpresarial, User, UserRole, PerfilBBT, Permissoes } from '@/types'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import {
  empresasPermitidasParaUsuario,
  hasScopedAccess,
  usuarioPodeAcessarEmpresa,
  usuarioPodeAcessarGrupo,
} from '@/lib/grupos'
import {
  clearLocalSharedStorageForSessionChange,
  flushPendingRemoteStorage,
} from '@/lib/storage-quota'
import {
  clearCachedUserDirectory,
  getCachedUserDirectory,
} from '@/lib/user-directory-client'

const SESSION_USER_KEY = 'bbt-session-user-v1'
let currentUserCache: User | null | undefined

export function getAllUsers(): User[] {
  return getCachedUserDirectory()
}

export function getAgentesBBT(): User[] {
  return getAllUsers().filter((user) => user.role === 'master' && user.perfil_bbt && user.ativo !== false)
}

export function getUserById(id: string): User | undefined {
  return getAllUsers().find((user) => user.id === id)
}

export async function logout(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!(await flushPendingRemoteStorage())) return false

  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) return false
    clearCurrentUser()
    clearCachedUserDirectory()
    clearLocalSharedStorageForSessionChange()
    return true
  } catch {
    return false
  }
}

export function getCurrentUser(): User | null {
  if (currentUserCache !== undefined) return currentUserCache
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SESSION_USER_KEY)
    currentUserCache = raw ? JSON.parse(raw) as User : null
  } catch {
    currentUserCache = null
  }
  return currentUserCache
}

export function setCurrentUser(user: User): void {
  currentUserCache = user
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user))
}

export function clearCurrentUser(): void {
  currentUserCache = null
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(SESSION_USER_KEY)
}

export function isLoggedIn(): boolean {
  return getCurrentUser() !== null
}

export function getPermissoes(user: User | null): Permissoes {
  if (!user) return PERMISSOES_PADRAO_POR_PERFIL.operacional
  if (user.permissoes) return user.permissoes
  if (user.perfil_bbt) return PERMISSOES_PADRAO_POR_PERFIL[user.perfil_bbt]
  return PERMISSOES_PADRAO_POR_PERFIL.operacional
}

export function hasPermission(user: User | null, permission: keyof Permissoes): boolean {
  return Boolean(user && user.ativo !== false && getPermissoes(user)[permission])
}

export function canEditGlobal(user: User | null): boolean {
  if (!user || user.ativo === false) return false
  return user.role === 'master' && !hasScopedAccess(user)
}

export function canEditCompany(
  user: User | null,
  companyId: string | null,
  empresas: Empresa[] = [],
  grupos: GrupoEmpresarial[] = [],
): boolean {
  if (!user || user.ativo === false) return false
  if (canEditGlobal(user)) return true
  if (empresas.length || grupos.length) return usuarioPodeAcessarEmpresa(user, companyId, empresas, grupos)
  if (user.empresa_ids?.includes(companyId || '')) return true
  return user.company_id === companyId
}

export function canViewCompany(
  user: User | null,
  companyId: string | null,
  empresas: Empresa[] = [],
  grupos: GrupoEmpresarial[] = [],
): boolean {
  return canEditCompany(user, companyId, empresas, grupos)
}

export function canViewGroup(user: User | null, grupo: GrupoEmpresarial | null | undefined): boolean {
  return Boolean(user && user.ativo !== false && usuarioPodeAcessarGrupo(user, grupo))
}

export function getEmpresasPermitidas(
  user: User | null,
  empresas: Empresa[],
  grupos: GrupoEmpresarial[],
): Empresa[] {
  return empresasPermitidasParaUsuario(user, empresas, grupos)
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case 'master': return 'Equipe BBT'
    case 'company_admin': return 'Administrador da empresa'
    case 'colaborador': return 'Colaborador'
  }
}

export function perfilBBTLabel(profile?: PerfilBBT): string {
  if (!profile) return 'Sem perfil'
  switch (profile) {
    case 'lider': return 'Lider / Dono'
    case 'agente': return 'Agente'
    case 'gestor_financeiro': return 'Gestor Financeiro'
    case 'supervisor': return 'Supervisor'
    case 'operacional': return 'Operacional'
  }
}

// ============================================================
// Sistema de Autenticação LOCAL V4
// - Único usuário "super master" hardcoded: Felipe Manrique
// - Usuários adicionais em localStorage (cadastrados via tela Usuários)
// - Permissões granulares por perfil
//
// A API de armazenamento converte senhas para scrypt antes de persistir no servidor.
// O modo local existe apenas como compatibilidade quando AUTH_REQUIRE_SESSION=false.
// ============================================================
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
  loadJSON,
  safeGetRaw,
  safeRemove,
  safeSetJSON,
} from '@/lib/storage-quota'
import { SUPER_MASTER } from '@/lib/auth-constants'

export { SUPER_MASTER }

/**
 * SUPER MASTER — sempre existe, nunca pode ser deletado do sistema
 * É você, Felipe.
 */
// localStorage keys
const LS_USERS = 'bbt-users-v4'
const LS_CURRENT_USER = 'bbt-current-user-v4'

/**
 * Conta interna com senha (apenas para autenticação local).
 * Nunca é exposta ao código da UI — só passa pela função de login.
 */
interface ContaLocal {
  user: User
  password: string
}

// ======== Gestão de usuários cadastrados ========

function loadUsuarios(): ContaLocal[] {
  if (typeof window === 'undefined') return []
  return loadJSON<ContaLocal[]>(LS_USERS, [])
}

function saveUsuarios(list: ContaLocal[]) {
  try {
    safeSetJSON(LS_USERS, list)
    return true
  } catch (e) {
    console.error('Erro salvando usuários:', e)
    return false
  }
}

/**
 * Retorna TODOS os usuários do sistema, incluindo o Super Master
 */
export function getAllUsers(): User[] {
  const extras = loadUsuarios().map((c) => c.user)
  return [SUPER_MASTER, ...extras]
}

/**
 * Retorna só os usuários que são agentes da BBT (role=master + perfil_bbt)
 */
export function getAgentesBBT(): User[] {
  return getAllUsers().filter((u) => u.role === 'master' && u.perfil_bbt && u.ativo !== false)
}

export function getUserById(id: string): User | undefined {
  return getAllUsers().find((u) => u.id === id)
}

/**
 * Cadastra novo usuário. Só pode ser chamado pelo Super Master.
 */
export function addUsuario(
  data: Omit<User, 'id' | 'created_at' | 'ativo'> & { password: string }
): User | null {
  if (!data.email || data.password.length < 8 || !data.name) return null

  const lista = loadUsuarios()
  // Evitar e-mail duplicado (compara também com Super Master)
  if (data.email.toLowerCase() === SUPER_MASTER.email.toLowerCase()) return null
  if (lista.some((c) => c.user.email.toLowerCase() === data.email.toLowerCase())) return null

  const novoUser: User = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    email: data.email.toLowerCase(),
    name: data.name,
    role: data.role,
    company_id: data.company_id,
    empresa_ids: data.empresa_ids,
    grupo_ids: data.grupo_ids,
    perfil_bbt: data.perfil_bbt,
    permissoes: data.permissoes,
    avatar: data.avatar,
    ativo: true,
    created_at: new Date().toISOString(),
  }

  lista.push({ user: novoUser, password: data.password })
  saveUsuarios(lista)
  return novoUser
}

/**
 * Edita dados do usuário. Se password for passado, troca a senha.
 * Super Master pode ser editado (nome, permissoes) mas não removido.
 */
export function updateUsuario(
  id: string,
  patch: Partial<User> & { password?: string }
): boolean {
  if (patch.password && patch.password.length < 8) return false

  // Editar Super Master: só nome, avatar ou senha
  if (id === SUPER_MASTER.id) {
    if (patch.password) {
      // Não deixamos trocar senha do super master pela UI comum
      console.warn('Senha do super master não pode ser alterada pela UI normal')
    }
    return true
  }

  const lista = loadUsuarios()
  const idx = lista.findIndex((c) => c.user.id === id)
  if (idx === -1) return false

  const atual = lista[idx]
  lista[idx] = {
    user: { ...atual.user, ...patch, id: atual.user.id },
    password: patch.password || atual.password,
  }
  return saveUsuarios(lista)
}

/**
 * "Deleta" usuário (na verdade inativa, para preservar histórico)
 */
export function deleteUsuario(id: string): boolean {
  if (id === SUPER_MASTER.id) return false
  const lista = loadUsuarios()
  const idx = lista.findIndex((c) => c.user.id === id)
  if (idx === -1) return false
  lista[idx].user.ativo = false
  return saveUsuarios(lista)
}

export function reativarUsuario(id: string): boolean {
  if (id === SUPER_MASTER.id) return true
  const lista = loadUsuarios()
  const idx = lista.findIndex((c) => c.user.id === id)
  if (idx === -1) return false
  lista[idx].user.ativo = true
  return saveUsuarios(lista)
}

// ======== LOGIN / LOGOUT ========

/**
 * Autentica por email + senha.
 * Retorna o User sem senha, ou null se credenciais inválidas.
 */
export function login(email: string, password: string): User | null {
  if (typeof window === 'undefined') return null
  const emailNorm = email.trim().toLowerCase()

  // Usuários adicionais
  const lista = loadUsuarios()
  const conta = lista.find(
    (c) => c.user.email.toLowerCase() === emailNorm && c.password === password && c.user.ativo !== false
  )
  if (!conta) return null

  safeSetJSON(LS_CURRENT_USER, conta.user)
  return conta.user
}

export async function logout(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const currentUser = getCurrentUser()
  if (!(await flushPendingRemoteStorage())) return false
  safeRemove(LS_CURRENT_USER)
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) {
      if (currentUser) setCurrentUser(currentUser)
      return false
    }
    clearLocalSharedStorageForSessionChange()
    return true
  } catch {
    if (currentUser) setCurrentUser(currentUser)
    return false
  }
}

export function getCurrentUser(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = safeGetRaw(LS_CURRENT_USER)
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export function setCurrentUser(user: User): void {
  safeSetJSON(LS_CURRENT_USER, user)
}

export function isLoggedIn(): boolean {
  return getCurrentUser() !== null
}

// ======== PERMISSÕES ========

export function getPermissoes(user: User | null): Permissoes {
  if (!user) return PERMISSOES_PADRAO_POR_PERFIL.operacional

  // Super Master: tudo liberado
  if (user.id === SUPER_MASTER.id) return PERMISSOES_PADRAO_POR_PERFIL.lider

  // Usa permissões customizadas se existirem
  if (user.permissoes) return user.permissoes

  // Fallback: padrão do perfil
  if (user.perfil_bbt) return PERMISSOES_PADRAO_POR_PERFIL[user.perfil_bbt]

  return PERMISSOES_PADRAO_POR_PERFIL.operacional
}

export function hasPermission(user: User | null, perm: keyof Permissoes): boolean {
  if (!user) return false
  return getPermissoes(user)[perm]
}

/** Compat: "pode editar globalmente" = é master */
export function canEditGlobal(user: User | null): boolean {
  if (!user) return false
  return user.role === 'master' && !hasScopedAccess(user)
}

export function canEditCompany(
  user: User | null,
  company_id: string | null,
  empresas: Empresa[] = [],
  grupos: GrupoEmpresarial[] = [],
): boolean {
  if (!user) return false
  if (canEditGlobal(user)) return true
  if (empresas.length || grupos.length) return usuarioPodeAcessarEmpresa(user, company_id, empresas, grupos)
  if (user.empresa_ids?.includes(company_id || '')) return true
  return user.company_id === company_id
}

export function canViewCompany(
  user: User | null,
  company_id: string | null,
  empresas: Empresa[] = [],
  grupos: GrupoEmpresarial[] = [],
): boolean {
  if (!user) return false
  if (canEditGlobal(user)) return true
  if (empresas.length || grupos.length) return usuarioPodeAcessarEmpresa(user, company_id, empresas, grupos)
  if (user.empresa_ids?.includes(company_id || '')) return true
  return user.company_id === company_id
}

export function canViewGroup(user: User | null, grupo: GrupoEmpresarial | null | undefined): boolean {
  return usuarioPodeAcessarGrupo(user, grupo)
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
    case 'master': return 'Agente BBT'
    case 'company_admin': return 'Admin Empresa'
    case 'colaborador': return 'Colaborador'
  }
}

export function perfilBBTLabel(p?: PerfilBBT): string {
  if (!p) return '—'
  switch (p) {
    case 'lider': return 'Líder / Dono'
    case 'agente': return 'Agente'
    case 'gestor_financeiro': return 'Gestor Financeiro'
    case 'supervisor': return 'Supervisor'
    case 'operacional': return 'Operacional'
  }
}

// ======== SUBSTITUTO do antigo MOCK_ACCOUNTS ========
// Código antigo pode usar isto - agora retorna TODOS os users dinamicamente
export function getMockAccounts(): Array<{ email: string; user: User }> {
  return getAllUsers().map((u) => ({ email: u.email, user: u }))
}

// Compat legacy
export const MOCK_ACCOUNTS = {
  get length() { return getAllUsers().length },
  filter: (fn: (acc: { email: string; user: User }) => boolean) =>
    getMockAccounts().filter(fn),
  find: (fn: (acc: { email: string; user: User }) => boolean) =>
    getMockAccounts().find(fn),
  map: <T,>(fn: (acc: { email: string; user: User }) => T) =>
    getMockAccounts().map(fn),
}

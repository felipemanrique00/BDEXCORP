import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { CorporateAccessSummary, Permissoes, User } from '@/types'

export function hasCompanyScopeAccess(
  user: User,
  access: CorporateAccessSummary | null,
  companyIds: ReadonlySet<string> | null,
  companyId: string | null | undefined,
  permission?: keyof Permissoes,
): boolean {
  if (!companyIds) {
    if (!permission) return true
    const permissions = user.permissoes
      || (user.perfil_bbt ? PERMISSOES_PADRAO_POR_PERFIL[user.perfil_bbt] : null)
    return Boolean(user.ativo !== false && permissions?.[permission])
  }
  if (!companyId || !companyIds.has(companyId)) return false
  if (!permission) return true
  return Boolean(access?.companies.find(
    (company) => company.companyId === companyId,
  )?.permissions[permission])
}

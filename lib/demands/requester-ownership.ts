import { isRequesterUser } from '@/lib/user-access-kind'
import type { Atendimento, SolicitanteEmpresa, User } from '@/types'

interface RequesterDemandAccessInput {
  user: Pick<User, 'id' | 'role' | 'role_key' | 'corporate_profile'> | null | undefined
  demand: Pick<Atendimento, 'id' | 'solicitante_id'>
  requesters: readonly Pick<SolicitanteEmpresa, 'id' | 'user_id' | 'status'>[]
  /**
   * IDs devolvidos por uma consulta relacional que o backend já limitou ao
   * `role_key=requester`. Não deve ser preenchido para outros papéis.
   */
  trustedServerDemandIds?: ReadonlySet<string>
}

export function requesterOwnsDemand({
  user,
  demand,
  requesters,
  trustedServerDemandIds,
}: RequesterDemandAccessInput): boolean {
  if (!user || !isRequesterUser(user)) return false

  if (
    String(user.role_key || '').trim() === 'requester'
    && trustedServerDemandIds?.has(demand.id)
  ) {
    return true
  }

  const requesterId = String(demand.solicitante_id || '').trim()
  if (!requesterId) return false

  return requesters.some((requester) => (
    requester.id === requesterId
    && requester.user_id === user.id
    && requester.status === 'ativo'
  ))
}

export function scopeDemandsForRequester<T extends Pick<Atendimento, 'id' | 'solicitante_id'>>({
  user,
  demands,
  requesters,
  trustedServerDemandIds,
}: {
  user: Pick<User, 'id' | 'role' | 'role_key' | 'corporate_profile'> | null | undefined
  demands: readonly T[]
  requesters: readonly Pick<SolicitanteEmpresa, 'id' | 'user_id' | 'status'>[]
  trustedServerDemandIds?: ReadonlySet<string>
}): T[] {
  if (!user || !isRequesterUser(user)) return [...demands]
  return demands.filter((demand) => requesterOwnsDemand({
    user,
    demand,
    requesters,
    trustedServerDemandIds,
  }))
}

export function filterDemandsForOperationalAssignment<
  T extends Pick<Atendimento, 'agente_user_id'>,
>({
  demands,
  userId,
  canViewAll,
  requesterView,
}: {
  demands: readonly T[]
  userId: string | null | undefined
  canViewAll: boolean
  requesterView: boolean
}): T[] {
  if (requesterView || canViewAll || !userId) return [...demands]
  return demands.filter((demand) => (
    demand.agente_user_id === userId || !demand.agente_user_id
  ))
}

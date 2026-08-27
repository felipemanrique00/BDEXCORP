import type { User } from '@/types'
import { userAccessKind } from '@/lib/user-access-kind'

export const COMPANY_PORTAL_ROOT = '/dashboard/portal-empresa-lab'
export const TRAVELER_PORTAL_ROOT = '/dashboard/minha-viagem'

type PortalBoundaryUser = Pick<
  User,
  'role' | 'role_key' | 'corporate_profile' | 'ativo' | 'permissoes' | 'corporate_access'
>

export function defaultAuthenticatedRoute(
  user: PortalBoundaryUser | null,
): string {
  return user ? corporateHomeRoute(user) : '/dashboard'
}

export function corporateDashboardRedirect(
  user: PortalBoundaryUser,
  pathname: string,
): string | null {
  if (userAccessKind(user) !== 'corporate') return null
  if (isCompanyPortalPath(pathname)) return null
  if (isTravelerPortalPath(pathname) && canAccessTravelerPortal(user)) return null
  return corporateHomeRoute(user)
}

export function corporateHomeRoute(user: PortalBoundaryUser): string {
  if (userAccessKind(user) !== 'corporate') return '/dashboard'
  const companies = user.corporate_access?.companies
  const hasCompanyPortalContext = companies === undefined
    || companies.some((company) => company.companyPortalEnabled !== false)
  if (hasCompanyPortalContext) return COMPANY_PORTAL_ROOT
  return canAccessTravelerPortal(user) ? TRAVELER_PORTAL_ROOT : COMPANY_PORTAL_ROOT
}

export function isCompanyPortalPath(pathname: string): boolean {
  return pathname === COMPANY_PORTAL_ROOT || pathname.startsWith(`${COMPANY_PORTAL_ROOT}/`)
}

export function isTravelerPortalPath(pathname: string): boolean {
  return pathname === TRAVELER_PORTAL_ROOT
}

function canAccessTravelerPortal(user: PortalBoundaryUser): boolean {
  return user.ativo !== false && user.permissoes?.acessar_portal_viajante === true
}

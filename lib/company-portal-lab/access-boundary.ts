import type { User } from '@/types'
import { userAccessKind } from '@/lib/user-access-kind'

export const COMPANY_PORTAL_ROOT = '/dashboard/portal-empresa-lab'

export function defaultAuthenticatedRoute(
  user: Pick<User, 'role' | 'role_key' | 'corporate_profile'> | null,
): string {
  return user && userAccessKind(user) === 'corporate'
    ? COMPANY_PORTAL_ROOT
    : '/dashboard'
}

export function corporateDashboardRedirect(
  user: Pick<User, 'role' | 'role_key' | 'corporate_profile'>,
  pathname: string,
): string | null {
  if (userAccessKind(user) !== 'corporate') return null
  return isCompanyPortalPath(pathname) ? null : COMPANY_PORTAL_ROOT
}

export function isCompanyPortalPath(pathname: string): boolean {
  return pathname === COMPANY_PORTAL_ROOT || pathname.startsWith(`${COMPANY_PORTAL_ROOT}/`)
}

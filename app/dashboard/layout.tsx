import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { DashboardShell } from '@/components/dashboard-shell'
import { corporateDashboardRedirect } from '@/lib/company-portal-lab/access-boundary'
import { resolveSession } from '@/lib/server/auth-service'
import { sessionCookieName } from '@/lib/server-auth'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const principal = await resolveSession(cookieStore.get(sessionCookieName())?.value || null)
  if (!principal) redirect('/login')
  if (principal.user.must_change_password) redirect('/alterar-senha')
  const requestHeaders = await headers()
  const requestedPath = requestHeaders.get('x-current-path') || '/dashboard'
  const corporateRedirect = corporateDashboardRedirect(principal.user, requestedPath)
  if (corporateRedirect) redirect(corporateRedirect)

  return <DashboardShell user={principal.user}>{children}</DashboardShell>
}

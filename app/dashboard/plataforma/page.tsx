import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { PlatformAdminConsole } from '@/components/platform/platform-admin-console'
import { resolveSession } from '@/lib/server/auth-service'
import { sessionCookieName } from '@/lib/server-auth'

export default async function PlatformAdminPage() {
  const cookieStore = await cookies()
  const principal = await resolveSession(cookieStore.get(sessionCookieName())?.value || null)
  if (!principal) redirect('/login')
  if (!principal.user.platform_admin) redirect('/dashboard')

  return <PlatformAdminConsole />
}

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { TravelerPortal } from '@/components/traveler/traveler-portal'
import { resolveSession } from '@/lib/server/auth-service'
import { sessionCookieName } from '@/lib/server-auth'

export default async function TravelerPage() {
  const cookieStore = await cookies()
  const principal = await resolveSession(cookieStore.get(sessionCookieName())?.value || null)
  if (!principal) redirect('/login')

  return <TravelerPortal user={principal.user} />
}

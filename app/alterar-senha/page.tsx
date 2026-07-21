import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { ChangePasswordForm } from '@/components/auth/change-password-form'
import { resolveSession } from '@/lib/server/auth-service'
import { sessionCookieName } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'

export default async function ChangePasswordPage() {
  const cookieStore = await cookies()
  const principal = await resolveSession(cookieStore.get(sessionCookieName())?.value || null)
  if (!principal) redirect('/login')
  return <ChangePasswordForm required={principal.user.must_change_password === true} />
}

'use client'
import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Header } from '@/components/header'
import { AuthGuard } from '@/components/auth-guard'
import { hydrateAlertSoundSettingsFromAssistant } from '@/lib/notificacoes'
import { QuickAIPopup } from '@/components/ai/quick-ai-popup'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)

  useEffect(() => {
    hydrateAlertSoundSettingsFromAssistant()
  }, [])

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-[#f4f6fa] dark:bg-[#10142b]">
        <Sidebar
          mobileOpen={mobileNavigationOpen}
          onMobileClose={() => setMobileNavigationOpen(false)}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <Header onOpenNavigation={() => setMobileNavigationOpen(true)} />
          <main className="min-w-0 flex-1 overflow-x-hidden p-4 pb-24 sm:p-6 sm:pb-24 lg:p-7 lg:pb-24">{children}</main>
          <QuickAIPopup />
        </div>
      </div>
    </AuthGuard>
  )
}

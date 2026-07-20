import './globals.css'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import type { Metadata, Viewport } from 'next'
import { AI_NAME, BRAND_LOGO_MARK, BRAND_LOGO_MARK_192, SYSTEM_FULL_NAME, SYSTEM_NAME } from '@/lib/branding'
import { ClientToaster } from '@/components/ui/client-toaster'
import { PWARegister } from '@/components/pwa/pwa-register'

export const metadata: Metadata = {
  title: `${SYSTEM_FULL_NAME} - Gestão corporativa de viagens`,
  description: `CRM, ERP, Wintour, vouchers, financeiro e ${AI_NAME} para viagens corporativas.`,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: BRAND_LOGO_MARK,
    shortcut: BRAND_LOGO_MARK,
    apple: BRAND_LOGO_MARK_192,
  },
  appleWebApp: {
    capable: true,
    title: SYSTEM_NAME,
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  themeColor: '#20265A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('bbt-theme') || 'light';
                if (theme === 'dark') document.documentElement.classList.add('dark');
              } catch(e){}
            `,
          }}
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
        <ClientToaster />
        <PWARegister />
      </body>
    </html>
  )
}

import './globals.css'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
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

// A CSP baseada em nonce exige renderização dinâmica para que os scripts internos
// do Next recebam o nonce exclusivo de cada resposta.
export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') || undefined

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('bbt-theme') || 'light';
                if (theme === 'dark') document.documentElement.classList.add('dark');
              } catch(e){
                document.documentElement.classList.remove('dark');
              }
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

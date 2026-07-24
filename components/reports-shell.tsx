'use client'

import type { ReactNode } from 'react'
import { CorporateContextProvider } from '@/components/corporate-context-provider'
import type { User } from '@/types'

export function ReportsShell({ children, user }: { children: ReactNode; user: User }) {
  return (
    <CorporateContextProvider user={user}>
      <div className="bbt-relatorio-root min-h-screen bg-white text-black">
        {children}
        <style jsx global>{`
          .bbt-relatorio-root { color-scheme: light; }
          @media print {
            body, html { background: white !important; margin: 0 !important; padding: 0 !important; }
            .print\\:hidden, .sidebar, aside, header { display: none !important; }
            .bbt-relatorio-root { padding: 0 !important; margin: 0 !important; }
            .bbt-relatorio-folha { max-width: 100% !important; padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
            @page { margin: 0.8cm; size: A4 landscape; }
            .bbt-relatorio-folha * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        `}</style>
      </div>
    </CorporateContextProvider>
  )
}

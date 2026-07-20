'use client'
import type { ReactNode } from 'react'

export default function RelatoriosLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bbt-relatorio-root bg-white text-black min-h-screen">
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
  )
}

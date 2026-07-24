'use client'

import { Database, History, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { LegacyApprovalsPanel } from '@/components/approvals/legacy-approvals-panel'
import { RelationalApprovalsPanel } from '@/components/approvals/relational-approvals-panel'

export default function ApprovalsPage() {
  const [source, setSource] = useState<'current' | 'legacy'>('current')
  const [refreshToken, setRefreshToken] = useState(0)

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Compliance · Decisões</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-bbt-accent" />
            Aprovações
          </h1>
          <p className="bbt-page-subtitle">
            Fila multinível com alçadas, delegação, SLA, concorrência segura e trilha de auditoria.
          </p>
        </div>
        <button type="button" className="bbt-button-ghost" onClick={() => setRefreshToken((value) => value + 1)}>
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </header>

      <div className="bbt-tabs w-fit max-w-full overflow-x-auto" role="tablist" aria-label="Origem das aprovações">
        <button
          type="button"
          role="tab"
          aria-selected={source === 'current'}
          className={`bbt-tab ${source === 'current' ? 'bbt-tab-active' : ''}`}
          onClick={() => setSource('current')}
        >
          <Database className="h-4 w-4" />
          Fila governada
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'legacy'}
          className={`bbt-tab ${source === 'legacy' ? 'bbt-tab-active' : ''}`}
          onClick={() => setSource('legacy')}
        >
          <History className="h-4 w-4" />
          Registros legados
        </button>
      </div>

      {source === 'current'
        ? <RelationalApprovalsPanel refreshToken={refreshToken} />
        : (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
              Esta aba preserva solicitações anteriores à migração relacional. Novas aprovações são criadas e decididas na fila governada.
            </div>
            <LegacyApprovalsPanel />
          </div>
        )}
    </div>
  )
}

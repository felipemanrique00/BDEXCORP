'use client'

import { Clock3, Loader2, LogOut, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useImpersonation } from '@/components/impersonation/impersonation-provider'

export function ImpersonationBanner() {
  const { representation, stopRepresentation, stopping } = useImpersonation()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!representation) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [representation])

  const remaining = useMemo(() => {
    if (!representation) return 0
    return Math.max(0, Date.parse(representation.expiresAt) - now)
  }, [now, representation])

  if (!representation) return null
  const warning = remaining <= 5 * 60_000
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1_000)
  const modeLabel = representation.mode === 'test' ? 'TESTE · SOMENTE LEITURA' : 'MODO OPERACIONAL'

  return (
    <section
      aria-label="Acesso assistido ativo"
      className={`border-b px-4 py-2.5 print:hidden sm:px-6 ${warning ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100' : 'border-cyan-300 bg-cyan-50 text-cyan-950 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100'}`}
    >
      <div className="mx-auto flex max-w-[1800px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:items-center">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 sm:mt-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
              <span>Você está acessando como {representation.subject.name}</span>
              <span className="rounded-full border border-current/25 px-2 py-0.5 text-[10px] tracking-wide">{modeLabel}</span>
            </div>
            <div className="mt-0.5 text-xs opacity-80">
              Agente responsável: {representation.actor.name}
              {representation.reference ? ` · Ref. ${representation.reference}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pl-8 sm:pl-0">
          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold" aria-live="polite" aria-atomic="true">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            {remaining > 0 ? `${minutes}:${String(seconds).padStart(2, '0')} restantes` : 'Encerrando...'}
          </div>
          <button
            type="button"
            onClick={() => void stopRepresentation()}
            disabled={stopping}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-current/30 bg-white/60 px-3 text-xs font-bold transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-current disabled:opacity-60 dark:bg-slate-950/20 dark:hover:bg-slate-950/40"
          >
            {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Encerrar acesso
          </button>
        </div>
      </div>
    </section>
  )
}

'use client'

import { Building2, ChevronDown, Loader2, Network } from 'lucide-react'

import { useCorporateContext } from '@/components/corporate-context-provider'
import { cn } from '@/lib/utils'

export function CorporateContextSelector({ placement = 'header' }: { placement?: 'header' | 'mobile-menu' }) {
  const { access, context, isChanging, selectContext } = useCorporateContext()
  if (!access || !context || access.contexts.length <= 1) return null

  return (
    <label
      className={cn(
        'relative min-w-0 items-center',
        placement === 'header' ? 'hidden max-w-[21rem] md:flex' : 'flex w-full md:hidden',
      )}
      title="Alterar empresa ou grupo"
    >
      {context.type === 'group'
        ? <Network className="pointer-events-none absolute left-3 h-4 w-4 text-bbt-accent" />
        : <Building2 className="pointer-events-none absolute left-3 h-4 w-4 text-bbt-accent" />}
      <select
        value={`${context.type}:${context.id}`}
        onChange={(event) => {
          const [type, ...idParts] = event.target.value.split(':')
          if (type === 'company' || type === 'group') void selectContext(type, idParts.join(':'))
        }}
        disabled={isChanging}
        className={cn(
          'h-10 appearance-none truncate rounded-md border py-0 pl-9 pr-8 text-xs font-semibold outline-none transition focus:ring-2 focus:ring-bbt-accent/20',
          placement === 'header'
            ? 'min-w-[13rem] max-w-[21rem] border-bbt-gray-100 bg-white text-bbt-primary hover:border-bbt-accent focus:border-bbt-accent dark:border-slate-700 dark:bg-slate-800 dark:text-white'
            : 'w-full border-white/15 bg-white/10 text-white hover:border-cyan-300/70 focus:border-cyan-300',
        )}
        aria-label="Contexto corporativo"
      >
        {access.contexts.map((option) => (
          <option key={`${option.type}:${option.id}`} value={`${option.type}:${option.id}`}>
            {option.label}
          </option>
        ))}
      </select>
      {isChanging
        ? <Loader2 className="pointer-events-none absolute right-2.5 h-4 w-4 animate-spin text-bbt-accent" />
        : <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400" />}
    </label>
  )
}

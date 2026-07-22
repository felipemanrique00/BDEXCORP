'use client'
import { Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { calcularSLA, classeSLA, type SLAInfo } from '@/lib/sla'
import type { Atendimento, Empresa } from '@/types'

interface Props {
  atendimento: Atendimento
  empresa?: Empresa
  variant?: 'badge' | 'barra' | 'card'
}

export function SLABadge({ atendimento, empresa, variant = 'badge' }: Props) {
  const info = calcularSLA(atendimento, empresa)

  if (variant === 'badge') {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${classeSLA(info.cor)}`}
        title={`SLA: ${info.horas_passadas}h de ${info.horas_total}h`}>
        {info.status === 'estourado' && <AlertTriangle className="w-3 h-3" />}
        {info.status === 'concluido' && <CheckCircle2 className="w-3 h-3" />}
        {info.status !== 'estourado' && info.status !== 'concluido' && <Clock className="w-3 h-3" />}
        {info.label}
      </span>
    )
  }

  if (variant === 'barra') {
    const cor = info.cor === 'green' ? 'bg-green-500' : info.cor === 'amber' ? 'bg-amber-500' : info.cor === 'red' ? 'bg-red-500' : 'bg-slate-300'
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-slate-500">SLA</span>
          <span className={info.cor === 'red' ? 'text-red-600 font-bold' : info.cor === 'amber' ? 'text-amber-600' : 'text-slate-600'}>
            {info.label}
          </span>
        </div>
        <div className="h-1.5 bg-bbt-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div className={`h-full ${cor} transition-all`} style={{ width: `${Math.min(100, info.pct_usado)}%` }} />
        </div>
      </div>
    )
  }

  // variant 'card'
  return (
    <div className={`p-3 rounded-lg border-l-4 ${info.cor === 'red' ? 'border-l-red-500 bg-red-50 dark:bg-red-900/10' : info.cor === 'amber' ? 'border-l-amber-500 bg-amber-50 dark:bg-amber-900/10' : info.cor === 'green' ? 'border-l-green-500 bg-green-50 dark:bg-green-900/10' : 'border-l-slate-300 bg-bbt-gray-50 dark:bg-slate-800'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold flex items-center gap-1">
          {info.status === 'estourado' ? <AlertTriangle className="w-3 h-3 text-red-500" /> :
           info.status === 'concluido' ? <CheckCircle2 className="w-3 h-3 text-slate-500" /> :
           <Clock className="w-3 h-3 text-slate-500" />}
          SLA
        </div>
        <div className="text-[10px] text-slate-500">{info.horas_passadas}h / {info.horas_total}h</div>
      </div>
      <div className={`text-sm font-bold ${info.cor === 'red' ? 'text-red-600' : info.cor === 'amber' ? 'text-amber-600' : info.cor === 'green' ? 'text-green-600' : 'text-slate-500'}`}>
        {info.label}
      </div>
    </div>
  )
}

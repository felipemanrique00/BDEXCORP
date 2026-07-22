// ============================================================
// SLA — V7
// Calcula status SLA (verde/amarelo/vermelho) de uma demanda
// baseado no tempo desde a criação vs sla_horas configurado na empresa.
// ============================================================

import type { Atendimento, Empresa } from '@/types'

export type StatusSLA = 'ok' | 'atencao' | 'estourado' | 'concluido'

export interface SLAInfo {
  status: StatusSLA
  horas_passadas: number
  horas_total: number
  pct_usado: number          // 0 a 100+
  cor: 'green' | 'amber' | 'red' | 'slate'
  label: string              // ex: "5h restantes" ou "Estourou há 3h"
}

const HORAS_PADRAO = 24

export function calcularSLA(atendimento: Atendimento, empresa?: Empresa): SLAInfo {
  // Demandas finalizadas/canceladas não têm SLA
  if (atendimento.status === 'finalizado' || atendimento.status === 'cancelado') {
    return {
      status: 'concluido',
      horas_passadas: 0,
      horas_total: 0,
      pct_usado: 0,
      cor: 'slate',
      label: atendimento.status === 'cancelado' ? 'Cancelada' : 'Concluída',
    }
  }

  const horasTotal = empresa?.config_cobranca?.sla_horas ?? HORAS_PADRAO
  const inicio = new Date(atendimento.created_at).getTime()
  const agora = Date.now()
  const diffMs = agora - inicio
  const horasPassadas = diffMs / (1000 * 60 * 60)
  const pctUsado = (horasPassadas / horasTotal) * 100

  let status: StatusSLA = 'ok'
  let cor: 'green' | 'amber' | 'red' | 'slate' = 'green'
  let label = ''

  if (pctUsado >= 100) {
    status = 'estourado'
    cor = 'red'
    const horasFora = horasPassadas - horasTotal
    label = horasFora < 1
      ? 'Acabou de estourar'
      : horasFora < 24
        ? `Estourou há ${Math.floor(horasFora)}h`
        : `Atrasada há ${Math.floor(horasFora / 24)}d`
  } else if (pctUsado >= 75) {
    status = 'atencao'
    cor = 'amber'
    const horasRestantes = horasTotal - horasPassadas
    label = horasRestantes < 1
      ? 'Menos de 1h restante'
      : `${Math.floor(horasRestantes)}h restantes`
  } else {
    status = 'ok'
    cor = 'green'
    const horasRestantes = horasTotal - horasPassadas
    label = horasRestantes < 24
      ? `${Math.floor(horasRestantes)}h restantes`
      : `${Math.floor(horasRestantes / 24)}d restantes`
  }

  return {
    status,
    horas_passadas: Math.round(horasPassadas * 10) / 10,
    horas_total: horasTotal,
    pct_usado: Math.round(pctUsado),
    cor,
    label,
  }
}

/** Classe Tailwind pra cor do SLA */
export function classeSLA(cor: SLAInfo['cor']): string {
  switch (cor) {
    case 'green': return 'bg-green-500 text-white'
    case 'amber': return 'bg-amber-500 text-white'
    case 'red': return 'bg-red-500 text-white'
    case 'slate': return 'bg-slate-300 text-slate-700'
  }
}

export function corBordaSLA(cor: SLAInfo['cor']): string {
  switch (cor) {
    case 'green': return 'border-l-green-500'
    case 'amber': return 'border-l-amber-500'
    case 'red': return 'border-l-red-500'
    case 'slate': return 'border-l-slate-300'
  }
}

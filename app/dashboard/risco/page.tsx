'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ShieldAlert, MapPin, Calendar, Users, Phone, AlertTriangle,
  Plane, Hotel as HotelIcon, Globe2, Activity, ChevronRight,
} from 'lucide-react'

import { getCurrentUser } from '@/lib/auth'
import { useStore } from '@/lib/store'
import { getAllAtendimentos } from '@/lib/atendimentos-storage'
import { getAllVouchersEmitidos } from '@/lib/vouchers-emitidos-storage'
import {
  corRisco,
  listarViajantes,
  metricasViajantes,
  rotuloRisco,
} from '@/lib/duty-of-care'
import { formatDate } from '@/lib/utils'
import type { NivelRisco, StatusViajante, User } from '@/types'

export default function RiscoPage() {
  const [user, setUser] = useState<User | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'em_viagem' | 'planejada' | 'todos'>('em_viagem')
  const [filtroRisco, setFiltroRisco] = useState<NivelRisco | 'todos'>('todos')

  const { empresas } = useStore()

  useEffect(() => { setUser(getCurrentUser()) }, [])

  const viajantes = useMemo(
    () => listarViajantes({
      atendimentos: getAllAtendimentos(),
      vouchers: getAllVouchersEmitidos(),
      empresas: empresas.map((e) => ({ id: e.id, nome: e.nome })),
    }),
    [empresas],
  )

  const metricas = useMemo(() => metricasViajantes(viajantes), [viajantes])

  const filtrados = useMemo(() => {
    return viajantes.filter((v) => {
      if (filtroStatus !== 'todos' && v.status !== filtroStatus) return false
      if (filtroRisco !== 'todos' && v.risco !== filtroRisco) return false
      return true
    })
  }, [viajantes, filtroStatus, filtroRisco])

  if (!user) return null

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Duty of Care</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <ShieldAlert className="w-6 h-6 text-bbt-accent" /> Centro de Risco e Viajantes
          </h1>
          <p className="bbt-page-subtitle">
            Quem está em viagem agora, onde, com qual nível de risco e o que precisa de atenção.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Activity} label="Em viagem agora" value={String(metricas.em_campo)} tone="blue" />
        <KpiCard icon={Calendar} label="Próximos 7 dias" value={String(metricas.proximas_7d)} tone="amber" />
        <KpiCard icon={AlertTriangle} label="Alto / Crítico" value={String(metricas.risco_alto_ou_critico)} tone="red" />
        <KpiCard icon={Globe2} label="Países ativos" value={String(metricas.distribuicao_paises.length)} tone="green" />
      </div>

      {/* Distribuição */}
      {metricas.distribuicao_ufs.length > 0 && (
        <div className="bbt-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-bbt-accent" />
            <h3 className="font-semibold text-sm text-bbt-primary dark:text-white">
              Distribuição geográfica (em viagem)
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {metricas.distribuicao_ufs.map(({ uf, qtd }) => (
              <div key={uf} className="px-3 py-1.5 rounded-md bg-bbt-gray-50 dark:bg-slate-800 text-xs flex items-center gap-2">
                <span className="font-bold text-bbt-primary dark:text-white">{uf}</span>
                <span className="text-slate-500">{qtd} viajante(s)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="bbt-tabs">
          {(['em_viagem', 'planejada', 'todos'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setFiltroStatus(opt)}
              className={`bbt-tab ${filtroStatus === opt ? 'bbt-tab-active' : ''}`}
            >
              {opt === 'em_viagem' ? 'Em viagem' : opt === 'planejada' ? 'Planejadas' : 'Todas'}
            </button>
          ))}
        </div>

        <div className="bbt-tabs">
          {(['todos', 'baixo', 'moderado', 'alto', 'critico'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setFiltroRisco(opt as any)}
              className={`bbt-tab ${filtroRisco === opt ? 'bbt-tab-active' : ''}`}
            >
              {opt === 'todos' ? 'Todos' : rotuloRisco(opt as NivelRisco)}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div className="bbt-card overflow-hidden">
        {filtrados.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            Nenhum viajante {filtroStatus === 'em_viagem' ? 'em viagem' : 'no filtro selecionado'}.
          </div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {filtrados.map((v) => (
              <Link
                key={v.voucher_id}
                href={`/dashboard/vouchers/${v.voucher_id}`}
                className="grid grid-cols-[1fr_auto] items-center gap-3 p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/50 transition"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`bbt-badge ${corRiscoBadge(v.risco)}`}>
                      {rotuloRisco(v.risco)}
                    </span>
                    <span className="bbt-badge bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {rotuloStatus(v.status)}
                    </span>
                    <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                      {iconForTipo(v.tipo)} {v.tipo}
                    </span>
                  </div>
                  <div className="mt-1 font-semibold text-bbt-text dark:text-white truncate">
                    {v.passageiro_nome}
                  </div>
                  <div className="text-xs text-slate-500 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {v.destino}
                    {v.empresa_nome && ` · ${v.empresa_nome}`}
                  </div>
                  {v.alertas.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {v.alertas.map((a, i) => (
                        <span key={i} className="bbt-badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          <AlertTriangle className="w-3 h-3" /> {a}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-right">
                  <div>
                    <div className="text-xs text-slate-500">{formatDate(v.inicio)}</div>
                    <div className="text-xs text-slate-400">→ {formatDate(v.fim)}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="bbt-card p-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        <strong className="text-bbt-primary dark:text-white">Sobre o cálculo de risco:</strong>{' '}
        Combina destino (cidades/países com nível de risco), alertas operacionais ativos e proximidade da data de viagem.
        Para uso enterprise, recomendamos integrar feed externo de risco (ISOS, Riskline, Crisis24) — a estrutura já está pronta para isso.
      </div>
    </div>
  )
}

function rotuloStatus(s: StatusViajante): string {
  switch (s) {
    case 'em_viagem': return 'Em viagem'
    case 'planejada': return 'Planejada'
    case 'concluida': return 'Concluída'
    case 'cancelada': return 'Cancelada'
  }
}

function corRiscoBadge(r: NivelRisco): string {
  switch (r) {
    case 'baixo': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    case 'moderado': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    case 'alto': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
    case 'critico': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  }
}

function iconForTipo(t: string) {
  if (t === 'Aéreo') return <Plane className="w-3 h-3" />
  if (t === 'Hotel') return <HotelIcon className="w-3 h-3" />
  return <Activity className="w-3 h-3" />
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'green' | 'amber' | 'red' | 'blue' }) {
  const toneMap: Record<typeof tone, string> = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  }
  return (
    <div className="bbt-card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${toneMap[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[11px] uppercase leading-tight tracking-wider text-slate-500 font-semibold [overflow-wrap:anywhere]">{label}</div>
        <div className="break-words text-lg font-bold leading-tight tabular-nums text-bbt-primary [overflow-wrap:anywhere] dark:text-white">{value}</div>
      </div>
    </div>
  )
}

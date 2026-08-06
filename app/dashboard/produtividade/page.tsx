'use client'
import { addDaysISODate, todayISODate } from '@/lib/date'
import { DateInput } from '@/components/ui/date-input'
import { useMemo, useState, useEffect } from 'react'
import { getCurrentUser, getAgentesBBT, hasPermission, perfilBBTLabel } from '@/lib/auth'
import { getEstatisticas } from '@/lib/atendimentos-storage'
import { formatCurrency } from '@/lib/utils'
import {
  TrendingUp, Users, Trophy, DollarSign, Calendar, Award,
  BarChart3, Target,
} from 'lucide-react'
import type { User } from '@/types'

export default function ProdutividadePage() {
  const [user, setUser] = useState<User | null>(null)
  const hoje = todayISODate()
  const trintaDias = addDaysISODate(todayISODate(), -30)

  const [dataInicio, setDataInicio] = useState(trintaDias)
  const [dataFim, setDataFim] = useState(hoje)

  useEffect(() => { setUser(getCurrentUser()) }, [])

  const podeVer = hasPermission(user, 'ver_produtividade_todos')
  const podeVerFinanceiro = hasPermission(user, 'ver_financeiro')

  const agentes = useMemo(() => {
    if (!user) return []
    if (!podeVer) {
      // Só vê o próprio
      const self = getAgentesBBT().find((a) => a.id === user.id)
      return self ? [self] : []
    }
    return getAgentesBBT()
  }, [user, podeVer])

  const dadosAgentes = useMemo(() => {
    return agentes.map((a) => {
      const stats = getEstatisticas({
        agente_user_id: a.id,
        data_inicio: dataInicio,
        data_fim: dataFim,
      })
      return { agente: a, stats }
    }).sort((a, b) => b.stats.markup_total - a.stats.markup_total)
  }, [agentes, dataInicio, dataFim])

  const totais = useMemo(() => {
    let totalDemandas = 0, totalFinalizadas = 0, totalMarkup = 0, totalFaturado = 0
    dadosAgentes.forEach(({ stats }) => {
      totalDemandas += stats.total
      totalFinalizadas += stats.por_status.finalizado
      totalMarkup += stats.markup_total
      totalFaturado += stats.faturado_total
    })
    return { totalDemandas, totalFinalizadas, totalMarkup, totalFaturado }
  }, [dadosAgentes])

  function setPeriodo(dias: number) {
    setDataInicio(addDaysISODate(todayISODate(), -dias))
    setDataFim(hoje)
  }

  if (!user) return null

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Performance</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <TrendingUp className="w-6 h-6 text-bbt-accent" /> Produtividade {podeVer ? 'da Equipe' : 'Individual'}
          </h1>
          <p className="bbt-page-subtitle">
            {podeVer
              ? 'Compare o desempenho dos agentes BBT em qualquer período.'
              : 'Acompanhe sua produtividade pessoal.'}
          </p>
        </div>
      </div>

      {/* PERÍODO */}
      <div className="bbt-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-bbt-accent" />
          <span className="text-sm font-semibold">Período de análise</span>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <DateInput aria-label="Data inicial do período de análise" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-auto" containerClassName="w-auto" />
          <span className="text-slate-400">até</span>
          <DateInput aria-label="Data final do período de análise" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-auto" containerClassName="w-auto" />
          <div className="flex gap-1 ml-2">
            <button onClick={() => setPeriodo(7)} className="bbt-button-ghost text-xs px-2 py-1">7d</button>
            <button onClick={() => setPeriodo(30)} className="bbt-button-ghost text-xs px-2 py-1">30d</button>
            <button onClick={() => setPeriodo(90)} className="bbt-button-ghost text-xs px-2 py-1">90d</button>
            <button onClick={() => setPeriodo(365)} className="bbt-button-ghost text-xs px-2 py-1">1 ano</button>
          </div>
        </div>
      </div>

      {/* TOTAIS */}
      {podeVer && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total Demandas" value={String(totais.totalDemandas)} icon={BarChart3} color="blue" />
          <KPI label="Finalizadas" value={String(totais.totalFinalizadas)} icon={Target} color="green" />
          {podeVerFinanceiro && (
            <>
              <KPI label="Markup Total" value={formatCurrency(totais.totalMarkup)} icon={TrendingUp} color="bbt" />
              <KPI label="Faturado Total" value={formatCurrency(totais.totalFaturado)} icon={DollarSign} color="green" />
            </>
          )}
        </div>
      )}

      {/* RANKING DE AGENTES */}
      <div className="bbt-card overflow-hidden">
        <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700 bg-gradient-to-r from-bbt-primary/5 to-transparent">
          <h3 className="font-semibold flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" /> Ranking {podeVerFinanceiro ? 'por Markup' : 'por Demandas'}
          </h3>
        </div>

        {dadosAgentes.length === 0 ? (
          <div className="p-10 text-center text-slate-400">Nenhum agente cadastrado.</div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {dadosAgentes.map(({ agente, stats }, idx) => (
              <div key={agente.id} className="p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
                <div className="flex items-start gap-4">
                  {/* Medalha */}
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm"
                    style={{
                      background: idx === 0 ? '#fbbf24' : idx === 1 ? '#cbd5e1' : idx === 2 ? '#d97706' : '#e2e8f0',
                      color: idx <= 2 ? 'white' : '#64748b'
                    }}>
                    {idx === 0 ? <Trophy className="w-5 h-5" /> : `${idx + 1}º`}
                  </div>

                  {/* Avatar + Info */}
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-bbt-primary to-bbt-primary-light flex items-center justify-center text-white font-bold shrink-0">
                    {agente.name.split(' ').slice(0, 2).map((n) => n[0]).join('')}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-bbt-primary dark:text-white truncate">{agente.name}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {perfilBBTLabel(agente.perfil_bbt)} · {agente.email}
                    </div>

                    {/* Métricas */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
                      <MetricaMini label="Demandas" value={String(stats.total)} />
                      <MetricaMini label="Finalizadas" value={String(stats.por_status.finalizado)} color="green" />
                      <MetricaMini label="Em andamento" value={String(stats.por_status.em_andamento)} color="blue" />
                      {podeVerFinanceiro && (
                        <>
                          <MetricaMini label="Markup" value={formatCurrency(stats.markup_total)} color="green" />
                          <MetricaMini label="Margem" value={`${stats.margem_media_pct.toFixed(1)}%`} color="purple" />
                        </>
                      )}
                    </div>

                    {/* Breakdown por tipo */}
                    {stats.total > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {(Object.entries(stats.por_tipo) as Array<[string, number]>).filter(([, v]) => v > 0).map(([tipo, qtd]) => (
                          <span key={tipo} className="text-[10px] px-2 py-0.5 rounded bg-bbt-gray-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {tipo}: <strong>{qtd}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {podeVerFinanceiro && (
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Faturado</div>
                      <div className="text-lg font-bold text-bbt-primary dark:text-white">
                        {formatCurrency(stats.faturado_total)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!podeVer && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
          <Award className="w-4 h-4 inline mr-1" />
          Você está vendo apenas sua produtividade individual. Para ver a equipe toda,
          peça ao administrador permissão de "Ver produtividade de todos".
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  const colors: Record<string, string> = {
    bbt: 'bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white shadow-md',
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/50',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-100 dark:border-green-800/50',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-100 dark:border-purple-800/50',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color]}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</div>
        <Icon className="w-4 h-4 opacity-70" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

function MetricaMini({ label, value, color = 'slate' }: { label: string; value: string; color?: string }) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  }
  return (
    <div className={`rounded p-2 ${colors[color]}`}>
      <div className="text-[9px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  )
}

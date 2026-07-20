'use client'
import { addDaysISODate, todayISODate } from '@/lib/date'
import { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Pie, PieChart, Cell, Legend,
} from 'recharts'
import {
  Leaf, Plane, Hotel as HotelIcon, Car, TreePine, TrendingDown, Building2,
} from 'lucide-react'

import { getCurrentUser } from '@/lib/auth'
import { useStore } from '@/lib/store'
import { getAllAtendimentos } from '@/lib/atendimentos-storage'
import {
  arvoresEquivalentes,
  calcularPegadaAtendimento,
  carrosEquivalentes,
  formatarKg,
} from '@/lib/esg-carbon'
import type { TipoServico, User } from '@/types'

export default function SustentabilidadePage() {
  const [user, setUser] = useState<User | null>(null)
  const hoje = todayISODate()
  const [periodo, setPeriodo] = useState<'30' | '90' | '365' | 'all'>('90')

  const { empresas } = useStore()

  useEffect(() => { setUser(getCurrentUser()) }, [])

  const atendimentosFiltrados = useMemo(() => {
    let atds = getAllAtendimentos()
    if (periodo !== 'all') {
      const dias = parseInt(periodo)
      const limite = addDaysISODate(todayISODate(), -dias)
      atds = atds.filter((a) => a.data_atendimento >= limite)
    }
    return atds
  }, [periodo])

  const dados = useMemo(() => {
    const pegadas = atendimentosFiltrados
      .map((a) => ({ a, p: calcularPegadaAtendimento(a) }))
      .filter((x): x is { a: typeof x.a; p: NonNullable<ReturnType<typeof calcularPegadaAtendimento>> } => !!x.p)

    const total = pegadas.reduce((s, x) => s + x.p.kg_co2, 0)

    const porTipo: Record<TipoServico, number> = {
      'Aéreo': 0, 'Hotel': 0, 'Carro': 0, 'Pacote': 0, 'Outro': 0,
    }
    pegadas.forEach((x) => { porTipo[x.p.tipo as TipoServico] = (porTipo[x.p.tipo as TipoServico] || 0) + x.p.kg_co2 })

    const porEmpresa: Map<string, number> = new Map()
    pegadas.forEach((x) => {
      const id = x.a.empresa_id
      porEmpresa.set(id, (porEmpresa.get(id) || 0) + x.p.kg_co2)
    })

    const porMes: Map<string, number> = new Map()
    pegadas.forEach((x) => {
      const mes = x.a.data_atendimento.slice(0, 7)
      porMes.set(mes, (porMes.get(mes) || 0) + x.p.kg_co2)
    })

    return {
      total,
      qtd_atendimentos: pegadas.length,
      por_tipo: Object.entries(porTipo)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ tipo: k, kg: Math.round(v * 10) / 10 })),
      por_empresa: Array.from(porEmpresa.entries())
        .map(([id, kg]) => ({
          empresa: empresas.find((e) => e.id === id)?.nome || 'Desconhecida',
          kg: Math.round(kg * 10) / 10,
        }))
        .sort((a, b) => b.kg - a.kg)
        .slice(0, 10),
      por_mes: Array.from(porMes.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, kg]) => ({ mes, kg: Math.round(kg * 10) / 10 })),
    }
  }, [atendimentosFiltrados, empresas])

  if (!user) return null

  const CORES_TIPO: Record<string, string> = {
    'Aéreo': '#0EA5E9',
    'Hotel': '#10B981',
    'Carro': '#F59E0B',
    'Pacote': '#8B5CF6',
    'Outro': '#94A3B8',
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">ESG</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Leaf className="w-6 h-6 text-bbt-accent" /> Sustentabilidade
          </h1>
          <p className="bbt-page-subtitle">
            Pegada de carbono das viagens corporativas, por tipo, empresa e período.
          </p>
        </div>
        <div className="bbt-tabs">
          {(['30', '90', '365', 'all'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setPeriodo(opt)}
              className={`bbt-tab ${periodo === opt ? 'bbt-tab-active' : ''}`}
            >
              {opt === '30' ? '30 dias' : opt === '90' ? '90 dias' : opt === '365' ? '12 meses' : 'Tudo'}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Leaf}
          label="CO₂e total"
          value={formatarKg(dados.total)}
          tone="green"
          help={`${dados.qtd_atendimentos} viagens contabilizadas`}
        />
        <KpiCard
          icon={TreePine}
          label="Árvores p/ compensar"
          value={`${arvoresEquivalentes(dados.total).toLocaleString('pt-BR')}`}
          tone="green"
          help="árvores tropicais/ano"
        />
        <KpiCard
          icon={Car}
          label="Equivale a carros"
          value={`${carrosEquivalentes(dados.total).toLocaleString('pt-BR')}`}
          tone="amber"
          help="carros médios em 1 ano"
        />
        <KpiCard
          icon={TrendingDown}
          label="Por viagem (média)"
          value={dados.qtd_atendimentos > 0 ? formatarKg(dados.total / dados.qtd_atendimentos) : '—'}
          tone="blue"
          help="kg CO₂e por viagem"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Por tipo */}
        <div className="bbt-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Plane className="w-4 h-4 text-bbt-accent" />
            <h3 className="font-semibold text-sm text-bbt-primary dark:text-white">
              Pegada por categoria
            </h3>
          </div>
          {dados.por_tipo.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">Sem dados no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={dados.por_tipo}
                  dataKey="kg"
                  nameKey="tipo"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {dados.por_tipo.map((entry) => (
                    <Cell key={entry.tipo} fill={CORES_TIPO[entry.tipo] || '#94A3B8'} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatarKg(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top empresas */}
        <div className="bbt-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-bbt-accent" />
            <h3 className="font-semibold text-sm text-bbt-primary dark:text-white">
              Top 10 empresas (kg CO₂e)
            </h3>
          </div>
          {dados.por_empresa.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">Sem dados no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, dados.por_empresa.length * 28)}>
              <BarChart data={dados.por_empresa} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis dataKey="empresa" type="category" stroke="#64748b" fontSize={11} width={140} />
                <Tooltip formatter={(v: number) => formatarKg(v)} />
                <Bar dataKey="kg" fill="#10B981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Mensal */}
      <div className="bbt-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <HotelIcon className="w-4 h-4 text-bbt-accent" />
          <h3 className="font-semibold text-sm text-bbt-primary dark:text-white">
            Evolução mensal
          </h3>
        </div>
        {dados.por_mes.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">Sem dados no período</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dados.por_mes}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="mes" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip formatter={(v: number) => formatarKg(v)} />
              <Bar dataKey="kg" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bbt-card p-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        <strong className="text-bbt-primary dark:text-white">Metodologia:</strong>{' '}
        Aéreo via DEFRA 2024/ICAO (kg CO₂e por passageiro·km, com fatores de Radiative Forcing).
        Hotéis via HCMI (Hotel Carbon Measurement Initiative), médias Brasil/AL por categoria de estrelas.
        Carros via DEFRA padrão 0.171 kg CO₂e/km. Os valores são estimativas conservadoras para fins de
        relatório ESG; emissões reais podem variar conforme aeronave, ocupação e fonte energética do hotel.
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, tone, help }: { icon: any; label: string; value: string; tone: 'green' | 'amber' | 'blue' | 'red'; help?: string }) {
  const toneMap: Record<typeof tone, string> = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  }
  return (
    <div className="bbt-card p-4">
      <div className="flex items-center gap-3 mb-1">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneMap[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
      </div>
      <div className="text-xl font-bold text-bbt-primary dark:text-white">{value}</div>
      {help && <div className="text-[11px] text-slate-500 mt-0.5">{help}</div>}
    </div>
  )
}

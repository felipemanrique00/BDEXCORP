'use client'
import { todayISODate } from '@/lib/date'
import { useState, useEffect, useMemo } from 'react'
import { getCurrentUser, perfilBBTLabel } from '@/lib/auth'
import { useStore } from '@/lib/store'
import {
  getAtendimentosFiltro, getEstatisticas,
  type FiltroAtendimento,
} from '@/lib/atendimentos-storage'
import {
  BarChart3, Clock, CheckCircle2, AlertTriangle, XCircle, AlertCircle,
  Plus, Plane, Hotel as HotelIcon, Car, BusFront, Package, Zap, Edit2, FileText,
  Download, Calendar, Paperclip, DollarSign, TrendingUp, Percent, Wand2,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { NovaDemandaModal } from '@/components/ui/nova-demanda-modal'
import { ImportarVoucherModal } from '@/components/ui/importar-voucher-modal'
import { AnexarVoucherModal } from '@/components/ui/anexar-voucher-modal'
import { SearchInput } from '@/components/ui/search-input'
import { DateInput } from '@/components/ui/date-input'
import type { Atendimento, StatusAtendimento, Prioridade, TipoServico } from '@/types'
import { STATUS_LABEL, PRIORIDADE_LABEL, calcularFinanceiro } from '@/types'

const TIPO_ICON: Record<TipoServico, any> = {
  'Aéreo': Plane, 'Hotel': HotelIcon, 'Carro': Car, 'Rodoviário': BusFront, 'Pacote': Package, 'Outro': FileText,
}

const PRIORIDADE_COLOR: Record<Prioridade, string> = {
  baixa: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  media: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  alta: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  urgente: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

const STATUS_COLOR: Record<StatusAtendimento, string> = {
  em_andamento: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  aguardando_cliente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  pendente: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  finalizado: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelado: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

export default function MeuPerfilPage() {
  const [user, setUser] = useState<ReturnType<typeof getCurrentUser>>(null)
  const { empresas } = useStore()

  useEffect(() => { setUser(getCurrentUser()) }, [])

  const [filtroStatus, setFiltroStatus] = useState<StatusAtendimento | 'todos'>('todos')
  const [filtroTipo, setFiltroTipo] = useState<TipoServico | 'todos'>('todos')
  const [filtroPrio, setFiltroPrio] = useState<Prioridade | 'todas'>('todas')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [busca, setBusca] = useState('')

  const [novaOpen, setNovaOpen] = useState(false)
  const [importarVoucherOpen, setImportarVoucherOpen] = useState(false)
  const [editando, setEditando] = useState<Atendimento | null>(null)
  const [anexarAtendimento, setAnexarAtendimento] = useState<Atendimento | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (user) setReload((n) => n + 1)
  }, [user])

  const filtro: FiltroAtendimento = useMemo(() => {
    if (!user) return {}
    return {
      agente_user_id: user.id,
      status: filtroStatus !== 'todos' ? filtroStatus : undefined,
      tipo_servico: filtroTipo !== 'todos' ? filtroTipo : undefined,
      prioridade: filtroPrio !== 'todas' ? filtroPrio : undefined,
      data_inicio: dataInicio || undefined,
      data_fim: dataFim || undefined,
    }
  }, [user, filtroStatus, filtroTipo, filtroPrio, dataInicio, dataFim])

  const atendimentos: Atendimento[] = useMemo(() => {
    void reload
    const list = getAtendimentosFiltro(filtro)
    if (!busca.trim()) return list
    const q = busca.toLowerCase()
    return list.filter((a) =>
      a.passageiro_nome.toLowerCase().includes(q) ||
      (a.observacoes || '').toLowerCase().includes(q) ||
      (a.detalhes_aereo?.localizador || a.detalhes_hotel?.localizador || a.detalhes_carro?.localizador || '').toLowerCase().includes(q)
    )
  }, [filtro, busca, reload])

  const stats = useMemo(() => {
    void reload
    return getEstatisticas(filtro)
  }, [filtro, reload])

  function handleEdit(a: Atendimento) { setEditando(a); setNovaOpen(true) }

  function gerarRelatorio() {
    const inicio = dataInicio || '1970-01-01'
    const fim = dataFim || todayISODate()
    const url = `/relatorios/agente?inicio=${inicio}&fim=${fim}&agente=${user?.id || ''}`
    window.open(url, '_blank')
  }

  function limparFiltros() {
    setFiltroStatus('todos'); setFiltroTipo('todos'); setFiltroPrio('todas')
    setDataInicio(''); setDataFim(''); setBusca('')
  }

  if (!user) return <div className="p-8 text-center text-slate-500">Carregando...</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bbt-card p-6 bg-gradient-to-br from-bbt-primary via-bbt-primary-mid to-bbt-primary-light text-white overflow-hidden relative">
        <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-bbt-accent/10 blur-3xl"></div>
        <div className="relative flex items-center gap-5">
          <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-3xl font-bold shrink-0 ring-4 ring-white/10">
            {user.name.split(' ').slice(0, 2).map((n) => n[0]).join('')}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">{user.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-white/90 text-sm flex-wrap">
              <span className="truncate">{user.email}</span>
              {user.perfil_bbt && <span className="bbt-badge bg-white/20 backdrop-blur text-white text-xs">{perfilBBTLabel(user.perfil_bbt)}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={() => { setEditando(null); setNovaOpen(true) }}
              className="flex items-center gap-2 bg-bbt-accent text-bbt-primary font-semibold px-4 py-2 rounded-lg hover:bg-white transition shadow-lg">
              <Plus className="w-4 h-4" /> Nova Demanda
            </button>
            <button onClick={() => setImportarVoucherOpen(true)}
              className="flex items-center gap-2 bg-white/15 backdrop-blur text-white px-4 py-2 rounded-lg hover:bg-white/25 transition text-sm border border-white/30">
              <Wand2 className="w-4 h-4" /> Importar Voucher
            </button>
            <button onClick={gerarRelatorio}
              className="flex items-center gap-2 bg-white/10 backdrop-blur text-white px-4 py-2 rounded-lg hover:bg-white/20 transition text-sm border border-white/20">
              <Download className="w-4 h-4" /> Relatório PDF
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KPICard label="Total" value={stats.total} icon={BarChart3} color="bbt" />
        <KPICard label="Em Andamento" value={stats.por_status.em_andamento} icon={Clock} color="blue" />
        <KPICard label="Aguardando" value={stats.por_status.aguardando_cliente} icon={AlertCircle} color="amber" />
        <KPICard label="Pendente" value={stats.por_status.pendente} icon={AlertTriangle} color="orange" />
        <KPICard label="Finalizadas" value={stats.por_status.finalizado} icon={CheckCircle2} color="green" />
        <KPICard label="Canceladas" value={stats.por_status.cancelado} icon={XCircle} color="red" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <FinanceiroCard label="Custo (pagamos)" value={stats.custo_total} color="orange" icon={DollarSign} />
        <FinanceiroCard label="Markup (lucro)" value={stats.markup_total} color="green" icon={TrendingUp}
          subtitle={`${stats.margem_media_pct.toFixed(1)}% margem média`} />
        <FinanceiroCard label="Taxas" value={stats.taxa_total} color="purple" icon={Percent} />
        <FinanceiroCard label="Faturado (cliente paga)" value={stats.faturado_total} color="bbt" icon={DollarSign} big />
      </div>

      <div className="bbt-card p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <SearchInput value={busca} onChangeValue={setBusca} placeholder="Buscar passageiro, observação, localizador..." className="flex-1 min-w-[240px]" />
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as any)} className="bbt-input w-auto">
            <option value="todos">Status: Todos</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as any)} className="bbt-input w-auto">
            <option value="todos">Tipo: Todos</option>
            <option>Aéreo</option><option>Hotel</option><option>Carro</option><option>Pacote</option><option>Outro</option>
          </select>
          <select value={filtroPrio} onChange={(e) => setFiltroPrio(e.target.value as any)} className="bbt-input w-auto">
            <option value="todas">Prioridade: Todas</option>
            {Object.entries(PRIORIDADE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-3 items-center border-t border-bbt-gray-100 dark:border-slate-700 pt-3">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Período:</span>
          <DateInput aria-label="Data inicial do período" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-auto" containerClassName="w-auto" />
          <span className="text-slate-400">até</span>
          <DateInput aria-label="Data final do período" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-auto" containerClassName="w-auto" />
          <button onClick={limparFiltros} className="text-xs text-bbt-accent hover:underline ml-auto">Limpar filtros</button>
        </div>
      </div>

      <div className="bbt-card overflow-hidden">
        <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-bbt-accent" /> Minhas Demandas ({atendimentos.length})
          </h3>
        </div>
        {atendimentos.length === 0 ? (
          <div className="p-16 text-center">
            <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 mb-4">Nenhuma demanda encontrada.</p>
            <button onClick={() => { setEditando(null); setNovaOpen(true) }} className="bbt-button-primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Criar primeira demanda
            </button>
          </div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {atendimentos.map((a) => {
              const empresaNome = empresas.find((e) => e.id === a.empresa_id)?.nome || '—'
              return (
                <div key={a.id}>
                  <DemandaItem atendimento={a} empresaNome={empresaNome}
                    onEdit={() => handleEdit(a)}
                    onAnexar={() => { setAnexarAtendimento(a) }} />
                </div>
              )
            })}
          </div>
        )}
      </div>

      <NovaDemandaModal open={novaOpen}
        onClose={() => { setNovaOpen(false); setEditando(null); setReload((n) => n + 1) }}
        editing={editando} onSaved={() => setReload((n) => n + 1)} />
      <ImportarVoucherModal
        open={importarVoucherOpen}
        onClose={() => { setImportarVoucherOpen(false); setReload((n) => n + 1) }}
        onSaved={() => setReload((n) => n + 1)}
      />
      <AnexarVoucherModal open={!!anexarAtendimento}
        onClose={() => { setAnexarAtendimento(null); setReload((n) => n + 1) }}
        atendimento={anexarAtendimento} />
    </div>
  )
}

function KPICard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  const colors: Record<string, string> = {
    bbt: 'bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white shadow-md',
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/50',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-800/50',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border border-orange-100 dark:border-orange-800/50',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-100 dark:border-green-800/50',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-800/50',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color]} transition hover:scale-[1.02]`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</div>
        <Icon className="w-4 h-4 opacity-70" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

function FinanceiroCard({ label, value, color, icon: Icon, subtitle, big = false }: {
  label: string; value: number; color: string; icon: any; subtitle?: string; big?: boolean
}) {
  const colors: Record<string, string> = {
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/50',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800/50',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/50',
    bbt: 'bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white shadow-lg',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color]}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-80 mb-1">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`${big ? 'text-3xl' : 'text-2xl'} font-bold`}>{formatCurrency(value)}</div>
      {subtitle && <div className="text-[11px] opacity-75 mt-0.5">{subtitle}</div>}
    </div>
  )
}

function DemandaItem({ atendimento, empresaNome, onEdit, onAnexar }: {
  atendimento: Atendimento; empresaNome: string
  onEdit: () => void; onAnexar: () => void
}) {
  const Icon = TIPO_ICON[atendimento.tipo_servico] || FileText
  const prio: Prioridade = atendimento.prioridade || 'media'
  const calc = calcularFinanceiro(atendimento)

  const detalhes = (() => {
    if (atendimento.tipo_servico === 'Aéreo' && atendimento.detalhes_aereo) {
      const d = atendimento.detalhes_aereo
      return `${d.origem || '?'} → ${d.destino || '?'}${d.data_ida ? ` · ${formatDate(d.data_ida)}` : ''}${d.cia_aerea ? ` · ${d.cia_aerea}` : ''}`
    }
    if (atendimento.tipo_servico === 'Hotel' && atendimento.detalhes_hotel) {
      const d = atendimento.detalhes_hotel
      return `${d.hotel_nome || '?'}${d.cidade ? ` · ${d.cidade}` : ''}${d.data_checkin ? ` · ${formatDate(d.data_checkin)}` : ''}`
    }
    if (atendimento.tipo_servico === 'Carro' && atendimento.detalhes_carro) {
      const d = atendimento.detalhes_carro
      return `${d.locadora || '?'}${d.cidade_retirada ? ` · ${d.cidade_retirada}` : ''}${d.data_retirada ? ` · ${formatDate(d.data_retirada)}` : ''}`
    }
    return ''
  })()

  const localizador =
    atendimento.detalhes_aereo?.localizador || atendimento.detalhes_hotel?.localizador ||
    atendimento.detalhes_carro?.localizador || atendimento.detalhes_pacote?.localizador

  const numVouchers = atendimento.voucher_ids?.length || 0

  return (
    <div className="p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-bbt-accent/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-bbt-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-bbt-primary dark:text-white">{atendimento.passageiro_nome}</span>
            <span className={`bbt-badge text-[10px] ${STATUS_COLOR[atendimento.status]}`}>{STATUS_LABEL[atendimento.status]}</span>
            <span className={`bbt-badge text-[10px] font-bold ${PRIORIDADE_COLOR[prio]}`}>
              {prio === 'urgente' && <Zap className="w-2.5 h-2.5" />}
              {PRIORIDADE_LABEL[prio]}
            </span>
            {localizador && <span className="bbt-badge text-[10px] bg-bbt-primary text-white font-mono">{localizador}</span>}
          </div>
          <div className="text-xs text-slate-500 mt-1">{empresaNome} · {atendimento.tipo_servico}</div>
          {detalhes && <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{detalhes}</div>}
          {atendimento.observacoes && <div className="text-xs text-slate-500 mt-1 italic line-clamp-1">"{atendimento.observacoes}"</div>}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400 flex-wrap">
            <span>📅 {formatDate(atendimento.data_atendimento)}</span>
            {numVouchers > 0 && <span className="flex items-center gap-1 text-bbt-accent"><Paperclip className="w-3 h-3" /> {numVouchers} voucher{numVouchers > 1 ? 's' : ''}</span>}
            {atendimento.motivo && <span className="text-orange-600 dark:text-orange-400">⚠ {atendimento.motivo}</span>}
            {calc.markup > 0 && <span className="text-green-600 dark:text-green-400 font-semibold">📈 +{formatCurrency(calc.markup)} markup</span>}
            {calc.taxa_valor > 0 && <span className="text-purple-600 dark:text-purple-400">+{formatCurrency(calc.taxa_valor)} taxa</span>}
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-1 shrink-0">
          <div className="text-base font-bold text-bbt-primary dark:text-white">{formatCurrency(calc.total_faturado || calc.venda)}</div>
          {calc.custo > 0 && <div className="text-[10px] text-slate-400">custo {formatCurrency(calc.custo)}</div>}
          <div className="flex gap-1">
            <button onClick={onAnexar} className="p-1.5 rounded hover:bg-bbt-accent/10 text-slate-400 hover:text-bbt-accent transition" title="Anexar voucher"><Paperclip className="w-4 h-4" /></button>
            <button onClick={onEdit} className="p-1.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-400 hover:text-blue-600 transition" title="Editar"><Edit2 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import { addDaysISODate, todayISODate } from '@/lib/date'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useStore } from '@/lib/store'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import { formatDate, maskPhone, formatCurrency, maskCPF } from '@/lib/utils'
import { WhatsAppButton } from '@/components/ui/whatsapp-button'
import {
  ArrowLeft, Building2, Users, Mail, MapPin, Hash, DollarSign, Briefcase,
  FileText, Upload, TrendingUp, Hotel as HotelIcon, Calendar, BarChart3, Clock,
  AlertCircle, CheckCircle2, XCircle, UserRound,
} from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from 'sonner'
import { PoliticaModal } from '@/components/ui/politica-modal'
import { SolicitantesEmpresaTab } from '@/components/empresas/solicitantes-empresa-tab'
import { getEmissoesByEmpresa, getRankingHoteisByEmpresa, type Emissao } from '@/lib/emissoes-storage'
import { loadManualHotelBookingsFromServer } from '@/lib/manual-hotel-booking-client'
import { getEstatisticas, getAtendimentosByEmpresa, getEstatisticasPorTipo } from '@/lib/atendimentos-storage'
import { topFuncionariosViajantes, topHoteisPorEmpresa, serieTemporalDiaria } from '@/lib/agregacoes'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getSolicitantesPorEmpresa } from '@/lib/solicitantes-storage'
import type { PoliticaCargo, Cargo, StatusAtendimento } from '@/types'
import { STATUS_LABEL } from '@/types'

// Alias pra usar o ícone Hotel sem chocar com o tipo
const HotelEmojiIcon = HotelIcon

const ImportarFuncionariosModal = dynamic(
  () => import('@/components/ui/importar-funcionarios-modal').then((module) => module.ImportarFuncionariosModal),
  { ssr: false },
)
const ImportarEmpresaModal = dynamic(
  () => import('@/components/ui/importar-empresa-modal').then((module) => module.ImportarEmpresaModal),
  { ssr: false },
)

type Tab = 'dados' | 'funcionarios' | 'politicas' | 'emissoes' | 'atendimentos' | 'solicitantes'

export default function EmpresaDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { includesCompany } = useCorporateCompanyScope()
  const [tab, setTab] = useState<Tab>('dados')

  const { empresas, funcionarios, politicas, updatePolitica, addPolitica } = useStore()
  const empresa = empresas.find((e) => e.id === id)
  const funcs = funcionarios.filter((f) => f.company_id === id)
  const pols = politicas.filter((p) => p.company_id === id)

  const canViewEmployees = includesCompany(id, 'ver_funcionarios')
  const canManageEmployees = includesCompany(id, 'gerenciar_funcionarios')
  const canViewRequesters = includesCompany(id, 'ver_solicitantes')
  const canManageRequesters = includesCompany(id, 'gerenciar_solicitantes')
  const canEditPolicies = includesCompany(id, 'editar_politicas')
  const canViewDemands = includesCompany(id, 'ver_demandas')
  const canViewEmissions = includesCompany(id, 'ver_emissoes')
  const canViewFinance = includesCompany(id, 'ver_financeiro')
  const canImport = includesCompany(id, 'importar_planilhas')
  const [editingPol, setEditingPol] = useState<PoliticaCargo | null>(null)
  const [novaPolCargo, setNovaPolCargo] = useState<Cargo | null>(null)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importEmissoesOpen, setImportEmissoesOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  if (!empresa) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="text-slate-500 mb-4">Empresa não encontrada.</p>
        <Link href="/dashboard/empresas" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  if (!includesCompany(empresa.id, 'ver_empresas')) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="mb-4 text-slate-500">Você não tem permissão para acessar esta empresa.</p>
        <Link href="/dashboard/empresas" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'dados', label: 'Dados', icon: Building2 },
    ...(canViewEmployees ? [{ id: 'funcionarios' as const, label: 'Funcionários', icon: Users, count: funcs.length }] : []),
    ...(canViewRequesters ? [{ id: 'solicitantes' as const, label: 'Acessos', icon: UserRound, count: getSolicitantesPorEmpresa(id).length }] : []),
    { id: 'politicas', label: 'Políticas', icon: Briefcase },
    ...(canViewDemands ? [{ id: 'atendimentos' as const, label: 'Atendimentos', icon: BarChart3 }] : []),
    ...(canViewEmissions ? [{ id: 'emissoes' as const, label: 'Hotéis Emitidos', icon: FileText }] : []),
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-bbt-gray-50 dark:hover:bg-slate-800 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-bbt-primary dark:text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-bbt-accent" />
            {empresa.nome}
            {empresa.is_master_holding && (
              <span className="bbt-badge bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-xs">
                HOLDING
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500">{empresa.cnpj}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-bbt-gray-100 dark:border-slate-700">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition relative whitespace-nowrap ${
                  tab === t.id ? 'text-bbt-primary dark:text-bbt-accent' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" /> {t.label}
                {t.count != null && (
                  <span className="text-[10px] bg-bbt-gray-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded-full">{t.count}</span>
                )}
                {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-bbt-accent" />}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'dados' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bbt-card p-6 lg:col-span-2 space-y-4">
            <h2 className="font-semibold text-bbt-primary dark:text-white mb-3">Dados Cadastrais</h2>
            <Info icon={Hash} label="CNPJ" value={empresa.cnpj} />
            <Info icon={MapPin} label="Endereço" value={empresa.endereco} />
            <Info icon={Briefcase} label="Responsável" value={empresa.responsavel} />
            <Info icon={Mail} label="E-mail" value={empresa.email_responsavel} />
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-bbt-accent/10 flex items-center justify-center text-bbt-accent">📞</div>
              <div>
                <div className="text-xs text-slate-500">Telefone</div>
                <WhatsAppButton phone={empresa.telefone} />
              </div>
            </div>
            <Info icon={DollarSign} label="Centro de Custo Padrão" value={empresa.centro_custo_padrao} />
          </div>
          <div className="space-y-4">
            {canViewEmployees && <div className="bbt-card p-6">
              <div className="text-sm text-slate-500">Funcionários vinculados</div>
              <div className="text-4xl font-bold text-bbt-primary dark:text-white mt-2">{funcs.length}</div>
              <button onClick={() => setTab('funcionarios')} className="text-sm text-bbt-accent hover:underline mt-3 inline-flex items-center gap-1">
                <Users className="w-4 h-4" /> Ver funcionários
              </button>
            </div>}
            {canViewRequesters && <div className="bbt-card p-6">
              <div className="text-sm text-slate-500">Acessos do portal</div>
              <div className="text-4xl font-bold text-bbt-primary dark:text-white mt-2">{getSolicitantesPorEmpresa(id).length}</div>
              <button onClick={() => setTab('solicitantes')} className="text-sm text-bbt-accent hover:underline mt-3 inline-flex items-center gap-1">
                <UserRound className="w-4 h-4" /> Gerenciar acessos
              </button>
            </div>}
            <div className="bbt-card p-6">
              <div className="text-sm text-slate-500">Status</div>
              <div className="mt-2">
                {empresa.ativa ? <span className="bbt-badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-sm px-3 py-1">● Ativa</span> : <span className="bbt-badge bg-slate-100 text-slate-600 text-sm px-3 py-1">Inativa</span>}
              </div>
              <div className="text-xs text-slate-500 mt-4">Cadastrada em {formatDate(empresa.created_at)}</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'funcionarios' && (
        <FuncionariosTab companyId={empresa.id} companyName={empresa.nome} funcs={funcs} canEdit={canManageEmployees} onImport={() => setImportModalOpen(true)} />
      )}

      {tab === 'solicitantes' && (
        <SolicitantesEmpresaTab empresa={empresa} funcionarios={funcionarios} canEdit={canManageRequesters} />
      )}

      {tab === 'politicas' && (
        <PoliticasTab
          empresaId={empresa.id}
          politicas={pols}
          canEdit={canEditPolicies}
          onEdit={(p) => setEditingPol(p)}
          onNova={(cargo) => setNovaPolCargo(cargo)}
        />
      )}

      {tab === 'atendimentos' && (
        <AtendimentosTab
          empresaId={empresa.id}
          empresaNome={empresa.nome}
          funcionarios={funcionarios}
          onImportar={() => setImportEmissoesOpen(true)}
          canImport={canImport}
          canViewFinance={canViewFinance}
          reloadKey={reloadKey}
        />
      )}

      {tab === 'emissoes' && <EmissoesTab companyId={empresa.id} companyName={empresa.nome} canViewFinance={canViewFinance} />}

      {canEditPolicies && <PoliticaModal
        open={!!editingPol || !!novaPolCargo}
        onClose={() => { setEditingPol(null); setNovaPolCargo(null) }}
        politica={editingPol}
        novaParaEmpresa={novaPolCargo ? { company_id: empresa.id, cargo: novaPolCargo } : undefined}
        onSave={(patch) => {
          if (editingPol) {
            updatePolitica(editingPol.id, patch)
            toast.success('Política atualizada!')
            setEditingPol(null)
          } else if (novaPolCargo) {
            addPolitica({
              company_id: empresa.id,
              cargo: novaPolCargo,
              limite_diaria_hotel: patch.limite_diaria_hotel || 500,
              hoteis_max_estrelas: patch.hoteis_max_estrelas || 3,
              antecedencia_hotel_dias: patch.antecedencia_hotel_dias || 0,
              classe_aerea: patch.classe_aerea || 'Econômica',
              classe_aerea_internacional: patch.classe_aerea_internacional || 'Econômica',
              valor_maximo_aereo_domestico: patch.valor_maximo_aereo_domestico || 1500,
              valor_maximo_aereo_internacional: patch.valor_maximo_aereo_internacional || 5000,
              antecedencia_aereo_domestico_dias: patch.antecedencia_aereo_domestico_dias || 0,
              antecedencia_aereo_internacional_dias: patch.antecedencia_aereo_internacional_dias || 0,
              aprovacao_automatica: patch.aprovacao_automatica || false,
              observacoes: patch.observacoes || '',
              titulo: patch.titulo,
              escalao: patch.escalao,
              politica_hotel_texto: patch.politica_hotel_texto,
              politica_aerea_texto: patch.politica_aerea_texto,
            } as any)
            toast.success('Política criada!')
            setNovaPolCargo(null)
          }
        }}
      />}

      {canManageEmployees && <ImportarFuncionariosModal open={importModalOpen} onClose={() => setImportModalOpen(false)} companyId={empresa.id} companyName={empresa.nome} />}
      {canImport && <ImportarEmpresaModal
        open={importEmissoesOpen}
        onClose={() => setImportEmissoesOpen(false)}
        empresa={empresa}
        onCompleto={() => setReloadKey((k) => k + 1)}
      />}
    </div>
  )
}

// ======== FUNCIONÁRIOS ========
function FuncionariosTab({ companyId, companyName, funcs, canEdit, onImport }: any) {
  const [search, setSearch] = useState('')
  const [cargoFilter, setCargoFilter] = useState<Cargo | 'Todos'>('Todos')

  const filtered = funcs.filter((f: any) => {
    if (cargoFilter !== 'Todos' && f.cargo !== cargoFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return f.nome.toLowerCase().includes(q)
        || (f.centro_custo || '').toLowerCase().includes(q)
        || (f.cpf || '').includes(q.replace(/\D/g, ''))
    }
    return true
  })

  return (
    <div className="space-y-4">
      <div className="bbt-card p-4 flex flex-wrap items-center gap-3">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar por nome, CPF ou centro de custo..." className="bbt-input flex-1 min-w-[200px]" />
        <select value={cargoFilter} onChange={(e) => setCargoFilter(e.target.value as any)} className="bbt-input w-auto">
          <option>Todos</option><option>Diretor</option><option>Gerente</option><option>Colaborador</option>
        </select>
        {canEdit && (
          <button onClick={onImport} className="bbt-button-primary flex items-center gap-2">
            <Upload className="w-4 h-4" /> Importar Planilha
          </button>
        )}
        <Link href={`/dashboard/funcionarios?empresa=${companyId}`} className="bbt-button-ghost flex items-center gap-2">
          <Users className="w-4 h-4" /> Gerenciar completo
        </Link>
      </div>

      <div className="bbt-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bbt-gray-50 dark:bg-slate-900/50 border-b border-bbt-gray-100 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Funcionário</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">CPF</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Cargo</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Centro de Custo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-slate-400">
                  {funcs.length === 0 ? 'Nenhum funcionário. Clique em "Importar Planilha".' : 'Nenhum funcionário encontrado.'}
                </td></tr>
              ) : filtered.slice(0, 100).map((f: any) => (
                <tr key={f.id} className="border-b border-bbt-gray-100 dark:border-slate-700 last:border-0 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/funcionarios/${f.id}`} className="font-medium text-bbt-text dark:text-slate-100 hover:text-bbt-accent">{f.nome}</Link>
                    {f.matricula && <div className="text-xs text-slate-400">Matr: {f.matricula}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.cpf ? maskCPF(f.cpf) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`bbt-badge text-xs ${
                      f.cargo === 'Diretor' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                      : f.cargo === 'Gerente' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    }`}>{f.cargo}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.centro_custo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <div className="p-3 bg-bbt-gray-50 dark:bg-slate-900/40 text-xs text-center text-slate-500 border-t border-bbt-gray-100 dark:border-slate-700">
              Mostrando 100 de {filtered.length}. Use o menu Funcionários para paginar.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ======== ATENDIMENTOS (novo) ========
function AtendimentosTab({ empresaId, empresaNome, funcionarios, onImportar, canImport, canViewFinance, reloadKey }: {
  empresaId: string
  empresaNome: string
  funcionarios: any[]
  onImportar?: () => void
  canImport: boolean
  canViewFinance: boolean
  reloadKey?: number
}) {
  const [stats, setStats] = useState(() => getEstatisticas({ empresa_id: empresaId }))
  const [statsTipo, setStatsTipo] = useState(() => getEstatisticasPorTipo({ empresa_id: empresaId }))
  const [atendimentos, setAtendimentos] = useState(() => getAtendimentosByEmpresa(empresaId))
  const [topFuncs, setTopFuncs] = useState(() => topFuncionariosViajantes(empresaId, 5, funcionarios))
  const [topHot, setTopHot] = useState(() => topHoteisPorEmpresa(empresaId, 5))
  const [serie, setSerie] = useState(() => {
    const ini = addDaysISODate(todayISODate(), -90)
    const fim = todayISODate()
    return serieTemporalDiaria({ empresa_id: empresaId, data_inicio: ini, data_fim: fim })
  })

  const podeFinanceiro = canViewFinance

  useEffect(() => {
    setStats(getEstatisticas({ empresa_id: empresaId }))
    setStatsTipo(getEstatisticasPorTipo({ empresa_id: empresaId }))
    setAtendimentos(getAtendimentosByEmpresa(empresaId))
    setTopFuncs(topFuncionariosViajantes(empresaId, 5, funcionarios))
    setTopHot(topHoteisPorEmpresa(empresaId, 5))
    const ini = addDaysISODate(todayISODate(), -90)
    const fim = todayISODate()
    setSerie(serieTemporalDiaria({ empresa_id: empresaId, data_inicio: ini, data_fim: fim }))
  }, [empresaId, funcionarios, reloadKey])

  const ticketMedio = stats.total > 0 ? stats.faturado_total / stats.total : 0

  return (
    <div className="space-y-6">
      {onImportar && canImport && (
        <div className="flex justify-end">
          <button onClick={onImportar} className="bbt-button-primary flex items-center gap-2">
            <Upload className="w-4 h-4" /> Importar emissões desta empresa
          </button>
        </div>
      )}

      {/* KPIs status */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Total" value={stats.total} icon={FileText} color="bbt" />
        <KPI label="Em Andamento" value={stats.por_status.em_andamento} icon={Clock} color="blue" />
        <KPI label="Aguardando" value={stats.por_status.aguardando_cliente} icon={AlertCircle} color="amber" />
        <KPI label="Finalizados" value={stats.por_status.finalizado} icon={CheckCircle2} color="green" />
        <KPI label="Cancelados" value={stats.por_status.cancelado} icon={XCircle} color="red" />
      </div>

      {/* Resumo financeiro V8 */}
      {podeFinanceiro && (
        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" /> Resumo financeiro de {empresaNome}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-xl p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200">
              <div className="text-[10px] uppercase tracking-wider text-orange-600 font-semibold">Custo total</div>
              <div className="text-xl font-bold text-orange-700 dark:text-orange-300 mt-1">{formatCurrency(stats.custo_total)}</div>
            </div>
            <div className="rounded-xl p-3 bg-green-50 dark:bg-green-900/20 border border-green-200">
              <div className="text-[10px] uppercase tracking-wider text-green-600 font-semibold">Markup (lucro)</div>
              <div className="text-xl font-bold text-green-700 dark:text-green-300 mt-1">{formatCurrency(stats.markup_total)}</div>
              <div className="text-[10px] text-green-600 mt-0.5">{stats.margem_media_pct.toFixed(1)}% margem</div>
            </div>
            <div className="rounded-xl p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200">
              <div className="text-[10px] uppercase tracking-wider text-purple-600 font-semibold">Taxas cobradas</div>
              <div className="text-xl font-bold text-purple-700 dark:text-purple-300 mt-1">{formatCurrency(stats.taxa_total)}</div>
            </div>
            <div className="rounded-xl p-3 bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white">
              <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">Faturado total</div>
              <div className="text-xl font-bold mt-1">{formatCurrency(stats.faturado_total)}</div>
              <div className="text-[10px] opacity-80 mt-0.5">Ticket médio: {formatCurrency(ticketMedio)}</div>
            </div>
          </div>

          {/* Por tipo de serviço */}
          <div className="mt-4 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Por tipo de serviço</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(Object.entries(statsTipo) as [string, any][]).filter(([, v]) => v.quantidade > 0).map(([tipo, v]) => (
                <div key={tipo} className="rounded-lg p-2.5 bg-bbt-gray-50 dark:bg-slate-800">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{tipo}</div>
                  <div className="text-base font-bold text-bbt-primary dark:text-white mt-0.5">{v.quantidade}</div>
                  <div className="text-[10px] text-slate-500">Faturado: {formatCurrency(v.faturado)}</div>
                  <div className="text-[10px] text-green-600">Markup: {formatCurrency(v.markup)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mini gráfico temporal (últimos 90 dias) */}
      {serie.length > 0 && (
        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-bbt-accent" /> Evolução de demandas (últimos 90 dias)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={serie}>
              <defs>
                <linearGradient id="empColorDem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00BFFF" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#00BFFF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" stroke="#64748b" fontSize={10} interval={Math.max(0, Math.floor(serie.length / 12))} />
              <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <Area type="monotone" dataKey="demandas" stroke="#00BFFF" fill="url(#empColorDem)" name="Demandas" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top funcionários e top hotéis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <Users className="w-5 h-5 text-bbt-accent" /> Top 5 viajantes
          </h3>
          {topFuncs.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-6">Sem dados ainda</div>
          ) : (
            <div className="space-y-2">
              {topFuncs.map((f, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-bbt-gray-50 dark:bg-slate-800">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-6 h-6 rounded-full bg-bbt-accent/20 text-bbt-accent text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="text-sm font-medium truncate">{f.nome}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-bbt-primary dark:text-white">{f.total}<span className="text-[10px] text-slate-500"> viagens</span></div>
                    {podeFinanceiro && <div className="text-[10px] text-green-600">{formatCurrency(f.faturado)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <HotelEmojiIcon className="w-5 h-5 text-bbt-accent" /> Top 5 hotéis usados
          </h3>
          {topHot.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-6">Sem hospedagens registradas</div>
          ) : (
            <div className="space-y-2">
              {topHot.map((h, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-bbt-gray-50 dark:bg-slate-800">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-6 h-6 rounded-full bg-bbt-accent/20 text-bbt-accent text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{h.hotel}</div>
                      {h.cidade && <div className="text-[10px] text-slate-500">{h.cidade}</div>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-bbt-primary dark:text-white">{h.total}<span className="text-[10px] text-slate-500"> usos</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bbt-card overflow-hidden">
        <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700">
          <h3 className="font-semibold text-bbt-primary dark:text-white">Atendimentos de {empresaNome}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Mostrando últimos 30. Use a aba Demandas para ver tudo com filtros.</p>
        </div>
        {atendimentos.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">Nenhum atendimento registrado ainda.</div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700 max-h-96 overflow-y-auto">
            {atendimentos.slice(0, 30).map((a) => (
              <div key={a.id} className="p-3 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition flex items-center gap-3">
                <StatusBadge status={a.status} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{a.tipo_servico} — {a.passageiro_nome}</div>
                  <div className="text-xs text-slate-500">{formatDate(a.data_atendimento)}</div>
                </div>
                <div className="text-sm font-semibold text-bbt-primary dark:text-white">{formatCurrency(a.valor_cotacao)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function KPI({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  const colors: Record<string, string> = {
    bbt: 'bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white',
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
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

function StatusBadge({ status }: { status: StatusAtendimento }) {
  const cfg: Record<StatusAtendimento, { color: string; icon: any }> = {
    em_andamento: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: Clock },
    aguardando_cliente: { color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: AlertCircle },
    pendente: { color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300', icon: AlertCircle },
    finalizado: { color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
    cancelado: { color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: XCircle },
  }
  const { color, icon: Icon } = cfg[status]
  return <span className={`bbt-badge text-[10px] ${color}`}><Icon className="w-3 h-3" /> {STATUS_LABEL[status]}</span>
}

// ======== EMISSÕES (preservado das versões anteriores) ========
function EmissoesTab({ companyId, companyName, canViewFinance }: { companyId: string; companyName: string; canViewFinance: boolean }) {
  const { hoteis } = useStore()
  const [emissoes, setEmissoes] = useState<Emissao[]>([])

  useEffect(() => {
    let active = true
    setEmissoes(getEmissoesByEmpresa(companyId))
    void loadManualHotelBookingsFromServer(companyId)
      .then((items) => {
        if (active) setEmissoes(items)
      })
      .catch((error) => {
        if (active) {
          toast.error(
            error instanceof Error ? error.message : 'Falha ao carregar as hospedagens.',
          )
        }
      })
    return () => {
      active = false
    }
  }, [companyId])

  const ranking = getRankingHoteisByEmpresa(companyId)
  const totalEmissoes = emissoes.length
  const totalValor = emissoes.reduce((s, e) => s + (e.valor_total || 0), 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="bbt-card p-5"><div className="text-xs text-slate-500 uppercase tracking-wider">Emissões</div><div className="text-3xl font-bold text-bbt-primary dark:text-white mt-2">{totalEmissoes}</div></div>
        <div className="bbt-card p-5"><div className="text-xs text-slate-500 uppercase tracking-wider">Hotéis diferentes</div><div className="text-3xl font-bold text-bbt-primary dark:text-white mt-2">{ranking.length}</div></div>
        <div className="bbt-card p-5"><div className="text-xs text-slate-500 uppercase tracking-wider">Total</div><div className="text-3xl font-bold text-bbt-primary dark:text-white mt-2">{canViewFinance ? formatCurrency(totalValor) : 'Restrito'}</div></div>
      </div>

      <div className="bbt-card overflow-hidden">
        <div className="p-5 border-b border-bbt-gray-100 dark:border-slate-700">
          <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-bbt-accent" /> Hotéis mais emitidos para {companyName}
          </h3>
        </div>
        {ranking.length === 0 ? (
          <div className="p-12 text-center">
            <HotelIcon className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">Nenhuma emissão registrada ainda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bbt-gray-50 dark:bg-slate-900/30">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Hotel</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Cidade</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Emissões</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Valor</th>
                </tr>
              </thead>
              <tbody>
                {ranking.slice(0, 10).map((r, idx) => {
                  const hotel = hoteis.find((h) => h.id === r.hotel_id)
                  return (
                    <tr key={r.hotel_id} className="border-t border-bbt-gray-100 dark:border-slate-700 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-bold text-xs ${
                          idx === 0 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                          : idx === 1 ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          : idx === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                          : 'bg-bbt-gray-50 dark:bg-slate-800 text-slate-500'
                        }`}>{idx + 1}</span>
                      </td>
                      <td className="px-4 py-3">{hotel ? <Link href={`/dashboard/hoteis/${hotel.id}`} className="font-medium hover:text-bbt-accent">{hotel.nome}</Link> : '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{hotel ? `${hotel.cidade} · ${hotel.uf}` : '—'}</td>
                      <td className="px-4 py-3 text-right"><span className="bbt-badge bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent"><FileText className="w-3 h-3" /> {r.total}</span></td>
                      <td className="px-4 py-3 text-right font-semibold text-bbt-primary dark:text-white">{canViewFinance ? formatCurrency(r.valor_total) : 'Restrito'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ======== POLITICAS (aba completa com hotel + aéreo) ========
function PoliticasTab({ empresaId, politicas, canEdit, onEdit, onNova }: {
  empresaId: string
  politicas: PoliticaCargo[]
  canEdit: boolean
  onEdit: (p: PoliticaCargo) => void
  onNova: (cargo: Cargo) => void
}) {
  const cargosSemPolitica: Cargo[] = (['Diretor', 'Gerente', 'Colaborador'] as Cargo[])
    .filter((c) => !politicas.find((p) => p.cargo === c))

  const cargoColor = (c: Cargo) => c === 'Diretor'
    ? { badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300', text: 'text-purple-700 dark:text-purple-400' }
    : c === 'Gerente'
    ? { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', text: 'text-blue-700 dark:text-blue-400' }
    : { badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', text: 'text-green-700 dark:text-green-400' }

  return (
    <div className="space-y-4">
      <div className="bbt-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2 text-lg">
              <Briefcase className="w-5 h-5 text-bbt-accent" /> Políticas de Viagem por Cargo
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Configure limites separados para Hotel e Aéreo, com antecedência e valores máximos</p>
          </div>
          {canEdit && cargosSemPolitica.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {cargosSemPolitica.map((c) => (
                <button
                  key={c}
                  onClick={() => onNova(c)}
                  className="bbt-button-ghost flex items-center gap-1 text-sm border border-bbt-accent/30 hover:bg-bbt-accent/10"
                >
                  + Nova Política: {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {politicas.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-bbt-gray-100 dark:border-slate-700 rounded-xl">
            <Briefcase className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="text-slate-500 mb-3">Nenhuma política cadastrada ainda.</p>
            {canEdit && (
              <div className="flex gap-2 justify-center">
                {(['Diretor', 'Gerente', 'Colaborador'] as Cargo[]).map((c) => (
                  <button key={c} onClick={() => onNova(c)} className="bbt-button-primary text-sm">+ {c}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {politicas.sort((a, b) => {
              const ord = ['Diretor', 'Gerente', 'Colaborador']
              return ord.indexOf(a.cargo) - ord.indexOf(b.cargo)
            }).map((p) => {
              const cc = cargoColor(p.cargo)
              return (
                <div key={p.id} className="border border-bbt-gray-100 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-800 flex flex-col">
                  {/* Cabeçalho */}
                  <div className={`p-4 ${p.cargo === 'Diretor' ? 'bg-purple-50 dark:bg-purple-900/20' : p.cargo === 'Gerente' ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className={`bbt-badge text-[10px] ${cc.badge}`}>{p.escalao || p.cargo}</span>
                        <h3 className={`font-bold text-lg mt-1 ${cc.text}`}>{p.titulo || p.cargo}</h3>
                      </div>
                      {canEdit && (
                        <button onClick={() => onEdit(p)} className="p-1.5 rounded hover:bg-white dark:hover:bg-slate-700 transition text-slate-500 hover:text-bbt-accent" title="Editar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* HOTEL */}
                  <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
                      🏨 Hotel
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      <PolLinha label="Limite diária" valor={`R$ ${(p.limite_diaria_hotel || 0).toFixed(2)}`} />
                      <PolLinha label="Máx. estrelas" valor={`${p.hoteis_max_estrelas || 3} ⭐`} />
                      <PolLinha label="Antecedência" valor={`${p.antecedencia_hotel_dias ?? 0} dia(s)`} />
                    </ul>
                    {p.politica_hotel_texto && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 italic line-clamp-3">
                        {p.politica_hotel_texto}
                      </p>
                    )}
                  </div>

                  {/* AÉREO */}
                  <div className="p-4 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
                      ✈️ Aéreo
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      <PolLinha label="Classe doméstica" valor={p.classe_aerea || '—'} />
                      <PolLinha label="Máx. doméstico" valor={`R$ ${(p.valor_maximo_aereo_domestico || 0).toFixed(2)}`} />
                      <PolLinha label="Antec. doméstico" valor={`${p.antecedencia_aereo_domestico_dias ?? 0} dia(s)`} />
                      <PolLinha label="Classe intl." valor={p.classe_aerea_internacional || '—'} />
                      <PolLinha label="Máx. intl." valor={`R$ ${(p.valor_maximo_aereo_internacional || 0).toFixed(2)}`} />
                      <PolLinha label="Antec. intl." valor={`${p.antecedencia_aereo_internacional_dias ?? 0} dia(s)`} />
                    </ul>
                    {p.politica_aerea_texto && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 italic line-clamp-2">
                        {p.politica_aerea_texto}
                      </p>
                    )}
                  </div>

                  {/* Rodapé */}
                  <div className="px-4 py-2.5 bg-bbt-gray-50 dark:bg-slate-900/40 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Aprovação automática:</span>
                    <span className={`font-semibold ${p.aprovacao_automatica ? 'text-green-600 dark:text-green-400' : 'text-slate-500'}`}>
                      {p.aprovacao_automatica ? '✓ Ativa' : '✗ Requer autorização'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PolLinha({ label, valor }: { label: string; valor: string }) {
  return (
    <li className="flex justify-between items-baseline gap-2 text-xs">
      <span className="text-slate-500 dark:text-slate-400">{label}:</span>
      <span className="font-semibold text-bbt-primary dark:text-white text-right">{valor}</span>
    </li>
  )
}

function Info({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 shrink-0 rounded-lg bg-bbt-accent/10 flex items-center justify-center"><Icon className="w-4 h-4 text-bbt-accent" /></div>
      <div className="flex-1 min-w-0"><div className="break-words text-xs leading-tight text-slate-500 [overflow-wrap:anywhere]">{label}</div><div className="break-words text-sm leading-tight text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200">{value || '—'}</div></div>
    </div>
  )
}

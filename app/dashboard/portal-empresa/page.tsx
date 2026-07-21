'use client'
import { addDaysISODate, todayISODate } from '@/lib/date'
/**
 * Portal da Empresa — V15 (Super Portal)
 *
 * Painel completo para o solicitante / company_admin com:
 *  - Hero corporativo no estilo do login (dark gradient + grid)
 *  - Cockpit pessoal: minhas viagens, em campo agora, pegada, gasto
 *  - 6 abas: Home / Minhas viagens / Pedidos / Vouchers / Financeiro / Pegada
 *  - IA Super-Secretária flutuante com prompts rápidos
 *  - Layout mobile-first, cards com hover, animações suaves
 *  - Conectado: usa store, atendimentos, vouchers, financeiro, ESG, alertas
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Briefcase,
  Building2, CalendarCheck, CalendarDays, Car, CheckCircle2, Clock,
  CreditCard, Download, FileText, Hotel as HotelIcon, LayoutDashboard, Leaf, MapPin, Plane,
  Plus, ReceiptText, Send, Sparkles, TrendingDown, TrendingUp,
  Wallet, ChevronRight, Users, ShieldCheck, Landmark, LockKeyhole,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

import { canEditGlobal, getCurrentUser, getEmpresasPermitidas } from '@/lib/auth'
import { addAtendimento, getAllAtendimentos } from '@/lib/atendimentos-storage'
import {
  atualizarCarteiraEmpresa,
  criarCartaoCorporativo,
  garantirCarteiraEmpresa,
  registrarMovimentoCarteira,
  resumoCarteiraEmpresa,
} from '@/lib/corporate-finance'
import { getAllLancamentos } from '@/lib/financeiro'
import { getSolicitantePorEmail, getSolicitantesPorEmpresa } from '@/lib/solicitantes-storage'
import { formatCurrency, formatDate } from '@/lib/utils'
import { getOperationalAlerts } from '@/lib/operational-alerts'
import { useStore } from '@/lib/store'
import { getAllVouchersEmitidos } from '@/lib/vouchers-emitidos-storage'
import { getEmpresasDoGrupo } from '@/lib/grupos'
import { encontrarFuncionarioPorCodigo, resolverFuncionarioAtendimento } from '@/lib/funcionario-identidade'
import {
  arvoresEquivalentes, calcularPegadaAtendimento, formatarKg,
} from '@/lib/esg-carbon'
import { listarViajantes } from '@/lib/duty-of-care'
import { AI_SHORT_NAME } from '@/lib/branding'
import { AIAssistantFab, AI_CONTEXT_EVENTS } from '@/components/ai/ai-assistant-fab'
import type { Atendimento, CartaoCorporativo, Empresa, Prioridade, TipoServico } from '@/types'
import { filtrarPeriodo, montarMetricasRelatorio, montarRelatorioOperacional } from '@/lib/relatorios'
import { createEntityId } from '@/lib/ids'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'

type Aba = 'home' | 'empresa' | 'viagens' | 'pedidos' | 'vouchers' | 'financeiro' | 'carteira' | 'relatorios' | 'pegada'
type EscopoPortal = 'empresa' | 'grupo'

const heroBgImage =
  'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=2000&q=85'

function montarResumoCarteiraEscopo(empresas: Array<Pick<Empresa, 'id'>>) {
  if (empresas.length === 0) return null
  const resumos = empresas.map((empresa) => resumoCarteiraEmpresa(empresa.id))
  const carteiras = resumos.map((resumo) => resumo.carteira).filter(Boolean) as NonNullable<ReturnType<typeof resumoCarteiraEmpresa>['carteira']>[]
  const cartoes = resumos.flatMap((resumo) => resumo.cartoes)
  const faturas = resumos.flatMap((resumo) => resumo.faturas)
  const movimentos = resumos.flatMap((resumo) => resumo.movimentos).sort((a, b) => b.created_at.localeCompare(a.created_at))

  return {
    carteira: empresas.length === 1
      ? resumos[0]?.carteira
      : {
          id: 'wallet-grupo',
          company_id: 'grupo',
          saldo_disponivel: carteiras.reduce((sum, carteira) => sum + Number(carteira.saldo_disponivel || 0), 0),
          limite_credito: carteiras.reduce((sum, carteira) => sum + Number(carteira.limite_credito || 0), 0),
          limite_pix_diario: carteiras.reduce((sum, carteira) => sum + Number(carteira.limite_pix_diario || 0), 0),
          limite_cartao_mensal: carteiras.reduce((sum, carteira) => sum + Number(carteira.limite_cartao_mensal || 0), 0),
          status: carteiras.some((carteira) => carteira.status === 'ativa') ? 'ativa' : 'pendente_configuracao',
          pix_habilitado: carteiras.some((carteira) => carteira.pix_habilitado),
          cartao_habilitado: carteiras.some((carteira) => carteira.cartao_habilitado),
          provedor: 'consolidado',
          created_at: new Date().toISOString(),
        },
    cartoes,
    faturas,
    movimentos,
    total_cartoes_ativos: cartoes.filter((cartao) => cartao.status === 'ativo').length,
    faturas_abertas: faturas.filter((fatura) => ['aberta', 'vencida', 'fechada'].includes(fatura.status)).length,
    valor_faturas_abertas: faturas
      .filter((fatura) => ['aberta', 'vencida', 'fechada'].includes(fatura.status))
      .reduce((sum, fatura) => sum + Math.max(0, fatura.valor_total - fatura.valor_pago), 0),
    gasto_cartao_mes: cartoes.reduce((sum, cartao) => sum + Number(cartao.gasto_mes || 0), 0),
  }
}

export default function PortalEmpresaPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const isGlobalMaster = canEditGlobal(user)
  const isInternalUser = user?.role === 'master'
  const { empresas, funcionarios, politicas, gruposEmpresariais } = useStore()
  const [reload, setReload] = useState(0)
  const [aba, setAba] = useState<Aba>('home')
  const [escopo, setEscopo] = useState<EscopoPortal>(user?.grupo_ids?.length ? 'grupo' : 'empresa')
  const [empresaId, setEmpresaId] = useState(user?.company_id || user?.empresa_ids?.[0] || '')
  const [grupoId, setGrupoId] = useState(user?.grupo_ids?.[0] || '')

  const empresasVisiveis = useMemo(
    () => getEmpresasPermitidas(user, empresas, gruposEmpresariais),
    [empresas, gruposEmpresariais, user],
  )
  const gruposVisiveis = useMemo(
    () => gruposEmpresariais.filter((grupo) => getEmpresasDoGrupo(grupo.id, empresasVisiveis, gruposEmpresariais).length > 0),
    [empresasVisiveis, gruposEmpresariais],
  )

  useEffect(() => {
    if (!empresaId && empresasVisiveis[0]) setEmpresaId(empresasVisiveis[0].id)
  }, [empresasVisiveis, empresaId])

  useEffect(() => {
    if (!grupoId && gruposVisiveis[0]) setGrupoId(gruposVisiveis[0].id)
  }, [gruposVisiveis, grupoId])

  useEffect(() => {
    if (escopo === 'grupo' && gruposVisiveis.length === 0) setEscopo('empresa')
    if (escopo === 'empresa' && empresasVisiveis.length === 0 && gruposVisiveis.length > 0) setEscopo('grupo')
  }, [empresasVisiveis.length, escopo, gruposVisiveis.length])

  useEffect(() => {
    if (empresaId && !empresasVisiveis.some((empresa) => empresa.id === empresaId)) {
      setEmpresaId(empresasVisiveis[0]?.id || '')
    }
  }, [empresaId, empresasVisiveis])

  useEffect(() => {
    if (grupoId && !gruposVisiveis.some((grupo) => grupo.id === grupoId)) {
      setGrupoId(gruposVisiveis[0]?.id || '')
    }
  }, [grupoId, gruposVisiveis])

  const grupoSel = gruposEmpresariais.find((grupo) => grupo.id === grupoId)
  const empresasEscopo = useMemo(() => {
    if (escopo === 'grupo' && grupoId) return getEmpresasDoGrupo(grupoId, empresasVisiveis, gruposEmpresariais)
    return empresasVisiveis.filter((empresa) => empresa.id === empresaId)
  }, [empresaId, empresasVisiveis, escopo, grupoId, gruposEmpresariais])
  const empresaIdsEscopo = useMemo(() => new Set(empresasEscopo.map((empresa) => empresa.id)), [empresasEscopo])
  const empresaSel = escopo === 'empresa'
    ? empresasVisiveis.find((e) => e.id === empresaId)
    : empresasEscopo[0]
  const escopoNome = escopo === 'grupo'
    ? (grupoSel?.nome || 'Grupo empresarial')
    : (empresaSel?.nome || 'Empresa')
  const funcionariosEmpresa = useMemo(
    () => funcionarios.filter((funcionario) => empresaIdsEscopo.has(funcionario.company_id)),
    [empresaIdsEscopo, funcionarios],
  )
  const politicasEmpresa = useMemo(
    () => politicas.filter((politica) => empresaIdsEscopo.has(politica.company_id)),
    [empresaIdsEscopo, politicas],
  )
  const solicitantesEmpresa = useMemo(
    () => empresasEscopo.flatMap((empresa) =>
      getSolicitantesPorEmpresa(empresa.id).map((solicitante) => ({ ...solicitante, empresa_nome: empresa.nome })),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empresasEscopo, reload],
  )

  const solicitanteAtual =
    !isInternalUser && user?.company_id && user?.email
      ? getSolicitantePorEmail(user.company_id, user.email)
      : null
  const solicitanteBloqueado = solicitanteAtual?.status === 'bloqueado'
  const podeCriarPedido = (isInternalUser || !solicitanteAtual || solicitanteAtual.pode_criar_demanda) && escopo === 'empresa'
  const podeVerVouchers = isInternalUser || !solicitanteAtual || solicitanteAtual.pode_ver_vouchers
  const podeVerFinanceiro = isInternalUser || Boolean(solicitanteAtual?.pode_ver_financeiro)

  const atendimentos = useMemo(
    () => getAllAtendimentos().filter((a) => empresaIdsEscopo.has(a.empresa_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empresaIdsEscopo, reload],
  )
  const vouchers = useMemo(
    () => getAllVouchersEmitidos().filter((v) => empresaIdsEscopo.has((v as any).empresa_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empresaIdsEscopo, reload],
  )
  const lancamentos = useMemo(
    () => getAllLancamentos().filter((l) => Boolean(l.empresa_id) && empresaIdsEscopo.has(l.empresa_id!)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empresaIdsEscopo, reload],
  )
  const carteira = useMemo(
    () => montarResumoCarteiraEscopo(empresasEscopo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empresasEscopo, reload],
  )
  const alertas = useMemo(
    () => getOperationalAlerts({ atendimentos, vouchers }),
    [atendimentos, vouchers],
  )
  const viajantes = useMemo(
    () => listarViajantes({
      atendimentos,
      vouchers,
      empresas: empresasEscopo.map((e) => ({ id: e.id, nome: e.nome })),
    }),
    [atendimentos, vouchers, empresasEscopo],
  )

  const emCampoAgora = viajantes.filter((v) => v.status === 'em_viagem')
  const proximas7d = viajantes.filter((v) => v.status === 'planejada')

  const stats = useMemo(() => {
    const hoje = todayISODate()
    const inicioMes = hoje.slice(0, 8) + '01'
    const atendimentosMes = atendimentos.filter((a) => a.data_atendimento >= inicioMes)
    const gastoMes = atendimentosMes.reduce(
      (s, a) => s + (a.valor_final || a.valor_venda || a.valor_cotacao || 0),
      0,
    )
    const pegadas = atendimentos
      .map((a) => calcularPegadaAtendimento(a))
      .filter(Boolean) as NonNullable<ReturnType<typeof calcularPegadaAtendimento>>[]
    const co2Total = pegadas.reduce((s, p) => s + p.kg_co2, 0)
    const pendentes = atendimentos.filter((a) =>
      ['pendente', 'em_andamento', 'aguardando_cliente'].includes(a.status),
    ).length
    return {
      total_viagens: atendimentos.length,
      viagens_mes: atendimentosMes.length,
      gasto_mes: gastoMes,
      pendentes,
      em_campo: emCampoAgora.length,
      proximas7d: proximas7d.length,
      vouchers_emitidos: vouchers.length,
      co2_total: co2Total,
      arvores: arvoresEquivalentes(co2Total),
      alertas_criticos: alertas.filter((a) => a.severity === 'critico' || a.severity === 'alto').length,
    }
  }, [atendimentos, vouchers, alertas, emCampoAgora.length, proximas7d.length])

  const serieMensal = useMemo(() => {
    const map = new Map<string, { mes: string; viagens: number; gasto: number }>()
    atendimentos.forEach((a) => {
      const mes = a.data_atendimento.slice(0, 7)
      if (!map.has(mes)) map.set(mes, { mes, viagens: 0, gasto: 0 })
      const item = map.get(mes)!
      item.viagens += 1
      item.gasto += a.valor_final || a.valor_venda || a.valor_cotacao || 0
    })
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-6)
  }, [atendimentos])

  const metricasGerais = useMemo(() => montarMetricasRelatorio(atendimentos, funcionariosEmpresa), [atendimentos, funcionariosEmpresa])
  const operacional = useMemo(
    () => montarRelatorioOperacional(atendimentos, empresasEscopo, funcionariosEmpresa),
    [atendimentos, empresasEscopo, funcionariosEmpresa],
  )

  function refresh() { setReload((n) => n + 1) }
  function abrirIAGlobal() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(AI_CONTEXT_EVENTS.open, { detail: { pageContext: `Portal corporativo - ${escopoNome}` } }))
  }

  if (!user) return null
  if (empresasEscopo.length === 0) {
    return (
      <div className="bbt-card p-12 text-center text-slate-500">
        Nenhuma empresa disponível para o seu acesso.
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <AIAssistantFab
        pageContext={`Portal corporativo - ${escopoNome}`}
        dataContext={[
          `Escopo: ${escopo === 'grupo' ? 'Grupo empresarial' : 'Empresa'} - ${escopoNome}`,
          `Empresas no escopo: ${empresasEscopo.length}`,
          `Demandas: ${atendimentos.length}`,
          `Vouchers: ${vouchers.length}`,
          `Viajantes cadastrados: ${funcionariosEmpresa.length}`,
          `Solicitantes: ${solicitantesEmpresa.length}`,
          `Cartoes: ${carteira?.cartoes?.length || 0}`,
          `Faturas abertas: ${carteira?.faturas_abertas || 0}`,
        ].join('\n')}
        suggestedPrompts={[
          'Resuma a situação da minha empresa agora',
          'Mostre vouchers pendentes desta empresa',
          'Quais pedidos precisam de atenção?',
          'Como está a carteira corporativa?',
          'Quem está em viagem hoje?',
        ]}
      />
      {/* HERO */}
      <section className="relative overflow-hidden rounded-lg border border-[#353d78] bg-[#20265a] text-white shadow-[0_12px_30px_rgba(32,38,90,0.16)]">
        <div className="absolute inset-x-0 top-0 z-[1] h-1 bg-[linear-gradient(90deg,#45d0d4_0_38%,#4a3191_38%_76%,#d8a128_76%_100%)]" />
        <div
          className="absolute inset-0 opacity-25 mix-blend-luminosity"
          style={{
            backgroundImage: `linear-gradient(rgba(32,38,90,.72),rgba(32,38,90,.72)),url(${heroBgImage})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
          }}
        />

        <div className="relative grid gap-5 p-6 lg:p-8 xl:grid-cols-[1fr_400px]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
              Portal empresas/Grupos · {escopoNome}
            </p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight lg:text-3xl">
              Bem-vindo de volta, {user.name.split(' ')[0]}.
            </h1>
            <p className="mt-2 max-w-xl text-sm text-blue-100/75">
              Sua central de viagens corporativas — pedidos, vouchers, financeiro, equipe em campo, pegada de carbono e a {AI_SHORT_NAME} a um clique de distância.
            </p>

            {(empresasVisiveis.length > 1 || gruposVisiveis.length > 0 || isGlobalMaster) && (
              <div className="mt-4 grid max-w-2xl gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
                <div>
                  <label htmlFor="portal-scope" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-100/60">
                    Escopo
                  </label>
                  <select
                    id="portal-scope"
                    value={escopo}
                    onChange={(e) => setEscopo(e.target.value as EscopoPortal)}
                    className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
                  >
                    <option value="empresa" className="bg-[#071747]">Empresa</option>
                    {gruposVisiveis.length > 0 && <option value="grupo" className="bg-[#071747]">Grupo</option>}
                  </select>
                </div>
                <div>
                  <label htmlFor="portal-entity" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-100/60">
                    Visualizando
                  </label>
                  {escopo === 'grupo' ? (
                    <select
                      id="portal-entity"
                      value={grupoId}
                      onChange={(e) => setGrupoId(e.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
                    >
                      {gruposVisiveis.map((grupo) => (
                        <option key={grupo.id} value={grupo.id} className="bg-[#071747]">{grupo.nome}</option>
                      ))}
                    </select>
                  ) : (
                    <select
                      id="portal-entity"
                      value={empresaId}
                      onChange={(e) => setEmpresaId(e.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
                    >
                      {empresasVisiveis.map((empresa) => (
                        <option key={empresa.id} value={empresa.id} className="bg-[#071747]">{empresa.nome}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl">
              <HeroMetric icon={Activity} label="Em viagem" value={stats.em_campo} />
              <HeroMetric icon={CalendarDays} label="Próximas 7d" value={stats.proximas7d} />
              <HeroMetric icon={Clock} label="Pendentes" value={stats.pendentes} />
              <HeroMetric icon={AlertTriangle} label="Alertas" value={stats.alertas_criticos} highlight={stats.alertas_criticos > 0} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/12 bg-white/8 p-5 backdrop-blur-md space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">
              Ações rápidas
            </p>
            {podeCriarPedido && (
              <button
                onClick={() => setAba('pedidos')}
                className="w-full flex items-center justify-between gap-3 rounded-xl bg-cyan-300 px-4 py-3 text-[#061631] font-semibold text-sm hover:brightness-105 transition shadow-lg shadow-cyan-500/20"
              >
                <span className="flex items-center gap-2"><Plus className="w-4 h-4" /> Novo pedido de viagem</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={abrirIAGlobal}
              className="w-full flex items-center justify-between gap-3 rounded-xl bg-white/12 px-4 py-3 text-white font-semibold text-sm hover:bg-white/18 transition border border-white/15"
            >
              <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-cyan-200" /> Falar com {AI_SHORT_NAME}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
            {podeVerVouchers && (
              <button
                onClick={() => setAba('vouchers')}
                className="w-full flex items-center justify-between gap-3 rounded-xl bg-white/8 px-4 py-3 text-white text-sm hover:bg-white/12 transition border border-white/10"
              >
                <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-cyan-200" /> Ver vouchers ({stats.vouchers_emitidos})</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {podeVerFinanceiro && carteira && (
              <button
                onClick={() => setAba(escopo === 'grupo' ? 'financeiro' : 'carteira')}
                className="w-full flex items-center justify-between gap-3 rounded-xl bg-white/8 px-4 py-3 text-white text-sm hover:bg-white/12 transition border border-white/10"
              >
                <span className="flex items-center gap-2"><Wallet className="w-4 h-4 text-cyan-200" /> Carteira e cartões ({carteira.cartoes?.length || 0})</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {solicitanteBloqueado && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800/50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-900 dark:text-red-200 text-sm">Acesso suspenso</div>
            <div className="text-xs text-red-700 dark:text-red-300">
              Seu acesso foi temporariamente bloqueado. Entre em contato com a BBT para reativar.
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-bbt-gray-100 dark:border-slate-700 -mt-1">
        {([
          { id: 'home', label: 'Home', icon: Activity, count: undefined as any, hidden: false },
          { id: 'empresa', label: 'Empresa', icon: Building2, count: undefined as any, hidden: false },
          { id: 'viagens', label: 'Minhas viagens', icon: Plane, count: stats.em_campo + stats.proximas7d, hidden: false },
          { id: 'pedidos', label: 'Pedidos', icon: Briefcase, count: stats.pendentes, hidden: !podeCriarPedido },
          { id: 'vouchers', label: 'Vouchers', icon: FileText, count: stats.vouchers_emitidos, hidden: !podeVerVouchers },
          { id: 'financeiro', label: 'Financeiro', icon: Wallet, count: undefined as any, hidden: !podeVerFinanceiro },
          { id: 'carteira', label: 'Carteira digital', icon: CreditCard, count: carteira?.cartoes?.length || undefined, hidden: !podeVerFinanceiro || escopo === 'grupo' },
          { id: 'relatorios', label: 'Relatórios', icon: BarChart3, count: undefined as any, hidden: !podeVerFinanceiro },
          { id: 'pegada', label: 'Pegada ESG', icon: Leaf, count: undefined as any, hidden: false },
        ])
          .filter((t) => !t.hidden)
          .map((t) => {
            const ativo = aba === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setAba(t.id as Aba)}
                className={`relative px-4 py-3 text-sm font-semibold transition flex items-center gap-2 ${
                  ativo
                    ? 'text-bbt-primary dark:text-white border-b-2 border-bbt-accent -mb-px'
                    : 'text-slate-500 hover:text-bbt-primary dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    ativo ? 'bg-bbt-accent text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
      </div>

      {aba === 'home' && (
        <HomeTab
          stats={stats}
          serieMensal={serieMensal}
          alertas={alertas.slice(0, 5)}
          emCampoAgora={emCampoAgora.slice(0, 5)}
          proximas7d={proximas7d.slice(0, 5)}
          carteira={carteira}
          metricas={metricasGerais}
          operacional={operacional}
          escopo={escopo}
          escopoNome={escopoNome}
          empresasNoEscopo={empresasEscopo.length}
          podeCriarPedido={podeCriarPedido}
          podeVerFinanceiro={podeVerFinanceiro}
          onOpenCarteira={() => setAba(escopo === 'grupo' ? 'financeiro' : 'carteira')}
          onOpenPedidos={() => setAba('pedidos')}
        />
      )}
      {aba === 'empresa' && (
        escopo === 'grupo' ? (
          <GrupoTab
            grupo={grupoSel}
            empresas={empresasEscopo}
            solicitantes={solicitantesEmpresa}
            funcionarios={funcionariosEmpresa}
            politicas={politicasEmpresa}
            carteira={carteira}
            operacional={operacional}
            podeVerFinanceiro={podeVerFinanceiro}
            onOpenFinanceiro={() => setAba('financeiro')}
          />
        ) : (
          <EmpresaTab
            empresa={empresaSel}
            solicitanteAtual={solicitanteAtual}
            solicitantes={solicitantesEmpresa}
            funcionarios={funcionariosEmpresa}
            politicas={politicasEmpresa}
            carteira={carteira}
            podeVerFinanceiro={podeVerFinanceiro}
            onOpenCarteira={() => setAba('carteira')}
          />
        )
      )}
      {aba === 'viagens' && <ViagensTab viajantes={viajantes} />}
      {aba === 'pedidos' && podeCriarPedido && (
        <PedidosTab
          empresaId={empresaId}
          atendimentos={atendimentos}
          funcionariosEmpresa={funcionariosEmpresa}
          onSaved={refresh}
          podeCriar={podeCriarPedido && !solicitanteBloqueado}
        />
      )}
      {aba === 'vouchers' && podeVerVouchers && <VouchersTab vouchers={vouchers} />}
      {aba === 'financeiro' && podeVerFinanceiro && <FinanceiroTab carteira={carteira} lancamentos={lancamentos} isGroupScope={escopo === 'grupo'} onOpenCarteira={() => setAba('carteira')} />}
      {aba === 'carteira' && podeVerFinanceiro && escopo === 'empresa' && (
        <CarteiraTab
          empresaId={empresaId}
          empresaNome={empresaSel?.nome || escopoNome}
          resumo={carteira}
          funcionariosEmpresa={funcionariosEmpresa}
          onChanged={refresh}
        />
      )}
      {aba === 'relatorios' && podeVerFinanceiro && (
        <RelatoriosTab
          empresaId={empresaId}
          empresaNome={escopoNome}
          grupoId={grupoId}
          escopo={escopo}
          empresasEscopo={empresasEscopo}
          atendimentos={atendimentos}
          funcionariosEmpresa={funcionariosEmpresa}
        />
      )}
      {aba === 'pegada' && <PegadaTab atendimentos={atendimentos} stats={stats} />}

    </div>
  )
}

// ============================================================
function HomeTab({
  stats,
  serieMensal,
  alertas,
  emCampoAgora,
  proximas7d,
  carteira,
  metricas,
  operacional,
  escopo,
  escopoNome,
  empresasNoEscopo,
  podeCriarPedido,
  podeVerFinanceiro,
  onOpenCarteira,
  onOpenPedidos,
}: any) {
  const categoriaData = useMemo(
    () => (metricas?.categorias || [])
      .filter((item: any) => item.faturado > 0)
      .map((item: any) => ({ tipo: item.tipo, valor: item.faturado, demandas: item.quantidade })),
    [metricas],
  )
  const topCentros = (operacional?.porCentroCusto || []).slice(0, 5)
  const topFornecedores = (operacional?.porFornecedor || []).slice(0, 5)
  const economia = metricas?.economia
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <button
          type="button"
          onClick={podeCriarPedido ? onOpenPedidos : undefined}
          className="bbt-card p-4 text-left hover:border-bbt-accent hover:shadow-md transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 flex items-center justify-center">
              {podeCriarPedido ? <Plus className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
            </div>
            <div>
              <div className="font-semibold text-bbt-primary dark:text-white">{podeCriarPedido ? 'Abrir pedido' : 'Escopo consolidado'}</div>
              <div className="text-xs text-slate-500">Solicite viagem, hotel, aéreo, locação ou pacote.</div>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onOpenCarteira}
          className="bbt-card p-4 text-left hover:border-bbt-accent hover:shadow-md transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-bbt-primary dark:text-white">Carteira e cartões</div>
              <div className="text-xs text-slate-500">Pix, saldo, limites e cartões físicos/virtuais.</div>
            </div>
          </div>
        </button>
        <div className="bbt-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-bbt-primary dark:text-white">Controle corporativo</div>
              <div className="text-xs text-slate-500">Pedidos, vouchers, financeiro e auditoria conectados.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Plane} label="Total de viagens" value={String(stats.total_viagens)} sub={`${stats.viagens_mes} esse mês`} tone="blue" />
        <KpiCard icon={Wallet} label="Gasto este mês" value={formatCurrency(stats.gasto_mes)} sub="Soma das viagens" tone="amber" hidden={!podeVerFinanceiro} />
        <KpiCard icon={FileText} label="Vouchers" value={String(stats.vouchers_emitidos)} sub="Emitidos" tone="green" />
        <KpiCard icon={Leaf} label="CO₂e total" value={formatarKg(stats.co2_total)} sub={`≈ ${stats.arvores} árvores/ano`} tone="green" />
      </div>

      {podeVerFinanceiro && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,.7fr)]">
          <div className="bbt-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
                <BarChart3 className="h-4 w-4 text-bbt-accent" />
                Gastos por categoria
              </h3>
              <span className="text-xs text-slate-500">{escopo === 'grupo' ? `${empresasNoEscopo} empresas` : escopoNome}</span>
            </div>
            {categoriaData.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">Sem gastos classificados neste escopo.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={categoriaData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="tipo" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(value) => `R$ ${Number(value) / 1000}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="valor" fill="#006FCF" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="space-y-4">
            <div className="bbt-card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
                <TrendingDown className="h-4 w-4 text-emerald-600" />
                Economia registrada
              </h3>
              <div className="mt-3 text-2xl font-bold text-emerald-600">{formatCurrency(economia?.economiaTotal || 0)}</div>
              <div className="mt-1 text-xs text-slate-500">
                {(economia?.percentualEconomia || 0).toFixed(1)}% sobre {economia?.itensComparados || 0} {(economia?.itensComparados || 0) === 1 ? 'item comparado' : 'itens comparados'}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniStat label="Valor final" value={formatCurrency(metricas?.faturadoTotal || 0)} />
                <MiniStat label="Oportunidade" value={formatCurrency(economia?.oportunidadeTotal || 0)} highlight />
              </div>
            </div>
            <RankingMini title="Top centros de custo" rows={topCentros} />
            <RankingMini title="Top fornecedores" rows={topFornecedores} />
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="bbt-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-bbt-primary dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-bbt-accent" />
              Evolução de viagens (6 meses)
            </h3>
          </div>
          {serieMensal.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">Sem dados ainda</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={serieMensal}>
                <defs>
                  <linearGradient id="grad-viagens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#006FCF" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#006FCF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mes" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip />
                <Area type="monotone" dataKey="viagens" stroke="#006FCF" strokeWidth={2} fill="url(#grad-viagens)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bbt-card p-5">
          <h3 className="font-semibold text-sm text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            Em viagem agora ({stats.em_campo})
          </h3>
          {emCampoAgora.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">Ninguém em viagem</div>
          ) : (
            <ul className="space-y-2">
              {emCampoAgora.map((v: any) => (
                <li key={v.voucher_id} className="rounded-lg p-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/50 dark:border-emerald-800/30">
                  <div className="text-xs font-semibold truncate">{v.passageiro_nome}</div>
                  <div className="text-[11px] text-slate-500 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {v.destino} · até {formatDate(v.fim)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bbt-card p-5">
          <h3 className="font-semibold text-sm text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-bbt-accent" />
            Próximas viagens
          </h3>
          {proximas7d.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">Nada agendado</div>
          ) : (
            <ul className="space-y-2">
              {proximas7d.map((v: any) => (
                <li key={v.voucher_id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-bbt-gray-50 dark:hover:bg-slate-800 transition">
                  <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    {v.tipo === 'Aéreo' ? <Plane className="w-4 h-4 text-blue-600" /> : <HotelIcon className="w-4 h-4 text-blue-600" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate">{v.passageiro_nome}</div>
                    <div className="text-[11px] text-slate-500 truncate">{v.destino} · {formatDate(v.inicio)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bbt-card p-5">
          <h3 className="font-semibold text-sm text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Alertas operacionais ({alertas.length})
          </h3>
          {alertas.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">Nada urgente agora ✓</div>
          ) : (
            <ul className="space-y-2">
              {alertas.map((a: any) => (
                <li key={a.id} className={`rounded-lg p-2 border ${
                  a.severity === 'critico' ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800/30' :
                  a.severity === 'alto' ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800/30' :
                  a.severity === 'medio' ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/30' :
                  'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/30'
                }`}>
                  <div className="text-xs font-semibold truncate">{a.title}</div>
                  <div className="text-[11px] text-slate-500 truncate">{a.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {podeVerFinanceiro && carteira && (
        <div className="bbt-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-sm text-bbt-primary dark:text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-bbt-accent" />
              Carteira digital corporativa
            </h3>
            <button type="button" onClick={onOpenCarteira} className="bbt-button-outline py-2 text-xs">
              Gerenciar carteira
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <MiniStat label="Saldo disponível" value={formatCurrency(carteira.carteira?.saldo_disponivel || 0)} />
            <MiniStat label="Limite crédito" value={formatCurrency(carteira.carteira?.limite_credito || 0)} />
            <MiniStat label="Cartões ativos" value={String(carteira.total_cartoes_ativos)} />
            <MiniStat label="Faturas abertas" value={String(carteira.faturas_abertas)} />
            <MiniStat label="Valor a pagar" value={formatCurrency(carteira.valor_faturas_abertas)} highlight />
          </div>
        </div>
      )}
    </div>
  )
}

function EmpresaTab({ empresa, solicitanteAtual, solicitantes, funcionarios, politicas, carteira, podeVerFinanceiro, onOpenCarteira }: any) {
  const centros = Array.from(new Set(funcionarios.map((f: any) => f.centro_custo).filter(Boolean)))
  const solicitantesAtivos = solicitantes.filter((s: any) => s.status === 'ativo')

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="bbt-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="bbt-section-label">Conta corporativa</p>
              <h2 className="mt-1 text-xl font-bold text-bbt-primary dark:text-white">{empresa.nome}</h2>
              <p className="mt-1 text-sm text-slate-500">
                Centraliza pedidos, vouchers, viajantes, políticas, financeiro e permissões do portal.
              </p>
            </div>
            <span className={`bbt-badge ${empresa.ativa !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {empresa.ativa !== false ? 'Ativa' : 'Inativa'}
            </span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Info label="CNPJ" value={empresa.cnpj || 'Não informado'} />
            <Info label="Código cliente" value={empresa.codigo_cliente || 'Não informado'} />
            <Info label="Responsável" value={empresa.responsavel || 'Não informado'} />
            <Info label="E-mail" value={empresa.email_responsavel || 'Não informado'} />
            <Info label="Telefone" value={empresa.telefone || 'Não informado'} />
            <Info label="Centro de custo padrão" value={empresa.centro_custo_padrao || 'Não informado'} />
          </div>
        </div>

        <div className="bbt-card p-5">
          <p className="bbt-section-label">Meu acesso</p>
          <h3 className="mt-1 font-semibold text-bbt-primary dark:text-white">
            {solicitanteAtual?.nome || 'Perfil corporativo'}
          </h3>
          <div className="mt-4 space-y-2 text-sm">
            <PermissionLine label="Criar pedidos" enabled={!solicitanteAtual || solicitanteAtual.pode_criar_demanda} />
            <PermissionLine label="Consultar vouchers" enabled={!solicitanteAtual || solicitanteAtual.pode_ver_vouchers} />
            <PermissionLine label="Ver financeiro" enabled={Boolean(solicitanteAtual?.pode_ver_financeiro)} />
            <PermissionLine label="Status do acesso" enabled={solicitanteAtual?.status !== 'bloqueado'} text={solicitanteAtual?.status || 'master'} />
          </div>
          {solicitanteAtual?.limite_por_solicitacao ? (
            <div className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-900/20 dark:text-blue-100">
              Limite por solicitação: <strong>{formatCurrency(solicitanteAtual.limite_por_solicitacao)}</strong>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Viajantes" value={String(funcionarios.length)} sub={`${centros.length} centro${centros.length === 1 ? '' : 's'} de custo`} tone="blue" />
        <KpiCard icon={ShieldCheck} label="Solicitantes ativos" value={String(solicitantesAtivos.length)} sub={`${solicitantes.length} cadastrados`} tone="green" />
        <KpiCard icon={Briefcase} label="Políticas" value={String(politicas.length)} sub="Por cargo e centro de custo" tone="amber" />
        <KpiCard icon={CreditCard} label="Cartões" value={String(carteira?.cartoes?.length || 0)} sub={podeVerFinanceiro ? 'Carteira corporativa' : 'Acesso restrito'} tone="blue" hidden={!podeVerFinanceiro} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="bbt-card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-bbt-accent" />
              Viajantes e centros de custo
            </h3>
            <span className="text-xs text-slate-500">{funcionarios.length} registro{funcionarios.length === 1 ? '' : 's'}</span>
          </div>
          {funcionarios.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">Nenhum viajante cadastrado para esta empresa.</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {funcionarios.slice(0, 12).map((f: any) => (
                <div key={f.id} className="rounded-xl border border-bbt-gray-100 p-3 dark:border-slate-700">
                  <div className="font-semibold text-sm text-bbt-primary dark:text-white">{f.nome}</div>
                  <div className="mt-1 text-xs text-slate-500">{f.cargo || 'Cargo não informado'} · {f.centro_custo || 'Sem centro de custo'}</div>
                  <div className="mt-1 text-[11px] text-slate-400 truncate">{f.email || f.telefone || 'Contato não informado'}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bbt-card p-5">
            <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-bbt-accent" />
              Solicitantes
            </h3>
            <div className="mt-3 space-y-2">
              {solicitantes.slice(0, 8).map((s: any) => (
                <div key={s.id} className="rounded-lg bg-bbt-gray-50 p-3 text-sm dark:bg-slate-800">
                  <div className="font-semibold">{s.nome}</div>
                  <div className="text-xs text-slate-500">{s.email}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{s.departamento || 'Sem departamento'} · {s.status}</div>
                </div>
              ))}
              {solicitantes.length === 0 && <div className="py-6 text-center text-sm text-slate-400">Nenhum solicitante cadastrado.</div>}
            </div>
          </div>

          {podeVerFinanceiro && (
            <button type="button" onClick={onOpenCarteira} className="bbt-card w-full p-5 text-left hover:border-bbt-accent transition">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center dark:bg-emerald-900/30 dark:text-emerald-300">
                  <Landmark className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold text-bbt-primary dark:text-white">Abrir controle financeiro</div>
                  <div className="text-xs text-slate-500">Conciliar saldos, cartões emitidos e limites.</div>
                </div>
              </div>
            </button>
          )}
        </div>
      </div>

      <div className="bbt-card p-5">
        <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
          <LockKeyhole className="w-4 h-4 text-bbt-accent" />
          Políticas corporativas
        </h3>
        {politicas.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">Nenhuma política cadastrada para esta empresa.</div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {politicas.map((p: any) => (
              <div key={p.id} className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
                <div className="font-semibold text-bbt-primary dark:text-white">{p.titulo || p.cargo}</div>
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  <div>Hotel: até {formatCurrency(p.limite_diaria_hotel || 0)}/diária</div>
                  <div>Aéreo: {p.classe_aerea || 'Não definido'}</div>
                  <div>Aprovação: {p.aprovacao_automatica ? 'automática' : 'manual'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GrupoTab({ grupo, empresas, solicitantes, funcionarios, politicas, carteira, operacional, podeVerFinanceiro, onOpenFinanceiro }: any) {
  const centros = Array.from(new Set(funcionarios.map((f: any) => f.centro_custo).filter(Boolean)))
  const solicitantesAtivos = solicitantes.filter((s: any) => s.status === 'ativo')
  const topEmpresas = (operacional?.porEmpresa || []).slice(0, 6)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="bbt-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="bbt-section-label">Grupo empresarial</p>
              <h2 className="mt-1 text-xl font-bold text-bbt-primary dark:text-white">{grupo?.nome || 'Grupo consolidado'}</h2>
              <p className="mt-1 text-sm text-slate-500">
                Consolidação de unidades, viajantes, solicitantes, políticas, financeiro e uso operacional.
              </p>
            </div>
            <span className="bbt-badge bg-blue-100 text-blue-700">{empresas.length} empresa(s)</span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Info label="Código do grupo" value={grupo?.codigo || 'Não informado'} />
            <Info label="Responsável" value={grupo?.responsavel_nome || 'Não informado'} />
            <Info label="E-mail" value={grupo?.responsavel_email || 'Não informado'} />
            <Info label="Escopo" value="Consolidado por empresas vinculadas" />
          </div>
        </div>

        <div className="bbt-card p-5">
          <p className="bbt-section-label">Governança do grupo</p>
          <h3 className="mt-1 font-semibold text-bbt-primary dark:text-white">Indicadores de cadastro</h3>
          <div className="mt-4 space-y-2 text-sm">
            <PermissionLine label="Empresas vinculadas" enabled={empresas.length > 0} text={String(empresas.length)} />
            <PermissionLine label="Solicitantes ativos" enabled={solicitantesAtivos.length > 0} text={String(solicitantesAtivos.length)} />
            <PermissionLine label="Centros de custo" enabled={centros.length > 0} text={String(centros.length)} />
            <PermissionLine label="Políticas cadastradas" enabled={politicas.length > 0} text={String(politicas.length)} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Building2} label="Empresas" value={String(empresas.length)} sub="No grupo" tone="blue" />
        <KpiCard icon={Users} label="Viajantes" value={String(funcionarios.length)} sub={`${centros.length} centro${centros.length === 1 ? '' : 's'} de custo`} tone="green" />
        <KpiCard icon={ShieldCheck} label="Solicitantes" value={String(solicitantesAtivos.length)} sub={`${solicitantes.length} cadastrados`} tone="amber" />
        <KpiCard icon={CreditCard} label="Cartões" value={String(carteira?.cartoes?.length || 0)} sub="Consolidado" tone="blue" hidden={!podeVerFinanceiro} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
            <h3 className="font-bold text-sm text-bbt-primary dark:text-white">Empresas do grupo</h3>
          </div>
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {empresas.map((empresa: any) => (
              <div key={empresa.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                <div>
                  <div className="font-semibold text-sm text-bbt-primary dark:text-white">{empresa.nome}</div>
                  <div className="text-xs text-slate-500">{empresa.cnpj || 'CNPJ não informado'} · {empresa.codigo_cliente || 'sem código'}</div>
                </div>
                <div className="text-xs text-slate-500">{empresa.responsavel || 'Responsável não informado'}</div>
                <Link href={`/dashboard/empresas/${empresa.id}`} className="bbt-button-outline py-2 text-xs">Abrir cadastro</Link>
              </div>
            ))}
            {empresas.length === 0 && <div className="p-8 text-center text-sm text-slate-400">Nenhuma empresa vinculada.</div>}
          </div>
        </div>

        <div className="space-y-4">
          {podeVerFinanceiro && carteira && (
            <button type="button" onClick={onOpenFinanceiro} className="bbt-card w-full p-5 text-left hover:border-bbt-accent transition">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <Landmark className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-bbt-primary dark:text-white">Financeiro consolidado</div>
                  <div className="text-xs text-slate-500">{formatCurrency(carteira.valor_faturas_abertas)} em faturas abertas.</div>
                </div>
              </div>
            </button>
          )}
          <RankingMini title="Gasto por empresa" rows={topEmpresas} />
        </div>
      </div>
    </div>
  )
}

function ViagensTab({ viajantes }: any) {
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'em_viagem' | 'planejada' | 'concluida'>('todos')
  const filtrados = viajantes.filter((v: any) =>
    filtroStatus === 'todos' ? true : v.status === filtroStatus,
  )
  return (
    <div className="space-y-3">
      <div className="bbt-tabs w-fit">
        {(['todos', 'em_viagem', 'planejada', 'concluida'] as const).map((f) => (
          <button key={f} onClick={() => setFiltroStatus(f)} className={`bbt-tab ${filtroStatus === f ? 'bbt-tab-active' : ''}`}>
            {f === 'todos' ? 'Todas' : f === 'em_viagem' ? 'Em viagem' : f === 'planejada' ? 'Planejadas' : 'Concluídas'}
          </button>
        ))}
      </div>
      <div className="bbt-card overflow-hidden">
        {filtrados.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">Nenhuma viagem encontrada.</div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {filtrados.map((v: any) => (
              <Link key={v.voucher_id} href={`/dashboard/vouchers/${v.voucher_id}`}
                className="flex items-center gap-4 p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-800 transition">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  v.status === 'em_viagem' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' :
                  v.status === 'planejada' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' :
                  'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}>
                  {v.tipo === 'Aéreo' ? <Plane className="w-5 h-5" /> :
                   v.tipo === 'Hotel' ? <HotelIcon className="w-5 h-5" /> :
                   v.tipo === 'Carro' ? <Car className="w-5 h-5" /> :
                   <Activity className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{v.passageiro_nome}</div>
                  <div className="text-xs text-slate-500 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {v.destino}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-semibold">{formatDate(v.inicio)}</div>
                  <div className="text-slate-400">até {formatDate(v.fim)}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PedidosTab({ empresaId, atendimentos, funcionariosEmpresa, onSaved, podeCriar }: any) {
  const [tipo, setTipo] = useState<TipoServico>('Hotel')
  const [funcId, setFuncId] = useState('')
  const [funcCodigo, setFuncCodigo] = useState('')
  const [passageiro, setPassageiro] = useState('')
  const [origem, setOrigem] = useState('')
  const [destino, setDestino] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [prioridade, setPrioridade] = useState<Prioridade>('media')
  const [enviando, setEnviando] = useState(false)
  const [pedidosVisiveis, setPedidosVisiveis] = useState(50)

  function preencherFunc(id: string) {
    setFuncId(id)
    const f = funcionariosEmpresa.find((x: any) => x.id === id)
    if (f) {
      setFuncCodigo(f.codigo_identificacao || '')
      setPassageiro(f.nome)
    } else {
      setFuncCodigo('')
    }
  }

  function preencherFuncPorCodigo(codigo: string) {
    setFuncCodigo(codigo)
    const f = encontrarFuncionarioPorCodigo(funcionariosEmpresa, codigo, empresaId)
    setFuncId(f?.id || '')
    if (f) setPassageiro(f.nome)
  }

  async function enviarPedido(e: React.FormEvent) {
    e.preventDefault()
    if (!podeCriar) return
    if (!passageiro.trim()) return toast.error('Informe o passageiro.')
    setEnviando(true)
    try {
      const user = getCurrentUser()
      const novo: Atendimento = {
        id: createEntityId('at'),
        empresa_id: empresaId,
        funcionario_id: funcId || null,
        passageiro_nome: passageiro.trim(),
        tipo_servico: tipo,
        valor_cotacao: 0,
        agente_user_id: user?.id || '',
        status: 'pendente',
        prioridade,
        origem: 'Portal',
        observacoes: observacoes.trim(),
        data_atendimento: todayISODate(),
        ...(tipo === 'Aéreo'
          ? { detalhes_aereo: { origem: origem.trim(), destino: destino.trim(), data_ida: dataInicio, data_volta: dataFim } }
          : tipo === 'Hotel'
          ? { detalhes_hotel: { cidade: destino.trim(), data_checkin: dataInicio, data_checkout: dataFim } }
          : tipo === 'Carro'
          ? { detalhes_carro: { cidade_retirada: destino.trim(), data_retirada: dataInicio, data_devolucao: dataFim } }
          : { detalhes_pacote: { destino: destino.trim(), data_ida: dataInicio, data_volta: dataFim, descricao: observacoes } }),
        created_at: new Date().toISOString(),
      }
      const atendimento = addAtendimento(novo)
      if (!atendimento) throw new Error('Falha ao preparar o pedido.')
      await commitPendingRemoteStorage()
      toast.success('Pedido enviado! A BBT já recebeu.')
      setPassageiro(''); setOrigem(''); setDestino(''); setDataInicio(''); setDataFim(''); setObservacoes(''); setFuncId(''); setFuncCodigo('')
      onSaved()
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao enviar pedido.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      {podeCriar && (
        <form onSubmit={enviarPedido} className="bbt-card p-5 space-y-3">
          <h3 className="font-bold text-bbt-primary dark:text-white flex items-center gap-2">
            <Plus className="w-4 h-4 text-bbt-accent" /> Novo pedido
          </h3>
          <Field label="Tipo de serviço">
            <div className="grid grid-cols-4 gap-1.5">
              {(['Aéreo', 'Hotel', 'Carro', 'Pacote'] as TipoServico[]).map((t) => (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={`h-10 rounded-lg text-xs font-semibold transition ${
                    tipo === t ? 'bg-bbt-primary text-white shadow-sm' :
                    'bg-bbt-gray-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-bbt-gray-100 dark:hover:bg-slate-700'
                  }`}>{t}</button>
              ))}
            </div>
          </Field>
          <Field label="Funcionário (opcional)">
            <input
              value={funcCodigo}
              onChange={(e) => preencherFuncPorCodigo(e.target.value)}
              className="bbt-input mb-2"
              placeholder="ID do funcionário"
              inputMode="numeric"
            />
            <select value={funcId} onChange={(e) => preencherFunc(e.target.value)} className="bbt-input">
              <option value="">Sem vínculo</option>
              {funcionariosEmpresa.map((f: any) => <option key={f.id} value={f.id}>{f.codigo_identificacao ? `${f.codigo_identificacao} - ` : ''}{f.nome}</option>)}
            </select>
          </Field>
          <Field label="Passageiro *">
            <input value={passageiro} onChange={(e) => setPassageiro(e.target.value)} className="bbt-input" required />
          </Field>
          {tipo === 'Aéreo' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Origem"><input value={origem} onChange={(e) => setOrigem(e.target.value)} className="bbt-input" /></Field>
              <Field label="Destino"><input value={destino} onChange={(e) => setDestino(e.target.value)} className="bbt-input" /></Field>
            </div>
          )}
          {tipo !== 'Aéreo' && (
            <Field label="Cidade / Destino">
              <input value={destino} onChange={(e) => setDestino(e.target.value)} className="bbt-input" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label={tipo === 'Hotel' ? 'Check-in' : 'Data inicial'}>
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="bbt-input" />
            </Field>
            <Field label={tipo === 'Hotel' ? 'Check-out' : 'Data final'}>
              <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="bbt-input" />
            </Field>
          </div>
          <Field label="Prioridade">
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade)} className="bbt-input">
              <option value="baixa">Baixa</option>
              <option value="media">Média</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </Field>
          <Field label="Observações">
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} className="bbt-input" placeholder="Detalhes adicionais, preferências, etc." />
          </Field>
          <button type="submit" disabled={enviando} className="bbt-button-primary w-full">
            <Send className="w-4 h-4" />
            {enviando ? 'Enviando...' : 'Enviar pedido'}
          </button>
        </form>
      )}

      <div className="bbt-card overflow-hidden">
        <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-bold text-bbt-primary dark:text-white text-sm">
            Meus pedidos ({atendimentos.length})
          </h3>
          {atendimentos.length > 0 && (
            <span className="text-xs text-slate-500">
              Exibindo {Math.min(pedidosVisiveis, atendimentos.length)} de {atendimentos.length}
            </span>
          )}
        </div>
        {atendimentos.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">Nenhum pedido ainda.</div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700 max-h-[600px] overflow-y-auto">
            {atendimentos.slice(0, pedidosVisiveis).map((a: Atendimento) => (
              <div key={a.id} className="p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-800 transition">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`bbt-badge ${
                    a.status === 'finalizado' ? 'bg-green-100 text-green-700' :
                    a.status === 'cancelado' ? 'bg-red-100 text-red-700' :
                    a.status === 'em_andamento' ? 'bg-blue-100 text-blue-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>{a.status}</span>
                  <span className="bbt-badge bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                    {a.tipo_servico}
                  </span>
                  <span className="text-xs text-slate-500">{formatDate(a.data_atendimento)}</span>
                </div>
                <div className="mt-1 font-semibold text-sm truncate">{a.passageiro_nome}</div>
                {a.observacoes && (
                  <div className="text-xs text-slate-500 truncate mt-0.5">{a.observacoes}</div>
                )}
              </div>
            ))}
            {pedidosVisiveis < atendimentos.length && (
              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={() => setPedidosVisiveis((atual) => Math.min(atual + 50, atendimentos.length))}
                  className="bbt-button-ghost h-9 text-xs"
                >
                  Mostrar mais ({Math.min(50, atendimentos.length - pedidosVisiveis)})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function VouchersTab({ vouchers }: any) {
  const [vouchersVisiveis, setVouchersVisiveis] = useState(50)

  return (
    <div className="bbt-card overflow-hidden">
      {vouchers.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm">Nenhum voucher emitido ainda.</div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-bbt-gray-100 p-4 dark:border-slate-700">
            <h3 className="text-sm font-bold text-bbt-primary dark:text-white">Vouchers emitidos</h3>
            <span className="text-xs text-slate-500">
              Exibindo {Math.min(vouchersVisiveis, vouchers.length)} de {vouchers.length}
            </span>
          </div>
          <div className="max-h-[680px] divide-y divide-bbt-gray-100 overflow-y-auto dark:divide-slate-700">
            {vouchers.slice(0, vouchersVisiveis).map((v: any) => (
              <Link key={v.id} href={`/dashboard/vouchers/${v.id}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-800 transition">
                <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-700 dark:text-amber-300">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {v.numero || v.id.slice(-8)} · {v.passageiro_nome || '—'}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {v.tipo} · {(v as any).fornecedor_nome || (v as any).hotel_nome || '—'} · {v.status}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </Link>
            ))}
            {vouchersVisiveis < vouchers.length && (
              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={() => setVouchersVisiveis((atual) => Math.min(atual + 50, vouchers.length))}
                  className="bbt-button-ghost h-9 text-xs"
                >
                  Mostrar mais ({Math.min(50, vouchers.length - vouchersVisiveis)})
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function FinanceiroTab({ carteira, lancamentos, isGroupScope, onOpenCarteira }: any) {
  if (!carteira) {
    return <div className="bbt-card p-12 text-center text-slate-400">Carteira não configurada para essa empresa.</div>
  }
  return (
    <div className="space-y-4">
      <div className="bbt-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="bbt-section-label">Financeiro corporativo</p>
            <h3 className="mt-1 font-bold text-bbt-primary dark:text-white">Faturas e controle financeiro interno</h3>
            <p className="mt-1 text-sm text-slate-500">
              Toda movimentação financeira fica conectada a pedidos, vouchers, faturas e limites da empresa.
            </p>
          </div>
          {!isGroupScope && (
            <button type="button" onClick={onOpenCarteira} className="bbt-button-primary">
              <CreditCard className="h-4 w-4" />
              Gerenciar carteira
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={CreditCard} label="Cartões ativos" value={String(carteira.total_cartoes_ativos)} tone="blue" />
        <KpiCard icon={ReceiptText} label="Faturas em aberto" value={String(carteira.faturas_abertas)} tone="amber" />
        <KpiCard icon={Wallet} label="Total a pagar" value={formatCurrency(carteira.valor_faturas_abertas)} tone="red" />
        <KpiCard icon={TrendingUp} label="Gasto cartão (mês)" value={formatCurrency(carteira.gasto_cartao_mes)} tone="green" />
      </div>
      <div className="bbt-card overflow-hidden">
        <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-sm text-bbt-primary dark:text-white">Últimas faturas</h3>
        </div>
        {carteira.faturas.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Nenhuma fatura emitida.</div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {carteira.faturas.slice(0, 20).map((f: any) => (
              <div key={f.id} className="grid grid-cols-[1fr_auto] items-center gap-3 p-4">
                <div>
                  <div className="font-semibold text-sm">{f.numero}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(f.periodo_inicio)} → {formatDate(f.periodo_fim)} · vence {formatDate(f.vencimento)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">{formatCurrency(f.valor_total - f.valor_pago)}</div>
                  <div className="text-[11px] text-slate-500">{f.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bbt-card overflow-hidden">
        <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-sm text-bbt-primary dark:text-white">Lançamentos financeiros vinculados</h3>
        </div>
        {lancamentos.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Nenhum lançamento financeiro para esta empresa.</div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {lancamentos.slice(0, 12).map((l: any) => (
              <div key={l.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <div className="font-semibold text-sm">{l.descricao || l.categoria || 'Lançamento'}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(l.data_emissao || l.data_vencimento)} · {l.tipo} · {l.status}
                  </div>
                </div>
                <div className="font-bold text-sm text-bbt-primary dark:text-white">{formatCurrency(l.valor || 0)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RelatoriosTab({ empresaId, empresaNome, grupoId, escopo, empresasEscopo, atendimentos, funcionariosEmpresa }: {
  empresaId: string
  empresaNome: string
  grupoId: string
  escopo: EscopoPortal
  empresasEscopo: Empresa[]
  atendimentos: Atendimento[]
  funcionariosEmpresa: any[]
}) {
  const [inicio, setInicio] = useState(addDaysISODate(todayISODate(), -30))
  const [fim, setFim] = useState(todayISODate())
  const [funcionarioId, setFuncionarioId] = useState('')
  const [funcionarioCodigoRelatorio, setFuncionarioCodigoRelatorio] = useState('')
  const [centroCusto, setCentroCusto] = useState('')

  const atendimentosPeriodo = useMemo(
    () => filtrarPeriodo(atendimentos, inicio, fim),
    [atendimentos, fim, inicio],
  )
  const metricas = useMemo(() => montarMetricasRelatorio(atendimentosPeriodo, funcionariosEmpresa), [atendimentosPeriodo, funcionariosEmpresa])
  const centros = useMemo(() => {
    return Array.from(
      new Set(
        atendimentos
          .map((atendimento) => String(atendimento.centro_custo || '').trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b))
  }, [atendimentos])
  const funcionariosComDemanda = useMemo(() => {
    const ids = new Set<string>()
    atendimentosPeriodo.forEach((atendimento) => {
      const funcionario = resolverFuncionarioAtendimento(atendimento, funcionariosEmpresa, 84)
      if (funcionario?.id) ids.add(funcionario.id)
      else if (atendimento.funcionario_id) ids.add(atendimento.funcionario_id)
    })
    return funcionariosEmpresa.filter((funcionario) => ids.has(funcionario.id))
  }, [atendimentosPeriodo, funcionariosEmpresa])
  const economiaPorCentro = useMemo(() => {
    const grupos = new Map<string, Atendimento[]>()
    atendimentosPeriodo.forEach((atendimento) => {
      const centro = String(atendimento.centro_custo || '').trim() || 'Sem centro de custo'
      if (!grupos.has(centro)) grupos.set(centro, [])
      grupos.get(centro)!.push(atendimento)
    })
    return Array.from(grupos.entries())
      .map(([centro, lista]) => {
        const resumo = montarMetricasRelatorio(lista, funcionariosEmpresa)
        return { centro, total: lista.length, valor: resumo.faturadoTotal, economia: resumo.economia.economiaTotal }
      })
      .sort((a, b) => b.economia - a.economia)
  }, [atendimentosPeriodo, funcionariosEmpresa])

  function abrirRelatorioEmpresa() {
    const url = escopo === 'grupo'
      ? `/relatorios/grupo?grupo=${grupoId}&inicio=${inicio}&fim=${fim}&visao=cliente`
      : `/relatorios/empresa?empresa=${empresaId}&inicio=${inicio}&fim=${fim}&visao=cliente`
    window.open(url, '_blank')
  }
  function abrirRelatorioFuncionario() {
    const funcionario = funcionarioId
      ? funcionariosEmpresa.find((item) => item.id === funcionarioId)
      : encontrarFuncionarioPorCodigo(
          funcionariosEmpresa,
          funcionarioCodigoRelatorio,
          escopo === 'empresa' ? empresaId : undefined,
        )
    if (!funcionario) return toast.error('Informe um ID válido ou selecione um funcionário.')
    const empresaDoFuncionario = funcionario?.company_id || empresaId
    window.open(`/relatorios/funcionario?empresa=${empresaDoFuncionario}&funcionario=${funcionario.id}&inicio=${inicio}&fim=${fim}&visao=cliente`, '_blank')
  }
  function selecionarFuncionarioRelatorioPorCodigo(codigo: string) {
    setFuncionarioCodigoRelatorio(codigo)
    const funcionario = encontrarFuncionarioPorCodigo(
      funcionariosEmpresa,
      codigo,
      escopo === 'empresa' ? empresaId : undefined,
    )
    setFuncionarioId(funcionario?.id || '')
  }
  function selecionarFuncionarioRelatorioPorId(id: string) {
    setFuncionarioId(id)
    const funcionario = funcionariosEmpresa.find((item) => item.id === id)
    setFuncionarioCodigoRelatorio(funcionario?.codigo_identificacao || '')
  }
  function abrirRelatorioCentroCusto() {
    if (!centroCusto) return toast.error('Selecione um centro de custo.')
    const escopoParam = escopo === 'grupo' ? `grupo=${grupoId}` : `empresa=${empresaId}`
    window.open(`/relatorios/centro-custo?${escopoParam}&centro=${encodeURIComponent(centroCusto)}&inicio=${inicio}&fim=${fim}&visao=cliente`, '_blank')
  }
  function abrirRelatorioAereo() {
    const escopoParam = escopo === 'grupo' ? `grupo=${grupoId}` : `empresa=${empresaId}`
    window.open(`/relatorios/aereo?${escopoParam}&inicio=${inicio}&fim=${fim}&visao=cliente`, '_blank')
  }
  function abrirDashboardExecutivo() {
    const escopoParam = escopo === 'grupo' ? `grupo=${grupoId}` : `empresa=${empresaId}`
    window.open(`/relatorios/dashboard?${escopoParam}&inicio=${inicio}&fim=${fim}&visao=cliente`, '_blank')
  }

  return (
    <div className="space-y-4">
      <div className="bbt-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="bbt-section-label">Relatórios corporativos</p>
            <h3 className="mt-1 font-bold text-bbt-primary dark:text-white">{empresaNome}</h3>
            <p className="mt-1 text-sm text-slate-500">
              Relatórios de cliente mostram somente valor final, composição de gastos e economia registrada.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="bbt-input w-auto" />
            <span className="text-xs text-slate-400">até</span>
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="bbt-input w-auto" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard icon={FileText} label="Demandas no período" value={String(metricas.total)} tone="blue" />
        <KpiCard icon={Wallet} label="Valor final" value={formatCurrency(metricas.faturadoTotal)} tone="amber" />
        <KpiCard icon={TrendingDown} label="Economia registrada" value={formatCurrency(metricas.economia.economiaTotal)} tone="green" />
        <KpiCard icon={BarChart3} label="% economia" value={`${metricas.economia.percentualEconomia.toFixed(1)}%`} tone="blue" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <div className="bbt-card p-5">
          <div className="flex h-full flex-col">
            <div className="flex-1">
              <h4 className="font-bold text-bbt-primary dark:text-white">{escopo === 'grupo' ? 'Relatório consolidado do grupo' : 'Relatório geral da empresa'}</h4>
              <p className="mt-1 text-xs text-slate-500">Resumo por categoria, status, base detalhada e economia.</p>
            </div>
            <button onClick={abrirRelatorioEmpresa} className="bbt-button-primary mt-4 w-full">
              <Download className="w-4 h-4" /> Gerar relatório
            </button>
          </div>
        </div>

        <div className="bbt-card p-5">
          <div className="flex h-full flex-col">
            <div className="flex-1">
              <h4 className="font-bold text-bbt-primary dark:text-white">Dashboard executivo</h4>
              <p className="mt-1 text-xs text-slate-500">Evolução mensal, mapa, rankings, filtros e detalhes em formato interativo.</p>
            </div>
            <button onClick={abrirDashboardExecutivo} className="bbt-button-primary mt-4 w-full">
              <LayoutDashboard className="w-4 h-4" /> Gerar dashboard
            </button>
          </div>
        </div>

        <div className="bbt-card p-5">
          <div className="flex h-full flex-col">
            <div className="flex-1">
              <h4 className="font-bold text-bbt-primary dark:text-white">Relatório aéreo executivo</h4>
              <p className="mt-1 text-xs text-slate-500">Mapa, top rotas, companhias, tipo de trecho e base detalhada de passagens.</p>
            </div>
            <button onClick={abrirRelatorioAereo} className="bbt-button-primary mt-4 w-full">
              <Plane className="w-4 h-4" /> Gerar aéreo
            </button>
          </div>
        </div>

        <div className="bbt-card p-5">
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-3">
              <div>
                <h4 className="font-bold text-bbt-primary dark:text-white">Por funcionário</h4>
                <p className="mt-1 text-xs text-slate-500">Fechamento individual para prestação de contas.</p>
              </div>
              <input
                value={funcionarioCodigoRelatorio}
                onChange={(e) => selecionarFuncionarioRelatorioPorCodigo(e.target.value)}
                placeholder="ID do funcionário"
                className="bbt-input font-mono"
              />
              <select value={funcionarioId} onChange={(e) => selecionarFuncionarioRelatorioPorId(e.target.value)} className="bbt-input">
                <option value="">Selecione</option>
                {funcionariosComDemanda.map((funcionario) => (
                  <option key={funcionario.id} value={funcionario.id}>
                    {funcionario.codigo_identificacao ? `${funcionario.codigo_identificacao} - ` : ''}{funcionario.nome}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={abrirRelatorioFuncionario} className="bbt-button-primary mt-4 w-full">
              <Download className="w-4 h-4" /> Gerar por funcionário
            </button>
          </div>
        </div>

        <div className="bbt-card p-5">
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-3">
              <div>
                <h4 className="font-bold text-bbt-primary dark:text-white">Por centro de custo</h4>
                <p className="mt-1 text-xs text-slate-500">Conferência por departamento, obra, projeto ou unidade.</p>
              </div>
              <select value={centroCusto} onChange={(e) => setCentroCusto(e.target.value)} className="bbt-input">
                <option value="">Selecione</option>
                {centros.map((centro) => <option key={centro} value={centro}>{centro}</option>)}
              </select>
            </div>
            <button onClick={abrirRelatorioCentroCusto} className="bbt-button-primary mt-4 w-full">
              <Download className="w-4 h-4" /> Gerar por centro
            </button>
          </div>
        </div>
      </div>

      <div className="bbt-card overflow-hidden">
        <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-sm text-bbt-primary dark:text-white flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-emerald-600" /> Economia por centro de custo
          </h3>
        </div>
        {economiaPorCentro.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Nenhuma movimentação no período selecionado.</div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {economiaPorCentro.slice(0, 12).map((item) => (
              <div key={item.centro} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                <div>
                  <div className="font-semibold text-sm text-bbt-primary dark:text-white">{item.centro}</div>
                  <div className="text-xs text-slate-500">{item.total} demanda{item.total > 1 ? 's' : ''}</div>
                </div>
                <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">Valor final {formatCurrency(item.valor)}</div>
                <div className="text-sm font-semibold text-emerald-600">Economia {formatCurrency(item.economia)}</div>
                <div className="text-xs text-slate-500">{item.valor > 0 ? `${((item.economia / (item.valor + item.economia)) * 100).toFixed(1)}%` : '0.0%'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CarteiraTab({ empresaId, empresaNome, resumo, funcionariosEmpresa, onChanged }: any) {
  const currentUser = typeof window !== 'undefined' ? getCurrentUser() : null
  const carteira = resumo?.carteira
  const cartoes = (resumo?.cartoes || []) as CartaoCorporativo[]
  const faturas = resumo?.faturas || []
  const movimentos = resumo?.movimentos || []
  const [limiteCredito, setLimiteCredito] = useState<number>(carteira?.limite_credito || 0)
  const [limitePix, setLimitePix] = useState<number>(carteira?.limite_pix_diario || 0)
  const [limiteCartao, setLimiteCartao] = useState<number>(carteira?.limite_cartao_mensal || 0)
  const [valorAporte, setValorAporte] = useState<number>(0)
  const [pixValor, setPixValor] = useState<number>(0)
  const [pixDescricao, setPixDescricao] = useState('Débito externo conciliado')
  const [cardForm, setCardForm] = useState<{
    tipo: CartaoCorporativo['tipo']
    apelido: string
    portador_nome: string
    funcionario_id: string
    limite: number
    merchant_lock: string
    ultimos4: string
    bandeira: NonNullable<CartaoCorporativo['bandeira']>
  }>({
    tipo: 'virtual',
    apelido: 'Cartão viagem',
    portador_nome: '',
    funcionario_id: '',
    limite: 1000,
    merchant_lock: '',
    ultimos4: '',
    bandeira: 'Visa',
  })

  useEffect(() => {
    setLimiteCredito(carteira?.limite_credito || 0)
    setLimitePix(carteira?.limite_pix_diario || 0)
    setLimiteCartao(carteira?.limite_cartao_mensal || 0)
  }, [empresaId, carteira?.limite_cartao_mensal, carteira?.limite_credito, carteira?.limite_pix_diario])

  function refresh() {
    onChanged?.()
  }

  async function ativarCarteira() {
    const base = garantirCarteiraEmpresa(empresaId)
    const ok = atualizarCarteiraEmpresa(base.id, {
      status: 'ativa',
      pix_habilitado: false,
      cartao_habilitado: false,
      limite_credito: Math.max(0, limiteCredito),
      limite_pix_diario: Math.max(0, limitePix),
      limite_cartao_mensal: Math.max(0, limiteCartao),
      provedor: 'pendente',
      conta_virtual: undefined,
    })
    if (!ok) {
      toast.error('Não foi possível salvar a carteira. Verifique o armazenamento do navegador.')
      return
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o controle financeiro no servidor.')
      return
    }
    toast.success('Controle interno salvo. Nenhuma conta bancária foi criada.')
    refresh()
  }

  async function registrarAporte() {
    if (valorAporte <= 0) {
      toast.error('Informe um valor de aporte maior que zero.')
      return
    }
    const movimento = registrarMovimentoCarteira({
      company_id: empresaId,
      tipo: 'credito',
      origem: 'manual',
      valor: valorAporte,
      descricao: 'Credito externo conciliado no controle interno',
    })
    if (!movimento) {
      toast.error('Não foi possível registrar o aporte.')
      return
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o credito no servidor.')
      return
    }
    setValorAporte(0)
    toast.success('Credito conciliado registrado no controle interno.')
    refresh()
  }

  async function registrarPix() {
    if (pixValor <= 0) {
      toast.error('Informe um valor de Pix maior que zero.')
      return
    }
    if (!carteira || carteira.status !== 'ativa') {
      toast.error('Habilite o controle interno antes de registrar movimentações.')
      return
    }
    const disponivel = Number(carteira.saldo_disponivel || 0) + Number(carteira.limite_credito || 0)
    if (pixValor > disponivel) {
      toast.error('Valor maior que saldo + limite disponível.')
      return
    }
    const movimento = registrarMovimentoCarteira({
      company_id: empresaId,
      tipo: 'debito',
      origem: 'manual',
      valor: pixValor,
      descricao: pixDescricao || 'Débito externo conciliado',
    })
    if (!movimento) {
      toast.error('Não foi possível registrar o débito conciliado.')
      return
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o debito no servidor.')
      return
    }
    setPixValor(0)
    setPixDescricao('Débito externo conciliado')
    toast.success('Débito já realizado registrado no controle interno.')
    refresh()
  }

  async function criarCartao(tipo?: CartaoCorporativo['tipo']) {
    const limite = Number(cardForm.limite || 0)
    if (limite <= 0) {
      toast.error('Informe o limite do cartão.')
      return
    }
    const funcionario = funcionariosEmpresa.find((f: any) => f.id === cardForm.funcionario_id)
    const card = criarCartaoCorporativo({
      company_id: empresaId,
      tipo: tipo || cardForm.tipo,
      apelido: cardForm.apelido || (tipo === 'fisico' ? 'Cartão físico' : 'Cartão virtual'),
      limite,
      portador_nome: cardForm.portador_nome || funcionario?.nome || empresaNome,
      funcionario_id: cardForm.funcionario_id || null,
      merchant_lock: cardForm.merchant_lock || undefined,
      criado_por_user_id: currentUser?.id,
      ultimos4: cardForm.ultimos4,
      bandeira: cardForm.bandeira,
    })
    if (!card) {
      toast.error('Informe os quatro últimos dígitos de um cartão já emitido.')
      return
    }
    try {
      await commitPendingRemoteStorage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o cartao no servidor.')
      return
    }
    toast.success(`${card.tipo === 'fisico' ? 'Cartão físico' : 'Cartão virtual'} registrado para ${card.portador_nome || empresaNome}.`)
    setCardForm((s) => ({ ...s, apelido: 'Cartão viagem', portador_nome: '', funcionario_id: '', limite: 1000, merchant_lock: '', ultimos4: '' }))
    refresh()
  }

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-5 dark:border-emerald-900/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950">
        <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="relative grid gap-5 xl:grid-cols-[1fr_440px]">
          <div>
            <p className="bbt-section-label">Controle financeiro interno</p>
            <h2 className="mt-1 text-2xl font-bold text-bbt-primary dark:text-white">
              Saldos conciliados e cartões emitidos de {empresaNome}
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Registre transações já realizadas e cartões reais já emitidos. Esta área não cria conta, cartão ou pagamento no provedor financeiro.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <MiniStat label="Status" value={carteira?.status === 'ativa' ? 'Ativa' : 'Configuração pendente'} highlight={carteira?.status !== 'ativa'} />
              <MiniStat label="Conta virtual" value={carteira?.conta_virtual || 'Não criada'} />
              <MiniStat label="Provedor" value={carteira?.provedor || 'pendente'} />
            </div>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/70">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Saldo disponível" value={formatCurrency(carteira?.saldo_disponivel || 0)} />
              <MiniStat label="Limite crédito" value={formatCurrency(carteira?.limite_credito || 0)} />
              <MiniStat label="Limite Pix/dia" value={formatCurrency(carteira?.limite_pix_diario || 0)} />
              <MiniStat label="Limite cartão/mês" value={formatCurrency(carteira?.limite_cartao_mensal || 0)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={ativarCarteira} className="bbt-button-primary flex-1">
                <Wallet className="h-4 w-4" />
                Ativar/atualizar
              </button>
              <button type="button" onClick={() => document.getElementById('registro-cartao')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="bbt-button-outline flex-1">
                <CreditCard className="h-4 w-4" />
                Registrar cartão
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="bbt-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Landmark className="h-5 w-5 text-bbt-accent" />
            <div>
              <h3 className="font-bold text-bbt-primary dark:text-white">Limites e habilitações</h3>
              <p className="text-xs text-slate-500">Configuração operacional enquanto o provedor bancário definitivo não estiver conectado.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Limite de crédito">
              <input type="number" min={0} value={limiteCredito} onChange={(e) => setLimiteCredito(Number(e.target.value || 0))} className="bbt-input" />
            </Field>
            <Field label="Limite Pix diário">
              <input type="number" min={0} value={limitePix} onChange={(e) => setLimitePix(Number(e.target.value || 0))} className="bbt-input" />
            </Field>
            <Field label="Limite cartão mensal">
              <input type="number" min={0} value={limiteCartao} onChange={(e) => setLimiteCartao(Number(e.target.value || 0))} className="bbt-input" />
            </Field>
          </div>
          <button type="button" onClick={ativarCarteira} className="bbt-button-primary mt-4">
            <CheckCircle2 className="h-4 w-4" />
            Salvar limites
          </button>
        </div>

        <div className="bbt-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-bbt-accent" />
            <div>
              <h3 className="font-bold text-bbt-primary dark:text-white">Conciliação manual</h3>
              <p className="text-xs text-slate-500">Registre apenas créditos e débitos já realizados fora do sistema.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Aporte manual">
              <div className="flex gap-2">
                <input type="number" min={0} value={valorAporte} onChange={(e) => setValorAporte(Number(e.target.value || 0))} className="bbt-input" />
                <button type="button" onClick={registrarAporte} className="bbt-button-outline whitespace-nowrap">Creditar</button>
              </div>
            </Field>
            <Field label="Débito externo">
              <div className="flex gap-2">
                <input type="number" min={0} value={pixValor} onChange={(e) => setPixValor(Number(e.target.value || 0))} className="bbt-input" />
                <button type="button" onClick={registrarPix} className="bbt-button-outline whitespace-nowrap">Registrar</button>
              </div>
            </Field>
          </div>
          <Field label="Descrição e referência">
            <input value={pixDescricao} onChange={(e) => setPixDescricao(e.target.value)} className="bbt-input" />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div id="registro-cartao" className="bbt-card scroll-mt-6 p-5">
          <div className="mb-4 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-bbt-accent" />
            <div>
              <h3 className="font-bold text-bbt-primary dark:text-white">Registrar cartão corporativo</h3>
              <p className="text-xs text-slate-500">Cadastre um cartão real já emitido pelo provedor financeiro.</p>
            </div>
          </div>
          <div className="space-y-3">
            <Field label="Tipo">
              <select value={cardForm.tipo} onChange={(e) => setCardForm({ ...cardForm, tipo: e.target.value as CartaoCorporativo['tipo'] })} className="bbt-input">
                <option value="virtual">Virtual</option>
                <option value="fisico">Físico</option>
              </select>
            </Field>
            <Field label="Apelido">
              <input value={cardForm.apelido} onChange={(e) => setCardForm({ ...cardForm, apelido: e.target.value })} className="bbt-input" placeholder="Ex: Hotel diretoria" />
            </Field>
            <Field label="Portador / viajante">
              <select value={cardForm.funcionario_id} onChange={(e) => {
                const funcionario = funcionariosEmpresa.find((f: any) => f.id === e.target.value)
                setCardForm({ ...cardForm, funcionario_id: e.target.value, portador_nome: funcionario?.nome || cardForm.portador_nome })
              }} className="bbt-input">
                <option value="">Empresa / uso compartilhado</option>
                {funcionariosEmpresa.map((f: any) => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            </Field>
            <Field label="Nome impresso">
              <input value={cardForm.portador_nome} onChange={(e) => setCardForm({ ...cardForm, portador_nome: e.target.value })} className="bbt-input" placeholder={empresaNome} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bandeira">
                <select value={cardForm.bandeira} onChange={(e) => setCardForm({ ...cardForm, bandeira: e.target.value as NonNullable<CartaoCorporativo['bandeira']> })} className="bbt-input">
                  <option value="Visa">Visa</option>
                  <option value="Mastercard">Mastercard</option>
                  <option value="Elo">Elo</option>
                  <option value="Outra">Outra</option>
                </select>
              </Field>
              <Field label="Quatro últimos dígitos">
                <input inputMode="numeric" maxLength={4} value={cardForm.ultimos4} onChange={(e) => setCardForm({ ...cardForm, ultimos4: e.target.value.replace(/\D/g, '').slice(0, 4) })} className="bbt-input" placeholder="0000" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Limite">
                <input type="number" min={0} value={cardForm.limite} onChange={(e) => setCardForm({ ...cardForm, limite: Number(e.target.value || 0) })} className="bbt-input" />
              </Field>
              <Field label="Uso permitido">
                <input value={cardForm.merchant_lock} onChange={(e) => setCardForm({ ...cardForm, merchant_lock: e.target.value })} className="bbt-input" placeholder="Hotel, aéreo..." />
              </Field>
            </div>
            <button type="button" onClick={() => criarCartao()} className="bbt-button-primary w-full">
              <Plus className="h-4 w-4" />
              Registrar cartão
            </button>
          </div>
        </div>

        <div className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
            <h3 className="font-bold text-bbt-primary dark:text-white">Cartões da empresa</h3>
            <p className="text-xs text-slate-500">Registro interno de cartões emitidos e administrados pelo provedor financeiro.</p>
          </div>
          {cartoes.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">Nenhum cartão criado ainda.</div>
          ) : (
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {cartoes.map((c) => (
                <div key={c.id} className="rounded-2xl border border-bbt-gray-100 bg-gradient-to-br from-slate-950 to-blue-950 p-4 text-white shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-blue-100/60">{c.tipo === 'fisico' ? 'Cartão físico' : 'Cartão virtual'}</div>
                      <div className="mt-2 font-bold">{c.apelido}</div>
                      <div className="text-sm text-blue-100/70">{c.portador_nome || empresaNome}</div>
                    </div>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase">{c.status}</span>
                  </div>
                  <div className="mt-8 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-blue-100/50">Final</div>
                      <div className="font-mono text-lg tracking-widest">**** {c.ultimos4 || '----'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-blue-100/50">Limite</div>
                      <div className="font-bold">{formatCurrency(c.limite)}</div>
                    </div>
                  </div>
                  {c.merchant_lock && <div className="mt-3 text-xs text-blue-100/70">Uso permitido: {c.merchant_lock}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
            <h3 className="font-bold text-bbt-primary dark:text-white">Movimentos recentes</h3>
          </div>
          {movimentos.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">Sem movimentos na carteira.</div>
          ) : (
            <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
              {movimentos.slice(0, 12).map((m: any) => (
                <div key={m.id} className="grid grid-cols-[1fr_auto] gap-3 p-4">
                  <div>
                    <div className="font-semibold text-sm">{m.descricao}</div>
                    <div className="text-xs text-slate-500">{m.origem} · {m.status} · {formatDate(m.created_at)}</div>
                  </div>
                  <div className={`font-bold text-sm ${m.tipo === 'debito' ? 'text-red-600' : 'text-green-600'}`}>
                    {m.tipo === 'debito' ? '-' : '+'}{formatCurrency(m.valor)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 p-4 dark:border-slate-700">
            <h3 className="font-bold text-bbt-primary dark:text-white">Faturas da empresa</h3>
          </div>
          {faturas.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">Nenhuma fatura emitida.</div>
          ) : (
            <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
              {faturas.slice(0, 12).map((f: any) => (
                <div key={f.id} className="grid grid-cols-[1fr_auto] gap-3 p-4">
                  <div>
                    <div className="font-semibold text-sm">{f.numero}</div>
                    <div className="text-xs text-slate-500">
                      {formatDate(f.periodo_inicio)} a {formatDate(f.periodo_fim)} · vence {formatDate(f.vencimento)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm">{formatCurrency(f.valor_total - f.valor_pago)}</div>
                    <div className="text-[11px] text-slate-500">{f.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PegadaTab({ atendimentos, stats }: any) {
  const dadosPorTipo = useMemo(() => {
    const map: Record<string, number> = { 'Aéreo': 0, 'Hotel': 0, 'Carro': 0, 'Pacote': 0 }
    atendimentos.forEach((a: Atendimento) => {
      const p = calcularPegadaAtendimento(a)
      if (p) map[p.tipo] = (map[p.tipo] || 0) + p.kg_co2
    })
    return Object.entries(map).filter(([, v]) => v > 0).map(([tipo, kg]) => ({ tipo, kg: Math.round(kg) }))
  }, [atendimentos])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Leaf} label="CO₂e total" value={formatarKg(stats.co2_total)} tone="green" />
        <KpiCard icon={Activity} label="Por viagem (média)" value={
          stats.total_viagens > 0 ? formatarKg(stats.co2_total / stats.total_viagens) : '—'
        } tone="blue" />
        <KpiCard icon={Sparkles} label="Árvores p/ compensar" value={String(stats.arvores)} tone="green" />
        <KpiCard icon={Plane} label="Viagens contadas" value={String(stats.total_viagens)} tone="amber" />
      </div>
      <div className="bbt-card p-5">
        <h3 className="font-semibold text-sm text-bbt-primary dark:text-white mb-3">
          Pegada por categoria
        </h3>
        {dadosPorTipo.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">Sem dados</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dadosPorTipo}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="tipo" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip formatter={(v: number) => formatarKg(v)} />
              <Bar dataKey="kg" fill="#10B981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="bbt-card p-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        <strong className="text-bbt-primary dark:text-white">Sustentabilidade:</strong>{' '}
        Cada viagem é convertida em kg CO₂e usando fatores DEFRA/ICAO (aéreo) e HCMI (hotel).
        Sua empresa pode consultar relatórios completos na seção <Link href="/dashboard/sustentabilidade" className="text-bbt-accent hover:underline">Sustentabilidade ESG</Link>.
      </div>
    </div>
  )
}

function HeroMetric({ icon: Icon, label, value, highlight }: { icon: any; label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-amber-300/40 bg-amber-300/10' : 'border-white/12 bg-white/8'}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${highlight ? 'text-amber-200' : 'text-cyan-200'}`} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-100/60">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, tone, hidden }: { icon: any; label: string; value: string; sub?: string; tone: 'green' | 'amber' | 'red' | 'blue'; hidden?: boolean }) {
  if (hidden) return null
  const toneMap: Record<typeof tone, string> = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  }
  return (
    <div className="bbt-card p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${toneMap[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="min-w-0 break-words text-[11px] uppercase leading-tight tracking-wider text-slate-500 font-semibold [overflow-wrap:anywhere]">{label}</span>
      </div>
      <div className="break-words text-xl font-bold leading-tight tabular-nums text-bbt-primary [overflow-wrap:anywhere] dark:text-white">{value}</div>
      {sub && <div className="mt-0.5 break-words text-[11px] leading-tight text-slate-500 [overflow-wrap:anywhere]">{sub}</div>}
    </div>
  )
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/30' : 'bg-bbt-gray-50 dark:bg-slate-800'}`}>
      <div className="break-words text-[11px] uppercase leading-tight tracking-wider font-semibold text-slate-500 [overflow-wrap:anywhere]">{label}</div>
      <div className="mt-0.5 break-words text-base font-bold leading-tight tabular-nums text-bbt-primary [overflow-wrap:anywhere] dark:text-white">{value}</div>
    </div>
  )
}

function RankingMini({ title, rows }: { title: string; rows: Array<{ nome: string; quantidade: number; total: number; economia?: number }> }) {
  return (
    <div className="bbt-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-bbt-primary dark:text-white">{title}</h3>
      {rows.length === 0 ? (
        <div className="py-5 text-center text-xs text-slate-400">Sem dados no período.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.nome} className="rounded-lg bg-bbt-gray-50 p-3 dark:bg-slate-800">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words text-xs font-semibold leading-tight text-bbt-primary [overflow-wrap:anywhere] dark:text-white">{row.nome}</span>
                <strong className="shrink-0 whitespace-nowrap text-xs tabular-nums">{formatCurrency(row.total)}</strong>
              </div>
              <div className="mt-1 break-words text-[11px] leading-tight text-slate-500 [overflow-wrap:anywhere]">
                {row.quantidade} demanda{row.quantidade === 1 ? '' : 's'}{row.economia ? ` · economia ${formatCurrency(row.economia)}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-bbt-gray-100 bg-bbt-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-bbt-primary dark:text-white">{value}</div>
    </div>
  )
}

function PermissionLine({ label, enabled, text }: { label: string; enabled: boolean; text?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-bbt-gray-50 px-3 py-2 dark:bg-slate-800">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
        enabled
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      }`}>
        {text || (enabled ? 'Liberado' : 'Bloqueado')}
      </span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
        {label}
      </label>
      {children}
    </div>
  )
}

'use client'
/**
 * V10: Lista de Vouchers Emitidos
 * Filtros, busca, criar novo, ver/editar/imprimir, deletar
 */
import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useStore } from '@/lib/store'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import {
  aplicarVouchersEmitidosDoServidor,
  getAllVouchersEmitidos,
  getEstatisticasVouchers,
} from '@/lib/vouchers-emitidos-storage'
import { removeVoucherOnServer } from '@/lib/voucher-persistence-client'
import type { VoucherEmitido, VoucherTipo, VoucherStatus } from '@/types'
import {
  FileText, Plus, Search, Hotel as HotelIcon, Plane, Car, Package,
  Eye, Edit3, Trash2, CheckCircle2, Clock, XCircle, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AIAssistantFab } from '@/components/ai/ai-assistant-fab'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'

const VOUCHERS_PER_PAGE = 50

export default function VouchersPage() {
  const { empresas } = useStore()
  const { companyIds, includesCompany } = useCorporateCompanyScope()
  const empresasNoContexto = useMemo(
    () => empresas.filter((empresa) => includesCompany(empresa.id, 'ver_vouchers')),
    [empresas, includesCompany],
  )
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const canManageVouchers = user?.role === 'master'
    && hasPermission(user, 'operar_reservas')
  const canRemoveVouchers = user?.role === 'master'
    && hasPermission(user, 'operar_cancelamentos')

  const [reload, setReload] = useState(0)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<'todos' | VoucherTipo>('todos')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | VoucherStatus>('todos')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [pagina, setPagina] = useState(1)
  const empresasNoContextoKey = empresasNoContexto.map((empresa) => empresa.id).sort().join('|')

  useEffect(() => {
    if (filtroEmpresa && !empresasNoContexto.some((empresa) => empresa.id === filtroEmpresa)) {
      setFiltroEmpresa('')
    }
  }, [empresasNoContexto, empresasNoContextoKey, filtroEmpresa])

  useEffect(() => {
    let active = true
    void fetch('/api/vouchers?limit=500&offset=0', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result?.ok || !Array.isArray(result.items)) {
          throw new Error(result?.error || 'Falha ao carregar vouchers.')
        }
        if (active) {
          aplicarVouchersEmitidosDoServidor(result.items)
          setReload((value) => value + 1)
        }
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'Falha ao carregar vouchers.')
      })
    return () => { active = false }
  }, [])

  const stats = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return null
    const voucherCompanyIds = companyIds
      ? new Set([...companyIds].filter((companyId) => includesCompany(companyId, 'ver_vouchers')))
      : null
    return getEstatisticasVouchers(voucherCompanyIds)
  }, [companyIds, includesCompany, reload])

  const vouchers = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    let v = getAllVouchersEmitidos().filter((voucher) => includesCompany(voucher.empresa_id, 'ver_vouchers'))
    if (filtroTipo !== 'todos') v = v.filter((x) => x.tipo === filtroTipo)
    if (filtroStatus !== 'todos') v = v.filter((x) => x.status === filtroStatus)
    if (filtroEmpresa) v = v.filter((x) => x.empresa_id === filtroEmpresa)
    if (busca.trim()) {
      const t = busca.toLowerCase()
      v = v.filter((x) =>
        x.id.toLowerCase().includes(t) ||
        x.passageiro_nome.toLowerCase().includes(t) ||
        x.fornecedor_nome.toLowerCase().includes(t) ||
        (x.numero_confirmacao || '').toLowerCase().includes(t)
      )
    }
    return v
  }, [reload, busca, filtroTipo, filtroStatus, filtroEmpresa, includesCompany])

  const totalPaginas = Math.max(1, Math.ceil(vouchers.length / VOUCHERS_PER_PAGE))
  const vouchersPagina = useMemo(() => {
    const inicio = (pagina - 1) * VOUCHERS_PER_PAGE
    return vouchers.slice(inicio, inicio + VOUCHERS_PER_PAGE)
  }, [pagina, vouchers])

  useEffect(() => {
    setPagina(1)
  }, [busca, filtroEmpresa, filtroStatus, filtroTipo])

  useEffect(() => {
    setPagina((atual) => Math.min(atual, totalPaginas))
  }, [totalPaginas])

  async function handleDeletar(v: VoucherEmitido) {
    if (!canRemoveVouchers) {
      toast.error('Você não tem permissão para excluir vouchers.')
      return
    }
    if (!confirm(`Excluir voucher ${v.id}? Esta ação não pode ser desfeita.`)) return
    try {
      await removeVoucherOnServer(v.id)
      toast.success('Voucher excluído.')
      setReload((n) => n + 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao excluir o voucher.')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* HERO V16 */}
      <section className="relative overflow-hidden rounded-lg border border-[#353d78] bg-[#20265a] text-white shadow-[0_12px_30px_rgba(32,38,90,0.16)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#45d0d4_0_38%,#4a3191_38%_76%,#d8a128_76%_100%)]" />
        <div className="relative grid gap-5 p-6 lg:p-7 xl:grid-cols-[1fr_auto] xl:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
              Documentos · Vouchers
            </p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight lg:text-3xl flex items-center gap-3">
              <FileText className="w-7 h-7 text-cyan-200" />
              Vouchers Emitidos
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-blue-100/75">
              Gere, edite, imprima e acompanhe vouchers de hotel, aéreo, carro e pacotes.
            </p>
            {stats && (
              <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-2 max-w-3xl">
                <VoucherHeroMetric icon={FileText} label="Total" value={stats.total} />
                <VoucherHeroMetric icon={Clock} label="Rascunhos" value={stats.rascunhos} />
                <VoucherHeroMetric icon={CheckCircle2} label="Emitidos" value={stats.emitidos} />
                <VoucherHeroMetric icon={CheckCircle2} label="Confirmados" value={stats.confirmados} />
                <VoucherHeroMetric icon={Package} label="Importados" value={stats.importados} />
                <VoucherHeroMetric icon={XCircle} label="Cancelados" value={stats.cancelados} highlight={stats.cancelados > 0} />
              </div>
            )}
          </div>
          {canManageVouchers && (
            <Link href="/dashboard/vouchers/novo"
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-[#061631] font-semibold text-sm hover:brightness-105 transition shadow-lg shadow-cyan-500/20 self-start xl:self-center">
              <Plus className="w-4 h-4" /> Novo Voucher
            </Link>
          )}
        </div>
      </section>

      {/* Faturado destaque */}
      {stats && stats.valor_total > 0 && (
        <div className="bbt-card p-4 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-blue-50 dark:from-emerald-950/20 dark:to-blue-950/20 border-emerald-200/40">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Faturamento total</p>
            <p className="text-2xl font-bold text-bbt-primary dark:text-white mt-0.5">{formatCurrency(stats.valor_total)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Vouchers emitidos</p>
            <p className="text-xl font-bold text-emerald-600">{stats.total}</p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="bbt-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por ID, passageiro, fornecedor..."
              aria-label="Buscar vouchers"
              className="bbt-input pl-9"
            />
          </div>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as 'todos' | VoucherTipo)} aria-label="Filtrar vouchers por tipo" className="bbt-input">
            <option value="todos">Todos os tipos</option>
            <option value="Hotel">Hotel</option>
            <option value="Aéreo">Aéreo</option>
            <option value="Carro">Carro</option>
            <option value="Pacote">Pacote</option>
          </select>
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as 'todos' | VoucherStatus)} aria-label="Filtrar vouchers por status" className="bbt-input">
            <option value="todos">Todos os status</option>
            <option value="rascunho">Rascunho</option>
            <option value="emitido">Emitido</option>
            <option value="confirmado">Confirmado</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} aria-label="Filtrar vouchers por empresa" className="bbt-input">
            <option value="">Todas as empresas</option>
            {empresasNoContexto.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
      </div>

      {/* Lista */}
      <div className="bbt-card overflow-hidden">
        {vouchers.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum voucher encontrado.</p>
            {canManageVouchers && (
              <Link href="/dashboard/vouchers/novo" className="bbt-button-primary inline-flex items-center gap-2 mt-4">
                <Plus className="w-4 h-4" /> Criar primeiro voucher
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left p-3">Voucher</th>
                  <th className="text-left p-3">Passageiro</th>
                  <th className="text-left p-3">Empresa</th>
                  <th className="text-left p-3">Fornecedor</th>
                  <th className="text-left p-3">Período</th>
                  <th className="text-right p-3">Valor</th>
                  <th className="text-center p-3">Status</th>
                  <th className="text-right p-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {vouchersPagina.map((v) => {
                  const empresa = empresas.find((e) => e.id === v.empresa_id)
                  const Icon = v.tipo === 'Hotel' ? HotelIcon : v.tipo === 'Aéreo' ? Plane : v.tipo === 'Carro' ? Car : Package
                  return (
                    <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-bbt-accent" />
                          <div>
                            <div className="font-mono font-semibold">{v.id}</div>
                            <div className="text-[10px] text-slate-400">{formatDate(v.created_at)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">{v.passageiro_nome}</td>
                      <td className="p-3 text-slate-600 dark:text-slate-300">{empresa?.nome || '—'}</td>
                      <td className="p-3 text-slate-600 dark:text-slate-300">{v.fornecedor_nome}</td>
                      <td className="p-3 text-xs">
                        {v.tipo === 'Hotel' && v.data_checkin && v.data_checkout && (
                          <>{formatDataBR(v.data_checkin)} → {formatDataBR(v.data_checkout)}</>
                        )}
                        {v.tipo === 'Aéreo' && v.data_ida && (
                          <>{formatDataBR(v.data_ida)}{v.data_volta ? ` → ${formatDataBR(v.data_volta)}` : ''}</>
                        )}
                        {v.tipo === 'Carro' && v.retirada_data && (
                          <>{formatDataBR(v.retirada_data)}{v.devolucao_data ? ` → ${formatDataBR(v.devolucao_data)}` : ''}</>
                        )}
                      </td>
                      <td className="p-3 text-right font-semibold">{formatCurrency(v.total || 0)}</td>
                      <td className="p-3 text-center"><BadgeStatus status={v.status} /></td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/dashboard/vouchers/${v.id}`} title="Ver / Imprimir" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                            <Eye className="w-4 h-4" />
                          </Link>
                          {canManageVouchers && (
                            <Link href={`/dashboard/vouchers/${v.id}/editar`} title="Editar" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                              <Edit3 className="w-4 h-4" />
                            </Link>
                          )}
                          {canRemoveVouchers && (
                            <button onClick={() => handleDeletar(v)} title="Excluir" className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 rounded">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-700">
              <span>
                Exibindo {(pagina - 1) * VOUCHERS_PER_PAGE + 1}-{Math.min(pagina * VOUCHERS_PER_PAGE, vouchers.length)} de {vouchers.length} voucher(es)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPagina((atual) => Math.max(1, atual - 1))}
                  disabled={pagina <= 1}
                  className="bbt-button-outline h-8 px-3 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <strong className="min-w-14 text-center text-slate-700 dark:text-slate-200">
                  {pagina}/{totalPaginas}
                </strong>
                <button
                  type="button"
                  onClick={() => setPagina((atual) => Math.min(totalPaginas, atual + 1))}
                  disabled={pagina >= totalPaginas}
                  className="bbt-button-outline h-8 px-3 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <AIAssistantFab
        pageContext="Vouchers"
        dataContext={`Total vouchers: ${stats?.total || 0}\nRascunhos: ${stats?.rascunhos || 0}\nEmitidos: ${stats?.emitidos || 0}\nConfirmados: ${stats?.confirmados || 0}\nImportados: ${stats?.importados || 0}\nCancelados: ${stats?.cancelados || 0}\nFaturamento total: ${formatCurrency(stats?.valor_total || 0)}\nFiltros ativos: tipo=${filtroTipo}, status=${filtroStatus}, empresa=${filtroEmpresa || 'todas'}`}
        suggestedPrompts={[
          'Quais vouchers estão pendentes de confirmação?',
          'Qual o ticket médio dos vouchers de hotel?',
          'Tem voucher cancelado recente que merece atenção?',
          'Qual empresa mais emitiu vouchers esse mês?',
        ]}
      />
    </div>
  )
}

function BadgeStatus({ status }: { status: VoucherStatus }) {
  const cfg: Record<VoucherStatus, { lbl: string; cls: string; Icon: any }> = {
    rascunho: { lbl: 'Rascunho', cls: 'bg-slate-100 text-slate-700', Icon: AlertCircle },
    emitido: { lbl: 'Emitido', cls: 'bg-blue-100 text-blue-700', Icon: Clock },
    confirmado: { lbl: 'Confirmado', cls: 'bg-green-100 text-green-700', Icon: CheckCircle2 },
    cancelado: { lbl: 'Cancelado', cls: 'bg-red-100 text-red-700', Icon: XCircle },
  }
  const c = cfg[status]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.cls}`}>
      <c.Icon className="w-3 h-3" /> {c.lbl}
    </span>
  )
}

function formatDataBR(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function VoucherHeroMetric({ icon: Icon, label, value, highlight }: { icon: any; label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 transition ${
      highlight
        ? 'border-amber-300/40 bg-amber-300/10'
        : 'border-white/12 bg-white/8 hover:bg-white/12'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${highlight ? 'text-amber-200' : 'text-cyan-200'}`} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-100/60">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  )
}

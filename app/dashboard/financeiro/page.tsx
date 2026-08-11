'use client'
import { addDaysISODate, lastDayOfMonthISODate, todayISODate } from '@/lib/date'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useStore } from '@/lib/store'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import {
  getAllLancamentos, calcularResumoFinanceiroDaLista, pagarLancamento,
  type LancamentoFinanceiro, type FormaPagamento,
} from '@/lib/financeiro'
import { getAllAtendimentos } from '@/lib/atendimentos-storage'
import {
  createFinancialDemandSyncKey,
  FinanceClientError,
  loadFinancialEntriesFromServer,
  settleFinancialEntryOnServer,
  syncFinancialEntriesFromDemandsOnServer,
} from '@/lib/finance-persistence-client'
import {
  atualizarCarteiraEmpresa,
  criarCartaoCorporativo,
  garantirCarteiraEmpresa,
  gerarFaturaEmpresa,
  getAllCarteirasCorporativas,
  getCartoesCorporativos,
  getFaturasCorporativas,
  marcarFaturaPaga,
  registrarMovimentoCarteira,
} from '@/lib/corporate-finance'
import {
  CORPORATE_FINANCE_RELATIONAL_WRITE_DISABLED,
  CorporateFinanceClientError,
  configureCorporateWalletOnServer,
  createCorporateCardOnServer,
  createCorporateFinanceOperationKey,
  createCorporateWalletMovementOnServer,
  generateCorporateInvoiceOnServer,
  loadCorporateFinanceFromServer,
  settleCorporateInvoiceOnServer,
} from '@/lib/corporate-finance-client'
import { sincronizarTudoOperacional } from '@/lib/operational-sync'
import { useFiltroPersistente } from '@/lib/filtros'
import { formatarValor, formatarData } from '@/lib/normalizers'
import { Modal } from '@/components/ui/modal'
import { DateInput } from '@/components/ui/date-input'
import { NumericDecimalInput } from '@/components/ui/decimal-input'
import { toast } from 'sonner'
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, AlertTriangle, TrendingUp,
  CheckCircle2, RefreshCw, DollarSign, Building2, CreditCard, ReceiptText,
  Plus, Send, LockKeyhole,
} from 'lucide-react'
import type { CartaoCorporativo } from '@/types'
import { AIAssistantFab } from '@/components/ai/ai-assistant-fab'
import { PageHero } from '@/components/ui/page-hero'
import { commitPendingRemoteStorage } from '@/lib/storage-quota'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'

type Aba = 'resumo' | 'receber' | 'pagar' | 'carteira' | 'cartoes' | 'faturas'

export default function FinanceiroPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const { empresas } = useStore()
  const { includesCompany } = useCorporateCompanyScope()
  const empresasNoContexto = useMemo(
    () => empresas.filter((empresa) => includesCompany(empresa.id, 'ver_financeiro')),
    [empresas, includesCompany],
  )
  const podeVer = empresasNoContexto.length > 0 && hasPermission(user, 'ver_financeiro')
  const podeEditarEmpresa = (companyId: string | null | undefined) => includesCompany(companyId, 'editar_financeiro')
  const podeEditarNoContexto = empresasNoContexto.some((empresa) => podeEditarEmpresa(empresa.id))
  const podeReprocessar = !user?.corporate_profile && hasPermission(user, 'editar_financeiro')

  const [aba, setAba] = useState<Aba>('resumo')
  const [reload, setReload] = useState(0)
  const pendingCorporateFinanceKeys = useRef(new Map<string, string>())
  const [pagamento, setPagamento] = useState<LancamentoFinanceiro | null>(null)
  const [aporteValor, setAporteValor] = useState(0)
  const [pixPagamento, setPixPagamento] = useState({ valor: 0, descricao: 'Débito externo conciliado' })
  const [cartaoForm, setCartaoForm] = useState({
    tipo: 'virtual' as CartaoCorporativo['tipo'],
    apelido: 'Cartao viagem',
    portador_nome: '',
    limite: 1000,
    merchant_lock: '',
    ultimos4: '',
    bandeira: 'Visa' as NonNullable<CartaoCorporativo['bandeira']>,
  })
  const mesAtual = todayISODate().slice(0, 7)
  const [periodoFatura, setPeriodoFatura] = useState({
    inicio: `${mesAtual}-01`,
    fim: ultimoDiaMes(mesAtual),
    vencimento: addDays(ultimoDiaMes(mesAtual), 10),
  })

  const [filtro, setFiltro] = useFiltroPersistente(user?.id, 'financeiro', {
    empresa_id: '',
    desde: '',
    ate: '',
    status: '',
  })

  const lancamentos = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    let r = getAllLancamentos().filter((lancamento) => includesCompany(lancamento.empresa_id, 'ver_financeiro'))
    if (filtro.empresa_id) r = r.filter((l) => l.empresa_id === filtro.empresa_id)
    if (filtro.desde) r = r.filter((l) => l.data_vencimento >= filtro.desde!)
    if (filtro.ate) r = r.filter((l) => l.data_vencimento <= filtro.ate!)
    if (filtro.status) r = r.filter((l) => l.status === filtro.status)
    return r.sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
  }, [filtro, includesCompany, reload])

  const resumo = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return null
    const scoped = getAllLancamentos().filter((lancamento) => includesCompany(lancamento.empresa_id, 'ver_financeiro'))
    return calcularResumoFinanceiroDaLista(scoped, {
      desde: filtro.desde || undefined,
      ate: filtro.ate || undefined,
      empresa_id: filtro.empresa_id || undefined,
    })
  }, [filtro, includesCompany, reload])

  const aReceber = lancamentos.filter((l) => l.tipo === 'receber')
  const aPagar = lancamentos.filter((l) => l.tipo === 'pagar')
  const empresaSelecionadaId = filtro.empresa_id || ''
  const empresasNoContextoKey = empresasNoContexto.map((empresa) => empresa.id).sort().join('|')

  useEffect(() => {
    if (empresaSelecionadaId && !empresasNoContexto.some((empresa) => empresa.id === empresaSelecionadaId)) {
      setFiltro({ empresa_id: '' })
    }
  }, [empresaSelecionadaId, empresasNoContexto, empresasNoContextoKey, setFiltro])

  useEffect(() => {
    if (!podeVer) return
    let active = true
    void Promise.allSettled([
      loadFinancialEntriesFromServer(),
      loadCorporateFinanceFromServer(),
    ])
      .then((results) => {
        if (!active) return
        results.forEach((result) => {
          if (result.status === 'rejected') {
            toast.error(
              result.reason instanceof Error
                ? result.reason.message
                : 'Falha ao carregar o financeiro.',
            )
          }
        })
        refresh()
      })
    return () => {
      active = false
    }
  }, [empresasNoContextoKey, podeVer])

  const carteiras = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    const all = getAllCarteirasCorporativas().filter((carteira) => includesCompany(carteira.company_id, 'ver_financeiro'))
    return empresaSelecionadaId ? all.filter((c) => c.company_id === empresaSelecionadaId) : all
  }, [empresaSelecionadaId, includesCompany, reload])
  const cartoes = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    return getCartoesCorporativos(empresaSelecionadaId || undefined)
      .filter((cartao) => includesCompany(cartao.company_id, 'ver_financeiro'))
  }, [empresaSelecionadaId, includesCompany, reload])
  const faturas = useMemo(() => {
    void reload
    if (typeof window === 'undefined') return []
    return getFaturasCorporativas(empresaSelecionadaId || undefined)
      .filter((fatura) => includesCompany(fatura.company_id, 'ver_financeiro'))
  }, [empresaSelecionadaId, includesCompany, reload])
  const carteiraSelecionada = empresaSelecionadaId ? carteiras.find((c) => c.company_id === empresaSelecionadaId) : null

  useEffect(() => {
    if (typeof window === 'undefined') return
    const tab = new URLSearchParams(window.location.search).get('aba') as Aba | null
    if (tab && ['resumo', 'receber', 'pagar', 'carteira', 'cartoes', 'faturas'].includes(tab)) setAba(tab)
  }, [])

  function refresh() { setReload((n) => n + 1) }

  function financeOperationKey(slot: string): string {
    const existing = pendingCorporateFinanceKeys.current.get(slot)
    if (existing) return existing
    const created = createCorporateFinanceOperationKey(
      slot,
      empresaSelecionadaId || 'context',
    )
    pendingCorporateFinanceKeys.current.set(slot, created)
    return created
  }

  function clearFinanceOperationKey(slot: string): void {
    pendingCorporateFinanceKeys.current.delete(slot)
  }

  function shouldUseCorporateFinanceLegacy(error: unknown): boolean {
    return error instanceof CorporateFinanceClientError
      && error.code === CORPORATE_FINANCE_RELATIONAL_WRITE_DISABLED
  }

  async function commitLegacyCorporateFinance(message: string): Promise<boolean> {
    try {
      await commitPendingRemoteStorage()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : message)
      return false
    }
  }

  async function gerarRetroativos() {
    if (!podeReprocessar) {
      toast.error('Somente a operacao interna pode reprocessar a sincronizacao financeira.')
      return
    }
    try {
      const demandas = getAllAtendimentos().filter((demanda) =>
        Boolean(demanda.empresa_id)
        && includesCompany(demanda.empresa_id, 'editar_financeiro')
      )
      if (!demandas.length) {
        toast.info('Nao ha demandas autorizadas para sincronizar.')
        return
      }
      const ids = demandas.map((demanda) => demanda.id)
      const stateFingerprint = demandas
        .map((demanda) => [
          demanda.id,
          demanda.updated_at || '',
          demanda.status,
          demanda.valor_venda || demanda.valor_final || demanda.valor_cotacao || 0,
          demanda.valor_custo || 0,
        ].join('|'))
        .sort()
        .join('\n')
      const result = await syncFinancialEntriesFromDemandsOnServer(
        ids,
        createFinancialDemandSyncKey('finance-retroactive', ids, stateFingerprint),
      )
      toast.success(`${result.entries.length} lancamento(s) financeiro(s) sincronizado(s).`)
    } catch (error) {
      if (
        error instanceof FinanceClientError
        && error.code === 'FINANCE_RELATIONAL_WRITE_DISABLED'
      ) {
        const legacy = sincronizarTudoOperacional()
        try {
          await commitPendingRemoteStorage()
        } catch (commitError) {
          toast.error(
            commitError instanceof Error
              ? commitError.message
              : 'Falha ao confirmar a sincronizacao no servidor.',
          )
          return
        }
        toast.success(
          `${legacy.atendimentosFinanceiro} atendimento(s), ${legacy.vouchersCriados + legacy.vouchersAtualizados} voucher(s) e financeiro sincronizados no modo legado.`,
        )
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Falha ao sincronizar os lancamentos financeiros.',
        )
        return
      }
    }
    refresh()
  }

  function exigirEmpresaSelecionada(): string | null {
    if (!empresaSelecionadaId) {
      toast.error('Selecione uma empresa para usar carteira, cartoes ou faturas.')
      return null
    }
    if (!podeEditarEmpresa(empresaSelecionadaId)) {
      toast.error('Seu acesso a esta empresa e somente para consulta financeira.')
      return null
    }
    return empresaSelecionadaId
  }

  async function ativarCarteira() {
    const empresaId = exigirEmpresaSelecionada()
    if (!empresaId) return
    try {
      await configureCorporateWalletOnServer({
        company_id: empresaId,
        status: 'ativa',
        pix_habilitado: false,
        cartao_habilitado: false,
        limite_credito: carteiraSelecionada?.limite_credito || 0,
        limite_pix_diario: carteiraSelecionada?.limite_pix_diario || 0,
        limite_cartao_mensal: carteiraSelecionada?.limite_cartao_mensal || 0,
        provedor: 'pendente',
        expectedVersion: carteiraSelecionada?.version,
      })
    } catch (error) {
      if (shouldUseCorporateFinanceLegacy(error)) {
        const wallet = garantirCarteiraEmpresa(empresaId)
        atualizarCarteiraEmpresa(wallet.id, {
          status: 'ativa',
          pix_habilitado: false,
          cartao_habilitado: false,
          limite_credito: wallet.limite_credito || 0,
          limite_pix_diario: wallet.limite_pix_diario || 0,
          limite_cartao_mensal: wallet.limite_cartao_mensal || 0,
          provedor: 'pendente',
        })
        if (!await commitLegacyCorporateFinance(
          'Falha ao confirmar o controle financeiro no servidor.',
        )) return
      } else {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o controle financeiro no servidor.')
        return
      }
    }
    toast.success('Controle interno da empresa habilitado. Nenhuma conta bancária foi criada.')
    refresh()
  }

  async function registrarAporte() {
    const empresaId = exigirEmpresaSelecionada()
    if (!empresaId) return
    if (aporteValor <= 0) {
      toast.error('Informe um valor valido.')
      return
    }
    const slot = `credit:${empresaId}:${aporteValor}`
    try {
      await createCorporateWalletMovementOnServer({
        company_id: empresaId,
        tipo: 'credito',
        origem: 'manual',
        valor: aporteValor,
        descricao: 'Credito externo conciliado no controle interno',
        idempotencyKey: financeOperationKey(slot),
        confirmed: true,
      })
    } catch (error) {
      if (shouldUseCorporateFinanceLegacy(error)) {
        registrarMovimentoCarteira({
          company_id: empresaId,
          tipo: 'credito',
          origem: 'manual',
          valor: aporteValor,
          descricao: 'Credito externo conciliado no controle interno',
        })
        if (!await commitLegacyCorporateFinance(
          'Falha ao confirmar o credito no servidor.',
        )) return
      } else {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o credito no servidor.')
        return
      }
    }
    clearFinanceOperationKey(slot)
    setAporteValor(0)
    toast.success('Crédito conciliado registrado no controle interno.')
    refresh()
  }

  async function registrarPixPagamento() {
    const empresaId = exigirEmpresaSelecionada()
    if (!empresaId) return
    if (pixPagamento.valor <= 0) {
      toast.error('Informe um valor de débito válido.')
      return
    }
    const saldoOperacional = Number(carteiraSelecionada?.saldo_disponivel || 0)
      + Number(carteiraSelecionada?.limite_credito || 0)
    if (saldoOperacional < pixPagamento.valor) {
      toast.error('Saldo/limite interno insuficiente para registrar este débito.')
      return
    }
    const descricao = pixPagamento.descricao || 'Debito externo conciliado'
    const slot = `debit:${empresaId}:${pixPagamento.valor}:${descricao}`
    try {
      await createCorporateWalletMovementOnServer({
        company_id: empresaId,
        tipo: 'debito',
        origem: 'manual',
        valor: pixPagamento.valor,
        descricao,
        idempotencyKey: financeOperationKey(slot),
        confirmed: true,
      })
    } catch (error) {
      if (shouldUseCorporateFinanceLegacy(error)) {
        const movimento = registrarMovimentoCarteira({
          company_id: empresaId,
          tipo: 'debito',
          origem: 'manual',
          valor: pixPagamento.valor,
          descricao,
        })
        if (!movimento) {
          toast.error('Não foi possível registrar o débito conciliado.')
          return
        }
        if (!await commitLegacyCorporateFinance(
          'Falha ao confirmar o debito no servidor.',
        )) return
      } else {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o debito no servidor.')
        return
      }
    }
    clearFinanceOperationKey(slot)
    setPixPagamento({ valor: 0, descricao: 'Débito externo conciliado' })
    toast.success('Débito já realizado registrado no controle interno.')
    refresh()
  }

  async function criarCartao(tipo?: CartaoCorporativo['tipo']) {
    const empresaId = exigirEmpresaSelecionada()
    if (!empresaId) return
    let card: CartaoCorporativo | null = null
    try {
      card = await createCorporateCardOnServer({
        company_id: empresaId,
        tipo: tipo || cartaoForm.tipo,
        apelido: cartaoForm.apelido || 'Cartao viagem',
        portador_nome: cartaoForm.portador_nome || undefined,
        limite: cartaoForm.limite,
        merchant_lock: cartaoForm.merchant_lock || undefined,
        funcionario_id: null,
        ultimos4: cartaoForm.ultimos4,
        bandeira: cartaoForm.bandeira,
      })
    } catch (error) {
      if (shouldUseCorporateFinanceLegacy(error)) {
        card = criarCartaoCorporativo({
          company_id: empresaId,
          tipo: tipo || cartaoForm.tipo,
          apelido: cartaoForm.apelido || 'Cartao viagem',
          portador_nome: cartaoForm.portador_nome || undefined,
          limite: cartaoForm.limite,
          merchant_lock: cartaoForm.merchant_lock || undefined,
          criado_por_user_id: user?.id,
          ultimos4: cartaoForm.ultimos4,
          bandeira: cartaoForm.bandeira,
        })
        if (
          card
          && !await commitLegacyCorporateFinance('Falha ao confirmar o cartao no servidor.')
        ) return
      } else {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar o cartao no servidor.')
        return
      }
    }
    if (!card) {
      toast.error('Informe os quatro últimos dígitos de um cartão já emitido.')
      return
    }
    toast.success('Cartão já emitido registrado no controle interno.')
    refresh()
  }

  async function gerarFatura() {
    const empresaId = exigirEmpresaSelecionada()
    if (!empresaId) return
    const slot = [
      'invoice',
      empresaId,
      periodoFatura.inicio,
      periodoFatura.fim,
      periodoFatura.vencimento,
    ].join(':')
    let fatura: (typeof faturas)[number] | null = null
    try {
      const result = await generateCorporateInvoiceOnServer({
        company_id: empresaId,
        periodo_inicio: periodoFatura.inicio,
        periodo_fim: periodoFatura.fim,
        vencimento: periodoFatura.vencimento,
        idempotencyKey: financeOperationKey(slot),
        confirmed: true,
      })
      fatura = result.invoice
    } catch (error) {
      if (shouldUseCorporateFinanceLegacy(error)) {
        fatura = gerarFaturaEmpresa({
          company_id: empresaId,
          lancamentos: getAllLancamentos(),
          periodo_inicio: periodoFatura.inicio,
          periodo_fim: periodoFatura.fim,
          vencimento: periodoFatura.vencimento,
        })
        if (
          fatura
          && !await commitLegacyCorporateFinance('Falha ao confirmar a fatura no servidor.')
        ) return
      } else {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar a fatura no servidor.')
        return
      }
    }
    if (!fatura) {
      toast.error('Nao foi possivel gerar a fatura.')
      return
    }
    clearFinanceOperationKey(slot)
    toast.success(`Fatura ${fatura.numero} gerada/atualizada.`)
    refresh()
  }

  async function quitarFatura(id: string) {
    const atual = faturas.find((fatura) => fatura.id === id)
    if (!atual || !podeEditarEmpresa(atual.company_id)) {
      toast.error('Seu acesso a esta empresa e somente para consulta financeira.')
      return
    }
    const slot = `settle:${id}:${atual.version || 1}`
    let fatura: (typeof faturas)[number] | null = null
    try {
      const result = await settleCorporateInvoiceOnServer(id, {
        expectedVersion: atual.version || 1,
        idempotencyKey: financeOperationKey(slot),
        confirmed: true,
      })
      fatura = result.invoice
    } catch (error) {
      if (shouldUseCorporateFinanceLegacy(error)) {
        fatura = marcarFaturaPaga(id)
        if (
          fatura
          && !await commitLegacyCorporateFinance('Falha ao confirmar a quitacao no servidor.')
        ) return
      } else {
        toast.error(error instanceof Error ? error.message : 'Falha ao confirmar a quitacao no servidor.')
        return
      }
    }
    if (!fatura) {
      toast.error('Nao foi possivel quitar a fatura.')
      return
    }
    clearFinanceOperationKey(slot)
    toast.success(`Fatura ${fatura.numero} marcada como paga.`)
    refresh()
  }

  if (!podeVer) {
    return (
      <div className="bbt-card p-10 text-center">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
        <h3 className="font-semibold">Acesso restrito</h3>
        <p className="text-sm text-slate-500 mt-1">Você precisa da permissão "ver_financeiro" para acessar este módulo.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        eyebrow="Operações financeiras"
        title="Financeiro"
        icon={Wallet}
        description="Contas a pagar e receber conectadas a demandas, vouchers manuais/importados e Wintour."
        bgImage="https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=2000&q=85"
        metrics={[
          { icon: ArrowDownCircle, label: 'A receber', value: formatarValor(resumo?.total_a_receber || 0) },
          { icon: ArrowUpCircle, label: 'A pagar', value: formatarValor(resumo?.total_a_pagar || 0) },
          { icon: CheckCircle2, label: 'Recebido', value: formatarValor(resumo?.recebido || 0) },
          { icon: TrendingUp, label: 'Saldo', value: formatarValor(resumo?.saldo_previsto || 0), highlight: (resumo?.saldo_previsto || 0) < 0 },
        ]}
        actions={podeReprocessar ?
          <button onClick={gerarRetroativos}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-white text-sm hover:bg-white/15 transition border border-white/15">
            <RefreshCw className="w-4 h-4" /> Reprocessar sincronização
          </button>
          : undefined}
      />

      {!podeEditarNoContexto && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
          Acesso financeiro em modo de consulta para o contexto selecionado.
        </div>
      )}

      <div className="bbt-card p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Empresa</label>
          <select value={filtro.empresa_id || ''} onChange={(e) => setFiltro({ empresa_id: e.target.value })} className="bbt-input text-sm">
            <option value="">Todas</option>
            {empresasNoContexto.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="financeiro-filtro-desde" className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Desde</label>
          <DateInput id="financeiro-filtro-desde" value={filtro.desde || ''} onChange={(e) => setFiltro({ desde: e.target.value })} className="text-sm" />
        </div>
        <div>
          <label htmlFor="financeiro-filtro-ate" className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Até</label>
          <DateInput id="financeiro-filtro-ate" value={filtro.ate || ''} onChange={(e) => setFiltro({ ate: e.target.value })} className="text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Status</label>
          <select value={filtro.status || ''} onChange={(e) => setFiltro({ status: e.target.value })} className="bbt-input text-sm">
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="pago">Pago</option>
            <option value="parcial">Parcial</option>
            <option value="atrasado">Atrasado</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </div>
        <button onClick={() => setFiltro({ empresa_id: '', desde: '', ate: '', status: '' })}
          className="text-xs text-bbt-accent hover:underline">Limpar filtros</button>
      </div>

      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={ArrowDownCircle} cor="text-green-600" label="A Receber" valor={formatarValor(resumo.total_a_receber)} sub={`Recebido: ${formatarValor(resumo.recebido)}`} />
          <KPI icon={ArrowUpCircle} cor="text-red-600" label="A Pagar" valor={formatarValor(resumo.total_a_pagar)} sub={`Pago: ${formatarValor(resumo.pago)}`} />
          <KPI icon={TrendingUp} cor={resumo.saldo_previsto >= 0 ? 'text-green-600' : 'text-red-600'} label="Saldo Previsto" valor={formatarValor(resumo.saldo_previsto)} />
          <KPI icon={AlertTriangle} cor="text-amber-600" label="Atrasados" valor={formatarValor(resumo.atrasados_receber + resumo.atrasados_pagar)} />
        </div>
      )}

      <div className="bbt-tabs">
        <BtnAba active={aba === 'resumo'} onClick={() => setAba('resumo')} label="Resumo" />
        <BtnAba active={aba === 'receber'} onClick={() => setAba('receber')} label={`A Receber (${aReceber.length})`} />
        <BtnAba active={aba === 'pagar'} onClick={() => setAba('pagar')} label={`A Pagar (${aPagar.length})`} />
        <BtnAba active={aba === 'carteira'} onClick={() => setAba('carteira')} label={`Carteira (${carteiras.length})`} />
        <BtnAba active={aba === 'cartoes'} onClick={() => setAba('cartoes')} label={`Cartoes (${cartoes.length})`} />
        <BtnAba active={aba === 'faturas'} onClick={() => setAba('faturas')} label={`Faturas (${faturas.length})`} />
      </div>

      {aba === 'resumo' && resumo && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bbt-card p-4 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-bbt-accent" />
                  Controle interno de saldos, cartões e faturas
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Concilie créditos e débitos já realizados, cadastre cartões emitidos e acompanhe faturas por empresa.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setAba('carteira')} className="bbt-button-primary">
                  <Wallet className="w-4 h-4" /> Abrir controle interno
                </button>
                <button type="button" onClick={() => setAba('cartoes')} className="bbt-button-outline">
                  <CreditCard className="w-4 h-4" /> Cartoes fisicos/virtuais
                </button>
                <button type="button" onClick={() => setAba('faturas')} className="bbt-button-outline">
                  <ReceiptText className="w-4 h-4" /> Faturas
                </button>
              </div>
            </div>
          </div>
          <div className="bbt-card p-4">
            <h3 className="font-semibold mb-3">Por categoria</h3>
            <div className="space-y-2">
              {Object.entries(resumo.por_categoria).map(([cat, vals]) => {
                const v = vals as { receber: number; pagar: number }
                return (
                  <div key={cat} className="flex items-center justify-between text-sm border-b border-bbt-gray-100 dark:border-slate-700 py-1.5">
                    <span>{cat}</span>
                    <div className="flex gap-3 text-xs">
                      <span className="text-green-600">+{formatarValor(v.receber)}</span>
                      <span className="text-red-600">-{formatarValor(v.pagar)}</span>
                    </div>
                  </div>
                )
              })}
              {Object.keys(resumo.por_categoria).length === 0 && (
                <p className="text-xs text-slate-400 text-center py-3">Sem dados</p>
              )}
            </div>
          </div>
          <div className="bbt-card p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-bbt-accent" /> Por empresa
            </h3>
            <div className="space-y-2">
              {Object.entries(resumo.por_empresa).map(([empId, vals]) => {
                const emp = empresas.find((e) => e.id === empId)
                const v = vals as { receber: number; pagar: number }
                return (
                  <div key={empId} className="flex items-center justify-between text-sm border-b border-bbt-gray-100 dark:border-slate-700 py-1.5">
                    <span className="truncate">{emp?.nome || empId}</span>
                    <div className="flex gap-3 text-xs whitespace-nowrap">
                      <span className="text-green-600">+{formatarValor(v.receber)}</span>
                      <span className="text-red-600">-{formatarValor(v.pagar)}</span>
                    </div>
                  </div>
                )
              })}
              {Object.keys(resumo.por_empresa).length === 0 && (
                <p className="text-xs text-slate-400 text-center py-3">Sem dados</p>
              )}
            </div>
          </div>
        </div>
      )}

      {(aba === 'receber' || aba === 'pagar') && (
        <div className="bbt-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bbt-gray-50 dark:bg-slate-900/30">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">Vencimento</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">Descrição</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">{aba === 'receber' ? 'Cliente' : 'Fornecedor'}</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-slate-500">Valor</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-slate-500">Pago</th>
                <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(aba === 'receber' ? aReceber : aPagar).map((l) => {
                const emp = l.empresa_id ? empresas.find((e) => e.id === l.empresa_id) : null
                return (
                  <tr key={l.id} className="border-t border-bbt-gray-100 dark:border-slate-700 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30">
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{formatarData(l.data_vencimento)}</td>
                    <td className="px-3 py-2 text-xs">{l.descricao}</td>
                    <td className="px-3 py-2 text-xs truncate max-w-[180px]">{emp?.nome || l.fornecedor_nome || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-sm">{formatarValor(l.valor)}</td>
                    <td className="px-3 py-2 text-right text-xs text-green-600">{formatarValor(l.valor_pago)}</td>
                    <td className="px-3 py-2 text-center"><StatusBadge status={l.status} /></td>
                    <td className="px-3 py-2">
                      {podeEditarEmpresa(l.empresa_id) && l.status !== 'pago' && l.status !== 'cancelado' && (
                        <button onClick={() => setPagamento(l)} className="text-xs bbt-button-primary py-1 px-2 flex items-center gap-1">
                          <DollarSign className="w-3 h-3" /> {l.tipo === 'pagar' ? 'Pagar' : 'Receber'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {(aba === 'receber' ? aReceber : aPagar).length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">Nenhum lançamento</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'carteira' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
          <div className="bbt-card p-4 space-y-4">
            <div>
              <Wallet className="w-6 h-6 text-bbt-accent mb-2" />
              <h3 className="font-semibold">Controle financeiro interno</h3>
              <p className="text-sm text-slate-500 mt-1">
                Registro contábil auxiliar de saldos e limites. Esta área não movimenta conta bancária nem envia pagamentos.
              </p>
            </div>
            <EmpresaCarteiraSelect empresas={empresasNoContexto} value={empresaSelecionadaId} onChange={(empresa_id) => setFiltro({ empresa_id })} />
            <button onClick={ativarCarteira} className="bbt-button-primary w-full">
              <CheckCircle2 className="w-4 h-4" /> Habilitar controle da empresa
            </button>
            <div className="border-t border-bbt-gray-100 dark:border-slate-700 pt-3">
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Crédito externo já conciliado</label>
              <div className="flex gap-2">
                <NumericDecimalInput
                  value={aporteValor}
                  emptyValue={0}
                  onNumberChange={(value) => setAporteValor(value ?? 0)}
                  containerClassName="flex-1"
                />
                <button onClick={registrarAporte} className="bbt-button-accent">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="border-t border-bbt-gray-100 dark:border-slate-700 pt-3">
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Débito externo já realizado</label>
              <input
                value={pixPagamento.descricao}
                onChange={(e) => setPixPagamento({ ...pixPagamento, descricao: e.target.value })}
                className="bbt-input mb-2"
                placeholder="Descrição e referência da transação"
              />
              <div className="flex gap-2">
                <NumericDecimalInput
                  value={pixPagamento.valor}
                  emptyValue={0}
                  onNumberChange={(value) => setPixPagamento({ ...pixPagamento, valor: value ?? 0 })}
                  containerClassName="flex-1"
                />
                <button onClick={registrarPixPagamento} className="bbt-button-primary">
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Somente conciliação interna. O sistema não envia Pix nem movimenta uma conta bancária.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(empresaSelecionadaId ? carteiras : carteiras.slice(0, 12)).map((c) => {
              const emp = empresas.find((e) => e.id === c.company_id)
              return (
                <div key={c.id} className="bbt-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">Empresa</div>
                      <h3 className="font-semibold">{emp?.nome || c.company_id}</h3>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                    <Info label="Saldo" value={formatarValor(c.saldo_disponivel)} />
                    <Info label="Limite credito" value={formatarValor(c.limite_credito)} />
                    <Info label="Pix diario" value={formatarValor(c.limite_pix_diario)} />
                    <Info label="Cartao mes" value={formatarValor(c.limite_cartao_mensal)} />
                  </div>
                  <div className="mt-3 text-xs text-slate-500">
                    Pix: {c.pix_habilitado ? 'habilitado' : 'pendente'} · Cartao: {c.cartao_habilitado ? 'habilitado' : 'pendente'} · Provedor: {c.provedor || 'pendente'}
                  </div>
                </div>
              )
            })}
            {carteiras.length === 0 && (
              <div className="bbt-card p-10 text-center text-sm text-slate-400 md:col-span-2">
                Selecione uma empresa e habilite a carteira corporativa.
              </div>
            )}
          </div>
        </div>
      )}

      {aba === 'cartoes' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
          <div className="bbt-card p-4 space-y-3">
            <CreditCard className="w-6 h-6 text-bbt-accent" />
            <h3 className="font-semibold">Cadastro de cartões emitidos</h3>
            <p className="text-sm text-slate-500">Registre somente cartões reais já emitidos pelo provedor financeiro. Esta tela não solicita emissão bancária.</p>
            <EmpresaCarteiraSelect empresas={empresasNoContexto} value={empresaSelecionadaId} onChange={(empresa_id) => setFiltro({ empresa_id })} />
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Bandeira</label>
              <select value={cartaoForm.bandeira} onChange={(e) => setCartaoForm({ ...cartaoForm, bandeira: e.target.value as NonNullable<CartaoCorporativo['bandeira']> })} className="bbt-input">
                <option value="Visa">Visa</option>
                <option value="Mastercard">Mastercard</option>
                <option value="Elo">Elo</option>
                <option value="Outra">Outra</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Quatro últimos dígitos</label>
              <input inputMode="numeric" maxLength={4} value={cartaoForm.ultimos4} onChange={(e) => setCartaoForm({ ...cartaoForm, ultimos4: e.target.value.replace(/\D/g, '').slice(0, 4) })} className="bbt-input" placeholder="0000" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Tipo</label>
              <select value={cartaoForm.tipo} onChange={(e) => setCartaoForm({ ...cartaoForm, tipo: e.target.value as CartaoCorporativo['tipo'] })} className="bbt-input">
                <option value="virtual">Virtual</option>
                <option value="fisico">Fisico</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Apelido</label>
              <input value={cartaoForm.apelido} onChange={(e) => setCartaoForm({ ...cartaoForm, apelido: e.target.value })} className="bbt-input" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Portador</label>
              <input value={cartaoForm.portador_nome} onChange={(e) => setCartaoForm({ ...cartaoForm, portador_nome: e.target.value })} className="bbt-input" placeholder="Opcional" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Limite</label>
              <NumericDecimalInput
                value={cartaoForm.limite}
                emptyValue={0}
                onNumberChange={(value) => setCartaoForm({ ...cartaoForm, limite: value ?? 0 })}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Restricao fornecedor/categoria</label>
              <input value={cartaoForm.merchant_lock} onChange={(e) => setCartaoForm({ ...cartaoForm, merchant_lock: e.target.value })} className="bbt-input" placeholder="Ex: hotel, aéreo, Tech Travel" />
            </div>
            <button onClick={() => criarCartao()} className="bbt-button-primary w-full">
              <Plus className="w-4 h-4" /> Registrar cartão
            </button>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              A emissão, o bloqueio e a movimentação financeira continuam no provedor do cartão até existir uma integração bancária homologada.
            </div>
          </div>
          <div className="bbt-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bbt-gray-50 dark:bg-slate-900/30">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">Cartao</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">Empresa</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">Portador</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-slate-500">Limite</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-slate-500">Gasto mes</th>
                  <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wider text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {cartoes.map((c) => {
                  const emp = empresas.find((e) => e.id === c.company_id)
                  return (
                    <tr key={c.id} className="border-t border-bbt-gray-100 dark:border-slate-700">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{c.apelido}</div>
                        <div className="text-xs text-slate-500">{c.tipo} · {c.bandeira || 'Cartao'} final {c.ultimos4 || '----'}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{emp?.nome || c.company_id}</td>
                      <td className="px-3 py-2 text-xs">{c.portador_nome || 'Empresa'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatarValor(c.limite)}</td>
                      <td className="px-3 py-2 text-right text-xs">{formatarValor(c.gasto_mes || 0)}</td>
                      <td className="px-3 py-2 text-center"><StatusBadge status={c.status} /></td>
                    </tr>
                  )
                })}
                {cartoes.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">Nenhum cartao corporativo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === 'faturas' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
          <div className="bbt-card p-4 space-y-3">
            <ReceiptText className="w-6 h-6 text-bbt-accent" />
            <h3 className="font-semibold">Gerar fatura da empresa</h3>
            <p className="text-sm text-slate-500">Agrupa contas a receber do periodo para emissao e acompanhamento da cobranca.</p>
            <EmpresaCarteiraSelect empresas={empresasNoContexto} value={empresaSelecionadaId} onChange={(empresa_id) => setFiltro({ empresa_id })} />
            <div>
              <label htmlFor="fatura-periodo-inicio" className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Inicio</label>
              <DateInput id="fatura-periodo-inicio" value={periodoFatura.inicio} onChange={(e) => setPeriodoFatura({ ...periodoFatura, inicio: e.target.value })} />
            </div>
            <div>
              <label htmlFor="fatura-periodo-fim" className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Fim</label>
              <DateInput id="fatura-periodo-fim" value={periodoFatura.fim} onChange={(e) => setPeriodoFatura({ ...periodoFatura, fim: e.target.value })} />
            </div>
            <div>
              <label htmlFor="fatura-periodo-vencimento" className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Vencimento</label>
              <DateInput id="fatura-periodo-vencimento" value={periodoFatura.vencimento} onChange={(e) => setPeriodoFatura({ ...periodoFatura, vencimento: e.target.value })} />
            </div>
            <button onClick={gerarFatura} className="bbt-button-primary w-full">
              <ReceiptText className="w-4 h-4" /> Gerar/atualizar fatura
            </button>
          </div>
          <div className="bbt-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bbt-gray-50 dark:bg-slate-900/30">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">Fatura</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">Empresa</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">Periodo</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-slate-500">Total</th>
                  <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {faturas.map((f) => {
                  const emp = empresas.find((e) => e.id === f.company_id)
                  return (
                    <tr key={f.id} className="border-t border-bbt-gray-100 dark:border-slate-700">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{f.numero}</div>
                        <div className="text-xs text-slate-500">Venc. {formatarData(f.vencimento)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{emp?.nome || f.company_id}</td>
                      <td className="px-3 py-2 text-xs">{formatarData(f.periodo_inicio)} a {formatarData(f.periodo_fim)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatarValor(f.valor_total)}</td>
                      <td className="px-3 py-2 text-center"><StatusBadge status={f.status} /></td>
                      <td className="px-3 py-2 text-right">
                        {f.status !== 'paga' && f.status !== 'cancelada' && (
                          <button onClick={() => quitarFatura(f.id)} className="bbt-button-outline h-8 text-xs">
                            <CheckCircle2 className="w-3 h-3" /> Marcar paga
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {faturas.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">Nenhuma fatura corporativa.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!pagamento} onClose={() => setPagamento(null)} title={pagamento ? `${pagamento.tipo === 'pagar' ? 'Pagar' : 'Receber'}: ${pagamento.descricao}` : ''} size="md">
        {pagamento && user && (
          <PagamentoForm lancamento={pagamento} userId={user.id} userName={user.name}
            onSucesso={() => { setPagamento(null); refresh() }} />
        )}
      </Modal>

      <AIAssistantFab
        pageContext="Financeiro"
        dataContext={`Total a receber: ${formatarValor(resumo?.total_a_receber || 0)}\nTotal a pagar: ${formatarValor(resumo?.total_a_pagar || 0)}\nRecebido: ${formatarValor(resumo?.recebido || 0)}\nPago: ${formatarValor(resumo?.pago || 0)}\nSaldo previsto: ${formatarValor(resumo?.saldo_previsto || 0)}\nLançamentos a receber: ${aReceber.length}\nLançamentos a pagar: ${aPagar.length}`}
        suggestedPrompts={[
          'Quais clientes estão atrasados nos pagamentos?',
          'Resumo financeiro do mês',
          'Quanto vou receber nos próximos 7 dias?',
          'Qual fornecedor com maior valor a pagar?',
          'Tem alguma anomalia no fluxo de caixa?',
        ]}
      />
    </div>
  )
}

function PagamentoForm({ lancamento, userId, userName, onSucesso }: any) {
  const restante = lancamento.valor - lancamento.valor_pago
  const [valor, setValor] = useState(restante)
  const [data, setData] = useState(todayISODate())
  const [forma, setForma] = useState<FormaPagamento>('PIX')
  const [salvando, setSalvando] = useState(false)
  const [idempotencyKey] = useState(
    () => `finance:settle:${lancamento.id}:${crypto.randomUUID()}`,
  )

  async function submit() {
    if (valor <= 0) { toast.error('Valor inválido'); return }
    if (salvando) return
    setSalvando(true)
    try {
      await settleFinancialEntryOnServer(lancamento.id, {
        valor,
        data_pagamento: data,
        forma_pagamento: forma,
        expectedVersion: lancamento.version || 1,
        idempotencyKey,
      })
      toast.success('Lançamento atualizado')
      onSucesso()
    } catch (error) {
      if (
        error instanceof FinanceClientError
        && error.code === 'FINANCE_RELATIONAL_WRITE_DISABLED'
        && pagarLancamento(lancamento.id, valor, data, forma, userId, userName)
      ) {
        try {
          await commitPendingRemoteStorage()
        } catch (commitError) {
          toast.error(
            commitError instanceof Error
              ? commitError.message
              : 'Falha ao confirmar o pagamento no servidor.',
          )
          return
        }
        toast.success('Lançamento atualizado no modo legado')
        onSucesso()
      } else {
        toast.error(error instanceof Error ? error.message : 'Erro ao atualizar o lancamento.')
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm bg-bbt-gray-50 dark:bg-slate-800 rounded-lg p-3">
        <div className="flex justify-between"><span>Valor total</span><strong>{formatarValor(lancamento.valor)}</strong></div>
        <div className="flex justify-between"><span>Já {lancamento.tipo === 'pagar' ? 'pago' : 'recebido'}</span><span className="text-green-600">{formatarValor(lancamento.valor_pago)}</span></div>
        <div className="flex justify-between border-t border-bbt-gray-200 dark:border-slate-700 mt-1 pt-1"><span>Restante</span><strong>{formatarValor(restante)}</strong></div>
      </div>
      <div>
        <label className="text-xs uppercase tracking-wider text-slate-500">Valor</label>
        <NumericDecimalInput
          value={valor}
          emptyValue={0}
          onNumberChange={(nextValue) => setValor(nextValue ?? 0)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="pagamento-data" className="text-xs uppercase tracking-wider text-slate-500">Data</label>
          <DateInput id="pagamento-data" value={data} onChange={(e) => setData(e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-slate-500">Forma</label>
          <select value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)} className="bbt-input w-full">
            <option>PIX</option>
            <option>Boleto</option>
            <option>TED</option>
            <option>Cartão</option>
            <option>Dinheiro</option>
            <option>Faturamento</option>
            <option>Outro</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={submit}
          disabled={salvando}
          className="bbt-button-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {salvando
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <CheckCircle2 className="w-4 h-4" />}
          {salvando ? 'Confirmando...' : 'Confirmar'}
        </button>
      </div>
    </div>
  )
}

function KPI({ icon: Icon, cor, label, valor, sub }: any) {
  return (
    <div className="bbt-card p-3">
      <Icon className={`w-5 h-5 ${cor} mb-1`} />
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-bold">{valor}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function BtnAba({ active, onClick, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`bbt-tab ${active ? 'bbt-tab-active' : ''}`}
    >
      {label}
    </button>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-bbt-gray-100 p-2 dark:border-slate-700">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

function EmpresaCarteiraSelect({
  empresas,
  value,
  onChange,
}: {
  empresas: Array<{ id: string; nome: string }>
  value: string
  onChange: (empresaId: string) => void
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Empresa da carteira</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bbt-input">
        <option value="">Selecione uma empresa</option>
        {empresas.map((empresa) => (
          <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
        ))}
      </select>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    pendente: { bg: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', label: 'Pendente' },
    pago: { bg: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'Pago' },
    parcial: { bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Parcial' },
    atrasado: { bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Atrasado' },
    cancelado: { bg: 'bg-slate-100 text-slate-400 dark:bg-slate-800', label: 'Cancelado' },
    aberta: { bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Aberta' },
    fechada: { bg: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300', label: 'Fechada' },
    vencida: { bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Vencida' },
    ativa: { bg: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'Ativa' },
    bloqueada: { bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Bloqueada' },
    pendente_configuracao: { bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', label: 'Pendente configuracao' },
    ativo: { bg: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'Ativo' },
    bloqueado: { bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Bloqueado' },
    pendente_emissao: { bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', label: 'Pendente emissao' },
  }
  const c = map[status] || map.pendente
  return <span className={`text-[10px] px-2 py-0.5 rounded ${c.bg}`}>{c.label}</span>
}

function ultimoDiaMes(yyyyMm: string): string {
  return lastDayOfMonthISODate(yyyyMm)
}

function addDays(iso: string, days: number): string {
  return addDaysISODate(iso, days)
}

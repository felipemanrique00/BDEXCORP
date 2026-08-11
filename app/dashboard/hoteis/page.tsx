'use client'
import { todayISODate } from '@/lib/date'
import { useState, useMemo, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { WhatsAppButton } from '@/components/ui/whatsapp-button'
import { formatCurrency, onlyDigits } from '@/lib/utils'
import {
  Hotel as HotelIcon, Plus, Search, Edit2, Trash2, Download, Eye, MapPin,
  Coffee, Car, Droplets, LayoutGrid, List, Crown, Briefcase, User, TrendingUp, TrendingDown,
  ExternalLink, SearchX, Sparkles, FileText, ArrowUpDown, CreditCard, X, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import type { Hotel, FormaPagamento } from '@/types'
import { AIAssistantFab } from '@/components/ai/ai-assistant-fab'
import { PageHero } from '@/components/ui/page-hero'
import { FORMAS_PAGAMENTO_LABEL } from '@/types'
import { getRankingHoteisByEmpresa } from '@/lib/emissoes-storage'
import { RegistrarEmissaoModal } from '@/components/ui/registrar-emissao-modal'
import { NumericDecimalInput } from '@/components/ui/decimal-input'
import { buildCsv, downloadTextFile } from '@/lib/browser-download'
import {
  buscarHoteisComIA,
  extrairDestinoHotel,
  hotelJaExiste,
  sugestaoParaHotel,
  type HotelAISuggestion,
} from '@/lib/ia-hotel-search'

type ViewMode = 'lista' | 'cidade'
type OrdenarPor = 'nome' | 'cidade' | 'tarifa_asc' | 'mais_emitidos'

const FORMAS_PAGAMENTO_ALL: FormaPagamento[] = ['IV', 'PX', 'CP', 'CC']
const HOTELS_PER_PAGE = 50

const FORMAS_COLOR: Record<FormaPagamento, string> = {
  IV: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
  PX: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
  CP: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',
  CC: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700',
}

export default function HoteisPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const canManageHotels = user?.role === 'master' && hasPermission(user, 'cadastrar_hoteis')
  const canRegisterEmission = user?.role === 'master'
  const { empresas, hoteis, politicas, addHotel, updateHotel, deleteHotel } = useStore()

  const [viewMode, setViewMode] = useState<ViewMode>('lista')
  const [search, setSearch] = useState('')
  const [ufFilter, setUfFilter] = useState('Todos')
  const [faturadoFilter, setFaturadoFilter] = useState<'Todos' | 'Sim' | 'Não'>('Todos')
  const [formaPgFilter, setFormaPgFilter] = useState<FormaPagamento | 'Todas'>('Todas')
  const [empresaFilter, setEmpresaFilter] = useState('Todas')
  const [ordenarPor, setOrdenarPor] = useState<OrdenarPor>('nome')
  const [empresaRef, setEmpresaRef] = useState(empresas[0]?.id || '')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Hotel | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Hotel | null>(null)
  const [prefillCidade, setPrefillCidade] = useState<{ cidade: string; uf: string } | null>(null)
  const [emissaoHotel, setEmissaoHotel] = useState<Hotel | null>(null)
  const [emissoesReload, setEmissoesReload] = useState(0)
  const [buscandoIA, setBuscandoIA] = useState(false)
  const [sugestoesIA, setSugestoesIA] = useState<HotelAISuggestion[]>([])
  const [resumoIA, setResumoIA] = useState('')
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const busca = params.get('busca')
    if (busca) setSearch(busca)
  }, [])

  const rankingMap = useMemo(() => {
    void emissoesReload
    if (empresaFilter === 'Todas') return new Map<number, number>()
    const rk = getRankingHoteisByEmpresa(empresaFilter)
    return new Map(rk.map((r) => [r.hotel_id, r.total]))
  }, [empresaFilter, emissoesReload])

  const ufs = useMemo(() => Array.from(new Set(hoteis.map((h) => h.uf))).sort(), [hoteis])

  const filtered = useMemo(() => {
    let base = hoteis
    if (ufFilter !== 'Todos') base = base.filter((h) => h.uf === ufFilter)
    if (faturadoFilter === 'Sim') base = base.filter((h) => h.faturado)
    if (faturadoFilter === 'Não') base = base.filter((h) => !h.faturado)
    if (formaPgFilter !== 'Todas') {
      base = base.filter((h) => (h.formas_pagamento || []).includes(formaPgFilter))
    }
    if (empresaFilter !== 'Todas' && ordenarPor === 'mais_emitidos') {
      base = base.filter((h) => rankingMap.has(h.id))
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      base = base.filter((h) =>
        h.nome.toLowerCase().includes(q) ||
        h.cidade.toLowerCase().includes(q) ||
        (h.observacoes || '').toLowerCase().includes(q)
      )
    }

    const sorted = [...base]
    if (ordenarPor === 'nome') sorted.sort((a, b) => a.nome.localeCompare(b.nome))
    else if (ordenarPor === 'cidade') sorted.sort((a, b) => a.cidade.localeCompare(b.cidade) || a.nome.localeCompare(b.nome))
    else if (ordenarPor === 'tarifa_asc') sorted.sort((a, b) => (a.tarifa_sgl ?? a.tarifa_dbl ?? 99999) - (b.tarifa_sgl ?? b.tarifa_dbl ?? 99999))
    else if (ordenarPor === 'mais_emitidos') sorted.sort((a, b) => (rankingMap.get(b.id) || 0) - (rankingMap.get(a.id) || 0))

    return sorted
  }, [hoteis, search, ufFilter, faturadoFilter, formaPgFilter, empresaFilter, ordenarPor, rankingMap])

  const totalPaginas = Math.max(1, Math.ceil(filtered.length / HOTELS_PER_PAGE))
  const hoteisPagina = useMemo(() => {
    const inicio = (pagina - 1) * HOTELS_PER_PAGE
    return filtered.slice(inicio, inicio + HOTELS_PER_PAGE)
  }, [filtered, pagina])

  useEffect(() => {
    setPagina(1)
  }, [search, ufFilter, faturadoFilter, formaPgFilter, empresaFilter, ordenarPor])

  useEffect(() => {
    setPagina((atual) => Math.min(atual, totalPaginas))
  }, [totalPaginas])

  const isCidadeNaoEncontrada = useMemo(() => {
    const q = search.trim()
    if (q.length < 3) return false
    if (filtered.length > 0) return false
    return true
  }, [search, filtered])

  function openCadastroCidade(cidade: string) {
    if (!canManageHotels) {
      toast.error('Você não tem permissão para cadastrar hotéis.')
      return
    }
    setPrefillCidade({ cidade, uf: ufFilter !== 'Todos' ? ufFilter : 'GO' })
    setEditing(null); setModalOpen(true)
  }
  function abrirGoogleMaps(c: string) { window.open(`https://www.google.com/maps/search/${encodeURIComponent(`hotéis em ${c}`)}`, '_blank', 'noopener,noreferrer') }
  function abrirGoogleBusca(c: string) { window.open(`https://www.google.com/search?q=${encodeURIComponent(`hotéis em ${c} preços`)}`, '_blank', 'noopener,noreferrer') }

  async function buscarComIA(cidadeOuHotel = search) {
    const termo = cidadeOuHotel.trim()
    if (!termo || buscandoIA) return
    setBuscandoIA(true)
    try {
      const destino = extrairDestinoHotel(termo)
      const response = await buscarHoteisComIA({
        query: termo,
        cidade: destino.cidade,
        uf: destino.uf !== 'TODOS' ? destino.uf : undefined,
        knownHotels: hoteis.map((h) => ({ nome: h.nome, cidade: h.cidade, uf: h.uf })),
      })
      setSugestoesIA(response.suggestions)
      setResumoIA(response.summary)
      if (response.suggestions.length === 0) toast.warning('A IA não encontrou hotéis com dados suficientes.')
      else toast.success(`${response.suggestions.length} sugestão(ões) carregada(s).`)
    } catch (e: any) {
      toast.error(e.message || 'Não consegui buscar hotéis agora.')
    } finally {
      setBuscandoIA(false)
    }
  }

  function cadastrarSugestaoIA(sugestao: HotelAISuggestion) {
    if (!canManageHotels) {
      toast.error('Você não tem permissão para cadastrar hotéis.')
      return
    }
    if (hotelJaExiste(hoteis, sugestao.nome, sugestao.cidade, sugestao.uf)) {
      toast.warning('Este hotel já parece existir no cadastro.')
      return
    }
    addHotel(sugestaoParaHotel(sugestao))
    toast.success(`${sugestao.nome} cadastrado no sistema.`)
  }

  function cadastrarTodasSugestoesIA() {
    if (!canManageHotels) {
      toast.error('Você não tem permissão para cadastrar hotéis.')
      return
    }
    const novas = sugestoesIA.filter((s) => !hotelJaExiste(hoteis, s.nome, s.cidade, s.uf))
    novas.forEach((s) => addHotel(sugestaoParaHotel(s)))
    toast.success(`${novas.length} hotel(is) cadastrado(s).`)
  }

  function exportCSV() {
    const headers = ['Nome', 'Cidade', 'UF', 'Telefone', 'Faturado', 'Formas Pagto', 'SGL', 'DBL', 'TPL']
    if (empresaFilter !== 'Todas') headers.push('Emissões')
    const rows = filtered.map((h) => {
      const row = [
        h.nome, h.cidade, h.uf, h.telefone || '-',
        h.faturado ? 'Sim' : 'Não',
        (h.formas_pagamento || []).join(', ') || '-',
        h.tarifa_sgl?.toFixed(2) || '-', h.tarifa_dbl?.toFixed(2) || '-', h.tarifa_tpl?.toFixed(2) || '-',
      ]
      if (empresaFilter !== 'Todas') row.push(String(rankingMap.get(h.id) || 0))
      return row
    })
    downloadTextFile(
      `hoteis-${todayISODate()}.csv`,
      '\ufeff' + buildCsv([headers, ...rows]),
      'text/csv;charset=utf-8',
    )
    toast.success('CSV exportado!')
  }

  const nomeEmpresaFiltro = empresas.find((e) => e.id === empresaFilter)?.nome

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        eyebrow="Cadastros · Hospedagem"
        title="Hotéis"
        icon={HotelIcon}
        description="Rede de hospedagem, regras de viagem por cidade e ranking de emissões."
        bgImage="https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=2000&q=85"
        metrics={[
          { icon: HotelIcon, label: 'Cadastrados', value: filtered.length },
          { icon: MapPin, label: 'Empresas', value: empresas.length },
        ]}
        actions={
          <>
            <button onClick={exportCSV}
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-white text-sm hover:bg-white/15 transition border border-white/15">
              <Download className="w-4 h-4" /> Exportar CSV
            </button>
            {canManageHotels && (
              <button onClick={() => { setEditing(null); setPrefillCidade(null); setModalOpen(true) }}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-[#061631] font-semibold text-sm hover:brightness-105 transition shadow-lg shadow-cyan-500/20">
                <Plus className="w-4 h-4" /> Novo Hotel
              </button>
            )}
          </>
        }
      />

      <div className="bbt-card p-1.5 inline-flex gap-1">
        <ViewButton active={viewMode === 'lista'} onClick={() => setViewMode('lista')} icon={List} label="Lista Detalhada" />
        <ViewButton active={viewMode === 'cidade'} onClick={() => setViewMode('cidade')} icon={LayoutGrid} label="Por Cidade (Regra de Viagem)" />
      </div>

      {/* LEGENDA DAS FORMAS DE PAGAMENTO */}
      <div className="bbt-card p-4 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1">
          <CreditCard className="w-3 h-3" /> Formas de Pagto:
        </span>
        {FORMAS_PAGAMENTO_ALL.map((fp) => (
          <span key={fp} className={`bbt-badge font-bold border ${FORMAS_COLOR[fp]}`}>
            {fp} - {FORMAS_PAGAMENTO_LABEL[fp]}
          </span>
        ))}
      </div>

      {/* FILTROS */}
      <div className="bbt-card p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative min-w-0 basis-full sm:min-w-[250px] sm:flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, cidade ou observações..."
              aria-label="Buscar hotéis"
              autoComplete="off"
              className="w-full h-10 pl-11 pr-9 rounded-lg border border-bbt-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 text-bbt-text dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-bbt-accent focus:border-transparent transition text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400"><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
          <select aria-label="Filtrar hotéis por estado" value={ufFilter} onChange={(e) => setUfFilter(e.target.value)} className="bbt-input w-auto">
            <option>Todos</option>{ufs.map((uf) => <option key={uf}>{uf}</option>)}
          </select>
          {viewMode === 'lista' && (
            <>
              <select aria-label="Filtrar hotéis por faturamento" value={faturadoFilter} onChange={(e) => setFaturadoFilter(e.target.value as 'Todos' | 'Sim' | 'Não')} className="bbt-input w-auto">
                <option value="Todos">Faturamento</option><option value="Sim">Faturado</option><option value="Não">Não faturado</option>
              </select>
              <select aria-label="Filtrar hotéis por forma de pagamento" value={formaPgFilter} onChange={(e) => setFormaPgFilter(e.target.value as FormaPagamento | 'Todas')} className="bbt-input w-auto">
                <option value="Todas">Forma de Pgto</option>
                {FORMAS_PAGAMENTO_ALL.map((fp) => <option key={fp} value={fp}>{fp} - {FORMAS_PAGAMENTO_LABEL[fp]}</option>)}
              </select>
            </>
          )}
          {viewMode === 'cidade' && (
            <select value={empresaRef} onChange={(e) => setEmpresaRef(e.target.value)} className="bbt-input w-auto min-w-[200px]">
              <option value="">Políticas: nenhuma</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>Políticas: {e.nome}</option>)}
            </select>
          )}
        </div>

        {viewMode === 'lista' && (
          <div className="flex flex-wrap gap-3 items-center pt-3 border-t border-bbt-gray-100 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <FileText className="w-3 h-3" /> Emissões:
            </span>
            <select
              value={empresaFilter}
              onChange={(e) => { setEmpresaFilter(e.target.value); if (e.target.value !== 'Todas') setOrdenarPor('mais_emitidos'); else setOrdenarPor('nome') }}
              className="bbt-input w-auto min-w-[220px]"
            >
              <option value="Todas">Todas as emissões</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>Emissões para: {e.nome}</option>)}
            </select>

            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1 ml-2">
              <ArrowUpDown className="w-3 h-3" /> Ordenar:
            </span>
            <select aria-label="Ordenar hotéis" value={ordenarPor} onChange={(e) => setOrdenarPor(e.target.value as OrdenarPor)} className="bbt-input w-auto">
              <option value="nome">Nome (A-Z)</option>
              <option value="cidade">Cidade</option>
              <option value="tarifa_asc">Menor tarifa</option>
              <option value="mais_emitidos" disabled={empresaFilter === 'Todas'}>Mais emitidos</option>
            </select>

            {(empresaFilter !== 'Todas' || formaPgFilter !== 'Todas') && (
              <button onClick={() => { setEmpresaFilter('Todas'); setOrdenarPor('nome'); setFormaPgFilter('Todas') }} className="text-xs text-bbt-accent hover:underline ml-auto">
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {isCidadeNaoEncontrada && (
        <CidadeNaoEncontradaCard
          cidade={search}
          onCadastrar={() => openCadastroCidade(search)}
          onGoogleMaps={() => abrirGoogleMaps(search)}
          onGoogleBusca={() => abrirGoogleBusca(search)}
          onBuscarIA={() => buscarComIA(search)}
          buscandoIA={buscandoIA}
          sugestoesIA={sugestoesIA}
          resumoIA={resumoIA}
          onCadastrarSugestao={cadastrarSugestaoIA}
          onCadastrarTodas={cadastrarTodasSugestoesIA}
          canManageHotels={canManageHotels}
        />
      )}

      {!isCidadeNaoEncontrada && sugestoesIA.length > 0 && (
        <SugestoesIACard
          sugestoes={sugestoesIA}
          resumo={resumoIA}
          onCadastrar={cadastrarSugestaoIA}
          onCadastrarTodas={cadastrarTodasSugestoesIA}
          hoteis={hoteis}
          canManageHotels={canManageHotels}
        />
      )}

      {!isCidadeNaoEncontrada && (
        viewMode === 'lista' ? (
          <>
            <ListaDetalhada
              hoteis={hoteisPagina}
              rankingMap={rankingMap}
              mostrarEmissoes={empresaFilter !== 'Todas'}
              onEdit={(h: Hotel) => { setEditing(h); setPrefillCidade(null); setModalOpen(true) }}
              onDelete={setConfirmDelete}
              onRegistrarEmissao={setEmissaoHotel}
              canManageHotels={canManageHotels}
              canRegisterEmission={canRegisterEmission}
            />
            {filtered.length > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-bbt-gray-100 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-slate-500 dark:text-slate-400">
                  Exibindo {(pagina - 1) * HOTELS_PER_PAGE + 1}-{Math.min(pagina * HOTELS_PER_PAGE, filtered.length)} de {filtered.length} hotel(is)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPagina((atual) => Math.max(1, atual - 1))}
                    disabled={pagina === 1}
                    className="bbt-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <span className="min-w-20 text-center font-medium text-bbt-text dark:text-slate-100">
                    {pagina} / {totalPaginas}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPagina((atual) => Math.min(totalPaginas, atual + 1))}
                    disabled={pagina === totalPaginas}
                    className="bbt-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <VistaPorCidade
            hoteis={filtered}
            politicas={politicas.filter((p) => p.company_id === empresaRef)}
            onCadastrarNaCidade={(cidade: string, uf: string) => { setPrefillCidade({ cidade, uf }); setEditing(null); setModalOpen(true) }}
            onGoogleMaps={abrirGoogleMaps}
            onRegistrarEmissao={setEmissaoHotel}
            canManageHotels={canManageHotels}
            canRegisterEmission={canRegisterEmission}
          />
        )
      )}

      {canManageHotels && <HotelModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setPrefillCidade(null) }}
        editing={editing}
        prefill={prefillCidade}
        onSave={(data: Omit<Hotel, 'id'>) => {
          if (!canManageHotels) {
            toast.error('Você não tem permissão para alterar hotéis.')
            return
          }
          if (editing) {
            updateHotel(editing.id, { ...data, telefone: data.telefone ? onlyDigits(data.telefone) : null })
            toast.success('Hotel atualizado!')
          } else {
            addHotel({ ...data, telefone: data.telefone ? onlyDigits(data.telefone) : null } as any)
            toast.success('Hotel cadastrado!')
            setSearch('')
          }
          setModalOpen(false); setPrefillCidade(null)
        }}
      />}

      {canManageHotels && <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) { deleteHotel(confirmDelete.id); toast.success('Hotel excluído.') } }}
        title="Excluir hotel"
        message={`Confirma a exclusão de "${confirmDelete?.nome}"?`}
        confirmLabel="Excluir"
        danger
      />}

      {canRegisterEmission && <RegistrarEmissaoModal
        open={!!emissaoHotel}
        onClose={() => setEmissaoHotel(null)}
        hotel={emissaoHotel}
        empresaIdPadrao={empresaFilter !== 'Todas' ? empresaFilter : undefined}
        onSuccess={() => setEmissoesReload((n) => n + 1)}
      />}

      <AIAssistantFab
        pageContext="Hotéis"
        dataContext={`Total hotéis cadastrados: ${hoteis.length}\nTotal empresas: ${empresas.length}\nFiltro empresa: ${empresaFilter}`}
        suggestedPrompts={[
          'Quais hotéis emitem mais para nossas empresas?',
          'Sugira hotéis similares para a próxima cotação',
          'Tem hotel sem cidade ou telefone cadastrado?',
          'Qual cidade tem menos opções de hotel?',
        ]}
      />
    </div>
  )
}

function CidadeNaoEncontradaCard({
  cidade,
  onCadastrar,
  onGoogleMaps,
  onGoogleBusca,
  onBuscarIA,
  buscandoIA,
  sugestoesIA,
  resumoIA,
  onCadastrarSugestao,
  onCadastrarTodas,
  canManageHotels,
}: any) {
  return (
    <div className="bbt-card p-8 border-2 border-dashed border-bbt-accent bg-gradient-to-br from-bbt-accent/5 to-transparent animate-fade-in">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-xl bg-bbt-accent/20 flex items-center justify-center shrink-0"><SearchX className="w-7 h-7 text-bbt-primary dark:text-bbt-accent" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-bbt-primary dark:text-white">Nenhum hotel para "<span className="text-bbt-accent">{cidade}</span>"</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">Pesquise e cadastre para uso futuro.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
            <button onClick={onGoogleMaps} className="flex flex-col items-start gap-2 p-4 bg-white dark:bg-slate-800 border border-bbt-gray-100 dark:border-slate-700 rounded-xl hover:border-bbt-accent hover:shadow-md transition text-left">
              <div className="flex items-center gap-2 text-bbt-primary dark:text-white font-semibold"><MapPin className="w-5 h-5 text-red-500" /> Google Maps <ExternalLink className="w-3 h-3 text-slate-400" /></div>
              <p className="text-xs text-slate-500">Ver hotéis no mapa</p>
            </button>
            <button onClick={onGoogleBusca} className="flex flex-col items-start gap-2 p-4 bg-white dark:bg-slate-800 border border-bbt-gray-100 dark:border-slate-700 rounded-xl hover:border-bbt-accent hover:shadow-md transition text-left">
              <div className="flex items-center gap-2 text-bbt-primary dark:text-white font-semibold"><Search className="w-5 h-5 text-blue-500" /> Buscar no Google <ExternalLink className="w-3 h-3 text-slate-400" /></div>
              <p className="text-xs text-slate-500">Pesquisa com preços</p>
            </button>
            {canManageHotels && (
              <button onClick={onCadastrar} className="flex flex-col items-start gap-2 p-4 bg-bbt-primary hover:bg-bbt-primary-mid text-white border border-bbt-primary rounded-xl hover:shadow-md transition text-left">
                <div className="flex items-center gap-2 font-semibold"><Sparkles className="w-5 h-5 text-bbt-accent" /> Cadastrar aqui</div>
                <p className="text-xs text-blue-100/80">Adicionar ao sistema</p>
              </button>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-bbt-accent/30 bg-white p-4 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-bbt-accent" /> Busca inteligente
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Procura hotéis na web, evita duplicados e cadastra fornecedores no catálogo.
                </p>
              </div>
              <button
                onClick={onBuscarIA}
                disabled={buscandoIA}
                className="bbt-button-accent text-xs h-9"
              >
                {buscandoIA ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Buscar com IA
              </button>
            </div>
            {sugestoesIA?.length > 0 && (
              <SugestoesIACard
                sugestoes={sugestoesIA}
                resumo={resumoIA}
                onCadastrar={onCadastrarSugestao}
                onCadastrarTodas={onCadastrarTodas}
                hoteis={[]}
                compact
                canManageHotels={canManageHotels}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SugestoesIACard({
  sugestoes,
  resumo,
  onCadastrar,
  onCadastrarTodas,
  hoteis,
  compact = false,
  canManageHotels,
}: {
  sugestoes: HotelAISuggestion[]
  resumo: string
  onCadastrar: (s: HotelAISuggestion) => void
  onCadastrarTodas: () => void
  hoteis: Hotel[]
  compact?: boolean
  canManageHotels: boolean
}) {
  return (
    <div className={`${compact ? 'mt-4' : 'bbt-card p-4'} animate-fade-in`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-bbt-accent" /> Hotéis encontrados pela IA
          </h3>
          <p className="text-xs text-slate-500 mt-1">{resumo || 'Sugestões prontas para cadastro.'}</p>
        </div>
        {canManageHotels && (
          <button onClick={onCadastrarTodas} className="bbt-button-primary text-xs h-9">
            <Plus className="w-3.5 h-3.5" /> Cadastrar todos novos
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sugestoes.map((s) => {
          const existe = hotelJaExiste(hoteis, s.nome, s.cidade, s.uf)
          return (
            <div key={`${s.nome}-${s.cidade}`} className="rounded-lg border border-bbt-gray-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-bbt-primary dark:text-white truncate">{s.nome}</p>
                  <p className="text-xs text-slate-500">{s.cidade}/{s.uf} {s.telefone ? `· ${s.telefone}` : ''}</p>
                </div>
                <span className={`bbt-badge text-[10px] ${s.confianca === 'alta' ? 'bg-green-100 text-green-700' : s.confianca === 'baixa' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                  {s.confianca || 'media'}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">{s.observacoes || s.endereco || 'Sem observações.'}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                {s.fonte_url ? (
                  <a href={s.fonte_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-bbt-accent hover:underline">
                    Conferir fonte
                  </a>
                ) : <span />}
                {canManageHotels && (
                  <button
                    onClick={() => onCadastrar(s)}
                    disabled={existe}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bbt-primary px-2.5 text-xs font-semibold text-white disabled:opacity-45"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {existe ? 'Já existe' : 'Cadastrar'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ViewButton({ active, onClick, icon: Icon, label }: any) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
      active ? 'bg-bbt-primary text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-bbt-gray-50 dark:hover:bg-slate-700'
    }`}><Icon className="w-4 h-4" /> {label}</button>
  )
}

function FormasPagamentoChips({ formas, compact = false }: { formas?: FormaPagamento[]; compact?: boolean }) {
  if (!formas || formas.length === 0) return <span className="text-slate-300 text-xs">—</span>
  return (
    <div className="flex gap-1 flex-wrap">
      {formas.map((fp) => (
        <span key={fp} className={`${compact ? 'text-[9px] px-1 py-0' : 'text-[10px] px-1.5 py-0.5'} font-bold rounded border ${FORMAS_COLOR[fp]}`} title={FORMAS_PAGAMENTO_LABEL[fp]}>
          {fp}
        </span>
      ))}
    </div>
  )
}

function ListaDetalhada({ hoteis, rankingMap, mostrarEmissoes, onEdit, onDelete, onRegistrarEmissao, canManageHotels, canRegisterEmission }: any) {
  return (
    <div className="bbt-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bbt-gray-50 dark:bg-slate-900/50 border-b border-bbt-gray-100 dark:border-slate-700">
            <tr>
              <Th>Hotel</Th><Th>Cidade · UF</Th><Th>Contato</Th><Th>Pagamento</Th>
              {mostrarEmissoes && <Th className="text-center">Emissões</Th>}
              <Th className="text-right">SGL</Th><Th className="text-right">DBL</Th><Th className="text-right">TPL</Th>
              <Th className="text-right">Ações</Th>
            </tr>
          </thead>
          <tbody>
            {hoteis.length === 0 ? (
              <tr><td colSpan={mostrarEmissoes ? 9 : 8} className="text-center py-16 text-slate-400">Nenhum hotel encontrado.</td></tr>
            ) : hoteis.map((h: Hotel) => {
              const emissoes = rankingMap.get(h.id) || 0
              return (
                <tr key={h.id} className="border-b border-bbt-gray-100 dark:border-slate-700 last:border-0 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-bbt-accent/20 to-bbt-accent/40 flex items-center justify-center shrink-0"><HotelIcon className="w-5 h-5 text-bbt-primary" /></div>
                      <div className="min-w-0">
                        <div className="font-medium text-bbt-text dark:text-slate-100 truncate">{h.nome}</div>
                        <div className="flex gap-1 mt-1 items-center">
                          {h.cafe_manha === 'SIM' && <Coffee className="w-3 h-3 text-amber-500" />}
                          {h.bebedouro === 'SIM' && <Droplets className="w-3 h-3 text-cyan-500" />}
                          {h.estacionamento && <Car className="w-3 h-3 text-slate-500" />}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><div className="flex items-center gap-1.5 text-sm"><MapPin className="w-3.5 h-3.5 text-slate-400" /><span>{h.cidade}</span><span className="bbt-badge bg-bbt-gray-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px]">{h.uf}</span></div></td>
                  <td className="px-4 py-3"><WhatsAppButton phone={h.telefone} /></td>
                  <td className="px-4 py-3"><FormasPagamentoChips formas={h.formas_pagamento} /></td>
                  {mostrarEmissoes && (
                    <td className="px-4 py-3 text-center">
                      {emissoes > 0 ? <span className="bbt-badge bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent font-bold"><FileText className="w-3 h-3" /> {emissoes}</span> : <span className="text-slate-300">0</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-semibold text-bbt-primary dark:text-bbt-accent">{h.tarifa_sgl ? formatCurrency(h.tarifa_sgl) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-right font-semibold text-bbt-primary dark:text-bbt-accent">{h.tarifa_dbl ? formatCurrency(h.tarifa_dbl) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-right font-semibold text-bbt-primary dark:text-bbt-accent">{h.tarifa_tpl ? formatCurrency(h.tarifa_tpl) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canRegisterEmission && <button onClick={() => onRegistrarEmissao(h)} className="p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-slate-500 hover:text-green-600 transition" title="Registrar emissão"><FileText className="w-4 h-4" /></button>}
                      <Link href={`/dashboard/hoteis/${h.id}`} className="p-2 rounded-lg hover:bg-bbt-accent/10 text-slate-500 hover:text-bbt-accent transition"><Eye className="w-4 h-4" /></Link>
                      {canManageHotels && <button onClick={() => onEdit(h)} className="p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-500 hover:text-blue-600 transition"><Edit2 className="w-4 h-4" /></button>}
                      {canManageHotels && <button onClick={() => onDelete(h)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-600 transition"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VistaPorCidade({ hoteis, politicas, onCadastrarNaCidade, onGoogleMaps, onRegistrarEmissao, canManageHotels, canRegisterEmission }: any) {
  const porCidade = useMemo(() => {
    const map = new Map<string, Hotel[]>()
    hoteis.forEach((h: Hotel) => {
      const key = `${h.cidade}|${h.uf}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(h)
    })
    return Array.from(map.entries()).map(([key, list]) => {
      const [cidade, uf] = key.split('|')
      const sorted = [...list].sort((a, b) => (a.tarifa_sgl ?? (a.tarifa_dbl ? a.tarifa_dbl/2 : 99999)) - (b.tarifa_sgl ?? (b.tarifa_dbl ? b.tarifa_dbl/2 : 99999)))
      return { cidade, uf, hoteis: sorted }
    }).sort((a, b) => b.hoteis.length - a.hoteis.length)
  }, [hoteis])

  const limiteDiretor = politicas.find((p: any) => p.cargo === 'Diretor')?.limite_diaria_hotel
  const limiteGerente = politicas.find((p: any) => p.cargo === 'Gerente')?.limite_diaria_hotel
  const limiteColab = politicas.find((p: any) => p.cargo === 'Colaborador')?.limite_diaria_hotel

  if (porCidade.length === 0) return <div className="bbt-card p-12 text-center text-slate-400">Nenhum hotel encontrado.</div>

  return (
    <div className="space-y-6">
      {politicas.length > 0 ? (
        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2"><Briefcase className="w-5 h-5 text-bbt-accent" /> Limites aplicados</h3>
          <div className="grid grid-cols-3 gap-3">
            <CargoLimiteBadge cargo="Diretor" limite={limiteDiretor} color="purple" icon={Crown} />
            <CargoLimiteBadge cargo="Gerente" limite={limiteGerente} color="blue" icon={Briefcase} />
            <CargoLimiteBadge cargo="Colaborador" limite={limiteColab} color="green" icon={User} />
          </div>
        </div>
      ) : (
        <div className="bbt-card p-4 border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
          <p className="text-sm text-amber-800 dark:text-amber-200">⚠️ Selecione uma empresa no filtro de políticas.</p>
        </div>
      )}

      {porCidade.map(({ cidade, uf, hoteis: lista }) => {
        const precos = lista.map((h: Hotel) => h.tarifa_sgl ?? (h.tarifa_dbl ? h.tarifa_dbl/2 : null)).filter((p): p is number => p !== null)
        const min = precos.length ? Math.min(...precos) : null
        const max = precos.length ? Math.max(...precos) : null
        const media = precos.length ? precos.reduce((s, v) => s + v, 0) / precos.length : null

        return (
          <div key={`${cidade}-${uf}`} className="bbt-card overflow-hidden">
            <div className="p-5 border-b border-bbt-gray-100 dark:border-slate-700 bg-gradient-to-r from-bbt-primary/5 to-transparent dark:from-bbt-accent/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-bbt-primary text-white flex items-center justify-center"><MapPin className="w-5 h-5" /></div>
                  <div>
                    <h3 className="font-bold text-lg text-bbt-primary dark:text-white">{cidade} <span className="text-bbt-accent">· {uf}</span></h3>
                    <div className="text-xs text-slate-500">{lista.length} hotel(is)</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {precos.length > 0 && (
                    <div className="flex gap-4 text-xs">
                      <div className="text-center"><div className="flex items-center gap-1 text-green-600 dark:text-green-400 font-semibold"><TrendingDown className="w-3 h-3" /> Menor</div><div className="font-bold text-bbt-primary dark:text-white">{formatCurrency(min)}</div></div>
                      <div className="text-center"><div className="text-slate-500 font-semibold">Média</div><div className="font-bold text-bbt-primary dark:text-white">{formatCurrency(media)}</div></div>
                      <div className="text-center"><div className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold"><TrendingUp className="w-3 h-3" /> Maior</div><div className="font-bold text-bbt-primary dark:text-white">{formatCurrency(max)}</div></div>
                    </div>
                  )}
                  <div className="flex gap-1 border-l border-bbt-gray-100 dark:border-slate-700 pl-3">
                    <button onClick={() => onGoogleMaps(`${cidade} ${uf}`)} className="p-2 rounded-lg hover:bg-bbt-accent/10 text-slate-500 hover:text-bbt-accent transition" title="Google Maps"><MapPin className="w-4 h-4" /></button>
                    {canManageHotels && <button onClick={() => onCadastrarNaCidade(cidade, uf)} className="p-2 rounded-lg hover:bg-bbt-accent/10 text-slate-500 hover:text-bbt-accent transition" title="Adicionar hotel"><Plus className="w-4 h-4" /></button>}
                  </div>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bbt-gray-50 dark:bg-slate-900/30">
                  <tr>
                    <Th>Hotel</Th><Th>Pagto</Th><Th className="text-right">SGL</Th><Th className="text-right">DBL</Th><Th className="text-right">TPL</Th>
                    <Th className="text-right">Por pessoa*</Th><Th>Cargos</Th><Th className="text-right">Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((h: Hotel) => {
                    const porPessoa = h.tarifa_sgl ?? (h.tarifa_dbl ? h.tarifa_dbl/2 : null)
                    return (
                      <tr key={h.id} className="border-t border-bbt-gray-100 dark:border-slate-700 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
                        <td className="px-4 py-3"><div className="font-medium text-bbt-text dark:text-slate-100">{h.nome}</div></td>
                        <td className="px-4 py-3"><FormasPagamentoChips formas={h.formas_pagamento} compact /></td>
                        <td className="px-4 py-3 text-right text-bbt-primary dark:text-bbt-accent font-medium">{h.tarifa_sgl ? formatCurrency(h.tarifa_sgl) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-right text-bbt-primary dark:text-bbt-accent font-medium">{h.tarifa_dbl ? formatCurrency(h.tarifa_dbl) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-right text-bbt-primary dark:text-bbt-accent font-medium">{h.tarifa_tpl ? formatCurrency(h.tarifa_tpl) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-right font-bold text-bbt-primary dark:text-white">{porPessoa ? formatCurrency(porPessoa) : <span className="text-slate-300 font-normal">—</span>}</td>
                        <td className="px-4 py-3"><CargosPermitidos preco={porPessoa} limiteDiretor={limiteDiretor} limiteGerente={limiteGerente} limiteColab={limiteColab} /></td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-1 justify-end">
                            {canRegisterEmission && <button onClick={() => onRegistrarEmissao(h)} className="p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-slate-500 hover:text-green-600 transition"><FileText className="w-4 h-4" /></button>}
                            <Link href={`/dashboard/hoteis/${h.id}`} className="p-2 rounded-lg hover:bg-bbt-accent/10 text-slate-500 hover:text-bbt-accent transition inline-block"><Eye className="w-4 h-4" /></Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      <p className="text-xs text-slate-500 text-center">* "Por pessoa" = SGL ou DBL÷2.</p>
    </div>
  )
}

function CargoLimiteBadge({ cargo, limite, color, icon: Icon }: any) {
  const colors: Record<string, string> = {
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  }
  return (
    <div className={`rounded-lg p-3 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1"><Icon className="w-4 h-4" /><span className="font-semibold text-sm">{cargo}</span></div>
      <div className="text-xs opacity-80">Limite diário:</div>
      <div className="text-xl font-bold">{limite ? formatCurrency(limite) : '—'}</div>
    </div>
  )
}

function CargosPermitidos({ preco, limiteDiretor, limiteGerente, limiteColab }: any) {
  if (preco == null) return <span className="text-xs text-slate-400">sem preço</span>
  if (!limiteDiretor && !limiteGerente && !limiteColab) return <span className="text-xs text-slate-400">—</span>
  const diretor = limiteDiretor != null && preco <= limiteDiretor
  const gerente = limiteGerente != null && preco <= limiteGerente
  const colab = limiteColab != null && preco <= limiteColab
  return (
    <div className="flex flex-wrap gap-1">
      <CargoChip label="Dir" ok={diretor} color="purple" />
      <CargoChip label="Ger" ok={gerente} color="blue" />
      <CargoChip label="Col" ok={colab} color="green" />
    </div>
  )
}

function CargoChip({ label, ok, color }: { label: string; ok: boolean; color: string }) {
  const okColors: Record<string, string> = {
    purple: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',
    blue: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
    green: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
      ok ? okColors[color] : 'bg-slate-50 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-600 dark:border-slate-700 line-through opacity-60'
    }`}>{ok ? '✓' : '✗'} {label}</span>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider ${className}`}>{children}</th>
}

// ============================================================
// MODAL — Agora com formas de pagamento
// ============================================================
function HotelModal({ open, onClose, editing, prefill, onSave }: any) {
  const [form, setForm] = useState<Partial<Hotel>>({})
  // BUG FIX: useEffect (não useMemo) para garantir reset ao abrir
  useEffect(() => {
    if (open) {
      setForm(editing || {
        nome: '', cidade: prefill?.cidade || '', uf: prefill?.uf || 'GO',
        observacoes: '', telefone: '', faturado: false,
        info_faturamento: '', bebedouro: '', valor_agua: null, cafe_manha: '', estacionamento: '',
        tarifa_sgl: null, tarifa_dbl: null, tarifa_tpl: null,
        formas_pagamento: [],
      })
    }
  }, [open, editing, prefill])

  function toggleFormaPg(fp: FormaPagamento) {
    setForm((prev) => {
      const atual = prev.formas_pagamento || []
      const novo = atual.includes(fp) ? atual.filter((x) => x !== fp) : [...atual, fp]
      return { ...prev, formas_pagamento: novo }
    })
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nome || !form.cidade) { toast.error('Preencha nome e cidade.'); return }
    onSave(form)
  }

  const title = editing ? 'Editar Hotel' : prefill ? `Novo Hotel em ${prefill.cidade}` : 'Novo Hotel'

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      {prefill && !editing && (
        <div className="mb-4 p-3 bg-bbt-accent/10 border border-bbt-accent/30 rounded-lg text-xs text-bbt-primary dark:text-bbt-accent flex items-start gap-2">
          <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Cidade pré-preenchida. Copie os dados do Google aqui.</span>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nome *"><input required value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="bbt-input" autoFocus /></Field>
          <Field label="Telefone"><input value={form.telefone || ''} onChange={(e) => setForm({ ...form, telefone: e.target.value })} className="bbt-input" /></Field>
          <Field label="Cidade *"><input required value={form.cidade || ''} onChange={(e) => setForm({ ...form, cidade: e.target.value })} className="bbt-input" /></Field>
          <Field label="UF *"><input required value={form.uf || ''} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase().slice(0, 2) })} className="bbt-input" maxLength={2} /></Field>
        </div>

        {/* FORMAS DE PAGAMENTO */}
        <Field label="Formas de Pagamento Aceitas">
          <div className="flex flex-wrap gap-2">
            {FORMAS_PAGAMENTO_ALL.map((fp) => {
              const ativo = (form.formas_pagamento || []).includes(fp)
              return (
                <button
                  key={fp}
                  type="button"
                  onClick={() => toggleFormaPg(fp)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition ${
                    ativo ? FORMAS_COLOR[fp] : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-600 hover:border-bbt-accent'
                  }`}
                >
                  {ativo && '✓ '}{fp} - {FORMAS_PAGAMENTO_LABEL[fp]}
                </button>
              )
            })}
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            IV=Faturado · PX=Pix · CP=Cartão da agência · CC=Cartão do cliente
          </div>
        </Field>

        <Field label="Observações"><textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={2} className="bbt-input" /></Field>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Tarifa SGL (R$)"><NumericDecimalInput value={form.tarifa_sgl} onNumberChange={(value) => setForm({ ...form, tarifa_sgl: value })} /></Field>
          <Field label="Tarifa DBL (R$)"><NumericDecimalInput value={form.tarifa_dbl} onNumberChange={(value) => setForm({ ...form, tarifa_dbl: value })} /></Field>
          <Field label="Tarifa TPL (R$)"><NumericDecimalInput value={form.tarifa_tpl} onNumberChange={(value) => setForm({ ...form, tarifa_tpl: value })} /></Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Café da Manhã"><select value={form.cafe_manha || ''} onChange={(e) => setForm({ ...form, cafe_manha: e.target.value })} className="bbt-input"><option value="">—</option><option>SIM</option><option>NÃO</option></select></Field>
          <Field label="Bebedouro"><select value={form.bebedouro || ''} onChange={(e) => setForm({ ...form, bebedouro: e.target.value })} className="bbt-input"><option value="">—</option><option>SIM</option><option>NÃO</option></select></Field>
          <Field label="Valor Água (R$)"><NumericDecimalInput value={form.valor_agua} onNumberChange={(value) => setForm({ ...form, valor_agua: value })} /></Field>
        </div>
        <Field label="Estacionamento"><input value={form.estacionamento || ''} onChange={(e) => setForm({ ...form, estacionamento: e.target.value })} className="bbt-input" /></Field>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="faturado" checked={form.faturado || false} onChange={(e) => {
            const faturado = e.target.checked
            // Se marcar faturado, auto-adiciona IV nas formas
            setForm((prev) => {
              const formas = prev.formas_pagamento || []
              if (faturado && !formas.includes('IV')) return { ...prev, faturado, formas_pagamento: [...formas, 'IV'] }
              return { ...prev, faturado }
            })
          }} />
          <label htmlFor="faturado" className="text-sm">Hotel é faturado (adiciona IV nas formas)</label>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary">{editing ? 'Salvar' : 'Cadastrar'}</button>
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

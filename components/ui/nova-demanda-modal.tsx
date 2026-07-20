'use client'
import { todayISODate } from '@/lib/date'
import { useState, useEffect, useMemo } from 'react'
import { Modal } from '@/components/ui/modal'
import { useStore } from '@/lib/store'
import { addAtendimento, updateAtendimento, registrarLog } from '@/lib/atendimentos-storage'
import { dispararAlertaNovaDemanda } from '@/lib/notificacoes'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { toast } from 'sonner'
import {
  Plane, Hotel as HotelIcon, Car, Package, AlertTriangle, Zap,
  CheckCircle2, Clock, DollarSign, TrendingUp, Percent, Info, FileText,
  Loader2, Sparkles, Search,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { PassageiroAutocomplete } from '@/components/ui/passageiro-autocomplete'
import { PolicyValidator } from '@/components/ui/policy-validator'
import {
  buscarHoteisComIA,
  hotelJaExiste,
  sugestaoParaHotel,
  type HotelAISuggestion,
} from '@/lib/ia-hotel-search'
import type {
  Atendimento, TipoServico, StatusAtendimento, Prioridade, OrigemAtendimento,
  DetalhesAereo, DetalhesHotel, DetalhesCarro, DetalhesPacote, ClasseAerea,
  FormaPagamento,
  FonteReferenciaEconomiaAtendimento,
  Hotel,
} from '@/types'
import { calcularFinanceiro, labelOcupante, CONFIG_COBRANCA_PADRAO, FORMAS_PAGAMENTO_LABEL } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  editing?: Atendimento | null
  onSaved?: (a: Atendimento) => void
  /** Pré-preenche empresa/funcionário (ex: vindo da tela da empresa) */
  prefilledEmpresaId?: string
  prefilledFuncionarioId?: string
}

const TIPOS: { value: TipoServico; label: string; icon: any }[] = [
  { value: 'Aéreo', label: 'Aéreo', icon: Plane },
  { value: 'Hotel', label: 'Hotel', icon: HotelIcon },
  { value: 'Carro', label: 'Locação', icon: Car },
  { value: 'Pacote', label: 'Pacote', icon: Package },
]

const PRIORIDADES: { value: Prioridade; label: string; color: string; icon: any }[] = [
  { value: 'baixa', label: 'Baixa', color: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', icon: CheckCircle2 },
  { value: 'media', label: 'Média', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: Clock },
  { value: 'alta', label: 'Alta', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: AlertTriangle },
  { value: 'urgente', label: 'Urgente', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: Zap },
]

const STATUSES: { value: StatusAtendimento; label: string }[] = [
  { value: 'em_andamento', label: 'Em Andamento' },
  { value: 'aguardando_cliente', label: 'Aguardando Cliente' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'finalizado', label: 'Finalizado' },
  { value: 'cancelado', label: 'Cancelado' },
]

function diffDays(d1: string, d2: string): number {
  if (!d1 || !d2) return 0
  const a = new Date(d1 + 'T00:00:00')
  const b = new Date(d2 + 'T00:00:00')
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000)
  return diff > 0 ? diff : 0
}

export function NovaDemandaModal({ open, onClose, editing, onSaved, prefilledEmpresaId, prefilledFuncionarioId }: Props) {
  const { empresas, hoteis, addHotel } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const podeVerFinanceiro = hasPermission(user, 'ver_financeiro')

  const [empresaId, setEmpresaId] = useState('')
  const [funcionarioId, setFuncionarioId] = useState<string | null>(null)
  const [passageiroNome, setPassageiroNome] = useState('')
  const [tipoServico, setTipoServico] = useState<TipoServico>('Hotel')
  const [status, setStatus] = useState<StatusAtendimento>('em_andamento')
  const [prioridade, setPrioridade] = useState<Prioridade>('media')
  const [origem, setOrigem] = useState<OrigemAtendimento>('WhatsApp')
  const [observacoes, setObservacoes] = useState('')
  const [dataAtendimento, setDataAtendimento] = useState(todayISODate())
  const [motivo, setMotivo] = useState('')

  // V8: novos campos
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | ''>('')
  const [centroCusto, setCentroCusto] = useState('')
  const [projetoObra, setProjetoObra] = useState('')
  const [numeroSolicitacao, setNumeroSolicitacao] = useState('')
  const [autorizadorNome, setAutorizadorNome] = useState('')
  const [contatoPassageiro, setContatoPassageiro] = useState('')
  const [observacoesInternas, setObservacoesInternas] = useState('')

  // Financeiro
  const [valorCusto, setValorCusto] = useState<number>(0)
  const [valorVenda, setValorVenda] = useState<number>(0)
  const [valorReferenciaEconomia, setValorReferenciaEconomia] = useState<number>(0)
  const [fonteReferenciaEconomia, setFonteReferenciaEconomia] = useState<FonteReferenciaEconomiaAtendimento>('preco_sem_agencia')
  const [taxaAtiva, setTaxaAtiva] = useState(true)
  const [taxaPercentual, setTaxaPercentual] = useState<number>(10)
  const [taxaValorFixo, setTaxaValorFixo] = useState<number>(0)
  const [usarTaxaFixa, setUsarTaxaFixa] = useState(false)
  const [markupDesabilitado, setMarkupDesabilitado] = useState(false)

  // Detalhes
  const [detAereo, setDetAereo] = useState<DetalhesAereo>({})
  const [detHotel, setDetHotel] = useState<DetalhesHotel>({})
  const [detCarro, setDetCarro] = useState<DetalhesCarro>({})
  const [detPacote, setDetPacote] = useState<DetalhesPacote>({})
  const [buscandoHotelIA, setBuscandoHotelIA] = useState(false)
  const [sugestoesHotelIA, setSugestoesHotelIA] = useState<HotelAISuggestion[]>([])

  // Empresa config (markup/taxa)
  const empresaSelecionada = useMemo(() => empresas.find((e) => e.id === empresaId), [empresas, empresaId])
  const configEmpresa = empresaSelecionada?.config_cobranca || CONFIG_COBRANCA_PADRAO
  const ocupanteLabel = labelOcupante(tipoServico)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setEmpresaId(editing.empresa_id)
      setFuncionarioId(editing.funcionario_id || null)
      setPassageiroNome(editing.passageiro_nome)
      setTipoServico(editing.tipo_servico)
      setStatus(editing.status)
      setPrioridade(editing.prioridade || 'media')
      setOrigem(editing.origem || 'WhatsApp')
      setObservacoes(editing.observacoes || '')
      setDataAtendimento(editing.data_atendimento)
      setMotivo(editing.motivo || '')
      setValorCusto(editing.valor_custo || 0)
      setValorVenda(editing.valor_venda ?? editing.valor_final ?? editing.valor_cotacao ?? 0)
      setValorReferenciaEconomia(editing.valor_referencia_economia || 0)
      setFonteReferenciaEconomia(editing.fonte_referencia_economia || 'preco_sem_agencia')
      setTaxaAtiva(editing.taxa_ativa ?? false)
      setTaxaPercentual(editing.taxa_percentual ?? 10)
      setTaxaValorFixo(editing.taxa_valor_fixo ?? 0)
      setUsarTaxaFixa(!!(editing.taxa_valor_fixo && editing.taxa_valor_fixo > 0))
      setMarkupDesabilitado(editing.markup_desabilitado ?? false)
      setDetAereo(editing.detalhes_aereo || {})
      setDetHotel(editing.detalhes_hotel || {})
      setDetCarro(editing.detalhes_carro || {})
      setDetPacote(editing.detalhes_pacote || {})
      setFormaPagamento(editing.forma_pagamento || '')
      setCentroCusto(editing.centro_custo || '')
      setProjetoObra(editing.projeto_obra || '')
      setNumeroSolicitacao(editing.numero_solicitacao || '')
      setAutorizadorNome(editing.autorizador_nome || '')
      setContatoPassageiro(editing.contato_passageiro || '')
      setObservacoesInternas(editing.observacoes_internas || '')
    } else {
      setEmpresaId(prefilledEmpresaId || empresas[0]?.id || '')
      setFuncionarioId(prefilledFuncionarioId || null)
      setPassageiroNome(''); setTipoServico('Hotel'); setStatus('em_andamento')
      setPrioridade('media'); setOrigem('WhatsApp'); setObservacoes('')
      setDataAtendimento(todayISODate())
      setMotivo(''); setValorCusto(0); setValorVenda(0); setValorReferenciaEconomia(0)
      setFonteReferenciaEconomia('preco_sem_agencia')
      setTaxaAtiva(true); setTaxaPercentual(10); setTaxaValorFixo(0); setUsarTaxaFixa(false)
      setMarkupDesabilitado(false)
      setDetAereo({}); setDetHotel({}); setDetCarro({}); setDetPacote({})
      setFormaPagamento(''); setCentroCusto(''); setProjetoObra('')
      setNumeroSolicitacao(''); setAutorizadorNome(''); setContatoPassageiro('')
      setObservacoesInternas('')
    }
  }, [open, editing, empresas, prefilledEmpresaId, prefilledFuncionarioId])

  // Quando empresa muda, aplicar config de cobrança
  useEffect(() => {
    if (!empresaSelecionada || editing) return
    const cfg = empresaSelecionada.config_cobranca || CONFIG_COBRANCA_PADRAO
    setMarkupDesabilitado(!cfg.aplicar_markup)
    setTaxaAtiva(cfg.aplicar_taxa)
    setUsarTaxaFixa(cfg.taxa_fixa_ativa)
    setTaxaPercentual(cfg.taxa_padrao_pct)
    setTaxaValorFixo(cfg.taxa_valor_fixo)
    // V8: auto-preenche centro de custo padrão da empresa
    if (empresaSelecionada.centro_custo_padrao) {
      setCentroCusto((valorAtual) => valorAtual || empresaSelecionada.centro_custo_padrao || '')
    }
  }, [empresaSelecionada, editing])

  // Quando hotel e tipo_apto mudam, calcular custo auto
  useEffect(() => {
    if (tipoServico !== 'Hotel' || !detHotel.hotel_id) return
    const h = hoteis.find((x) => x.id === detHotel.hotel_id)
    if (!h) return
    let tarifa = 0
    if (detHotel.tipo_apto === 'DBL' && h.tarifa_dbl) tarifa = h.tarifa_dbl
    else if (detHotel.tipo_apto === 'TPL' && h.tarifa_tpl) tarifa = h.tarifa_tpl
    else if (h.tarifa_sgl) tarifa = h.tarifa_sgl
    else if (h.tarifa_dbl) tarifa = h.tarifa_dbl
    else if (h.tarifa_tpl) tarifa = h.tarifa_tpl

    const noites = diffDays(detHotel.data_checkin || '', detHotel.data_checkout || '') || 1
    if (tarifa > 0) {
      const custo = tarifa * noites
      setValorCusto(custo)
      setDetHotel((d) => ({ ...d, noites, tarifa_unitaria: tarifa }))

      // Calcula venda baseado na config
      if (!markupDesabilitado && configEmpresa.markup_padrao_pct > 0) {
        setValorVenda(custo * (1 + configEmpresa.markup_padrao_pct / 100))
      } else {
        setValorVenda(custo)
      }
    }
  }, [detHotel.hotel_id, detHotel.tipo_apto, detHotel.data_checkin, detHotel.data_checkout, hoteis, tipoServico, markupDesabilitado, configEmpresa.markup_padrao_pct])

  const calc = useMemo(() => calcularFinanceiro({
    valor_cotacao: valorVenda,
    valor_custo: valorCusto,
    valor_venda: valorVenda,
    taxa_ativa: taxaAtiva,
    taxa_percentual: usarTaxaFixa ? 0 : taxaPercentual,
    taxa_valor_fixo: usarTaxaFixa ? taxaValorFixo : 0,
    markup_desabilitado: markupDesabilitado,
  }), [valorCusto, valorVenda, taxaAtiva, taxaPercentual, taxaValorFixo, usarTaxaFixa, markupDesabilitado])

  async function garantirHotelCadastrado(): Promise<Hotel | null> {
    if (tipoServico !== 'Hotel') return null
    if (detHotel.hotel_id) return hoteis.find((h) => h.id === detHotel.hotel_id) || null
    const termo = [detHotel.hotel_nome, detHotel.cidade].filter(Boolean).join(' ')
    if (!termo.trim()) return null

    const existente = hoteis.find((h) =>
      hotelJaExiste([h], detHotel.hotel_nome || termo, detHotel.cidade || h.cidade, h.uf),
    )
    if (existente) return existente

    setBuscandoHotelIA(true)
    try {
      const response = await buscarHoteisComIA({
        query: `hospedagem corporativa ${termo}`,
        cidade: detHotel.cidade,
        knownHotels: hoteis.map((h) => ({ nome: h.nome, cidade: h.cidade, uf: h.uf })),
      })
      setSugestoesHotelIA(response.suggestions)
      const primeira = response.suggestions.find((s) => !hotelJaExiste(hoteis, s.nome, s.cidade, s.uf))
      if (!primeira) return null
      const data = sugestaoParaHotel(primeira)
      const novo = addHotel(data)
      toast.success(`Hotel "${data.nome}" cadastrado automaticamente pela IA.`)
      return novo
    } catch (e: any) {
      toast.warning(`Não consegui cadastrar hotel via IA: ${e.message || 'falha na busca'}. Vou salvar a demanda com hotel manual.`)
      return null
    } finally {
      setBuscandoHotelIA(false)
    }
  }

  async function buscarHotelIAAgora() {
    const termo = [detHotel.hotel_nome, detHotel.cidade].filter(Boolean).join(' ')
    if (!termo.trim() || buscandoHotelIA) {
      toast.warning('Informe nome do hotel ou cidade para a IA pesquisar.')
      return
    }
    setBuscandoHotelIA(true)
    try {
      const response = await buscarHoteisComIA({
        query: `hotel corporativo ${termo}`,
        cidade: detHotel.cidade,
        knownHotels: hoteis.map((h) => ({ nome: h.nome, cidade: h.cidade, uf: h.uf })),
      })
      setSugestoesHotelIA(response.suggestions)
      const primeira = response.suggestions[0]
      if (primeira) {
        const existente = hoteis.find((h) => hotelJaExiste([h], primeira.nome, primeira.cidade, primeira.uf))
        if (existente) {
          setDetHotel({ ...detHotel, hotel_id: existente.id, hotel_nome: existente.nome, cidade: existente.cidade })
          toast.success('Hotel encontrado no cadastro e vinculado à demanda.')
        } else {
          const data = sugestaoParaHotel(primeira)
          const novo = addHotel(data)
          setDetHotel({
            ...detHotel,
            hotel_id: novo.id,
            hotel_nome: data.nome,
            cidade: data.cidade,
            tarifa_unitaria: data.tarifa_sgl || data.tarifa_dbl || data.tarifa_tpl || detHotel.tarifa_unitaria,
          })
          toast.success(`Hotel "${data.nome}" cadastrado e vinculado.`)
        }
      }
    } catch (e: any) {
      toast.error(e.message || 'Não consegui buscar hotéis agora.')
    } finally {
      setBuscandoHotelIA(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) { toast.error('Faça login.'); return }
    if (!empresaId || !passageiroNome.trim()) {
      toast.error('Preencha empresa e ' + ocupanteLabel.toLowerCase() + '.'); return
    }

    const hotelCriado = await garantirHotelCadastrado()
    const detalhesHotelFinal =
      tipoServico === 'Hotel' && hotelCriado
        ? {
            ...detHotel,
            hotel_id: hotelCriado.id,
            hotel_nome: hotelCriado.nome,
            cidade: hotelCriado.cidade,
            tarifa_unitaria: detHotel.tarifa_unitaria || hotelCriado.tarifa_sgl || hotelCriado.tarifa_dbl || hotelCriado.tarifa_tpl || undefined,
          }
        : detHotel

    const payload: Omit<Atendimento, 'id' | 'created_at' | 'updated_at'> = {
      empresa_id: empresaId,
      funcionario_id: funcionarioId,
      passageiro_nome: passageiroNome.trim(),
      tipo_servico: tipoServico,
      valor_cotacao: valorVenda || 0,
      valor_final: valorVenda || undefined,
      valor_custo: valorCusto || 0,
      valor_venda: valorVenda || 0,
      valor_referencia_economia: valorReferenciaEconomia > 0 ? valorReferenciaEconomia : undefined,
      fonte_referencia_economia: valorReferenciaEconomia > 0 ? fonteReferenciaEconomia : undefined,
      taxa_ativa: taxaAtiva,
      taxa_percentual: usarTaxaFixa ? undefined : taxaPercentual,
      taxa_valor_fixo: usarTaxaFixa ? taxaValorFixo : undefined,
      markup_desabilitado: markupDesabilitado,
      agente_user_id: editing?.agente_user_id || user.id,
      status,
      prioridade,
      origem,
      observacoes: observacoes.trim(),
      data_atendimento: dataAtendimento,
      motivo: (status === 'pendente' || status === 'cancelado') ? motivo : undefined,
      detalhes_aereo: tipoServico === 'Aéreo' ? detAereo : undefined,
      detalhes_hotel: tipoServico === 'Hotel' ? detalhesHotelFinal : undefined,
      detalhes_carro: tipoServico === 'Carro' ? detCarro : undefined,
      detalhes_pacote: tipoServico === 'Pacote' ? detPacote : undefined,
      origem_emissao: editing?.origem_emissao || 'manual',
      // V8: campos novos
      forma_pagamento: formaPagamento || undefined,
      centro_custo: centroCusto.trim() || undefined,
      projeto_obra: projetoObra.trim() || undefined,
      numero_solicitacao: numeroSolicitacao.trim() || undefined,
      autorizador_nome: autorizadorNome.trim() || undefined,
      contato_passageiro: contatoPassageiro.trim() || undefined,
      observacoes_internas: observacoesInternas.trim() || undefined,
    }

    if (editing) {
      updateAtendimento(editing.id, payload)
      registrarLog({
        user_id: user.id, user_name: user.name, acao: 'editar',
        entidade: 'Atendimento', entidade_id: editing.id,
        descricao: `Editou demanda de ${passageiroNome}`,
      })
      toast.success('Demanda atualizada!')
    } else {
      const nova = addAtendimento(payload)
      if (!nova) { toast.error('Erro ao salvar.'); return }
      registrarLog({
        user_id: user.id, user_name: user.name, acao: 'criar',
        entidade: 'Atendimento', entidade_id: nova.id,
        descricao: `Criou demanda ${tipoServico} para ${passageiroNome}`,
      })
      // V9: Alerta sonoro + notificação
      dispararAlertaNovaDemanda(passageiroNome, empresaSelecionada?.nome || '', nova.id, nova.serial_os)
      toast.success(`Demanda ${nova.serial_os || nova.id} criada!`)
      onSaved?.(nova)
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar Demanda' : 'Nova Demanda'} size="xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* TIPO */}
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-2 tracking-wider">Tipo de Serviço *</label>
          <div className="grid grid-cols-4 gap-2">
            {TIPOS.map((t) => {
              const Icon = t.icon
              const active = tipoServico === t.value
              return (
                <button key={t.value} type="button" onClick={() => setTipoServico(t.value)}
                  className={`p-3 rounded-lg border-2 transition text-center ${
                    active ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent'
                    : 'border-bbt-gray-100 dark:border-slate-700 text-slate-500 hover:border-bbt-accent/50'
                  }`}>
                  <Icon className="w-5 h-5 mx-auto mb-1" />
                  <div className="text-xs font-semibold">{t.label}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* PRIORIDADE */}
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-2 tracking-wider">Prioridade *</label>
          <div className="flex gap-2 flex-wrap">
            {PRIORIDADES.map((p) => {
              const Icon = p.icon
              const active = prioridade === p.value
              return (
                <button key={p.value} type="button" onClick={() => setPrioridade(p.value)}
                  className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition border-2 flex items-center gap-1.5 ${
                    active ? p.color + ' border-current' : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-600 hover:border-slate-400'
                  }`}>
                  <Icon className="w-3.5 h-3.5" /> {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* DADOS BÁSICOS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Empresa *</label>
            <select value={empresaId} onChange={(e) => {
              setEmpresaId(e.target.value)
              setFuncionarioId(null)
            }} className="bbt-input" required>
              <option value="">Selecione...</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            {empresaSelecionada && (
              <div className="mt-1 flex gap-2 flex-wrap text-[10px]">
                {!configEmpresa.aplicar_markup && (
                  <span className="bbt-badge bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                    ⚠ Sem markup
                  </span>
                )}
                {!configEmpresa.aplicar_taxa && (
                  <span className="bbt-badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    Sem taxa
                  </span>
                )}
                {configEmpresa.aplicar_markup && configEmpresa.markup_padrao_pct > 0 && (
                  <span className="bbt-badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    Markup {configEmpresa.markup_padrao_pct}%
                  </span>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">
              {ocupanteLabel} *
            </label>
            <PassageiroAutocomplete
              value={passageiroNome}
              onChange={setPassageiroNome}
              onSelectFuncionario={(funcId, nome) => {
                setFuncionarioId(funcId)
                setPassageiroNome(nome)
              }}
              empresaId={empresaId}
              funcionarioIdAtual={funcionarioId}
              placeholder={`Digite o nome do ${ocupanteLabel.toLowerCase()}...`}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Data do Atendimento</label>
            <input type="date" value={dataAtendimento} onChange={(e) => setDataAtendimento(e.target.value)} className="bbt-input" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Origem</label>
            <select value={origem} onChange={(e) => setOrigem(e.target.value as OrigemAtendimento)} className="bbt-input">
              <option>WhatsApp</option><option>E-mail</option><option>Telefone</option><option>Indicação</option><option>Portal</option><option>Outro</option>
            </select>
          </div>
        </div>

        {/* ===== DETALHES POR TIPO ===== */}
        {tipoServico === 'Hotel' && (
          <CampoBox titulo="Detalhes do Hotel" icon={HotelIcon}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Hotel (catálogo)</label>
                <select value={detHotel.hotel_id || ''} onChange={(e) => {
                  const id = Number(e.target.value)
                  const h = hoteis.find((x) => x.id === id)
                  setDetHotel({ ...detHotel, hotel_id: id || undefined, hotel_nome: h?.nome || '', cidade: h?.cidade || '' })
                }} className="bbt-input">
                  <option value="">— manual abaixo —</option>
                  {hoteis.slice(0, 200).map((h) => <option key={h.id} value={h.id}>{h.nome} · {h.cidade}/{h.uf}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={buscarHotelIAAgora}
                  disabled={buscandoHotelIA}
                  className="bbt-button-accent h-10 w-full text-xs"
                >
                  {buscandoHotelIA ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  Buscar/cadastrar com IA
                </button>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Nome do Hotel (manual)</label>
                <input value={detHotel.hotel_nome || ''} onChange={(e) => setDetHotel({ ...detHotel, hotel_nome: e.target.value })} className="bbt-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Cidade</label>
                <input value={detHotel.cidade || ''} onChange={(e) => setDetHotel({ ...detHotel, cidade: e.target.value })} className="bbt-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Tipo de Apto</label>
                <select value={detHotel.tipo_apto || 'SGL'} onChange={(e) => setDetHotel({ ...detHotel, tipo_apto: e.target.value as any })} className="bbt-input">
                  <option>SGL</option><option>DBL</option><option>TPL</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Check-in</label>
                <input type="date" value={detHotel.data_checkin || ''} onChange={(e) => setDetHotel({ ...detHotel, data_checkin: e.target.value })} className="bbt-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Check-out</label>
                <input type="date" value={detHotel.data_checkout || ''} onChange={(e) => setDetHotel({ ...detHotel, data_checkout: e.target.value })} className="bbt-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Nº Hóspedes</label>
                <input type="number" value={detHotel.num_hospedes || 1} onChange={(e) => setDetHotel({ ...detHotel, num_hospedes: Number(e.target.value) })} className="bbt-input" min={1} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Localizador</label>
                <input value={detHotel.localizador || ''} onChange={(e) => setDetHotel({ ...detHotel, localizador: e.target.value })} className="bbt-input uppercase" />
              </div>
            </div>
            {detHotel.hotel_id && detHotel.tarifa_unitaria && detHotel.noites && (
              <div className="mt-3 p-2 bg-bbt-accent/10 border border-bbt-accent/30 rounded text-xs flex items-center gap-2">
                <Info className="w-3 h-3 text-bbt-accent" />
                <span>
                  Tarifa auto: <strong>{formatCurrency(detHotel.tarifa_unitaria)}</strong> × <strong>{detHotel.noites} noite{detHotel.noites > 1 ? 's' : ''}</strong> = <strong>{formatCurrency(detHotel.tarifa_unitaria * detHotel.noites)}</strong>
                </span>
              </div>
            )}
            {sugestoesHotelIA.length > 0 && (
              <div className="mt-3 rounded-lg border border-bbt-accent/25 bg-white p-3 dark:bg-slate-900">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-bbt-primary dark:text-white">
                  <Sparkles className="w-3.5 h-3.5 text-bbt-accent" />
                  Sugestões da IA para esta hospedagem
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {sugestoesHotelIA.slice(0, 4).map((s) => (
                    <button
                      key={`${s.nome}-${s.cidade}`}
                      type="button"
                      onClick={() => setDetHotel({ ...detHotel, hotel_nome: s.nome, cidade: s.cidade, tarifa_unitaria: s.tarifa_sgl || s.tarifa_dbl || s.tarifa_tpl || detHotel.tarifa_unitaria })}
                      className="rounded-md border border-bbt-gray-100 p-2 text-left text-xs transition hover:border-bbt-accent dark:border-slate-700"
                    >
                      <div className="font-semibold text-bbt-primary dark:text-white">{s.nome}</div>
                      <div className="text-slate-500">{s.cidade}/{s.uf} {s.telefone ? `· ${s.telefone}` : ''}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CampoBox>
        )}

        {tipoServico === 'Aéreo' && (
          <CampoBox titulo="Detalhes do Aéreo" icon={Plane}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Origem"><input value={detAereo.origem || ''} onChange={(e) => setDetAereo({ ...detAereo, origem: e.target.value })} className="bbt-input" placeholder="GRU, GYN" /></Field>
              <Field label="Destino"><input value={detAereo.destino || ''} onChange={(e) => setDetAereo({ ...detAereo, destino: e.target.value })} className="bbt-input" placeholder="MIA, CGH" /></Field>
              <Field label="Data Ida"><input type="date" value={detAereo.data_ida || ''} onChange={(e) => setDetAereo({ ...detAereo, data_ida: e.target.value })} className="bbt-input" /></Field>
              <Field label="Data Volta"><input type="date" value={detAereo.data_volta || ''} onChange={(e) => setDetAereo({ ...detAereo, data_volta: e.target.value })} className="bbt-input" /></Field>
              <Field label="Cia Aérea"><input value={detAereo.cia_aerea || ''} onChange={(e) => setDetAereo({ ...detAereo, cia_aerea: e.target.value })} className="bbt-input" placeholder="LATAM, Azul" /></Field>
              <Field label="Classe">
                <select value={detAereo.classe || 'Econômica'} onChange={(e) => setDetAereo({ ...detAereo, classe: e.target.value as ClasseAerea })} className="bbt-input">
                  <option>Econômica</option><option>Econômica Premium</option><option>Executiva</option><option>Primeira</option>
                </select>
              </Field>
              <Field label="Localizador / PNR"><input value={detAereo.localizador || ''} onChange={(e) => setDetAereo({ ...detAereo, localizador: e.target.value })} className="bbt-input uppercase" /></Field>
              <Field label="Número do Bilhete"><input value={detAereo.numero_bilhete || ''} onChange={(e) => setDetAereo({ ...detAereo, numero_bilhete: e.target.value })} className="bbt-input" /></Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={detAereo.internacional || false} onChange={(e) => setDetAereo({ ...detAereo, internacional: e.target.checked })} />
              <span>Voo internacional</span>
            </label>
          </CampoBox>
        )}

        {tipoServico === 'Carro' && (
          <CampoBox titulo="Detalhes da Locação" icon={Car}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Locadora"><input value={detCarro.locadora || ''} onChange={(e) => setDetCarro({ ...detCarro, locadora: e.target.value })} className="bbt-input" /></Field>
              <Field label="Cidade Retirada"><input value={detCarro.cidade_retirada || ''} onChange={(e) => setDetCarro({ ...detCarro, cidade_retirada: e.target.value })} className="bbt-input" /></Field>
              <Field label="Data Retirada"><input type="date" value={detCarro.data_retirada || ''} onChange={(e) => setDetCarro({ ...detCarro, data_retirada: e.target.value })} className="bbt-input" /></Field>
              <Field label="Data Devolução"><input type="date" value={detCarro.data_devolucao || ''} onChange={(e) => setDetCarro({ ...detCarro, data_devolucao: e.target.value })} className="bbt-input" /></Field>
              <Field label="Categoria"><input value={detCarro.categoria || ''} onChange={(e) => setDetCarro({ ...detCarro, categoria: e.target.value })} className="bbt-input" /></Field>
              <Field label="Localizador"><input value={detCarro.localizador || ''} onChange={(e) => setDetCarro({ ...detCarro, localizador: e.target.value })} className="bbt-input uppercase" /></Field>
            </div>
          </CampoBox>
        )}

        {tipoServico === 'Pacote' && (
          <CampoBox titulo="Detalhes do Pacote" icon={Package}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Destino"><input value={detPacote.destino || ''} onChange={(e) => setDetPacote({ ...detPacote, destino: e.target.value })} className="bbt-input" /></Field>
              <Field label="Localizador"><input value={detPacote.localizador || ''} onChange={(e) => setDetPacote({ ...detPacote, localizador: e.target.value })} className="bbt-input uppercase" /></Field>
              <Field label="Data Ida"><input type="date" value={detPacote.data_ida || ''} onChange={(e) => setDetPacote({ ...detPacote, data_ida: e.target.value })} className="bbt-input" /></Field>
              <Field label="Data Volta"><input type="date" value={detPacote.data_volta || ''} onChange={(e) => setDetPacote({ ...detPacote, data_volta: e.target.value })} className="bbt-input" /></Field>
            </div>
            <Field label="Descrição"><textarea value={detPacote.descricao || ''} onChange={(e) => setDetPacote({ ...detPacote, descricao: e.target.value })} rows={2} className="bbt-input" /></Field>
          </CampoBox>
        )}

        {/* ===== FINANCEIRO (só exibe se user tem permissão) ===== */}
        {podeVerFinanceiro && (
          <div className={`border-2 rounded-xl p-4 ${markupDesabilitado ? 'border-orange-200 bg-orange-50/50 dark:bg-orange-900/10' : 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'}`}>
            <h4 className="font-semibold text-sm text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-600" /> Financeiro
              {markupDesabilitado && <span className="bbt-badge bg-orange-100 text-orange-700 text-[10px]">Sem markup (config empresa)</span>}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <Field label="Custo (o que pagamos) R$">
                <input type="number" step="0.01" min={0} value={valorCusto || ''} onChange={(e) => setValorCusto(parseFloat(e.target.value) || 0)}
                  className="bbt-input" placeholder="Ex: 250,00" />
              </Field>
              <Field label={markupDesabilitado ? 'Venda = Custo (sem markup)' : 'Venda (o que cobramos) R$'}>
                <input type="number" step="0.01" min={0} value={valorVenda || ''} onChange={(e) => setValorVenda(parseFloat(e.target.value) || 0)}
                  className="bbt-input" placeholder="Ex: 350,00" disabled={markupDesabilitado} />
              </Field>
              <Field label="Valor comparativo R$">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={valorReferenciaEconomia || ''}
                  onChange={(e) => setValorReferenciaEconomia(parseFloat(e.target.value) || 0)}
                  className="bbt-input"
                  placeholder="Ex: 420,00"
                />
              </Field>
              <Field label="Origem da comparação">
                <select
                  value={fonteReferenciaEconomia}
                  onChange={(e) => setFonteReferenciaEconomia(e.target.value as FonteReferenciaEconomiaAtendimento)}
                  className="bbt-input"
                  disabled={valorReferenciaEconomia <= 0}
                >
                  <option value="preco_sem_agencia">Preço direto / sem agência</option>
                  <option value="cotacao_original">Cotação original</option>
                  <option value="tarifa_publica">Tarifa pública</option>
                  <option value="contrato">Valor de contrato</option>
                  <option value="outro">Outro comparativo</option>
                </select>
              </Field>
            </div>

            {valorReferenciaEconomia > 0 && (
              <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                Economia registrada: <strong>{formatCurrency(Math.max(0, valorReferenciaEconomia - calc.total_faturado))}</strong>
              </div>
            )}

            {!markupDesabilitado && configEmpresa.aplicar_taxa && (
              <div className="flex items-center gap-2 mb-3 mt-3 pt-3 border-t border-green-200 dark:border-green-700">
                <input type="checkbox" id="taxaAtiva" checked={taxaAtiva} onChange={(e) => setTaxaAtiva(e.target.checked)} />
                <label htmlFor="taxaAtiva" className="text-sm font-medium cursor-pointer flex items-center gap-1">
                  <Percent className="w-3.5 h-3.5" /> Cobrar taxa de serviço
                </label>
              </div>
            )}

            {taxaAtiva && !markupDesabilitado && configEmpresa.aplicar_taxa && (
              <div className="space-y-2 pl-6">
                <div className="flex gap-3 items-center text-xs">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" checked={!usarTaxaFixa} onChange={() => setUsarTaxaFixa(false)} />
                    Percentual
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" checked={usarTaxaFixa} onChange={() => setUsarTaxaFixa(true)} />
                    Valor fixo
                  </label>
                </div>
                {usarTaxaFixa ? (
                  <Field label="Taxa fixa (R$)">
                    <input type="number" step="0.01" min={0} value={taxaValorFixo || ''} onChange={(e) => setTaxaValorFixo(parseFloat(e.target.value) || 0)} className="bbt-input" />
                  </Field>
                ) : (
                  <Field label="Taxa % sobre a venda">
                    <input type="number" step="0.5" min={0} max={100} value={taxaPercentual || ''} onChange={(e) => setTaxaPercentual(parseFloat(e.target.value) || 0)} className="bbt-input" />
                  </Field>
                )}
              </div>
            )}

            {/* RESUMO */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
              <ResumoBox label="Markup" value={calc.markup} color={calc.markup >= 0 ? 'green' : 'red'} icon={TrendingUp} />
              <ResumoBox label={`${calc.margem_pct.toFixed(1)}% margem`} value={null} subtext="da venda" color="slate" />
              <ResumoBox label="Taxa" value={calc.taxa_valor} color="purple" icon={Percent} />
              <ResumoBox label="Total faturado" value={calc.total_faturado} color="bbt" bold />
            </div>
          </div>
        )}

        {/* V8: BLOCO ADMINISTRATIVO ADICIONAL */}
        <div className="border-2 border-blue-100 dark:border-blue-900/40 rounded-xl p-4 bg-blue-50/30 dark:bg-blue-900/10">
          <h4 className="font-semibold text-sm text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <Info className="w-4 h-4 text-bbt-accent" /> Dados administrativos
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Forma de Pagamento">
              <select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value as FormaPagamento | '')} className="bbt-input">
                <option value="">— Selecione —</option>
                {(Object.keys(FORMAS_PAGAMENTO_LABEL) as FormaPagamento[]).map((fp) => (
                  <option key={fp} value={fp}>{FORMAS_PAGAMENTO_LABEL[fp]}</option>
                ))}
              </select>
            </Field>
            <Field label="Centro de Custo">
              <input value={centroCusto} onChange={(e) => setCentroCusto(e.target.value)} className="bbt-input" placeholder="Ex: Diretoria, Vendas-RJ" />
            </Field>
            <Field label="Projeto / Obra">
              <input value={projetoObra} onChange={(e) => setProjetoObra(e.target.value)} className="bbt-input" placeholder="Ex: Obra Trindade-2026" />
            </Field>
            <Field label="Nº Solicitação Cliente">
              <input value={numeroSolicitacao} onChange={(e) => setNumeroSolicitacao(e.target.value)} className="bbt-input" placeholder="Ex: SOL-12345" />
            </Field>
            <Field label="Autorizador (RH/Gerente)">
              <input value={autorizadorNome} onChange={(e) => setAutorizadorNome(e.target.value)} className="bbt-input" placeholder="Ex: Carla Mendes - RH" />
            </Field>
            <Field label="Contato do Passageiro">
              <input value={contatoPassageiro} onChange={(e) => setContatoPassageiro(e.target.value)} className="bbt-input" placeholder="Telefone ou e-mail" />
            </Field>
          </div>
        </div>

        {/* STATUS */}
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusAtendimento)} className="bbt-input">
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {(status === 'pendente' || status === 'cancelado') && (
          <Field label={`Motivo (${status === 'pendente' ? 'pendência' : 'cancelamento'})`}>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="bbt-input" placeholder="Descreva o motivo" />
          </Field>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Observações (visíveis ao cliente)">
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} className="bbt-input" placeholder="Observações que vão no voucher/relatório" />
          </Field>
          <Field label="Observações INTERNAS (só BBT)">
            <textarea value={observacoesInternas} onChange={(e) => setObservacoesInternas(e.target.value)} rows={3} className="bbt-input" placeholder="Anotações internas não vão pro cliente" />
          </Field>
        </div>

        <div className="flex justify-between items-center gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          {/* Gerar voucher emitido pré-preenchido a partir da demanda */}
          {editing ? (
            <div className="flex flex-col gap-3 w-full">
              <PolicyValidator atendimento={editing} />
              <div className="flex gap-2 items-center justify-between">
                <a href={`/dashboard/vouchers/novo?atendimento=${editing.id}`} target="_blank" rel="noopener noreferrer"
                  className="bbt-button-primary flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4" /> Gerar Voucher
                </a>
                <div className="flex gap-2">
                  <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
                  <button type="submit" className="bbt-button-primary">Salvar</button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <span />
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
                <button type="submit" className="bbt-button-primary">Criar Demanda</button>
              </div>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function CampoBox({ titulo, icon: Icon, children }: { titulo: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="border border-bbt-accent/30 rounded-xl p-4 bg-bbt-accent/5">
      <h4 className="font-semibold text-sm text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
        <Icon className="w-4 h-4 text-bbt-accent" /> {titulo}
      </h4>
      {children}
    </div>
  )
}

function ResumoBox({ label, value, color, icon: Icon, bold = false, subtext }: {
  label: string; value: number | null; color: string; icon?: any; bold?: boolean; subtext?: string
}) {
  const colors: Record<string, string> = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    bbt: 'bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white',
  }
  return (
    <div className={`rounded-lg p-2.5 ${colors[color]}`}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      {value != null && (
        <div className={`${bold ? 'text-lg font-bold' : 'text-base font-semibold'} mt-0.5`}>
          {formatCurrency(value)}
        </div>
      )}
      {subtext && <div className="text-[10px] opacity-70">{subtext}</div>}
    </div>
  )
}

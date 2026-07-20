'use client'
/**
 * V12: Chat com IA premium — GPT-5.2 como cérebro e Gemini para busca Google
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { addAtendimento, getAllAtendimentos } from '@/lib/atendimentos-storage'
import { calcularResumoFinanceiro } from '@/lib/financeiro'
import { getStatusIA, type StatusIA, type ProvedorIA } from '@/lib/ia-parser'
import { getCurrentUser, getUserById } from '@/lib/auth'
import { buildSystemContext, responderComIASistema, responderChatSistema, type SystemAIResponse } from '@/lib/ia-system-actions'
import { avaliarPerguntaIA, getIAConfig } from '@/lib/ia-config-storage'
import { aiErrorUserMessage } from '@/lib/ai-friendly-errors'
import { humanizeAIText } from '@/lib/ai-humanize'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'
import {
  buscarHoteisComIA,
  extrairDestinoHotel,
  hotelJaExiste,
  sugestaoParaHotel,
  type HotelAISuggestion,
} from '@/lib/ia-hotel-search'
import {
  Sparkles,
  Send,
  Trash2,
  Loader2,
  Bot,
  User as UserIcon,
  Copy,
  CircleDot,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Hotel } from '@/types'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  provedor?: ProvedorIA
}

const STORAGE_HISTORICO = 'bbt-ia-chat-historico-v12'

const SUGESTOES = [
  'Preciso viajar para São Paulo segunda e voltar quarta com hotel dentro da política',
  'Preciso de hospedagem em Campo Grande-MS, cadastre hotéis se não tiver',
  'Reservar hotel pela Tech em Campo Grande para 10/05 a 12/05',
  'Pesquise em tempo real o telefone oficial do Deville Campo Grande',
  'Quantas demandas pendentes tenho agora?',
  'Quem é meu agente mais produtivo?',
  'Redija um e-mail de cobrança pra cliente atrasado',
  'Como devo priorizar a fila urgente?',
  'Compare meu faturamento desse mês com o anterior',
  'Qual empresa mais consome viagens?',
]

export default function IAChatPage() {
  const { empresas, funcionarios, hoteis, politicas, addHotel } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null

  const [mensagens, setMensagens] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [status, setStatus] = useState<StatusIA | null>(null)
  const [hotelSuggestions, setHotelSuggestions] = useState<HotelAISuggestion[]>([])

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      setMensagens(loadJSON<Msg[]>(STORAGE_HISTORICO, []))
    } catch {}
    getStatusIA(true).then(setStatus)
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [mensagens, carregando])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      safeSetJSON(STORAGE_HISTORICO, mensagens.slice(-60))
    } catch {}
  }, [mensagens])

  const contexto = useMemo(() => {
    if (typeof window === 'undefined') return {}
    const all = getAllAtendimentos()
    const pendentes = all.filter((a) =>
      ['pendente', 'em_andamento', 'aguardando_cliente'].includes(a.status),
    )
    const urgentes = pendentes.filter((a) => a.prioridade === 'urgente').length

    // próximos 3 dias
    const hoje = new Date()
    const tresDias = new Date(hoje.getTime() + 3 * 86400000)
    const proximoCheckin = pendentes.filter((a) => {
      const data =
        a.detalhes_aereo?.data_ida ||
        a.detalhes_hotel?.data_checkin ||
        a.detalhes_carro?.data_retirada ||
        a.detalhes_pacote?.data_ida
      if (!data) return false
      const d = new Date(data + 'T00:00:00')
      return d >= hoje && d <= tresDias
    }).length

    const mesAtual = new Date().getMonth()
    const anoAtual = new Date().getFullYear()
    const valorTotalMes = all
      .filter((a) => {
        const d = new Date(a.created_at)
        return d.getMonth() === mesAtual && d.getFullYear() === anoAtual
      })
      .reduce((s, a) => s + (a.valor_venda || a.valor_final || a.valor_cotacao || 0), 0)

    const mesAnt = new Date(anoAtual, mesAtual - 1, 1)
    const valorTotalMesAnt = all
      .filter((a) => {
        const d = new Date(a.created_at)
        return d.getMonth() === mesAnt.getMonth() && d.getFullYear() === mesAnt.getFullYear()
      })
      .reduce((s, a) => s + (a.valor_venda || a.valor_final || a.valor_cotacao || 0), 0)

    const ticket =
      all.length > 0
        ? all.reduce(
            (s, a) => s + (a.valor_venda || a.valor_final || a.valor_cotacao || 0),
            0,
          ) / all.length
        : 0

    // Por tipo
    const por_tipo: Record<string, number> = { Aéreo: 0, Hotel: 0, Carro: 0, Pacote: 0 }
    all.forEach((a) => {
      por_tipo[a.tipo_servico] = (por_tipo[a.tipo_servico] || 0) + 1
    })

    // Agente top
    const cargaAgente = new Map<string, number>()
    pendentes.forEach((a) => {
      if (!a.agente_user_id) return
      cargaAgente.set(a.agente_user_id, (cargaAgente.get(a.agente_user_id) || 0) + 1)
    })
    const agenteTopId = Array.from(cargaAgente.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
    const agenteTopNome = agenteTopId ? getUserById(agenteTopId)?.name : undefined

    // Empresa top
    const cargaEmpresa = new Map<string, number>()
    all.forEach((a) => {
      cargaEmpresa.set(a.empresa_id, (cargaEmpresa.get(a.empresa_id) || 0) + 1)
    })
    const empresaTopId = Array.from(cargaEmpresa.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
    const empresaTopNome = empresaTopId
      ? empresas.find((e) => e.id === empresaTopId)?.nome
      : undefined

    return {
      total_demandas: all.length,
      demandas_pendentes: pendentes.length,
      demandas_urgentes: urgentes,
      demandas_proximo_checkin: proximoCheckin,
      total_empresas: empresas.length,
      total_funcionarios: funcionarios.length,
      ticket_medio: ticket,
      faturamento_mes: valorTotalMes,
      faturamento_mes_anterior: valorTotalMesAnt,
      por_tipo,
      agente_top: agenteTopNome,
      empresa_top: empresaTopNome,
    }
  }, [empresas, funcionarios])

  async function enviar(textoForcado?: string) {
    const texto = (textoForcado ?? input).trim()
    if (!texto || carregando) return

    const novaMsg: Msg = {
      role: 'user',
      content: texto,
      timestamp: new Date().toISOString(),
    }
    const novasMsgs = [...mensagens, novaMsg]
    setMensagens(novasMsgs)
    setInput('')
    setCarregando(true)

    try {
    const iaConfig = getIAConfig()
    const avaliacao = avaliarPerguntaIA(texto, iaConfig)
    if (!avaliacao.permitido) {
      setMensagens([
        ...novasMsgs,
        {
          role: 'assistant',
          content: avaliacao.motivo || 'Assunto bloqueado nas configurações da IA.',
          timestamp: new Date().toISOString(),
          provedor: 'local',
        },
      ])
      setCarregando(false)
      return
    }

    const ctxSistema = buildSystemContext({ empresas, funcionarios, hoteis, politicas })
    const acao = await responderComIASistema(texto, ctxSistema, {
      addHotel: iaConfig.permitirCadastrarHoteis && !iaConfig.exigirConfirmacaoExecucao ? addHotel : undefined,
      createAtendimento: iaConfig.permitirCriarDemandas && !iaConfig.exigirConfirmacaoExecucao ? addAtendimento : undefined,
      currentUser: user ? { id: user.id, name: user.name } : undefined,
      politicas,
      allowInternet: iaConfig.permitirInternet,
    })
    const respostaSistema: SystemAIResponse | null = acao.handled
      ? acao
      : await responderChatSistema(
          novasMsgs.map((m) => ({ role: m.role, content: m.content })),
          ctxSistema,
          { allowInternet: iaConfig.permitirInternet },
        )

    const respMsg: Msg = {
      role: 'assistant',
      content: respostaParaTextoChat(respostaSistema),
      timestamp: new Date().toISOString(),
      provedor: respostaSistema.provedor === 'sistema' ? 'local' : respostaSistema.provedor,
    }
    setMensagens([...novasMsgs, respMsg])
    } catch (e: any) {
      const friendly = aiErrorUserMessage(e, e?.provedor || 'IA BIA')
      setMensagens([
        ...novasMsgs,
        {
          role: 'assistant',
          content: [
            friendly,
            '',
            'Continuei em modo interno. Posso localizar dados do sistema, preparar demanda, voucher, cotacao ou resumo operacional.',
          ].join('\n'),
          timestamp: new Date().toISOString(),
          provedor: 'local',
        },
      ])
    } finally {
      setCarregando(false)
    }
  }

  async function executarFluxoHotelInteligente(texto: string): Promise<string | null> {
    if (!/(hotel|hoteis|hotéis|hospedagem|pousada|diaria|diária)/i.test(texto)) return null

    let response
    try {
      const destino = extrairDestinoHotel(texto)
      response = await buscarHoteisComIA({
        query: texto,
        cidade: destino.cidade,
        uf: destino.uf,
        knownHotels: hoteis.map((h) => ({ nome: h.nome, cidade: h.cidade, uf: h.uf })),
      })
    } catch (e: any) {
      return `${aiErrorUserMessage(e, e?.provedor || 'ia')}\n\nNão cadastrei hotel sem fonte confiável. Posso tentar novamente ou usar apenas os hotéis já cadastrados.`
    }

    const novas = response.suggestions.filter(
      (s) => !hotelJaExiste(hoteis, s.nome, s.cidade, s.uf),
    )
    const cadastradas: Hotel[] = []

    novas.slice(0, 3).forEach((s, index) => {
      const data = sugestaoParaHotel(s)
      cadastradas.push(addHotel(data))
      if (index === 0) setHotelSuggestions(response.suggestions)
    })

    setHotelSuggestions(response.suggestions)

    const linhas = response.suggestions.slice(0, 5).map((s, i) => {
      const telefone = s.telefone ? ` | tel. ${s.telefone}` : ''
      const fonte = s.fonte_url ? ` | fonte: ${s.fonte_titulo || s.fonte_url}` : ''
      return `${i + 1}. ${s.nome} (${s.cidade}/${s.uf})${telefone}${fonte}`
    })

    return [
      `Busca inteligente de hospedagem: ${response.summary}`,
      cadastradas.length > 0
        ? `Cadastrei automaticamente ${cadastradas.length} hotel(is) novo(s) no módulo Hotéis.`
        : 'Não cadastrei duplicados: os principais resultados já existem ou precisam de revisão.',
      '',
      ...linhas,
    ].join('\n')
  }

  function novaConversa() {
    if (!confirm('Limpar todo o histórico de conversa?')) return
    setMensagens([])
    toast.success('Histórico limpo')
  }

  function copiarMsg(content: string) {
    navigator.clipboard.writeText(content).then(() => toast.success('Copiado'))
  }

  return (
    <div className="space-y-5 animate-fade-in h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="bbt-section-label">Central IA BIA</p>
          <h1 className="text-2xl font-semibold tracking-tight text-bbt-primary dark:text-white flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-bbt-accent" /> Conversa em PT-BR
          </h1>
          <p className="bbt-page-subtitle">
            Pergunte sobre o sistema, peça análises, redija mensagens.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProvedorPill status={status} />
          {mensagens.length > 0 && (
            <button onClick={novaConversa} className="bbt-button-ghost text-xs">
              <Trash2 className="w-3.5 h-3.5" /> Nova conversa
            </button>
          )}
        </div>
      </div>

      {/* Banner contextual conforme provedor */}
      {status?.provedor === 'local' && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4">
          <div className="flex items-start gap-3">
            <CircleDot className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong className="text-amber-800 dark:text-amber-200">
                Modo local ativo.
              </strong>
              <p className="mt-1 text-slate-700 dark:text-slate-300">
                Respondo usando regras + dados do navegador. Para liberar IA generativa completa,
                leitura de imagem, áudio e ações inteligentes, configure uma chave OpenAI paga em{' '}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-bbt-accent underline"
                >
                  platform.openai.com/api-keys
                </a>{' '}
                e cole no <code className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-xs">.env.local</code> como{' '}
                <code className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-xs">OPENAI_API_KEY=sk-...</code>
                . A Gemini fica opcional para busca Google e hotéis.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Mensagens */}
      <div
        ref={scrollRef}
        className="bbt-card flex-1 overflow-y-auto p-5 space-y-4 min-h-[400px]"
      >
        {mensagens.length === 0 && (
          <div className="text-center py-10 text-slate-500">
            <Bot className="w-14 h-14 mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-5">
              Comece uma conversa. Algumas perguntas pra começar:
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-3xl mx-auto">
              {SUGESTOES.map((s, i) => (
                <button
                  key={i}
                  onClick={() => enviar(s)}
                  className="px-3 py-1.5 text-xs rounded-md bg-bbt-accent/8 hover:bg-bbt-accent/15 text-bbt-primary dark:text-bbt-accent border border-bbt-accent/20 transition"
                >
                  {s}
                </button>
              ))}
            </div>
            {hotelSuggestions.length > 0 && (
              <div className="mt-5 max-w-3xl mx-auto rounded-lg border border-bbt-accent/25 bg-bbt-accent/5 p-3 text-left">
                <p className="text-xs font-semibold uppercase tracking-wider text-bbt-accent">
                  Última busca de hotéis
                </p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {hotelSuggestions.slice(0, 4).map((hotel) => (
                    <div key={`${hotel.nome}-${hotel.cidade}`} className="rounded-md bg-white p-2 text-xs dark:bg-slate-900">
                      <div className="font-semibold text-bbt-primary dark:text-white">{hotel.nome}</div>
                      <div className="text-slate-500">{hotel.cidade}/{hotel.uf} {hotel.telefone ? `· ${hotel.telefone}` : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto text-left">
              <CtxCard label="Demandas ativas" value={String(contexto.demandas_pendentes ?? 0)} />
              <CtxCard label="Urgentes" value={String(contexto.demandas_urgentes ?? 0)} />
              <CtxCard label="Empresas" value={String(contexto.total_empresas ?? 0)} />
              <CtxCard
                label="Faturamento"
                value={(contexto.faturamento_mes ?? 0).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                  maximumFractionDigits: 0,
                })}
              />
            </div>
          </div>
        )}

        {mensagens.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                m.role === 'user'
                  ? 'bg-bbt-accent text-white'
                  : 'bg-gradient-to-br from-violet-500 to-pink-500 text-white'
              }`}
            >
              {m.role === 'user' ? (
                <UserIcon className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </div>
            <div className={`flex-1 max-w-[75%] ${m.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`inline-block rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap text-left ${
                  m.role === 'user'
                    ? 'bg-bbt-accent text-white rounded-tr-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-sm'
                }`}
              >
                {m.content}
              </div>
              <div
                className={`flex items-center gap-2 mt-1 text-[10px] text-slate-400 ${
                  m.role === 'user' ? 'justify-end' : ''
                }`}
              >
                {m.role === 'assistant' && m.provedor && (
                  <span className="font-semibold uppercase tracking-wider">
                    {m.provedor === 'gemini'
                      ? 'Gemini · Google'
                      : m.provedor === 'openai'
                      ? 'GPT-5.2'
                      : 'Local'}
                  </span>
                )}
                <span>
                  {new Date(m.timestamp).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <button
                  onClick={() => copiarMsg(m.content)}
                  className="hover:text-bbt-accent transition"
                  aria-label="Copiar mensagem"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {carregando && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="bg-slate-100 dark:bg-slate-800 rounded-lg rounded-tl-sm px-3.5 py-2.5 text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Pensando...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="bbt-card p-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar()
            }
          }}
          rows={2}
          placeholder="Pergunte algo... (Enter pra enviar, Shift+Enter pra nova linha)"
          disabled={carregando}
          className="flex-1 p-2.5 text-sm rounded-md border border-bbt-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-bbt-accent/20 focus:border-bbt-accent resize-none disabled:opacity-50"
        />
        <button
          onClick={() => enviar()}
          disabled={!input.trim() || carregando}
          className="bbt-button-primary h-[60px] px-5"
        >
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {!carregando && 'Enviar'}
        </button>
      </div>
    </div>
  )
}

function respostaParaTextoChat(response: SystemAIResponse): string {
  const linhas = [humanizeAIText(response.message)]
  if (response.links?.length) {
    linhas.push('', 'Ações disponíveis:')
    response.links.forEach((link) => linhas.push(`- ${humanizeAIText(link.label)}`))
  }
  if (response.cards?.length) {
    linhas.push('', 'Resultados relacionados:')
    response.cards.slice(0, 6).forEach((card) => {
      linhas.push(`- ${humanizeAIText(card.title)}${card.subtitle ? ` - ${humanizeAIText(card.subtitle)}` : ''}`)
    })
  }
  if (response.sources?.length) {
    linhas.push('', 'Fontes consultadas:')
    response.sources.slice(0, 6).forEach((source) => {
      if (source.uri) linhas.push(`- ${humanizeAIText(source.title || source.uri)}`)
    })
  }
  return humanizeAIText(linhas.filter(Boolean).join('\n'))
}

function ProvedorPill({ status }: { status: StatusIA | null }) {
  if (!status) return null
  const isOpenAI = status.provedor === 'openai'
  const isGemini = status.provedor === 'gemini'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
        isGemini
          ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800'
          : isOpenAI
          ? 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-200 dark:border-violet-800'
          : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800'
      }`}
    >
      {isGemini || isOpenAI ? <Sparkles className="w-3 h-3" /> : <CircleDot className="w-3 h-3" />}
      {isGemini ? 'Gemini · busca Google' : isOpenAI ? `${status.modelo || 'GPT-5.2'} · pago` : 'Local'}
    </span>
  )
}

function CtxCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-bbt-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="mt-1 text-lg font-semibold text-bbt-primary dark:text-white">{value}</p>
    </div>
  )
}

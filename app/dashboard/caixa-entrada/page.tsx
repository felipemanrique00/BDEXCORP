'use client'
import { todayISODate } from '@/lib/date'
import { useState, useMemo, useEffect, useRef, type ClipboardEvent, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth'
import { parseMensagem } from '@/lib/mensagem-parser'
import { parseMensagemComIA, parseMensagemComIAEImagem, getStatusIA, type IAParserResult, type StatusIA } from '@/lib/ia-parser'
import { aiErrorUserMessage } from '@/lib/ai-friendly-errors'
import { reportClientFailure } from '@/lib/client-observability'
import { encontrarFuncionarioPorCPF } from '@/lib/voucher-parser'
import { buscarFuncionariosPorNomeInteligente, encontrarFuncionarioPorNomeInteligente } from '@/lib/funcionario-identidade'
import {
  criarAtendimentoParaLista,
  getAllAtendimentos,
  registrarLog,
} from '@/lib/atendimentos-storage'
import { persistNewDemandWithCompatibility } from '@/lib/demand-persistence-client'
import {
  MANUAL_DEMAND_BOOKING_MODE,
  shouldSubmitDemandOnCreate,
} from '@/lib/travel/demand-booking-mode'
import { dispararAlertaNovaDemanda } from '@/lib/notificacoes'
import {
  arquivoParaBase64,
  arquivoParaTextoDemanda,
  identificarArquivoDemanda,
  textoHtmlParaTextoDemanda,
} from '@/lib/demand-file-parser'
import { toast } from 'sonner'
import {
  Inbox, Sparkles, Clipboard, Send, User as UserIcon, Building2, Calendar,
  MapPin, Hotel as HotelIcon, Plane, Car, Package, CheckCircle2,
  Tag, Clock, Edit3, Zap, Eraser, Brain, Image as ImageIcon, X,
  Loader2, Coffee, DollarSign, FileText, UploadCloud, Mail, CalendarCheck, Copy,
} from 'lucide-react'
import type { Atendimento, TipoServico, Prioridade, OrigemAtendimento } from '@/types'
import { labelOcupante } from '@/types'
import { NovaDemandaModal } from '@/components/ui/nova-demanda-modal'
import { AudioTranscriber } from '@/components/ui/audio-transcriber'

interface MatchFunc { id: string; nome: string; empresa_id: string; score: number }

export default function CaixaEntradaPage() {
  const router = useRouter()
  const { empresas, funcionarios } = useStore()

  const [texto, setTexto] = useState('')
  const [parsed, setParsed] = useState<IAParserResult | null>(null)
  const [empresaId, setEmpresaId] = useState('')
  const [funcionarioId, setFuncionarioId] = useState<string | null>(null)
  const [passageiroNome, setPassageiroNome] = useState('')
  const [sugestoesFunc, setSugestoesFunc] = useState<MatchFunc[]>([])
  const [prioridade, setPrioridade] = useState<Prioridade>('media')
  const [tipoServico, setTipoServico] = useState<TipoServico>('Hotel')
  const [origemDetectada, setOrigemDetectada] = useState<OrigemAtendimento>('WhatsApp')
  const [criandoRapido, setCriandoRapido] = useState(false)
  const [demandaCriada, setDemandaCriada] = useState<Atendimento | null>(null)
  const [modalAbrirParaEditar, setModalAbrirParaEditar] = useState<Atendimento | null>(null)

  const [modoIA, setModoIA] = useState(false)
  const [iaCarregando, setIaCarregando] = useState(false)
  const [iaStatus, setIaStatus] = useState<StatusIA | null>(null)
  const [imagemPreview, setImagemPreview] = useState<string | null>(null)
  const [imagemBase64, setImagemBase64] = useState<string | null>(null)
  const [imagemMime, setImagemMime] = useState<string | null>(null)
  const inputImagemRef = useRef<HTMLInputElement>(null)
  const inputArquivoRef = useRef<HTMLInputElement>(null)
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false)
  const [arquivoProcessando, setArquivoProcessando] = useState(false)
  const [ultimoArquivo, setUltimoArquivo] = useState<string | null>(null)
  const [outlookAssistOpen, setOutlookAssistOpen] = useState(false)

  useEffect(() => {
    getStatusIA(true).then(setIaStatus).catch((error) => {
      reportClientFailure('ai_status_load_failed', error, { component: 'inbox' })
    })
  }, [])

  // Parser local sem IA
  useEffect(() => {
    if (modoIA) return
    if (!texto || texto.trim().length < 10) { setParsed(null); return }
    const timer = setTimeout(() => {
      const r = parseMensagem(texto)
      const result: IAParserResult = { ...r, ia_usado: false }
      setParsed(result)
      aplicarParsed(result)
    }, 300)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, modoIA])

  function aplicarParsed(r: IAParserResult) {
    if (r.passageiros_lista?.length) setPassageiroNome(r.passageiros_lista[0])
    else if (r.passageiro_nome) setPassageiroNome(r.passageiro_nome)
    if (r.tipo_servico) setTipoServico(r.tipo_servico)
    if (r.urgente) setPrioridade('urgente')

    let empresaDetectadaId = empresaId
    const empresaNome = r.empresa_faturar || r.empresa_nome
    if (empresaNome && !empresaId) {
      const en = empresaNome.toLowerCase()
      const emp = empresas.find((e) =>
        e.nome.toLowerCase().includes(en) || en.includes(e.nome.toLowerCase().split(' ')[0])
      )
      if (emp) {
        empresaDetectadaId = emp.id
        setEmpresaId(emp.id)
      }
    }

    if (r.cpf) {
      const porCpf = encontrarFuncionarioPorCPF(r.cpf, funcionarios)
      if (porCpf) {
        setFuncionarioId(porCpf.id)
        if (!empresaId) setEmpresaId(porCpf.empresa_id)
        setPassageiroNome(porCpf.nome)
        setSugestoesFunc([])
        return
      }
    }

    const nomeMatch = r.passageiros_lista?.[0] || r.passageiro_nome
    if (nomeMatch) {
      const matches = buscarFuncionariosPorNomeInteligente(funcionarios, nomeMatch, empresaDetectadaId || undefined, 10)
        .map((match) => ({
          id: match.funcionario.id,
          nome: match.funcionario.nome,
          empresa_id: match.funcionario.company_id,
          score: match.score,
        }))
      setSugestoesFunc(matches)
      const matchConfiavel = encontrarFuncionarioPorNomeInteligente(funcionarios, nomeMatch, empresaDetectadaId || undefined, 84)
      if (matchConfiavel && !matchConfiavel.ambiguo) {
        setFuncionarioId(matchConfiavel.funcionario.id)
        if (!empresaDetectadaId) setEmpresaId(matchConfiavel.funcionario.company_id)
      }
    }
  }

  function aplicarResultadoIA(result: IAParserResult & { transcricao?: string }) {
    setParsed(result)
    aplicarParsed(result)
    if (result.transcricao && !texto.trim()) setTexto(result.transcricao)
  }

  async function extrairDemandaArquivo(payload: {
    kind: 'text' | 'email' | 'image' | 'audio'
    text?: string
    fileName?: string
    mimeType?: string
    base64?: string
  }): Promise<IAParserResult & { transcricao?: string }> {
    const r = await fetch('/api/ia/extract-demand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const error: any = new Error(data?.error || data?.hint || `HTTP ${r.status}`)
      error.status = r.status
      error.code = data?.code
      error.provedor = data?.provedor
      throw error
    }
    return data
  }

  async function processarArquivoDemanda(file: File) {
    const kind = identificarArquivoDemanda(file)
    if (kind === 'unknown') {
      toast.error('Arquivo nao reconhecido. Use e-mail do Outlook, .eml, .msg, .txt, imagem ou audio.')
      return
    }

    setArquivoProcessando(true)
    setUltimoArquivo(file.name)
    setModoIA(true)
    try {
      if (kind === 'email' || kind === 'text') {
        const conteudo = await arquivoParaTextoDemanda(file)
        setTexto(conteudo)
        setOrigemDetectada(kind === 'email' ? 'E-mail' : 'Outro')
        const result = await extrairDemandaArquivo({
          kind,
          text: conteudo,
          fileName: file.name,
          mimeType: file.type || 'text/plain',
        })
        aplicarResultadoIA(result)
        toast.success(kind === 'email' ? 'E-mail lido e demanda extraída.' : 'Texto lido e demanda extraída.')
        return
      }

      const base64 = await arquivoParaBase64(file)
      if (kind === 'image') {
        setImagemPreview(`data:${file.type || 'image/png'};base64,${base64}`)
        setImagemBase64(base64)
        setImagemMime(file.type || 'image/png')
        setOrigemDetectada('E-mail')
      } else {
        setOrigemDetectada('WhatsApp')
      }

      const result = await extrairDemandaArquivo({
        kind,
        fileName: file.name,
        mimeType: file.type || (kind === 'audio' ? 'audio/mpeg' : 'image/png'),
        base64,
      })
      if (result.transcricao) setTexto(result.transcricao)
      aplicarResultadoIA(result)
      toast.success(kind === 'audio' ? 'Áudio lido e demanda extraída.' : 'Imagem lida e demanda extraída.')
    } catch (e: any) {
      toast.error(aiErrorUserMessage(e, e?.provedor || 'IA BIA'))
    } finally {
      setArquivoProcessando(false)
      setArrastandoArquivo(false)
    }
  }

  async function processarTextoArrastadoDemanda(conteudo: string, origem: 'email' | 'text' = 'email') {
    const textoLimpo = conteudo
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (!textoLimpo || textoLimpo.length < 5) {
      toast.error('Nao consegui ler texto do item arrastado.')
      return
    }

    setArquivoProcessando(true)
    setUltimoArquivo(origem === 'email' ? 'E-mail arrastado do Outlook' : 'Texto arrastado')
    setOutlookAssistOpen(false)
    setModoIA(true)
    setTexto(textoLimpo)
    setOrigemDetectada(origem === 'email' ? 'E-mail' : 'Outro')
    try {
      const result = await extrairDemandaArquivo({
        kind: origem,
        text: textoLimpo,
        fileName: origem === 'email' ? 'outlook-drop.eml' : 'texto-arrastado.txt',
        mimeType: origem === 'email' ? 'message/rfc822' : 'text/plain',
      })
      aplicarResultadoIA(result)
      toast.success(origem === 'email' ? 'E-mail arrastado e demanda extraida.' : 'Texto arrastado e demanda extraida.')
    } catch (e: any) {
      toast.error(aiErrorUserMessage(e, e?.provedor || 'IA BIA'))
    } finally {
      setArquivoProcessando(false)
      setArrastandoArquivo(false)
    }
  }

  async function processarDropDemanda(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setArrastandoArquivo(false)

    const dataTransfer = event.dataTransfer
    const files = obterArquivosDoDrop(dataTransfer)
    const outlookLike = isOutlookDrop(dataTransfer)

    if (files.length > 0) {
      const file = outlookLike ? prepararArquivoOutlook(files[0]) : files[0]
      if (files.length > 1) toast.info(`Recebi ${files.length} arquivos. Vou processar o primeiro agora.`)
      setOutlookAssistOpen(false)
      await processarArquivoDemanda(file)
      return
    }

    const html = await obterTextoDoDrop(dataTransfer, 'text/html')
    if (html) {
      await processarTextoArrastadoDemanda(textoHtmlParaTextoDemanda(html), 'email')
      return
    }

    const plain = await obterTextoDoDrop(dataTransfer, 'text/plain')
    if (plain) {
      await processarTextoArrastadoDemanda(plain, outlookLike ? 'email' : 'text')
      return
    }

    const uri = await obterTextoDoDrop(dataTransfer, 'text/uri-list')
    if (uri) {
      await processarTextoArrastadoDemanda(uri, 'email')
      return
    }

    if (outlookLike) {
      setOutlookAssistOpen(true)
      toast.info('Outlook Desktop bloqueou o arraste direto. Use o modo assistido abaixo.')
      return
    }

    toast.error('Nao recebi arquivo ou texto. Use o botao Colar/Ler e-mail copiado ou selecione um arquivo.')
  }

  async function processarClipboardCompleto() {
    setModoIA(true)

    try {
      if ('read' in navigator.clipboard) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith('image/'))
          if (imageType) {
            const blob = await item.getType(imageType)
            await processarArquivoDemanda(new File([blob], `clipboard.${imageType.split('/')[1] || 'png'}`, { type: imageType }))
            return
          }

          if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html')
            await processarTextoArrastadoDemanda(textoHtmlParaTextoDemanda(await blob.text()), 'email')
            return
          }

          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain')
            await processarTextoArrastadoDemanda(await blob.text(), 'email')
            return
          }
        }
      }

      const plain = await navigator.clipboard.readText()
      if (plain?.trim()) {
        await processarTextoArrastadoDemanda(plain, 'email')
        return
      }
      toast.error('A area de transferencia esta vazia para texto/arquivo.')
    } catch {
      toast.error('Nao consegui ler a area de transferencia. Abra o e-mail, copie o corpo com Ctrl+C e tente de novo.')
    }
  }

  async function processarPasteDemanda(event: ClipboardEvent<HTMLDivElement>) {
    const clipboard = event.clipboardData
    const file = Array.from(clipboard.files || [])[0]
    if (file) {
      event.preventDefault()
      await processarArquivoDemanda(file)
      return
    }

    const html = clipboard.getData('text/html')
    if (html) {
      event.preventDefault()
      await processarTextoArrastadoDemanda(textoHtmlParaTextoDemanda(html), 'email')
      return
    }
  }

  async function analisarComIA() {
    if (!texto.trim() && !imagemBase64) { toast.error('Cole texto ou adicione imagem.'); return }
    setIaCarregando(true)
    try {
      let result: IAParserResult
      if (imagemBase64 && imagemMime) {
        result = await parseMensagemComIAEImagem(texto, imagemBase64, imagemMime)
      } else {
        result = await parseMensagemComIA(texto)
      }
      setParsed(result)
      aplicarParsed(result)
      if (result.ia_erro) {
        toast.warning('Usei a leitura local e preenchi o que foi possivel. Revise os campos antes de criar.')
      } else {
        toast.success('IA analisou com sucesso!')
      }
    } finally {
      setIaCarregando(false)
    }
  }

  function handleImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setImagemPreview(dataUrl)
      setImagemBase64(dataUrl.split(',')[1])
      setImagemMime(f.type)
      setModoIA(true)
    }
    reader.readAsDataURL(f)
  }

  function removerImagem() {
    setImagemPreview(null); setImagemBase64(null); setImagemMime(null)
    if (inputImagemRef.current) inputImagemRef.current.value = ''
  }

  async function colarDoClipboard() {
    await processarClipboardCompleto()
  }

  function limparTudo() {
    setTexto(''); setParsed(null); setEmpresaId(''); setFuncionarioId(null)
    setPassageiroNome(''); setSugestoesFunc([]); setPrioridade('media'); setTipoServico('Hotel')
    setOrigemDetectada('WhatsApp'); setUltimoArquivo(null)
    setOutlookAssistOpen(false)
    setDemandaCriada(null); removerImagem(); setModoIA(false)
  }

  async function copiarSerialDemanda() {
    const serial = demandaCriada?.serial_os
    if (!serial || !navigator.clipboard) {
      toast.error('Não foi possível copiar a OS automaticamente.')
      return
    }
    try {
      await navigator.clipboard.writeText(serial)
      toast.success(`OS ${serial} copiada.`)
    } catch {
      toast.error('O navegador bloqueou a cópia. Selecione a OS exibida e copie manualmente.')
    }
  }

  function abrirReservaDaDemanda() {
    if (!demandaCriada) return
    const serial = demandaCriada.serial_os || ''
    router.push(
      `/dashboard/reservas?atendimento=${encodeURIComponent(demandaCriada.id)}&os=${encodeURIComponent(serial)}`,
    )
  }

  async function criarDemandaRapida() {
    const user = getCurrentUser()
    if (!user) { toast.error('Faça login.'); return }
    if (!empresaId) { toast.error('Selecione uma empresa.'); return }
    if (!passageiroNome.trim()) { toast.error('Preencha o nome.'); return }
    setCriandoRapido(true)

    const obsPartes = [
      texto.trim().slice(0, 1500),
      parsed?.solicitante_nome ? `Solicitante: ${parsed.solicitante_nome}${parsed.solicitante_email ? ` (${parsed.solicitante_email})` : ''}` : '',
      parsed?.empresa_faturar ? `Faturar para: ${parsed.empresa_faturar}` : '',
      parsed?.ia_resumo ? `IA: ${parsed.ia_resumo}` : '',
    ].filter(Boolean).join('\n').trim().slice(0, 2000)

    const payload: Omit<Atendimento, 'id' | 'created_at' | 'updated_at'> = {
      empresa_id: empresaId,
      funcionario_id: funcionarioId,
      passageiro_nome: passageiroNome.trim(),
      tipo_servico: tipoServico,
      booking_mode: MANUAL_DEMAND_BOOKING_MODE,
      valor_cotacao: 0,
      agente_user_id: user.id,
      status: 'pendente',
      prioridade,
      origem: origemDetectada,
      observacoes: obsPartes,
      data_atendimento: todayISODate(),
      centro_custo: parsed?.centro_custo,
      detalhes_aereo: tipoServico === 'Aéreo' ? {
        origem: parsed?.cidade_origem, destino: parsed?.cidade_destino,
        data_ida: parsed?.data_ida, data_volta: parsed?.data_volta,
      } : undefined,
      detalhes_hotel: tipoServico === 'Hotel' ? {
        hotel_nome: parsed?.hotel_nome,
        cidade: parsed?.cidade_destino,
        data_checkin: parsed?.data_checkin,
        data_checkout: parsed?.data_checkout,
        num_hospedes: parsed?.num_hospedes || 1,
        tipo_apto: parsed?.tipo_quarto,
        tarifa_unitaria: parsed?.valor_diaria,
      } : undefined,
      origem_emissao: 'caixa_entrada',
    }

    try {
      const preparada = criarAtendimentoParaLista(payload, getAllAtendimentos())
      const persistida = await persistNewDemandWithCompatibility(
        preparada,
        shouldSubmitDemandOnCreate(MANUAL_DEMAND_BOOKING_MODE),
      )
      const nova = persistida.demand
      registrarLog({
        user_id: user.id, user_name: user.name, acao: 'criar',
        entidade: 'Atendimento', entidade_id: nova.id,
        descricao: `Criou via Caixa de Entrada${parsed?.ia_usado ? ' (IA)' : ''}: ${passageiroNome}`,
      })
      dispararAlertaNovaDemanda(passageiroNome, empresaSelecionada?.nome || '', nova.id, nova.serial_os)
      setDemandaCriada(nova)
      if (persistida.governance?.policy.blocked) {
        toast.warning(`Demanda ${nova.serial_os || nova.id} criada e bloqueada pela política corporativa.`)
      } else if (persistida.governance?.policy.requiresAction) {
        toast.warning(`Demanda ${nova.serial_os || nova.id} criada e mantida pendente por requisitos da política.`)
      } else {
        toast.success(`Demanda ${nova.serial_os || nova.id} criada e encaminhada para cotação do consultor.`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao confirmar a demanda no servidor.')
    } finally {
      setCriandoRapido(false)
    }
  }

  const TIPOS: { value: TipoServico; label: string; icon: any }[] = [
    { value: 'Hotel', label: 'Hotel', icon: HotelIcon },
    { value: 'Aéreo', label: 'Aéreo', icon: Plane },
    { value: 'Carro', label: 'Locação', icon: Car },
    { value: 'Pacote', label: 'Pacote', icon: Package },
  ]

  const ocupanteLabel = labelOcupante(tipoServico)
  const empresaSelecionada = empresas.find((e) => e.id === empresaId)
  const confiancaCor = parsed?.ia_confianca === 'alta' ? 'text-green-600' : parsed?.ia_confianca === 'media' ? 'text-amber-600' : 'text-red-500'
  const serialDemandaCriada = demandaCriada?.serial_os || demandaCriada?.id.slice(-8).toUpperCase() || ''

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Operação · Captura</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Inbox className="w-6 h-6 text-bbt-accent" /> Caixa de Entrada
          </h1>
          <p className="bbt-page-subtitle">
            Cole mensagem, importe áudio ou envie print — a IA extrai os dados automaticamente.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setModoIA(false)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${!modoIA ? 'bg-bbt-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
          <Sparkles className="w-4 h-4" /> Parser Local
        </button>
        <button onClick={() => setModoIA(true)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${modoIA ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
          <Brain className="w-4 h-4" /> Análise com IA
          <span className="text-[10px] opacity-75 ml-1">
            {iaStatus?.provedor === 'gemini' ? 'Gemini' : iaStatus?.provedor === 'openai' ? 'GPT-5.2' : 'Local'}
          </span>
        </button>
        {modoIA && iaStatus?.aceita_imagem && (
          <button onClick={() => inputImagemRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border-2 border-dashed border-purple-300 text-purple-600 hover:border-purple-500 transition">
            <ImageIcon className="w-4 h-4" /> Importar print/imagem
          </button>
        )}
        {modoIA && !iaStatus?.aceita_imagem && iaStatus?.provedor !== 'local' && (
          <span className="text-xs text-slate-500 italic">
            Imagem/áudio de arquivo requer OpenAI GPT-5.2 ou Gemini configurado.
          </span>
        )}
        <input ref={inputImagemRef} type="file" accept="image/*" className="hidden" onChange={handleImagem} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="bbt-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Clipboard className="w-4 h-4 text-bbt-accent" /> Mensagem recebida
              </h3>
              <div className="flex gap-2">
                <button onClick={colarDoClipboard} disabled={arquivoProcessando} className="text-xs bbt-button-ghost flex items-center gap-1 disabled:opacity-60">
                  <Clipboard className="w-3 h-3" /> Ler e-mail copiado
                </button>
                {(texto || imagemPreview) && (
                  <button onClick={limparTudo} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                    <Eraser className="w-3 h-3" /> Limpar
                  </button>
                )}
              </div>
            </div>

            <div
              onDragEnter={(e) => { e.preventDefault(); setArrastandoArquivo(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setArrastandoArquivo(true) }}
              onDragLeave={() => setArrastandoArquivo(false)}
              onDrop={processarDropDemanda}
              onPaste={processarPasteDemanda}
              className={`mb-3 rounded-lg border-2 border-dashed p-3 transition ${
                arrastandoArquivo
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                  : 'border-bbt-accent/25 bg-bbt-accent/5 dark:bg-bbt-accent/10'
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-purple-600 text-white flex items-center justify-center">
                  {arquivoProcessando ? <Loader2 className="w-5 h-5 animate-spin" /> : <UploadCloud className="w-5 h-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-bbt-primary dark:text-white">
                    Arraste e-mail do Outlook, áudio ou print da demanda
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aceita arrastar direto da lista do Outlook, .eml, .msg, .txt, imagens e audios WhatsApp.
                  </p>
                  {ultimoArquivo && (
                    <p className="mt-1 text-[11px] text-purple-700 dark:text-purple-300 truncate">
                      Último arquivo: {ultimoArquivo}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => inputArquivoRef.current?.click()}
                  disabled={arquivoProcessando}
                  className="bbt-button-ghost text-xs flex items-center gap-1 disabled:opacity-60"
                >
                  <Mail className="w-3.5 h-3.5" /> Selecionar arquivo
                </button>
              </div>
              <input
                ref={inputArquivoRef}
                type="file"
                className="hidden"
                accept=".eml,.msg,.oft,.txt,.html,.htm,image/*,audio/*,.opus,.ogg,.m4a,.mp3,.wav,.aac,.webm"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) processarArquivoDemanda(file)
                  e.currentTarget.value = ''
                }}
              />
            </div>

            {outlookAssistOpen && (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-800 dark:text-amber-100">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Modo assistido para Outlook Desktop</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
                      O Outlook bloqueou o conteudo no arraste. Selecione o e-mail no Outlook, pressione Ctrl+C e clique abaixo para a IA ler o e-mail copiado.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={processarClipboardCompleto}
                        disabled={arquivoProcessando}
                        className="bbt-button-primary h-8 text-xs disabled:opacity-60"
                      >
                        <Clipboard className="h-3.5 w-3.5" /> Ler e-mail copiado
                      </button>
                      <button
                        type="button"
                        onClick={() => inputArquivoRef.current?.click()}
                        disabled={arquivoProcessando}
                        className="bbt-button-ghost h-8 text-xs disabled:opacity-60"
                      >
                        <Mail className="h-3.5 w-3.5" /> Selecionar .msg/.eml
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOutlookAssistOpen(false)}
                    className="rounded-md p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-800/60"
                    aria-label="Fechar ajuda do Outlook"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {imagemPreview && (
              <div className="relative mb-3 rounded-lg overflow-hidden border border-purple-200 dark:border-purple-700">
                <img src={imagemPreview} alt="Preview" className="max-h-48 w-full object-contain bg-slate-50 dark:bg-slate-900" />
                <button onClick={removerImagem} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600">
                  <X className="w-3 h-3" />
                </button>
                <div className="text-[10px] text-center py-1 text-purple-600 bg-purple-50 dark:bg-purple-900/20">
                  Imagem carregada — clique em Analisar com IA
                </div>
              </div>
            )}

            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={modoIA
                ? `Cole texto do e-mail ou WhatsApp e clique em "Analisar com IA".\nOu importe um print/screenshot acima.\n\nExemplos aceitos:\n- Tabela do Outlook (Hóspedes, Check-in, Hotel...)\n- Texto informal do WhatsApp\n- Transcrição de áudio`
                : `Cole aqui a mensagem:\n\nESTRUTURADO:\nNome: Felipe Manrique\nHotel: Nacional In\nCheck in: 28/04\nCheck out: 30/04\nEmpresa: Way\n\nCONVERSACIONAL:\n"Preciso de hotel em Palmas pra Samuel do dia 28 ao 30. Rebic. Urgente!"`}
              rows={imagemPreview ? 5 : 11}
              className="w-full p-3 text-sm rounded-lg border border-bbt-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 text-bbt-text dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-bbt-accent resize-none font-mono"
            />

            {modoIA && (
              <button onClick={analisarComIA} disabled={iaCarregando || (!texto.trim() && !imagemBase64)}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm disabled:opacity-50 transition">
                {iaCarregando
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Analisando com IA...</>
                  : <><Brain className="w-4 h-4" /> Analisar com IA</>}
              </button>
            )}

            <div className="mt-3">
              <AudioTranscriber
                onTranscricao={(t) => {
                  setTexto(t)
                  toast.success(modoIA ? 'Transcrito! Clique em "Analisar com IA".' : 'Áudio transcrito! Revise os dados.')
                }}
                onResultadoIA={(result, transcricao) => {
                  if (transcricao) setTexto(transcricao)
                  setOrigemDetectada('WhatsApp')
                  aplicarResultadoIA(result)
                }}
              />
            </div>

            {parsed && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {parsed.ia_usado ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 flex items-center gap-1">
                    <Brain className="w-3 h-3" /> Analisado por IA
                  </span>
                ) : (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${parsed.modo === 'estruturado' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    <Sparkles className="w-3 h-3 inline mr-1" />{parsed.modo === 'estruturado' ? 'Detecção estruturada' : 'Detecção conversacional'}
                  </span>
                )}
                {parsed.ia_confianca && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 dark:bg-slate-700 ${confiancaCor}`}>
                    Confiança: {parsed.ia_confianca}
                  </span>
                )}
                {parsed.urgente && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">
                    <Zap className="w-3 h-3 inline mr-1" /> Urgente
                  </span>
                )}
              </div>
            )}
          </div>

          {parsed && (
            <div className={`bbt-card p-4 border-2 ${parsed.ia_usado ? 'border-purple-200 dark:border-purple-700 bg-gradient-to-br from-purple-50/30 to-transparent' : 'border-bbt-accent/20 bg-gradient-to-br from-bbt-accent/5 to-transparent'}`}>
              {parsed.ia_resumo && (
                <div className="text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 rounded-lg px-3 py-2 mb-3 font-medium flex items-start gap-2">
                  <Brain className="w-3.5 h-3.5 mt-0.5 shrink-0" />{parsed.ia_resumo}
                </div>
              )}
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-bbt-accent" /> Dados extraídos
              </h4>
              <div className="space-y-1 text-xs">
                {(parsed.passageiros_lista?.length || parsed.passageiro_nome) && (
                  <DadoExtraido icon={UserIcon} label={ocupanteLabel} value={parsed.passageiros_lista?.join(', ') || parsed.passageiro_nome || ''} />
                )}
                {parsed.cpf && <DadoExtraido icon={Tag} label="CPF" value={parsed.cpf} />}
                {parsed.empresa_nome && <DadoExtraido icon={Building2} label="Empresa" value={parsed.empresa_nome} />}
                {parsed.empresa_faturar && <DadoExtraido icon={Building2} label="Faturar para" value={parsed.empresa_faturar} />}
                {parsed.hotel_nome && <DadoExtraido icon={HotelIcon} label="Hotel" value={parsed.hotel_nome} />}
                {parsed.cidade_destino && <DadoExtraido icon={MapPin} label="Cidade" value={parsed.cidade_destino} />}
                {parsed.data_checkin && <DadoExtraido icon={Calendar} label="Check-in" value={formatarData(parsed.data_checkin)} />}
                {parsed.data_checkout && <DadoExtraido icon={Calendar} label="Check-out" value={formatarData(parsed.data_checkout)} />}
                {parsed.data_ida && <DadoExtraido icon={Calendar} label="Ida" value={formatarData(parsed.data_ida)} />}
                {parsed.data_volta && <DadoExtraido icon={Calendar} label="Volta" value={formatarData(parsed.data_volta)} />}
                {parsed.num_hospedes && <DadoExtraido icon={UserIcon} label="Hóspedes" value={String(parsed.num_hospedes)} />}
                {parsed.tipo_quarto && <DadoExtraido icon={HotelIcon} label="Tipo quarto" value={parsed.tipo_quarto === 'SGL' ? 'Individual' : parsed.tipo_quarto === 'DBL' ? 'Duplo' : 'Triplo'} />}
                {parsed.valor_diaria && <DadoExtraido icon={DollarSign} label="Valor diária" value={`R$ ${Number(parsed.valor_diaria).toFixed(2).replace('.', ',')}`} />}
                {parsed.cafe_manha && <DadoExtraido icon={Coffee} label="Café da manhã" value="Incluso" />}
                {parsed.centro_custo && <DadoExtraido icon={Tag} label="Centro custo" value={parsed.centro_custo} />}
                {parsed.solicitante_nome && <DadoExtraido icon={UserIcon} label="Solicitante" value={`${parsed.solicitante_nome}${parsed.solicitante_email ? ` (${parsed.solicitante_email})` : ''}`} />}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="bbt-card p-4">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-4 h-4 text-green-500" /> Confirmar e criar
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">Empresa *</label>
                <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="bbt-input">
                  <option value="">Selecione...</option>
                  {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5 tracking-wider">{ocupanteLabel} *</label>
                <input value={passageiroNome} onChange={(e) => { setPassageiroNome(e.target.value); setFuncionarioId(null) }}
                  placeholder={`Nome do ${ocupanteLabel.toLowerCase()}`} className="bbt-input" />
                {funcionarioId && (
                  <div className="text-[10px] text-green-700 dark:text-green-400 mt-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Funcionário vinculado
                  </div>
                )}
                {!funcionarioId && sugestoesFunc.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] text-slate-500">Sugestões:</div>
                    {sugestoesFunc.slice(0, 3).map((m) => (
                      <button key={m.id} type="button"
                        onClick={() => { setFuncionarioId(m.id); setPassageiroNome(m.nome); setEmpresaId(m.empresa_id) }}
                        className="w-full text-left text-xs px-2 py-1 rounded bg-bbt-accent/5 hover:bg-bbt-accent/15 border border-bbt-accent/20">
                        <span className="font-medium">{m.nome}</span>
                        <span className="ml-2 text-[10px] text-slate-500">({m.score}% match)</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-2 tracking-wider">Tipo</label>
                <div className="grid grid-cols-4 gap-2">
                  {TIPOS.map((t) => {
                    const Icon = t.icon
                    const active = tipoServico === t.value
                    return (
                      <button key={t.value} type="button" onClick={() => setTipoServico(t.value)}
                        className={`p-2 rounded-lg border-2 text-center transition ${active ? 'border-bbt-accent bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent' : 'border-bbt-gray-100 dark:border-slate-700 text-slate-500 hover:border-bbt-accent/50'}`}>
                        <Icon className="w-4 h-4 mx-auto mb-0.5" />
                        <div className="text-[10px] font-semibold">{t.label}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-2 tracking-wider">Prioridade</label>
                <div className="flex gap-1">
                  {(['baixa', 'media', 'alta', 'urgente'] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setPrioridade(p)}
                      className={`flex-1 px-2 py-1.5 text-xs font-semibold rounded transition ${prioridade === p
                        ? p === 'urgente' ? 'bg-red-100 text-red-700 ring-2 ring-red-300' : p === 'alta' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300' : p === 'media' ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300' : 'bg-slate-100 text-slate-700 ring-2 ring-slate-300'
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {!demandaCriada ? (
            <button onClick={criarDemandaRapida} disabled={criandoRapido || !empresaId || !passageiroNome}
              className="w-full bbt-button-primary h-12 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {criandoRapido ? <><Clock className="w-4 h-4 animate-spin" /> Criando...</> : <><Send className="w-4 h-4" /> Criar Demanda Rápida</>}
            </button>
          ) : (
            <div className="bbt-card p-4 bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-700">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <h4 className="font-semibold text-green-700 dark:text-green-400">Demanda criada!</h4>
                {parsed?.ia_usado && <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">via IA</span>}
              </div>
              <div className="mb-3 rounded-md border border-green-200 bg-white/80 p-3 dark:border-green-800 dark:bg-slate-900/50">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">Serial/OS gerada</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-bbt-primary dark:text-white">{serialDemandaCriada}</div>
                  </div>
                  <button
                    type="button"
                    onClick={copiarSerialDemanda}
                    className="bbt-button-ghost h-9 w-9 shrink-0 justify-center p-0"
                    aria-label="Copiar Serial/OS"
                    title="Copiar Serial/OS"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  <strong>{demandaCriada.passageiro_nome}</strong> · ID interno: {demandaCriada.id.slice(-8).toUpperCase()}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={limparTudo} className="bbt-button-ghost text-xs flex-1">Nova mensagem</button>
                <button onClick={() => setModalAbrirParaEditar(demandaCriada)} className="bbt-button-primary text-xs flex-1 flex items-center justify-center gap-1">
                  <Edit3 className="w-3 h-3" /> Completar dados
                </button>
                <button onClick={() => router.push(`/dashboard/vouchers/novo?atendimento=${demandaCriada.id}`)} className="bbt-button-ghost text-xs flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Gerar Voucher
                </button>
                <button onClick={abrirReservaDaDemanda} className="bbt-button-primary w-full text-xs flex items-center justify-center gap-1">
                  <CalendarCheck className="w-3.5 h-3.5" /> Preparar cotação ou reserva
                </button>
              </div>
            </div>
          )}

          {modoIA && !parsed && (
            <div className="bbt-card p-4 bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-700">
              <h4 className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-2 flex items-center gap-1">
                <Brain className="w-3.5 h-3.5" /> Como usar a IA
              </h4>
              <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <li>• Cole qualquer texto (e-mail, WhatsApp, transcrição)</li>
                <li>• Ou importe um print/screenshot do e-mail</li>
                <li>• Clique em "Analisar com IA"</li>
                <li>• Confirme os dados e crie a demanda</li>
              </ul>
            </div>
          )}
        </div>
      </div>

      <NovaDemandaModal
        open={!!modalAbrirParaEditar}
        onClose={() => setModalAbrirParaEditar(null)}
        editing={modalAbrirParaEditar}
        onSaved={() => { toast.success('Demanda atualizada!'); setModalAbrirParaEditar(null) }}
      />
    </div>
  )
}

function obterArquivosDoDrop(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files || [])
  if (files.length > 0) return files

  return Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

function isOutlookDrop(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types || []).some((type) =>
    /outlook|message|rfc822|filegroupdescriptor|filecontents|msoutlook/i.test(type),
  )
}

function prepararArquivoOutlook(file: File): File {
  const name = file.name || 'email-outlook.msg'
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(name)
  const finalName = hasExtension ? name : `${name}.msg`
  const type = file.type || 'application/vnd.ms-outlook'
  return new File([file], finalName, { type, lastModified: file.lastModified })
}

function obterTextoDoDrop(dataTransfer: DataTransfer, type: string): Promise<string> {
  const direct = dataTransfer.getData(type)
  if (direct) return Promise.resolve(direct)

  const item = Array.from(dataTransfer.items || []).find(
    (entry) => entry.kind === 'string' && entry.type.toLowerCase() === type.toLowerCase(),
  )
  if (!item) return Promise.resolve('')

  return new Promise((resolve) => {
    item.getAsString((value) => resolve(value || ''))
  })
}

function DadoExtraido({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3 h-3 text-bbt-accent shrink-0" />
      <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}:</span>
      <strong className="min-w-0 break-words leading-tight text-bbt-primary [overflow-wrap:anywhere] dark:text-white">{value}</strong>
    </div>
  )
}

function formatarData(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

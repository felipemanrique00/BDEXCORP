'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useStore } from '@/lib/store'
import { AI_NAME, AI_SHORT_NAME } from '@/lib/branding'
import { getStatusIA, type StatusIA } from '@/lib/ia-parser'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { addAtendimento } from '@/lib/atendimentos-storage'
import {
  buildSystemContext,
  responderChatSistema,
  responderComIASistema,
  type SystemAIResponse,
} from '@/lib/ia-system-actions'
import { AI_CONTEXT_EVENTS, type AIPageContext } from '@/components/ai/ai-assistant-fab'
import { avaliarPerguntaIA, getIAConfig } from '@/lib/ia-config-storage'
import { aiErrorUserMessage } from '@/lib/ai-friendly-errors'
import {
  Bot,
  Download,
  ExternalLink,
  Hotel,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Search,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AssistantSetting } from '@/lib/assistant/types'
import { getAssistantSettingsClient } from '@/lib/assistant-settings-client'

interface QuickMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  response?: SystemAIResponse
}

const SUGESTOES = [
  'Localize o voucher do Pedro Melo para Brasília dia 15/08',
  'Preciso viajar para São Paulo segunda e voltar quarta com hotel dentro da política',
  'Preciso de hospedagem em Campo Grande-MS, cadastre hotéis se não tiver',
  'Reservar hotel pela Tech em Campo Grande para 10/05 a 12/05',
  'Pesquise em tempo real o telefone oficial do Deville Campo Grande',
  'Quais demandas urgentes eu tenho agora?',
]

export function QuickAIPopup() {
  const { empresas, funcionarios, hoteis, politicas, addHotel } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const podeCadastrarHoteis = user?.role === 'master' && hasPermission(user, 'cadastrar_hoteis')
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<StatusIA | null>(null)
  const [assistantSettings, setAssistantSettings] = useState<AssistantSetting | null>(null)
  const [pageContext, setPageContext] = useState<AIPageContext | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [recording, setRecording] = useState(false)
  const [audioBusy, setAudioBusy] = useState(false)
  const [audioStatus, setAudioStatus] = useState('')
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [msgs, setMsgs] = useState<QuickMsg[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        `${AI_SHORT_NAME} pronta. Posso localizar voucher, viajante, demanda, hotel, resumir o sistema, pesquisar na internet e executar ações conforme suas permissões.`,
    },
  ])
  const scrollRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  useEffect(() => {
    getStatusIA().then(setStatus).catch(() => {})
    getAssistantSettingsClient().then((settings) => {
      if (settings) setAssistantSettings(settings)
    })
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setVoiceSupported(Boolean(typeof navigator.mediaDevices?.getUserMedia === 'function' && window.MediaRecorder))
    setAutoSpeak(window.localStorage.getItem('bbt-ai-autospeak') === '1')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onUpdate = (event: Event) => setPageContext((event as CustomEvent<AIPageContext>).detail)
    const onClear = () => setPageContext(null)
    const onOpen = () => setOpen(true)

    window.addEventListener(AI_CONTEXT_EVENTS.update, onUpdate)
    window.addEventListener(AI_CONTEXT_EVENTS.clear, onClear)
    window.addEventListener(AI_CONTEXT_EVENTS.open, onOpen)

    return () => {
      window.removeEventListener(AI_CONTEXT_EVENTS.update, onUpdate)
      window.removeEventListener(AI_CONTEXT_EVENTS.clear, onClear)
      window.removeEventListener(AI_CONTEXT_EVENTS.open, onOpen)
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, loading, open])

  async function enviar(textoForcado?: string, options?: { forceAudioResponse?: boolean }) {
    const texto = (textoForcado ?? input).trim()
    if (!texto || loading) return
    const assistantBehavior = buildAssistantBehaviorContext(assistantSettings)
    const textoParaAcao = texto
    const textoParaChat = [
      assistantBehavior,
      pageContext
        ? [
            `Contexto da tela: ${pageContext.pageContext}`,
            pageContext.dataContext ? `Dados visiveis:\n${pageContext.dataContext}` : '',
            `Pedido do usuario:\n${texto}`,
          ]
            .filter(Boolean)
            .join('\n\n')
        : texto,
    ]
      .filter(Boolean)
      .join('\n\n')

    const userMsg: QuickMsg = { id: crypto.randomUUID(), role: 'user', content: texto }
    const novas = [...msgs, userMsg]
    setMsgs(novas)
    setInput('')
    setLoading(true)

    try {
      const iaConfig = getIAConfig()
      const avaliacao = avaliarPerguntaIA(texto, iaConfig)
      if (!avaliacao.permitido) {
        setMsgs((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: avaliacao.motivo || 'Assunto bloqueado nas configurações da IA.',
          },
        ])
        return
      }

      const ctx = buildSystemContext({ empresas, funcionarios, hoteis, politicas })
      const acao = await responderComIASistema(textoParaAcao, ctx, {
        addHotel: iaConfig.permitirCadastrarHoteis && podeCadastrarHoteis && !iaConfig.exigirConfirmacaoExecucao ? addHotel : undefined,
        createAtendimento: iaConfig.permitirCriarDemandas && !iaConfig.exigirConfirmacaoExecucao ? addAtendimento : undefined,
        currentUser: user ? { id: user.id, name: user.name } : undefined,
        politicas,
        allowInternet: iaConfig.permitirInternet,
      })
      const resposta = acao.handled
        ? acao
        : await responderChatSistema(
            [...novas.slice(-8), { id: 'context', role: 'user' as const, content: textoParaChat }].map((m) => ({ role: m.role, content: m.content })),
            ctx,
            { allowInternet: iaConfig.permitirInternet },
          )

      setMsgs((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: resposta.message,
          response: resposta,
        },
      ])
      if (options?.forceAudioResponse || autoSpeak || wantsAudioReply(texto)) {
        await playAssistantAudio(resposta.message)
      }
    } catch (e: any) {
      const friendly = aiErrorUserMessage(e, e?.provedor || 'IA BIA')
      toast.error(friendly)
      setMsgs((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [
            friendly,
            '',
            'Ainda consigo ajudar com os dados internos do sistema. Me diga se você quer localizar demanda, voucher, funcionário, hotel, financeiro ou fornecedor.',
          ].join('\n'),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function toggleAutoSpeak() {
    const next = !autoSpeak
    setAutoSpeak(next)
    if (typeof window !== 'undefined') window.localStorage.setItem('bbt-ai-autospeak', next ? '1' : '0')
  }

  async function toggleRecording() {
    if (!voiceSupported || typeof window === 'undefined') return
    if (recording) {
      mediaRecorderRef.current?.stop()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      audioChunksRef.current = []
      const mimeType = pickRecorderMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      recorder.ondataavailable = (event) => {
        if (event.data?.size) audioChunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        stopAudioStream()
        setAudioStatus('')
        setRecording(false)
        toast.error('Não consegui gravar o áudio.')
      }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' })
        stopAudioStream()
        setRecording(false)
        if (blob.size > 0) {
          void enviarAudioBlob(blob)
        } else {
          setAudioStatus('')
          toast.error('Audio vazio. Tente gravar novamente.')
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setAudioStatus('Gravando comando de voz...')
    } catch {
      stopAudioStream()
      setAudioStatus('')
      setRecording(false)
      toast.error('Não consegui acessar o microfone.')
    }
  }

  async function enviarAudioBlob(blob: Blob) {
    if (loading || audioBusy) return
    setAudioBusy(true)
    setAudioStatus('Transcrevendo áudio...')
    try {
      const form = new FormData()
      form.append('file', blob, `comando-${Date.now()}.webm`)
      form.append('channel', 'voice')
      const response = await fetch('/api/assistant/audio/transcribe', { method: 'POST', body: form })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || 'Falha ao transcrever áudio.')
      }
      const transcript = String(result.transcript || '').trim()
      if (!transcript) throw new Error('A transcricao veio vazia.')
      setInput(transcript)
      setAudioStatus('Audio transcrito. Consultando IA...')
      await enviar(transcript, { forceAudioResponse: true })
      setAudioStatus('')
    } catch (error: any) {
      setAudioStatus('')
      toast.error(aiErrorUserMessage(error, 'IA BIA'))
    } finally {
      setAudioBusy(false)
    }
  }

  async function playAssistantAudio(text: string) {
    if (typeof window === 'undefined') return
    try {
      setAudioStatus('Gerando resposta em áudio...')
      const response = await fetch('/api/assistant/audio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Falha ao gerar áudio.')

      if (result.audioBase64 && result.mimeType) {
        const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`)
        await audio.play()
      } else {
        toast.message('TTS real não configurado; usando voz do navegador.')
        speak(text)
      }
    } catch (error: any) {
      toast.error('Não consegui gerar áudio agora. Vou manter a resposta em texto.')
      speak(text)
    } finally {
      setAudioStatus('')
    }
  }

  function speak(text: string) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').slice(0, 1200))
    utterance.lang = 'pt-BR'
    utterance.rate = 1
    window.speechSynthesis.speak(utterance)
  }

  function stopAudioStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    mediaRecorderRef.current = null
  }

  function pickRecorderMimeType(): string {
    if (typeof window === 'undefined' || !window.MediaRecorder) return ''
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
  }

  function wantsAudioReply(text: string): boolean {
    return /\b(audio|voz|fale|leia|responda por audio|resposta em audio)\b/i.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  }

  function buildAssistantBehaviorContext(config: AssistantSetting | null): string {
    if (!config) return ''
    return [
      'Configuracao atual da assistente BBT:',
      `Personalidade: ${config.personality}`,
      `Tom: ${config.tone}`,
      config.customPersonality ? `Descricao personalizada do dono: ${config.customPersonality}` : '',
      `Instrucao principal: ${config.systemInstruction}`,
      `Regras de seguranca: ${config.securityRules}`,
      'Respeite essa personalidade sem quebrar segurança, LGPD, permissões ou validação de dados sensíveis.',
    ].filter(Boolean).join('\n')
  }

  const sugestoesAtivas = pageContext?.suggestedPrompts?.length ? pageContext.suggestedPrompts : SUGESTOES

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[80] h-14 w-14 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-2xl shadow-purple-900/30 flex items-center justify-center hover:scale-105 transition"
        aria-label={`Abrir ${AI_SHORT_NAME}`}
      >
        <Sparkles className="w-6 h-6" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-[80] w-[min(92vw,440px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="bg-slate-950 px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-purple-600 flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{AI_NAME}</p>
            <p className="text-[11px] text-slate-300 truncate">
              {pageContext?.pageContext
                ? `Contexto: ${pageContext.pageContext}`
                : status?.provedor === 'gemini'
                ? 'Gemini + busca Google + dados do sistema'
                : status?.provedor === 'openai'
                ? `${status.modelo || 'GPT-5.2'} + dados do sistema`
                : status?.provedor === 'local'
                ? 'Modo local + dados do sistema'
                : `${status?.provedor || 'IA'} + dados do sistema`}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleAutoSpeak}
            className="h-8 w-8 rounded-md hover:bg-white/10 flex items-center justify-center"
            aria-label={autoSpeak ? 'Desativar resposta por voz' : 'Ativar resposta por voz'}
          >
            {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-8 w-8 rounded-md hover:bg-white/10 flex items-center justify-center"
            aria-label="Fechar IA"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="max-h-[56vh] min-h-[320px] overflow-y-auto p-4 space-y-3">
        {msgs.map((msg) => (
          <div key={msg.id} className={msg.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[88%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-left ${
                msg.role === 'user'
                  ? 'bg-bbt-accent text-white'
                  : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
              }`}
            >
              {msg.response?.title && (
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider opacity-80">
                  <Search className="w-3 h-3" /> {msg.response.title}
                </div>
              )}
              <MessageContent content={msg.content} />
            </div>
            {msg.response && <RespostaExtras response={msg.response} />}
          </div>
        ))}

        {loading && (
          <div className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin" /> Consultando sistema...
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-3 dark:border-slate-700">
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {sugestoesAtivas.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => enviar(s)}
              disabled={loading}
              className="shrink-0 rounded-full border border-bbt-accent/30 px-2.5 py-1 text-[11px] font-medium text-bbt-primary hover:bg-bbt-accent/10 disabled:opacity-60 dark:text-bbt-accent"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
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
            placeholder="Pergunte ou peça uma ação..."
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-bbt-accent focus:ring-2 focus:ring-bbt-accent/20 dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={toggleRecording}
            disabled={!voiceSupported || loading || audioBusy}
            className={`h-11 w-11 rounded-lg border flex items-center justify-center disabled:opacity-50 ${
              recording
                ? 'border-red-300 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/30'
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
            }`}
            aria-label={recording ? 'Parar gravacao' : 'Gravar comando de voz'}
          >
            {audioBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => enviar()}
            disabled={!input.trim() || loading || audioBusy}
            className="h-11 w-11 rounded-lg bg-bbt-accent text-white flex items-center justify-center disabled:opacity-50"
            aria-label="Enviar para IA"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        {audioStatus && (
          <div className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {audioStatus}
          </div>
        )}
      </div>
    </div>
  )
}

function MessageContent({ content }: { content: string }) {
  const lines = String(content || '').split('\n')
  return (
    <>
      {lines.map((line, lineIndex) => (
        <span key={`${lineIndex}-${line.slice(0, 12)}`}>
          {renderInlineMarkdown(line)}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  )
}

function renderInlineMarkdown(line: string) {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
    }
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function RespostaExtras({ response }: { response: SystemAIResponse }) {
  const hasExtras = Boolean(response.links?.length || response.cards?.length || response.sources?.length)
  if (!hasExtras) return null

  return (
    <div className="mt-2 space-y-2 text-left">
      {response.links?.length ? (
        <div className="flex flex-wrap gap-2">
          {response.links.map((link) => {
            const cls =
              link.kind === 'primary'
                ? 'bg-bbt-accent text-white'
                : link.kind === 'download'
                ? 'bg-green-600 text-white'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
            const icon = link.kind === 'download' ? <Download className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />
            if (/^https?:\/\//i.test(link.href)) {
              return (
                <a key={`${link.href}-${link.label}`} href={link.href} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${cls}`}>
                  {icon} {link.label}
                </a>
              )
            }
            return (
              <Link key={`${link.href}-${link.label}`} href={link.href} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${cls}`}>
                {icon} {link.label}
              </Link>
            )
          })}
        </div>
      ) : null}

      {response.cards?.length ? (
        <div className="grid gap-2">
          {response.cards.map((card) => {
            const content = (
              <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs hover:border-bbt-accent/50 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center gap-1.5 font-semibold text-bbt-primary dark:text-white">
                  <Hotel className="w-3 h-3 text-bbt-accent" /> {card.title}
                </div>
                {card.subtitle && <div className="mt-0.5 text-slate-600 dark:text-slate-300">{card.subtitle}</div>}
                {card.meta && <div className="mt-0.5 text-[11px] text-slate-500">{card.meta}</div>}
              </div>
            )
            if (!card.href) return <div key={`${card.title}-${card.subtitle}`}>{content}</div>
            if (/^https?:\/\//i.test(card.href)) {
              return (
                <a key={`${card.title}-${card.href}`} href={card.href} target="_blank" rel="noreferrer">
                  {content}
                </a>
              )
            }
            return (
              <Link key={`${card.title}-${card.href}`} href={card.href}>
                {content}
              </Link>
            )
          })}
        </div>
      ) : null}

      {response.sources?.length ? (
        <div className="text-[11px] text-slate-500">
          Fontes:{' '}
          {response.sources.slice(0, 3).map((source, index) => (
            <span key={`${source.uri}-${index}`}>
              {index > 0 ? ' | ' : ''}
              {source.uri ? (
                <a href={source.uri} target="_blank" rel="noreferrer" className="text-bbt-accent underline">
                  {source.title || source.uri}
                </a>
              ) : (
                source.title
              )}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

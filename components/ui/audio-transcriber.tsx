'use client'
/**
 * V9: Transcrição de áudio
 *
 * Modo 1: Gravação ao vivo (microfone) — Web Speech API (Chrome/Edge)
 *   - Funciona offline depois do primeiro uso
 *   - Suporta português brasileiro
 *
 * Modo 2: Upload de arquivo de áudio do WhatsApp (.opus, .mp3, .m4a, .ogg, .wav)
 *   - Toca o áudio enquanto a Web Speech "escuta" o player
 *   - Se o navegador não suportar bem, mostra player + área de transcrição manual
 *
 * Limitações:
 * - Web Speech API requer Chrome ou Edge (não funciona no Firefox)
 * - Áudios mp4/m4a longos podem ter qualidade reduzida
 * - Pra transcrição offline 100% confiável seria necessário Whisper (modelo de 100MB+)
 */
import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, Upload, Loader2, Trash2, ChevronDown, ChevronUp, FileAudio, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { IAParserResult } from '@/lib/ia-parser'
import { arquivoParaBase64 } from '@/lib/demand-file-parser'
import { reportClientFailure } from '@/lib/client-observability'

interface Props {
  onTranscricao: (texto: string) => void
  onResultadoIA?: (resultado: IAParserResult & { transcricao?: string }, transcricao?: string) => void
}

type Modo = 'mic' | 'arquivo' | null

export function AudioTranscriber({ onTranscricao, onResultadoIA }: Props) {
  const [aberto, setAberto] = useState(false)
  const [modo, setModo] = useState<Modo>(null)
  const [gravando, setGravando] = useState(false)
  const [tocando, setTocando] = useState(false)
  const [textoAcumulado, setTextoAcumulado] = useState('')
  const [textoInterino, setTextoInterino] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [arquivoUrl, setArquivoUrl] = useState<string | null>(null)
  const [suportaMicrofone, setSuportaMicrofone] = useState(true)
  const [processandoIA, setProcessandoIA] = useState(false)

  const recogRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const gravandoRef = useRef(false)

  useEffect(() => {
    // Verifica suporte do navegador
    const SR = (typeof window !== 'undefined') && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    setSuportaMicrofone(!!SR)
    return () => {
      if (recogRef.current) {
        try { recogRef.current.stop() } catch (error) {
          reportClientFailure('speech_recognition_stop_failed', error, { component: 'audio-transcriber' })
        }
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (arquivoUrl) URL.revokeObjectURL(arquivoUrl)
    }
  }, [arquivoUrl])

  function criarRecog() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return null
    const r = new SR()
    r.lang = 'pt-BR'
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = 1
    r.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const trans = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          setTextoAcumulado((prev) => (prev + ' ' + trans).trim())
        } else {
          interim += trans
        }
      }
      setTextoInterino(interim)
    }
    r.onerror = (e: any) => {
      console.warn('Erro reconhecimento:', e.error)
      if (e.error === 'no-speech') {
        // Sem fala detectada, ok
        return
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Acesso ao microfone bloqueado. Libera nas configurações do navegador.')
        gravandoRef.current = false
        setGravando(false)
      }
    }
    r.onend = () => {
      // Se ainda gravando, reinicia (workaround do Chrome que para sozinho)
      if (gravandoRef.current) {
        try { r.start() } catch (error) {
          reportClientFailure('speech_recognition_restart_failed', error, { component: 'audio-transcriber' })
        }
      }
    }
    return r
  }

  async function iniciarGravacaoMic() {
    if (!suportaMicrofone) {
      toast.error('Seu navegador não suporta gravação por voz. Use Chrome ou Edge.')
      return
    }
    try {
      // Pede permissão do mic explicitamente primeiro
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
    } catch {
      toast.error('Permissão de microfone negada')
      return
    }
    setModo('mic')
    gravandoRef.current = true
    setGravando(true)
    setTextoAcumulado('')
    setTextoInterino('')
    const r = criarRecog()
    if (!r) {
      gravandoRef.current = false
      setGravando(false)
      return
    }
    recogRef.current = r
    try { r.start() } catch (e) { console.warn(e) }
  }

  function pararGravacao() {
    gravandoRef.current = false
    setGravando(false)
    if (recogRef.current) {
      try { recogRef.current.stop() } catch (error) {
        reportClientFailure('speech_recognition_stop_failed', error, { component: 'audio-transcriber' })
      }
    }
  }

  function enviarTexto() {
    const t = (textoAcumulado + ' ' + textoInterino).trim()
    if (!t) {
      toast.error('Nada foi transcrito ainda')
      return
    }
    onTranscricao(t)
    toast.success('Texto enviado pra Caixa de Entrada!')
    resetar()
  }

  async function extrairArquivoComIA() {
    if (!arquivo) {
      toast.error('Selecione um arquivo de áudio primeiro.')
      return
    }

    setProcessandoIA(true)
    try {
      const base64 = await arquivoParaBase64(arquivo)
      const r = await fetch('/api/ia/extract-demand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'audio',
          fileName: arquivo.name,
          mimeType: arquivo.type || 'audio/mpeg',
          base64,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.hint || data?.error || `HTTP ${r.status}`)

      const transcricao = String(data.transcricao || data.ia_resumo || '').trim()
      if (transcricao) {
        setTextoAcumulado(transcricao)
        setTextoInterino('')
        onTranscricao(transcricao)
      }
      onResultadoIA?.(data, transcricao)
      toast.success('IA leu o áudio e extraiu a demanda.')
    } catch (e: any) {
      toast.error(e.message || 'Não consegui extrair esse áudio com IA.')
    } finally {
      setProcessandoIA(false)
    }
  }

  function resetar() {
    pararGravacao()
    setTextoAcumulado('')
    setTextoInterino('')
    setArquivo(null)
    setArquivoUrl(null)
    setModo(null)
    setTocando(false)
  }

  function onArquivoSelecionado(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('audio/') && !f.name.match(/\.(opus|mp3|m4a|ogg|wav|aac)$/i)) {
      toast.error('Selecione um arquivo de áudio (.mp3, .ogg, .opus, .m4a, .wav)')
      return
    }
    setArquivo(f)
    const url = URL.createObjectURL(f)
    setArquivoUrl(url)
    setModo('arquivo')
    setTextoAcumulado('')
    setTextoInterino('')
  }

  /**
   * Transcrição de arquivo de áudio:
   * Não dá pra fazer 100% automaticamente no navegador local sem chamar uma API externa.
   * Estratégia: o agente toca o áudio (via player) ENQUANTO ativa o reconhecimento de voz
   * apontado pra "saída de áudio" do sistema. Como isso só funciona se o agente colocar o
   * áudio bem alto perto do mic, preferimos disponibilizar um campo manual onde ele cola
   * o que conseguiu ouvir, ou edita o que a transcrição automática captou.
   */

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        className="bbt-button-ghost text-sm flex items-center gap-2 text-bbt-accent">
        <Mic className="w-4 h-4" /> 🎤 Lançar demanda por áudio
        <ChevronDown className="w-3 h-3" />
      </button>
    )
  }

  return (
    <div className="bbt-card p-4 border-2 border-bbt-accent/30 bg-bbt-accent/5 dark:bg-bbt-accent/10 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Mic className="w-4 h-4 text-bbt-accent" />
          Transcrição de Áudio
        </h3>
        <button onClick={() => { setAberto(false); resetar() }}
          className="text-xs text-slate-500 hover:text-bbt-primary flex items-center gap-1">
          Fechar <ChevronUp className="w-3 h-3" />
        </button>
      </div>

      {!suportaMicrofone && (
        <div className="text-xs p-2 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div>
            Seu navegador não suporta reconhecimento de voz. <strong>Use Chrome ou Edge</strong> pra essa função funcionar.
          </div>
        </div>
      )}

      {/* Escolha de modo */}
      {modo === null && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={iniciarGravacaoMic} disabled={!suportaMicrofone}
            className="bbt-button-primary flex flex-col items-center gap-1 py-3 disabled:opacity-50">
            <Mic className="w-5 h-5" />
            <span className="text-xs font-semibold">Gravar pelo microfone</span>
            <span className="text-[10px] opacity-80">Fale e o sistema escreve</span>
          </button>
          <label className="bbt-button-ghost flex flex-col items-center gap-1 py-3 cursor-pointer border-2 border-dashed border-bbt-accent/40 hover:border-bbt-accent">
            <Upload className="w-5 h-5" />
            <span className="text-xs font-semibold">Importar áudio do WhatsApp</span>
            <span className="text-[10px] opacity-80">.mp3, .ogg, .opus, .m4a</span>
            <input type="file" accept="audio/*,.opus,.ogg,.m4a,.mp3,.wav" onChange={onArquivoSelecionado} className="hidden" />
          </label>
        </div>
      )}

      {/* Modo: Gravação por microfone */}
      {modo === 'mic' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-white dark:bg-slate-800 border border-bbt-gray-100 dark:border-slate-700">
            {gravando ? (
              <>
                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-semibold text-red-600">GRAVANDO — fale agora</span>
                <button onClick={pararGravacao} className="ml-auto bbt-button-ghost text-xs flex items-center gap-1">
                  <MicOff className="w-3 h-3" /> Parar
                </button>
              </>
            ) : (
              <>
                <MicOff className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">Gravação parada</span>
                <button onClick={iniciarGravacaoMic} className="ml-auto bbt-button-primary text-xs flex items-center gap-1">
                  <Mic className="w-3 h-3" /> Continuar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modo: Arquivo de áudio */}
      {modo === 'arquivo' && arquivo && arquivoUrl && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-bbt-gray-100 dark:border-slate-700 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <FileAudio className="w-4 h-4 text-bbt-accent shrink-0" />
              <span className="truncate flex-1">{arquivo.name}</span>
              <span className="text-slate-500">{(arquivo.size / 1024).toFixed(0)} KB</span>
            </div>
            <audio ref={audioRef} src={arquivoUrl} controls className="w-full"
              onPlay={async () => {
                setTocando(true)
                // Tenta iniciar reconhecimento simultaneamente
                if (suportaMicrofone) {
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                    stream.getTracks().forEach((track) => track.stop())
                    const r = criarRecog()
                    if (r) {
                      recogRef.current = r
                      gravandoRef.current = true
                      setGravando(true)
                      try { r.start() } catch (error) {
                        reportClientFailure('speech_recognition_start_failed', error, { component: 'audio-transcriber' })
                      }
                    }
                  } catch (error) {
                    reportClientFailure('speech_recognition_resume_failed', error, { component: 'audio-transcriber' })
                  }
                }
              }}
              onPause={() => { setTocando(false); pararGravacao() }}
              onEnded={() => { setTocando(false); pararGravacao() }}
            />
            <button
              type="button"
              onClick={extrairArquivoComIA}
              disabled={processandoIA}
              className="w-full bbt-button-primary text-xs flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {processandoIA ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Lendo audio com IA premium...
                </>
              ) : (
                <>
                  <FileAudio className="w-3.5 h-3.5" /> Extrair demanda deste áudio com IA
                </>
              )}
            </button>
            <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded p-2 flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <div>
                <strong>Como funciona:</strong> aperta play e <strong>aumenta o som perto do microfone</strong>.
                O sistema escuta e transcreve. Funciona melhor em ambiente silencioso.
                Se a transcrição não ficar boa, edita o texto abaixo manualmente.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Texto transcrito (editável) */}
      {(modo !== null) && (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Texto transcrito {textoInterino && <span className="text-bbt-accent normal-case">· capturando...</span>}
          </label>
          <textarea
            value={textoAcumulado + (textoInterino ? ' ' + textoInterino : '')}
            onChange={(e) => { setTextoAcumulado(e.target.value); setTextoInterino('') }}
            placeholder={modo === 'mic'
              ? 'Aperta gravar e fala. O texto aparece aqui...'
              : 'Toca o áudio com som alto perto do mic. Você também pode digitar manualmente.'}
            rows={4}
            className="bbt-input text-sm"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={resetar} className="bbt-button-ghost text-xs flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Limpar
            </button>
            <button onClick={enviarTexto} disabled={!(textoAcumulado || textoInterino).trim()}
              className="bbt-button-primary text-xs disabled:opacity-50">
              Usar este texto
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

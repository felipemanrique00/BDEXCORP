import { ASSISTANT_KEYS, appendAssistantList, createId } from '@/lib/assistant/storage'
import { getAssistantSettings } from '@/lib/assistant/settings'
import { transcribeAudioWithOpenAI } from '@/lib/server-ai'
import type { AudioGenerationLog, AudioTranscriptionLog, AssistantChannel, AssistantVoiceSetting } from '@/lib/assistant/types'

export const MAX_ASSISTANT_AUDIO_BYTES = 25 * 1024 * 1024
const MAX_ASSISTANT_AUDIO_BASE64_LENGTH = Math.ceil(MAX_ASSISTANT_AUDIO_BYTES * 4 / 3) + 16

export async function transcribeAssistantAudio(input: {
  base64?: string
  fileName?: string
  mimeType?: string
  textFallback?: string
  channel: AssistantChannel
}): Promise<{ transcript: string; log: AudioTranscriptionLog }> {
  assertAudioInputSize(input.base64, input.textFallback)
  const settings = await getAssistantSettings()
  const provider = settings.voice.transcriptionProvider

  if (input.base64) {
    if (process.env.OPENAI_API_KEY && provider === 'openai') {
      try {
        const transcript = await transcribeAudioWithOpenAI({
          base64: input.base64,
          fileName: input.fileName,
          mimeType: input.mimeType,
          prompt: 'Audio de comando operacional BBT em portugues do Brasil.',
        })
        const log: AudioTranscriptionLog = {
          id: createId('stt'),
          provider: 'openai',
          status: 'success',
          language: settings.voice.language,
          source: input.channel,
          fileName: input.fileName,
          transcript,
          createdAt: new Date().toISOString(),
        }
        await appendAssistantList(ASSISTANT_KEYS.audioTranscriptions, log, 500)
        return { transcript, log }
      } catch (error: any) {
        const log: AudioTranscriptionLog = {
          id: createId('stt'),
          provider: 'openai',
          status: 'failed',
          language: settings.voice.language,
          source: input.channel,
          fileName: input.fileName,
          error: error?.message || 'Falha ao transcrever audio.',
          createdAt: new Date().toISOString(),
        }
        await appendAssistantList(ASSISTANT_KEYS.audioTranscriptions, log, 500)
        throw error
      }
    }

    const message = 'Nao consegui ler o audio porque o provedor de transcricao nao esta configurado no servidor.'
    const log: AudioTranscriptionLog = {
      id: createId('stt'),
      provider,
      status: 'failed',
      language: settings.voice.language,
      source: input.channel,
      fileName: input.fileName,
      error: message,
      createdAt: new Date().toISOString(),
    }
    await appendAssistantList(ASSISTANT_KEYS.audioTranscriptions, log, 500)
    throw new Error(message)
  }

  const transcript = input.textFallback?.trim()
  if (!transcript) throw new Error('Audio ou transcricao obrigatoria.')
  const log: AudioTranscriptionLog = {
    id: createId('stt'),
    provider: 'provided-transcript',
    status: 'success',
    language: settings.voice.language,
    source: input.channel,
    fileName: input.fileName,
    transcript,
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.audioTranscriptions, log, 500)
  return { transcript, log }
}

export async function generateAssistantAudio(input: { text: string }): Promise<{
  text: string
  audioBase64?: string
  audioUrl?: string
  mimeType?: string
  log: AudioGenerationLog
}> {
  const settings = await getAssistantSettings()
  const provider = settings.voice.voiceProvider
  const format = normalizeSpeechFormat(settings.voice.audioFormat)
  const openAIVoice = selectOpenAIVoice(settings.voice, process.env.OPENAI_TTS_VOICE)

  if (process.env.OPENAI_API_KEY && provider === 'openai' && settings.voice.textToSpeechEnabled) {
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
          voice: openAIVoice,
          input: input.text.replace(/\s+/g, ' ').slice(0, 4000),
          response_format: format,
          speed: clampSpeechSpeed(settings.voice.speed),
        }),
      })

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail?.error?.message || 'Falha ao gerar audio.')
      }

      const bytes = Buffer.from(await response.arrayBuffer())
      const mimeType = format === 'mp3' ? 'audio/mpeg' : format === 'wav' ? 'audio/wav' : 'audio/ogg'
      const log: AudioGenerationLog = {
        id: createId('tts'),
        provider: 'openai',
        status: 'success',
        voice: openAIVoice,
        format,
        textPreview: input.text.slice(0, 180),
        createdAt: new Date().toISOString(),
      }
      await appendAssistantList(ASSISTANT_KEYS.audioGenerations, log, 500)
      return { text: input.text, audioBase64: bytes.toString('base64'), mimeType, log }
    } catch (error: any) {
      const log: AudioGenerationLog = {
        id: createId('tts'),
        provider: 'openai',
        status: 'failed',
        voice: openAIVoice,
        format,
        textPreview: input.text.slice(0, 180),
        error: error?.message || 'Falha ao gerar audio.',
        createdAt: new Date().toISOString(),
      }
      await appendAssistantList(ASSISTANT_KEYS.audioGenerations, log, 500)
      throw error
    }
  }

  const message = provider === 'openai'
    ? 'Geracao de audio real exige OPENAI_API_KEY configurada no servidor.'
    : `O provedor de audio "${provider}" nao possui integracao ativa no servidor.`
  const log: AudioGenerationLog = {
    id: createId('tts'),
    provider,
    status: 'failed',
    voice: settings.voice.voice,
    format: settings.voice.audioFormat,
    textPreview: input.text.slice(0, 180),
    error: message,
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.audioGenerations, log, 500)
  throw new Error(message)
}

function assertAudioInputSize(base64?: string, textFallback?: string): void {
  const encoded = String(base64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '')
  if (encoded.length > MAX_ASSISTANT_AUDIO_BASE64_LENGTH) {
    throw Object.assign(new Error('Audio grande demais. Use arquivo de ate 25 MB.'), { status: 413 })
  }
  if (String(textFallback || '').length > 20_000) {
    throw Object.assign(new Error('Transcricao de apoio excede o limite permitido.'), { status: 413 })
  }
}

function normalizeSpeechFormat(format: string): 'mp3' | 'opus' | 'wav' {
  if (format === 'mp3' || format === 'wav') return format
  return 'opus'
}

function selectOpenAIVoice(settings: AssistantVoiceSetting, override?: string): string {
  const explicit = normalizeOpenAIVoice(override || settings.voice)
  if (explicit) return explicit
  if (settings.voiceGender === 'male') return 'onyx'
  if (settings.voiceGender === 'neutral') return 'alloy'
  return 'nova'
}

function normalizeOpenAIVoice(voice: string): string | null {
  const clean = String(voice || '').trim().toLowerCase()
  const allowed = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'])
  return allowed.has(clean) ? clean : null
}

function clampSpeechSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  return Math.min(4, Math.max(0.25, speed))
}
import 'server-only'

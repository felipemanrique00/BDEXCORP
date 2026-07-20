import { parseMensagem } from '@/lib/mensagem-parser'

export type PaidAIProvider = 'openai' | 'gemini' | 'local'

export const OPENAI_MAIN_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2'
export const OPENAI_PRO_MODEL = process.env.OPENAI_PRO_MODEL || 'gpt-5.2-pro'
export const OPENAI_SEARCH_MODEL = process.env.OPENAI_SEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-5.2'
export const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe'
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

export function normalizeMaxOutputTokens(value: unknown, fallback: number, maximum = 8_000): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(maximum, Math.max(128, Math.floor(parsed)))
}

export interface PaidAIStatus {
  provedor: PaidAIProvider
  modelo: string
  modelo_pro?: string
  aceita_imagem: boolean
  aceita_audio: boolean
  busca_web: boolean
  roteamento: {
    cerebro: 'openai' | 'local'
    busca_hoteis: 'gemini' | 'openai' | 'local'
    audio: 'openai' | 'gemini' | 'local'
  }
}

export function getPaidAIStatus(): PaidAIStatus {
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY)
  const hasGemini = Boolean(process.env.GEMINI_API_KEY)
  const preferGeminiSearch = process.env.AI_HOTEL_PROVIDER === 'gemini' && hasGemini

  if (hasOpenAI) {
    return {
      provedor: 'openai',
      modelo: OPENAI_MAIN_MODEL,
      modelo_pro: OPENAI_PRO_MODEL,
      aceita_imagem: true,
      aceita_audio: true,
      busca_web: true,
      roteamento: {
        cerebro: 'openai',
        busca_hoteis: preferGeminiSearch ? 'gemini' : 'openai',
        audio: 'openai',
      },
    }
  }

  if (hasGemini) {
    return {
      provedor: 'gemini',
      modelo: GEMINI_MODEL,
      aceita_imagem: true,
      aceita_audio: true,
      busca_web: true,
      roteamento: {
        cerebro: 'local',
        busca_hoteis: 'gemini',
        audio: 'gemini',
      },
    }
  }

  return {
    provedor: 'local',
    modelo: 'regras-locais',
    aceita_imagem: false,
    aceita_audio: false,
    busca_web: false,
    roteamento: {
      cerebro: 'local',
      busca_hoteis: 'local',
      audio: 'local',
    },
  }
}

export async function callOpenAIResponses(params: {
  system?: string
  messages?: Array<{ role: 'user' | 'assistant'; content: any }>
  input?: any
  enableSearch?: boolean
  model?: string
  maxOutputTokens?: number
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh'
  verbosity?: 'low' | 'medium' | 'high'
  textFormat?: any
  include?: string[]
  searchLocation?: {
    country?: string
    city?: string
    region?: string
    timezone?: string
  }
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    const error: any = new Error('OPENAI_API_KEY_NECESSARIA')
    error.status = 503
    throw error
  }

  const input =
    params.input ||
    (params.messages || []).map((m) => ({
      role: m.role,
      content: contentToOpenAIContent(m.content, m.role),
    }))

  const payload: any = {
    model: params.model || OPENAI_MAIN_MODEL,
    input,
    max_output_tokens: normalizeMaxOutputTokens(params.maxOutputTokens, 2000),
    reasoning: { effort: params.reasoningEffort || 'low' },
    text: params.textFormat
      ? { verbosity: params.verbosity || 'medium', format: params.textFormat }
      : { verbosity: params.verbosity || 'medium' },
  }

  if (params.system) payload.instructions = params.system
  if (params.include?.length) payload.include = params.include
  if (params.enableSearch) {
    const location = {
      country: params.searchLocation?.country || 'BR',
      city: params.searchLocation?.city || 'Trindade',
      region: params.searchLocation?.region || 'Goias',
      timezone: params.searchLocation?.timezone || 'America/Sao_Paulo',
    }
    payload.tools = [
      {
        type: 'web_search',
        external_web_access: true,
        user_location: {
          type: 'approximate',
          ...location,
        },
      },
    ]
    payload.tool_choice = 'auto'
    payload.include = Array.from(new Set([...(payload.include || []), 'web_search_call.action.sources']))
  }

  const callResponses = async (body: any) => {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
    const json = await response.json().catch(() => ({}))
    return { response, json }
  }

  let { response: r, json: data } = await callResponses(payload)
  if (!r.ok && params.enableSearch && /web_search/i.test(JSON.stringify(data))) {
    const retryPayload = {
      ...payload,
      tools: payload.tools?.map((tool: any) => (tool.type === 'web_search' ? { ...tool, type: 'web_search_preview' } : tool)),
    }
    ;({ response: r, json: data } = await callResponses(retryPayload))
  }
  if (!r.ok) {
    const error: any = new Error(data?.error?.message || 'Erro OpenAI')
    error.status = r.status
    error.detail = data
    throw error
  }

  const text = extractOpenAIText(data)
  return {
    provedor: 'openai' as const,
    model: data.model || payload.model,
    content: [{ type: 'text', text }],
    output_text: text,
    sources: extractOpenAISources(data),
    usage: data.usage,
    raw: data,
  }
}

export async function transcribeAudioWithOpenAI(params: {
  base64: string
  fileName?: string
  mimeType?: string
  prompt?: string
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    const error: any = new Error('OPENAI_API_KEY_NECESSARIA')
    error.status = 503
    throw error
  }

  const bytes = Uint8Array.from(Buffer.from(params.base64, 'base64'))
  const blob = new Blob([bytes], { type: params.mimeType || 'audio/mpeg' })
  const form = new FormData()
  form.append('file', blob, params.fileName || 'audio.mp3')
  form.append('model', OPENAI_TRANSCRIBE_MODEL)
  form.append('language', 'pt')
  form.append('response_format', 'json')
  if (params.prompt) form.append('prompt', params.prompt)

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const error: any = new Error(data?.error?.message || 'Erro ao transcrever audio')
    error.status = r.status
    error.detail = data
    throw error
  }
  return String(data.text || '').trim()
}

export async function callGemini(params: {
  system?: string
  messages?: Array<{ role: 'user' | 'assistant'; content: any }>
  parts?: any[]
  enableSearch?: boolean
  model?: string
  maxOutputTokens?: number
}) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    const error: any = new Error('GEMINI_API_KEY_NECESSARIA')
    error.status = 503
    throw error
  }

  const contents = params.parts
    ? [{ role: 'user', parts: params.parts }]
    : (params.messages || []).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: contentToGeminiParts(m.content),
      }))

  const payload: any = {
    contents,
    generationConfig: {
      maxOutputTokens: normalizeMaxOutputTokens(params.maxOutputTokens, 1800),
      temperature: 0.2,
    },
  }
  if (params.system) payload.systemInstruction = { parts: [{ text: params.system }] }
  if (params.enableSearch) payload.tools = [{ google_search: {} }]

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${params.model || GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    },
  )

  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const error: any = new Error(data?.error?.message || 'Erro Gemini')
    error.status = r.status
    error.detail = data
    throw error
  }

  const candidate = data?.candidates?.[0]
  const text =
    candidate?.content?.parts
      ?.map((part: any) => part?.text)
      .filter(Boolean)
      .join('\n') || ''

  return {
    provedor: 'gemini' as const,
    model: params.model || GEMINI_MODEL,
    content: [{ type: 'text', text }],
    grounding: candidate?.groundingMetadata,
    sources:
      candidate?.groundingMetadata?.groundingChunks
        ?.map((chunk: any) => chunk?.web)
        ?.filter(Boolean)
        ?.map((web: any) => ({ title: web.title, uri: web.uri })) || [],
    usage: data.usageMetadata,
    raw: data,
  }
}

export function localExtraction(text: string) {
  const parsed = parseMensagem(text)
  return {
    ...parsed,
    transcricao: text,
    ia_usado: false,
    ia_indisponivel: true,
    provedor: 'local' as const,
    ia_resumo: parsed.observacoes || 'Extraido com parser local porque a IA principal nao esta configurada.',
  }
}

export function contentToOpenAIContent(content: any, role: 'user' | 'assistant' = 'user'): any[] {
  const textType = role === 'assistant' ? 'output_text' : 'input_text'
  if (!Array.isArray(content)) return [{ type: textType, text: String(content || '') }]
  const parts = content
    .map((block: any) => {
      if (block?.type === 'text') return { type: textType, text: String(block.text || '') }
      if (role === 'assistant') {
        return block?.text || block?.content ? { type: 'output_text', text: String(block.text || block.content || '') } : null
      }
      if (block?.type === 'image' && block?.source?.type === 'base64') {
        return {
          type: 'input_image',
          image_url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}`,
        }
      }
      return null
    })
    .filter(Boolean)
  return parts.length ? parts : [{ type: textType, text: '[mensagem sem texto]' }]
}

export function contentToGeminiParts(content: any): any[] {
  if (!Array.isArray(content)) return [{ text: String(content || '') }]
  const parts = content
    .map((block: any) => {
      if (block?.type === 'text') return { text: String(block.text || '') }
      if (block?.type === 'image' && block?.source?.type === 'base64') {
        return {
          inline_data: {
            mime_type: block.source.media_type || 'image/png',
            data: block.source.data,
          },
        }
      }
      if ((block?.type === 'audio' || block?.type === 'file') && block?.source?.type === 'base64') {
        return {
          inline_data: {
            mime_type: block.source.media_type || 'audio/mpeg',
            data: block.source.data,
          },
        }
      }
      return null
    })
    .filter(Boolean)
  return parts.length ? parts : [{ text: '[mensagem sem texto]' }]
}

export function extractJSON(text: string): string {
  const clean = text.replace(/```json|```/g, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) return clean.slice(start, end + 1)
  return clean
}

function extractOpenAIText(data: any): string {
  if (data?.output_text) return String(data.output_text)
  const chunks: string[] = []
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) chunks.push(content.text)
      if (content?.type === 'text' && content?.text) chunks.push(content.text)
    }
  }
  return chunks.join('\n')
}

function extractOpenAISources(data: any): Array<{ title?: string; uri?: string }> {
  const sources: Array<{ title?: string; uri?: string }> = []
  for (const source of data?.sources || []) {
    if (source?.url || source?.uri) sources.push({ title: source.title, uri: source.url || source.uri })
  }
  for (const item of data?.output || []) {
    if (item?.type === 'web_search_call') {
      for (const source of item?.action?.sources || []) {
        if (source?.url || source?.uri) sources.push({ title: source.title, uri: source.url || source.uri })
      }
    }
    for (const content of item?.content || []) {
      for (const ann of content?.annotations || []) {
        if (ann?.type === 'url_citation') sources.push({ title: ann.title, uri: ann.url })
      }
    }
  }
  return Array.from(new Map(sources.filter((s) => s.uri).map((s) => [s.uri, s])).values())
}

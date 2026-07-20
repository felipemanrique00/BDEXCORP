import { todayISODate } from '@/lib/date'
import { NextRequest, NextResponse } from 'next/server'
import { callGemini, callOpenAIResponses, OPENAI_SEARCH_MODEL } from '@/lib/server-ai'
import { classifyAIError } from '@/lib/ai-friendly-errors'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SEARCH_JSON_SCHEMA = {
  type: 'json_schema',
  name: 'bbt_realtime_search',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'answer', 'confidence', 'action_items'],
    properties: {
      summary: { type: 'string' },
      answer: { type: 'string' },
      confidence: { type: 'string', enum: ['alta', 'media', 'baixa'] },
      action_items: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    },
  },
}

export async function POST(req: NextRequest) {
  const guard = guardApiRequest(req, {
    requireAuth: true,
    rateLimit: { key: 'ia-search:post', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<{ query?: string; location?: string; deep?: boolean }>(req, 64 * 1024)
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: input.status })
  const body = input.body

  const query = String(body.query || '').trim()
  if (query.length < 3) {
    return NextResponse.json({ error: 'Informe uma pesquisa com pelo menos 3 caracteres.' }, { status: 400 })
  }
  if (query.length > 4_000 || String(body.location || '').length > 200) {
    return NextResponse.json({ error: 'Pesquisa grande demais.' }, { status: 413 })
  }

  const location = parseLocation(body.location || query)
  const prompt = buildPrompt(query, body.location)
  const errors: string[] = []

  if (process.env.OPENAI_API_KEY) {
    try {
      const data = await callOpenAIResponses({
        model: OPENAI_SEARCH_MODEL,
        system:
          'Voce e o pesquisador em tempo real da BBT Viagens Corporativas. Use busca web quando necessario, cite fontes e nao invente telefone, preco, disponibilidade ou regra.',
        messages: [{ role: 'user', content: prompt }],
        enableSearch: true,
        maxOutputTokens: body.deep ? 5000 : 2800,
        reasoningEffort: body.deep ? 'medium' : 'low',
        verbosity: 'medium',
        textFormat: SEARCH_JSON_SCHEMA,
        searchLocation: location,
      })
      const parsed = parseJSON(data.output_text || '')
      return NextResponse.json({
        source: 'openai-web',
        query,
        answer: parsed.answer || data.output_text || '',
        summary: parsed.summary || 'Pesquisa web concluida.',
        confidence: parsed.confidence || 'media',
        action_items: parsed.action_items || [],
        sources: data.sources || [],
      })
    } catch (e: any) {
      errors.push(`OpenAI: ${classifyAIError(e, 'openai').kind}`)
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const data = await callGemini({
        system:
          'Voce e o pesquisador em tempo real da BBT Viagens Corporativas. Use Google Search, cite fontes e nao invente telefone, preco, disponibilidade ou regra.',
        messages: [{ role: 'user', content: prompt }],
        enableSearch: true,
        maxOutputTokens: body.deep ? 5000 : 2800,
      })
      const parsed = parseJSON(data.content?.[0]?.text || '')
      return NextResponse.json({
        source: 'gemini-google',
        query,
        answer: parsed.answer || data.content?.[0]?.text || '',
        summary: parsed.summary || 'Pesquisa Google concluida.',
        confidence: parsed.confidence || 'media',
        action_items: parsed.action_items || [],
        sources: data.sources || [],
      })
    } catch (e: any) {
      errors.push(`Gemini: ${classifyAIError(e, 'gemini').kind}`)
    }
  }

  const google = `https://www.google.com/search?q=${encodeURIComponent(query)}`
  return NextResponse.json({
    source: 'fallback-link',
    query,
    answer:
      'Nao consegui executar uma busca web por API agora. Deixei um link direto para conferencia manual antes de cadastrar telefone, tarifa ou disponibilidade.',
    summary: 'Busca por API indisponivel.',
    confidence: 'baixa',
    action_items: ['Abrir a fonte manualmente antes de cadastrar telefone, tarifa ou disponibilidade.'],
    sources: [{ title: 'Abrir pesquisa no Google', uri: google }],
    provider_error: errors.join(' | ') || 'Nenhum provedor de IA configurado.',
  })
}

function buildPrompt(query: string, location?: string): string {
  return `Pesquisa solicitada:
${query}

Localidade de referencia: ${location || 'Brasil'}
Data atual: ${todayISODate()}

Retorne APENAS JSON valido:
{
  "summary": "1 frase executiva",
  "answer": "resposta objetiva com os achados e ressalvas operacionais",
  "confidence": "alta|media|baixa",
  "action_items": ["proximas acoes praticas"]
}

Regras:
- Use dados atuais da web quando a pergunta depender de informacao em tempo real.
- Se for hotel/fornecedor, priorize site oficial, telefone oficial e fontes confiaveis.
- Nao invente telefone, tarifa, disponibilidade, endereco ou politica.
- Se nao encontrar confirmacao confiavel, diga exatamente o que falta confirmar.`
}

function parseJSON(text: string): any {
  try {
    return JSON.parse(extractJSON(text))
  } catch {
    return { answer: text, summary: 'Resposta textual da IA.', confidence: 'media', action_items: [] }
  }
}

function extractJSON(text: string): string {
  const clean = String(text || '').replace(/```json|```/g, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) return clean.slice(start, end + 1)
  return clean
}

function parseLocation(input: string): { country: string; city?: string; region?: string; timezone: string } {
  const raw = String(input || '')
  const uf = raw.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i)?.[1]?.toUpperCase()
  const city =
    raw.match(/(?:em|para|cidade de|hospedagem em)\s+([\p{L}\s]+?)(?:[-/,]\s*[A-Z]{2}\b|$)/iu)?.[1]?.trim() ||
    undefined
  return {
    country: 'BR',
    city: city || 'Trindade',
    region: uf || 'GO',
    timezone: 'America/Sao_Paulo',
  }
}

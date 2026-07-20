import { NextRequest, NextResponse } from 'next/server'
import type { HotelAISuggestion } from '@/lib/ia-hotel-search'
import { callOpenAIResponses } from '@/lib/server-ai'
import { guardApiRequest } from '@/lib/security/api-guard'
import { classifyAIError } from '@/lib/ai-friendly-errors'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const HOTEL_SEARCH_JSON_SCHEMA = {
  type: 'json_schema',
  name: 'bbt_hotel_search',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'hotels'],
    properties: {
      summary: { type: 'string' },
      hotels: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'nome',
            'cidade',
            'uf',
            'telefone',
            'endereco',
            'site',
            'categoria',
            'tarifa_sgl',
            'tarifa_dbl',
            'tarifa_tpl',
            'cafe_manha',
            'estacionamento',
            'faturado',
            'formas_pagamento',
            'observacoes',
            'confianca',
            'fonte_url',
            'fonte_titulo',
          ],
          properties: {
            nome: { type: 'string' },
            cidade: { type: 'string' },
            uf: { type: 'string' },
            telefone: { type: ['string', 'null'] },
            endereco: { type: ['string', 'null'] },
            site: { type: ['string', 'null'] },
            categoria: { type: ['string', 'null'], enum: ['1', '2', '3', '4', '5', null] },
            tarifa_sgl: { type: ['number', 'null'] },
            tarifa_dbl: { type: ['number', 'null'] },
            tarifa_tpl: { type: ['number', 'null'] },
            cafe_manha: { type: ['string', 'null'] },
            estacionamento: { type: ['string', 'null'] },
            faturado: { type: 'boolean' },
            formas_pagamento: { type: 'array', items: { type: 'string' } },
            observacoes: { type: ['string', 'null'] },
            confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
            fonte_url: { type: ['string', 'null'] },
            fonte_titulo: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
}

export async function POST(req: NextRequest) {
  const guard = guardApiRequest(req, {
    requireAuth: true,
    rateLimit: { key: 'ia-hotel-search', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<{
    query?: string
    cidade?: string
    uf?: string
    knownHotels?: Array<{ nome: string; cidade: string; uf: string }>
  }>(req, 256 * 1024)
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: input.status })
  const body = input.body

  const query = (body.query || '').trim()
  const cidade = (body.cidade || extrairCidade(query) || '').trim()
  const uf = (body.uf || extrairUF(query) || '').trim().toUpperCase()

  if (!query && !cidade) {
    return NextResponse.json({ error: 'Informe uma cidade, UF ou nome de hotel.' }, { status: 400 })
  }

  const geminiKey = process.env.GEMINI_API_KEY
  const openAIKey = process.env.OPENAI_API_KEY
  const preferGemini = process.env.AI_HOTEL_PROVIDER === 'gemini'

  if (openAIKey && !preferGemini) {
    return buscarHoteisComOpenAI({ query, cidade, uf, knownHotels: body.knownHotels || [] })
  }

  if (!geminiKey) {
    if (openAIKey) {
      return buscarHoteisComOpenAI({ query, cidade, uf, knownHotels: body.knownHotels || [] })
    }
    const suggestions = fallbackHotels(cidade || query, uf)
    return NextResponse.json({
      source: 'local-fallback',
      query: query || `${cidade}-${uf}`,
      summary:
        'Busca local ativada porque GEMINI_API_KEY nao esta configurada. Cadastrei sugestoes-base e deixei fonte/telefone para conferencia operacional.',
      suggestions,
      citations: [],
      search_queries: [],
    })
  }

  try {
    const prompt = montarPrompt({ query, cidade, uf, knownHotels: body.knownHotels || [] })
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.15, maxOutputTokens: 2200 },
        }),
      },
    )

    const data = await r.json()
    if (!r.ok) {
      if (openAIKey) {
        return buscarHoteisComOpenAI({ query, cidade, uf, knownHotels: body.knownHotels || [] })
      }
      return NextResponse.json(
        {
          error: classifyAIError({ message: data?.error?.message, status: r.status }, 'gemini').message,
          code: classifyAIError({ message: data?.error?.message, status: r.status }, 'gemini').kind,
        },
        { status: r.status },
      )
    }

    const candidate = data?.candidates?.[0]
    const text =
      candidate?.content?.parts
        ?.map((part: any) => part?.text)
        .filter(Boolean)
        .join('\n') || ''
    const parsed = JSON.parse(extrairJSON(text))
    const suggestions = normalizarSugestoes(parsed.hotels || parsed.suggestions || [], cidade, uf)

    return NextResponse.json({
      source: 'gemini-google',
      query: query || `${cidade}-${uf}`,
      summary: parsed.summary || `Hoteis encontrados para ${cidade || query}.`,
      suggestions,
      search_queries: candidate?.groundingMetadata?.webSearchQueries || [],
      citations:
        candidate?.groundingMetadata?.groundingChunks
          ?.map((chunk: any) => chunk?.web)
          ?.filter(Boolean)
          ?.map((web: any) => ({ title: web.title, uri: web.uri })) || [],
    })
  } catch (e: any) {
    if (openAIKey) {
      return buscarHoteisComOpenAI({ query, cidade, uf, knownHotels: body.knownHotels || [] })
    }
    const friendly = classifyAIError(e, 'gemini')
    return NextResponse.json({ error: friendly.message, code: friendly.kind }, { status: 500 })
  }
}

async function buscarHoteisComOpenAI({
  query,
  cidade,
  uf,
  knownHotels,
}: {
  query: string
  cidade: string
  uf: string
  knownHotels: Array<{ nome: string; cidade: string; uf: string }>
}) {
  try {
    const prompt = montarPrompt({ query, cidade, uf, knownHotels })
    const data = await callOpenAIResponses({
      system: 'Voce pesquisa hoteis corporativos para a BBT e responde somente JSON valido.',
      messages: [{ role: 'user', content: prompt }],
      enableSearch: true,
      maxOutputTokens: 6000,
      reasoningEffort: 'low',
      textFormat: HOTEL_SEARCH_JSON_SCHEMA,
    })
    const parsed = await parseOpenAIHotelJSON(data.output_text || '')
    const suggestions = normalizarSugestoes(parsed.hotels || parsed.suggestions || [], cidade, uf)
    return NextResponse.json({
      source: 'openai-web',
      query: query || `${cidade}-${uf}`,
      summary: parsed.summary || `Hoteis encontrados para ${cidade || query}.`,
      suggestions,
      citations: data.sources || [],
      search_queries: [],
    })
  } catch (e: any) {
    const suggestions = fallbackHotels(cidade || query, uf)
    const friendly = classifyAIError(e, 'openai')
    return NextResponse.json({
      source: 'local-fallback',
      query: query || `${cidade}-${uf}`,
      summary: `${friendly.message} Mantive a operacao funcionando com sugestoes locais para conferencia.`,
      suggestions,
      citations: [],
      search_queries: [],
      ai_error: friendly.kind,
    })
  }
}

async function parseOpenAIHotelJSON(text: string) {
  try {
    return JSON.parse(extrairJSON(text))
  } catch {
    const repair = await callOpenAIResponses({
      system: 'Voce corrige JSON invalido. Responda somente JSON valido conforme o schema.',
      messages: [
        {
          role: 'user',
          content: `Corrija este JSON para um objeto valido com "summary" e "hotels". Nao invente novos hoteis; apenas preserve e corrija a sintaxe.\n\n${text}`,
        },
      ],
      enableSearch: false,
      maxOutputTokens: 6000,
      reasoningEffort: 'low',
      textFormat: HOTEL_SEARCH_JSON_SCHEMA,
    })
    return JSON.parse(extrairJSON(repair.output_text || ''))
  }
}

function montarPrompt({
  query,
  cidade,
  uf,
  knownHotels,
}: {
  query: string
  cidade: string
  uf: string
  knownHotels: Array<{ nome: string; cidade: string; uf: string }>
}): string {
  return `Voce e um agente operacional da BBT Viagens Corporativas.
Pesquise na web hoteis adequados para demanda corporativa.

Consulta do usuario: ${query || `${cidade}-${uf}`}
Cidade alvo: ${cidade || 'nao informada'}
UF alvo: ${uf || 'nao informada'}
Hoteis ja cadastrados para evitar duplicidade: ${knownHotels
    .slice(0, 80)
    .map((h) => `${h.nome} (${h.cidade}/${h.uf})`)
    .join('; ')}

Retorne APENAS JSON valido, sem markdown:
{
  "summary": "1 frase pratica",
  "hotels": [
    {
      "nome": "Nome oficial",
      "cidade": "Cidade",
      "uf": "UF",
      "telefone": "telefone oficial se encontrado ou null",
      "endereco": "endereco se encontrado ou null",
      "site": "site oficial se encontrado ou null",
      "categoria": "1|2|3|4|5 ou null",
      "tarifa_sgl": number ou null,
      "tarifa_dbl": number ou null,
      "tarifa_tpl": number ou null,
      "cafe_manha": "SIM|NAO|null",
      "estacionamento": "texto curto ou null",
      "faturado": false,
      "formas_pagamento": ["CC","PX"],
      "observacoes": "informacao operacional curta, com alerta se telefone/preco precisar confirmar",
      "confianca": "alta|media|baixa",
      "fonte_url": "URL principal",
      "fonte_titulo": "titulo da fonte"
    }
  ]
}

Regras:
- Priorize hoteis de rede ou perfil corporativo, bem avaliados e com telefone/site.
- Nao invente telefone nem tarifa; use null quando nao achar.
- Se o usuario passou nome de hotel, retorne esse hotel primeiro se existir.
- Maximo 6 hoteis.`
}

function normalizarSugestoes(raw: any[], cidade: string, uf: string): HotelAISuggestion[] {
  return raw
    .filter((item) => item?.nome)
    .slice(0, 6)
    .map((item) => ({
      nome: String(item.nome || '').trim(),
      cidade: String(item.cidade || cidade || '').trim(),
      uf: String(item.uf || uf || '').trim().toUpperCase().slice(0, 2),
      categoria: ['1', '2', '3', '4', '5'].includes(String(item.categoria)) ? (String(item.categoria) as any) : undefined,
      observacoes: item.observacoes || null,
      telefone: item.telefone || null,
      faturado: Boolean(item.faturado),
      info_faturamento: item.info_faturamento || null,
      bebedouro: null,
      valor_agua: null,
      cafe_manha: item.cafe_manha || null,
      estacionamento: item.estacionamento || null,
      tarifa_sgl: numeroOuNull(item.tarifa_sgl),
      tarifa_dbl: numeroOuNull(item.tarifa_dbl),
      tarifa_tpl: numeroOuNull(item.tarifa_tpl),
      formas_pagamento: Array.isArray(item.formas_pagamento) ? item.formas_pagamento : ['CC', 'PX'],
      endereco: item.endereco || null,
      site: item.site || null,
      fonte_url: item.fonte_url || null,
      fonte_titulo: item.fonte_titulo || null,
      confianca: ['alta', 'media', 'baixa'].includes(item.confianca) ? item.confianca : 'media',
    }))
}

function fallbackHotels(cidadeRaw: string, ufRaw: string): HotelAISuggestion[] {
  const cidade = cidadeRaw || 'Campo Grande'
  const uf = ufRaw || inferirUF(cidade) || 'MS'
  const normalized = normalizar(cidade)
  const presets: Record<string, string[]> = {
    'campo grande': [
      'Deville Prime Campo Grande',
      'Novotel Campo Grande',
      'ibis Campo Grande',
      'Hotel Metropolitan Campo Grande',
      'Bristol Exceler Campo Grande',
      'Jandaia Hotel Campo Grande',
    ],
    goiania: ['Quality Hotel Goiania', 'Castros Park Hotel', 'Oitis Hotel', 'ibis Styles Goiania Marista'],
    brasilia: ['Transamerica Fit Brasilia', 'Cullinan Hplus Premium', 'Mercure Brasilia Lider', 'ibis Styles Brasilia Aeroporto'],
  }
  const names = presets[normalized] || [
    `Hotel corporativo ${cidade}`,
    `ibis ${cidade}`,
    `Comfort Hotel ${cidade}`,
    `Nobile ${cidade}`,
  ]
  return names.map((nome) => ({
    nome,
    cidade: titleCase(cidade),
    uf,
    categoria: undefined,
    observacoes: 'Sugestao gerada no modo local. Confirme telefone, disponibilidade e tarifa antes de emitir.',
    telefone: null,
    faturado: false,
    info_faturamento: null,
    bebedouro: null,
    valor_agua: null,
    cafe_manha: null,
    estacionamento: null,
    tarifa_sgl: null,
    tarifa_dbl: null,
    tarifa_tpl: null,
    formas_pagamento: ['CC', 'PX'],
    endereco: null,
    site: null,
    fonte_url: `https://www.google.com/search?q=${encodeURIComponent(`${nome} ${cidade} telefone`)}`,
    fonte_titulo: 'Busca Google para conferencia',
    confianca: 'baixa',
  }))
}

function extrairJSON(texto: string): string {
  const limpo = texto.replace(/```json|```/g, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio >= 0 && fim > inicio) return limpo.slice(inicio, fim + 1)
  return limpo
}

function extrairUF(texto: string): string {
  return texto.match(/\b([A-Z]{2})\b/i)?.[1]?.toUpperCase() || ''
}

function extrairCidade(texto: string): string {
  return (
    texto.match(/(?:em|para|cidade de|hospedagem em)\s+([a-zA-ZÀ-ÿ\s]+?)(?:[-/,]\s*[A-Z]{2}\b|$)/i)?.[1] ||
    ''
  ).trim()
}

function inferirUF(cidade: string): string {
  const map: Record<string, string> = {
    'campo grande': 'MS',
    goiania: 'GO',
    trindade: 'GO',
    brasilia: 'DF',
    'sao paulo': 'SP',
    'rio de janeiro': 'RJ',
    recife: 'PE',
  }
  return map[normalizar(cidade)] || ''
}

function numeroOuNull(value: any): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function titleCase(texto: string): string {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

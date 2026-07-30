import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { todayISODate } from '@/lib/date'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  AiGatewayError,
  executeAiGateway,
} from '@/lib/server/ai-gateway-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const searchSchema = z.object({
  query: z.string().trim().min(3).max(4_000),
  location: z.string().trim().max(200).optional(),
  deep: z.boolean().default(false),
}).strict()

export async function POST(req: NextRequest) {
  const guard = await guardApiRequest(req, {
    requireAuth: true,
    permission: 'usar_busca_global',
    authorization: {
      action: 'use',
      resource: 'search',
      requiredPermission: 'usar_busca_global',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'ia-search:post', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(req, 64 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const body = searchSchema.parse(input.body)
    const result = await executeAiGateway(guard.principal!, {
      task: 'research',
      messages: [{
        role: 'user',
        content: buildPrompt(body.query, body.location),
      }],
      enableSearch: true,
      maxOutputTokens: body.deep ? 5_000 : 2_800,
    })
    const parsed = parseJson(result.output_text)
    return NextResponse.json(
      {
        source: result.provedor === 'gemini' ? 'gemini-google' : 'openai-web',
        query: body.query,
        answer: text(parsed.answer) || result.output_text,
        summary: text(parsed.summary) || 'Pesquisa web concluida.',
        confidence: confidence(parsed.confidence),
        action_items: stringArray(parsed.action_items, 6),
        sources: result.sources,
      },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    if (
      error instanceof AiGatewayError
      && ['AI_NOT_CONFIGURED', 'rate_limit', 'quota', 'billing', 'network', 'timeout'].includes(error.code)
    ) {
      const query = safeQuery(input.body)
      return NextResponse.json(
        {
          source: 'fallback-link',
          query,
          answer:
            'A busca web por API esta indisponivel agora. Confira a fonte manualmente antes de cadastrar telefone, tarifa ou disponibilidade.',
          summary: 'Busca por API indisponivel.',
          confidence: 'baixa',
          action_items: ['Abrir a fonte e conferir os dados antes de qualquer cadastro ou operacao.'],
          sources: query
            ? [{ title: 'Abrir pesquisa no Google', uri: `https://www.google.com/search?q=${encodeURIComponent(query)}` }]
            : [],
          provider_error: error.code,
        },
        {
          status: error.status === 503 ? 503 : 502,
          headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' },
        },
      )
    }
    return governanceErrorResponse(error, guard.requestId)
  }
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
- Priorize fontes oficiais e confiaveis.
- Nao invente telefone, tarifa, disponibilidade, endereco ou politica.
- Se nao encontrar confirmacao confiavel, diga exatamente o que falta confirmar.`
}

function parseJson(value: string): Record<string, unknown> {
  try {
    const clean = String(value || '').replace(/```json|```/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    return JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean)
  } catch {
    return {}
  }
}

function safeQuery(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return String((value as Record<string, unknown>).query || '').trim().slice(0, 4_000)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function confidence(value: unknown): 'alta' | 'media' | 'baixa' {
  return value === 'alta' || value === 'baixa' ? value : 'media'
}

function stringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, limit)
    : []
}

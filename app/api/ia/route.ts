import { NextRequest, NextResponse } from 'next/server'
import { callGemini, callOpenAIResponses, getPaidAIStatus } from '@/lib/server-ai'
import { guardApiRequest } from '@/lib/security/api-guard'
import { classifyAIError } from '@/lib/ai-friendly-errors'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface IARequestShape {
  model?: string
  max_tokens?: number
  system?: string
  enable_search?: boolean
  provider?: 'openai' | 'gemini'
  task?: 'chat' | 'extract' | 'hotel_search' | 'research' | 'pro'
  messages: Array<{ role: 'user' | 'assistant'; content: any }>
}

export async function GET(request: NextRequest) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'ia-status', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return NextResponse.json(getPaidAIStatus())
}

export async function POST(req: NextRequest) {
  const guard = await guardApiRequest(req, {
    requireAuth: true,
    rateLimit: { key: 'ia-chat', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<IARequestShape>(req, 8 * 1024 * 1024)
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: input.status })
  const body = input.body
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 50) {
    return NextResponse.json({ error: 'A conversa deve conter entre 1 e 50 mensagens.' }, { status: 400 })
  }
  if (String(body.system || '').length > 50_000) {
    return NextResponse.json({ error: 'As instrucoes enviadas para a IA excedem o limite permitido.' }, { status: 413 })
  }

  const status = getPaidAIStatus()
  const wantsGemini =
    body.provider === 'gemini' ||
    (body.task === 'hotel_search' &&
      status.provedor !== 'openai' &&
      Boolean(process.env.GEMINI_API_KEY))

  if (wantsGemini) {
    try {
      const data = await callGemini({
        system: body.system,
        messages: body.messages || [],
        enableSearch: Boolean(body.enable_search),
        maxOutputTokens: body.max_tokens,
      })
      return NextResponse.json(data)
    } catch (e: any) {
      const friendly = classifyAIError(e, 'gemini')
      return NextResponse.json(
        {
          error: friendly.message,
          code: friendly.kind,
          provedor: 'gemini',
          ...(process.env.NODE_ENV !== 'production' ? { technical: friendly.technicalMessage } : {}),
        },
        { status: e.status || 500 },
      )
    }
  }

  if (status.provedor === 'openai') {
    try {
      const data = await callOpenAIResponses({
        system: body.system,
        messages: body.messages || [],
        enableSearch: Boolean(body.enable_search),
        model: body.task === 'pro' ? process.env.OPENAI_PRO_MODEL || 'gpt-5.2-pro' : process.env.OPENAI_MODEL || 'gpt-5.2',
        maxOutputTokens: body.max_tokens,
        reasoningEffort: body.task === 'pro' || body.task === 'research' ? 'medium' : 'low',
      })
      return NextResponse.json(data)
    } catch (e: any) {
      const friendly = classifyAIError(e, 'openai')
      return NextResponse.json(
        {
          error: friendly.message,
          code: friendly.kind,
          provedor: 'openai',
          ...(process.env.NODE_ENV !== 'production' ? { technical: friendly.technicalMessage } : {}),
        },
        { status: e.status || 500 },
      )
    }
  }

  if (status.provedor === 'gemini') {
    try {
      const data = await callGemini({
        system: body.system,
        messages: body.messages || [],
        enableSearch: Boolean(body.enable_search),
        maxOutputTokens: body.max_tokens,
      })
      return NextResponse.json(data)
    } catch (e: any) {
      const friendly = classifyAIError(e, 'gemini')
      return NextResponse.json(
        {
          error: friendly.message,
          code: friendly.kind,
          provedor: 'gemini',
          ...(process.env.NODE_ENV !== 'production' ? { technical: friendly.technicalMessage } : {}),
        },
        { status: e.status || 500 },
      )
    }
  }

  return NextResponse.json(
    {
      error:
        'A IA premium ainda nao esta conectada neste ambiente. Configure OPENAI_API_KEY no servidor para ativar o cerebro principal; GEMINI_API_KEY pode ser usada como apoio de busca.',
      code: 'not_configured',
      hint:
        'Configure OPENAI_API_KEY para o cerebro GPT-5.2. GEMINI_API_KEY e opcional para busca Google/hoteis.',
      provedor: 'local',
    },
    { status: 503 },
  )
}

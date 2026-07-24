import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getPaidAIStatus } from '@/lib/server-ai'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  AiGatewayError,
  executeAiGateway,
  type AiGatewayTask,
} from '@/lib/server/ai-gateway-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([
    z.string().max(12_000),
    z.array(z.record(z.unknown())).max(12),
  ]),
}).strict()

const requestSchema = z.object({
  model: z.string().max(200).optional(),
  max_tokens: z.number().int().min(128).max(8_000).optional(),
  system: z.string().max(50_000).optional(),
  enable_search: z.boolean().optional(),
  provider: z.enum(['openai', 'gemini']).optional(),
  task: z.enum([
    'chat',
    'extract',
    'hotel_search',
    'research',
    'pro',
    'report_explanation',
    'policy_draft',
    'workflow_draft',
  ]).default('chat'),
  messages: z.array(messageSchema).min(1).max(50),
}).strict()

export async function GET(request: NextRequest) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'usar_ia',
    rateLimit: { key: 'ia-status', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return NextResponse.json(getPaidAIStatus())
}

export async function POST(req: NextRequest) {
  const guard = await guardApiRequest(req, {
    requireAuth: true,
    permission: 'usar_ia',
    rateLimit: { key: 'ia-chat', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(req, 8 * 1024 * 1024)
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: input.status })
  const parsed = requestSchema.safeParse(input.body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Solicitacao de IA invalida.',
        code: 'AI_REQUEST_INVALID',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400, headers: { 'X-Request-Id': guard.requestId } },
    )
  }

  try {
    const body = parsed.data
    const task: AiGatewayTask = body.task === 'pro' ? 'research' : body.task
    const data = await executeAiGateway(guard.principal!, {
      task,
      messages: body.messages,
      enableSearch: body.enable_search,
      maxOutputTokens: body.max_tokens,
      preferredProvider: body.provider,
    })
    return NextResponse.json(data, {
      headers: {
        'X-Request-Id': guard.requestId,
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (error) {
    if (error instanceof AiGatewayError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: error.code,
          provedor: error.provider,
          ...(process.env.NODE_ENV !== 'production' && error.technicalMessage
            ? { technical: error.technicalMessage }
            : {}),
        },
        {
          status: error.status,
          headers: { 'X-Request-Id': guard.requestId },
        },
      )
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'Nao foi possivel concluir a solicitacao de IA.',
        code: 'AI_GATEWAY_FAILED',
      },
      { status: 500, headers: { 'X-Request-Id': guard.requestId } },
    )
  }
}

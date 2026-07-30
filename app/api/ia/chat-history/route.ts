import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  appendPersonalAiChatHistory,
  clearPersonalAiChatHistory,
  listPersonalAiChatHistory,
} from '@/lib/server/ai-chat-history-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const messageSchema = z.object({
  id: z.string().trim().min(2).max(200),
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(12_000),
  timestamp: z.string().datetime({ offset: true }),
  provedor: z.enum(['openai', 'gemini', 'local']).optional(),
}).strict()

const appendSchema = z.object({
  messages: z.array(messageSchema).min(1).max(10),
}).strict()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'ai-chat-history:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const messages = await listPersonalAiChatHistory(guard.principal!)
    return NextResponse.json(
      { ok: true, messages },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'ai-chat-history:append', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 128 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const body = appendSchema.parse(input.body)
    await appendPersonalAiChatHistory(guard.principal!, body.messages)
    return NextResponse.json(
      { ok: true },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function DELETE(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    rateLimit: { key: 'ai-chat-history:clear', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    await clearPersonalAiChatHistory(guard.principal!)
    return NextResponse.json(
      { ok: true },
      { headers: { 'X-Request-Id': guard.requestId, 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

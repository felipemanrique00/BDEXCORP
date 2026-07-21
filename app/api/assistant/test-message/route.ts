import { NextResponse } from 'next/server'

import { processAssistantMessage } from '@/lib/assistant/orchestrator'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_MESSAGE_REQUEST_BYTES = 64 * 1024

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ ok: false }, { status: 404 })
  const guard = await guardApiRequest(request, { requireAuth: true, permission: 'gerenciar_usuarios', rateLimit: { key: 'assistant-test-message', limit: 20, windowMs: 60_000 } })
  if (guard.response) return guard.response
  try {
    const body = await readJsonBody<any>(request, MAX_MESSAGE_REQUEST_BYTES)
    const text = String(body?.message || body?.text || '').trim()
    if (!text) return NextResponse.json({ ok: false, error: 'Mensagem obrigatoria.' }, { status: 400 })
    if (text.length > 20_000) return NextResponse.json({ ok: false, error: 'Mensagem excede o limite permitido.' }, { status: 413 })
    const result = await processAssistantMessage({
      text,
      channel: body?.channel || 'test',
      user: guard.user,
      conversationId: body?.conversationId,
      participantPhone: body?.participantPhone,
      participantName: body?.participantName,
      confirmed: Boolean(body?.confirmed),
    })
    return NextResponse.json(result)
  } catch (error) {
    const inputError = requestBodyErrorResponse(error)
    return NextResponse.json(
      { ok: false, error: inputError?.message || 'Falha ao processar mensagem.' },
      { status: inputError?.status || 400 },
    )
  }
}

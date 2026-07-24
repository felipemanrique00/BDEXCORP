import { NextResponse } from 'next/server'

import { transcribeAssistantAudio } from '@/lib/assistant/voice'
import { processAssistantMessage } from '@/lib/assistant/orchestrator'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_AUDIO_REQUEST_BYTES = 36 * 1024 * 1024

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ ok: false }, { status: 404 })
  const guard = await guardApiRequest(request, { requireAuth: true, tenantAdmin: true, rateLimit: { key: 'assistant-test-audio', limit: 10, windowMs: 60_000 } })
  if (guard.response) return guard.response
  try {
    const body = await readJsonBody<any>(request, MAX_AUDIO_REQUEST_BYTES)
    const transcription = await transcribeAssistantAudio(guard.principal!, {
      base64: body?.base64,
      fileName: body?.fileName,
      mimeType: body?.mimeType,
      textFallback: body?.transcript || body?.text,
      channel: 'voice',
    })
    const result = await processAssistantMessage({
      text: transcription.transcript,
      channel: 'voice',
      user: guard.user,
      conversationId: body?.conversationId,
      confirmed: Boolean(body?.confirmed),
    })
    return NextResponse.json({ ...result, transcription })
  } catch (error: any) {
    const status = Number(error?.status || 400)
    return NextResponse.json({ ok: false, error: error?.message || 'Falha ao testar audio.' }, { status })
  }
}

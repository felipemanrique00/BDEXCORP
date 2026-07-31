import { NextResponse } from 'next/server'

import { generateAssistantAudio } from '@/lib/assistant/voice'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_AUDIO_GENERATION_REQUEST_BYTES = 32 * 1024

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'usar_ia',
    authorization: {
      action: 'use',
      resource: 'ai',
      requiredPermission: 'usar_ia',
      allowEmptyCompanyScope: true,
    },
    rateLimit: { key: 'assistant-audio-generate', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    try {
      const body = await readJsonBody<any>(request, MAX_AUDIO_GENERATION_REQUEST_BYTES)
      const text = String(body?.text || '').trim()
      if (!text) return NextResponse.json({ ok: false, error: 'Texto obrigatorio.' }, { status: 400 })
      if (text.length > 4_000) return NextResponse.json({ ok: false, error: 'Texto excede o limite de 4.000 caracteres.' }, { status: 413 })
      const result = await generateAssistantAudio(guard.principal!, { text })
      return NextResponse.json({ ok: true, ...result })
    } catch (error: any) {
      const inputError = requestBodyErrorResponse(error)
      if (inputError) return NextResponse.json({ ok: false, error: inputError.message }, { status: inputError.status })
      const status = Number(error?.status || 400)
      return NextResponse.json({ ok: false, error: error?.message || 'Falha ao gerar audio.' }, { status })
    }
  })
}

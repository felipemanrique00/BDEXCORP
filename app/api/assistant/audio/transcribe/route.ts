import { NextResponse } from 'next/server'

import { MAX_ASSISTANT_AUDIO_BYTES, transcribeAssistantAudio } from '@/lib/assistant/voice'
import { guardApiRequest } from '@/lib/security/api-guard'
import { assertDeclaredBodySize, readJsonBody } from '@/lib/security/request-body'
import type { AssistantChannel } from '@/lib/assistant/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_AUDIO_REQUEST_BYTES = 36 * 1024 * 1024

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
    rateLimit: { key: 'assistant-audio-transcribe', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      assertDeclaredBodySize(request, MAX_AUDIO_REQUEST_BYTES)
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: 'Arquivo de audio obrigatorio.' }, { status: 400 })
      }
      if (file.size > MAX_ASSISTANT_AUDIO_BYTES) {
        return NextResponse.json({ ok: false, error: 'Audio grande demais. Use arquivo de ate 25 MB.' }, { status: 413 })
      }
      if (!file.type.startsWith('audio/') && !/\.(webm|ogg|opus|mp3|m4a|wav|aac)$/i.test(file.name)) {
        return NextResponse.json({ ok: false, error: 'Formato de audio nao permitido.' }, { status: 415 })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await transcribeAssistantAudio(guard.principal!, {
        base64: buffer.toString('base64'),
        fileName: file.name,
        mimeType: file.type || 'audio/webm',
        textFallback: String(form.get('textFallback') || ''),
        channel: normalizeChannel(form.get('channel')),
      })
      return NextResponse.json({ ok: true, ...result })
    }

    const body = await readJsonBody<any>(request, MAX_AUDIO_REQUEST_BYTES)
    const result = await transcribeAssistantAudio(guard.principal!, {
      base64: body?.base64,
      fileName: body?.fileName,
      mimeType: body?.mimeType,
      textFallback: body?.text || body?.transcript,
      channel: normalizeChannel(body?.channel),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    const status = Number(error?.status || 400)
    return NextResponse.json({ ok: false, error: error?.message || 'Falha ao transcrever audio.' }, { status })
  }
}

function normalizeChannel(value: unknown): AssistantChannel {
  const channel = String(value || 'voice')
  return ['system', 'whatsapp', 'voice', 'portal', 'test'].includes(channel)
    ? (channel as AssistantChannel)
    : 'voice'
}

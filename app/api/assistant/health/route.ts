import { NextResponse } from 'next/server'

import { getAssistantSettings } from '@/lib/assistant/settings'
import { getAssistantTools } from '@/lib/assistant/tools'
import { getWhatsAppSession } from '@/lib/assistant/messaging'
import { pingDatabase } from '@/lib/server-db'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, tenantAdmin: true, rateLimit: { key: 'assistant-health', limit: 120, windowMs: 60_000 } })
  if (guard.response) return guard.response

  return runInApiGuardContext(guard, async () => {
    let storage: 'postgres' | 'error' = 'postgres'
    try {
      await pingDatabase()
    } catch {
      storage = 'error'
    }
    const [settings, tools, whatsapp] = await Promise.all([getAssistantSettings(), getAssistantTools(), getWhatsAppSession()])
    return NextResponse.json({
      ok: true,
      status: settings.active ? 'active' : 'inactive',
      storage,
      whatsapp,
      tools: {
        total: tools.length,
        active: tools.filter((item) => item.status === 'active').length,
      },
      voice: {
        speechToTextEnabled: settings.voice.speechToTextEnabled,
        textToSpeechEnabled: settings.voice.textToSpeechEnabled,
        responseMode: settings.voice.responseMode,
      },
    })
  })
}

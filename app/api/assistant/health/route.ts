import { NextResponse } from 'next/server'

import { getAssistantSettings } from '@/lib/assistant/settings'
import { getAssistantTools } from '@/lib/assistant/tools'
import { getWhatsAppSession } from '@/lib/assistant/messaging'
import { pingDatabase, databaseConfigured } from '@/lib/server-db'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, permission: 'gerenciar_usuarios', rateLimit: { key: 'assistant-health', limit: 120, windowMs: 60_000 } })
  if (guard.response) return guard.response

  let storage: 'postgres' | 'file' | 'error' = databaseConfigured() ? 'postgres' : 'file'
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
}

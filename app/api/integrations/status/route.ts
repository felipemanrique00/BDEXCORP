import { NextResponse } from 'next/server'

import { databaseConfigured, pingDatabase } from '@/lib/server-db'
import { getAssistantSettings } from '@/lib/assistant/settings'
import { getWhatsAppSession } from '@/lib/assistant/messaging'
import { integrationRegistry } from '@/lib/integrations/registry'
import { guardApiRequest } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, permission: 'gerenciar_usuarios', rateLimit: { key: 'integrations-status:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response

  let database = databaseConfigured() ? 'configured' : 'file_fallback'
  try {
    await pingDatabase()
  } catch {
    database = 'error'
  }

  const [assistant, whatsapp, tech] = await Promise.all([
    getAssistantSettings(),
    getWhatsAppSession(),
    integrationRegistry.tech.health(),
  ])
  return NextResponse.json({
    ok: true,
    database,
    assistant: {
      active: assistant.active,
      provider: assistant.provider,
      model: assistant.model,
    },
    whatsapp,
    providers: {
      techTravel: tech.connected ? 'api_connected' : tech.configured ? 'api_configured_with_error' : 'not_configured',
      openai: Boolean(process.env.OPENAI_API_KEY) ? 'configured' : 'not_configured',
      gemini: Boolean(process.env.GEMINI_API_KEY) ? 'configured' : 'not_configured',
      storage: process.env.DATABASE_URL ? 'postgres' : 'file',
    },
    techTravel: tech,
  })
}

import { NextResponse } from 'next/server'

import { getAssistantSettings, saveAssistantSettings } from '@/lib/assistant/settings'
import { createAssistantAuditLog } from '@/lib/assistant/audit'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, rateLimit: { key: 'assistant-settings:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  return NextResponse.json({ ok: true, settings: await getAssistantSettings() })
}

export async function PUT(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'assistant-settings:put', limit: 20, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<any>(request, 256 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })

  try {
    const body = input.body
    const settings = await saveAssistantSettings(body?.settings || body || {}, guard.user?.id)
    await createAssistantAuditLog({
      level: 'info',
      action: 'assistant.settings.update',
      module: 'assistant',
      userId: guard.user?.id,
      userName: guard.user?.name,
      companyId: guard.user?.company_id,
      channel: 'system',
      inputSummary: 'Configuracoes da assistente atualizadas pelo painel.',
    })
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error)?.message || 'Falha ao salvar configuracoes.' }, { status: 400 })
  }
}

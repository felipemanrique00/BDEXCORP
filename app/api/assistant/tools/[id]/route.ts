import { NextResponse } from 'next/server'

import { updateAssistantTool } from '@/lib/assistant/tools'
import { createAssistantAuditLog } from '@/lib/assistant/audit'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_usuarios',
    rateLimit: { key: 'assistant-tools:put', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const { id } = await params
  const input = await readJsonBodyResult<any>(request, 128 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })
  const body = input.body
  const tool = await updateAssistantTool(id, body?.tool || body || {})
  if (!tool) return NextResponse.json({ ok: false, error: 'Ferramenta nao encontrada.' }, { status: 404 })
  await createAssistantAuditLog({
    level: 'info',
    action: 'assistant.tool.update',
    module: 'assistant',
    userId: guard.user?.id,
    userName: guard.user?.name,
    companyId: guard.user?.company_id,
    channel: 'system',
    toolId: id,
    inputSummary: 'Ferramenta atualizada pelo painel.',
  })
  return NextResponse.json({ ok: true, tool })
}

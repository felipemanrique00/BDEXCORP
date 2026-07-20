import { NextResponse } from 'next/server'

import { executeAssistantTool } from '@/lib/assistant/tools'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = guardApiRequest(request, { requireAuth: true, rateLimit: { key: 'assistant-voucher-send', limit: 20, windowMs: 60_000 } })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<any>(request, 128 * 1024, {})
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })
  const body = input.body
  const result = await executeAssistantTool('sendVoucherPDF', body, {
    userId: guard.user?.id,
    userName: guard.user?.name,
    userRole: guard.user?.perfil_bbt || guard.user?.role,
    companyId: guard.user?.company_id,
    channel: body?.channel || 'whatsapp',
    confirmed: Boolean(body?.confirmed),
  })
  return NextResponse.json(result, { status: result.ok ? 200 : result.requiresConfirmation ? 409 : 400 })
}

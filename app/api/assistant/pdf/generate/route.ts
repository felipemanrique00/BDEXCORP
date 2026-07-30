import { NextResponse } from 'next/server'

import { executeAssistantTool } from '@/lib/assistant/tools'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_vouchers',
    rateLimit: { key: 'assistant-pdf-generate', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const input = await readJsonBodyResult<any>(request, 64 * 1024, {})
    if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: input.status })
    const body = input.body
    const result = await executeAssistantTool('generateVoucherPDF', { voucherId: body?.voucherId }, {
      userId: guard.user?.id,
      userName: guard.user?.name,
      userRole: guard.user?.perfil_bbt || guard.user?.role,
      companyId: guard.user?.company_id,
      channel: body?.channel || 'system',
      confirmed: Boolean(body?.confirmed),
    })
    return NextResponse.json(result, { status: result.ok ? 200 : result.requiresConfirmation ? 409 : 400 })
  })
}

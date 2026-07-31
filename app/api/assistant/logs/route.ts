import { NextResponse } from 'next/server'

import { getAssistantAuditLogs, getAssistantToolLogs } from '@/lib/assistant/audit'
import { getWhatsAppLogs } from '@/lib/assistant/messaging'
import { ASSISTANT_KEYS, getAssistantValue } from '@/lib/assistant/storage'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, tenantAdmin: true, rateLimit: { key: 'assistant-logs:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => {
    const [audit, tools, whatsapp, transcriptions, generations, voucherSends, documents, security, handoffs] = await Promise.all([
      getAssistantAuditLogs(250),
      getAssistantToolLogs(250),
      getWhatsAppLogs(250),
      getAssistantValue(ASSISTANT_KEYS.audioTranscriptions, []),
      getAssistantValue(ASSISTANT_KEYS.audioGenerations, []),
      getAssistantValue(ASSISTANT_KEYS.voucherSendLogs, []),
      getAssistantValue(ASSISTANT_KEYS.generatedDocuments, []),
      getAssistantValue(ASSISTANT_KEYS.securityEvents, []),
      getAssistantValue(ASSISTANT_KEYS.humanHandoffs, []),
    ])
    return NextResponse.json({ ok: true, audit, tools, whatsapp, transcriptions, generations, voucherSends, documents, security, handoffs })
  })
}

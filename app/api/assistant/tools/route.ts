import { NextResponse } from 'next/server'

import { getAssistantTools } from '@/lib/assistant/tools'
import { guardApiRequest, runInApiGuardContext } from '@/lib/security/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, { requireAuth: true, rateLimit: { key: 'assistant-tools:get', limit: 80, windowMs: 60_000 } })
  if (guard.response) return guard.response
  return runInApiGuardContext(guard, async () => (
    NextResponse.json({ ok: true, tools: await getAssistantTools() })
  ))
}

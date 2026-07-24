import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  financialEntryStatusSchema,
  financialEntryTypeSchema,
} from '@/lib/finance/schema'
import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import {
  createFinancialEntry,
  listFinancialEntries,
} from '@/lib/server/finance-service'
import {
  governanceBodyErrorResponse,
  governanceErrorResponse,
} from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const optionalDate = z.preprocess(
  (value) => {
    const normalized = String(value ?? '').trim()
    return normalized || undefined
  },
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
)

const querySchema = z.object({
  companyId: z.string().trim().min(1).max(160).optional(),
  type: financialEntryTypeSchema.optional(),
  status: financialEntryStatusSchema.optional(),
  dueFrom: optionalDate,
  dueTo: optionalDate,
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().superRefine((value, context) => {
  if (value.dueFrom && value.dueTo && value.dueFrom > value.dueTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dueTo'],
      message: 'A data final deve ser igual ou posterior a data inicial.',
    })
  }
})

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_financeiro',
    rateLimit: { key: 'finance:entries:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listFinancialEntries(guard.principal!, query)
    return NextResponse.json(
      { ok: true, ...result },
      {
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'editar_financeiro',
    rateLimit: { key: 'finance:entries:create', limit: 60, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  const input = await readJsonBodyResult<unknown>(request, 256 * 1024)
  if (!input.ok) return governanceBodyErrorResponse(input, guard.requestId)

  try {
    const idempotencyKey = request.headers.get('Idempotency-Key') || ''
    const result = await createFinancialEntry(
      guard.principal!,
      input.body,
      idempotencyKey,
    )
    return NextResponse.json(
      { ok: true, ...result },
      {
        status: result.reused ? 200 : 201,
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

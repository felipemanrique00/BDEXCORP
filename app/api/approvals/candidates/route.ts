import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { listApprovalCandidates } from '@/lib/server/approval-service'
import { governanceErrorResponse } from '@/lib/server/governance-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  companyId: z.string().trim().min(1).max(200).optional(),
  companyIds: z.string().trim().min(1).max(20_100).optional(),
  businessGroupId: z.string().trim().min(1).max(200).optional(),
  allCompanies: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().superRefine((value, context) => {
  if (Boolean(value.companyId) === Boolean(value.companyIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe companyId ou companyIds, mas nao ambos.' })
  }
  if (value.companyIds) {
    const companyIds = [...new Set(value.companyIds.split(',').map((item) => item.trim()).filter(Boolean))]
    if (!companyIds.length || companyIds.length > 100 || companyIds.some((companyId) => companyId.length > 200)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe entre 1 e 100 empresas validas.' })
    }
  }
  if (value.allCompanies !== Boolean(value.businessGroupId) || (value.allCompanies && !value.companyIds)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'allCompanies exige businessGroupId e companyIds com a cobertura atual completa do grupo.',
    })
  }
}).transform((value) => ({
  companyId: value.companyId,
  companyIds: value.companyIds
    ? [...new Set(value.companyIds.split(',').map((item) => item.trim()).filter(Boolean))]
    : undefined,
  businessGroupId: value.businessGroupId,
  allCompanies: value.allCompanies,
  search: value.search,
  limit: value.limit,
  offset: value.offset,
}))

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permissionsAny: ['gerenciar_workflows', 'gerenciar_vinculos_acesso', 'gerenciar_usuarios'],
    rateLimit: { key: 'approval-candidates:list', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await listApprovalCandidates(guard.principal!, query)
    return NextResponse.json({ ok: true, ...result }, { headers: { 'X-Request-Id': guard.requestId } })
  } catch (error) {
    return governanceErrorResponse(error, guard.requestId)
  }
}

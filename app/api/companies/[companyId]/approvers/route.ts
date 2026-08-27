import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardApiRequest } from '@/lib/security/api-guard'
import { readJsonBody, requestBodyErrorResponse } from '@/lib/security/request-body'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  assignEmployeeAuthorizer,
  EmployeeAuthorizerServiceError,
  listCompanyEmployeeAuthorizers,
  resendEmployeeAuthorizerInvite,
  revokeEmployeeAuthorizer,
} from '@/lib/server/employee-authorizer-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const companyIdSchema = z.string().trim().min(1).max(200)
const assignmentSchema = z.object({
  employeeId: z.string().trim().min(1).max(200),
  expectedMembershipId: z.string().uuid().optional(),
}).strict()
const resendSchema = z.object({
  employeeId: z.string().trim().min(1).max(200),
  action: z.literal('resend_invite'),
}).strict()
const postSchema = z.union([assignmentSchema, resendSchema])

export async function GET(request: Request, context: { params: Promise<{ companyId: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permissionsAny: ['ver_funcionarios', 'gerenciar_usuarios', 'gerenciar_vinculos_acesso'],
    rateLimit: { key: 'company-employee-approvers:get', limit: 80, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { companyId: rawCompanyId } = await context.params
    const companyId = companyIdSchema.parse(rawCompanyId)
    const result = await listCompanyEmployeeAuthorizers(guard.principal!, companyId)
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
    return employeeAuthorizerErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request, context: { params: Promise<{ companyId: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permissionsAny: ['gerenciar_usuarios', 'gerenciar_vinculos_acesso'],
    rateLimit: { key: 'company-employee-approvers:post', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { companyId: rawCompanyId } = await context.params
    const companyId = companyIdSchema.parse(rawCompanyId)
    const input = postSchema.parse(await readJsonBody<unknown>(request, 64 * 1024))
    const result = 'action' in input
      ? await resendEmployeeAuthorizerInvite(guard.principal!, companyId, input.employeeId)
      : await assignEmployeeAuthorizer(guard.principal!, companyId, input)
    return NextResponse.json(
      {
        ok: true,
        authorizer: result.authorizer,
        invitation: result.invitation,
      },
      {
        status: result.created ? 201 : 200,
        headers: {
          'X-Request-Id': guard.requestId,
          'Cache-Control': 'no-store, private',
        },
      },
    )
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) {
      return NextResponse.json(
        { ok: false, error: bodyError.message, requestId: guard.requestId },
        { status: bodyError.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    return employeeAuthorizerErrorResponse(error, guard.requestId)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ companyId: string }> }) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permissionsAny: ['gerenciar_usuarios', 'gerenciar_vinculos_acesso'],
    rateLimit: { key: 'company-employee-approvers:delete', limit: 30, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const { companyId: rawCompanyId } = await context.params
    const companyId = companyIdSchema.parse(rawCompanyId)
    const input = assignmentSchema.pick({ employeeId: true }).parse(
      await readJsonBody<unknown>(request, 64 * 1024),
    )
    const result = await revokeEmployeeAuthorizer(guard.principal!, companyId, input.employeeId)
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
    const bodyError = requestBodyErrorResponse(error)
    if (bodyError) {
      return NextResponse.json(
        { ok: false, error: bodyError.message, requestId: guard.requestId },
        { status: bodyError.status, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    return employeeAuthorizerErrorResponse(error, guard.requestId)
  }
}

function employeeAuthorizerErrorResponse(error: unknown, requestId: string): NextResponse {
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'no-store, private' }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: 'Dados do autorizador invalidos.', details: error.flatten(), requestId },
      { status: 400, headers },
    )
  }
  if (error instanceof CorporateAccessDeniedError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code, requestId },
      { status: 403, headers },
    )
  }
  if (error instanceof EmployeeAuthorizerServiceError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        code: error.code,
        ...(error.candidate ? { candidate: error.candidate } : {}),
        requestId,
      },
      { status: error.status, headers },
    )
  }
  if (isUniqueViolation(error)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'O funcionario ou membership recebeu outro vinculo concorrente. Atualize a lista.',
        code: 'EMPLOYEE_AUTHORIZER_CONCURRENT_CONFLICT',
        requestId,
      },
      { status: 409, headers },
    )
  }
  console.error('[companies:approvers]', error)
  return NextResponse.json(
    { ok: false, error: 'Nao foi possivel configurar o autorizador.', requestId },
    { status: 500, headers },
  )
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

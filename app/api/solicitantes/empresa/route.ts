import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requesterCompanyIdentifierSchema, requesterPayloadSchema } from '@/lib/requesters/schema'
import { guardApiRequest, hasServerPermission } from '@/lib/security/api-guard'
import { readJsonBodyResult } from '@/lib/security/request-body'
import { mergeUserCorporateAccess } from '@/lib/server/corporate-access-admin-service'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  listCompanyRequesters,
  RequesterServiceError,
  upsertCompanyRequester,
  validateRequesterMutation,
} from '@/lib/server/requester-service'
import {
  createTenantUser,
  getTenantUser,
  resendTenantUserInvite,
  setTenantUserActive,
  UserConflictError,
  UserInvitationUnavailableError,
} from '@/lib/server/user-service'
import type { User } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const mutationEnvelopeSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  editingId: z.string().trim().min(1).max(160).optional(),
  solicitante: z.unknown().optional(),
  criarAcesso: z.boolean().default(false),
}).passthrough()

export async function GET(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'ver_solicitantes',
    rateLimit: { key: 'solicitantes-empresa:get', limit: 120, windowMs: 60_000 },
  })
  if (guard.response) return guard.response

  try {
    const companyId = requesterCompanyIdentifierSchema.parse(
      new URL(request.url).searchParams.get('companyId'),
    )
    const requesters = await listCompanyRequesters(guard.principal!, companyId)
    return NextResponse.json(
      { ok: true, solicitantes: requesters },
      { headers: { 'X-Request-Id': guard.requestId } },
    )
  } catch (error) {
    return requesterErrorResponse(error, guard.requestId)
  }
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, {
    requireAuth: true,
    permission: 'gerenciar_solicitantes',
    rateLimit: { key: 'solicitantes-empresa:post', limit: 40, windowMs: 60_000 },
  })
  if (guard.response) return guard.response
  const input = await readJsonBodyResult<unknown>(request, 256 * 1024)
  if (!input.ok) {
    return NextResponse.json(
      { ok: false, error: input.error, requestId: guard.requestId },
      { status: input.status, headers: { 'X-Request-Id': guard.requestId } },
    )
  }

  try {
    const envelope = mutationEnvelopeSchema.parse(input.body)
    const payload = requesterPayloadSchema.parse(envelope.solicitante ?? input.body)
    const editingId = envelope.id || envelope.editingId
    const validated = await validateRequesterMutation(guard.principal!, payload, editingId)
    const canManageUserLinks = canManageCompanyUserLinks(
      guard.principal!,
      guard.user,
      validated.payload.company_id,
    )
    const existingUserId = validated.existingUserId || null
    if (
      !canManageUserLinks
      && (validated.payload.user_id || null) !== existingUserId
    ) {
      return NextResponse.json(
        { ok: false, error: 'Permissao para alterar o acesso de login obrigatoria.', requestId: guard.requestId },
        { status: 403, headers: { 'X-Request-Id': guard.requestId } },
      )
    }
    let userId = canManageUserLinks
      ? validated.payload.user_id
      : existingUserId
    let invitationWarning: { code: string; message: string } | null = null
    let loginProvisioning: {
      state: 'invited' | 'active' | 'inactive' | 'blocked'
      invitationSent: boolean
      existing: boolean
    } | null = null

    if (envelope.criarAcesso) {
      if (!canManageUserLinks) {
        return NextResponse.json(
          { ok: false, error: 'Permissao para gerenciar usuarios obrigatoria.', requestId: guard.requestId },
          { status: 403, headers: { 'X-Request-Id': guard.requestId } },
        )
      }

      try {
        const corporateAccess = requesterCorporateAccess(validated.payload)
        const existingUser = userId ? await getTenantUser(guard.principal!, userId) : null
        if (existingUser) {
          const portalUser = await updateExistingRequesterAccess(
            guard.principal!,
            existingUser.id,
            corporateAccess,
          )
          userId = portalUser.id
          loginProvisioning = await provisionExistingRequesterLogin(
            guard.principal!,
            portalUser,
            validated.payload.status,
          )
        } else {
          const created = await createTenantUser(guard.principal!, {
              email: validated.payload.email,
              name: validated.payload.nome,
              role: 'colaborador',
              companyId: validated.payload.company_id,
              active: validated.payload.status !== 'bloqueado',
              corporateAccess,
            })
          userId = created.user.id
          loginProvisioning = created.existing
            ? await provisionExistingRequesterLogin(
                guard.principal!,
                created.user,
                validated.payload.status,
              )
            : {
                state: created.invited ? 'invited' : created.user.ativo === false ? 'inactive' : 'active',
                invitationSent: created.invited,
                existing: false,
              }
        }
      } catch (error) {
        if (!(error instanceof UserInvitationUnavailableError)) throw error
        invitationWarning = {
          code: 'REQUESTER_SAVED_INVITATION_PENDING',
          message: 'Solicitante salvo, mas o convite nao foi enviado porque o SMTP ainda nao esta configurado.',
        }
        loginProvisioning = {
          state: 'inactive',
          invitationSent: false,
          existing: Boolean(userId),
        }
      }
    }

    const result = await upsertCompanyRequester(
      guard.principal!,
      { ...validated.payload, user_id: userId },
      validated.editingId || undefined,
    )
    return NextResponse.json(
      {
        ok: true,
        solicitante: result.requester,
        solicitantes: result.requesters,
        warning: invitationWarning,
        access: loginProvisioning,
      },
      {
        status: result.created ? 201 : 200,
        headers: { 'X-Request-Id': guard.requestId },
      },
    )
  } catch (error) {
    return requesterErrorResponse(error, guard.requestId)
  }
}

async function provisionExistingRequesterLogin(
  principal: Parameters<typeof mergeUserCorporateAccess>[0],
  user: User,
  requesterStatus: z.infer<typeof requesterPayloadSchema>['status'],
) {
  if (requesterStatus === 'bloqueado') {
    return { state: 'blocked' as const, invitationSent: false, existing: true }
  }
  if (user.status === 'invited') {
    await resendTenantUserInvite(principal, user.id)
    return { state: 'invited' as const, invitationSent: true, existing: true }
  }
  const activeUser = user.ativo === false
    ? await setTenantUserActive(principal, user.id, true)
    : user
  return {
    state: activeUser.ativo === false ? 'inactive' as const : 'active' as const,
    invitationSent: false,
    existing: true,
  }
}

function canManageCompanyUserLinks(
  principal: NonNullable<Awaited<ReturnType<typeof guardApiRequest>>['principal']>,
  user: Awaited<ReturnType<typeof guardApiRequest>>['user'],
  companyId: string,
): boolean {
  if (principal.platformAdmin) return true
  if (principal.corporateAccess) {
    return Boolean(principal.corporateAccess.companies.find(
      (company) => company.companyId === companyId
        && company.permissions.gerenciar_usuarios
        && company.permissions.gerenciar_vinculos_acesso,
    ))
  }
  return hasServerPermission(user, 'gerenciar_usuarios')
    && hasServerPermission(user, 'gerenciar_vinculos_acesso')
}

function requesterCorporateAccess(payload: z.infer<typeof requesterPayloadSchema>) {
  return {
    groupGrants: [],
    companyGrants: [{
      companyId: payload.company_id,
      profile: 'requester' as const,
      permissionOverrides: {
        criar_demandas: payload.pode_criar_demanda,
        ver_vouchers: payload.pode_ver_vouchers,
        ver_financeiro: payload.pode_ver_financeiro,
      },
      status: payload.status === 'bloqueado' ? 'suspended' as const : 'active' as const,
      validFrom: null,
      validUntil: null,
    }],
    defaultContext: { type: 'company' as const, id: payload.company_id },
  }
}

async function updateExistingRequesterAccess(
  principal: Parameters<typeof mergeUserCorporateAccess>[0],
  userId: string,
  corporateAccess: ReturnType<typeof requesterCorporateAccess>,
) {
  await mergeUserCorporateAccess(principal, userId, corporateAccess, {
    preserveExistingDefault: true,
  })
  const user = await getTenantUser(principal, userId)
  if (!user) throw new UserConflictError('Usuario existente fora do escopo autorizado.')
  return user
}

function requesterErrorResponse(error: unknown, requestId: string): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: 'Dados do solicitante invalidos.', details: error.flatten(), requestId },
      { status: 400, headers: { 'X-Request-Id': requestId } },
    )
  }
  if (error instanceof CorporateAccessDeniedError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code, requestId },
      { status: 403, headers: { 'X-Request-Id': requestId } },
    )
  }
  if (error instanceof RequesterServiceError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code, requestId },
      { status: error.status, headers: { 'X-Request-Id': requestId } },
    )
  }
  if (error instanceof UserConflictError) {
    return NextResponse.json(
      { ok: false, error: error.message, requestId },
      { status: 409, headers: { 'X-Request-Id': requestId } },
    )
  }
  if (error instanceof UserInvitationUnavailableError) {
    return NextResponse.json(
      { ok: false, error: error.message, requestId },
      { status: 503, headers: { 'X-Request-Id': requestId } },
    )
  }
  console.error('[solicitantes:empresa]', error)
  return NextResponse.json(
    { ok: false, error: 'Falha ao processar solicitante.', requestId },
    { status: 500, headers: { 'X-Request-Id': requestId } },
  )
}

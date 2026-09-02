import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('impersonation MFA step-up contract', () => {
  it('protects the authenticated endpoint with the representation capability, CSRF and rate limiting', () => {
    const route = source('app/api/auth/mfa/step-up/route.ts')
    const authorization = source('lib/server/authorization-service.ts')

    expect(route).toContain('requireAuth: true')
    expect(route).toContain("permission: 'gerenciar_personificacoes'")
    expect(route).toContain("roleKeys: ['tenant_admin', 'supervisor', 'agent', 'operator']")
    expect(route).toContain("authorization: { action: 'update', resource: 'session', allowSelf: true }")
    expect(route).toContain("rateLimit: { key: 'auth-mfa-step-up:post', limit: 6, windowMs: 10 * 60_000 }")
    expect(route).toContain('csrf: true')
    expect(route).toContain('}).strict()')
    expect(route).toContain('stepUpMfaSession(')
    expect(route).not.toContain('createSession(')
    expect(route).not.toContain('cookies.set(')
    expect(authorization).toContain("'POST /api/auth/mfa/step-up': 'update'")
  })

  it('consumes the MFA proof and upgrades only the current active session atomically', () => {
    const service = source('lib/server/mfa-service.ts')

    expect(service).toContain('export async function stepUpMfaSession(')
    expect(service).toContain('principal.representation || !canManageImpersonations(principal)')
    expect(service).toMatch(/from user_mfa_methods[\s\S]*?membership_id = \$2[\s\S]*?user_id = \$3[\s\S]*?for update/)
    expect(service).toContain("verifyCode(client, method, codeInput, 'login')")
    expect(service).toContain('(last_used_step is null or last_used_step < $3)')
    expect(service).toMatch(/update user_mfa_recovery_codes[\s\S]*?used_at is null/)
    expect(service).toMatch(/update user_sessions[\s\S]*?where id = \$1[\s\S]*?tenant_id = \$2[\s\S]*?membership_id = \$3[\s\S]*?user_id = \$4/)
    expect(service).toContain("and status = 'active'")
    expect(service).toContain('and expires_at > now()')
    expect(service).toContain('and active_impersonation_id is null')
    expect(service).toContain("action: 'auth.mfa.step_up'")
    expect(service).toContain("entityType: 'user_session'")
    expect(service).toContain('writeAuditEventInTransaction(client')
  })

  it('separates actor eligibility from MFA freshness in both session contracts', () => {
    const sessionRoute = source('app/api/auth/session/route.ts')
    const currentRoute = source('app/api/auth/impersonation/current/route.ts')

    expect(sessionRoute).toContain(
      'principal && !principal.representation && canManageImpersonations(principal)',
    )
    expect(sessionRoute).toContain(
      'canStartRepresentation && principal && !hasRecentActorMfa(principal)',
    )
    expect(currentRoute).toContain(
      'const canStartRepresentation = !principal.representation && canManageImpersonations(principal)',
    )
    expect(currentRoute).toContain(
      'impersonationMfaRequired: canStartRepresentation && !hasRecentActorMfa(principal)',
    )
  })

  it('keeps recent MFA enforcement at impersonation start', () => {
    const service = source('lib/server/impersonation-service.ts')

    expect(service).toContain('if (!hasRecentActorMfa(principal))')
    expect(service).toContain("'IMPERSONATION_MFA_REQUIRED'")
    expect(service).toContain('assertActorEligible(principal,')
  })
})

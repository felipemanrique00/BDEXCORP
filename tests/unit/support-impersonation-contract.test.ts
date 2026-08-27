import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const source = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('support impersonation security contract', () => {
  it('keeps actor session and impersonation bound to the same tenant', () => {
    const migration = source('deploy/postgres/migrations/0075_support_impersonations.sql')
    expect(migration).toContain('foreign key (tenant_id, active_impersonation_id)')
    expect(migration).toContain('references support_impersonations(tenant_id, id)')
    expect(migration).toContain("expires_at <= started_at + interval '15 minutes'")
    expect(migration).toContain("target_role_key not in ('company_admin', 'requester', 'readonly')")
    expect(migration).toContain("actor_role_key not in ('tenant_admin', 'supervisor', 'agent', 'operator')")
    expect(migration).toContain("target_user_status <> 'active'")
    expect(migration).toContain("mode = 'operate' and cardinality(allowed_actions) > 0")
  })

  it('grants the capability by default only to tenant admin', () => {
    const migration = source('deploy/postgres/migrations/0075_support_impersonations.sql')
    expect(migration).toContain("where role_row.role_key = 'tenant_admin'")
    expect(migration).not.toMatch(/where role_row\.role_key in \([^)]*agent[^)]*\)\s*on conflict \(role_id, permission_key\)/)
  })

  it('closes active representation when the actor session ends', () => {
    const migration = source('deploy/postgres/migrations/0075_support_impersonations.sql')
    expect(migration).toContain('close_impersonation_on_session_end')
    expect(migration).toContain("'auth.impersonation.stop'")
    expect(migration).toContain('new.active_impersonation_id := null')
  })

  it('blocks represented mutations centrally unless explicitly authorized', () => {
    const guard = source('lib/security/api-guard.ts')
    expect(guard).toContain('representationAction?: string')
    expect(guard).toContain('allowDuringRepresentation?: boolean')
    expect(guard).toContain("'IMPERSONATION_READ_ONLY'")
    expect(guard).toContain("'IMPERSONATION_MUTATION_DENIED'")
    expect(guard).toContain('principal.representation.allowedActions.includes')
    expect(guard).toContain('!options.allowDuringRepresentation')
  })

  it('records the real actor and represented identity in audit metadata', () => {
    const audit = source('lib/server/audit-log.ts')
    expect(audit).toContain('principal.actor?.user.id')
    expect(audit).toContain('representationId')
    expect(audit).toContain('representedUserId')
    expect(audit).toContain('representationMode')
  })

  it('exposes the four controlled session endpoints', () => {
    for (const endpoint of ['current', 'targets', 'start', 'stop']) {
      expect(fs.existsSync(path.resolve(process.cwd(), `app/api/auth/impersonation/${endpoint}/route.ts`))).toBe(true)
    }
  })

  it('allows represented corrections only through the governed correction route', () => {
    const migration = source('deploy/postgres/migrations/0079_support_impersonation_demand_correction.sql')
    const policy = source('lib/impersonation-action-policy.ts')
    const route = source('app/api/demands/[id]/route.ts')
    const dialog = source('components/impersonation/impersonation-dialog.tsx')

    expect(migration).toContain("'demand.correct'")
    expect(migration).toContain('support_impersonations_allowed_actions_check')
    expect(policy).toContain("action: 'demand.correct'")
    expect(policy).toContain("actorPermission: 'criar_demandas'")
    expect(policy).toContain("targetPermission: 'criar_demandas'")
    expect(route).toContain("representationAction: 'demand.correct'")
    expect(dialog).toContain("'demand.correct': 'corrigir pedidos devolvidos'")
  })

  it('does not expand the real actor company scope', () => {
    const service = source('lib/server/impersonation-service.ts')
    expect(service).toContain('representationCompanyScope(principal, target)')
    expect(service).toContain('targetCompanyIds.filter((companyId) => actorCompanyIds.has(companyId))')
    expect(service).toContain("'IMPERSONATION_COMPANY_SCOPE_DENIED'")
    expect(service).toContain("'actor_permission_revoked'")
    expect(service).toContain("'company_scope_changed'")
    expect(service).toContain('restrictPrincipalToRepresentationCompanies(target, row.company_ids)')
    expect(service).toContain('tenantWide: false')
    expect(service).toContain("'action_scope_changed'")
    expect(service).toContain('allowedImpersonationActions(actor, target, row.company_ids)')
    expect(service).toContain('allowedImpersonationActions(principal, target, companyIds)')
    expect(service).toContain('mergePermissions(companies.map')
    expect(service).toContain('gerenciar_personificacoes: false')
  })

  it('pins every representation to one explicitly selected shared company', () => {
    const route = source('app/api/auth/impersonation/start/route.ts')
    const client = source('lib/impersonation-client.ts')
    const dialog = source('components/impersonation/impersonation-dialog.tsx')
    const service = source('lib/server/impersonation-service.ts')

    expect(route).toContain('companyId: z.string().trim().min(1).max(200)')
    expect(route).not.toContain('companyId: z.string().uuid()')
    expect(client).toContain('companyScopes: ImpersonationCompanyScope[]')
    expect(client).toContain('companyId: input.companyId.trim()')
    expect(dialog).toContain('Empresa do atendimento *')
    expect(dialog).toContain('selectedCompanyScope.allowedActions')
    expect(service).toContain('const sharedCompanyIds = representationCompanyScope(principal, target)')
    expect(service).toContain('!sharedCompanyIds.includes(selectedCompanyId)')
    expect(service).toContain('const companyIds = [selectedCompanyId]')
    expect(service).toContain('allowedImpersonationActions(principal, target, companyIds)')
    expect(service).toContain('row.company_ids.length !== 1')
    expect(service).toContain('allowedImpersonationActions(actor, target, [companyId])')
  })

  it('keeps the internal representation permission out of corporate profiles', () => {
    const types = source('types/index.ts')
    const corporateAccess = source('lib/corporate-access.ts')
    const editor = source('components/users/corporate-access-editor.tsx')
    expect(types).toMatch(/owner:\s*\{[\s\S]*?gerenciar_personificacoes: false/)
    expect(corporateAccess).toContain("permission !== 'gerenciar_personificacoes'")
    expect(editor).toContain('GENERIC_CORPORATE_PERMISSION_KEYS.map')
  })
})

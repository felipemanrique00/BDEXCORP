import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('assisted selection and approval contracts', () => {
  it('persiste ator real, alvo representado e contexto na escolha', () => {
    const source = read('lib/server/offline-quote-service.ts')
    expect(source).toContain("action: 'quote.select'")
    expect(source).toContain('acting_for_requester_id, acting_for_user_id')
    expect(source).toContain('preparation.actor.actorUserId')
    expect(source).toContain('selection_source')
    expect(source).toContain('representationId: principal.representation?.id || null')
    expect(source).toContain('const actor = await authorizeSelectionActor(client, principal, demand)')
    expect(source).toContain("'OFFLINE_SELECTION_REQUESTER_MISMATCH'")
    expect(source).toContain("'OFFLINE_SELECTION_REPRESENTATION_REQUIRED'")
    expect(read('app/api/offline-travel/quotes/[id]/select/route.ts'))
      .toContain("representationAction: 'quote.select'")
  })

  it('registra decisoes humanas, delegadas e assistidas sem confundir identidades', () => {
    const source = read('lib/server/approval-service.ts')
    expect(source).toContain("source: 'support_assisted'")
    expect(source).toContain("source: 'delegated'")
    expect(source).toContain('decision_source, impersonation_id')
    expect(source).toContain("action: 'approval.decide'")
    expect(source).toContain('assignment.assignee_user_id !== principal.representation.subject.id')
    expect(source).toContain("'APPROVAL_DELEGATION_NO_LONGER_VALID'")
    expect(source).toContain("'APPROVAL_ASSISTED_SOD_CONFLICT'")
    expect(source).toContain("await requireCompanyAccess(principal, instance.company_id, 'decidir_aprovacoes')")
    expect(read('app/api/approvals/assignments/[id]/decision/route.ts'))
      .toContain("representationAction: 'approval.decide'")
  })

  it('mantem validacao de banco fail-closed para contexto, escopo e sessao ativos', () => {
    const migration = read('deploy/postgres/migrations/0076_assisted_quote_selection_and_approval.sql')
    expect(migration).toContain("decision_source in ('human', 'delegated', 'system_passive', 'support_assisted')")
    expect(migration).toContain("'quote.select' = any(context_row.allowed_actions)")
    expect(migration).toContain("'approval.decide' = any(context_row.allowed_actions)")
    expect(migration).toContain('actor_session.active_impersonation_id = context_row.id')
    expect(migration).toContain('foreign key (tenant_id, impersonation_id)')
    expect(migration).toContain('active_approval_delegation_covers_assignment')
  })
})

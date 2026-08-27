import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const companyPage = readFileSync(
  resolve(process.cwd(), 'app/dashboard/empresas/[id]/page.tsx'),
  'utf8',
)
const peopleAccess = readFileSync(
  resolve(process.cwd(), 'components/empresas/company-people-access-tab.tsx'),
  'utf8',
)
const ruleWizard = readFileSync(
  resolve(process.cwd(), 'components/empresas/company-approval-rule-wizard.tsx'),
  'utf8',
)

describe('company approval access UI contract', () => {
  it('keeps corporate people inside the company and never offers an agency identity as approver', () => {
    expect(companyPage).toContain('label: \'Pessoas e acessos\'')
    expect(companyPage).toContain('funcionarios={funcs}')
    expect(peopleAccess).toContain('Autorizadores corporativos')
    expect(peopleAccess).toContain('A equipe interna da agência não é oferecida como autorizador da empresa')
    expect(peopleAccess).toContain("profile: 'approver'")
    expect(peopleAccess).toContain("role: 'colaborador'")
  })

  it('loads effective candidates in company context and preserves an existing direct profile when adding approval rights', () => {
    expect(peopleAccess).toContain('/api/approvals/candidates?companyId=')
    expect(peopleAccess).toContain('offset=${offset}')
    expect(peopleAccess).toContain('candidate.effectivePermissions')
    expect(peopleAccess).toContain('/access`, { cache: \'no-store\' })')
    expect(peopleAccess).toContain('profile: currentGrant.profile as CorporateProfile')
    expect(peopleAccess).toContain('...(currentGrant.permissionOverrides as Partial<Permissoes> || {})')
    expect(peopleAccess).toContain('decidir_aprovacoes: true')
    expect(peopleAccess).not.toContain('user.corporate_profile')
  })

  it('provides distinct self-service groups for audiences and approvers', () => {
    expect(peopleAccess).toContain('Grupos de usuários atendidos')
    expect(peopleAccess).toContain("fetch('/api/approvals/audience-groups'")
    expect(peopleAccess).toContain('employeeId: id')
    expect(peopleAccess).toContain('requesterId: id')
    expect(peopleAccess).toContain('userId: id')
    expect(peopleAccess).toContain('Grupos de autorizadores')
    expect(peopleAccess).toContain("fetch('/api/approvals/approver-groups'")
    expect(peopleAccess).toContain('memberMembershipIds: membershipIds')
    expect(peopleAccess).toContain('Eles não são grupos de autorizadores')
  })

  it('reads inherited group rules explicitly for the open company', () => {
    expect(peopleAccess).toContain('includeInherited=true')
    expect(peopleAccess).toContain('authority.approvalLevel')
    expect(peopleAccess).toContain('authority.department')
    expect(peopleAccess).toContain('authority.audienceGroupId')
  })

  it('keeps inherited group matrices read-only without authority over their full scope', () => {
    expect(companyPage).toContain('groupWorkflowAuthorities')
    expect(companyPage).toContain("authority.accessMode === 'all_companies'")
    expect(peopleAccess).toContain('canManageMatrixScope(matrix.scope')
    expect(peopleAccess).toContain('Matriz herdada: somente leitura')
    expect(ruleWizard).toContain('disabled={!canManageAllGroupCompanies || availableGroupCompanies.length > 100}')
    expect(ruleWizard).toContain('disabled={!canManageCompany}')
    expect(ruleWizard).toContain('Remova empresas nas quais você não administra workflows')
  })

  it('creates a rule through the transactional canonical matrix endpoint', () => {
    expect(ruleWizard).toContain("postJson<{ matrix: ApprovalMatrixCreated }>('/api/approvals/matrices'")
    expect(ruleWizard).not.toContain("postJson<{ authority:")
    expect(ruleWizard).not.toContain("postJson<{ workflow:")
    expect(ruleWizard).not.toContain('/revoke`')
    expect(ruleWizard).toContain("mode: input.businessGroupMode")
    expect(ruleWizard).toContain("businessGroupMode === 'selected_companies'")
    expect(ruleWizard).toContain('selectedCompanyIds.length === 0')
  })

  it('loads only approvers eligible across the exact multi-company coverage', () => {
    expect(ruleWizard).toContain("new URLSearchParams({ companyIds: normalizedCompanyIds.join(',') })")
    expect(ruleWizard).toContain("params.set('businessGroupId', empresa.grupo_id)")
    expect(ruleWizard).toContain("params.set('allCompanies', 'true')")
    expect(ruleWizard).toContain('loadWizardApprovalCandidates(groupCandidateRequest.url')
    expect(ruleWizard).toContain('Validando quem pode decidir em todas as empresas abrangidas')
    expect(ruleWizard).toContain('Nenhum autorizador possui permissão explícita')
    expect(ruleWizard).toContain('O autorizador N1 não possui permissão para decidir em todo o escopo')
    expect(ruleWizard).toContain('O autorizador N2 não possui permissão para decidir em todo o escopo')
    expect(ruleWizard).toContain('groupApproverControlsDisabled')
    expect(companyPage).toContain('company.ativa')
  })

  it('lists persisted matrices and completes maker-checker activation in the company screen', () => {
    expect(peopleAccess).toContain('/api/approvals/matrices?companyId=')
    expect(peopleAccess).toContain('/transition`')
    expect(peopleAccess).toContain('action: matrix.nextAction')
    expect(peopleAccess).toContain('expectedVersion: matrix.version')
    expect(peopleAccess).toContain('Outra pessoa administradora deve concluir esta etapa')
    expect(peopleAccess).toContain('Publicar e ativar')
    expect(peopleAccess).toContain('Inspecionar workflow')
    expect(peopleAccess).toContain('Inspecionar política')
  })

  it('keeps rule validity on authorities and enforces two distinct approval levels', () => {
    expect(ruleWizard).toContain('validUntil: validUntilIso')
    expect(ruleWizard).toContain("workflow: {\n          name:")
    expect(ruleWizard).not.toContain('workflow: {\n          validUntil:')
    expect(ruleWizard).toContain("N1 e N2 devem ser pessoas diferentes")
    expect(ruleWizard.match(/approvalKind: kind,/g)).toHaveLength(2)
    expect(ruleWizard).not.toContain("approvalKind: 'second_level'")
    expect(ruleWizard).toContain("A alçada de N2 é inválida")
    expect(ruleWizard).toContain('O servidor aciona N2')
    expect(ruleWizard).toContain('Violação de política')
    expect(ruleWizard).toContain('ultrapassar a alçada de N1')
  })
})

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
const assignApproverModal = peopleAccess.slice(
  peopleAccess.indexOf('function AssignApproverModal('),
  peopleAccess.indexOf('function ApproverGroupManagerModal('),
)

describe('company approval access UI contract', () => {
  it('assigns authorization from the company employee directory instead of a free-form user invite', () => {
    expect(companyPage).toContain('label: \'Pessoas e acessos\'')
    expect(companyPage).toContain('funcionarios={funcs}')
    expect(peopleAccess).toContain('Autorizadores corporativos')
    expect(peopleAccess).toContain('A equipe interna da agência não é oferecida como autorizador da empresa')
    expect(peopleAccess).toContain('/api/companies/${encodeURIComponent(companyId)}/approvers')
    expect(peopleAccess).toContain('Array.isArray(payload?.employees)')
    expect(assignApproverModal).toContain('Buscar funcionário')
    expect(assignApproverModal).not.toContain("fetch('/api/users'")
    expect(assignApproverModal).not.toContain('Convidar nova pessoa')
    expect(assignApproverModal).not.toContain('Também pode solicitar viagens')
    expect(assignApproverModal).not.toContain('E-mail corporativo')
  })

  it('searches the minimum employee projection by name, registration, department and cost center', () => {
    expect(assignApproverModal).toContain('Nome, matrícula, departamento ou centro de custo')
    expect(peopleAccess).toContain('employee.registrationCode')
    expect(peopleAccess).toContain('employee.department')
    expect(peopleAccess).toContain('employee.costCenter')
    expect(peopleAccess).toContain('normalizeEmployeeSearch')
    expect(assignApproverModal).not.toContain('documentNumber')
    expect(assignApproverModal).not.toContain('telefone')
    expect(assignApproverModal).not.toContain('cpf')
  })

  it('requires an explicit second action before sending the identity membership', () => {
    expect(assignApproverModal).toContain("employeeId: selectedEmployee.employeeId")
    expect(assignApproverModal).toContain('const confirmedMembershipId = expectedMembershipId')
    expect(assignApproverModal).toContain('...(confirmedMembershipId ? { expectedMembershipId: confirmedMembershipId } : {})')
    expect(assignApproverModal).toContain("payload?.code === 'EMPLOYEE_AUTHORIZER_IDENTITY_CONFIRMATION_REQUIRED'")
    expect(assignApproverModal).toContain('payload?.candidate?.membershipId')
    expect(assignApproverModal).toContain('Confirme a identidade antes de vincular')
    expect(assignApproverModal).toContain('assignEmployee(identityCandidate.membershipId)')
    expect(assignApproverModal).toContain('disabled={saving || !selectedEmployee || Boolean(identityCandidate)}')
    expect(assignApproverModal).not.toContain('companyId: empresa.id')
  })

  it('shows every employee access state and keeps pending invitations out of rule candidates', () => {
    expect(peopleAccess).toContain("label: 'Sem login'")
    expect(peopleAccess).toContain("label: 'Identidade a confirmar'")
    expect(peopleAccess).toContain("label: 'Convite pendente'")
    expect(peopleAccess).toContain("label: 'Convite expirado'")
    expect(peopleAccess).toContain("label: 'Envio do convite pendente'")
    expect(peopleAccess).toContain("label: 'Ativo'")
    expect(peopleAccess).toContain("label: 'Bloqueado'")
    expect(peopleAccess).toContain("label: 'Sem e-mail'")
    expect(peopleAccess).toContain("'pending_activation'")
    expect(peopleAccess).toContain('employee.canEnterRules')
    expect(peopleAccess).toContain('hasManagedLink: item.hasManagedLink === true')
    expect(peopleAccess).toContain('return employee.hasManagedLink || employee.canEnterRules')
    expect(peopleAccess).toContain('Aguarda ativação')
  })

  it('removes or cancels only an established authorizer lifecycle while preserving the remaining employee access', () => {
    expect(peopleAccess).toContain("method: 'DELETE'")
    expect(peopleAccess).toContain('body: JSON.stringify({ employeeId: employee.employeeId })')
    expect(peopleAccess).toContain("approvalStatus === 'active' && employee.canEnterRules")
    expect(peopleAccess).toContain("approvalStatus === 'pending_activation'")
    expect(peopleAccess).toContain("approvalStatus === 'blocked' && employee.blockedReason === 'effective_access_missing'")
    expect(peopleAccess).toContain('Remover função de autorizador')
    expect(peopleAccess).toContain('Cancelar atribuição de autorizador')
    expect(peopleAccess).toContain('O login, o perfil de solicitante e todos os demais acessos corporativos serão preservados')
    expect(peopleAccess).toContain('if (response.status === 409)')
    expect(peopleAccess).toContain("toast.error(payload?.error")
    expect(peopleAccess).toContain('await reloadApproverAccess()')
    expect(peopleAccess).toContain("identity === 'invited') return 'invited_login'")
    expect(peopleAccess).toContain("'invited_login', 'confirmation_required'")
    expect(peopleAccess).toContain('Não atribuído · pode atribuir novamente')
    expect(peopleAccess).toContain("if (state === 'revoked') return 'O vínculo deste funcionário foi revogado")
  })

  it('persists a failed invitation delivery state and resends through the dedicated employee action', () => {
    expect(peopleAccess).toContain("invitationState: 'not_required' | 'sent' | 'delivery_pending'")
    expect(peopleAccess).toContain("invitationState: parseEmployeeInvitationState(item.invitationState)")
    expect(peopleAccess).toContain('inviteExpiresAt: nullableDirectoryString(item.inviteExpiresAt)')
    expect(peopleAccess).toContain('resendable: item.resendable === true')
    expect(peopleAccess).toContain('reassignable: item.reassignable === true')
    expect(peopleAccess).toContain("state === 'revoked' && employee.reassignable")
    expect(peopleAccess).toContain('selectedEmployee.reassignable ? selectedEmployee.membershipId : null')
    expect(peopleAccess).toContain("employee.invitationState === 'delivery_pending'")
    expect(peopleAccess).toContain('O convite não foi entregue. Verifique o serviço de e-mail e tente reenviar.')
    expect(peopleAccess).toContain("employee.approvalStatus.trim().toLowerCase() === 'pending_activation'")
    expect(peopleAccess).toContain("employee.identityStatus.trim().toLowerCase() === 'invited'")
    expect(peopleAccess).toContain('&& employee.resendable')
    expect(peopleAccess).toContain('Date.parse(employee.inviteExpiresAt)')
    expect(peopleAccess).toContain('expiresAt <= Date.now()')
    expect(peopleAccess).toContain('Convite ainda não aceito. Você pode reenviá-lo se necessário.')
    expect(peopleAccess).not.toContain("employee.invitationState === 'sent' && employee.resendable")
    expect(peopleAccess).toContain("body: JSON.stringify({ employeeId: employee.employeeId, action: 'resend_invite' })")
    expect(peopleAccess).toContain('Reenviar convite')
    expect(peopleAccess).toContain("payload?.invitation?.state === 'delivery_pending'")
  })

  it('keeps active rule candidates separate from the employee assignment directory', () => {
    expect(peopleAccess).toContain('/api/approvals/candidates?companyId=')
    expect(peopleAccess).toContain('offset=${offset}')
    expect(peopleAccess).toContain('candidate.effectivePermissions')
    expect(peopleAccess).toContain('users.filter(isCorporateApprover)')
    expect(peopleAccess).toContain('canEnterRules: item.canEnterRules === true')
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

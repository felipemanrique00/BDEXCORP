'use client'

import Link from 'next/link'
import {
  AlertCircle,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserMinus,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { SolicitantesEmpresaTab } from '@/components/empresas/solicitantes-empresa-tab'
import {
  CompanyApprovalRuleWizard,
  type ApprovalAudienceGroupOption,
  type ApprovalMatrixCreated,
} from '@/components/empresas/company-approval-rule-wizard'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Modal } from '@/components/ui/modal'
import type { CorporateProfile, Empresa, Funcionario, Permissoes, SolicitanteEmpresa, User } from '@/types'

type AccessSection = 'people' | 'approvers' | 'rules'

interface CompanyPeopleAccessTabProps {
  empresa: Empresa
  funcionarios: Funcionario[]
  solicitantes: SolicitanteEmpresa[]
  canEditPeople: boolean
  canManageLogins: boolean
  canViewApprovals: boolean
  canManageApprovals: boolean
  businessGroupName: string | null
  groupCompanies: Array<{ id: string; name: string }>
  manageableGroupCompanyIds: string[]
  canManageAllGroupCompanies: boolean
}

interface ApprovalAuthorityItem {
  id: string
  membershipId: string
  memberName: string
  approvalKind: string
  companyId: string | null
  groupId: string | null
  costCenterId: string | null
  costCenterCode: string | null
  costCenterName: string | null
  department: string | null
  audienceGroupId: string | null
  audienceGroupName: string | null
  approvalLevel: 1 | 2
  maxAmount: number | null
  currency: string | null
  status: string
  validFrom: string
  validUntil: string | null
}

interface CostCenterOption {
  id: string
  code: string
  name: string
}

interface ApprovalAudienceGroupItem extends ApprovalAudienceGroupOption {
  description: string
  status: string
  version: number
  members: Array<{
    id: string
    type: 'employee' | 'requester' | 'user'
    employeeId: string | null
    requesterId: string | null
    userId: string | null
    label: string
    status: string
  }>
}

interface ApprovalApproverGroupItem {
  id: string
  code: string
  name: string
  description: string
  companyId: string | null
  businessGroupId: string | null
  status: string
  version: number
  members: Array<{
    membershipId: string
    userId: string
    name: string
    email: string
    status: string
  }>
}

interface CompanyScopedUser extends User {
  companyProfiles: CorporateProfile[]
  companyPermissions: Permissoes
}

interface ApprovalCandidateItem {
  membershipId: string
  userId: string
  name: string
  email: string
  effectiveProfiles: CorporateProfile[]
  effectivePermissions: Permissoes
  active: boolean
}

interface EmployeeApproverDirectoryItem {
  employeeId: string
  name: string
  registrationCode: string | null
  department: string | null
  costCenter: string | null
  identityStatus: string
  approvalStatus: string
  membershipId: string | null
  canEnterRules: boolean
  hasManagedLink: boolean
  blockedReason: string | null
  requiresIdentityConfirmation: boolean
  invitationState: 'not_required' | 'sent' | 'delivery_pending'
  inviteExpiresAt: string | null
  resendable: boolean
  reassignable: boolean
}

interface EmployeeApproverIdentityCandidate {
  employeeId: string
  membershipId: string
  name: string
}

export function CompanyPeopleAccessTab({
  empresa,
  funcionarios,
  solicitantes,
  canEditPeople,
  canManageLogins,
  canViewApprovals,
  canManageApprovals,
  businessGroupName,
  groupCompanies,
  manageableGroupCompanyIds,
  canManageAllGroupCompanies,
}: CompanyPeopleAccessTabProps) {
  const [section, setSection] = useState<AccessSection>('people')
  const [users, setUsers] = useState<CompanyScopedUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)

  const loadUsers = useCallback(async () => {
    if (!canManageLogins && !canManageApprovals) return
    setUsersLoading(true)
    setUsersError(null)
    try {
      const candidates = await loadApprovalCandidates(empresa.id)
      setUsers(candidates.map(candidateToCompanyUser))
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Não foi possível carregar os acessos corporativos.')
    } finally {
      setUsersLoading(false)
    }
  }, [canManageApprovals, canManageLogins, empresa.id])

  useEffect(() => {
    if (section === 'approvers' || section === 'rules') void loadUsers()
  }, [loadUsers, section])

  const companyUsers = users

  return (
    <div className="space-y-4">
      <section className="bbt-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-base font-semibold text-bbt-primary dark:text-white">
              <UsersRound className="h-5 w-5 text-bbt-accent" />
              Pessoas e acessos — {empresa.nome}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Viajantes, solicitantes e autorizadores pertencem à empresa. Usuários da equipe interna da agência são administrados separadamente.
            </p>
          </div>
          <Link href="/dashboard/usuarios" className="bbt-button-ghost shrink-0">
            <ShieldCheck className="h-4 w-4" />
            Administração geral de usuários
          </Link>
        </div>

        <div className="mt-4 flex w-full gap-1 overflow-x-auto rounded-md bg-bbt-gray-50 p-1 dark:bg-slate-800 sm:w-fit" role="tablist" aria-label="Áreas de pessoas e acessos">
          <SectionButton active={section === 'people'} onClick={() => setSection('people')} icon={UserRound}>
            Pessoas do portal
          </SectionButton>
          <SectionButton active={section === 'approvers'} onClick={() => setSection('approvers')} icon={ShieldCheck}>
            Autorizadores
          </SectionButton>
          <SectionButton active={section === 'rules'} onClick={() => setSection('rules')} icon={GitBranch}>
            Regras de autorização
          </SectionButton>
        </div>
      </section>

      {section === 'people' && (
        <SolicitantesEmpresaTab
          empresa={empresa}
          funcionarios={funcionarios}
          canEdit={canEditPeople}
          canManageLogins={canManageLogins}
        />
      )}

      {section === 'approvers' && (
        <CompanyApproversPanel
          empresa={empresa}
          users={companyUsers}
          loading={usersLoading}
          error={usersError}
          canManage={canManageLogins}
          canManageGroups={canManageApprovals}
          businessGroupName={businessGroupName}
          canManageBusinessGroup={canManageAllGroupCompanies}
          onReload={loadUsers}
        />
      )}

      {section === 'rules' && (
        <CompanyApprovalRulesPanel
          empresa={empresa}
          funcionarios={funcionarios}
          solicitantes={solicitantes}
          users={companyUsers}
          usersLoading={usersLoading}
          canView={canViewApprovals}
          canManage={canManageApprovals}
          businessGroupName={businessGroupName}
          groupCompanies={groupCompanies}
          manageableGroupCompanyIds={manageableGroupCompanyIds}
          canManageAllGroupCompanies={canManageAllGroupCompanies}
        />
      )}
    </div>
  )
}

function CompanyApproversPanel({
  empresa,
  users,
  loading,
  error,
  canManage,
  canManageGroups,
  businessGroupName,
  canManageBusinessGroup,
  onReload,
}: {
  empresa: Empresa
  users: CompanyScopedUser[]
  loading: boolean
  error: string | null
  canManage: boolean
  canManageGroups: boolean
  businessGroupName: string | null
  canManageBusinessGroup: boolean
  onReload: () => Promise<void>
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [employees, setEmployees] = useState<EmployeeApproverDirectoryItem[]>([])
  const [employeesLoading, setEmployeesLoading] = useState(true)
  const [employeesError, setEmployeesError] = useState<string | null>(null)
  const [employeeToRemove, setEmployeeToRemove] = useState<EmployeeApproverDirectoryItem | null>(null)
  const [removingEmployeeId, setRemovingEmployeeId] = useState<string | null>(null)
  const [resendingEmployeeId, setResendingEmployeeId] = useState<string | null>(null)
  const approvers = users.filter(isCorporateApprover)
  const assignedEmployees = employees.filter(isAssignedEmployeeApprover)

  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true)
    setEmployeesError(null)
    try {
      setEmployees(await loadEmployeeApproverDirectory(empresa.id))
    } catch (loadError) {
      setEmployeesError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os funcionários da empresa.')
    } finally {
      setEmployeesLoading(false)
    }
  }, [empresa.id])

  useEffect(() => {
    void loadEmployees()
  }, [loadEmployees])

  async function reloadApproverAccess() {
    await Promise.all([onReload(), loadEmployees()])
  }

  async function removeEmployeeAuthorizer(employee: EmployeeApproverDirectoryItem) {
    if (removingEmployeeId || resendingEmployeeId || !canRemoveEmployeeApprover(employee)) return
    setRemovingEmployeeId(employee.employeeId)
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(empresa.id)}/approvers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee.employeeId }),
      })
      const payload = await response.json().catch(() => null)
      if (response.status === 409) {
        toast.error(payload?.error || 'A função não pode ser removida enquanto houver uma aprovação pendente.')
        await reloadApproverAccess()
        return
      }
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || 'Não foi possível remover a função de autorizador.')
      }
      toast.success('Função de autorizador removida. O login e os demais acessos foram preservados.')
      await reloadApproverAccess()
    } catch (removeError) {
      toast.error(removeError instanceof Error ? removeError.message : 'Não foi possível remover a função de autorizador.')
    } finally {
      setRemovingEmployeeId(null)
    }
  }

  async function resendEmployeeAuthorizerInvite(employee: EmployeeApproverDirectoryItem) {
    if (removingEmployeeId || resendingEmployeeId || !canResendEmployeeApproverInvite(employee)) return
    setResendingEmployeeId(employee.employeeId)
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(empresa.id)}/approvers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee.employeeId, action: 'resend_invite' }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || 'Não foi possível reenviar o convite do autorizador.')
      }
      if (payload?.invitation?.state === 'delivery_pending') {
        toast.error('O convite ainda não foi entregue. Verifique o serviço de e-mail e tente novamente.')
      } else {
        toast.success('Convite do autorizador reenviado.')
      }
      await loadEmployees()
    } catch (resendError) {
      toast.error(resendError instanceof Error ? resendError.message : 'Não foi possível reenviar o convite do autorizador.')
      await loadEmployees()
    } finally {
      setResendingEmployeeId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
            <ShieldCheck className="h-5 w-5 text-bbt-accent" />
            Autorizadores corporativos
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            A atribuição concede acesso à fila e à decisão. Centro de custo, alçada e níveis são configurados na aba de regras.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void reloadApproverAccess()} className="bbt-button-ghost" disabled={loading || employeesLoading}>
            <RefreshCw className={`h-4 w-4 ${loading || employeesLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          {canManage && (
            <button type="button" onClick={() => setModalOpen(true)} className="bbt-button-primary">
              <Plus className="h-4 w-4" />
              Atribuir autorizador
            </button>
          )}
          {canManageGroups && (
            <button type="button" onClick={() => setGroupModalOpen(true)} className="bbt-button-outline">
              <UsersRound className="h-4 w-4" />
              Grupos de autorizadores
            </button>
          )}
        </div>
      </div>

      <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
        <strong>Limite de identidade:</strong> esta lista contém somente usuários corporativos vinculados a {empresa.nome}. A equipe interna da agência não é oferecida como autorizador da empresa.
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          Os funcionários continuam visíveis, mas a lista de autorizadores disponíveis para regras não pôde ser atualizada: {error}
        </div>
      )}

      {employeesLoading && assignedEmployees.length === 0 ? (
        <PanelMessage icon={Loader2} label="Carregando autorizadores" spin />
      ) : employeesError ? (
        <PanelMessage icon={AlertCircle} label={employeesError} tone="red" />
      ) : assignedEmployees.length === 0 ? (
        <PanelMessage icon={ShieldCheck} label="Nenhum funcionário foi atribuído como autorizador desta empresa." />
      ) : (
        <div className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-bbt-gray-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60">
                <tr>
                  <th className="px-4 py-3">Pessoa</th>
                  <th className="px-4 py-3">Organização</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Uso nas regras</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
                {assignedEmployees.map((employee) => (
                  <tr key={employee.employeeId} className="hover:bg-bbt-gray-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-bbt-primary dark:text-white">{employee.name}</div>
                      <div className="text-xs text-slate-500">{employee.registrationCode ? `Matrícula ${employee.registrationCode}` : 'Sem matrícula informada'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{employee.department || 'Departamento não informado'}</div>
                      <div className="text-xs text-slate-500">{employee.costCenter || 'Centro de custo não informado'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <EmployeeApproverStatus employee={employee} />
                      {employee.invitationState === 'delivery_pending' && (
                        <p className="mt-1 max-w-56 text-[11px] leading-relaxed text-red-600 dark:text-red-300">
                          O convite não foi entregue. Verifique o serviço de e-mail e tente reenviar.
                        </p>
                      )}
                      {isEmployeeApproverInviteExpired(employee) && (
                        <p className="mt-1 max-w-56 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                          O convite expirou{formatEmployeeApproverInviteExpiry(employee.inviteExpiresAt)}. Reenvie para gerar um novo acesso.
                        </p>
                      )}
                      {canResendEmployeeApproverInvite(employee)
                        && !isEmployeeApproverInviteExpired(employee)
                        && employee.invitationState !== 'delivery_pending' && (
                        <p className="mt-1 max-w-56 text-[11px] leading-relaxed text-slate-500">
                          Convite ainda não aceito. Você pode reenviá-lo se necessário.
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {employee.canEnterRules ? (
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Disponível</span>
                      ) : isEmployeeApproverUnassigned(employee) ? (
                        <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">Não atribuído · pode atribuir novamente</span>
                      ) : (
                        <span className="text-xs text-amber-700 dark:text-amber-300">Aguarda ativação</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage && (canRemoveEmployeeApprover(employee) || canResendEmployeeApproverInvite(employee)) ? (
                        <div className="flex flex-col items-end gap-2">
                          {canResendEmployeeApproverInvite(employee) && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-bbt-accent hover:underline disabled:cursor-wait disabled:opacity-60"
                              disabled={Boolean(removingEmployeeId) || Boolean(resendingEmployeeId)}
                              onClick={() => void resendEmployeeAuthorizerInvite(employee)}
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${resendingEmployeeId === employee.employeeId ? 'animate-spin' : ''}`} />
                              Reenviar convite
                            </button>
                          )}
                          {canRemoveEmployeeApprover(employee) && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:underline disabled:cursor-wait disabled:opacity-60 dark:text-red-300 dark:hover:text-red-200"
                              disabled={Boolean(removingEmployeeId) || Boolean(resendingEmployeeId)}
                              onClick={() => setEmployeeToRemove(employee)}
                            >
                              {removingEmployeeId === employee.employeeId
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <UserMinus className="h-3.5 w-3.5" />}
                              {employeeApproverRemovalLabel(employee)}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AssignApproverModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        empresa={empresa}
        employees={employees}
        loading={employeesLoading}
        error={employeesError}
        onReload={loadEmployees}
        onSaved={async () => {
          setModalOpen(false)
          await reloadApproverAccess()
        }}
      />

      <ApproverGroupManagerModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        empresa={empresa}
        businessGroupName={businessGroupName}
        canManageBusinessGroup={canManageBusinessGroup}
        approvers={approvers}
      />

      <ConfirmDialog
        open={Boolean(employeeToRemove)}
        onClose={() => setEmployeeToRemove(null)}
        onConfirm={() => {
          if (employeeToRemove) void removeEmployeeAuthorizer(employeeToRemove)
        }}
        title={employeeToRemove ? employeeApproverRemovalLabel(employeeToRemove) : 'Remover função de autorizador'}
        message={employeeToRemove
          ? employeeApproverRemovalConfirmation(employeeToRemove)
          : 'O login e todos os demais acessos corporativos serão preservados.'}
        confirmLabel={employeeToRemove?.approvalStatus === 'pending_activation' ? 'Cancelar atribuição' : 'Remover função'}
        danger
      />
    </div>
  )
}

function AssignApproverModal({
  open,
  onClose,
  empresa,
  employees,
  loading,
  error,
  onReload,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  empresa: Empresa
  employees: EmployeeApproverDirectoryItem[]
  loading: boolean
  error: string | null
  onReload: () => Promise<void>
  onSaved: () => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [identityCandidate, setIdentityCandidate] = useState<EmployeeApproverIdentityCandidate | null>(null)
  const [saving, setSaving] = useState(false)
  const normalizedSearch = normalizeEmployeeSearch(search)
  const filteredEmployees = useMemo(() => employees.filter((employee) => (
    !normalizedSearch || employeeSearchText(employee).includes(normalizedSearch)
  )), [employees, normalizedSearch])
  const selectedEmployee = employees.find((employee) => employee.employeeId === selectedEmployeeId) || null

  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelectedEmployeeId('')
    setIdentityCandidate(null)
    setSaving(false)
  }, [open])

  function selectEmployee(employeeId: string) {
    setSelectedEmployeeId(employeeId)
    setIdentityCandidate(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await assignEmployee()
  }

  async function assignEmployee(expectedMembershipId?: string) {
    if (saving) return
    if (!selectedEmployee) return toast.error('Selecione um funcionário da empresa.')
    if (!canAssignEmployeeApprover(selectedEmployee)) return toast.error(employeeApproverUnavailableReason(selectedEmployee))

    setSaving(true)
    try {
      const confirmedMembershipId = expectedMembershipId
        || (selectedEmployee.reassignable ? selectedEmployee.membershipId : null)
      const response = await fetch(`/api/companies/${encodeURIComponent(empresa.id)}/approvers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmployee.employeeId,
          ...(confirmedMembershipId ? { expectedMembershipId: confirmedMembershipId } : {}),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (response.status === 409 && payload?.code === 'EMPLOYEE_AUTHORIZER_IDENTITY_CONFIRMATION_REQUIRED') {
        const membershipId = typeof payload?.candidate?.membershipId === 'string' ? payload.candidate.membershipId : ''
        if (!membershipId) throw new Error(payload?.error || 'Não foi possível confirmar a identidade encontrada.')
        setIdentityCandidate({
          employeeId: selectedEmployee.employeeId,
          membershipId,
          name: typeof payload?.candidate?.name === 'string' ? payload.candidate.name : selectedEmployee.name,
        })
        return
      }
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível atribuir o autorizador.')
      const invitationState = payload?.invitation?.state
      toast.success(invitationState === 'sent'
        ? 'Autorizador atribuído e convite enviado.'
        : invitationState === 'delivery_pending'
          ? 'Autorizador atribuído. O convite aguarda envio.'
          : 'Autorizador atribuído.')
      await onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atribuir o autorizador.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Atribuir autorizador corporativo" size="lg">
      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
          O autorizador será vinculado somente a <strong>{empresa.nome}</strong>. A alçada e os níveis serão configurados separadamente.
        </div>

        <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
          Buscar funcionário
          <span className="relative mt-1.5 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bbt-input pl-9"
              placeholder="Nome, matrícula, departamento ou centro de custo"
              autoComplete="off"
            />
          </span>
        </label>

        <div className="max-h-[24rem] overflow-y-auto rounded-md border border-bbt-gray-100 dark:border-slate-700">
          {loading ? (
            <PanelMessage icon={Loader2} label="Carregando funcionários" spin />
          ) : error ? (
            <div className="space-y-3 p-4 text-center">
              <PanelMessage icon={AlertCircle} label={error} tone="red" />
              <button type="button" className="bbt-button-ghost" onClick={() => void onReload()}>Tentar novamente</button>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Nenhum funcionário encontrado.</p>
          ) : (
            <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
              {filteredEmployees.map((employee) => {
                const selectable = canAssignEmployeeApprover(employee)
                const selected = employee.employeeId === selectedEmployeeId
                return (
                  <button
                    key={employee.employeeId}
                    type="button"
                    onClick={() => selectable && selectEmployee(employee.employeeId)}
                    disabled={!selectable || saving}
                    title={selectable ? `Selecionar ${employee.name}` : employeeApproverUnavailableReason(employee)}
                    className={`flex w-full items-start justify-between gap-3 p-3 text-left transition ${selected ? 'bg-cyan-50 ring-1 ring-inset ring-cyan-300 dark:bg-cyan-950/30' : 'hover:bg-bbt-gray-50 dark:hover:bg-slate-800/50'} disabled:cursor-not-allowed disabled:opacity-65`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-bbt-primary dark:text-white">{employee.name}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {[employee.registrationCode ? `Matrícula ${employee.registrationCode}` : null, employee.department, employee.costCenter].filter(Boolean).join(' · ') || 'Dados organizacionais não informados'}
                      </span>
                    </span>
                    <EmployeeApproverStatus employee={employee} />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {identityCandidate?.employeeId === selectedEmployeeId && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <strong className="block">Confirme a identidade antes de vincular</strong>
            <p className="mt-1 text-xs">
              Já existe uma conta corporativa em nome de <strong>{identityCandidate.name}</strong>. Confirme somente se ela pertence ao funcionário <strong>{selectedEmployee?.name}</strong>.
            </p>
            <button
              type="button"
              className="bbt-button-primary mt-3"
              disabled={saving}
              onClick={() => void assignEmployee(identityCandidate.membershipId)}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar identidade e atribuir
            </button>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="bbt-button-ghost" disabled={saving}>Cancelar</button>
          <button type="submit" className="bbt-button-primary" disabled={saving || !selectedEmployee || Boolean(identityCandidate)}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Atribuir autorizador
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ApproverGroupManagerModal({
  open,
  onClose,
  empresa,
  businessGroupName,
  canManageBusinessGroup,
  approvers,
}: {
  open: boolean
  onClose: () => void
  empresa: Empresa
  businessGroupName: string | null
  canManageBusinessGroup: boolean
  approvers: CompanyScopedUser[]
}) {
  const [groups, setGroups] = useState<ApprovalApproverGroupItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'company' | 'business_group'>('company')
  const [membershipIds, setMembershipIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const urls = [
        `/api/approvals/approver-groups?companyId=${encodeURIComponent(empresa.id)}&limit=200`,
        ...(empresa.grupo_id && canManageBusinessGroup
          ? [`/api/approvals/approver-groups?businessGroupId=${encodeURIComponent(empresa.grupo_id)}&limit=200`]
          : []),
      ]
      const payloads = await Promise.all(urls.map(async (url) => {
        const response = await fetch(url, { cache: 'no-store' })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !Array.isArray(payload?.items)) throw new Error(payload?.error || 'Não foi possível carregar os grupos de autorizadores.')
        return payload.items as ApprovalApproverGroupItem[]
      }))
      setGroups(payloads.flat())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os grupos de autorizadores.')
    } finally {
      setLoading(false)
    }
  }, [canManageBusinessGroup, empresa.grupo_id, empresa.id])

  useEffect(() => {
    if (!open) return
    setName('')
    setCode('')
    setCodeTouched(false)
    setDescription('')
    setScope('company')
    setMembershipIds([])
    setSaving(false)
    void load()
  }, [load, open])

  function toggleMembership(membershipId: string) {
    setMembershipIds((current) => current.includes(membershipId)
      ? current.filter((id) => id !== membershipId)
      : [...current, membershipId])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    if (name.trim().length < 2) return toast.error('Informe o nome do grupo de autorizadores.')
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(code)) return toast.error('Use um código em minúsculas, sem espaços.')
    if (membershipIds.length === 0) return toast.error('Selecione ao menos um autorizador.')

    setSaving(true)
    try {
      const response = await fetch('/api/approvals/approver-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          name: name.trim(),
          description: description.trim(),
          ...(scope === 'business_group' ? { businessGroupId: empresa.grupo_id } : { companyId: empresa.id }),
          memberMembershipIds: membershipIds,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Não foi possível criar o grupo de autorizadores.')
      toast.success('Grupo de autorizadores criado.')
      setName('')
      setCode('')
      setCodeTouched(false)
      setDescription('')
      setMembershipIds([])
      await load()
    } catch (submitError) {
      toast.error(submitError instanceof Error ? submitError.message : 'Não foi possível criar o grupo de autorizadores.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Grupos de autorizadores" size="xl">
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Grupos cadastrados</h3>
          <p className="mt-1 text-xs text-slate-500">Coleções reutilizáveis de quem pode aprovar. Não representam o público atendido pela regra.</p>
          <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {loading ? <PanelMessage icon={Loader2} label="Carregando grupos" spin /> : error ? <PanelMessage icon={AlertCircle} label={error} tone="red" /> : groups.length === 0 ? (
              <div className="rounded-md border border-dashed border-bbt-gray-100 p-4 text-center text-xs text-slate-500 dark:border-slate-700">Nenhum grupo de autorizadores criado.</div>
            ) : groups.map((group) => (
              <div key={group.id} className="rounded-md border border-bbt-gray-100 p-3 dark:border-slate-700">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-bbt-primary dark:text-white">{group.name}</div>
                    <div className="text-[11px] text-slate-400"><code>{group.code}</code> · {group.businessGroupId ? 'grupo empresarial' : empresa.nome}</div>
                  </div>
                  <span className="bbt-badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{group.members.length} membro(s)</span>
                </div>
                {group.members.length > 0 && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{group.members.map((member) => member.name).join(', ')}</p>}
              </div>
            ))}
          </div>
        </section>

        <form onSubmit={submit} className="space-y-4 border-t border-bbt-gray-100 pt-5 dark:border-slate-700 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Criar grupo de autorizadores</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Nome
              <input value={name} onChange={(event) => { const value = event.target.value; setName(value); if (!codeTouched) setCode(slugifyGroupCode(value)) }} className="bbt-input mt-1.5" maxLength={160} required />
            </label>
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Código
              <input value={code} onChange={(event) => { setCodeTouched(true); setCode(event.target.value.toLowerCase()) }} className="bbt-input mt-1.5" maxLength={80} pattern="[a-z0-9]+([._-][a-z0-9]+)*" required />
            </label>
          </div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
            Descrição (opcional)
            <input value={description} onChange={(event) => setDescription(event.target.value)} className="bbt-input mt-1.5" maxLength={1000} />
          </label>
          {empresa.grupo_id && canManageBusinessGroup && (
            <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Escopo do grupo de autorizadores
              <select value={scope} onChange={(event) => setScope(event.target.value as 'company' | 'business_group')} className="bbt-input mt-1.5">
                <option value="company">Somente {empresa.nome}</option>
                <option value="business_group">Grupo empresarial {businessGroupName || ''}</option>
              </select>
            </label>
          )}
          <fieldset>
            <legend className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Autorizadores ({membershipIds.length})</legend>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-bbt-gray-100 p-2 dark:border-slate-700">
              {approvers.length === 0 ? <p className="p-3 text-center text-xs text-slate-500">Atribua autorizadores corporativos antes de criar um grupo.</p> : approvers.map((user) => (
                <label key={user.membership_id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-bbt-gray-50 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={membershipIds.includes(user.membership_id || '')} onChange={() => user.membership_id && toggleMembership(user.membership_id)} className="mt-0.5" />
                  <span className="min-w-0 text-sm"><strong className="block truncate text-bbt-primary dark:text-white">{user.name}</strong><span className="block truncate text-xs text-slate-500">{user.email}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {scope === 'business_group' && <p className="text-xs text-amber-700 dark:text-amber-300">O backend valida o acesso corporativo dos membros ao grupo antes de salvar.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="bbt-button-ghost" onClick={onClose} disabled={saving}>Fechar</button>
            <button type="submit" className="bbt-button-primary" disabled={saving || approvers.length === 0}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Criar grupo</button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

function CompanyApprovalRulesPanel({
  empresa,
  funcionarios,
  solicitantes,
  users,
  usersLoading,
  canView,
  canManage,
  businessGroupName,
  groupCompanies,
  manageableGroupCompanyIds,
  canManageAllGroupCompanies,
}: {
  empresa: Empresa
  funcionarios: Funcionario[]
  solicitantes: SolicitanteEmpresa[]
  users: CompanyScopedUser[]
  usersLoading: boolean
  canView: boolean
  canManage: boolean
  businessGroupName: string | null
  groupCompanies: Array<{ id: string; name: string }>
  manageableGroupCompanyIds: string[]
  canManageAllGroupCompanies: boolean
}) {
  const [authorities, setAuthorities] = useState<ApprovalAuthorityItem[]>([])
  const [matrices, setMatrices] = useState<ApprovalMatrixCreated[]>([])
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([])
  const [audienceGroups, setAudienceGroups] = useState<ApprovalAudienceGroupItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [audienceManagerOpen, setAudienceManagerOpen] = useState(false)

  const load = useCallback(async () => {
    if (!canManage) return
    setLoading(true)
    setError(null)
    try {
      const [matrixResponse, authorityResponse, costCenterResponse, audienceGroupResponse] = await Promise.all([
        fetch(`/api/approvals/matrices?companyId=${encodeURIComponent(empresa.id)}&includeInherited=true&limit=200`, { cache: 'no-store' }),
        fetch(`/api/approvals/authorities?companyId=${encodeURIComponent(empresa.id)}&includeInherited=true&limit=200`, { cache: 'no-store' }),
        fetch(`/api/cost-centers?companyId=${encodeURIComponent(empresa.id)}&includeInactive=true`, { cache: 'no-store' }),
        fetch(`/api/approvals/audience-groups?companyId=${encodeURIComponent(empresa.id)}&limit=200`, { cache: 'no-store' }),
      ])
      const [matrixPayload, authorityPayload, costCenterPayload, audienceGroupPayload] = await Promise.all([
        matrixResponse.json().catch(() => null),
        authorityResponse.json().catch(() => null),
        costCenterResponse.json().catch(() => null),
        audienceGroupResponse.json().catch(() => null),
      ])
      if (!matrixResponse.ok || !Array.isArray(matrixPayload?.items)) {
        throw new Error(matrixPayload?.error || 'Não foi possível carregar as matrizes de autorização.')
      }
      if (!authorityResponse.ok || !Array.isArray(authorityPayload?.items)) {
        throw new Error(authorityPayload?.error || 'Não foi possível carregar as alçadas.')
      }
      if (!costCenterResponse.ok || !Array.isArray(costCenterPayload?.items)) {
        throw new Error(costCenterPayload?.error || 'Não foi possível carregar os centros de custo.')
      }
      if (!audienceGroupResponse.ok || !Array.isArray(audienceGroupPayload?.items)) {
        throw new Error(audienceGroupPayload?.error || 'Não foi possível carregar os grupos de usuários.')
      }
      const nextCostCenters = normalizeCostCenters(costCenterPayload.items)
      const costCenterIds = new Set(nextCostCenters.map((item) => item.id))
      setCostCenters(nextCostCenters)
      setMatrices(matrixPayload.items)
      setAudienceGroups(audienceGroupPayload.items.map((item: Record<string, unknown>) => ({
        id: String(item.id || ''),
        name: String(item.name || item.code || 'Grupo sem nome'),
        code: String(item.code || ''),
        description: String(item.description || ''),
        status: String(item.status || 'active'),
        version: Number(item.version || 1),
        members: Array.isArray(item.members) ? item.members : [],
      })).filter((item: ApprovalAudienceGroupItem) => item.id))
      setAuthorities(authorityPayload.items.filter((item: ApprovalAuthorityItem) => (
        item.companyId === empresa.id
        || Boolean(item.costCenterId && costCenterIds.has(item.costCenterId))
        || Boolean(empresa.grupo_id && item.groupId === empresa.grupo_id)
      )))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as regras de autorização.')
    } finally {
      setLoading(false)
    }
  }, [canManage, empresa.grupo_id, empresa.id])

  useEffect(() => { void load() }, [load])

  if (!canView) {
    return <PanelMessage icon={AlertCircle} label="Você não possui permissão para visualizar aprovações nesta empresa." tone="red" />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
            <GitBranch className="h-5 w-5 text-bbt-accent" />
            Regras de autorização
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            A regra combina escopo, alçada e sequência. O vínculo de pessoa sozinho não cria um fluxo.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="bbt-button-ghost" disabled={loading || !canManage}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <RuleConcept icon={Building2} title="Escopo" description="Empresa, centro de custo, departamento ou grupo de usuários." />
        <RuleConcept icon={CircleDollarSign} title="Alçada" description="Limite monetário e vigência de cada autorizador." />
        <RuleConcept icon={ShieldCheck} title="Nível 1" description="Primeira decisão exigida pelo fluxo da empresa." />
        <RuleConcept icon={GitBranch} title="Nível 2" description="Etapa condicional derivada no servidor por violação de política ou estouro da alçada." />
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
        <strong>Precedência recomendada:</strong> centro de custo, departamento ou grupo de usuários prevalece sobre a regra geral da empresa. Regras do grupo empresarial devem ser criadas no grupo e aparecem aqui como herdadas.
      </div>

      {!canManage ? (
        <PanelMessage icon={AlertCircle} label="A consulta técnica das alçadas exige permissão para gerenciar workflows." />
      ) : loading && authorities.length === 0 ? (
        <PanelMessage icon={Loader2} label="Carregando alçadas" spin />
      ) : error ? (
        <PanelMessage icon={AlertCircle} label={error} tone="red" />
      ) : (
        <AuthorityTable authorities={authorities} empresa={empresa} />
      )}

      {canManage && (
        <MatrixGovernancePanel
          matrices={matrices}
          empresa={empresa}
          businessGroupName={businessGroupName}
          groupCompanies={groupCompanies}
          manageableGroupCompanyIds={manageableGroupCompanyIds}
          canManageAllGroupCompanies={canManageAllGroupCompanies}
          onReload={load}
        />
      )}

      <div className="bbt-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-bbt-primary dark:text-white">Parametrização disponível</h3>
            <p className="mt-1 text-xs text-slate-500">
              {usersLoading
                ? 'Carregando pessoas aptas a aprovar.'
                : `${users.filter(isCorporateApprover).length} autorizador(es) corporativo(s) · ${costCenters.length} centro(s) de custo · ${audienceGroups.length} grupo(s) de usuários.`}
            </p>
          </div>
          {canManage && (
            <button type="button" className="bbt-button-outline" onClick={() => setAudienceManagerOpen(true)}>
              <UsersRound className="h-4 w-4" />
              Grupos de usuários atendidos
            </button>
          )}
          <Link href="/dashboard/workflows" className="bbt-button-outline">
            <GitBranch className="h-4 w-4" />
            Abrir workflows
          </Link>
          {canManage && (
            <button type="button" className="bbt-button-primary" onClick={() => setWizardOpen(true)} disabled={usersLoading || users.filter(isCorporateApprover).length === 0}>
              <Plus className="h-4 w-4" />
              Nova regra
            </button>
          )}
        </div>
        {users.filter(isCorporateApprover).length === 0 && <p className="mt-3 text-xs text-amber-700">Atribua ao menos um autorizador corporativo antes de criar a matriz.</p>}
      </div>

      <CompanyApprovalRuleWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        empresa={empresa}
        approvers={users.filter(isCorporateApprover)}
        costCenters={costCenters}
        departments={uniqueDepartments(funcionarios)}
        audienceGroups={audienceGroups}
        businessGroupName={businessGroupName}
        groupCompanies={groupCompanies}
        manageableGroupCompanyIds={manageableGroupCompanyIds}
        canManageAllGroupCompanies={canManageAllGroupCompanies}
        onCreated={async () => {
          setWizardOpen(false)
          await load()
        }}
      />

      <AudienceGroupManagerModal
        open={audienceManagerOpen}
        onClose={() => setAudienceManagerOpen(false)}
        empresa={empresa}
        groups={audienceGroups}
        funcionarios={funcionarios}
        solicitantes={solicitantes}
        users={users}
        onSaved={async () => {
          await load()
        }}
      />
    </div>
  )
}

function MatrixGovernancePanel({
  matrices,
  empresa,
  businessGroupName,
  groupCompanies,
  manageableGroupCompanyIds,
  canManageAllGroupCompanies,
  onReload,
}: {
  matrices: ApprovalMatrixCreated[]
  empresa: Empresa
  businessGroupName: string | null
  groupCompanies: Array<{ id: string; name: string }>
  manageableGroupCompanyIds: string[]
  canManageAllGroupCompanies: boolean
  onReload: () => Promise<void>
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [transitioningId, setTransitioningId] = useState<string | null>(null)

  async function transition(matrix: ApprovalMatrixCreated) {
    if (matrix.nextAction === 'none' || transitioningId) return
    if (!canManageMatrixScope(matrix.scope, manageableGroupCompanyIds, canManageAllGroupCompanies)) {
      return toast.error('Esta matriz herdada exige administração no escopo do grupo empresarial.')
    }
    const reason = (reasons[matrix.matrixId] || '').trim()
    if (reason.length < 10) return toast.error('Informe uma justificativa com ao menos 10 caracteres.')
    if ((matrix.nextAction === 'approve' || matrix.nextAction === 'publish') && matrix.isCreator) {
      return toast.error('Outra pessoa administradora deve concluir esta etapa.')
    }
    setTransitioningId(matrix.matrixId)
    try {
      const response = await fetch(`/api/approvals/matrices/${encodeURIComponent(matrix.matrixId)}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: matrix.nextAction,
          expectedVersion: matrix.version,
          reason,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Não foi possível atualizar a matriz.')
      toast.success(matrix.nextAction === 'submit_review'
        ? 'Matriz enviada para revisão.'
        : matrix.nextAction === 'approve'
          ? 'Matriz, workflow e política aprovados.'
          : 'Matriz publicada; alçadas e fluxo estão ativos.')
      setReasons((current) => ({ ...current, [matrix.matrixId]: '' }))
      await onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar a matriz.')
    } finally {
      setTransitioningId(null)
    }
  }

  return (
    <section className="bbt-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white"><GitBranch className="h-4 w-4 text-bbt-accent" />Revisão e ativação das matrizes</h3>
          <p className="mt-1 text-xs text-slate-500">Fluxo maker-checker: quem cria envia para revisão; outra pessoa aprova e publica o conjunto.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {['Rascunho', 'Em revisão', 'Aprovada', 'Ativa'].map((step, index) => (
            <span key={step} className="inline-flex items-center gap-1 text-slate-500"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{index + 1}</span>{step}</span>
          ))}
        </div>
      </div>

      {matrices.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-bbt-gray-100 p-5 text-center text-sm text-slate-500 dark:border-slate-700">Nenhuma matriz criada para esta empresa.</div>
      ) : (
        <div className="mt-4 space-y-3">
          {matrices.map((matrix) => {
            const creatorBlocked = Boolean(matrix.isCreator && (matrix.nextAction === 'approve' || matrix.nextAction === 'publish'))
            const scopeBlocked = !canManageMatrixScope(matrix.scope, manageableGroupCompanyIds, canManageAllGroupCompanies)
            const canTransition = matrix.nextAction !== 'none' && !creatorBlocked && !scopeBlocked
            return (
              <article key={matrix.matrixId} className={`rounded-md border p-4 ${matrix.bindingState === 'active' ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20' : 'border-bbt-gray-100 dark:border-slate-700'}`}>
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <MatrixStatus status={matrix.status} />
                      <span className="text-sm font-semibold text-bbt-primary dark:text-white">Aprovação de {matrix.stage === 'cost' ? 'custo' : 'mérito'}</span>
                      <span className="text-xs text-slate-500">{matrixScopeLabel(matrix.scope, empresa, businessGroupName, groupCompanies)}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Criada por {matrix.createdBy?.name || 'usuário administrador'} · {matrix.authorityIds.length} alçada(s)</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span>Workflow: <code>{matrix.workflow.code}</code> ({governanceStatusLabel(matrix.workflow.status)})</span>
                      <span>Política: <code>{matrix.policy.code}</code> ({governanceStatusLabel(matrix.policy.status)})</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                      <Link href="/dashboard/workflows" className="text-bbt-accent hover:underline">Inspecionar workflow</Link>
                      <Link href="/dashboard/politicas" className="text-bbt-accent hover:underline">Inspecionar política</Link>
                    </div>
                  </div>

                  {matrix.nextAction !== 'none' && (
                    <div className="w-full shrink-0 space-y-2 xl:w-80">
                      {scopeBlocked ? (
                        <div className="rounded-md bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          Matriz herdada: somente leitura. Gerencie pelo grupo com acesso a todas as empresas abrangidas.
                        </div>
                      ) : creatorBlocked ? (
                        <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Aguardando outra pessoa administradora para {matrix.nextAction === 'approve' ? 'aprovar' : 'publicar e ativar'}.</div>
                      ) : (
                        <>
                          <input
                            value={reasons[matrix.matrixId] || ''}
                            onChange={(event) => setReasons((current) => ({ ...current, [matrix.matrixId]: event.target.value }))}
                            className="bbt-input"
                            minLength={10}
                            maxLength={2000}
                            placeholder="Justificativa auditável (mín. 10 caracteres)"
                          />
                          <button type="button" className="bbt-button-primary w-full justify-center" onClick={() => void transition(matrix)} disabled={!canTransition || Boolean(transitioningId)}>
                            {transitioningId === matrix.matrixId && <Loader2 className="h-4 w-4 animate-spin" />}
                            {matrixActionLabel(matrix.nextAction)}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AudienceGroupManagerModal({
  open,
  onClose,
  empresa,
  groups,
  funcionarios,
  solicitantes,
  users,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  empresa: Empresa
  groups: ApprovalAudienceGroupItem[]
  funcionarios: Funcionario[]
  solicitantes: SolicitanteEmpresa[]
  users: CompanyScopedUser[]
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const memberOptions = useMemo(() => [
    ...funcionarios.filter((item) => item.ativo !== false).map((item) => ({
      key: `employee:${item.id}`,
      type: 'employee' as const,
      id: item.id,
      label: item.nome,
      detail: [item.lotacao, item.email].filter(Boolean).join(' · '),
    })),
    ...solicitantes.filter((item) => item.status === 'ativo').map((item) => ({
      key: `requester:${item.id}`,
      type: 'requester' as const,
      id: item.id,
      label: item.nome,
      detail: [item.departamento, item.email, 'solicitante'].filter(Boolean).join(' · '),
    })),
    ...users.filter((item) => item.ativo !== false).map((item) => ({
      key: `user:${item.id}`,
      type: 'user' as const,
      id: item.id,
      label: item.name,
      detail: `${item.email} · usuário do portal`,
    })),
  ], [funcionarios, solicitantes, users])

  useEffect(() => {
    if (!open) return
    setName('')
    setCode('')
    setCodeTouched(false)
    setDescription('')
    setSelectedMembers([])
    setSaving(false)
  }, [open])

  function changeName(value: string) {
    setName(value)
    if (!codeTouched) setCode(slugifyGroupCode(value))
  }

  function toggleMember(key: string) {
    setSelectedMembers((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    if (name.trim().length < 2) return toast.error('Informe o nome do grupo de usuários.')
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(code)) return toast.error('Use um código em minúsculas, sem espaços.')
    if (selectedMembers.length === 0) return toast.error('Selecione ao menos uma pessoa para o grupo.')

    setSaving(true)
    try {
      const response = await fetch('/api/approvals/audience-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: empresa.id,
          code,
          name: name.trim(),
          description: description.trim(),
          members: selectedMembers.map((key) => {
            const [type, id] = key.split(':', 2)
            return type === 'employee' ? { employeeId: id }
              : type === 'requester' ? { requesterId: id }
                : { userId: id }
          }),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Não foi possível criar o grupo de usuários.')
      toast.success('Grupo de usuários criado.')
      setName('')
      setCode('')
      setCodeTouched(false)
      setDescription('')
      setSelectedMembers([])
      await onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o grupo de usuários.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Grupos de usuários atendidos" size="xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section>
          <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Grupos desta empresa</h3>
          <p className="mt-1 text-xs text-slate-500">Esses grupos representam quem a regra atende. Eles não são grupos de autorizadores.</p>
          <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {groups.length === 0 ? (
              <div className="rounded-md border border-dashed border-bbt-gray-100 p-4 text-center text-xs text-slate-500 dark:border-slate-700">Nenhum grupo criado.</div>
            ) : groups.map((group) => (
              <div key={group.id} className="rounded-md border border-bbt-gray-100 p-3 dark:border-slate-700">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-bbt-primary dark:text-white">{group.name}</div>
                    <div className="text-[11px] text-slate-400"><code>{group.code}</code></div>
                  </div>
                  <span className="bbt-badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{group.members.length} membro(s)</span>
                </div>
                {group.description && <p className="mt-2 text-xs text-slate-500">{group.description}</p>}
                {group.members.length > 0 && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{group.members.map((member) => member.label).join(', ')}</p>}
              </div>
            ))}
          </div>
        </section>

        <form onSubmit={submit} className="space-y-4 border-t border-bbt-gray-100 pt-5 dark:border-slate-700 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div>
            <h3 className="text-sm font-semibold text-bbt-primary dark:text-white">Criar grupo</h3>
            <p className="mt-1 text-xs text-slate-500">Selecione funcionários/viajantes ou usuários corporativos vinculados a {empresa.nome}.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Nome
              <input value={name} onChange={(event) => changeName(event.target.value)} className="bbt-input mt-1.5" maxLength={160} required />
            </label>
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Código
              <input value={code} onChange={(event) => { setCodeTouched(true); setCode(event.target.value.toLowerCase()) }} className="bbt-input mt-1.5" maxLength={80} pattern="[a-z0-9]+([._-][a-z0-9]+)*" required />
            </label>
          </div>
          <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
            Descrição (opcional)
            <input value={description} onChange={(event) => setDescription(event.target.value)} className="bbt-input mt-1.5" maxLength={1000} />
          </label>
          <fieldset>
            <legend className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Membros ({selectedMembers.length})</legend>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-bbt-gray-100 p-2 dark:border-slate-700">
              {memberOptions.length === 0 ? (
                <p className="p-3 text-center text-xs text-slate-500">Nenhuma pessoa disponível nesta empresa.</p>
              ) : memberOptions.map((member) => (
                <label key={member.key} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-bbt-gray-50 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={selectedMembers.includes(member.key)} onChange={() => toggleMember(member.key)} className="mt-0.5" />
                  <span className="min-w-0 text-sm">
                    <strong className="block truncate text-bbt-primary dark:text-white">{member.label}</strong>
                    <span className="block truncate text-xs text-slate-500">{member.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <button type="button" className="bbt-button-ghost" onClick={onClose} disabled={saving}>Fechar</button>
            <button type="submit" className="bbt-button-primary" disabled={saving || memberOptions.length === 0}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar grupo
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

function AuthorityTable({ authorities, empresa }: { authorities: ApprovalAuthorityItem[]; empresa: Empresa }) {
  if (authorities.length === 0) {
    return <PanelMessage icon={BadgeDollarSign} label="Nenhuma alçada configurada para esta empresa." />
  }
  return (
    <div className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-bbt-gray-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60">
            <tr>
              <th className="px-4 py-3">Autorizador</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Escopo</th>
              <th className="px-4 py-3">Alçada</th>
              <th className="px-4 py-3">Vigência</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bbt-gray-100 dark:divide-slate-800">
            {authorities.map((authority) => (
              <tr key={authority.id} className="hover:bg-bbt-gray-50/70 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3 font-semibold text-bbt-primary dark:text-white">{authority.memberName || '—'}</td>
                <td className="px-4 py-3"><span className="font-semibold">N{authority.approvalLevel || 1}</span> · {approvalKindLabel(authority.approvalKind)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{authorityScopeLabel(authority, empresa)}</td>
                <td className="px-4 py-3 tabular-nums">{authority.maxAmount === null ? 'Sem limite' : money(authority.maxAmount, authority.currency || 'BRL')}</td>
                <td className="px-4 py-3 text-xs">{dateRange(authority.validFrom, authority.validUntil)}</td>
                <td className="px-4 py-3"><AuthorityStatus status={authority.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SectionButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded px-3 py-2 text-sm font-semibold transition ${
        active ? 'bg-white text-bbt-primary shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 hover:text-bbt-primary dark:hover:text-white'
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  )
}

function RuleConcept({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="bbt-card p-4">
      <Icon className="h-5 w-5 text-bbt-accent" />
      <div className="mt-2 text-sm font-semibold text-bbt-primary dark:text-white">{title}</div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  )
}

function PanelMessage({
  icon: Icon,
  label,
  spin = false,
  tone = 'slate',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  spin?: boolean
  tone?: 'slate' | 'red'
}) {
  return (
    <div className={`bbt-card flex min-h-36 flex-col items-center justify-center p-6 text-center text-sm ${tone === 'red' ? 'text-red-600' : 'text-slate-500'}`}>
      <Icon className={`mb-2 h-7 w-7 ${spin ? 'animate-spin' : ''}`} />
      {label}
    </div>
  )
}

function EmployeeApproverStatus({ employee }: { employee: EmployeeApproverDirectoryItem }) {
  const state = employeeApproverState(employee)
  const presentation = {
    active: { label: 'Ativo', style: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' },
    login_active: { label: 'Login ativo', style: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-200' },
    invited_login: { label: 'Acesso convidado', style: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-200' },
    pending: { label: 'Convite pendente', style: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200' },
    invite_expired: { label: 'Convite expirado', style: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100' },
    delivery_pending: { label: 'Envio do convite pendente', style: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200' },
    confirmation_required: { label: 'Identidade a confirmar', style: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200' },
    missing_email: { label: 'Sem e-mail', style: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200' },
    blocked: { label: 'Bloqueado', style: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200' },
    revoked: { label: 'Acesso revogado', style: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
    no_login: { label: 'Sem login', style: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  }[state]

  return (
    <span className={`bbt-badge shrink-0 ${presentation.style}`}>
      {state === 'active' && <CheckCircle2 className="h-3 w-3" />}
      {presentation.label}
    </span>
  )
}

function AuthorityStatus({ status }: { status: string }) {
  const labels: Record<string, string> = {
    draft: 'Rascunho',
    active: 'Ativa',
    scheduled: 'Agendada',
    suspended: 'Suspensa',
    revoked: 'Revogada',
    expired: 'Expirada',
  }
  const active = status === 'active'
  return <span className={`bbt-badge ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>{labels[status] || status}</span>
}

function MatrixStatus({ status }: { status: ApprovalMatrixCreated['status'] }) {
  const label = {
    draft: 'Rascunho',
    in_review: 'Em revisão',
    approved: 'Aprovada',
    published: 'Ativa',
    archived: 'Arquivada',
  }[status]
  const style = status === 'published'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
    : status === 'in_review' || status === 'approved'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
  return <span className={`bbt-badge ${style}`}>{status === 'published' && <CheckCircle2 className="h-3 w-3" />}{label}</span>
}

function matrixActionLabel(action: ApprovalMatrixCreated['nextAction']): string {
  if (action === 'submit_review') return 'Enviar para revisão'
  if (action === 'approve') return 'Aprovar conjunto'
  if (action === 'publish') return 'Publicar e ativar'
  return 'Concluída'
}

function governanceStatusLabel(status: string): string {
  return {
    draft: 'rascunho',
    in_review: 'em revisão',
    approved: 'aprovado',
    published: 'publicado',
    suspended: 'suspenso',
    archived: 'arquivado',
  }[status] || status
}

function matrixScopeLabel(
  scope: Record<string, unknown>,
  empresa: Empresa,
  businessGroupName: string | null,
  groupCompanies: Array<{ id: string; name: string }>,
): string {
  if (scope.type !== 'business_group') return empresa.nome
  if (scope.mode === 'all_companies') return `${businessGroupName || 'Grupo empresarial'} · todas as empresas`
  const selectedIds = Array.isArray(scope.companyIds) ? scope.companyIds.map(String) : []
  const selectedNames = groupCompanies.filter((company) => selectedIds.includes(company.id)).map((company) => company.name)
  return `${businessGroupName || 'Grupo empresarial'} · ${selectedNames.join(', ') || `${selectedIds.length} empresa(s)`}`
}

function canManageMatrixScope(
  scope: Record<string, unknown>,
  manageableGroupCompanyIds: string[],
  canManageAllGroupCompanies: boolean,
): boolean {
  if (scope.type !== 'business_group') return true
  if (scope.mode === 'all_companies') return canManageAllGroupCompanies
  if (scope.mode !== 'selected_companies') return false
  const selectedIds = Array.isArray(scope.companyIds) ? scope.companyIds.map(String) : []
  const manageableIds = new Set(manageableGroupCompanyIds)
  return selectedIds.length > 0 && selectedIds.every((companyId) => manageableIds.has(companyId))
}

function isCorporateApprover(user: CompanyScopedUser): boolean {
  return user.ativo !== false
    && user.status !== 'blocked'
    && user.status !== 'inactive'
    && user.companyPermissions.ver_aprovacoes
    && user.companyPermissions.decidir_aprovacoes
}

type EmployeeApproverState = 'active' | 'login_active' | 'invited_login' | 'pending' | 'invite_expired' | 'delivery_pending' | 'confirmation_required' | 'missing_email' | 'blocked' | 'revoked' | 'no_login'

function employeeApproverState(employee: EmployeeApproverDirectoryItem): EmployeeApproverState {
  const identity = employee.identityStatus.trim().toLowerCase()
  const approval = employee.approvalStatus.trim().toLowerCase()
  const blockedReason = (employee.blockedReason || '').trim().toLowerCase()
  const combined = `${identity} ${approval} ${blockedReason}`

  if (employee.canEnterRules || ['active', 'approved', 'enabled'].includes(approval)) return 'active'
  if (employee.requiresIdentityConfirmation || /confirmation_required|confirmacao|confirmação|confirm/.test(combined)) return 'confirmation_required'
  // Uma atribuição pendente cancelada preserva a identidade convidada, mas
  // volta a ficar disponível para uma nova atribuição/convite.
  if (['none', 'not_assigned'].includes(approval) && identity === 'invited') return 'invited_login'
  if (approval === 'pending_activation' && isEmployeeApproverInviteExpired(employee)) return 'invite_expired'
  if (approval === 'pending_activation' && employee.invitationState === 'delivery_pending') return 'delivery_pending'
  if (['pending', 'pending_activation', 'invited', 'invitation_pending', 'delivery_pending'].includes(approval) || /pending|pendente|invited|convite/.test(combined)) return 'pending'
  if (/email/.test(combined) && /missing|required|ausente|obrigatorio|obrigatório|sem/.test(combined)) return 'missing_email'
  if (['revoked', 'expired'].includes(approval)) return 'revoked'
  if (['blocked', 'inactive', 'disabled'].includes(identity) || ['blocked', 'inactive', 'disabled'].includes(approval) || Boolean(blockedReason)) return 'blocked'
  if (['active', 'linked', 'enabled'].includes(identity)) return 'login_active'
  return 'no_login'
}

function isAssignedEmployeeApprover(employee: EmployeeApproverDirectoryItem): boolean {
  return employee.hasManagedLink || employee.canEnterRules
}

function isEmployeeApproverUnassigned(employee: EmployeeApproverDirectoryItem): boolean {
  return ['none', 'not_assigned'].includes(employee.approvalStatus.trim().toLowerCase())
}

function canAssignEmployeeApprover(employee: EmployeeApproverDirectoryItem): boolean {
  const state = employeeApproverState(employee)
  return ['no_login', 'login_active', 'invited_login', 'confirmation_required'].includes(state)
    || (state === 'revoked' && employee.reassignable)
}

function canRemoveEmployeeApprover(employee: EmployeeApproverDirectoryItem): boolean {
  const approvalStatus = employee.approvalStatus.trim().toLowerCase()
  return (approvalStatus === 'active' && employee.canEnterRules)
    || approvalStatus === 'pending_activation'
    || (approvalStatus === 'blocked' && employee.blockedReason === 'effective_access_missing')
}

function canResendEmployeeApproverInvite(employee: EmployeeApproverDirectoryItem): boolean {
  return employee.approvalStatus.trim().toLowerCase() === 'pending_activation'
    && employee.identityStatus.trim().toLowerCase() === 'invited'
    && employee.resendable
}

function isEmployeeApproverInviteExpired(employee: EmployeeApproverDirectoryItem): boolean {
  if (employee.approvalStatus.trim().toLowerCase() !== 'pending_activation') return false
  if (employee.identityStatus.trim().toLowerCase() !== 'invited') return false
  if (!employee.inviteExpiresAt) return false
  const expiresAt = Date.parse(employee.inviteExpiresAt)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function formatEmployeeApproverInviteExpiry(value: string | null): string {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return ` em ${new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp))}`
}

function employeeApproverRemovalLabel(employee: EmployeeApproverDirectoryItem): string {
  return employee.approvalStatus.trim().toLowerCase() === 'pending_activation'
    ? 'Cancelar atribuição de autorizador'
    : 'Remover função de autorizador'
}

function employeeApproverRemovalConfirmation(employee: EmployeeApproverDirectoryItem): string {
  const action = employee.approvalStatus.trim().toLowerCase() === 'pending_activation'
    ? 'Cancelar a atribuição de autorizador'
    : 'Remover somente a função de autorizador'
  return `${action} de "${employee.name}"? O login, o perfil de solicitante e todos os demais acessos corporativos serão preservados.`
}

function employeeApproverUnavailableReason(employee: EmployeeApproverDirectoryItem): string {
  const state = employeeApproverState(employee)
  if (state === 'active') return 'Este funcionário já é um autorizador ativo.'
  if (state === 'pending') return 'O convite deste funcionário ainda está pendente.'
  if (state === 'invite_expired') return 'O convite expirou. Use a ação de reenvio.'
  if (state === 'delivery_pending') return 'O convite ainda não foi entregue. Use a ação de reenvio.'
  if (state === 'revoked') return 'O vínculo deste funcionário foi revogado e precisa ser regularizado antes de uma nova atribuição.'
  if (state === 'missing_email') return 'Cadastre o e-mail corporativo do funcionário antes de atribuir o acesso.'
  if (state === 'blocked') return {
    employee_inactive: 'O funcionário está inativo no cadastro da empresa.',
    internal_identity: 'Esta identidade pertence à equipe interna da agência e não pode ser vinculada ao funcionário.',
    identity_inactive: 'A conta corporativa vinculada está inativa.',
    effective_access_missing: 'A conta não possui acesso corporativo efetivo a esta empresa.',
  }[employee.blockedReason || ''] || 'A identidade deste funcionário está bloqueada.'
  return 'Este funcionário não pode ser atribuído como autorizador agora.'
}

function normalizeEmployeeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR')
}

function employeeSearchText(employee: EmployeeApproverDirectoryItem): string {
  return normalizeEmployeeSearch([
    employee.name,
    employee.registrationCode,
    employee.department,
    employee.costCenter,
  ].filter(Boolean).join(' '))
}

async function loadEmployeeApproverDirectory(companyId: string): Promise<EmployeeApproverDirectoryItem[]> {
  const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/approvers`, { cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.ok === false || !Array.isArray(payload?.employees)) {
    throw new Error(payload?.error || 'Não foi possível carregar os funcionários elegíveis para autorização.')
  }

  return payload.employees.flatMap((raw: unknown): EmployeeApproverDirectoryItem[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const item = raw as Record<string, unknown>
    const employeeId = typeof item.employeeId === 'string' ? item.employeeId : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!employeeId || !name) return []
    return [{
      employeeId,
      name,
      registrationCode: nullableDirectoryString(item.registrationCode),
      department: nullableDirectoryString(item.department),
      costCenter: nullableDirectoryString(item.costCenter),
      identityStatus: typeof item.identityStatus === 'string' ? item.identityStatus : 'none',
      approvalStatus: typeof item.approvalStatus === 'string' ? item.approvalStatus : 'not_assigned',
      membershipId: nullableDirectoryString(item.membershipId),
      canEnterRules: item.canEnterRules === true,
      hasManagedLink: item.hasManagedLink === true,
      blockedReason: nullableDirectoryString(item.blockedReason),
      requiresIdentityConfirmation: item.requiresIdentityConfirmation === true,
      invitationState: parseEmployeeInvitationState(item.invitationState),
      inviteExpiresAt: nullableDirectoryString(item.inviteExpiresAt),
      resendable: item.resendable === true,
      reassignable: item.reassignable === true,
    }]
  })
}

function parseEmployeeInvitationState(value: unknown): EmployeeApproverDirectoryItem['invitationState'] {
  return value === 'sent' || value === 'delivery_pending' ? value : 'not_required'
}

function nullableDirectoryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function loadApprovalCandidates(companyId: string): Promise<ApprovalCandidateItem[]> {
  const items: ApprovalCandidateItem[] = []
  const limit = 200
  let offset = 0
  while (true) {
    const response = await fetch(`/api/approvals/candidates?companyId=${encodeURIComponent(companyId)}&limit=${limit}&offset=${offset}`, { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(payload?.items)) {
      throw new Error(payload?.error || 'Não foi possível carregar os acessos corporativos da empresa.')
    }
    items.push(...payload.items)
    offset += payload.items.length
    if (payload.items.length < limit || offset >= Number(payload.total || 0)) break
  }
  return items
}

function candidateToCompanyUser(candidate: ApprovalCandidateItem): CompanyScopedUser {
  return {
    id: candidate.userId,
    membership_id: candidate.membershipId,
    name: candidate.name,
    email: candidate.email,
    role: 'colaborador',
    company_id: null,
    ativo: candidate.active,
    status: candidate.active ? 'active' : 'inactive',
    companyProfiles: candidate.effectiveProfiles,
    companyPermissions: candidate.effectivePermissions,
  }
}

function normalizeCostCenters(items: Array<Record<string, unknown>>): CostCenterOption[] {
  return items.flatMap((item): CostCenterOption[] => {
    const id = String(item.projectionId || item.projection_id || item.companyCostCenterId || '')
    const code = String(item.code || '').trim()
    if (!id || !code) return []
    return [{ id, code, name: String(item.name || code) }]
  })
}

function authorityScopeLabel(authority: ApprovalAuthorityItem, empresa: Empresa): string {
  if (authority.audienceGroupId) return `Grupo de usuários ${authority.audienceGroupName || authority.audienceGroupId}`
  if (authority.department) return `Departamento ${authority.department}`
  if (authority.costCenterId) return `Centro de custo ${authority.costCenterCode || authority.costCenterName || authority.costCenterId}`
  if (authority.companyId) return empresa.nome
  if (authority.groupId) return 'Herdada do grupo empresarial'
  return 'Tenant'
}

function uniqueDepartments(funcionarios: Funcionario[]): string[] {
  return [...new Set(funcionarios.map((item) => String(item.lotacao || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))
}

function approvalKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    merit: 'Mérito',
    cost: 'Custo',
    second_level: 'Segundo nível',
    budget: 'Orçamento',
    financial: 'Financeira',
    executive: 'Executiva',
  }
  return labels[kind] || kind || '—'
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
}

function dateRange(start: string, end: string | null): string {
  const format = (value: string) => new Intl.DateTimeFormat('pt-BR').format(new Date(value))
  return `${format(start)} → ${end ? format(end) : 'sem término'}`
}

function slugifyGroupCode(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

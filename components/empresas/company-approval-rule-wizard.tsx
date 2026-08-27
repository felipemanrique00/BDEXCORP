'use client'

import { AlertTriangle, GitBranch, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { DateInput } from '@/components/ui/date-input'
import { DecimalInput } from '@/components/ui/decimal-input'
import { Modal } from '@/components/ui/modal'
import type { Empresa, User } from '@/types'

type MatrixScope = 'company' | 'business_group' | 'cost_center' | 'department' | 'audience_group'
type FirstLevelKind = 'merit' | 'cost'
type BusinessGroupMode = 'all_companies' | 'selected_companies'

export interface ApprovalAudienceGroupOption {
  id: string
  code: string
  name: string
}

export interface ApprovalMatrixCreated {
  matrixId: string
  stage: FirstLevelKind
  scope: Record<string, unknown>
  authorityIds: string[]
  workflow: {
    id: string
    versionId: string
    code: string
    status: string
    reused?: boolean
  }
  policy: {
    id: string
    versionId: string
    code: string
    status: string
    reused?: boolean
  }
  status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived'
  version: number
  bindingState: 'draft_not_active' | 'active'
  nextAction: 'submit_review' | 'approve' | 'publish' | 'none'
  createdBy?: { userId: string; name: string }
  isCreator?: boolean
  createdAt?: string
  updatedAt?: string
}

interface ApprovalRuleWizardProps {
  open: boolean
  onClose: () => void
  empresa: Empresa
  approvers: User[]
  costCenters: Array<{ id: string; code: string; name: string }>
  departments: string[]
  audienceGroups: ApprovalAudienceGroupOption[]
  businessGroupName: string | null
  groupCompanies: Array<{ id: string; name: string }>
  manageableGroupCompanyIds: string[]
  canManageAllGroupCompanies: boolean
  onCreated: (result: ApprovalMatrixCreated) => Promise<void>
}

interface AuthorityScopePayload {
  companyId?: string
  costCenterId?: string
  department?: string
  audienceGroupId?: string
}

interface ApprovalCandidateResponseItem {
  membershipId: string
  userId: string
  name: string
  email: string
  active: boolean
}

interface GroupCandidateRequest {
  key: string
  url: string
}

export function CompanyApprovalRuleWizard({
  open,
  onClose,
  empresa,
  approvers,
  costCenters,
  departments,
  audienceGroups,
  businessGroupName,
  groupCompanies,
  manageableGroupCompanyIds,
  canManageAllGroupCompanies,
  onCreated,
}: ApprovalRuleWizardProps) {
  const companyEligibleApprovers = useMemo(
    () => approvers.filter((user) => user.membership_id && user.ativo !== false),
    [approvers],
  )
  const [name, setName] = useState('')
  const [kind, setKind] = useState<FirstLevelKind>('cost')
  const [scope, setScope] = useState<MatrixScope>('company')
  const [businessGroupMode, setBusinessGroupMode] = useState<BusinessGroupMode>('selected_companies')
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([empresa.id])
  const [costCenterId, setCostCenterId] = useState('')
  const [department, setDepartment] = useState('')
  const [audienceGroupId, setAudienceGroupId] = useState('')
  const [levelOneMembershipId, setLevelOneMembershipId] = useState('')
  const [levelOneLimit, setLevelOneLimit] = useState('')
  const [useSecondLevel, setUseSecondLevel] = useState(true)
  const [levelTwoMembershipId, setLevelTwoMembershipId] = useState('')
  const [levelTwoLimit, setLevelTwoLimit] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [groupApprovers, setGroupApprovers] = useState<User[]>([])
  const [groupApproversLoading, setGroupApproversLoading] = useState(false)
  const [groupApproversError, setGroupApproversError] = useState<string | null>(null)
  const [loadedGroupCandidateKey, setLoadedGroupCandidateKey] = useState<string | null>(null)
  const [groupCandidateReloadVersion, setGroupCandidateReloadVersion] = useState(0)

  const eligibleApprovers = scope === 'business_group'
    ? groupApprovers
    : companyEligibleApprovers

  useEffect(() => {
    if (!open) return
    const first = companyEligibleApprovers[0]
    const second = companyEligibleApprovers.find((user) => user.membership_id !== first?.membership_id)
    setName(`Aprovação de custo — ${empresa.nome}`)
    setKind('cost')
    setScope('company')
    setBusinessGroupMode('selected_companies')
    setSelectedCompanyIds(manageableGroupCompanyIds.includes(empresa.id)
      ? [empresa.id]
      : manageableGroupCompanyIds.slice(0, 1))
    setCostCenterId(costCenters[0]?.id || '')
    setDepartment(departments[0] || '')
    setAudienceGroupId(audienceGroups[0]?.id || '')
    setLevelOneMembershipId(first?.membership_id || '')
    setLevelOneLimit('')
    setUseSecondLevel(Boolean(second))
    setLevelTwoMembershipId(second?.membership_id || '')
    setLevelTwoLimit('')
    setValidUntil('')
    setJustification('Configuração corporativa da matriz de autorização.')
    setSaving(false)
    setGroupApprovers([])
    setGroupApproversLoading(false)
    setGroupApproversError(null)
    setLoadedGroupCandidateKey(null)
    setGroupCandidateReloadVersion(0)
    // Os dados-base já foram carregados antes de o botão do wizard ser habilitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function changeKind(next: FirstLevelKind) {
    setKind(next)
    setName(`Aprovação de ${next === 'cost' ? 'custo' : 'mérito'} — ${empresa.nome}`)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    const validation = validateMatrix({
      name,
      scope,
      companyHasGroup: Boolean(empresa.grupo_id),
      manageableGroupCompanyIds,
      canManageAllGroupCompanies,
      businessGroupMode,
      selectedCompanyIds,
      costCenterId,
      department,
      audienceGroupId,
      levelOneMembershipId,
      levelOneLimit,
      useSecondLevel,
      levelTwoMembershipId,
      levelTwoLimit,
      justification,
      approverCandidatesReady: groupCandidateCoverageReady,
      eligibleMembershipIds,
    })
    if (validation) return toast.error(validation)

    setSaving(true)
    try {
      const authorityScope = authorityScopePayload({
        scope,
        empresa,
        costCenterId,
        department,
        audienceGroupId,
      })
      const validFrom = new Date().toISOString()
      const validUntilIso = validUntil ? endOfLocalDayIso(validUntil) : null
      const common = {
        ...authorityScope,
        currency: 'BRL',
        validFrom,
        validUntil: validUntilIso,
        justification: justification.trim(),
      }
      const authorities: Array<Record<string, unknown>> = [{
        ...common,
        membershipId: levelOneMembershipId,
        approvalKind: kind,
        approvalLevel: 1,
        maxAmount: numericLimit(levelOneLimit),
      }]
      if (useSecondLevel) authorities.push({
        ...common,
        membershipId: levelTwoMembershipId,
        approvalKind: kind,
        approvalLevel: 2,
        maxAmount: numericLimit(levelTwoLimit),
      })

      const result = await postJson<{ matrix: ApprovalMatrixCreated }>('/api/approvals/matrices', {
        scope: matrixRootScope({
          scope,
          empresa,
          businessGroupMode,
          selectedCompanyIds,
        }),
        stage: kind,
        authorities,
        workflow: {
          name: name.trim(),
          description: `Matriz corporativa de aprovação de ${kind === 'cost' ? 'custo' : 'mérito'} para ${scope === 'business_group' ? businessGroupName || 'grupo empresarial' : empresa.nome}.`,
          changeSummary: justification.trim(),
        },
      })

      toast.success('Regra adicionada à matriz em rascunho.')
      await onCreated(result.matrix)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a regra.')
    } finally {
      setSaving(false)
    }
  }

  const availableGroupCompanies = useMemo(
    () => groupCompanies.length ? groupCompanies : [{ id: empresa.id, name: empresa.nome }],
    [empresa.id, empresa.nome, groupCompanies],
  )
  const manageableGroupCompanies = useMemo(
    () => new Set(manageableGroupCompanyIds),
    [manageableGroupCompanyIds],
  )
  const groupCandidateRequest = useMemo<GroupCandidateRequest | null>(() => {
    if (!open || scope !== 'business_group' || !empresa.grupo_id) return null
    const companyIds = businessGroupMode === 'all_companies'
      ? availableGroupCompanies.map((company) => company.id)
      : selectedCompanyIds
    const normalizedCompanyIds = [...new Set(companyIds)].sort()
    if (normalizedCompanyIds.length === 0 || normalizedCompanyIds.length > 100) return null
    const params = new URLSearchParams({ companyIds: normalizedCompanyIds.join(',') })
    if (businessGroupMode === 'all_companies') {
      params.set('businessGroupId', empresa.grupo_id)
      params.set('allCompanies', 'true')
    }
    return {
      key: `${businessGroupMode}:${empresa.grupo_id}:${normalizedCompanyIds.join(',')}`,
      url: `/api/approvals/candidates?${params.toString()}`,
    }
  }, [availableGroupCompanies, businessGroupMode, empresa.grupo_id, open, scope, selectedCompanyIds])
  const groupCandidateRequestIssue = scope === 'business_group' && businessGroupMode === 'selected_companies' && selectedCompanyIds.length === 0
    ? 'Selecione ao menos uma empresa para consultar os autorizadores válidos.'
    : scope === 'business_group' && businessGroupMode === 'selected_companies' && selectedCompanyIds.length > 100
      ? 'Selecione no máximo 100 empresas por regra.'
    : scope === 'business_group' && businessGroupMode === 'all_companies' && availableGroupCompanies.length > 100
      ? 'O grupo possui mais de 100 empresas ativas e não pode ser validado por esta tela.'
      : scope === 'business_group' && businessGroupMode === 'all_companies' && !canManageAllGroupCompanies
        ? 'O modo todas as empresas exige acesso integral ao grupo.'
        : null
  const groupCandidateCoverageReady = scope !== 'business_group'
    || Boolean(
      groupCandidateRequest
      && loadedGroupCandidateKey === groupCandidateRequest.key
      && !groupApproversLoading
      && !groupApproversError
      && !groupCandidateRequestIssue,
    )
  const eligibleMembershipIds = useMemo(
    () => eligibleApprovers.flatMap((user) => user.membership_id ? [user.membership_id] : []),
    [eligibleApprovers],
  )
  const hasSecondCandidate = eligibleMembershipIds.some((membershipId) => membershipId !== levelOneMembershipId)
  const groupApproverControlsDisabled = scope === 'business_group' && !groupCandidateCoverageReady

  useEffect(() => {
    if (!open || scope !== 'business_group') return
    if (!groupCandidateRequest || groupCandidateRequestIssue) {
      setGroupApprovers([])
      setGroupApproversLoading(false)
      setGroupApproversError(null)
      setLoadedGroupCandidateKey(null)
      return
    }

    const controller = new AbortController()
    setGroupApprovers([])
    setGroupApproversLoading(true)
    setGroupApproversError(null)
    setLoadedGroupCandidateKey(null)
    void loadWizardApprovalCandidates(groupCandidateRequest.url, controller.signal)
      .then((items) => {
        setGroupApprovers(items.map(candidateToWizardApprover))
        setLoadedGroupCandidateKey(groupCandidateRequest.key)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setGroupApproversError(error instanceof Error ? error.message : 'Não foi possível validar os autorizadores deste escopo.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setGroupApproversLoading(false)
      })
    return () => controller.abort()
  }, [groupCandidateReloadVersion, groupCandidateRequest, groupCandidateRequestIssue, open, scope])

  useEffect(() => {
    if (!open) return
    const validMembershipIds = new Set(eligibleMembershipIds)
    const first = eligibleApprovers[0]
    const resolvedLevelOneMembershipId = validMembershipIds.has(levelOneMembershipId)
      ? levelOneMembershipId
      : first?.membership_id || ''
    setLevelOneMembershipId(resolvedLevelOneMembershipId)
    setLevelTwoMembershipId((current) => {
      if (validMembershipIds.has(current) && current !== resolvedLevelOneMembershipId) return current
      return eligibleApprovers.find((user) => user.membership_id !== resolvedLevelOneMembershipId)?.membership_id || ''
    })
    if (eligibleMembershipIds.length < 2) setUseSecondLevel(false)
  }, [eligibleApprovers, eligibleMembershipIds, levelOneMembershipId, open])

  function toggleSelectedCompany(companyId: string) {
    if (!manageableGroupCompanies.has(companyId)) return
    setSelectedCompanyIds((current) => current.includes(companyId)
      ? current.filter((id) => id !== companyId)
      : [...current, companyId])
  }

  return (
    <Modal open={open} onClose={onClose} title="Nova regra de autorização" size="xl">
      <form onSubmit={submit} className="space-y-6">
        <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
          A gravação é transacional: alçadas, workflow canônico e política canônica ficam juntos em <strong>rascunho</strong>. Nada entra em operação antes da revisão e publicação.
        </div>

        <section className="space-y-3">
          <WizardHeading number="1" title="Identificação e etapa" />
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Nome da regra / matriz
              <input value={name} onChange={(event) => setName(event.target.value)} className="bbt-input mt-1.5" maxLength={240} required />
            </label>
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Aprovação de primeiro nível
              <select value={kind} onChange={(event) => changeKind(event.target.value as FirstLevelKind)} className="bbt-input mt-1.5">
                <option value="cost">Custo / cotação escolhida</option>
                <option value="merit">Mérito / necessidade da viagem</option>
              </select>
            </label>
          </div>
        </section>

        <section className="space-y-3 border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
          <WizardHeading number="2" title="Quem esta regra atende" />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Escopo
              <select value={scope} onChange={(event) => setScope(event.target.value as MatrixScope)} className="bbt-input mt-1.5">
                <option value="company">Toda a empresa atual</option>
                <option value="cost_center">Centro de custo específico</option>
                <option value="department">Departamento específico</option>
                <option value="audience_group" disabled={audienceGroups.length === 0}>Grupo de usuários</option>
                {empresa.grupo_id && manageableGroupCompanyIds.length > 0 && <option value="business_group">Grupo empresarial (todas ou selecionadas)</option>}
              </select>
              {empresa.grupo_id && manageableGroupCompanyIds.length === 0 && (
                <span className="mt-1.5 block normal-case text-amber-700 dark:text-amber-300">
                  O grupo empresarial fica disponível somente para quem administra workflows nas empresas abrangidas.
                </span>
              )}
            </label>

            {scope === 'cost_center' && (
              <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                Centro de custo
                <select value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)} className="bbt-input mt-1.5" required>
                  <option value="">Selecione</option>
                  {costCenters.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </select>
              </label>
            )}

            {scope === 'department' && (
              <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                Departamento
                <input value={department} onChange={(event) => setDepartment(event.target.value)} list="approval-departments" className="bbt-input mt-1.5" maxLength={240} required />
                <datalist id="approval-departments">{departments.map((item) => <option key={item} value={item} />)}</datalist>
              </label>
            )}

            {scope === 'audience_group' && (
              <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                Grupo de usuários atendido
                <select value={audienceGroupId} onChange={(event) => setAudienceGroupId(event.target.value)} className="bbt-input mt-1.5" required>
                  <option value="">Selecione</option>
                  {audienceGroups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}

            {scope === 'company' && <ScopeSummary label={empresa.nome} description="Somente esta empresa, mesmo quando ela pertence a um grupo." />}
            {scope === 'business_group' && <ScopeSummary label={businessGroupName || 'Grupo empresarial'} description="Escolha se a regra vale para todas as empresas do grupo ou somente para empresas selecionadas." />}

            {scope === 'business_group' && (
              <div className="space-y-3 rounded-md border border-bbt-gray-100 p-4 dark:border-slate-700 md:col-span-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={`rounded-md border p-3 text-sm ${canManageAllGroupCompanies && availableGroupCompanies.length <= 100 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${businessGroupMode === 'all_companies' ? 'border-bbt-accent bg-cyan-50 dark:bg-cyan-950/20' : 'border-bbt-gray-100 dark:border-slate-700'}`}>
                    <input type="radio" name="business-group-mode" value="all_companies" checked={businessGroupMode === 'all_companies'} onChange={() => setBusinessGroupMode('all_companies')} className="mr-2" disabled={!canManageAllGroupCompanies || availableGroupCompanies.length > 100} />
                    <strong>Todas as empresas</strong>
                    <span className="mt-1 block text-xs text-slate-500">A regra é herdada por todo o grupo, inclusive novas empresas. Exige acesso integral ao grupo.</span>
                  </label>
                  <label className={`cursor-pointer rounded-md border p-3 text-sm ${businessGroupMode === 'selected_companies' ? 'border-bbt-accent bg-cyan-50 dark:bg-cyan-950/20' : 'border-bbt-gray-100 dark:border-slate-700'}`}>
                    <input type="radio" name="business-group-mode" value="selected_companies" checked={businessGroupMode === 'selected_companies'} onChange={() => setBusinessGroupMode('selected_companies')} className="mr-2" />
                    <strong>Empresas selecionadas</strong>
                    <span className="mt-1 block text-xs text-slate-500">A regra é materializada apenas nas empresas marcadas.</span>
                  </label>
                </div>

                {businessGroupMode === 'selected_companies' && (
                  <fieldset>
                    <legend className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Empresas atendidas</legend>
                    <div className="mt-2 grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                      {availableGroupCompanies.map((company) => {
                        const canManageCompany = manageableGroupCompanies.has(company.id)
                        return (
                        <label key={company.id} className={`flex items-center gap-2 rounded border border-bbt-gray-100 px-3 py-2 text-sm dark:border-slate-700 ${canManageCompany ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                          <input type="checkbox" checked={selectedCompanyIds.includes(company.id)} onChange={() => toggleSelectedCompany(company.id)} disabled={!canManageCompany} />
                          <span>{company.name}</span>
                          {company.id === empresa.id && <span className="text-[10px] text-slate-400">atual</span>}
                        </label>
                        )
                      })}
                    </div>
                  </fieldset>
                )}

                <p className="text-xs text-amber-700 dark:text-amber-300">Os autorizadores escolhidos precisam ter acesso corporativo a todas as empresas abrangidas.</p>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3 border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
          <WizardHeading number="3" title="Primeiro nível" />
          {scope === 'business_group' && groupApproversLoading && (
            <div className="flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
              <Loader2 className="h-4 w-4 animate-spin" />
              Validando quem pode decidir em todas as empresas abrangidas…
            </div>
          )}
          {scope === 'business_group' && !groupApproversLoading && (groupCandidateRequestIssue || groupApproversError) && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <span>{groupCandidateRequestIssue || groupApproversError}</span>
              {groupApproversError && (
                <button type="button" className="font-semibold underline" onClick={() => setGroupCandidateReloadVersion((current) => current + 1)}>
                  Tentar novamente
                </button>
              )}
            </div>
          )}
          {scope === 'business_group' && groupCandidateCoverageReady && eligibleApprovers.length === 0 && (
            <div className="rounded-md border border-dashed border-amber-300 p-3 text-xs text-amber-800 dark:border-amber-800 dark:text-amber-200">
              Nenhum autorizador possui permissão explícita para decidir em todas as empresas deste escopo.
            </div>
          )}
          {scope === 'business_group' && groupCandidateCoverageReady && eligibleApprovers.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              {eligibleApprovers.length} autorizador(es) validado(s) para toda a cobertura selecionada.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <ApproverSelect label="Autorizador N1" value={levelOneMembershipId} onChange={setLevelOneMembershipId} approvers={eligibleApprovers} disabled={groupApproverControlsDisabled} />
            <MoneyLimit label="Alçada máxima do N1" value={levelOneLimit} onChange={setLevelOneLimit} required={useSecondLevel} />
          </div>
        </section>

        <section className="space-y-3 border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-bbt-gray-100 p-3 dark:border-slate-700">
            <input type="checkbox" checked={useSecondLevel} onChange={(event) => setUseSecondLevel(event.target.checked)} className="mt-1" disabled={groupApproverControlsDisabled || !hasSecondCandidate} />
            <span>
              <strong className="block text-sm text-bbt-primary dark:text-white">Exigir segundo nível quando necessário</strong>
              <span className="text-xs text-slate-500">O servidor aciona N2 quando uma política passível de exceção exigir alerta, justificativa, documento, ação ou aprovação adicional, ou quando o valor ultrapassar a alçada de N1. Bloqueios rígidos continuam bloqueando.</span>
            </span>
          </label>

          {useSecondLevel && (
            <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                N1 e N2 devem ser pessoas diferentes; o fluxo também separa solicitante e aprovador anterior.
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <ApproverSelect label="Autorizador N2" value={levelTwoMembershipId} onChange={setLevelTwoMembershipId} approvers={eligibleApprovers} excludedMembershipId={levelOneMembershipId} disabled={groupApproverControlsDisabled} />
                <MoneyLimit label="Alçada máxima do N2" value={levelTwoLimit} onChange={setLevelTwoLimit} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <TriggerLabel label="Violação de política passível de exceção" />
                <TriggerLabel label="Valor acima da alçada do N1" />
              </div>
            </div>
          )}

          {!hasSecondCandidate && (
            <p className="text-xs text-amber-700 dark:text-amber-300">Cadastre um segundo autorizador corporativo para habilitar N2.</p>
          )}
        </section>

        <section className="space-y-3 border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
          <WizardHeading number="4" title="Vigência e auditoria" />
          <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Válida até (opcional)
              <DateInput
                aria-label="Fim da vigência da regra"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
                className="mt-1.5"
                pickerLabel="Abrir calendário do fim da vigência"
              />
            </label>
            <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
              Justificativa
              <input value={justification} onChange={(event) => setJustification(event.target.value)} className="bbt-input mt-1.5" minLength={10} maxLength={2000} required />
            </label>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost" disabled={saving}>Cancelar</button>
          <button type="submit" className="bbt-button-primary" disabled={saving || eligibleApprovers.length === 0 || groupApproverControlsDisabled}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            Salvar regra em rascunho
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ApproverSelect({
  label,
  value,
  onChange,
  approvers,
  excludedMembershipId,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  approvers: User[]
  excludedMembershipId?: string
  disabled?: boolean
}) {
  return (
    <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="bbt-input mt-1.5" required disabled={disabled}>
        <option value="">{disabled ? 'Aguardando validação' : 'Selecione'}</option>
        {approvers.filter((user) => user.membership_id !== excludedMembershipId).map((user) => (
          <option key={user.id} value={user.membership_id}>{user.name} · {user.email}</option>
        ))}
      </select>
    </label>
  )
}

function MoneyLimit({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <label className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
      {label}
      <DecimalInput
        value={value}
        onValueChange={onChange}
        prefix="R$"
        containerClassName="mt-1.5"
        placeholder={required ? 'Obrigatório para escalonar' : 'Sem limite'}
        required={required}
      />
    </label>
  )
}

function WizardHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bbt-primary text-xs text-white">{number}</span>
      {title}
    </div>
  )
}

function ScopeSummary({ label, description }: { label: string; description: string }) {
  return (
    <div className="rounded-md border border-bbt-gray-100 p-3 dark:border-slate-700">
      <div className="flex items-center gap-2 text-sm font-semibold text-bbt-primary dark:text-white"><ShieldCheck className="h-4 w-4 text-bbt-accent" />{label}</div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  )
}

function TriggerLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-white/70 px-3 py-2 text-xs text-amber-900 dark:bg-slate-900/50 dark:text-amber-100">
      <ShieldCheck className="h-4 w-4" />
      {label}
    </div>
  )
}

function validateMatrix(input: {
  name: string
  scope: MatrixScope
  companyHasGroup: boolean
  manageableGroupCompanyIds: string[]
  canManageAllGroupCompanies: boolean
  businessGroupMode: BusinessGroupMode
  selectedCompanyIds: string[]
  costCenterId: string
  department: string
  audienceGroupId: string
  levelOneMembershipId: string
  levelOneLimit: string
  useSecondLevel: boolean
  levelTwoMembershipId: string
  levelTwoLimit: string
  justification: string
  approverCandidatesReady: boolean
  eligibleMembershipIds: string[]
}): string | null {
  if (input.name.trim().length < 3) return 'Informe um nome para a matriz.'
  if (input.scope === 'business_group' && !input.companyHasGroup) return 'A empresa não pertence a um grupo empresarial.'
  if (input.scope === 'business_group' && input.businessGroupMode === 'all_companies' && !input.canManageAllGroupCompanies) return 'Você precisa administrar workflows em todo o grupo para selecionar todas as empresas.'
  if (input.scope === 'business_group' && input.businessGroupMode === 'selected_companies' && input.selectedCompanyIds.length === 0) return 'Selecione ao menos uma empresa do grupo.'
  if (input.scope === 'business_group' && input.businessGroupMode === 'selected_companies') {
    const manageableIds = new Set(input.manageableGroupCompanyIds)
    if (input.selectedCompanyIds.some((companyId) => !manageableIds.has(companyId))) return 'Remova empresas nas quais você não administra workflows.'
  }
  if (input.scope === 'cost_center' && !input.costCenterId) return 'Selecione um centro de custo.'
  if (input.scope === 'department' && !input.department.trim()) return 'Informe o departamento.'
  if (input.scope === 'audience_group' && !input.audienceGroupId) return 'Selecione um grupo de usuários.'
  if (!input.approverCandidatesReady) return 'Aguarde a validação dos autorizadores para este escopo.'
  const eligibleMembershipIds = new Set(input.eligibleMembershipIds)
  if (!input.levelOneMembershipId) return 'Selecione o autorizador de primeiro nível.'
  if (!eligibleMembershipIds.has(input.levelOneMembershipId)) return 'O autorizador N1 não possui permissão para decidir em todo o escopo.'
  if (input.useSecondLevel && !input.levelOneLimit.trim()) return 'Informe a alçada de N1 para permitir o escalonamento por valor.'
  if (input.levelOneLimit && numericLimit(input.levelOneLimit) === null) return 'A alçada de N1 é inválida.'
  if (input.useSecondLevel && !input.levelTwoMembershipId) return 'Selecione o autorizador de segundo nível.'
  if (input.useSecondLevel && !eligibleMembershipIds.has(input.levelTwoMembershipId)) return 'O autorizador N2 não possui permissão para decidir em todo o escopo.'
  if (input.useSecondLevel && input.levelOneMembershipId === input.levelTwoMembershipId) return 'N1 e N2 devem ser pessoas diferentes.'
  if (input.levelTwoLimit && numericLimit(input.levelTwoLimit) === null) return 'A alçada de N2 é inválida.'
  if (input.justification.trim().length < 10) return 'A justificativa deve ter ao menos 10 caracteres.'
  return null
}

function authorityScopePayload(input: {
  scope: MatrixScope
  empresa: Empresa
  costCenterId: string
  department: string
  audienceGroupId: string
}): AuthorityScopePayload {
  if (input.scope === 'business_group') return {}
  if (input.scope === 'cost_center') return { companyId: input.empresa.id, costCenterId: input.costCenterId }
  if (input.scope === 'department') return { companyId: input.empresa.id, department: input.department.trim() }
  if (input.scope === 'audience_group') return { companyId: input.empresa.id, audienceGroupId: input.audienceGroupId }
  return { companyId: input.empresa.id }
}

function matrixRootScope(input: {
  scope: MatrixScope
  empresa: Empresa
  businessGroupMode: BusinessGroupMode
  selectedCompanyIds: string[]
}): Record<string, unknown> {
  if (input.scope !== 'business_group') {
    return { type: 'company', companyId: input.empresa.id }
  }
  return {
    type: 'business_group',
    businessGroupId: input.empresa.grupo_id,
    mode: input.businessGroupMode,
    companyIds: input.businessGroupMode === 'selected_companies' ? input.selectedCompanyIds : [],
  }
}

async function loadWizardApprovalCandidates(
  baseUrl: string,
  signal: AbortSignal,
): Promise<ApprovalCandidateResponseItem[]> {
  const items: ApprovalCandidateResponseItem[] = []
  const membershipIds = new Set<string>()
  const limit = 200
  let offset = 0

  while (true) {
    const response = await fetch(`${baseUrl}&limit=${limit}&offset=${offset}`, {
      cache: 'no-store',
      signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(payload?.items)) {
      throw new Error(payload?.error || 'Não foi possível validar os autorizadores deste escopo.')
    }
    const page = payload.items.filter(isApprovalCandidateResponseItem)
    for (const item of page) {
      if (membershipIds.has(item.membershipId)) continue
      membershipIds.add(item.membershipId)
      items.push(item)
    }
    offset += payload.items.length
    if (payload.items.length < limit || offset >= Number(payload.total || 0)) break
  }
  return items
}

function isApprovalCandidateResponseItem(value: unknown): value is ApprovalCandidateResponseItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.membershipId === 'string'
    && typeof item.userId === 'string'
    && typeof item.name === 'string'
    && typeof item.email === 'string'
    && item.active === true
}

function candidateToWizardApprover(candidate: ApprovalCandidateResponseItem): User {
  return {
    id: candidate.userId,
    membership_id: candidate.membershipId,
    name: candidate.name,
    email: candidate.email,
    role: 'colaborador',
    company_id: null,
    ativo: candidate.active,
    status: candidate.active ? 'active' : 'inactive',
  }
}

async function postJson<T = unknown>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  }
  return payload as T
}

function numericLimit(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function endOfLocalDayIso(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}

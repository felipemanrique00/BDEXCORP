'use client'
import { todayISODate } from '@/lib/date'
import { useEffect, useState, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { getCurrentUser } from '@/lib/auth'
import {
  canCreateCompanyWithoutGroup,
  companyGroupIdsAvailableForCreation,
} from '@/lib/company-creation-access'
import { useCorporateCompanyScope, useCorporateContext } from '@/components/corporate-context-provider'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { WhatsAppButton } from '@/components/ui/whatsapp-button'
import { ConfigCobrancaModal } from '@/components/ui/config-cobranca-modal'
import { SearchInput } from '@/components/ui/search-input'
import { maskCNPJ, maskPhone, formatDate, onlyDigits } from '@/lib/utils'
import { Building2, Plus, Search, Edit2, Trash2, Download, Eye, Users, DollarSign, MonitorCheck } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import type { Empresa, Funcionario } from '@/types'
import { AIAssistantFab } from '@/components/ai/ai-assistant-fab'
import { PageHero } from '@/components/ui/page-hero'
import { buildCsv, downloadTextFile } from '@/lib/browser-download'
import { flushPendingRemoteStorageWithResult } from '@/lib/storage-quota'

function countEmployeesForVisibleCompanies(
  employees: ReadonlyArray<Pick<Funcionario, 'company_id'>>,
  companies: ReadonlyArray<Pick<Empresa, 'id'>>,
): number {
  const visibleCompanyIds = new Set(companies.map((company) => company.id))
  return employees.reduce(
    (total, employee) => total + (visibleCompanyIds.has(employee.company_id) ? 1 : 0),
    0,
  )
}

export default function EmpresasPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const { includesCompany } = useCorporateCompanyScope()
  const { refreshAccess } = useCorporateContext()
  const { empresas, gruposEmpresariais, funcionarios, addEmpresa, updateEmpresa, deleteEmpresa } = useStore()

  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Empresa | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Empresa | null>(null)
  const [configCobrancaEmpresa, setConfigCobrancaEmpresa] = useState<Empresa | null>(null)
  const creatableGroupIds = useMemo(
    () => companyGroupIdsAvailableForCreation(user, gruposEmpresariais),
    [gruposEmpresariais, user],
  )
  const canCreateCompanyTenantWide = canCreateCompanyWithoutGroup(user)
  const canCreateCompany = canCreateCompanyTenantWide || creatableGroupIds.size > 0

  async function sincronizarDiretorio(message: string) {
    const result = await flushPendingRemoteStorageWithResult()
    if (!result.confirmed) {
      toast.error('Alteracao registrada, mas ainda nao sincronizada com o servidor. A sincronizacao sera repetida automaticamente.')
      return
    }
    await refreshAccess().catch(() => undefined)
    if (!result.fullyAccepted) {
      toast.error('A alteração não foi aplicada porque seu acesso foi alterado ou não permite esta operação. Recarregando os dados autorizados.')
      window.setTimeout(() => window.location.reload(), 900)
      return
    }
    toast.success(message)
  }

  const visible = useMemo(() => {
    const filtered = empresas.filter((empresa) => includesCompany(empresa.id, 'ver_empresas'))
    if (!search.trim()) return filtered
    const q = search.toLowerCase()
    return filtered.filter(
      (e) =>
        e.nome.toLowerCase().includes(q) ||
        e.cnpj.includes(q) ||
        e.responsavel.toLowerCase().includes(q)
    )
  }, [empresas, includesCompany, search])
  const visibleEmployeeCount = useMemo(
    () => countEmployeesForVisibleCompanies(funcionarios, visible),
    [funcionarios, visible],
  )

  function exportCSV() {
    const headers = ['Nome', 'CNPJ', 'Grupo', 'Endereço', 'Responsável', 'E-mail', 'Telefone', 'Centro de Custo', 'Ativa', 'Portal Empresa']
    const rows = visible.map((e) => [
      e.nome,
      e.cnpj,
      gruposEmpresariais.find((grupo) => grupo.id === e.grupo_id)?.nome || '',
      e.endereco,
      e.responsavel,
      e.email_responsavel,
      maskPhone(e.telefone),
      e.centro_custo_padrao,
      e.ativa ? 'Sim' : 'Não',
      (e.portal_empresa_habilitado ?? e.ativa) === true ? 'Habilitado' : 'Desabilitado',
    ])
    downloadTextFile(
      `empresas-${todayISODate()}.csv`,
      '\ufeff' + buildCsv([headers, ...rows]),
      'text/csv;charset=utf-8',
    )
    toast.success('CSV exportado com sucesso!')
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        eyebrow="Cadastros"
        title="Empresas"
        icon={Building2}
        description="Gerencie clientes corporativos, políticas, acessos e contratos."
        bgImage="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=2000&q=85"
        metrics={[
          { icon: Building2, label: 'Cadastradas', value: visible.length },
          { icon: Users, label: 'Funcionários', value: visibleEmployeeCount },
        ]}
        actions={
          <>
            <button onClick={exportCSV}
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-white text-sm hover:bg-white/15 transition border border-white/15">
              <Download className="w-4 h-4" /> Exportar CSV
            </button>
            {canCreateCompany && (
              <button
                onClick={() => { setEditing(null); setModalOpen(true) }}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-[#061631] font-semibold text-sm hover:brightness-105 transition shadow-lg shadow-cyan-500/20"
              >
                <Plus className="w-4 h-4" /> Nova Empresa
              </button>
            )}
          </>
        }
      />

      {/* Busca */}
      <div className="bbt-card p-4">
        <SearchInput
          value={search}
          onChangeValue={setSearch}
          placeholder="Buscar por nome, CNPJ ou responsável..."
        />
      </div>

      {/* Tabela */}
      <div className="bbt-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bbt-gray-50 dark:bg-slate-900/50 border-b border-bbt-gray-100 dark:border-slate-700">
              <tr>
                <Th>Empresa</Th>
                <Th>CNPJ</Th>
                <Th>Grupo</Th>
                <Th>Responsável</Th>
                <Th>Telefone</Th>
                <Th>Funcionários</Th>
                <Th>Status</Th>
                <Th>Portal Empresa</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-16 text-slate-400">
                    Nenhuma empresa encontrada.
                  </td>
                </tr>
              ) : (
                visible.map((e) => {
                  const totalFunc = funcionarios.filter((f) => f.company_id === e.id).length
                  const grupo = gruposEmpresariais.find((item) => item.id === e.grupo_id)
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-bbt-gray-100 dark:border-slate-700 last:border-0 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-bbt-text dark:text-slate-100">{e.nome}</div>
                        <div className="text-xs text-slate-500">{e.endereco}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 font-mono text-xs">{e.cnpj}</td>
                      <td className="px-4 py-3">
                        {grupo ? (
                          <span className="bbt-badge bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            {grupo.nome}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Sem grupo</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700 dark:text-slate-200">{e.responsavel}</div>
                        <div className="text-xs text-slate-500">{e.email_responsavel}</div>
                      </td>
                      <td className="px-4 py-3">
                        <WhatsAppButton phone={e.telefone} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="bbt-badge bg-bbt-accent/10 text-bbt-primary dark:text-bbt-accent">
                          <Users className="w-3 h-3" />
                          {totalFunc}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {e.ativa ? (
                          <span className="bbt-badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Ativa</span>
                        ) : (
                          <span className="bbt-badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">Inativa</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(e.portal_empresa_habilitado ?? e.ativa) === true ? (
                          <span className="bbt-badge bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                            <MonitorCheck className="w-3 h-3" /> Habilitado
                          </span>
                        ) : (
                          <span className="bbt-badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                            Desabilitado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/dashboard/empresas/${e.id}`}
                            className="p-2 rounded-lg hover:bg-bbt-accent/10 text-slate-500 hover:text-bbt-accent transition"
                            title="Ver detalhes"
                          >
                            <Eye className="w-4 h-4" />
                          </Link>
                          {includesCompany(e.id, 'gerenciar_empresas_grupo') && (
                            <button
                              onClick={() => {
                                setEditing(e)
                                setModalOpen(true)
                              }}
                              className="p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-500 hover:text-blue-600 transition"
                              title="Editar"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {includesCompany(e.id, 'alterar_configuracoes') && (
                            <button
                              onClick={() => setConfigCobrancaEmpresa(e)}
                              className="p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-slate-500 hover:text-green-600 transition"
                              title="Configurar cobrança (markup/taxa)"
                            >
                              <DollarSign className="w-4 h-4" />
                            </button>
                          )}
                          {includesCompany(e.id, 'gerenciar_empresas_grupo') && (
                            <button
                              onClick={() => setConfirmDelete(e)}
                              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-600 transition"
                              title="Excluir"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EmpresaModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        grupos={canCreateCompanyTenantWide
          ? gruposEmpresariais
          : gruposEmpresariais.filter((grupo) => (
              creatableGroupIds.has(grupo.id)
              || grupo.id === editing?.grupo_id
            ))}
        allowWithoutGroup={canCreateCompanyTenantWide || Boolean(editing && !editing.grupo_id)}
        onSave={(data) => {
          if (editing) {
            updateEmpresa(editing.id, data)
            void sincronizarDiretorio('Empresa atualizada.')
          } else {
            if (
              !canCreateCompanyTenantWide
              && !creatableGroupIds.has(String(data.grupo_id || ''))
            ) {
              toast.error('Selecione um grupo com permissao para incluir novas empresas.')
              return
            }
            addEmpresa({ ...data, ativa: data.ativa !== false } as any)
            void sincronizarDiretorio('Empresa cadastrada.')
          }
          setModalOpen(false)
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            deleteEmpresa(confirmDelete.id)
            void sincronizarDiretorio('Empresa excluida.')
          }
        }}
        title="Excluir empresa"
        message={`Tem certeza que deseja excluir "${confirmDelete?.nome}"? Todos os funcionários e políticas vinculados também serão removidos.`}
        confirmLabel="Sim, excluir"
        danger
      />

      <ConfigCobrancaModal
        open={!!configCobrancaEmpresa}
        onClose={() => setConfigCobrancaEmpresa(null)}
        empresa={configCobrancaEmpresa}
      />

      <AIAssistantFab
        pageContext="Empresas"
        dataContext={`Total empresas visíveis: ${visible.length}\nTotal funcionários das empresas visíveis: ${visibleEmployeeCount}\nFiltro de busca: ${search || 'nenhum'}`}
        suggestedPrompts={[
          'Qual empresa tem mais funcionários cadastrados?',
          'Liste empresas sem política de viagem definida',
          'Quais clientes não têm centro de custo padrão?',
          'Sugira ações de relacionamento por empresa',
        ]}
      />
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider ${className}`}>
      {children}
    </th>
  )
}

function EmpresaModal({
  open,
  onClose,
  editing,
  grupos,
  allowWithoutGroup,
  onSave,
}: {
  open: boolean
  onClose: () => void
  editing: Empresa | null
  grupos: Array<{ id: string; nome: string; ativo?: boolean }>
  allowWithoutGroup: boolean
  onSave: (data: Partial<Empresa>) => void
}) {
  const [costCenters, setCostCenters] = useState<Array<{ id: string; code: string; name: string }>>([])
  const [costCentersLoading, setCostCentersLoading] = useState(false)
  const [costCentersUnavailable, setCostCentersUnavailable] = useState(false)
  const [costCentersLoaded, setCostCentersLoaded] = useState(false)
  const [form, setForm] = useState<Partial<Empresa>>(
    editing ? normalizeCompanyForm(editing) : {
      nome: '',
      cnpj: '',
      endereco: '',
      responsavel: '',
      email_responsavel: '',
      telefone: '',
      centro_custo_padrao: '',
      grupo_id: null,
      ativa: true,
      portal_empresa_habilitado: false,
    }
  )

  // Reinicializa ao abrir
  useEffect(() => {
    if (open) {
      setForm(
        editing ? normalizeCompanyForm(editing) : {
          nome: '',
          cnpj: '',
          endereco: '',
          responsavel: '',
          email_responsavel: '',
          telefone: '',
          centro_custo_padrao: '',
          grupo_id: null,
          ativa: true,
          portal_empresa_habilitado: false,
        }
      )
    }
  }, [open, editing])

  useEffect(() => {
    if (!open || !editing?.id) {
      setCostCenters([])
      setCostCentersLoading(false)
      setCostCentersUnavailable(false)
      setCostCentersLoaded(false)
      return
    }
    const controller = new AbortController()
    setCostCenters([])
    setCostCentersLoading(true)
    setCostCentersUnavailable(false)
    setCostCentersLoaded(false)
    void fetch(`/api/cost-centers?companyId=${encodeURIComponent(editing.id)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result?.ok) throw new Error(result?.error || 'Falha ao carregar centros de custo.')
        const rows = Array.isArray(result.items) ? result.items : []
        setCostCenters(rows.flatMap((item: any) => {
          const id = String(item?.projectionId || item?.projection_id || item?.companyCostCenterId || '')
          const code = String(item?.code || '').trim()
          if (!id || !code || item?.isActive === false) return []
          return [{ id, code, name: String(item?.name || code) }]
        }))
        setCostCentersLoaded(true)
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setCostCentersUnavailable(true)
          setCostCentersLoaded(false)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCostCentersLoading(false)
      })
    return () => controller.abort()
  }, [open, editing?.id])

  const selectedCostCenterUnavailable = Boolean(
    costCentersLoaded
    && form.centro_custo_padrao_id
    && !costCenters.some((item) => item.id === form.centro_custo_padrao_id),
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nome || !form.cnpj) {
      toast.error('Preencha nome e CNPJ.')
      return
    }
    if (editing && costCentersLoading) {
      toast.error('Aguarde o carregamento dos centros de custo.')
      return
    }
    if (selectedCostCenterUnavailable) {
      toast.error('O centro de custo padrão está inativo ou indisponível. Selecione outro centro ou remova o vínculo.')
      return
    }
    onSave({ ...form, telefone: onlyDigits(form.telefone || '') })
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar Empresa' : 'Nova Empresa'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nome *">
            <input
              required
              value={form.nome || ''}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              className="bbt-input"
            />
          </Field>
          <Field label="CNPJ *">
            <input
              required
              value={form.cnpj || ''}
              onChange={(e) => setForm({ ...form, cnpj: maskCNPJ(e.target.value) })}
              placeholder="00.000.000/0000-00"
              className="bbt-input"
            />
          </Field>
        </div>
        <Field label="Endereço">
          <input
            value={form.endereco || ''}
            onChange={(e) => setForm({ ...form, endereco: e.target.value })}
            className="bbt-input"
          />
        </Field>
        <Field label="Código do cliente (sistema de emissão — ex: WAY153)">
          <input
            value={form.codigo_cliente || ''}
            onChange={(e) => setForm({ ...form, codigo_cliente: e.target.value.toUpperCase() })}
            placeholder="Usado pra vincular com a planilha de emissões"
            className="bbt-input uppercase"
          />
        </Field>
        <Field label="Grupo empresarial">
          <select
            value={form.grupo_id || ''}
            onChange={(e) => setForm({ ...form, grupo_id: e.target.value || null })}
            className="bbt-input"
          >
            {allowWithoutGroup && <option value="">Sem grupo</option>}
            {grupos.filter((grupo) => grupo.ativo !== false).map((grupo) => (
              <option key={grupo.id} value={grupo.id}>{grupo.nome}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Responsável">
            <input
              value={form.responsavel || ''}
              onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
              className="bbt-input"
            />
          </Field>
          <Field label="E-mail do responsável">
            <input
              type="email"
              value={form.email_responsavel || ''}
              onChange={(e) => setForm({ ...form, email_responsavel: e.target.value })}
              className="bbt-input"
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Telefone">
            <input
              value={maskPhone(form.telefone || '')}
              onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              placeholder="(00) 00000-0000"
              className="bbt-input"
            />
          </Field>
          <Field label="Centro de Custo Padrão">
            {editing && !costCentersUnavailable ? (
              <select
                value={form.centro_custo_padrao_id || ''}
                onChange={(e) => {
                  const selected = costCenters.find((item) => item.id === e.target.value)
                  setForm({
                    ...form,
                    centro_custo_padrao_id: e.target.value || null,
                    centro_custo_padrao: selected?.code || '',
                  })
                }}
                className="bbt-input"
                disabled={costCentersLoading}
              >
                {selectedCostCenterUnavailable && (
                  <option value={form.centro_custo_padrao_id || ''} disabled>
                    {`Indisponível: ${form.centro_custo_padrao || form.centro_custo_padrao_id}`}
                  </option>
                )}
                <option value="">
                  {costCentersLoading
                    ? 'Carregando...'
                    : form.centro_custo_padrao && !form.centro_custo_padrao_id
                      ? `Legado: ${form.centro_custo_padrao}`
                      : 'Sem centro padrão'}
                </option>
                {costCenters.map((item) => (
                  <option key={item.id} value={item.id}>{item.code} · {item.name}</option>
                ))}
              </select>
            ) : (
              <input
                value={form.centro_custo_padrao || ''}
                onChange={(e) => setForm({
                  ...form,
                  centro_custo_padrao_id: null,
                  centro_custo_padrao: e.target.value,
                })}
                className="bbt-input"
                placeholder={editing ? 'Código legado' : 'Defina após criar a empresa'}
              />
            )}
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="ativa"
            checked={form.ativa !== false}
            onChange={(e) => setForm({ ...form, ativa: e.target.checked })}
            className="rounded"
          />
          <label htmlFor="ativa" className="text-sm text-slate-700 dark:text-slate-300">
            Empresa ativa
          </label>
        </div>
        <div className="rounded-xl border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-900/60 dark:bg-cyan-950/20">
          <label htmlFor="portal-empresa-habilitado" className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              id="portal-empresa-habilitado"
              checked={form.portal_empresa_habilitado === true}
              onChange={(e) => setForm({ ...form, portal_empresa_habilitado: e.target.checked })}
              className="mt-1 rounded"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                Habilitar no Portal Empresa
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">
                Torna a empresa elegível para usuários corporativos. O acesso continua dependendo do cadastro da pessoa, das permissões e do escopo da empresa ou do grupo.
              </span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary">{editing ? 'Salvar alterações' : 'Cadastrar empresa'}</button>
        </div>
      </form>
    </Modal>
  )
}

function normalizeCompanyForm(company: Empresa): Empresa {
  return {
    ...company,
    // Empresas legadas ativas já eram elegíveis ao portal. Preserve esse
    // comportamento sem habilitar silenciosamente uma empresa legada inativa.
    portal_empresa_habilitado: company.portal_empresa_habilitado ?? company.ativa,
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  )
}

'use client'

import { addDaysISODate, todayISODate } from '@/lib/date'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { canAccessCompanyPermission, getCurrentUser, hasPermission } from '@/lib/auth'
import { getAtendimentosFiltro } from '@/lib/atendimentos-storage'
import { getEmpresasDoGrupo } from '@/lib/grupos'
import { montarMetricasRelatorio } from '@/lib/relatorios'
import { flushPendingRemoteStorageWithResult } from '@/lib/storage-quota'
import { formatCurrency } from '@/lib/utils'
import type { Empresa, Funcionario, GrupoEmpresarial, Permissoes, User } from '@/types'
import { useCorporateContext } from '@/components/corporate-context-provider'
import { CorporateBrandingSettingsPanel } from '@/components/branding/corporate-branding-settings-panel'
import { VoucherPresentationSettingsPanel } from '@/components/vouchers/voucher-presentation-settings-panel'
import { TravelerManagementSettingsPanel } from '@/components/travelers/traveler-management-settings-panel'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SearchInput } from '@/components/ui/search-input'
import { PageHero } from '@/components/ui/page-hero'
import { DateInput } from '@/components/ui/date-input'
import { Building2, Download, Edit2, Eye, Link2, Network, Plus, Trash2, Unlink, Users } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function GruposEmpresariaisPage() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const podeGerenciar = hasPermission(user, 'gerenciar_empresas_grupo')
  const { refreshAccess } = useCorporateContext()
  const {
    empresas,
    funcionarios,
    gruposEmpresariais,
    addGrupoEmpresarial,
    updateGrupoEmpresarial,
    deleteGrupoEmpresarial,
    vincularEmpresaGrupo,
    desvincularEmpresaGrupo,
  } = useStore()

  const [busca, setBusca] = useState('')
  const [dataInicio, setDataInicio] = useState(addDaysISODate(todayISODate(), -90))
  const [dataFim, setDataFim] = useState(todayISODate())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<GrupoEmpresarial | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<GrupoEmpresarial | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(gruposEmpresariais[0]?.id || null)

  const gruposFiltrados = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase('pt-BR')
    if (!q) return gruposEmpresariais
    return gruposEmpresariais.filter((grupo) =>
      [grupo.nome, grupo.codigo, grupo.cnpj_matriz, grupo.responsavel_nome]
        .some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(q)),
    )
  }, [busca, gruposEmpresariais])

  const grupoSelecionado = gruposEmpresariais.find((grupo) => grupo.id === selectedId) || gruposFiltrados[0] || null
  const empresasSemGrupo = empresas.filter((empresa) => !empresa.grupo_id)
  const podeVerVouchersGrupo = Boolean(grupoSelecionado && hasFullGroupPermission(
    user,
    grupoSelecionado.id,
    'ver_vouchers',
    empresas,
    gruposEmpresariais,
  ))
  const podeAlterarVoucherGrupo = Boolean(grupoSelecionado && hasFullGroupPermission(
    user,
    grupoSelecionado.id,
    'alterar_configuracoes',
    empresas,
    gruposEmpresariais,
  ))
  const podeVerViajantesGrupo = Boolean(grupoSelecionado && hasFullGroupPermission(
    user,
    grupoSelecionado.id,
    'ver_funcionarios',
    empresas,
    gruposEmpresariais,
  ))
  const podeAlterarViajantesGrupo = Boolean(grupoSelecionado && hasFullGroupPermission(
    user,
    grupoSelecionado.id,
    'alterar_configuracoes',
    empresas,
    gruposEmpresariais,
  ))

  function abrirNovo() {
    setEditing(null)
    setModalOpen(true)
  }

  function abrirEditar(grupo: GrupoEmpresarial) {
    setEditing(grupo)
    setModalOpen(true)
  }

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

  function salvarGrupo(data: Partial<GrupoEmpresarial>) {
    if (!data.nome?.trim()) {
      toast.error('Informe o nome do grupo.')
      return
    }
    if (editing) {
      updateGrupoEmpresarial(editing.id, data)
      setSelectedId(editing.id)
      void sincronizarDiretorio('Grupo atualizado.')
    } else {
      const novo = addGrupoEmpresarial({
        nome: data.nome.trim(),
        codigo: data.codigo,
        cnpj_matriz: data.cnpj_matriz,
        descricao: data.descricao,
        responsavel_nome: data.responsavel_nome,
        responsavel_email: data.responsavel_email,
        ativo: data.ativo !== false,
        empresa_ids: data.empresa_ids || [],
      })
      if (novo) {
        setSelectedId(novo.id)
        void sincronizarDiretorio('Grupo cadastrado.')
      }
    }
    setModalOpen(false)
  }

  function vincularEmpresa(empresaId: string, grupoId: string) {
    vincularEmpresaGrupo(empresaId, grupoId)
    void sincronizarDiretorio('Empresa vinculada.')
  }

  function desvincularEmpresa(empresaId: string) {
    desvincularEmpresaGrupo(empresaId)
    void sincronizarDiretorio('Empresa desvinculada.')
  }

  function abrirRelatorio(grupoId: string, visao: 'cliente' | 'agencia') {
    window.open(`/relatorios/grupo?grupo=${grupoId}&inicio=${dataInicio}&fim=${dataFim}&visao=${visao}`, '_blank')
  }

  function abrirRelatorioEmpresa(grupoId: string, empresaId: string, visao: 'cliente' | 'agencia') {
    window.open(`/relatorios/grupo?grupo=${grupoId}&empresa=${empresaId}&inicio=${dataInicio}&fim=${dataFim}&visao=${visao}`, '_blank')
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        eyebrow="Cadastros"
        title="Grupos empresariais"
        icon={Network}
        description="Consolide holdings, unidades e empresas relacionadas com relatorios por grupo e por empresa."
        bgImage="https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=2000&q=85"
        metrics={[
          { icon: Network, label: 'Grupos', value: gruposEmpresariais.length },
          { icon: Building2, label: 'Empresas vinculadas', value: empresas.filter((empresa) => empresa.grupo_id).length },
          { icon: Users, label: 'Viajantes', value: funcionarios.length },
        ]}
        actions={
          podeGerenciar ? (
            <button onClick={abrirNovo} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-[#061631] font-semibold text-sm hover:brightness-105 transition shadow-lg shadow-cyan-500/20">
              <Plus className="w-4 h-4" /> Novo grupo
            </button>
          ) : null
        }
      />

      <div className="bbt-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <DateInput aria-label="Data inicial do período dos grupos" value={dataInicio} onChange={(event) => setDataInicio(event.target.value)} className="w-auto" containerClassName="w-auto" />
            <span className="text-sm text-slate-400">ate</span>
            <DateInput aria-label="Data final do período dos grupos" value={dataFim} onChange={(event) => setDataFim(event.target.value)} className="w-auto" containerClassName="w-auto" />
          </div>
          <div className="w-full sm:w-80">
            <SearchInput value={busca} onChangeValue={setBusca} placeholder="Buscar grupo..." size="sm" />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="bbt-card overflow-hidden">
          <div className="border-b border-bbt-gray-100 p-5 dark:border-slate-700">
            <h3 className="flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
              <Network className="h-5 w-5 text-bbt-accent" /> Grupos cadastrados
            </h3>
          </div>
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {gruposFiltrados.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-400">Nenhum grupo empresarial cadastrado.</div>
            ) : (
              gruposFiltrados.map((grupo) => {
                const resumo = montarResumoGrupo(grupo, empresas, funcionarios, dataInicio, dataFim)
                const ativo = grupoSelecionado?.id === grupo.id
                return (
                  <button
                    key={grupo.id}
                    onClick={() => setSelectedId(grupo.id)}
                    className={`w-full p-4 text-left transition ${ativo ? 'bg-bbt-accent/10' : 'hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30'}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-bbt-accent/10 text-bbt-accent">
                        <Network className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate font-semibold text-bbt-primary dark:text-white">{grupo.nome}</h4>
                          <span className={`bbt-badge text-[10px] ${grupo.ativo !== false ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                            {grupo.ativo !== false ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {resumo.empresas} empresa(s) - {resumo.demandas} demanda(s) - {formatCurrency(resumo.faturado)}
                        </p>
                      </div>
                      <div className="hidden text-right sm:block">
                        <div className="text-sm font-semibold text-bbt-primary dark:text-white">{formatCurrency(resumo.economia)}</div>
                        <div className="text-[10px] uppercase text-slate-500">Economia</div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="space-y-5">
          {grupoSelecionado ? (
            <GrupoDetalhe
              grupo={grupoSelecionado}
              empresas={empresas}
              funcionarios={funcionarios}
              dataInicio={dataInicio}
              dataFim={dataFim}
              podeGerenciar={podeGerenciar}
              onEditar={() => abrirEditar(grupoSelecionado)}
              onExcluir={() => setConfirmDelete(grupoSelecionado)}
              onRelatorio={abrirRelatorio}
              onRelatorioEmpresa={abrirRelatorioEmpresa}
              onVincular={vincularEmpresa}
              onDesvincular={desvincularEmpresa}
            />
          ) : (
            <div className="bbt-card p-8 text-center text-sm text-slate-400">Selecione ou cadastre um grupo.</div>
          )}

          {grupoSelecionado && podeVerVouchersGrupo && (
            <VoucherPresentationSettingsPanel
              key={`group:${grupoSelecionado.id}`}
              scopeType="group"
              scopeId={grupoSelecionado.id}
              scopeName={grupoSelecionado.nome}
              canManage={podeAlterarVoucherGrupo}
              compact
            />
          )}

          {grupoSelecionado && podeVerViajantesGrupo && (
            <TravelerManagementSettingsPanel
              key={`group:${grupoSelecionado.id}`}
              scopeType="group"
              scopeId={grupoSelecionado.id}
              scopeName={grupoSelecionado.nome}
              canManage={podeAlterarViajantesGrupo}
              compact
            />
          )}

          {grupoSelecionado && podeAlterarVoucherGrupo && (
            <CorporateBrandingSettingsPanel
              key={`group:${grupoSelecionado.id}`}
              scopeType="group"
              scopeId={grupoSelecionado.id}
              scopeName={grupoSelecionado.nome}
              canManage
              compact
            />
          )}

          {podeGerenciar && empresasSemGrupo.length > 0 && grupoSelecionado && (
            <div className="bbt-card p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-bbt-primary dark:text-white">
                <Link2 className="h-5 w-5 text-bbt-accent" /> Empresas sem grupo
              </h3>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {empresasSemGrupo.map((empresa) => (
                  <div key={empresa.id} className="flex items-center justify-between gap-3 rounded-md border border-bbt-gray-100 p-3 dark:border-slate-700">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-bbt-primary dark:text-white">{empresa.nome}</div>
                      <div className="text-xs text-slate-500">{empresa.cnpj}</div>
                    </div>
                    <button onClick={() => vincularEmpresa(empresa.id, grupoSelecionado.id)} className="bbt-button-ghost h-8 text-xs">
                      Vincular
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <GrupoModal open={modalOpen} editing={editing} empresas={empresas} onClose={() => setModalOpen(false)} onSave={salvarGrupo} />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return
          deleteGrupoEmpresarial(confirmDelete.id)
          void sincronizarDiretorio('Grupo removido. Empresas foram desvinculadas.')
          setConfirmDelete(null)
          setSelectedId(null)
        }}
        title="Remover grupo"
        message={`Remover "${confirmDelete?.nome}"? As empresas serao mantidas, apenas desvinculadas do grupo.`}
        confirmLabel="Remover"
        danger
      />
    </div>
  )
}

function GrupoDetalhe({
  grupo,
  empresas,
  funcionarios,
  dataInicio,
  dataFim,
  podeGerenciar,
  onEditar,
  onExcluir,
  onRelatorio,
  onRelatorioEmpresa,
  onVincular,
  onDesvincular,
}: {
  grupo: GrupoEmpresarial
  empresas: Empresa[]
  funcionarios: Funcionario[]
  dataInicio: string
  dataFim: string
  podeGerenciar: boolean
  onEditar: () => void
  onExcluir: () => void
  onRelatorio: (grupoId: string, visao: 'cliente' | 'agencia') => void
  onRelatorioEmpresa: (grupoId: string, empresaId: string, visao: 'cliente' | 'agencia') => void
  onVincular: (empresaId: string, grupoId: string) => void
  onDesvincular: (empresaId: string) => void
}) {
  const empresasGrupo = getEmpresasDoGrupo(grupo.id, empresas, [grupo])
  const resumo = montarResumoGrupo(grupo, empresas, funcionarios, dataInicio, dataFim)

  return (
    <div className="bbt-card overflow-hidden">
      <div className="border-b border-bbt-gray-100 p-5 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="bbt-section-label">Detalhe do grupo</p>
            <h2 className="mt-1 text-xl font-semibold text-bbt-primary dark:text-white">{grupo.nome}</h2>
            <p className="mt-1 text-sm text-slate-500">{grupo.descricao || grupo.codigo || 'Sem descricao.'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onRelatorio(grupo.id, 'cliente')} className="bbt-button-ghost h-9 text-xs">
              <Eye className="h-4 w-4" /> Cliente
            </button>
            <button onClick={() => onRelatorio(grupo.id, 'agencia')} className="bbt-button-accent h-9 text-xs">
              <Download className="h-4 w-4" /> Interno
            </button>
            {podeGerenciar && (
              <>
                <button onClick={onEditar} className="rounded-md p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600" title="Editar">
                  <Edit2 className="h-4 w-4" />
                </button>
                <button onClick={onExcluir} className="rounded-md p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600" title="Excluir">
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <ResumoBox label="Empresas" value={String(resumo.empresas)} />
          <ResumoBox label="Demandas" value={String(resumo.demandas)} />
          <ResumoBox label="Valor final" value={formatCurrency(resumo.faturado)} />
          <ResumoBox label="Economia" value={formatCurrency(resumo.economia)} />
        </div>
      </div>

      <div className="max-h-[520px] divide-y divide-bbt-gray-100 overflow-y-auto dark:divide-slate-700">
        {empresasGrupo.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Nenhuma empresa vinculada.</div>
        ) : (
          empresasGrupo.map((empresa) => {
            const resumoEmpresa = montarResumoEmpresa(empresa.id, funcionarios, dataInicio, dataFim)
            return (
              <div key={empresa.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/dashboard/empresas/${empresa.id}`} className="truncate text-sm font-semibold text-bbt-primary hover:text-bbt-accent dark:text-white">
                      {empresa.nome}
                    </Link>
                    <p className="text-xs text-slate-500">{empresa.cnpj} - {resumoEmpresa.demandas} demanda(s)</p>
                    <p className="mt-1 text-xs font-semibold text-bbt-primary dark:text-bbt-accent">{formatCurrency(resumoEmpresa.faturado)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => onRelatorioEmpresa(grupo.id, empresa.id, 'cliente')} className="rounded-md border border-bbt-gray-100 px-2 py-1.5 text-xs font-semibold text-bbt-primary hover:bg-bbt-gray-50">
                      Cliente
                    </button>
                    <button onClick={() => onRelatorioEmpresa(grupo.id, empresa.id, 'agencia')} className="rounded-md bg-bbt-accent px-2 py-1.5 text-xs font-semibold text-white hover:brightness-110">
                      Interno
                    </button>
                    {podeGerenciar && (
                      <button onClick={() => onDesvincular(empresa.id)} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" title="Desvincular">
                        <Unlink className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function GrupoModal({
  open,
  editing,
  empresas,
  onClose,
  onSave,
}: {
  open: boolean
  editing: GrupoEmpresarial | null
  empresas: Empresa[]
  onClose: () => void
  onSave: (data: Partial<GrupoEmpresarial>) => void
}) {
  const [form, setForm] = useState<Partial<GrupoEmpresarial>>(editing || { nome: '', ativo: true, empresa_ids: [] })

  useEffect(() => {
    if (open) setForm(editing || { nome: '', ativo: true, empresa_ids: [] })
  }, [editing, open])

  function toggleEmpresa(empresaId: string) {
    const current = new Set(form.empresa_ids || [])
    if (current.has(empresaId)) current.delete(empresaId)
    else current.add(empresaId)
    setForm({ ...form, empresa_ids: Array.from(current) })
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar grupo empresarial' : 'Novo grupo empresarial'} size="lg">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(form)
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome *">
            <input required value={form.nome || ''} onChange={(event) => setForm({ ...form, nome: event.target.value })} className="bbt-input" />
          </Field>
          <Field label="Codigo interno">
            <input value={form.codigo || ''} onChange={(event) => setForm({ ...form, codigo: event.target.value.toUpperCase() })} className="bbt-input uppercase" />
          </Field>
          <Field label="CNPJ matriz">
            <input value={form.cnpj_matriz || ''} onChange={(event) => setForm({ ...form, cnpj_matriz: event.target.value })} className="bbt-input" />
          </Field>
          <Field label="Responsavel">
            <input value={form.responsavel_nome || ''} onChange={(event) => setForm({ ...form, responsavel_nome: event.target.value })} className="bbt-input" />
          </Field>
          <Field label="E-mail responsavel">
            <input type="email" value={form.responsavel_email || ''} onChange={(event) => setForm({ ...form, responsavel_email: event.target.value })} className="bbt-input" />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.ativo !== false} onChange={(event) => setForm({ ...form, ativo: event.target.checked })} />
            Grupo ativo
          </label>
        </div>
        <Field label="Descricao">
          <textarea value={form.descricao || ''} onChange={(event) => setForm({ ...form, descricao: event.target.value })} rows={3} className="bbt-input" />
        </Field>
        <div className="rounded-lg border border-bbt-gray-100 p-3 dark:border-slate-700">
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Empresas vinculadas</div>
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {empresas.map((empresa) => (
              <label key={empresa.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bbt-gray-50 dark:hover:bg-slate-800">
                <input type="checkbox" checked={(form.empresa_ids || []).includes(empresa.id)} onChange={() => toggleEmpresa(empresa.id)} />
                <span className="truncate">{empresa.nome}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-bbt-gray-100 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary">{editing ? 'Salvar alteracoes' : 'Cadastrar grupo'}</button>
        </div>
      </form>
    </Modal>
  )
}

function montarResumoGrupo(grupo: GrupoEmpresarial, empresas: Empresa[], funcionarios: Funcionario[], dataInicio: string, dataFim: string) {
  const empresasGrupo = getEmpresasDoGrupo(grupo.id, empresas, [grupo])
  const ids = new Set(empresasGrupo.map((empresa) => empresa.id))
  const atendimentos = getAtendimentosFiltro({ data_inicio: dataInicio, data_fim: dataFim }).filter((atendimento) => ids.has(atendimento.empresa_id))
  const metricas = montarMetricasRelatorio(atendimentos, funcionarios)
  return {
    empresas: empresasGrupo.length,
    demandas: metricas.total,
    faturado: metricas.faturadoTotal,
    economia: metricas.economia.economiaTotal,
  }
}

function montarResumoEmpresa(empresaId: string, funcionarios: Funcionario[], dataInicio: string, dataFim: string) {
  const atendimentos = getAtendimentosFiltro({ empresa_id: empresaId, data_inicio: dataInicio, data_fim: dataFim })
  const metricas = montarMetricasRelatorio(atendimentos, funcionarios)
  return {
    demandas: metricas.total,
    faturado: metricas.faturadoTotal,
  }
}

function ResumoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bbt-gray-50 p-3 dark:bg-slate-900">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-bbt-primary dark:text-white">{value}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

function hasFullGroupPermission(
  user: User | null,
  groupId: string,
  permission: keyof Permissoes,
  empresas: Empresa[],
  grupos: GrupoEmpresarial[],
): boolean {
  if (!user || user.ativo === false) return false
  if (user.platform_admin || user.role_key === 'tenant_admin') return true
  const activeCompanies = getEmpresasDoGrupo(groupId, empresas, grupos)
    .filter((empresa) => empresa.ativa !== false)
  if (!activeCompanies.length) return false
  return activeCompanies.every((empresa) => canAccessCompanyPermission(
    user,
    empresa.id,
    permission,
    empresas,
    grupos,
  ))
}

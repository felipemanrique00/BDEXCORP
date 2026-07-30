'use client'

import {
  Archive,
  BookOpenCheck,
  CheckCircle2,
  CirclePlus,
  CopyPlus,
  FileText,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCorporateContext } from '@/components/corporate-context-provider'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Modal } from '@/components/ui/modal'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { GovernanceClientError } from '@/lib/governance-client'
import type {
  KnowledgeClassification,
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeDocumentStatus,
  KnowledgeScopeType,
  KnowledgeSourceType,
} from '@/lib/knowledge'
import {
  archiveKnowledgeDocumentClient,
  createKnowledgeDocumentClient,
  deleteKnowledgeDocumentClient,
  fetchKnowledgeDocument,
  fetchKnowledgeDocuments,
  publishKnowledgeDocumentClient,
  updateKnowledgeDocumentClient,
} from '@/lib/knowledge/client'
import type { User } from '@/types'

interface EditorModel {
  id: string | null
  documentCode: string
  title: string
  description: string
  sourceType: KnowledgeSourceType
  sourceRef: string
  scopeType: KnowledgeScopeType
  scopeId: string
  classification: KnowledgeClassification
  content: string
  metadata: Record<string, unknown>
  status: KnowledgeDocumentStatus
  contentHash: string
  chunks: number
  scopeLabel: string
}

type TransitionKind = 'publish' | 'archive'

const STATUS_LABEL: Record<KnowledgeDocumentStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  archived: 'Arquivado',
}

const CLASSIFICATION_LABEL: Record<KnowledgeClassification, string> = {
  internal: 'Interno',
  confidential: 'Confidencial',
  restricted: 'Restrito',
}

const SOURCE_LABEL: Record<KnowledgeSourceType, string> = {
  manual: 'Conteudo manual',
  policy: 'Politica corporativa',
  report: 'Relatorio',
  file: 'Arquivo',
  integration: 'Integracao',
}

export function KnowledgeConsole() {
  const { access, context } = useCorporateContext()
  const [user, setUser] = useState<User | null>(null)
  const [items, setItems] = useState<KnowledgeDocument[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [status, setStatus] = useState<KnowledgeDocumentStatus | ''>('')
  const [scopeType, setScopeType] = useState<KnowledgeScopeType | ''>('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<EditorModel | null>(null)
  const [dirty, setDirty] = useState(false)
  const [transition, setTransition] = useState<TransitionKind | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
  const [transitioning, setTransitioning] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => setUser(getCurrentUser()), [])
  const canManage = hasPermission(user, 'gerenciar_ia')
  const canUse = hasPermission(user, 'usar_ia')
  const canUseTenantScope = Boolean(user?.platform_admin || user?.role_key === 'tenant_admin')

  const companies = useMemo(
    () => access?.companies
      .filter((company) => company.permissions.gerenciar_ia)
      .map((company) => ({
        id: company.companyId,
        name: company.companyName,
        groupId: company.groupId,
      })) || [],
    [access?.companies],
  )
  const groups = useMemo(
    () => access?.groups
      .filter((group) => (
        group.companyIds.length > 0
        && group.companyIds.every((companyId) => companies.some((company) => company.id === companyId))
      ))
      .map((group) => ({ id: group.groupId, name: group.groupName })) || [],
    [access?.groups, companies],
  )

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchKnowledgeDocuments({
        search: appliedSearch || undefined,
        status: status || undefined,
        scopeType: scopeType || undefined,
        limit: 100,
      })
      setItems(result.items)
      setTotal(result.total)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [appliedSearch, scopeType, status])

  useEffect(() => {
    if (canManage) void loadDocuments()
  }, [canManage, loadDocuments])

  async function openDocument(id: string) {
    if (dirty && !window.confirm('Descartar alteracoes nao salvas?')) return
    setDetailLoading(true)
    try {
      const document = await fetchKnowledgeDocument(id)
      setEditor(editorFromDocument(document))
      setDirty(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDetailLoading(false)
    }
  }

  function startNew() {
    if (dirty && !window.confirm('Descartar alteracoes nao salvas?')) return
    const selectedCompany = context?.type === 'company'
      ? companies.find((company) => company.id === context.id)
      : null
    const selectedGroup = context?.type === 'group'
      ? groups.find((group) => group.id === context.id)
      : null
    const defaultScope = selectedGroup
      ? { type: 'group' as const, id: selectedGroup.id, label: selectedGroup.name }
      : selectedCompany
        ? { type: 'company' as const, id: selectedCompany.id, label: selectedCompany.name }
        : companies[0]
          ? { type: 'company' as const, id: companies[0].id, label: companies[0].name }
          : canUseTenantScope
            ? { type: 'tenant' as const, id: '', label: 'Todo o tenant' }
            : null
    if (!defaultScope) {
      toast.error('Nenhum escopo com permissao de gestao esta disponivel.')
      return
    }
    setEditor({
      id: null,
      documentCode: '',
      title: '',
      description: '',
      sourceType: 'manual',
      sourceRef: '',
      scopeType: defaultScope.type,
      scopeId: defaultScope.id,
      classification: 'internal',
      content: '',
      metadata: {},
      status: 'draft',
      contentHash: '',
      chunks: 0,
      scopeLabel: defaultScope.label,
    })
    setDirty(false)
  }

  function createRevision() {
    if (!editor) return
    setEditor({
      ...editor,
      id: null,
      documentCode: '',
      title: `${editor.title} - revisao`,
      sourceRef: '',
      status: 'draft',
      contentHash: '',
      chunks: 0,
      scopeLabel: editor.scopeLabel,
      metadata: {
        ...editor.metadata,
        supersedesDocumentId: editor.id,
        supersedesDocumentCode: editor.documentCode,
      },
    })
    setDirty(true)
  }

  function patchEditor(patch: Partial<EditorModel>) {
    setEditor((current) => current ? { ...current, ...patch } : current)
    setDirty(true)
  }

  function changeScope(nextType: KnowledgeScopeType) {
    const first = nextType === 'company'
      ? companies[0]
      : nextType === 'group'
        ? groups[0]
        : null
    patchEditor({
      scopeType: nextType,
      scopeId: first?.id || '',
      scopeLabel: first?.name || (nextType === 'tenant' ? 'Todo o tenant' : ''),
    })
  }

  function changeScopeId(id: string) {
    if (!editor) return
    const option = editor.scopeType === 'group'
      ? groups.find((group) => group.id === id)
      : companies.find((company) => company.id === id)
    patchEditor({ scopeId: id, scopeLabel: option?.name || id })
  }

  async function saveDocument() {
    if (!editor) return
    if (editor.status !== 'draft') {
      toast.error('Documentos publicados ou arquivados sao imutaveis.')
      return
    }
    if (editor.title.trim().length < 3 || editor.content.trim().length < 20) {
      toast.error('Informe titulo e conteudo com pelo menos 20 caracteres.')
      return
    }
    if (editor.scopeType !== 'tenant' && !editor.scopeId) {
      toast.error('Selecione o grupo ou a empresa do documento.')
      return
    }

    setSaving(true)
    try {
      const input: KnowledgeDocumentInput = {
        ...(editor.documentCode.trim()
          ? { documentCode: editor.documentCode.trim().toUpperCase() }
          : {}),
        title: editor.title.trim(),
        description: editor.description.trim(),
        sourceType: editor.sourceType,
        sourceRef: editor.sourceRef.trim() || null,
        scopeType: editor.scopeType,
        scopeId: editor.scopeType === 'tenant' ? null : editor.scopeId,
        classification: editor.classification,
        content: editor.content,
        metadata: editor.metadata,
      }
      const document = editor.id
        ? await updateKnowledgeDocumentClient(editor.id, {
          ...input,
          documentCode: editor.documentCode,
          expectedContentHash: editor.contentHash,
        })
        : await createKnowledgeDocumentClient(input)
      setEditor(editorFromDocument(document))
      setDirty(false)
      await loadDocuments()
      toast.success(editor.id ? 'Rascunho atualizado.' : 'Documento criado e indexado.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function executeTransition() {
    if (!editor?.id || !transition) return
    if (transitionReason.trim().length < 10) {
      toast.error('Informe uma justificativa com pelo menos 10 caracteres.')
      return
    }
    setTransitioning(true)
    try {
      const document = transition === 'publish'
        ? await publishKnowledgeDocumentClient(editor.id, {
          expectedContentHash: editor.contentHash,
          reason: transitionReason.trim(),
        })
        : await archiveKnowledgeDocumentClient(editor.id, transitionReason.trim())
      setEditor(editorFromDocument(document))
      setDirty(false)
      setTransition(null)
      setTransitionReason('')
      await loadDocuments()
      toast.success(transition === 'publish' ? 'Documento publicado.' : 'Documento arquivado.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTransitioning(false)
    }
  }

  async function deleteDraft() {
    if (!editor?.id) return
    setSaving(true)
    try {
      await deleteKnowledgeDocumentClient(editor.id)
      setEditor(null)
      setDirty(false)
      await loadDocuments()
      toast.success('Rascunho excluido.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (!user) return <LoadingState label="Carregando permissoes" />
  if (!canManage) {
    return (
      <EmptyState
        icon={LockKeyhole}
        title="Acesso administrativo necessario"
        description={canUse
          ? 'Voce pode usar a BIA, mas nao possui permissao para publicar conhecimento corporativo.'
          : 'Seu perfil nao possui permissao para usar ou administrar a inteligencia corporativa.'}
      />
    )
  }

  const published = items.filter((item) => item.status === 'published').length
  const drafts = items.filter((item) => item.status === 'draft').length

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Governanca de IA</p>
          <h1 className="bbt-page-title mt-1 flex items-center gap-2">
            <BookOpenCheck className="h-6 w-6 text-bbt-accent" />
            Base de conhecimento
          </h1>
          <p className="bbt-page-subtitle">
            Conteudo corporativo autorizado, versionado por publicacao e isolado por tenant, grupo e empresa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="bbt-button-ghost" onClick={() => void loadDocuments()}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button type="button" className="bbt-button-primary" onClick={startNew}>
            <CirclePlus className="h-4 w-4" />
            Novo documento
          </button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={FileText} label="Documentos no filtro" value={total} />
        <Metric icon={CheckCircle2} label="Publicados na consulta" value={published} tone="green" />
        <Metric icon={ShieldCheck} label="Rascunhos na consulta" value={drafts} tone="amber" />
      </div>

      <section className="space-y-3" aria-label="Filtros da base de conhecimento">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-end">
          <label className="text-xs font-semibold uppercase text-slate-500">
            Buscar
            <span className="mt-1 flex items-center rounded-md border border-bbt-gray-100 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setAppliedSearch(search.trim())
                }}
                className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
                placeholder="Codigo, titulo ou descricao"
              />
            </span>
          </label>
          <FilterSelect
            label="Status"
            value={status}
            onChange={(value) => setStatus(value as KnowledgeDocumentStatus | '')}
            options={[
              { value: '', label: 'Todos' },
              ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FilterSelect
            label="Escopo"
            value={scopeType}
            onChange={(value) => setScopeType(value as KnowledgeScopeType | '')}
            options={[
              { value: '', label: 'Todos' },
              { value: 'tenant', label: 'Tenant' },
              { value: 'group', label: 'Grupo' },
              { value: 'company', label: 'Empresa' },
            ]}
          />
          <button type="button" className="bbt-button-primary" onClick={() => setAppliedSearch(search.trim())}>
            <Search className="h-4 w-4" />
            Aplicar
          </button>
        </div>
      </section>

      <div className="grid min-h-[560px] gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-bbt-gray-100 px-4 py-3 dark:border-slate-800">
            <h2 className="font-semibold text-bbt-primary dark:text-white">Documentos</h2>
            <p className="mt-0.5 text-xs text-slate-500">{total} registro(s) visivel(is)</p>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {loading ? (
              <LoadingState label="Carregando documentos" compact />
            ) : items.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Nenhum documento encontrado"
                description="Crie um rascunho ou ajuste os filtros."
                compact
              />
            ) : items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openDocument(item.id)}
                className={`w-full border-b border-bbt-gray-100 px-4 py-3 text-left transition hover:bg-bbt-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${
                  editor?.id === item.id ? 'bg-cyan-50/70 dark:bg-cyan-950/20' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-bbt-primary dark:text-white">{item.title}</span>
                    <span className="mt-1 block truncate font-mono text-[11px] text-slate-500">{item.documentCode}</span>
                  </span>
                  <StatusBadge status={item.status} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="truncate">{item.scopeLabel}</span>
                  <span className="shrink-0">{item.chunks} trecho(s)</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="min-w-0 rounded-md border border-bbt-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          {detailLoading ? (
            <LoadingState label="Carregando documento" />
          ) : !editor ? (
            <EmptyState
              icon={BookOpenCheck}
              title="Selecione ou crie um documento"
              description="A BIA consulta apenas conteudo publicado e permitido pelo escopo do usuario."
            />
          ) : (
            <KnowledgeEditor
              editor={editor}
              companies={companies}
              groups={groups}
              canUseTenantScope={canUseTenantScope}
              dirty={dirty}
              saving={saving}
              onPatch={patchEditor}
              onScopeType={changeScope}
              onScopeId={changeScopeId}
              onSave={() => void saveDocument()}
              onPublish={() => {
                setTransitionReason('')
                setTransition('publish')
              }}
              onArchive={() => {
                setTransitionReason('')
                setTransition('archive')
              }}
              onDelete={() => setDeleteOpen(true)}
              onRevision={createRevision}
            />
          )}
        </section>
      </div>

      <Modal
        open={transition !== null}
        onClose={() => !transitioning && setTransition(null)}
        title={transition === 'publish' ? 'Publicar conhecimento' : 'Arquivar documento'}
        size="sm"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {transition === 'publish'
            ? 'A versao publicada fica imutavel e passa a ser pesquisavel pela BIA conforme o escopo.'
            : 'O documento deixa de ser utilizado pela BIA. O historico e a auditoria permanecem preservados.'}
        </p>
        <label className="mt-4 block text-xs font-semibold uppercase text-slate-500">
          Justificativa
          <textarea
            value={transitionReason}
            onChange={(event) => setTransitionReason(event.target.value)}
            className="bbt-input mt-1 min-h-24 w-full resize-y"
            maxLength={1_000}
            placeholder="Registre o motivo da decisao"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="bbt-button-ghost" onClick={() => setTransition(null)} disabled={transitioning}>
            Cancelar
          </button>
          <button type="button" className="bbt-button-primary" onClick={() => void executeTransition()} disabled={transitioning}>
            {transitioning && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteDraft()}
        title="Excluir rascunho"
        message="Esta acao remove somente o rascunho selecionado. Documentos publicados nao podem ser excluidos."
        confirmLabel="Excluir"
        danger
      />
    </div>
  )
}

function KnowledgeEditor(props: {
  editor: EditorModel
  companies: Array<{ id: string; name: string; groupId: string | null }>
  groups: Array<{ id: string; name: string }>
  canUseTenantScope: boolean
  dirty: boolean
  saving: boolean
  onPatch: (patch: Partial<EditorModel>) => void
  onScopeType: (scope: KnowledgeScopeType) => void
  onScopeId: (id: string) => void
  onSave: () => void
  onPublish: () => void
  onArchive: () => void
  onDelete: () => void
  onRevision: () => void
}) {
  const { editor } = props
  const editable = editor.status === 'draft'
  const scopeOptions = editor.scopeType === 'group' ? props.groups : props.companies

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-bbt-gray-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-semibold text-bbt-primary dark:text-white">
              {editor.id ? editor.title || 'Documento sem titulo' : 'Novo documento'}
            </h2>
            <StatusBadge status={editor.status} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {editor.id ? `${editor.documentCode} | ${editor.chunks} trecho(s) indexado(s)` : 'Salve o rascunho antes de publicar.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editable && (
            <button type="button" className="bbt-button-outline" onClick={props.onRevision}>
              <CopyPlus className="h-4 w-4" />
              Criar revisao
            </button>
          )}
          {editor.id && editor.status !== 'archived' && (
            <button type="button" className="bbt-button-ghost" onClick={props.onArchive}>
              <Archive className="h-4 w-4" />
              Arquivar
            </button>
          )}
          {editor.id && editable && (
            <button type="button" className="bbt-button-ghost text-red-600" onClick={props.onDelete}>
              <Trash2 className="h-4 w-4" />
              Excluir
            </button>
          )}
          {editor.id && editable && (
            <button type="button" className="bbt-button-accent" onClick={props.onPublish} disabled={props.dirty}>
              <CheckCircle2 className="h-4 w-4" />
              Publicar
            </button>
          )}
          {editable && (
            <button type="button" className="bbt-button-primary" onClick={props.onSave} disabled={props.saving || (!props.dirty && Boolean(editor.id))}>
              {props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
          )}
        </div>
      </div>

      <fieldset disabled={!editable || props.saving} className="space-y-5 p-5 disabled:opacity-80">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Titulo" className="md:col-span-2">
            <input className="bbt-input mt-1 w-full" value={editor.title} maxLength={240} onChange={(event) => props.onPatch({ title: event.target.value })} />
          </Field>
          <Field label="Codigo">
            <input className="bbt-input mt-1 w-full font-mono" value={editor.documentCode} maxLength={80} placeholder="Gerado automaticamente" onChange={(event) => props.onPatch({ documentCode: event.target.value.toUpperCase() })} />
          </Field>
          <Field label="Classificacao">
            <select className="bbt-input mt-1 w-full" value={editor.classification} onChange={(event) => props.onPatch({ classification: event.target.value as KnowledgeClassification })}>
              {Object.entries(CLASSIFICATION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Descricao" className="md:col-span-2">
            <textarea className="bbt-input mt-1 min-h-20 w-full resize-y" value={editor.description} maxLength={2_000} onChange={(event) => props.onPatch({ description: event.target.value })} />
          </Field>
          <Field label="Origem">
            <select className="bbt-input mt-1 w-full" value={editor.sourceType} onChange={(event) => props.onPatch({ sourceType: event.target.value as KnowledgeSourceType })}>
              {Object.entries(SOURCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Referencia da origem">
            <input className="bbt-input mt-1 w-full" value={editor.sourceRef} maxLength={500} placeholder="Opcional e unica enquanto ativa" onChange={(event) => props.onPatch({ sourceRef: event.target.value })} />
          </Field>
          <Field label="Tipo de escopo">
            <select className="bbt-input mt-1 w-full" value={editor.scopeType} onChange={(event) => props.onScopeType(event.target.value as KnowledgeScopeType)}>
              {props.canUseTenantScope && <option value="tenant">Todo o tenant</option>}
              {props.groups.length > 0 && <option value="group">Grupo empresarial</option>}
              {props.companies.length > 0 && <option value="company">Empresa</option>}
            </select>
          </Field>
          <Field label="Escopo autorizado">
            {editor.scopeType === 'tenant' ? (
              <input className="bbt-input mt-1 w-full" value="Todo o tenant" readOnly />
            ) : (
              <select className="bbt-input mt-1 w-full" value={editor.scopeId} onChange={(event) => props.onScopeId(event.target.value)}>
                <option value="">Selecione</option>
                {scopeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            )}
          </Field>
        </div>

        <Field label="Conteudo corporativo">
          <textarea
            className="bbt-input mt-1 min-h-[300px] w-full resize-y font-mono text-sm leading-6"
            value={editor.content}
            maxLength={500_000}
            onChange={(event) => props.onPatch({ content: event.target.value })}
            placeholder="Insira somente conteudo validado pela empresa. Instrucoes encontradas aqui nunca substituem as regras do sistema."
          />
          <span className="mt-1 block text-right text-xs text-slate-500">
            {editor.content.length.toLocaleString('pt-BR')} / 500.000 caracteres
          </span>
        </Field>
      </fieldset>

      {!editable && (
        <div className="border-t border-bbt-gray-100 px-5 py-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              Esta versao e imutavel. Para alterar o conteudo, crie uma revisao e publique-a apos validacao.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function editorFromDocument(document: KnowledgeDocument): EditorModel {
  return {
    id: document.id,
    documentCode: document.documentCode,
    title: document.title,
    description: document.description,
    sourceType: document.sourceType,
    sourceRef: document.sourceRef || '',
    scopeType: document.scopeType,
    scopeId: document.scopeId || '',
    classification: document.classification,
    content: document.content || '',
    metadata: document.metadata || {},
    status: document.status,
    contentHash: document.contentHash,
    chunks: document.chunks,
    scopeLabel: document.scopeLabel,
  }
}

function StatusBadge({ status }: { status: KnowledgeDocumentStatus }) {
  const style = status === 'published'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    : status === 'archived'
      ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
  return <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold uppercase ${style}`}>{STATUS_LABEL[status]}</span>
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = 'blue',
}: {
  icon: typeof FileText
  label: string
  value: number
  tone?: 'blue' | 'green' | 'amber'
}) {
  const toneClass = tone === 'green'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
      : 'bg-cyan-50 text-bbt-primary dark:bg-cyan-950/30 dark:text-cyan-200'
  return (
    <div className="flex items-center gap-3 rounded-md border border-bbt-gray-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className={`grid h-10 w-10 place-items-center rounded-md ${toneClass}`}><Icon className="h-5 w-5" /></span>
      <span>
        <span className="block text-xs text-slate-500">{label}</span>
        <strong className="text-xl text-bbt-primary dark:text-white">{value}</strong>
      </span>
    </div>
  )
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return <label className={`block text-xs font-semibold uppercase text-slate-500 ${className}`}>{label}{children}</label>
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="text-xs font-semibold uppercase text-slate-500">
      {label}
      <select className="bbt-input mt-1 w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-sm text-slate-500 ${compact ? 'p-8' : 'min-h-64 p-8'}`}>
      <Loader2 className="h-5 w-5 animate-spin" />
      {label}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
  compact = false,
}: {
  icon: typeof FileText
  title: string
  description: string
  compact?: boolean
}) {
  return (
    <div className={`grid place-items-center px-6 text-center ${compact ? 'py-10' : 'min-h-64 py-12'}`}>
      <Icon className="h-8 w-8 text-slate-400" />
      <h2 className="mt-3 font-semibold text-bbt-primary dark:text-white">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof GovernanceClientError) {
    return error.requestId ? `${error.message} (solicitacao ${error.requestId})` : error.message
  }
  return error instanceof Error ? error.message : 'Nao foi possivel concluir a operacao.'
}

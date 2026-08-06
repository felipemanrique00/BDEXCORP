'use client'
import { todayISODate } from '@/lib/date'
import { Suspense, useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useStore } from '@/lib/store'
import { getCurrentUser, getEmpresasPermitidas, hasPermission } from '@/lib/auth'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { WhatsAppButton } from '@/components/ui/whatsapp-button'
import { SearchInput } from '@/components/ui/search-input'
import { maskCPF, maskPhone, formatDate, onlyDigits } from '@/lib/utils'
import {
  Users, Plus, Edit2, Trash2, Download, Eye, UploadCloud, Loader2, ShieldCheck,
  AlertTriangle, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import type { Funcionario, Cargo } from '@/types'
import { buildCsv, downloadTextFile } from '@/lib/browser-download'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'
import { DateInput } from '@/components/ui/date-input'

const CARGOS: Cargo[] = ['Diretor', 'Gerente', 'Colaborador']
const FUNCIONARIOS_PER_PAGE = 100

interface DocumentoFuncionarioExtraido {
  documento_tipo?: 'RG' | 'CNH' | 'CPF' | 'PASSAPORTE' | 'OUTRO' | null
  nome?: string | null
  cpf?: string | null
  rg?: string | null
  documento_numero?: string | null
  data_nascimento?: string | null
  nome_mae?: string | null
  nome_pai?: string | null
  naturalidade?: string | null
  nacionalidade?: string | null
  orgao_emissor?: string | null
  uf_emissor?: string | null
  data_emissao?: string | null
  documento_validade?: string | null
  cnh_registro?: string | null
  cnh_categoria?: string | null
  primeira_habilitacao?: string | null
  campos_confianca?: Record<string, 'alta' | 'media' | 'baixa' | null>
  texto_lido?: string
  avisos?: string[]
  precisa_revisao?: boolean
  provedor?: string
  modelo?: string
}

interface CostCenterOption {
  id: string
  code: string
  name: string
  hierarchyLevel: number
}

/** Normaliza texto: sem acento, lowercase, trim - para busca tolerante */
function norm(s: string): string {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function FuncionariosInner() {
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const searchParams = useSearchParams()
  const empresaFiltroURL = searchParams.get('empresa')

  const {
    empresas,
    gruposEmpresariais,
    funcionarios,
    addFuncionario,
    updateFuncionario,
    deleteFuncionario,
  } = useStore()
  const { includesCompany } = useCorporateCompanyScope()

  const [search, setSearch] = useState('')
  const [cargoFilter, setCargoFilter] = useState<Cargo | 'Todos'>('Todos')
  const [empresaFilter, setEmpresaFilter] = useState<string>(empresaFiltroURL || 'Todas')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Funcionario | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Funcionario | null>(null)
  const [pagina, setPagina] = useState(1)
  const empresasPermitidas = getEmpresasPermitidas(user, empresas, gruposEmpresariais)
    .filter((empresa) => includesCompany(empresa.id, 'ver_funcionarios'))
  const empresasPermitidasKey = empresasPermitidas.map((empresa) => empresa.id).sort().join('|')

  useEffect(() => {
    if (
      empresaFilter !== 'Todas'
      && !empresasPermitidas.some((empresa) => empresa.id === empresaFilter)
    ) {
      setEmpresaFilter('Todas')
    }
  }, [empresaFilter, empresasPermitidas, empresasPermitidasKey])

  const visible = useMemo(() => {
    const empresasPermitidasIds = new Set(empresasPermitidasKey.split('|').filter(Boolean))
    let base = funcionarios.filter((funcionario) => empresasPermitidasIds.has(funcionario.company_id))

    if (cargoFilter !== 'Todos') base = base.filter((f) => f.cargo === cargoFilter)
    if (empresaFilter !== 'Todas') {
      base = base.filter((f) => f.company_id === empresaFilter)
    }

    // ====== BUSCA CORRIGIDA ======
    const q = search.trim()
    if (q) {
      const qNorm = norm(q)
      const qDigits = onlyDigits(q) // para buscar por CPF

      base = base.filter((f) => {
        // Nome (normalizado - aceita com/sem acento)
        if (norm(f.nome).includes(qNorm)) return true
        if ((f.aliases_nome || []).some((alias) => norm(alias).includes(qNorm))) return true
        // ID unico permanente
        if (qDigits && f.codigo_identificacao?.includes(qDigits)) return true
        // E-mail
        if (f.email && norm(f.email).includes(qNorm)) return true
        // CPF (só compara se o que usuário digitou tem dígitos)
        if (qDigits.length >= 3 && f.cpf && f.cpf.includes(qDigits)) return true
        // Centro de custo
        if (f.centro_custo && norm(f.centro_custo).includes(qNorm)) return true
        // Cargo original
        if (f.cargo_original && norm(f.cargo_original).includes(qNorm)) return true
        // Matrícula
        if (f.matricula && norm(f.matricula).includes(qNorm)) return true
        // Lotação
        if (f.lotacao && norm(f.lotacao).includes(qNorm)) return true
        // Telefone (se digitou número)
        if (qDigits.length >= 3 && f.telefone && f.telefone.includes(qDigits)) return true
        return false
      })
    }
    return base
  }, [funcionarios, search, cargoFilter, empresaFilter, empresasPermitidasKey])
  const totalFuncionariosPermitidos = useMemo(() => {
    const ids = new Set(empresasPermitidasKey.split('|').filter(Boolean))
    return funcionarios.filter((funcionario) => ids.has(funcionario.company_id)).length
  }, [empresasPermitidasKey, funcionarios])
  const totalPaginas = Math.max(1, Math.ceil(visible.length / FUNCIONARIOS_PER_PAGE))
  const funcionariosPagina = useMemo(() => {
    const inicio = (pagina - 1) * FUNCIONARIOS_PER_PAGE
    return visible.slice(inicio, inicio + FUNCIONARIOS_PER_PAGE)
  }, [pagina, visible])

  useEffect(() => {
    setPagina(1)
  }, [cargoFilter, empresaFilter, search])

  useEffect(() => {
    setPagina((atual) => Math.min(atual, totalPaginas))
  }, [totalPaginas])

  function exportCSV() {
    const headers = ['ID', 'Nome', 'Aliases', 'CPF', 'E-mail', 'Telefone', 'Cargo', 'Empresa', 'Centro Custo', 'Nascimento', 'Matrícula', 'Lotação']
    const rows = visible.map((f) => {
      const emp = empresas.find((e) => e.id === f.company_id)
      return [
        f.codigo_identificacao || '',
        f.nome, (f.aliases_nome || []).join(' | '), f.cpf ? maskCPF(f.cpf) : '', f.email || '',
        f.telefone ? maskPhone(f.telefone) : '', f.cargo, emp?.nome || '',
        f.centro_custo || '', formatDate(f.data_nascimento), f.matricula || '', f.lotacao || '',
      ]
    })
    downloadTextFile(
      `funcionarios-${todayISODate()}.csv`,
      '\ufeff' + buildCsv([headers, ...rows]),
      'text/csv;charset=utf-8',
    )
    toast.success('CSV exportado!')
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="bbt-page-header">
        <div>
          <p className="bbt-section-label">Cadastros · Pessoas</p>
          <h1 className="bbt-page-title flex items-center gap-2 mt-1">
            <Users className="w-6 h-6 text-bbt-accent" /> Funcionários
          </h1>
          <p className="bbt-page-subtitle">
            {visible.length} de {totalFuncionariosPermitidos} funcionário(s)
            {empresaFilter !== 'Todas' && (
              <> · {empresas.find((e) => e.id === empresaFilter)?.nome}</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="bbt-button-outline text-sm">
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
          {hasPermission(user, 'cadastrar_funcionarios') && (
            <button
              onClick={() => { setEditing(null); setModalOpen(true) }}
              className="bbt-button-accent text-sm"
            >
              <Plus className="w-4 h-4" /> Novo Funcionário
            </button>
          )}
        </div>
      </div>

      {/* FILTROS - USANDO SearchInput QUE JÁ CORRIGE O BUG */}
      <div className="bbt-card p-4 flex flex-wrap gap-3 items-center">
        <SearchInput
          value={search}
          onChangeValue={setSearch}
          placeholder="Buscar por ID, nome, CPF, e-mail, centro de custo, matrícula, lotação..."
          className="min-w-0 basis-full sm:min-w-[280px] sm:flex-1"
        />
        <select value={cargoFilter} onChange={(e) => setCargoFilter(e.target.value as Cargo | 'Todos')} aria-label="Filtrar funcionários por cargo" className="bbt-input w-auto">
          <option>Todos</option>
          {CARGOS.map((c) => <option key={c}>{c}</option>)}
        </select>
        {empresasPermitidas.length > 1 && (
          <select value={empresaFilter} onChange={(e) => setEmpresaFilter(e.target.value)} aria-label="Filtrar funcionários por empresa" className="bbt-input w-auto">
            <option value="Todas">Todas empresas</option>
            {empresasPermitidas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        )}
        {search && (
          <button onClick={() => setSearch('')} className="text-xs text-bbt-accent hover:underline">
            Limpar busca
          </button>
        )}
      </div>

      {/* TABELA */}
      <div className="bbt-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bbt-gray-50 dark:bg-slate-900/50 border-b border-bbt-gray-100 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Funcionário</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">CPF</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Cargo</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Empresa</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Centro de Custo</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Telefone</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-slate-400">
                    {search || cargoFilter !== 'Todos' || empresaFilter !== 'Todas'
                      ? 'Nenhum funcionário encontrado com os filtros aplicados.'
                      : 'Nenhum funcionário cadastrado.'}
                  </td>
                </tr>
              ) : funcionariosPagina.map((f) => {
                const emp = empresas.find((e) => e.id === f.company_id)
                return (
                  <tr key={f.id} className="border-b border-bbt-gray-100 dark:border-slate-700 last:border-0 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-bbt-primary dark:text-slate-100">
                      {f.codigo_identificacao || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/funcionarios/${f.id}`} className="flex items-center gap-3 hover:text-bbt-accent">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-bbt-primary to-bbt-primary-light flex items-center justify-center text-white font-bold text-xs shrink-0">
                          {f.nome.split(' ').slice(0, 2).map((n) => n[0]).join('')}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-bbt-text dark:text-slate-100 truncate">{f.nome}</div>
                          {f.matricula && <div className="text-[10px] text-slate-400">Matr: {f.matricula}</div>}
                          {!!f.aliases_nome?.length && <div className="text-[10px] text-bbt-accent">{f.aliases_nome.length} nome(s) vinculado(s)</div>}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.cpf ? maskCPF(f.cpf) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`bbt-badge text-xs ${
                        f.cargo === 'Diretor' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        : f.cargo === 'Gerente' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      }`}>{f.cargo}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 truncate max-w-[200px]">{emp?.nome || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 truncate max-w-[180px]">{f.centro_custo || '—'}</td>
                    <td className="px-4 py-3"><WhatsAppButton phone={f.telefone} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/dashboard/funcionarios/${f.id}`} className="p-2 rounded-lg hover:bg-bbt-accent/10 text-slate-500 hover:text-bbt-accent transition" title="Ver detalhes">
                          <Eye className="w-4 h-4" />
                        </Link>
                        {includesCompany(f.company_id, 'gerenciar_funcionarios') && (
                          <>
                            <button onClick={() => { setEditing(f); setModalOpen(true) }} className="p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-500 hover:text-blue-600 transition" title="Editar">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => setConfirmDelete(f)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-600 transition" title="Excluir">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {visible.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bbt-gray-100 bg-bbt-gray-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
              <span>
                Exibindo {(pagina - 1) * FUNCIONARIOS_PER_PAGE + 1}-{Math.min(pagina * FUNCIONARIOS_PER_PAGE, visible.length)} de {visible.length} funcionário(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPagina((atual) => Math.max(1, atual - 1))}
                  disabled={pagina <= 1}
                  className="bbt-button-outline h-8 px-3 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <strong className="min-w-14 text-center text-slate-700 dark:text-slate-200">{pagina}/{totalPaginas}</strong>
                <button
                  type="button"
                  onClick={() => setPagina((atual) => Math.min(totalPaginas, atual + 1))}
                  disabled={pagina >= totalPaginas}
                  className="bbt-button-outline h-8 px-3 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL */}
      {modalOpen && (
        <FuncionarioModal
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          editing={editing}
          empresas={empresasPermitidas}
          onSave={(data) => {
            if (editing) {
              updateFuncionario(editing.id, { ...data, cpf: onlyDigits(data.cpf || ''), telefone: onlyDigits(data.telefone || '') })
              toast.success('Funcionário atualizado!')
            } else {
              addFuncionario({ ...data, cpf: onlyDigits(data.cpf || ''), telefone: onlyDigits(data.telefone || ''), ativo: true } as any)
              toast.success('Funcionário cadastrado!')
            }
            setModalOpen(false); setEditing(null)
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) { deleteFuncionario(confirmDelete.id); toast.success('Funcionário excluído.') } }}
        title="Excluir funcionário"
        message={`Confirma a exclusão de "${confirmDelete?.nome}"?`}
        confirmLabel="Excluir"
        danger
      />
    </div>
  )
}

export default function FuncionariosPage() {
  return (
    <Suspense fallback={<div className="bbt-card p-8 text-center text-sm text-slate-500">Carregando funcionários...</div>}>
      <FuncionariosInner />
    </Suspense>
  )
}

// Modal simples de cadastro/edição
function FuncionarioModal({ open, onClose, editing, empresas, onSave }: {
  open: boolean
  onClose: () => void
  editing: Funcionario | null
  empresas: any[]
  onSave: (data: Partial<Funcionario>) => void
}) {
  const [form, setForm] = useState<Partial<Funcionario>>(editing || {
    nome: '', cpf: '', email: '', telefone: '', data_nascimento: '',
    cargo: 'Colaborador', company_id: empresas[0]?.id || '',
    centro_custo: '', passaporte: '', passaporte_validade: '', milhagem: '', preferencias: '',
    aliases_nome: [],
    rg: '', documento_tipo: undefined, documento_numero: '', orgao_emissor: '', uf_emissor: '',
    documento_emissao: '', documento_validade: '', cnh_registro: '', cnh_categoria: '',
    cnh_primeira_habilitacao: '', nome_mae: '', nome_pai: '',
    naturalidade: '', nacionalidade: '',
  })
  const [docLoading, setDocLoading] = useState(false)
  const [docResult, setDocResult] = useState<DocumentoFuncionarioExtraido | null>(null)
  const [docError, setDocError] = useState('')
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([])
  const [costCentersLoading, setCostCentersLoading] = useState(false)
  const [costCentersUnavailable, setCostCentersUnavailable] = useState(false)
  const [costCentersLoaded, setCostCentersLoaded] = useState(false)

  useEffect(() => {
    if (!open || !form.company_id) {
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
    void fetch(`/api/cost-centers?companyId=${encodeURIComponent(form.company_id)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result?.ok) throw new Error(result?.error || 'Falha ao carregar centros de custo.')
        const rows = Array.isArray(result.items) ? result.items : []
        const options = rows.flatMap((item: any): CostCenterOption[] => {
          const id = String(item?.projectionId || item?.projection_id || item?.companyCostCenterId || '')
          const code = String(item?.code || '').trim()
          if (!id || !code || item?.isActive === false) return []
          return [{
            id,
            code,
            name: String(item?.name || code),
            hierarchyLevel: Number(item?.hierarchyLevel || item?.hierarchy_level || 1),
          }]
        })
        setCostCenters(options)
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
  }, [open, form.company_id])

  const selectedCostCenterUnavailable = Boolean(
    costCentersLoaded
    && form.cost_center_id
    && !costCenters.some((item) => item.id === form.cost_center_id),
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nome || !form.company_id) { toast.error('Preencha nome e empresa.'); return }
    if (costCentersLoading) {
      toast.error('Aguarde o carregamento dos centros de custo.')
      return
    }
    if (selectedCostCenterUnavailable) {
      toast.error('O centro de custo do funcionário está inativo ou indisponível. Selecione outro centro ou remova o vínculo.')
      return
    }
    onSave(form)
  }

  async function handleDocumento(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)
    if (!isPdf && !isImage) { toast.error('Use PDF ou foto do documento.'); return }
    if (file.size > 35 * 1024 * 1024) { toast.error('Arquivo muito grande. Use ate 35 MB.'); return }

    setDocLoading(true)
    setDocError('')
    setDocResult(null)
    try {
      const base64 = await arquivoParaBase64Local(file)
      const response = await fetch('/api/ia/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: isPdf ? 'pdf' : 'image',
          fileName: file.name,
          mimeType: file.type || (isPdf ? 'application/pdf' : 'image/jpeg'),
          base64,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.hint || data?.error || `HTTP ${response.status}`)
      const parsed = data as DocumentoFuncionarioExtraido
      setDocResult(parsed)
      aplicarDocumentoNoFormulario(parsed)
      if (parsed.precisa_revisao || parsed.avisos?.length) toast.warning('Documento lido. Revise os campos antes de salvar.')
      else toast.success('Documento lido e campos preenchidos.')
    } catch (e: any) {
      setDocError(e.message || 'Nao consegui ler o documento.')
      toast.error(e.message || 'Nao consegui ler o documento.')
    } finally {
      setDocLoading(false)
    }
  }

  function aplicarDocumentoNoFormulario(parsed: DocumentoFuncionarioExtraido) {
    setForm((current) => ({
      ...current,
      nome: parsed.nome || current.nome,
      cpf: parsed.cpf || current.cpf,
      data_nascimento: parsed.data_nascimento || current.data_nascimento,
      rg: parsed.rg || current.rg,
      documento_tipo: parsed.documento_tipo || current.documento_tipo,
      documento_numero: parsed.documento_numero || current.documento_numero,
      orgao_emissor: parsed.orgao_emissor || current.orgao_emissor,
      uf_emissor: parsed.uf_emissor || current.uf_emissor,
      documento_emissao: parsed.data_emissao || current.documento_emissao,
      documento_validade: parsed.documento_validade || current.documento_validade,
      cnh_registro: parsed.cnh_registro || current.cnh_registro,
      cnh_categoria: parsed.cnh_categoria || current.cnh_categoria,
      cnh_primeira_habilitacao: parsed.primeira_habilitacao || current.cnh_primeira_habilitacao,
      nome_mae: parsed.nome_mae || current.nome_mae,
      nome_pai: parsed.nome_pai || current.nome_pai,
      naturalidade: parsed.naturalidade || current.naturalidade,
      nacionalidade: parsed.nacionalidade || current.nacionalidade,
      passaporte: parsed.documento_tipo === 'PASSAPORTE' ? parsed.documento_numero || current.passaporte : current.passaporte,
      passaporte_validade: parsed.documento_tipo === 'PASSAPORTE' ? parsed.documento_validade || current.passaporte_validade : current.passaporte_validade,
    }))
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar Funcionário' : 'Novo Funcionário'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) handleDocumento(file)
          }}
          className="rounded-xl border-2 border-dashed border-bbt-accent/30 bg-bbt-accent/5 p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-bbt-accent text-white">
              {docLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-bbt-primary dark:text-white">Ler documento com IA</p>
              <p className="text-xs text-slate-500">
                Arraste RG, CNH, CPF ou passaporte em PDF/foto. O sistema preenche, valida CPF e exige conferencia antes de salvar.
              </p>
            </div>
            <label className="bbt-button-outline h-9 cursor-pointer text-xs">
              <FileText className="h-4 w-4" /> Selecionar documento
              <input
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                disabled={docLoading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleDocumento(file)
                  e.currentTarget.value = ''
                }}
              />
            </label>
          </div>

          {docError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{docError}</span>
            </div>
          )}

          {docResult && (
            <div className="mt-3 rounded-lg border border-bbt-gray-100 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 font-semibold text-bbt-primary dark:text-white">
                  <ShieldCheck className="h-4 w-4 text-green-600" /> Documento analisado
                </span>
                {docResult.documento_tipo && <span className="bbt-badge bg-blue-100 text-blue-700 text-[10px]">{docResult.documento_tipo}</span>}
                {docResult.provedor && <span className="bbt-badge bg-purple-100 text-purple-700 text-[10px]">{docResult.provedor}</span>}
                {docResult.precisa_revisao && <span className="bbt-badge bg-amber-100 text-amber-700 text-[10px]">Revisar</span>}
              </div>
              {docResult.avisos?.length ? (
                <ul className="space-y-1 text-amber-700 dark:text-amber-300">
                  {docResult.avisos.slice(0, 4).map((aviso) => <li key={aviso}>- {aviso}</li>)}
                </ul>
              ) : (
                <p className="text-green-700 dark:text-green-300">Campos principais preenchidos. Confira visualmente antes de cadastrar.</p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="ID do funcionario">
            <input
              value={editing?.codigo_identificacao || 'Gerado automaticamente'}
              className="bbt-input bg-slate-50 text-slate-500 dark:bg-slate-900/50"
              disabled
            />
          </Field>
          <Field label="Nome *"><input required value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="bbt-input" autoFocus /></Field>
          <div className="md:col-span-2">
            <Field label="Nomes vindos de relatorios/importacoes">
              <textarea
                value={(form.aliases_nome || []).join('\n')}
                onChange={(e) => setForm({ ...form, aliases_nome: e.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })}
                rows={3}
                className="bbt-input font-mono text-xs"
                placeholder={'Ex.: FERNANDES JUNIOR/ALDO\nALDO JUNIOR\nALDO FERNANDES'}
              />
            </Field>
            <p className="mt-1 text-[11px] text-slate-500">
              Use este campo para vincular nomes diferentes que aparecem em Wintour, companhias aereas ou hoteis ao mesmo ID deste funcionario.
            </p>
          </div>
          <Field label="CPF"><input value={form.cpf || ''} onChange={(e) => setForm({ ...form, cpf: e.target.value })} className="bbt-input" /></Field>
          <Field label="E-mail"><input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bbt-input" /></Field>
          <Field label="Telefone"><input value={form.telefone || ''} onChange={(e) => setForm({ ...form, telefone: e.target.value })} className="bbt-input" /></Field>
          <Field label="Data de Nascimento" htmlFor="employee-birth-date"><DateInput id="employee-birth-date" value={form.data_nascimento || ''} onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })} className="bbt-input" /></Field>
          <Field label="Tipo Documento">
            <select value={form.documento_tipo || ''} onChange={(e) => setForm({ ...form, documento_tipo: e.target.value as any })} className="bbt-input">
              <option value="">Nao informado</option>
              <option value="RG">RG</option>
              <option value="CNH">CNH</option>
              <option value="CPF">CPF</option>
              <option value="PASSAPORTE">Passaporte</option>
              <option value="OUTRO">Outro</option>
            </select>
          </Field>
          <Field label="RG"><input value={form.rg || ''} onChange={(e) => setForm({ ...form, rg: e.target.value })} className="bbt-input" /></Field>
          <Field label="Documento Numero"><input value={form.documento_numero || ''} onChange={(e) => setForm({ ...form, documento_numero: e.target.value })} className="bbt-input" /></Field>
          <Field label="Orgao/UF Emissor">
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <input value={form.orgao_emissor || ''} onChange={(e) => setForm({ ...form, orgao_emissor: e.target.value })} className="bbt-input" />
              <input value={form.uf_emissor || ''} onChange={(e) => setForm({ ...form, uf_emissor: e.target.value.toUpperCase().slice(0, 2) })} className="bbt-input" placeholder="UF" />
            </div>
          </Field>
          <Field label="Emissao Documento" htmlFor="employee-document-issued-at"><DateInput id="employee-document-issued-at" value={form.documento_emissao || ''} onChange={(e) => setForm({ ...form, documento_emissao: e.target.value })} className="bbt-input" /></Field>
          <Field label="Validade Documento" htmlFor="employee-document-expires-at"><DateInput id="employee-document-expires-at" value={form.documento_validade || ''} onChange={(e) => setForm({ ...form, documento_validade: e.target.value })} className="bbt-input" /></Field>
          <Field label="Cargo *">
            <select value={form.cargo || 'Colaborador'} onChange={(e) => setForm({ ...form, cargo: e.target.value as Cargo })} className="bbt-input">
              {CARGOS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Empresa *">
            <select
              required
              value={form.company_id || ''}
              onChange={(e) => setForm({
                ...form,
                company_id: e.target.value,
                cost_center_id: null,
                centro_custo: '',
              })}
              className="bbt-input"
            >
              <option value="">Selecione...</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </Field>
          <Field label="Centro de Custo">
            {costCentersUnavailable ? (
              <input
                value={form.centro_custo || ''}
                onChange={(e) => setForm({ ...form, cost_center_id: null, centro_custo: e.target.value })}
                className="bbt-input"
                placeholder="Código legado do centro de custo"
              />
            ) : (
              <select
                value={form.cost_center_id || ''}
                onChange={(e) => {
                  const selected = costCenters.find((item) => item.id === e.target.value)
                  setForm({
                    ...form,
                    cost_center_id: e.target.value || null,
                    centro_custo: selected?.code || '',
                  })
                }}
                className="bbt-input"
                disabled={costCentersLoading || !form.company_id}
              >
                {selectedCostCenterUnavailable && (
                  <option value={form.cost_center_id || ''} disabled>
                    {`Indisponível: ${form.centro_custo || form.cost_center_id}`}
                  </option>
                )}
                <option value="">
                  {costCentersLoading
                    ? 'Carregando...'
                    : form.centro_custo && !form.cost_center_id
                      ? `Legado: ${form.centro_custo}`
                      : 'Sem centro de custo'}
                </option>
                {costCenters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {`${'— '.repeat(Math.max(0, item.hierarchyLevel - 1))}${item.code} · ${item.name}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Passaporte"><input value={form.passaporte || ''} onChange={(e) => setForm({ ...form, passaporte: e.target.value })} className="bbt-input" /></Field>
          <Field label="Validade Passaporte" htmlFor="employee-passport-expires-at"><DateInput id="employee-passport-expires-at" value={form.passaporte_validade || ''} onChange={(e) => setForm({ ...form, passaporte_validade: e.target.value })} className="bbt-input" /></Field>
          <Field label="Registro CNH"><input value={form.cnh_registro || ''} onChange={(e) => setForm({ ...form, cnh_registro: e.target.value })} className="bbt-input" /></Field>
          <Field label="Categoria CNH"><input value={form.cnh_categoria || ''} onChange={(e) => setForm({ ...form, cnh_categoria: e.target.value.toUpperCase().slice(0, 3) })} className="bbt-input" /></Field>
          <Field label="Primeira Habilitacao" htmlFor="employee-first-license-date"><DateInput id="employee-first-license-date" value={form.cnh_primeira_habilitacao || ''} onChange={(e) => setForm({ ...form, cnh_primeira_habilitacao: e.target.value })} className="bbt-input" /></Field>
          <Field label="Nome da Mae"><input value={form.nome_mae || ''} onChange={(e) => setForm({ ...form, nome_mae: e.target.value })} className="bbt-input" /></Field>
          <Field label="Nome do Pai"><input value={form.nome_pai || ''} onChange={(e) => setForm({ ...form, nome_pai: e.target.value })} className="bbt-input" /></Field>
          <Field label="Naturalidade"><input value={form.naturalidade || ''} onChange={(e) => setForm({ ...form, naturalidade: e.target.value })} className="bbt-input" /></Field>
          <Field label="Nacionalidade"><input value={form.nacionalidade || ''} onChange={(e) => setForm({ ...form, nacionalidade: e.target.value })} className="bbt-input" /></Field>
        </div>
        <Field label="Preferências"><textarea value={form.preferencias || ''} onChange={(e) => setForm({ ...form, preferencias: e.target.value })} rows={2} className="bbt-input" /></Field>
        <div className="flex justify-end gap-2 pt-4 border-t border-bbt-gray-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="bbt-button-ghost">Cancelar</button>
          <button type="submit" className="bbt-button-primary">{editing ? 'Salvar' : 'Cadastrar'}</button>
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function arquivoParaBase64Local(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

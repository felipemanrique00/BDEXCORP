'use client'
import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect, useMemo } from 'react'
import { useStore } from '@/lib/store'
import { maskCPF, maskPhone, formatDate, formatCurrency } from '@/lib/utils'
import { canViewCompany, getCurrentUser, hasPermission } from '@/lib/auth'
import { WhatsAppButton } from '@/components/ui/whatsapp-button'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ArrowLeft, User, Briefcase, Building2, Mail, Phone, Calendar, CreditCard, Plane, Star,
  Upload, FileText, Download, Trash2, Eye, FileCheck, AlertCircle, BarChart3, Clock, CheckCircle2, XCircle,
  Hotel as HotelIcon,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  getVouchersByFuncionario, addVoucher, deleteVoucher,
  downloadVoucher, openVoucherInNewTab, formatBytes, getTotalStorageSize,
  type Voucher,
} from '@/lib/vouchers-storage'
import { getAtendimentosByFuncionario, getEstatisticas } from '@/lib/atendimentos-storage'
import { historicoViagensFuncionario } from '@/lib/agregacoes'
import { STATUS_LABEL, type StatusAtendimento, type Atendimento } from '@/types'
import { useCorporateCompanyScope } from '@/components/corporate-context-provider'

type Tab = 'perfil' | 'dados' | 'arquivos' | 'empresa'

export default function FuncionarioDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('perfil')

  const { empresas, gruposEmpresariais, funcionarios, politicas } = useStore()
  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const f = funcionarios.find((x) => x.id === id)
  const empresa = f ? empresas.find((e) => e.id === f.company_id) : null
  const pol = f && empresa ? politicas.find((p) => p.company_id === empresa.id && p.cargo === f.cargo) : null

  if (!f) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="text-slate-500 mb-4">Funcionário não encontrado.</p>
        <Link href="/dashboard/funcionarios" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  if (!canViewCompany(user, f.company_id, empresas, gruposEmpresariais)) {
    return (
      <div className="bbt-card p-12 text-center">
        <p className="mb-4 text-slate-500">Você não tem permissão para acessar este funcionário.</p>
        <Link href="/dashboard/funcionarios" className="bbt-button-primary inline-block">Voltar</Link>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'perfil', label: 'Perfil', icon: BarChart3 },
    { id: 'dados', label: 'Dados', icon: User },
    { id: 'arquivos', label: 'Vouchers & Arquivos', icon: FileCheck },
    { id: 'empresa', label: 'Empresa', icon: Building2 },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-bbt-gray-50 dark:hover:bg-slate-800 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Cabeçalho */}
      <div className="bbt-card p-6 flex items-center gap-5">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-bbt-primary to-bbt-primary-light flex items-center justify-center text-white font-bold text-2xl">
          {f.nome.split(' ').slice(0, 2).map((n) => n[0]).join('')}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-bbt-primary dark:text-white">{f.nome}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className="bbt-badge bg-bbt-primary/10 text-bbt-primary dark:bg-slate-700 dark:text-slate-100 text-xs">
              ID {f.codigo_identificacao || '---'}
            </span>
            <span className={`bbt-badge text-xs ${
              f.cargo === 'Diretor' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              : f.cargo === 'Gerente' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            }`}>
              <Briefcase className="w-3 h-3" /> {f.cargo}
            </span>
            {empresa && (
              <Link href={`/dashboard/empresas/${empresa.id}`} className="bbt-badge bg-bbt-gray-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs hover:bg-bbt-accent/20 transition">
                <Building2 className="w-3 h-3" /> {empresa.nome}
              </Link>
            )}
            {f.matricula && <span className="text-xs text-slate-500">Matrícula: {f.matricula}</span>}
            {f.email && <span className="text-xs text-slate-500">{f.email}</span>}
          </div>
        </div>
        <div><WhatsAppButton phone={f.telefone} /></div>
      </div>

      {/* Tabs */}
      <div className="border-b border-bbt-gray-100 dark:border-slate-700">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition relative whitespace-nowrap ${
                  tab === t.id ? 'text-bbt-primary dark:text-bbt-accent' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" /> {t.label}
                {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-bbt-accent" />}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'perfil' && <PerfilTab funcionarioId={f.id} funcionarioNome={f.nome} empresaId={f.company_id} empresaNome={empresa?.nome || ''} funcionarios={funcionarios} />}

      {tab === 'dados' && (
        <div className="bbt-card p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoRow icon={CreditCard} label="ID unico" value={f.codigo_identificacao || '---'} />
          <InfoRow icon={User} label="Nome" value={f.nome} />
          <InfoRow icon={User} label="Nomes vinculados" value={f.aliases_nome?.length ? f.aliases_nome.join(' | ') : '---'} />
          <InfoRow icon={CreditCard} label="CPF" value={f.cpf ? maskCPF(f.cpf) : '—'} />
          <InfoRow icon={Calendar} label="Nascimento" value={formatDate(f.data_nascimento)} />
          <InfoRow icon={CreditCard} label="Tipo Documento" value={f.documento_tipo || '---'} />
          <InfoRow icon={CreditCard} label="RG" value={f.rg || '---'} />
          <InfoRow icon={CreditCard} label="Documento" value={f.documento_numero || '---'} />
          <InfoRow icon={Calendar} label="Emissao Documento" value={formatDate(f.documento_emissao)} />
          <InfoRow icon={Calendar} label="Validade Documento" value={formatDate(f.documento_validade)} />
          <InfoRow icon={CreditCard} label="Orgao Emissor" value={[f.orgao_emissor, f.uf_emissor].filter(Boolean).join(' / ') || '---'} />
          <InfoRow icon={CreditCard} label="Registro CNH" value={f.cnh_registro || '---'} />
          <InfoRow icon={CreditCard} label="Categoria CNH" value={f.cnh_categoria || '---'} />
          <InfoRow icon={Calendar} label="Primeira Habilitacao" value={formatDate(f.cnh_primeira_habilitacao)} />
          <InfoRow icon={User} label="Nome da Mae" value={f.nome_mae || '---'} />
          <InfoRow icon={User} label="Nome do Pai" value={f.nome_pai || '---'} />
          <InfoRow icon={Building2} label="Naturalidade" value={f.naturalidade || '---'} />
          <InfoRow icon={Building2} label="Nacionalidade" value={f.nacionalidade || '---'} />
          <InfoRow icon={Mail} label="E-mail" value={f.email || '—'} />
          <InfoRow icon={Phone} label="Telefone" value={f.telefone ? maskPhone(f.telefone) : '—'} />
          <InfoRow icon={Briefcase} label="Cargo Original" value={f.cargo_original || f.cargo} />
          <InfoRow icon={CreditCard} label="Passaporte" value={f.passaporte || '—'} />
          <InfoRow icon={Calendar} label="Validade Passaporte" value={formatDate(f.passaporte_validade)} />
          <InfoRow icon={Plane} label="Milhagem" value={f.milhagem || '—'} />
          <InfoRow icon={Briefcase} label="Lotação" value={f.lotacao || '—'} />
          <div className="md:col-span-2">
            <InfoRow icon={Star} label="Preferências" value={f.preferencias || '—'} />
          </div>
        </div>
      )}

      {tab === 'arquivos' && <ArquivosTab funcionarioId={f.id} funcionarioNome={f.nome} />}

      {tab === 'empresa' && empresa && (
        <div className="space-y-4">
          <div className="bbt-card p-6">
            <h3 className="font-semibold text-bbt-primary dark:text-white mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-bbt-accent" /> Dados da Empresa
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoRow icon={Building2} label="Empresa" value={empresa.nome} />
              <InfoRow icon={CreditCard} label="CNPJ" value={empresa.cnpj} />
              <InfoRow icon={Briefcase} label="Centro de Custo" value={f.centro_custo || '—'} />
              <InfoRow icon={Briefcase} label="Cargo" value={f.cargo} />
            </div>
          </div>
          {pol && (
            <div className="bbt-card p-6">
              <h3 className="font-semibold text-bbt-primary dark:text-white mb-4 flex items-center gap-2">
                <Star className="w-5 h-5 text-bbt-accent" /> Política Aplicável (cargo {pol.cargo})
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <PolItem label="Limite Diária Hotel" value={`R$ ${pol.limite_diaria_hotel.toFixed(2)}`} />
                <PolItem label="Classe Aérea" value={pol.classe_aerea} />
                <PolItem label="Hotéis Máx." value={`${pol.hoteis_max_estrelas}⭐`} />
                <PolItem label="Aprovação Auto" value={pol.aprovacao_automatica ? 'Sim' : 'Não'} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
// ABA PERFIL — Estatísticas de atendimentos
// ============================================================
function PerfilTab({ funcionarioId, funcionarioNome, empresaId, empresaNome, funcionarios }: { funcionarioId: string; funcionarioNome: string; empresaId: string; empresaNome: string; funcionarios: any[] }) {
  const [atendimentos, setAtendimentos] = useState<Atendimento[]>(() => getAtendimentosByFuncionario(funcionarioId))
  const [statsEmpresa, setStatsEmpresa] = useState(() => getEstatisticas({ empresa_id: empresaId }))
  const [historico, setHistorico] = useState(() => historicoViagensFuncionario(funcionarioId, funcionarioNome, funcionarios))

  const user = typeof window !== 'undefined' ? getCurrentUser() : null
  const { includesCompany } = useCorporateCompanyScope()
  const podeFinanceiro = hasPermission(user, 'ver_financeiro')
    && includesCompany(empresaId, 'ver_financeiro')

  useEffect(() => {
    setAtendimentos(getAtendimentosByFuncionario(funcionarioId))
    setStatsEmpresa(getEstatisticas({ empresa_id: empresaId }))
    setHistorico(historicoViagensFuncionario(funcionarioId, funcionarioNome, funcionarios))
  }, [funcionarioId, funcionarioNome, empresaId, funcionarios])

  const totalFunc = historico.length
  const totalFaturado = historico.reduce((s, h) => s + h.faturado, 0)
  const proximas = historico.filter((h) => h.proxima)

  // Hotéis mais frequentados pelo funcionário
  const topHoteisFunc = useMemo(() => {
    const map = new Map<string, { hotel: string; total: number; cidade?: string }>()
    atendimentos.forEach((a) => {
      if (a.tipo_servico !== 'Hotel') return
      const h = a.detalhes_hotel?.hotel_nome
      if (!h) return
      const key = h.toLowerCase().trim()
      const cur = map.get(key) || { hotel: h, total: 0, cidade: a.detalhes_hotel?.cidade }
      cur.total++
      map.set(key, cur)
    })
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5)
  }, [atendimentos])

  // Status do funcionário
  const porStatusFunc: Record<StatusAtendimento, number> = {
    em_andamento: 0, aguardando_cliente: 0, finalizado: 0, cancelado: 0, pendente: 0,
  }
  atendimentos.forEach((a: Atendimento) => {
    const st = a.status as StatusAtendimento
    if (st && porStatusFunc[st] !== undefined) porStatusFunc[st]++
  })

  return (
    <div className="space-y-6">
      {/* V8: Próximas viagens (destaque) */}
      {proximas.length > 0 && (
        <div className="bbt-card p-5 border-2 border-bbt-accent/30 bg-bbt-accent/5">
          <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <Plane className="w-5 h-5 text-bbt-accent" /> Próximas Viagens ({proximas.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {proximas.slice(0, 4).map((p) => (
              <div key={p.atendimento_id} className="rounded-lg p-3 bg-white dark:bg-slate-800 border border-bbt-accent/20">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        p.tipo === 'Hotel' ? 'bg-blue-100 text-blue-700' :
                        p.tipo === 'Aéreo' ? 'bg-purple-100 text-purple-700' :
                        p.tipo === 'Carro' ? 'bg-green-100 text-green-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{p.tipo}</span>
                      <span className="bbt-badge bg-bbt-accent text-white text-[10px]">PRÓXIMA</span>
                    </div>
                    <div className="text-sm font-semibold mt-1">{p.destino || '—'}</div>
                    <div className="text-[11px] text-slate-500">Data: {p.data ? new Date(p.data + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</div>
                  </div>
                  {podeFinanceiro && p.faturado > 0 && (
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-slate-500">Valor</div>
                      <div className="text-sm font-bold text-bbt-primary dark:text-white">{formatCurrency(p.faturado)}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Volume de atendimentos do funcionário */}
      <div>
        <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-bbt-accent" />
          Resumo de Viagens — {funcionarioNome}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard label="Total de Viagens" value={totalFunc} icon={FileText} color="bbt" />
          <KPICard label="Em Andamento" value={porStatusFunc.em_andamento} icon={Clock} color="blue" />
          <KPICard label="Finalizadas" value={porStatusFunc.finalizado} icon={CheckCircle2} color="green" />
          <KPICard label="Próximas" value={proximas.length} icon={Calendar} color="amber" />
        </div>
        {podeFinanceiro && totalFaturado > 0 && (
          <div className="mt-3 rounded-xl p-4 bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white">
            <div className="text-[11px] uppercase tracking-wider opacity-80">Total movimentado por este funcionário</div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(totalFaturado)}</div>
          </div>
        )}
      </div>

      {/* Hotéis mais frequentados */}
      {topHoteisFunc.length > 0 && (
        <div className="bbt-card p-5">
          <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
            <HotelIcon className="w-5 h-5 text-bbt-accent" /> Hotéis mais frequentados por {funcionarioNome.split(' ')[0]}
          </h3>
          <div className="space-y-2">
            {topHoteisFunc.map((h, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-bbt-gray-50 dark:bg-slate-800">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="w-6 h-6 rounded-full bg-bbt-accent/20 text-bbt-accent text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{h.hotel}</div>
                    {h.cidade && <div className="text-[10px] text-slate-500">{h.cidade}</div>}
                  </div>
                </div>
                <div className="text-xs font-bold text-bbt-primary dark:text-white shrink-0">
                  {h.total}<span className="text-[10px] text-slate-500"> hospedagens</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Volume da empresa */}
      <div>
        <h3 className="font-semibold text-bbt-primary dark:text-white mb-3 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-bbt-accent" />
          Atendimentos da Empresa ({empresaNome})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <KPICard label="Total" value={statsEmpresa.total} icon={FileText} color="bbt" compact />
          <KPICard label="Em Andamento" value={statsEmpresa.por_status.em_andamento} icon={Clock} color="blue" compact />
          <KPICard label="Aguardando" value={statsEmpresa.por_status.aguardando_cliente} icon={AlertCircle} color="amber" compact />
          <KPICard label="Finalizados" value={statsEmpresa.por_status.finalizado} icon={CheckCircle2} color="green" compact />
          <KPICard label="Cancelados" value={statsEmpresa.por_status.cancelado} icon={XCircle} color="red" compact />
        </div>
      </div>

      {/* Histórico completo */}
      <div className="bbt-card overflow-hidden">
        <div className="p-4 border-b border-bbt-gray-100 dark:border-slate-700">
          <h3 className="font-semibold text-bbt-primary dark:text-white">Histórico Completo de Viagens</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {historico.length === 0 ? 'Nenhuma viagem registrada ainda.' : `${historico.length} viagem(ns) total`}
          </p>
        </div>
        {historico.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            As viagens deste funcionário aparecerão aqui quando forem registradas.
          </div>
        ) : (
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700 max-h-96 overflow-y-auto">
            {historico.map((h) => (
              <div key={h.atendimento_id} className="p-3 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition flex items-center gap-3">
                <span className={`bbt-badge text-[10px] ${
                  h.status === 'finalizado' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                  h.status === 'cancelado' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                  h.status === 'em_andamento' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                  h.status === 'aguardando_cliente' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                }`}>{STATUS_LABEL[h.status as StatusAtendimento] || h.status}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{h.tipo}{h.destino ? ` → ${h.destino}` : ''}</div>
                  <div className="text-xs text-slate-500">
                    {h.data ? new Date(h.data + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                    {h.proxima && <span className="ml-2 bbt-badge bg-bbt-accent/20 text-bbt-accent text-[9px]">PRÓXIMA</span>}
                  </div>
                </div>
                {podeFinanceiro && (
                  <div className="text-sm font-semibold text-bbt-primary dark:text-white">
                    {formatCurrency(h.faturado)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function KPICard({ label, value, icon: Icon, color, compact = false }: { label: string; value: number; icon: any; color: string; compact?: boolean }) {
  const colors: Record<string, string> = {
    bbt: 'bg-gradient-to-br from-bbt-primary to-bbt-primary-light text-white',
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
  }
  return (
    <div className={`rounded-xl ${compact ? 'p-3' : 'p-5'} ${colors[color]}`}>
      <div className="flex items-center justify-between mb-1">
        <div className={`${compact ? 'text-[10px]' : 'text-xs'} font-semibold uppercase tracking-wider opacity-80`}>{label}</div>
        <Icon className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} opacity-70`} />
      </div>
      <div className={compact ? 'text-2xl font-bold' : 'text-3xl font-bold'}>{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: StatusAtendimento }) {
  const cfg: Record<StatusAtendimento, { color: string; icon: any }> = {
    em_andamento: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: Clock },
    aguardando_cliente: { color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: AlertCircle },
    pendente: { color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300', icon: AlertCircle },
    finalizado: { color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
    cancelado: { color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: XCircle },
  }
  const { color, icon: Icon } = cfg[status]
  return (
    <span className={`bbt-badge text-[10px] ${color}`}>
      <Icon className="w-3 h-3" /> {STATUS_LABEL[status]}
    </span>
  )
}

// ============================================================
// ABA ARQUIVOS — Vouchers (código existente, preservado)
// ============================================================
function ArquivosTab({ funcionarioId, funcionarioNome }: { funcionarioId: string; funcionarioNome: string }) {
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [descricao, setDescricao] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Voucher | null>(null)

  async function reload() {
    try {
      setVouchers(await getVouchersByFuncionario(funcionarioId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel carregar os vouchers.')
    }
  }
  useEffect(() => {
    void getVouchersByFuncionario(funcionarioId)
      .then(setVouchers)
      .catch(() => setVouchers([]))
  }, [funcionarioId])

  async function handleFile(file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Apenas arquivos PDF são aceitos.'); return
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Arquivo muito grande (máx 15MB).'); return
    }
    setPendingFile(file)
    setDescricao(`Voucher ${new Date().toLocaleDateString('pt-BR')}`)
    setUploadModalOpen(true)
  }

  async function confirmUpload() {
    if (!pendingFile) return
    setUploading(true)
    try {
      await addVoucher({
        file: pendingFile,
        funcionario_id: funcionarioId,
        descricao: descricao || 'Voucher',
      })
      toast.success('Voucher anexado!')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao armazenar o arquivo.')
    }
    finally {
      setUploading(false)
      setUploadModalOpen(false)
      setPendingFile(null)
      setDescricao('')
    }
  }

  const totalSize = getTotalStorageSize(vouchers)

  return (
    <div className="space-y-4">
      <div className="bbt-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-bbt-primary dark:text-white flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-bbt-accent" />
              Vouchers e Arquivos de {funcionarioNome.split(' ')[0]}
            </h3>
            <p className="text-xs text-slate-500 mt-1">{vouchers.length} arquivo(s) · {formatBytes(totalSize)} armazenados</p>
          </div>
        </div>
        <label className="block border-2 border-dashed border-bbt-gray-100 dark:border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-bbt-accent hover:bg-bbt-accent/5 transition">
          <Upload className="w-10 h-10 mx-auto text-bbt-accent mb-3" />
          <p className="font-medium text-bbt-primary dark:text-white">Clique para selecionar um PDF</p>
          <p className="text-xs text-slate-500 mt-1">Vouchers de hotel, passagens e comprovantes · PDF até 15MB</p>
          <input type="file" accept=".pdf,application/pdf" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
        </label>
      </div>

      {vouchers.length === 0 ? (
        <div className="bbt-card p-10 text-center">
          <FileText className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500">Nenhum voucher anexado ainda.</p>
        </div>
      ) : (
        <div className="bbt-card overflow-hidden">
          <div className="divide-y divide-bbt-gray-100 dark:divide-slate-700">
            {vouchers.map((v) => (
              <div key={v.id} className="p-4 hover:bg-bbt-gray-50 dark:hover:bg-slate-900/30 transition flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                  <FileText className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-bbt-text dark:text-slate-100 truncate">{v.descricao}</div>
                  <div className="text-xs text-slate-500 truncate">{v.nome_arquivo}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{formatBytes(v.tamanho_bytes)} · {formatDate(v.data_upload)}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { if (!openVoucherInNewTab(v)) toast.error('Voucher inválido ou pop-up bloqueado.') }} className="p-2 rounded-lg hover:bg-bbt-accent/10 text-slate-500 hover:text-bbt-accent transition" title="Visualizar"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => { if (downloadVoucher(v)) toast.success('Download iniciado'); else toast.error('Voucher inválido.') }} className="p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-500 hover:text-blue-600 transition" title="Baixar"><Download className="w-4 h-4" /></button>
                  <button onClick={() => setConfirmDelete(v)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-600 transition" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={uploadModalOpen} onClose={() => { setUploadModalOpen(false); setPendingFile(null) }} title="Anexar voucher" size="md">
        {pendingFile && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-bbt-gray-50 dark:bg-slate-900/40 rounded-lg">
              <FileText className="w-8 h-8 text-red-600 dark:text-red-400" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-bbt-text dark:text-slate-100 truncate">{pendingFile.name}</div>
                <div className="text-xs text-slate-500">{formatBytes(pendingFile.size)}</div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Descrição do voucher</label>
              <input type="text" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Voucher Isabella SP - 10/04/2026" className="bbt-input" autoFocus />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-bbt-gray-100 dark:border-slate-700">
              <button onClick={() => setUploadModalOpen(false)} className="bbt-button-ghost" disabled={uploading}>Cancelar</button>
              <button onClick={confirmUpload} className="bbt-button-primary" disabled={uploading}>{uploading ? 'Enviando...' : 'Anexar'}</button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return
          void deleteVoucher(confirmDelete.id)
            .then(async () => {
              await reload()
              toast.success('Voucher removido.')
            })
            .catch((error) => toast.error(error instanceof Error ? error.message : 'Nao foi possivel remover o voucher.'))
        }}
        title="Remover voucher"
        message={`Confirma a exclusão de "${confirmDelete?.descricao}"?`}
        confirmLabel="Remover"
        danger
      />
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: any) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-bbt-accent/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-bbt-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="break-words text-xs leading-tight text-slate-500 [overflow-wrap:anywhere]">{label}</div>
        <div className="break-words text-sm leading-tight text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200">{value || '—'}</div>
      </div>
    </div>
  )
}

function PolItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-bbt-gray-100 dark:border-slate-700 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-base font-semibold text-bbt-primary dark:text-white">{value}</div>
    </div>
  )
}

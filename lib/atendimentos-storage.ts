// ============================================================
// Storage de Atendimentos + Logs + Estatisticas Financeiras
// ============================================================
import type {
  Atendimento, LogAuditoria, StatusAtendimento, Prioridade, TipoServico,
} from '@/types'
import { calcularFinanceiro } from '@/types'
import { ensureAtendimentoSerial, gerarProximoSerialOS, matchesSerialOS } from '@/lib/atendimento-serial'
import { compactarAtendimento, loadJSON, safeGetRaw, safeSetJSON } from '@/lib/storage-quota'

const STORAGE_ATENDIMENTOS = 'bbt-atendimentos'
const STORAGE_LOGS = 'bbt-auditoria'
export type AtendimentoInput = Omit<Atendimento, 'id' | 'created_at' | 'updated_at'>

let atendimentosCacheRaw: string | null = null
let atendimentosCache: Atendimento[] | null = null

function invalidarAtendimentosCache(): void {
  atendimentosCacheRaw = null
  atendimentosCache = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_ATENDIMENTOS) invalidarAtendimentosCache()
  })
}

function loadAtendimentos(): Atendimento[] {
  if (typeof window === 'undefined') return []
  try {
    const rawText = safeGetRaw(STORAGE_ATENDIMENTOS) || '[]'
    if (atendimentosCache && atendimentosCacheRaw === rawText) return atendimentosCache

    const parsed = JSON.parse(rawText)
    const raw = Array.isArray(parsed) ? parsed : []
    atendimentosCacheRaw = rawText
    atendimentosCache = raw.map((a: any, index: number) => ensureAtendimentoSerial({
      prioridade: a.prioridade || 'media',
      ...a,
    }, index))
    return atendimentosCache
  } catch {
    invalidarAtendimentosCache()
    return []
  }
}

function saveAtendimentos(list: Atendimento[]) {
  const compactados = list.map((item) => compactarAtendimento(item))
  const ok = safeSetJSON(STORAGE_ATENDIMENTOS, compactados)
  if (ok) {
    const rawText = safeGetRaw(STORAGE_ATENDIMENTOS)
    atendimentosCacheRaw = rawText
    atendimentosCache = compactados.map((a: any, index: number) => ensureAtendimentoSerial({
      prioridade: a.prioridade || 'media',
      ...a,
    }, index))
  } else {
    invalidarAtendimentosCache()
  }
  return ok
}

export function getAllAtendimentos(): Atendimento[] { return loadAtendimentos().slice() }
export function getAtendimentoById(id: string): Atendimento | undefined {
  return loadAtendimentos().find((a) => a.id === id)
}
export function getAtendimentoBySerialOS(serialOS: string): Atendimento | undefined {
  return loadAtendimentos().find((a, index) => matchesSerialOS(a, serialOS, index))
}
export function getAtendimentosByAgente(userId: string): Atendimento[] {
  return loadAtendimentos().filter((a) => a.agente_user_id === userId)
}
export function getAtendimentosByEmpresa(empresaId: string): Atendimento[] {
  return loadAtendimentos().filter((a) => a.empresa_id === empresaId)
}
export function getAtendimentosByFuncionario(funcionarioId: string): Atendimento[] {
  return loadAtendimentos().filter((a) => a.funcionario_id === funcionarioId)
}

export interface FiltroAtendimento {
  agente_user_id?: string
  empresa_id?: string
  status?: StatusAtendimento
  tipo_servico?: TipoServico
  prioridade?: Prioridade
  data_inicio?: string
  data_fim?: string
}

export function getAtendimentosFiltro(f: FiltroAtendimento = {}): Atendimento[] {
  let list = loadAtendimentos().slice()
  if (f.agente_user_id) list = list.filter((a) => a.agente_user_id === f.agente_user_id)
  if (f.empresa_id) list = list.filter((a) => a.empresa_id === f.empresa_id)
  if (f.status) list = list.filter((a) => a.status === f.status)
  if (f.tipo_servico) list = list.filter((a) => a.tipo_servico === f.tipo_servico)
  if (f.prioridade) list = list.filter((a) => a.prioridade === f.prioridade)

  const norm = (s: string | undefined | null): string => {
    if (!s) return ''
    const t = String(s).trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return t.slice(0, 10)
  }
  const dataReg = (a: Atendimento) => norm(a.data_atendimento) || norm(a.created_at)
  if (f.data_inicio) {
    const ini = norm(f.data_inicio)
    list = list.filter((a) => dataReg(a) >= ini)
  }
  if (f.data_fim) {
    const fim = norm(f.data_fim)
    list = list.filter((a) => dataReg(a) <= fim)
  }
  return list.sort((a, b) => dataReg(b).localeCompare(dataReg(a)))
}

export function criarAtendimentoParaLista(data: AtendimentoInput, list: Atendimento[], serialOS?: string): Atendimento {
  const now = new Date().toISOString()
  return {
    ...data,
    id: `atd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    serial_os: (data as Partial<Atendimento>).serial_os || serialOS || gerarProximoSerialOS(list),
    created_at: now,
    updated_at: now,
  }
}

export function atualizarAtendimentoNaLista(
  list: Atendimento[],
  id: string,
  patch: Partial<Atendimento>,
  indexById?: Map<string, number>,
): Atendimento | null {
  const indexed = indexById?.get(id)
  const idx = indexed != null && list[indexed]?.id === id ? indexed : list.findIndex((a) => a.id === id)
  if (idx === -1) return null
  list[idx] = {
    ...list[idx],
    ...patch,
    updated_at: new Date().toISOString(),
    finalizado_em: patch.status === 'finalizado' ? new Date().toISOString() : list[idx].finalizado_em,
  }
  return list[idx]
}

export function persistirAtendimentos(list: Atendimento[]): boolean {
  return saveAtendimentos(list)
}

export function addAtendimento(data: AtendimentoInput): Atendimento | null {
  const list = loadAtendimentos().slice()
  const novo = criarAtendimentoParaLista(data, list)
  list.push(novo)
  if (!saveAtendimentos(list)) return null
  return novo
}

export function updateAtendimento(id: string, patch: Partial<Atendimento>): boolean {
  const list = loadAtendimentos().slice()
  const atualizado = atualizarAtendimentoNaLista(list, id, patch)
  if (!atualizado) return false
  return saveAtendimentos(list)
}

export interface ResultadoVinculoFuncionario {
  ok: boolean
  atualizados: number
  ignorados: number
}

export function vincularFuncionarioNaLista(
  atendimentos: Atendimento[],
  atendimentoIds: Iterable<string>,
  funcionarioId: string,
  empresaId?: string,
  updatedAt = new Date().toISOString(),
): Omit<ResultadoVinculoFuncionario, 'ok'> & { atendimentos: Atendimento[] } {
  const ids = new Set(Array.from(atendimentoIds).filter(Boolean))
  let atualizados = 0

  const lista = atendimentos.map((atendimento) => {
    if (!ids.has(atendimento.id)) return atendimento
    if (empresaId && atendimento.empresa_id !== empresaId) return atendimento
    if (atendimento.funcionario_id === funcionarioId) return atendimento

    atualizados += 1
    return {
      ...atendimento,
      funcionario_id: funcionarioId,
      updated_at: updatedAt,
    }
  })

  return {
    atendimentos: lista,
    atualizados,
    ignorados: ids.size - atualizados,
  }
}

export function vincularFuncionarioAtendimentos(
  atendimentoIds: Iterable<string>,
  funcionarioId: string,
  empresaId?: string,
): ResultadoVinculoFuncionario {
  const resultado = vincularFuncionarioNaLista(
    loadAtendimentos(),
    atendimentoIds,
    funcionarioId,
    empresaId,
  )

  if (resultado.atualizados === 0) {
    return { ok: true, atualizados: 0, ignorados: resultado.ignorados }
  }

  const ok = saveAtendimentos(resultado.atendimentos)
  return {
    ok,
    atualizados: ok ? resultado.atualizados : 0,
    ignorados: resultado.ignorados,
  }
}

export function deleteAtendimento(id: string): boolean {
  return saveAtendimentos(loadAtendimentos().filter((a) => a.id !== id))
}

export function anexarVoucherAtendimento(atendimentoId: string, voucherId: string): boolean {
  const list = loadAtendimentos().slice()
  const idx = list.findIndex((a) => a.id === atendimentoId)
  if (idx === -1) return false
  const atual = list[idx].voucher_ids || []
  if (!atual.includes(voucherId)) atual.push(voucherId)
  list[idx] = { ...list[idx], voucher_ids: atual, updated_at: new Date().toISOString() }
  return saveAtendimentos(list)
}

export interface EstatisticasAtendimentos {
  total: number
  por_status: Record<StatusAtendimento, number>
  por_agente: { agente_user_id: string; total: number }[]
  por_empresa: { empresa_id: string; total: number }[]
  por_tipo: Record<TipoServico, number>
  por_prioridade: Record<Prioridade, number>
  valor_total: number
  valor_finalizado: number
  custo_total: number
  venda_total: number
  markup_total: number
  taxa_total: number
  faturado_total: number
  margem_media_pct: number
}

export function getEstatisticas(filtro: FiltroAtendimento = {}): EstatisticasAtendimentos {
  return calcularEstatisticasAtendimentos(getAtendimentosFiltro(filtro))
}

export function calcularEstatisticasAtendimentos(base: Atendimento[]): EstatisticasAtendimentos {

  const por_status: Record<StatusAtendimento, number> = {
    em_andamento: 0, aguardando_cliente: 0, finalizado: 0, cancelado: 0, pendente: 0,
  }
  const por_tipo: Record<TipoServico, number> = {
    'Aéreo': 0, Hotel: 0, Carro: 0, Pacote: 0, Outro: 0,
  }
  const por_prioridade: Record<Prioridade, number> = {
    baixa: 0, media: 0, alta: 0, urgente: 0,
  }

  let custo_total = 0
  let venda_total = 0
  let markup_total = 0
  let taxa_total = 0

  base.forEach((a) => {
    if (por_status[a.status] !== undefined) por_status[a.status]++
    if (por_tipo[a.tipo_servico] !== undefined) por_tipo[a.tipo_servico]++
    const p: Prioridade = a.prioridade || 'media'
    if (por_prioridade[p] !== undefined) por_prioridade[p]++

    const calc = calcularFinanceiro(a)
    custo_total += calc.custo
    venda_total += calc.venda
    markup_total += calc.markup
    taxa_total += calc.taxa_valor
  })

  const mapAgente = new Map<string, number>()
  const mapEmpresa = new Map<string, number>()
  base.forEach((a) => {
    mapAgente.set(a.agente_user_id, (mapAgente.get(a.agente_user_id) || 0) + 1)
    mapEmpresa.set(a.empresa_id, (mapEmpresa.get(a.empresa_id) || 0) + 1)
  })

  return {
    total: base.length,
    por_status,
    por_agente: Array.from(mapAgente.entries())
      .map(([agente_user_id, total]) => ({ agente_user_id, total }))
      .sort((a, b) => b.total - a.total),
    por_empresa: Array.from(mapEmpresa.entries())
      .map(([empresa_id, total]) => ({ empresa_id, total }))
      .sort((a, b) => b.total - a.total),
    por_tipo,
    por_prioridade,
    valor_total: base.reduce((s, a) => s + (a.valor_cotacao || 0), 0),
    valor_finalizado: base
      .filter((a) => a.status === 'finalizado')
      .reduce((s, a) => s + (a.valor_final || a.valor_cotacao || 0), 0),
    custo_total,
    venda_total,
    markup_total,
    taxa_total,
    faturado_total: venda_total + taxa_total,
    margem_media_pct: venda_total > 0 ? (markup_total / venda_total) * 100 : 0,
  }
}

export function getEstatisticasPorTipo(filtro: FiltroAtendimento = {}): Record<TipoServico, {
  quantidade: number
  custo: number
  venda: number
  markup: number
  taxa: number
  faturado: number
}> {
  const base = getAtendimentosFiltro(filtro)
  const result: Record<TipoServico, any> = {
    'Aéreo': { quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 },
    Hotel: { quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 },
    Carro: { quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 },
    Pacote: { quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 },
    Outro: { quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 },
  }
  base.forEach((a) => {
    const calc = calcularFinanceiro(a)
    const r = result[a.tipo_servico]
    r.quantidade++
    r.custo += calc.custo
    r.venda += calc.venda
    r.markup += calc.markup
    r.taxa += calc.taxa_valor
    r.faturado += calc.total_faturado
  })
  return result
}

function loadLogs(): LogAuditoria[] {
  if (typeof window === 'undefined') return []
  return loadJSON<LogAuditoria[]>(STORAGE_LOGS, [])
}

function saveLogs(list: LogAuditoria[]) {
  try {
    const trimmed = list.slice(-500)
    return safeSetJSON(STORAGE_LOGS, trimmed)
  } catch { return false }
}

export function getAllLogs(): LogAuditoria[] {
  return loadLogs().sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function registrarLog(data: Omit<LogAuditoria, 'id' | 'timestamp'>) {
  const log: LogAuditoria = {
    ...data,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  }
  const list = loadLogs()
  list.push(log)
  saveLogs(list)
}

import { addDaysISODate, todayISODate } from '@/lib/date'
// ============================================================
// FINANCEIRO — Contas a Pagar e Receber
// Cada Atendimento gera 2 lançamentos automáticos:
//  - 1 conta a PAGAR (pro fornecedor — hotel, cia aérea)
//  - 1 conta a RECEBER (do cliente — empresa contratante)
// Permite controle de fluxo de caixa por empresa e por período.
// ============================================================

import type { Atendimento, Empresa } from '@/types'
import { normalizarValor, normalizarData, formatarValor } from './normalizers'
import { registrarEvento } from './audit'
import { compactarFinanceiro, loadJSON, safeSetJSON } from '@/lib/storage-quota'
import { createEntityId } from '@/lib/ids'

export type StatusLancamento = 'pendente' | 'pago' | 'parcial' | 'cancelado' | 'atrasado'
export type TipoLancamento = 'pagar' | 'receber'
export type FormaPagamento = 'PIX' | 'Boleto' | 'TED' | 'Cartão' | 'Dinheiro' | 'Faturamento' | 'Outro'

export interface LancamentoFinanceiro {
  id: string
  tipo: TipoLancamento
  // origem
  atendimento_id?: string // nem todos lançamentos vêm de demanda (pode ser despesa avulsa)
  empresa_id?: string // beneficiário (a receber) ou cliente (info)
  fornecedor_nome?: string // pra contas a pagar
  // valores
  valor: number
  valor_pago: number // quanto já foi quitado
  // datas
  data_emissao: string // ISO
  data_vencimento: string // ISO
  data_pagamento?: string // ISO
  // descrição
  descricao: string
  categoria?: string // Hotel, Aéreo, Operação, Outros
  forma_pagamento?: FormaPagamento
  // status
  status: StatusLancamento
  // metadados
  observacoes?: string
  numero_documento?: string // ex: nº da fatura, NF
  created_at: string
  updated_at?: string
  created_by?: string
}

const STORAGE_KEY = 'bbt-financeiro'

function load(): LancamentoFinanceiro[] {
  if (typeof window === 'undefined') return []
  return loadJSON<LancamentoFinanceiro[]>(STORAGE_KEY, [])
}

function save(arr: LancamentoFinanceiro[]) {
  if (typeof window === 'undefined') return
  if (!safeSetJSON(STORAGE_KEY, arr.map((item) => compactarFinanceiro(item)))) {
    throw new Error('Nao foi possivel preparar os dados financeiros para persistencia.')
  }
}

function novoId(): string {
  return createEntityId('lan', '_')
}

function recalcularStatus(l: LancamentoFinanceiro): StatusLancamento {
  if (l.status === 'cancelado') return 'cancelado'
  if (l.valor_pago >= l.valor - 0.01) return 'pago'
  if (l.valor_pago > 0) return 'parcial'
  const hoje = todayISODate()
  if (l.data_vencimento < hoje) return 'atrasado'
  return 'pendente'
}

// ============================================================
// CRUD
// ============================================================

export function getAllLancamentos(): LancamentoFinanceiro[] {
  return load().map((l) => ({ ...l, status: recalcularStatus(l) }))
}

export function getLancamentosPorAtendimento(atendimentoId: string): LancamentoFinanceiro[] {
  return getAllLancamentos().filter((l) => l.atendimento_id === atendimentoId)
}

export function getLancamentosPorEmpresa(empresaId: string): LancamentoFinanceiro[] {
  return getAllLancamentos().filter((l) => l.empresa_id === empresaId)
}

export function adicionarLancamento(
  data: Omit<LancamentoFinanceiro, 'id' | 'created_at' | 'status' | 'valor_pago'> & { valor_pago?: number; status?: StatusLancamento }
): LancamentoFinanceiro {
  const l: LancamentoFinanceiro = {
    id: novoId(),
    ...data,
    valor_pago: data.valor_pago ?? 0,
    status: data.status ?? 'pendente',
    created_at: new Date().toISOString(),
  }
  l.status = recalcularStatus(l)
  const all = load()
  all.push(l)
  save(all)
  return l
}

export function atualizarLancamento(id: string, patch: Partial<LancamentoFinanceiro>): boolean {
  const all = load()
  const i = all.findIndex((l) => l.id === id)
  if (i < 0) return false
  all[i] = { ...all[i], ...patch, updated_at: new Date().toISOString() }
  all[i].status = recalcularStatus(all[i])
  save(all)
  return true
}

export function excluirLancamento(id: string): boolean {
  const all = load()
  const i = all.findIndex((l) => l.id === id)
  if (i < 0) return false
  all.splice(i, 1)
  save(all)
  return true
}

export function pagarLancamento(
  id: string,
  valor: number,
  data_pagamento: string,
  forma: FormaPagamento,
  userId: string,
  userName: string
): boolean {
  const all = load()
  const l = all.find((x) => x.id === id)
  if (!l) return false
  l.valor_pago = Math.min(l.valor_pago + valor, l.valor)
  l.data_pagamento = data_pagamento
  l.forma_pagamento = forma
  l.status = recalcularStatus(l)
  l.updated_at = new Date().toISOString()
  save(all)

  registrarEvento({
    user_id: userId,
    user_name: userName,
    acao: 'pagar',
    entidade: 'Lancamento',
    entidade_id: id,
    descricao: `${l.tipo === 'pagar' ? 'Pagou' : 'Recebeu'} ${formatarValor(valor)} de "${l.descricao}"`,
    meta: { tipo: l.tipo, valor, forma, status_atual: l.status },
  })

  return true
}

// ============================================================
// GERAÇÃO AUTOMÁTICA A PARTIR DO ATENDIMENTO
// ============================================================

/**
 * Quando um atendimento é finalizado, criamos os 2 lançamentos:
 *  - A receber (do cliente/empresa)
 *  - A pagar (pro fornecedor)
 *
 * Idempotente: se já existe lançamento desse atendimento, atualiza.
 */
export function gerarLancamentosDoAtendimento(
  a: Atendimento,
  empresa: Empresa | undefined,
  opts: { dias_pagamento_cliente?: number; dias_pagamento_fornecedor?: number } = {}
): { receber?: LancamentoFinanceiro; pagar?: LancamentoFinanceiro } {
  const valorVenda = normalizarValor(a.valor_venda || a.valor_final || a.valor_cotacao || 0)
  const valorCusto = normalizarValor(a.valor_custo || 0)
  if (valorVenda === 0 && valorCusto === 0) return {}

  const hoje = todayISODate()
  const diasReceber = opts.dias_pagamento_cliente ?? 30
  const diasPagar = opts.dias_pagamento_fornecedor ?? 7
  const dataVencReceber = addDaysISODate(hoje, diasReceber)
  const dataVencPagar = addDaysISODate(hoje, diasPagar)

  const dataEmissao = a.data_atendimento || hoje
  const all = load()
  let receber: LancamentoFinanceiro | undefined
  let pagar: LancamentoFinanceiro | undefined

  // A RECEBER (do cliente)
  if (valorVenda > 0) {
    const existente = all.find((l) => l.atendimento_id === a.id && l.tipo === 'receber')
    const dados: Omit<LancamentoFinanceiro, 'id' | 'created_at' | 'status' | 'valor_pago'> = {
      tipo: 'receber',
      atendimento_id: a.id,
      empresa_id: a.empresa_id,
      valor: valorVenda,
      data_emissao: dataEmissao,
      data_vencimento: dataVencReceber,
      descricao: `${a.tipo_servico} · ${a.passageiro_nome}${a.venda_numero ? ` · venda ${a.venda_numero}` : ''}`,
      categoria: a.tipo_servico,
      numero_documento: a.venda_numero,
    }
    if (existente) {
      existente.valor = valorVenda
      existente.descricao = dados.descricao
      existente.empresa_id = a.empresa_id
      existente.numero_documento = a.venda_numero
      existente.updated_at = new Date().toISOString()
      existente.status = recalcularStatus(existente)
      receber = existente
    } else {
      receber = {
        id: novoId(),
        ...dados,
        valor_pago: 0,
        status: 'pendente',
        created_at: new Date().toISOString(),
      }
      receber.status = recalcularStatus(receber)
      all.push(receber)
    }
  }

  // A PAGAR (pro fornecedor)
  if (valorCusto > 0) {
    const existente = all.find((l) => l.atendimento_id === a.id && l.tipo === 'pagar')
    const fornecedor = a.detalhes_hotel?.hotel_nome || a.detalhes_aereo?.cia_aerea || 'Fornecedor'
    const dados: Omit<LancamentoFinanceiro, 'id' | 'created_at' | 'status' | 'valor_pago'> = {
      tipo: 'pagar',
      atendimento_id: a.id,
      empresa_id: a.empresa_id,
      fornecedor_nome: fornecedor,
      valor: valorCusto,
      data_emissao: dataEmissao,
      data_vencimento: dataVencPagar,
      descricao: `${a.tipo_servico} · ${fornecedor} · ${a.passageiro_nome}`,
      categoria: a.tipo_servico,
      numero_documento: a.venda_numero,
    }
    if (existente) {
      existente.valor = valorCusto
      existente.descricao = dados.descricao
      existente.fornecedor_nome = fornecedor
      existente.updated_at = new Date().toISOString()
      existente.status = recalcularStatus(existente)
      pagar = existente
    } else {
      pagar = {
        id: novoId(),
        ...dados,
        valor_pago: 0,
        status: 'pendente',
        created_at: new Date().toISOString(),
      }
      pagar.status = recalcularStatus(pagar)
      all.push(pagar)
    }
  }

  save(all)
  return { receber, pagar }
}

export function gerarLancamentosDosAtendimentos(
  atendimentos: Atendimento[],
  opts: { dias_pagamento_cliente?: number; dias_pagamento_fornecedor?: number } = {}
): { receber: number; pagar: number; total: number } {
  const all = load()
  const byAtendimentoTipo = new Map<string, LancamentoFinanceiro>(
    all
      .filter((l) => l.atendimento_id)
      .map((l) => [`${l.atendimento_id}|${l.tipo}`, l] as const)
  )
  let receberCount = 0
  let pagarCount = 0

  for (const a of atendimentos) {
    if (!['finalizado', 'em_andamento', 'aguardando_cliente'].includes(a.status)) continue
    const valorVenda = normalizarValor(a.valor_venda || a.valor_final || a.valor_cotacao || 0)
    const valorCusto = normalizarValor(a.valor_custo || 0)
    if (valorVenda === 0 && valorCusto === 0) continue

    const hoje = todayISODate()
    const diasReceber = opts.dias_pagamento_cliente ?? 30
    const diasPagar = opts.dias_pagamento_fornecedor ?? 7
    const dataVencReceber = addDaysISODate(hoje, diasReceber)
    const dataVencPagar = addDaysISODate(hoje, diasPagar)
    const dataEmissao = a.data_atendimento || hoje

    if (valorVenda > 0) {
      const key = `${a.id}|receber`
      const existente = byAtendimentoTipo.get(key)
      const descricao = `${a.tipo_servico} - ${a.passageiro_nome}${a.venda_numero ? ` - venda ${a.venda_numero}` : ''}`
      if (existente) {
        existente.valor = valorVenda
        existente.descricao = descricao
        existente.empresa_id = a.empresa_id
        existente.numero_documento = a.venda_numero
        existente.updated_at = new Date().toISOString()
        existente.status = recalcularStatus(existente)
      } else {
        const novo: LancamentoFinanceiro = {
          id: novoId(),
          tipo: 'receber',
          atendimento_id: a.id,
          empresa_id: a.empresa_id,
          valor: valorVenda,
          valor_pago: 0,
          data_emissao: dataEmissao,
          data_vencimento: dataVencReceber,
          descricao,
          categoria: a.tipo_servico,
          numero_documento: a.venda_numero,
          status: 'pendente',
          created_at: new Date().toISOString(),
        }
        novo.status = recalcularStatus(novo)
        all.push(novo)
        byAtendimentoTipo.set(key, novo)
      }
      receberCount++
    }

    if (valorCusto > 0) {
      const key = `${a.id}|pagar`
      const existente = byAtendimentoTipo.get(key)
      const fornecedor = a.detalhes_hotel?.hotel_nome || a.detalhes_aereo?.cia_aerea || 'Fornecedor'
      const descricao = `${a.tipo_servico} - ${fornecedor} - ${a.passageiro_nome}`
      if (existente) {
        existente.valor = valorCusto
        existente.descricao = descricao
        existente.fornecedor_nome = fornecedor
        existente.updated_at = new Date().toISOString()
        existente.status = recalcularStatus(existente)
      } else {
        const novo: LancamentoFinanceiro = {
          id: novoId(),
          tipo: 'pagar',
          atendimento_id: a.id,
          empresa_id: a.empresa_id,
          fornecedor_nome: fornecedor,
          valor: valorCusto,
          valor_pago: 0,
          data_emissao: dataEmissao,
          data_vencimento: dataVencPagar,
          descricao,
          categoria: a.tipo_servico,
          numero_documento: a.venda_numero,
          status: 'pendente',
          created_at: new Date().toISOString(),
        }
        novo.status = recalcularStatus(novo)
        all.push(novo)
        byAtendimentoTipo.set(key, novo)
      }
      pagarCount++
    }
  }

  save(all)
  return { receber: receberCount, pagar: pagarCount, total: receberCount + pagarCount }
}

// ============================================================
// AGREGAÇÕES (relatórios)
// ============================================================

export interface ResumoFinanceiro {
  total_a_receber: number
  total_a_pagar: number
  saldo_previsto: number // a_receber - a_pagar
  recebido: number
  pago: number
  saldo_realizado: number
  atrasados_receber: number
  atrasados_pagar: number
  por_categoria: Record<string, { receber: number; pagar: number }>
  por_empresa: Record<string, { receber: number; pagar: number; nome?: string }>
}

export function calcularResumoFinanceiro(opts: {
  desde?: string
  ate?: string
  empresa_id?: string
} = {}): ResumoFinanceiro {
  return calcularResumoFinanceiroDaLista(getAllLancamentos(), opts)
}

export function calcularResumoFinanceiroDaLista(
  lancamentos: LancamentoFinanceiro[],
  opts: { desde?: string; ate?: string; empresa_id?: string } = {},
): ResumoFinanceiro {
  let lancs = lancamentos
  if (opts.desde) lancs = lancs.filter((l) => l.data_vencimento >= opts.desde!)
  if (opts.ate) lancs = lancs.filter((l) => l.data_vencimento <= opts.ate!)
  if (opts.empresa_id) lancs = lancs.filter((l) => l.empresa_id === opts.empresa_id)

  const r: ResumoFinanceiro = {
    total_a_receber: 0,
    total_a_pagar: 0,
    saldo_previsto: 0,
    recebido: 0,
    pago: 0,
    saldo_realizado: 0,
    atrasados_receber: 0,
    atrasados_pagar: 0,
    por_categoria: {},
    por_empresa: {},
  }

  for (const l of lancs) {
    if (l.status === 'cancelado') continue
    if (l.tipo === 'receber') {
      r.total_a_receber += l.valor
      r.recebido += l.valor_pago
      if (l.status === 'atrasado') r.atrasados_receber += l.valor - l.valor_pago
    } else {
      r.total_a_pagar += l.valor
      r.pago += l.valor_pago
      if (l.status === 'atrasado') r.atrasados_pagar += l.valor - l.valor_pago
    }
    // Por categoria
    const cat = l.categoria || 'Outros'
    if (!r.por_categoria[cat]) r.por_categoria[cat] = { receber: 0, pagar: 0 }
    r.por_categoria[cat][l.tipo] += l.valor

    // Por empresa
    if (l.empresa_id) {
      if (!r.por_empresa[l.empresa_id]) r.por_empresa[l.empresa_id] = { receber: 0, pagar: 0 }
      r.por_empresa[l.empresa_id][l.tipo] += l.valor
    }
  }

  r.saldo_previsto = r.total_a_receber - r.total_a_pagar
  r.saldo_realizado = r.recebido - r.pago
  return r
}

'use client'
import { todayISODate } from '@/lib/date'

import type {
  CarteiraCorporativa,
  CartaoCorporativo,
  FaturaCorporativa,
  MovimentoCarteiraCorporativa,
  StatusFaturaCorporativa,
  StatusMovimentoCarteira,
} from '@/types'
import type { LancamentoFinanceiro } from '@/lib/financeiro'
import { corporateFinanceStateSchema } from '@/lib/corporate-finance/schema'
import {
  applyDomainApiValueLocally,
  loadJSON,
  safeSetJSON,
} from '@/lib/storage-quota'
import { createEntityId } from '@/lib/ids'

const STORAGE_KEY = 'bbt-corporate-finance'

export interface CorporateFinanceState {
  carteiras: CarteiraCorporativa[]
  cartoes: CartaoCorporativo[]
  movimentos: MovimentoCarteiraCorporativa[]
  faturas: FaturaCorporativa[]
}

const EMPTY_STATE: CorporateFinanceState = {
  carteiras: [],
  cartoes: [],
  movimentos: [],
  faturas: [],
}

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return createEntityId(prefix, '_')
}

function load(): CorporateFinanceState {
  if (typeof window === 'undefined') return { ...EMPTY_STATE }
  const raw = loadJSON<Partial<CorporateFinanceState>>(STORAGE_KEY, EMPTY_STATE)
  return {
    carteiras: Array.isArray(raw.carteiras) ? raw.carteiras : [],
    cartoes: Array.isArray(raw.cartoes) ? raw.cartoes : [],
    movimentos: Array.isArray(raw.movimentos) ? raw.movimentos : [],
    faturas: Array.isArray(raw.faturas) ? raw.faturas : [],
  }
}

function save(state: CorporateFinanceState): boolean {
  return safeSetJSON(STORAGE_KEY, {
    carteiras: state.carteiras,
    cartoes: state.cartoes.slice(-5000),
    movimentos: state.movimentos.slice(-10000),
    faturas: state.faturas.slice(-5000),
  })
}

export interface CorporateCardRegistration {
  ultimos4: string
  bandeira: NonNullable<CartaoCorporativo['bandeira']>
  validade_mes?: number
  validade_ano?: number
}

export type CorporateCardValidation =
  | { valid: true; value: CorporateCardRegistration }
  | { valid: false; error: string }

export function validateCorporateCardRegistration(
  data: CorporateCardRegistration,
  currentYear = new Date().getFullYear(),
): CorporateCardValidation {
  const ultimos4 = String(data.ultimos4 || '').replace(/\D/g, '')
  if (!/^\d{4}$/.test(ultimos4)) {
    return { valid: false, error: 'Informe exatamente os quatro últimos dígitos do cartão emitido.' }
  }
  if (
    data.validade_mes != null &&
    (!Number.isInteger(data.validade_mes) || data.validade_mes < 1 || data.validade_mes > 12)
  ) {
    return { valid: false, error: 'O mês de validade deve estar entre 1 e 12.' }
  }
  if (
    data.validade_ano != null &&
    (!Number.isInteger(data.validade_ano) || data.validade_ano < currentYear)
  ) {
    return { valid: false, error: 'O ano de validade não pode estar no passado.' }
  }
  return {
    valid: true,
    value: {
      ...data,
      ultimos4,
    },
  }
}

function dataHoje(): string {
  return todayISODate()
}

function statusFatura(f: FaturaCorporativa): StatusFaturaCorporativa {
  if (f.status === 'cancelada') return 'cancelada'
  if (f.valor_pago >= f.valor_total - 0.01) return 'paga'
  if (f.status === 'fechada') return 'fechada'
  if (f.vencimento < dataHoje()) return 'vencida'
  return 'aberta'
}

export function getCorporateFinanceState(): CorporateFinanceState {
  const state = load()
  return {
    ...state,
    faturas: state.faturas.map((f) => ({ ...f, status: statusFatura(f) })),
  }
}

export function aplicarCorporateFinanceStateDoServidor(
  value: unknown,
  scopedCompanyIds?: string[],
): CorporateFinanceState {
  const parsed = corporateFinanceStateSchema.parse(value) as CorporateFinanceState
  if (!scopedCompanyIds?.length) {
    applyDomainApiValueLocally(STORAGE_KEY, parsed)
    return parsed
  }

  const scoped = new Set(scopedCompanyIds)
  const current = load()
  const next: CorporateFinanceState = {
    carteiras: [
      ...current.carteiras.filter((item) => !scoped.has(item.company_id)),
      ...parsed.carteiras,
    ],
    cartoes: [
      ...current.cartoes.filter((item) => !scoped.has(item.company_id)),
      ...parsed.cartoes,
    ],
    movimentos: [
      ...current.movimentos.filter((item) => !scoped.has(item.company_id)),
      ...parsed.movimentos,
    ],
    faturas: [
      ...current.faturas.filter((item) => !scoped.has(item.company_id)),
      ...parsed.faturas,
    ],
  }
  applyDomainApiValueLocally(STORAGE_KEY, next)
  return next
}

export function getAllCarteirasCorporativas(): CarteiraCorporativa[] {
  return getCorporateFinanceState().carteiras
}

export function getCarteiraPorEmpresa(companyId: string): CarteiraCorporativa | undefined {
  return getCorporateFinanceState().carteiras.find((c) => c.company_id === companyId)
}

export function garantirCarteiraEmpresa(companyId: string): CarteiraCorporativa {
  const state = load()
  const existente = state.carteiras.find((c) => c.company_id === companyId)
  if (existente) return existente

  const carteira: CarteiraCorporativa = {
    id: newId('wallet'),
    company_id: companyId,
    saldo_disponivel: 0,
    limite_credito: 0,
    limite_pix_diario: 0,
    limite_cartao_mensal: 0,
    status: 'pendente_configuracao',
    pix_habilitado: false,
    cartao_habilitado: false,
    provedor: 'pendente',
    created_at: nowIso(),
  }
  state.carteiras.push(carteira)
  if (!save(state)) {
    throw new Error('Não foi possível preparar a carteira corporativa para persistência.')
  }
  return carteira
}

export function atualizarCarteiraEmpresa(
  carteiraId: string,
  patch: Partial<CarteiraCorporativa>,
): CarteiraCorporativa | null {
  const state = load()
  const idx = state.carteiras.findIndex((c) => c.id === carteiraId)
  if (idx < 0) return null
  state.carteiras[idx] = { ...state.carteiras[idx], ...patch, updated_at: nowIso() }
  if (!save(state)) return null
  return state.carteiras[idx]
}

export function getCartoesCorporativos(companyId?: string): CartaoCorporativo[] {
  const cartoes = getCorporateFinanceState().cartoes
  return companyId ? cartoes.filter((c) => c.company_id === companyId) : cartoes
}

export function criarCartaoCorporativo(data: {
  company_id: string
  tipo: CartaoCorporativo['tipo']
  apelido: string
  limite: number
  portador_nome?: string
  funcionario_id?: string | null
  merchant_lock?: string
  criado_por_user_id?: string
  ultimos4: string
  bandeira: NonNullable<CartaoCorporativo['bandeira']>
  validade_mes?: number
  validade_ano?: number
}): CartaoCorporativo | null {
  const validation = validateCorporateCardRegistration(data)
  if (!validation.valid) return null

  const state = load()
  let carteira = state.carteiras.find((c) => c.company_id === data.company_id)
  if (!carteira) {
    carteira = garantirCarteiraEmpresa(data.company_id)
    const updated = load()
    state.carteiras = updated.carteiras
  }

  const card: CartaoCorporativo = {
    id: newId('card'),
    carteira_id: carteira.id,
    company_id: data.company_id,
    tipo: data.tipo,
    apelido: data.apelido,
    portador_nome: data.portador_nome,
    funcionario_id: data.funcionario_id || null,
    ultimos4: validation.value.ultimos4,
    bandeira: validation.value.bandeira,
    limite: Math.max(0, Number(data.limite || 0)),
    gasto_mes: 0,
    status: 'ativo',
    merchant_lock: data.merchant_lock,
    validade_mes: validation.value.validade_mes,
    validade_ano: validation.value.validade_ano,
    criado_por_user_id: data.criado_por_user_id,
    created_at: nowIso(),
  }
  state.cartoes.push(card)
  if (!save(state)) return null
  return card
}

export function atualizarCartaoCorporativo(id: string, patch: Partial<CartaoCorporativo>): CartaoCorporativo | null {
  const state = load()
  const idx = state.cartoes.findIndex((c) => c.id === id)
  if (idx < 0) return null
  state.cartoes[idx] = { ...state.cartoes[idx], ...patch, updated_at: nowIso() }
  if (!save(state)) return null
  return state.cartoes[idx]
}

export function getMovimentosCarteira(companyId?: string): MovimentoCarteiraCorporativa[] {
  const movimentos = getCorporateFinanceState().movimentos.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return companyId ? movimentos.filter((m) => m.company_id === companyId) : movimentos
}

export function registrarMovimentoCarteira(data: {
  company_id: string
  tipo: MovimentoCarteiraCorporativa['tipo']
  origem: MovimentoCarteiraCorporativa['origem']
  valor: number
  descricao: string
  status?: StatusMovimentoCarteira
  atendimento_id?: string
  lancamento_id?: string
  cartao_id?: string
}): MovimentoCarteiraCorporativa | null {
  const state = load()
  let carteira = state.carteiras.find((c) => c.company_id === data.company_id)
  if (!carteira) {
    carteira = garantirCarteiraEmpresa(data.company_id)
    const updated = load()
    state.carteiras = updated.carteiras
    carteira = state.carteiras.find((c) => c.company_id === data.company_id)!
  }

  const movimento: MovimentoCarteiraCorporativa = {
    id: newId('mov'),
    carteira_id: carteira.id,
    company_id: data.company_id,
    tipo: data.tipo,
    origem: data.origem,
    valor: Math.max(0, Number(data.valor || 0)),
    descricao: data.descricao,
    status: data.status || 'processado',
    atendimento_id: data.atendimento_id,
    lancamento_id: data.lancamento_id,
    cartao_id: data.cartao_id,
    created_at: nowIso(),
    processado_em: (data.status || 'processado') === 'processado' ? nowIso() : undefined,
  }

  if (movimento.status === 'processado') {
    const sinal = movimento.tipo === 'debito' ? -1 : 1
    carteira.saldo_disponivel = Math.max(0, Number(carteira.saldo_disponivel || 0) + sinal * movimento.valor)
    carteira.updated_at = nowIso()
  }

  state.movimentos.push(movimento)
  if (!save(state)) return null
  return movimento
}

export function getFaturasCorporativas(companyId?: string): FaturaCorporativa[] {
  const faturas = getCorporateFinanceState().faturas.sort((a, b) => b.periodo_fim.localeCompare(a.periodo_fim))
  return companyId ? faturas.filter((f) => f.company_id === companyId) : faturas
}

export function gerarFaturaEmpresa(opts: {
  company_id: string
  lancamentos: LancamentoFinanceiro[]
  periodo_inicio: string
  periodo_fim: string
  vencimento: string
}): FaturaCorporativa | null {
  const state = load()
  const itens = opts.lancamentos.filter((l) =>
    l.tipo === 'receber' &&
    l.empresa_id === opts.company_id &&
    l.status !== 'cancelado' &&
    l.data_emissao >= opts.periodo_inicio &&
    l.data_emissao <= opts.periodo_fim,
  )
  const valorTotal = itens.reduce((sum, item) => sum + Number(item.valor || 0), 0)
  const atendimentoIds = Array.from(new Set(itens.map((i) => i.atendimento_id).filter(Boolean))) as string[]
  const lancamentoIds = itens.map((i) => i.id)

  const numero = `FAT-${opts.periodo_inicio.slice(0, 7).replace('-', '')}-${opts.company_id.slice(-5).toUpperCase()}`
  const existenteIdx = state.faturas.findIndex((f) =>
    f.company_id === opts.company_id &&
    f.periodo_inicio === opts.periodo_inicio &&
    f.periodo_fim === opts.periodo_fim,
  )

  if (existenteIdx >= 0) {
    const atual = state.faturas[existenteIdx]
    state.faturas[existenteIdx] = {
      ...atual,
      numero: atual.numero || numero,
      vencimento: opts.vencimento,
      valor_total: valorTotal,
      lancamento_ids: lancamentoIds,
      atendimento_ids: atendimentoIds,
      status: statusFatura({ ...atual, valor_total: valorTotal, vencimento: opts.vencimento }),
      updated_at: nowIso(),
    }
    if (!save(state)) return null
    return state.faturas[existenteIdx]
  }

  const fatura: FaturaCorporativa = {
    id: newId('fat'),
    company_id: opts.company_id,
    numero,
    periodo_inicio: opts.periodo_inicio,
    periodo_fim: opts.periodo_fim,
    vencimento: opts.vencimento,
    valor_total: valorTotal,
    valor_pago: 0,
    status: valorTotal > 0 ? 'aberta' : 'aberta',
    lancamento_ids: lancamentoIds,
    atendimento_ids: atendimentoIds,
    created_at: nowIso(),
  }
  fatura.status = statusFatura(fatura)
  state.faturas.push(fatura)
  if (!save(state)) return null
  return fatura
}

export function marcarFaturaPaga(id: string, valorPago?: number): FaturaCorporativa | null {
  const state = load()
  const idx = state.faturas.findIndex((f) => f.id === id)
  if (idx < 0) return null
  const fatura = state.faturas[idx]
  const valor = Math.min(fatura.valor_total, valorPago ?? fatura.valor_total)
  state.faturas[idx] = {
    ...fatura,
    valor_pago: valor,
    status: valor >= fatura.valor_total - 0.01 ? 'paga' : 'aberta',
    updated_at: nowIso(),
  }
  if (!save(state)) return null
  return state.faturas[idx]
}

export function resumoCarteiraEmpresa(companyId: string) {
  const state = getCorporateFinanceState()
  const carteira = state.carteiras.find((c) => c.company_id === companyId)
  const cartoes = state.cartoes.filter((c) => c.company_id === companyId)
  const faturas = state.faturas.filter((f) => f.company_id === companyId)
  const movimentos = state.movimentos.filter((m) => m.company_id === companyId)
  return {
    carteira,
    cartoes,
    faturas,
    movimentos,
    total_cartoes_ativos: cartoes.filter((c) => c.status === 'ativo').length,
    faturas_abertas: faturas.filter((f) => ['aberta', 'vencida', 'fechada'].includes(f.status)).length,
    valor_faturas_abertas: faturas
      .filter((f) => ['aberta', 'vencida', 'fechada'].includes(f.status))
      .reduce((sum, f) => sum + Math.max(0, f.valor_total - f.valor_pago), 0),
    gasto_cartao_mes: cartoes.reduce((sum, c) => sum + Number(c.gasto_mes || 0), 0),
  }
}

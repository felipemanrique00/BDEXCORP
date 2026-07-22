import { todayISODate } from '@/lib/date'
// ============================================================
// RECONCILIAÇÃO AUTOMÁTICA
// Compara dados entre vouchers, emissões, demandas e financeiro.
// Detecta inconsistências e gera alertas estruturados.
// ============================================================

import type { Atendimento, Empresa, Funcionario } from '@/types'
import { getAllAtendimentos } from './atendimentos-storage'
import { chavedeNome, normalizarValor } from './normalizers'
import { loadJSON, safeGetRaw, safeSetJSON } from '@/lib/storage-quota'
import { encontrarFuncionarioPorNomeInteligente } from '@/lib/funcionario-identidade'

export type SeveridadeAlerta = 'critico' | 'alto' | 'medio' | 'baixo' | 'info'

export interface AlertaInconsistencia {
  id: string
  severidade: SeveridadeAlerta
  tipo: TipoAlerta
  titulo: string
  descricao: string
  entidades: Array<{ tipo: string; id: string; nome?: string }>
  sugestao_acao?: string
  detectado_em: string
  resolvido?: boolean
  resolvido_em?: string
  resolvido_por?: string
}

export type TipoAlerta =
  | 'venda_duplicada'
  | 'valor_divergente'
  | 'data_invalida'
  | 'passageiro_sem_funcionario'
  | 'empresa_sem_codigo'
  | 'demanda_sem_emissao'
  | 'emissao_sem_demanda'
  | 'funcionario_sem_cpf'
  | 'voucher_sem_demanda'
  | 'agente_sobrecarregado'
  | 'demanda_atrasada'
  | 'valor_zerado'

const STORAGE_ALERTAS = 'bbt-alertas'
const STORAGE_ALERTAS_RESOLVIDOS = 'bbt-alertas-resolvidos'

function loadAlertas(): AlertaInconsistencia[] {
  if (typeof window === 'undefined') return []
  return loadJSON<AlertaInconsistencia[]>(STORAGE_ALERTAS, [])
}

function saveAlertas(arr: AlertaInconsistencia[]): boolean {
  if (typeof window === 'undefined') return false
  return safeSetJSON(STORAGE_ALERTAS, arr.slice(-1000))
}

function loadResolvidos(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    return new Set(JSON.parse(safeGetRaw(STORAGE_ALERTAS_RESOLVIDOS) || '[]'))
  } catch {
    return new Set()
  }
}

function saveResolvidos(s: Set<string>): boolean {
  if (typeof window === 'undefined') return false
  return safeSetJSON(STORAGE_ALERTAS_RESOLVIDOS, Array.from(s).slice(-5000))
}

function gerarHashAlerta(tipo: TipoAlerta, entidades: Array<{ tipo: string; id: string }>): string {
  const ids = entidades.map((e) => `${e.tipo}:${e.id}`).sort().join('|')
  return `${tipo}::${ids}`
}

// ============================================================
// DETECTORES INDIVIDUAIS
// ============================================================

/**
 * Detecta vendas com mesmo número (Venda Nº) - duplicidade real do sistema de emissão
 */
export function detectarVendasDuplicadas(atendimentos: Atendimento[]): AlertaInconsistencia[] {
  const porVenda = new Map<string, Atendimento[]>()
  for (const a of atendimentos) {
    if (!a.venda_numero) continue
    const numeroVenda = a.venda_numero.trim()
    const k = `${a.empresa_id || 'sem-empresa'}::${numeroVenda}`
    if (!porVenda.has(k)) porVenda.set(k, [])
    porVenda.get(k)!.push(a)
  }
  const alertas: AlertaInconsistencia[] = []
  for (const lista of porVenda.values()) {
    if (lista.length > 1) {
      const num = lista[0].venda_numero?.trim() || 'não informado'
      alertas.push({
        id: gerarHashAlerta('venda_duplicada', lista.map((a) => ({ tipo: 'Atendimento', id: a.id }))),
        severidade: 'critico',
        tipo: 'venda_duplicada',
        titulo: `Venda nº ${num} duplicada`,
        descricao: `Existem ${lista.length} atendimentos com o mesmo número de venda. Pode causar duplicação no faturamento.`,
        entidades: lista.map((a) => ({ tipo: 'Atendimento', id: a.id, nome: a.passageiro_nome })),
        sugestao_acao: 'Mantenha apenas uma das demandas e arquive/exclua as outras',
        detectado_em: new Date().toISOString(),
      })
    }
  }
  return alertas
}

/**
 * Detecta divergência entre valor da venda e valor da emissão (custo + markup ≠ venda)
 */
export function detectarDivergenciasValor(atendimentos: Atendimento[]): AlertaInconsistencia[] {
  const alertas: AlertaInconsistencia[] = []
  for (const a of atendimentos) {
    const venda = normalizarValor(a.valor_venda || a.valor_final || a.valor_cotacao)
    const custo = normalizarValor(a.valor_custo || 0)
    const markup = normalizarValor(a.markup_valor || 0)

    // Caso 1: tem custo + markup, mas valor_venda zerado
    if (venda === 0 && custo > 0) {
      alertas.push({
        id: gerarHashAlerta('valor_zerado', [{ tipo: 'Atendimento', id: a.id }]),
        severidade: 'alto',
        tipo: 'valor_zerado',
        titulo: 'Demanda com custo mas sem valor de venda',
        descricao: `${a.passageiro_nome} tem custo R$ ${custo.toFixed(2)} mas valor de venda está zerado.`,
        entidades: [{ tipo: 'Atendimento', id: a.id, nome: a.passageiro_nome }],
        sugestao_acao: 'Defina o valor de venda na demanda',
        detectado_em: new Date().toISOString(),
      })
      continue
    }

    // Caso 2: custo + markup ≠ venda (com tolerância de 1 real pra arredondamento)
    if (custo > 0 && markup > 0 && venda > 0) {
      const esperado = custo + markup
      const diff = Math.abs(esperado - venda)
      if (diff > 1.01) {
        alertas.push({
          id: gerarHashAlerta('valor_divergente', [{ tipo: 'Atendimento', id: a.id }]),
          severidade: diff > venda * 0.1 ? 'alto' : 'medio',
          tipo: 'valor_divergente',
          titulo: `Valor divergente (${a.passageiro_nome})`,
          descricao: `Custo (R$ ${custo.toFixed(2)}) + Markup (R$ ${markup.toFixed(2)}) = R$ ${esperado.toFixed(2)}, mas Venda = R$ ${venda.toFixed(2)}. Diferença: R$ ${diff.toFixed(2)}.`,
          entidades: [{ tipo: 'Atendimento', id: a.id, nome: a.passageiro_nome }],
          sugestao_acao: 'Revise os valores no atendimento',
          detectado_em: new Date().toISOString(),
        })
      }
    }
  }
  return alertas
}

/**
 * Detecta passageiros que aparecem em demandas mas não estão cadastrados como funcionário.
 * Sugere criar o vínculo. Importante pra produtividade e relatórios por funcionário.
 */
export function detectarPassageirosSemFuncionario(
  atendimentos: Atendimento[],
  funcionarios: Funcionario[]
): AlertaInconsistencia[] {
  const alertas: AlertaInconsistencia[] = []
  const funcsAtivos = funcionarios.filter((f) => f.ativo !== false)
  const funcionarioIds = new Set(funcionarios.map((funcionario) => funcionario.id))

  // Agrupa por chave de nome+empresa pra não gerar 1 alerta por demanda
  const grupos = new Map<string, Atendimento[]>()
  for (const a of atendimentos) {
    if (a.funcionario_id && funcionarioIds.has(a.funcionario_id)) continue
    if (!a.passageiro_nome || !a.empresa_id) continue
    const k = `${chavedeNome(a.passageiro_nome)}::${a.empresa_id}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k)!.push(a)
  }

  for (const [, lista] of grupos) {
    const exemplo = lista[0]
    // Procura match parcial nos funcionários
    const match = encontrarFuncionarioPorNomeInteligente(funcsAtivos, exemplo.passageiro_nome, exemplo.empresa_id, 84)

    if (match && !match.ambiguo) {
      // Match forte: provavelmente é o mesmo, só não foi vinculado
      alertas.push({
        id: gerarHashAlerta('passageiro_sem_funcionario', lista.map((a) => ({ tipo: 'Atendimento', id: a.id }))),
        severidade: 'medio',
        tipo: 'passageiro_sem_funcionario',
        titulo: `Vincular ${exemplo.passageiro_nome} a funcionário?`,
        descricao: `${lista.length} demanda(s) com este passageiro. Match ${match.score}% (${match.motivo}) com ${match.funcionario.nome} (já cadastrado).`,
        entidades: [
          ...lista.map((a) => ({ tipo: 'Atendimento', id: a.id, nome: a.passageiro_nome })),
          { tipo: 'Funcionario', id: match.funcionario.id, nome: match.funcionario.nome },
        ],
        sugestao_acao: `Vincular as demandas ao funcionário ${match.funcionario.nome}`,
        detectado_em: new Date().toISOString(),
      })
    } else if (lista.length >= 3) {
      // Sem match mas aparece muito: vale a pena cadastrar
      alertas.push({
        id: gerarHashAlerta('passageiro_sem_funcionario', lista.map((a) => ({ tipo: 'Atendimento', id: a.id }))),
        severidade: 'baixo',
        tipo: 'passageiro_sem_funcionario',
        titulo: `Cadastrar ${exemplo.passageiro_nome} como funcionário?`,
        descricao: `${lista.length} demandas para este passageiro, mas não está cadastrado como funcionário. Cadastrar facilita relatórios.`,
        entidades: lista.map((a) => ({ tipo: 'Atendimento', id: a.id, nome: a.passageiro_nome })),
        sugestao_acao: 'Cadastrar como funcionário ou ignorar',
        detectado_em: new Date().toISOString(),
      })
    }
  }

  return alertas
}

/**
 * Detecta empresas sem código de cliente (impede match com importações)
 */
export function detectarEmpresasSemCodigo(empresas: Empresa[], atendimentos: Atendimento[]): AlertaInconsistencia[] {
  const alertas: AlertaInconsistencia[] = []
  for (const e of empresas) {
    if (!e.ativa) continue
    if (e.codigo_cliente && e.codigo_cliente.trim()) continue
    const qtdDemandas = atendimentos.filter((a) => a.empresa_id === e.id).length
    if (qtdDemandas === 0) continue // empresa sem demandas, não urge
    alertas.push({
      id: gerarHashAlerta('empresa_sem_codigo', [{ tipo: 'Empresa', id: e.id }]),
      severidade: 'medio',
      tipo: 'empresa_sem_codigo',
      titulo: `Empresa "${e.nome}" sem código de cliente`,
      descricao: `${qtdDemandas} demanda(s) vinculada(s). Sem código (ex: WAY153), o importador não consegue vincular automaticamente vendas a esta empresa.`,
      entidades: [{ tipo: 'Empresa', id: e.id, nome: e.nome }],
      sugestao_acao: 'Defina o código do cliente em Empresas > Editar',
      detectado_em: new Date().toISOString(),
    })
  }
  return alertas
}

/**
 * Detecta funcionários sem CPF (problema pra reconhecer voucher por CPF)
 */
export function detectarFuncionariosSemCPF(funcionarios: Funcionario[]): AlertaInconsistencia[] {
  const alertas: AlertaInconsistencia[] = []
  // Agrupar por empresa pra não inflar com 50 alertas
  const porEmpresa = new Map<string, Funcionario[]>()
  for (const f of funcionarios) {
    if (f.ativo === false) continue
    if (f.cpf && f.cpf.length === 11) continue
    if (!porEmpresa.has(f.company_id)) porEmpresa.set(f.company_id, [])
    porEmpresa.get(f.company_id)!.push(f)
  }
  for (const [empId, lista] of porEmpresa) {
    if (lista.length === 0) continue
    alertas.push({
      id: gerarHashAlerta('funcionario_sem_cpf', [{ tipo: 'Empresa', id: empId }]),
      severidade: 'baixo',
      tipo: 'funcionario_sem_cpf',
      titulo: `${lista.length} funcionário(s) sem CPF`,
      descricao: `Funcionários sem CPF não podem ser identificados automaticamente em vouchers/mensagens que tragam só o CPF.`,
      entidades: [{ tipo: 'Empresa', id: empId }, ...lista.slice(0, 5).map((f) => ({ tipo: 'Funcionario', id: f.id, nome: f.nome }))],
      sugestao_acao: 'Adicionar CPF aos cadastros mais usados',
      detectado_em: new Date().toISOString(),
    })
  }
  return alertas
}

/**
 * Detecta demandas atrasadas (check-in passou e ainda em em_andamento)
 */
export function detectarDemandasAtrasadas(atendimentos: Atendimento[]): AlertaInconsistencia[] {
  const alertas: AlertaInconsistencia[] = []
  const hoje = todayISODate()
  for (const a of atendimentos) {
    if (a.status !== 'em_andamento') continue
    let dataLimite: string | undefined
    if (a.tipo_servico === 'Hotel') dataLimite = a.detalhes_hotel?.data_checkout
    else if (a.tipo_servico === 'Aéreo') dataLimite = a.detalhes_aereo?.data_volta || a.detalhes_aereo?.data_ida
    if (!dataLimite) continue
    if (dataLimite < hoje) {
      alertas.push({
        id: gerarHashAlerta('demanda_atrasada', [{ tipo: 'Atendimento', id: a.id }]),
        severidade: 'alto',
        tipo: 'demanda_atrasada',
        titulo: `Demanda atrasada: ${a.passageiro_nome}`,
        descricao: `Status "em andamento" mas data de fim (${dataLimite}) já passou. Provavelmente deveria estar finalizado.`,
        entidades: [{ tipo: 'Atendimento', id: a.id, nome: a.passageiro_nome }],
        sugestao_acao: 'Atualizar status para "finalizado" ou "cancelado"',
        detectado_em: new Date().toISOString(),
      })
    }
  }
  return alertas
}

/**
 * Detecta demandas com valor zerado (esquecido?)
 */
export function detectarValoresZerados(atendimentos: Atendimento[]): AlertaInconsistencia[] {
  const alertas: AlertaInconsistencia[] = []
  for (const a of atendimentos) {
    if (a.status !== 'finalizado') continue
    const v = normalizarValor(a.valor_venda || a.valor_final || a.valor_cotacao || 0)
    if (v === 0) {
      alertas.push({
        id: gerarHashAlerta('valor_zerado', [{ tipo: 'Atendimento', id: a.id }]),
        severidade: 'medio',
        tipo: 'valor_zerado',
        titulo: `Demanda finalizada sem valor: ${a.passageiro_nome}`,
        descricao: 'Demanda marcada como finalizada mas valor está zerado. Não vai contar no faturamento.',
        entidades: [{ tipo: 'Atendimento', id: a.id, nome: a.passageiro_nome }],
        sugestao_acao: 'Adicionar valor de venda',
        detectado_em: new Date().toISOString(),
      })
    }
  }
  return alertas
}

// ============================================================
// EXECUTOR PRINCIPAL
// ============================================================

/**
 * Roda todos os detectores e atualiza a lista de alertas.
 * Preserva alertas marcados como resolvidos.
 */
export function executarReconciliacao(opts: {
  atendimentos: Atendimento[]
  empresas: Empresa[]
  funcionarios: Funcionario[]
}): AlertaInconsistencia[] {
  const todos: AlertaInconsistencia[] = [
    ...detectarVendasDuplicadas(opts.atendimentos),
    ...detectarDivergenciasValor(opts.atendimentos),
    ...detectarPassageirosSemFuncionario(opts.atendimentos, opts.funcionarios),
    ...detectarEmpresasSemCodigo(opts.empresas, opts.atendimentos),
    ...detectarFuncionariosSemCPF(opts.funcionarios),
    ...detectarDemandasAtrasadas(opts.atendimentos),
    ...detectarValoresZerados(opts.atendimentos),
  ]
  const resolvidos = loadResolvidos()
  // Filtra alertas resolvidos (cuja chave já foi marcada antes)
  const ativos = todos.filter((a) => !resolvidos.has(a.id))
  if (!saveAlertas(ativos)) {
    throw new Error('Não foi possível preparar os alertas da reconciliação para persistência.')
  }
  return ativos
}

export function getAlertas(): AlertaInconsistencia[] {
  return loadAlertas().sort((a, b) => {
    const ordem = { critico: 4, alto: 3, medio: 2, baixo: 1, info: 0 }
    return ordem[b.severidade] - ordem[a.severidade]
  })
}

export function resolverAlerta(alertaId: string, userId: string, userName: string) {
  const all = loadAlertas()
  const alerta = all.find((a) => a.id === alertaId)
  if (!alerta) return false
  alerta.resolvido = true
  alerta.resolvido_em = new Date().toISOString()
  alerta.resolvido_por = userName
  if (!saveAlertas(all.filter((a) => a.id !== alertaId))) return false
  // Marcar como resolvido permanentemente
  const set = loadResolvidos()
  set.add(alertaId)
  return saveResolvidos(set)
}

export function reabrirAlerta(alertaId: string): boolean {
  const set = loadResolvidos()
  set.delete(alertaId)
  return saveResolvidos(set)
}

export function contarAlertasPorSeveridade(): Record<SeveridadeAlerta, number> {
  const all = getAlertas()
  return {
    critico: all.filter((a) => a.severidade === 'critico').length,
    alto: all.filter((a) => a.severidade === 'alto').length,
    medio: all.filter((a) => a.severidade === 'medio').length,
    baixo: all.filter((a) => a.severidade === 'baixo').length,
    info: all.filter((a) => a.severidade === 'info').length,
  }
}

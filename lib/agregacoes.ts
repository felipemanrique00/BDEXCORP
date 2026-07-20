import { localDateToISODate, todayISODate } from '@/lib/date'
// ============================================================
// Agregações avançadas para o Dashboard / Relatórios.
// V8: novos cortes - série temporal, top N, comparativos.
// ============================================================
import type { Atendimento, TipoServico, Empresa, Funcionario } from '@/types'
import { calcularFinanceiro } from '@/types'
import { getAllAtendimentos, getAtendimentosFiltro, type FiltroAtendimento } from './atendimentos-storage'
import { chavePessoaRelatorio, resolverFuncionarioAtendimento } from '@/lib/funcionario-identidade'

/* ========== UTIL: normaliza data para YYYY-MM-DD ========== */
function dataDia(s: string | undefined | null): string {
  if (!s) return ''
  const t = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return t.slice(0, 10)
}

function dataMes(s: string): string { return dataDia(s).slice(0, 7) }

/* ========== SÉRIE TEMPORAL (por dia) ========== */
export interface PontoSerie {
  data: string         // YYYY-MM-DD
  label: string        // dd/mm
  demandas: number
  custo: number
  venda: number
  markup: number
  taxa: number
  faturado: number
}

/**
 * Gera série temporal por dia em um intervalo.
 * Inclui dias zerados (gráfico fica mais bonito assim).
 */
export function serieTemporalDiaria(filtro: FiltroAtendimento = {}): PontoSerie[] {
  const lista = getAtendimentosFiltro(filtro)
  if (lista.length === 0) return []

  const map = new Map<string, PontoSerie>()
  let minDia: string | undefined
  let maxDia: string | undefined

  lista.forEach((a) => {
    const d = dataDia(a.data_atendimento) || dataDia(a.created_at)
    if (!d) return
    if (!minDia || d < minDia) minDia = d
    if (!maxDia || d > maxDia) maxDia = d

    const calc = calcularFinanceiro(a)
    const cur = map.get(d) || {
      data: d, label: '', demandas: 0,
      custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0,
    }
    cur.demandas++
    cur.custo += calc.custo
    cur.venda += calc.venda
    cur.markup += calc.markup
    cur.taxa += calc.taxa_valor
    cur.faturado += calc.total_faturado
    map.set(d, cur)
  })

  // Honra filtros explícitos quando passados (preenche dias zerados no range)
  if (filtro.data_inicio) minDia = dataDia(filtro.data_inicio)
  if (filtro.data_fim) maxDia = dataDia(filtro.data_fim)

  if (!minDia || !maxDia) return []

  const inicio = new Date(minDia + 'T00:00:00')
  const fim = new Date(maxDia + 'T00:00:00')
  const dias: PontoSerie[] = []
  for (let d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
    const iso = localDateToISODate(d)
    const ponto = map.get(iso) || {
      data: iso, label: '', demandas: 0,
      custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0,
    }
    ponto.label = `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
    dias.push(ponto)
  }
  return dias
}

/* ========== TOP EMPRESAS ========== */
export interface RankingEmpresa {
  empresa_id: string
  empresa_nome: string
  demandas: number
  finalizadas: number
  custo: number
  venda: number
  markup: number
  taxa: number
  faturado: number
  margem_pct: number
  ticket_medio: number
  /** Composição por tipo de serviço (qtd) */
  por_tipo: Record<TipoServico, number>
}

export function rankingEmpresas(
  empresas: Empresa[],
  filtro: FiltroAtendimento = {}
): RankingEmpresa[] {
  const base = getAtendimentosFiltro(filtro)
  const map = new Map<string, RankingEmpresa>()

  base.forEach((a) => {
    const calc = calcularFinanceiro(a)
    const empresaNome = empresas.find((e) => e.id === a.empresa_id)?.nome || '—'
    const cur = map.get(a.empresa_id) || {
      empresa_id: a.empresa_id,
      empresa_nome: empresaNome,
      demandas: 0, finalizadas: 0,
      custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0,
      margem_pct: 0, ticket_medio: 0,
      por_tipo: { 'Aéreo': 0, 'Hotel': 0, 'Carro': 0, 'Pacote': 0, 'Outro': 0 } as Record<TipoServico, number>,
    }
    cur.demandas++
    if (a.status === 'finalizado') cur.finalizadas++
    cur.custo += calc.custo
    cur.venda += calc.venda
    cur.markup += calc.markup
    cur.taxa += calc.taxa_valor
    cur.faturado += calc.total_faturado
    if (cur.por_tipo[a.tipo_servico] !== undefined) cur.por_tipo[a.tipo_servico]++
    map.set(a.empresa_id, cur)
  })

  const out: RankingEmpresa[] = []
  map.forEach((v) => {
    v.margem_pct = v.venda > 0 ? (v.markup / v.venda) * 100 : 0
    v.ticket_medio = v.demandas > 0 ? v.faturado / v.demandas : 0
    out.push(v)
  })
  return out.sort((a, b) => b.faturado - a.faturado)
}

/* ========== TOP AGENTES ========== */
export interface RankingAgente {
  agente_user_id: string
  demandas: number
  finalizadas: number
  canceladas: number
  em_andamento: number
  taxa_conversao_pct: number
  custo: number
  venda: number
  markup: number
  taxa: number
  faturado: number
  ticket_medio: number
  tempo_medio_horas: number       // tempo médio criar->finalizar
  por_tipo: Record<TipoServico, number>
}

export function rankingAgentes(filtro: FiltroAtendimento = {}): RankingAgente[] {
  const base = getAtendimentosFiltro(filtro)
  const map = new Map<string, RankingAgente>()

  base.forEach((a) => {
    if (!a.agente_user_id) return
    const calc = calcularFinanceiro(a)
    const cur = map.get(a.agente_user_id) || {
      agente_user_id: a.agente_user_id,
      demandas: 0, finalizadas: 0, canceladas: 0, em_andamento: 0,
      taxa_conversao_pct: 0,
      custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0,
      ticket_medio: 0, tempo_medio_horas: 0,
      por_tipo: { 'Aéreo': 0, 'Hotel': 0, 'Carro': 0, 'Pacote': 0, 'Outro': 0 } as Record<TipoServico, number>,
    }
    cur.demandas++
    if (a.status === 'finalizado') cur.finalizadas++
    if (a.status === 'cancelado') cur.canceladas++
    if (a.status === 'em_andamento') cur.em_andamento++
    cur.custo += calc.custo
    cur.venda += calc.venda
    cur.markup += calc.markup
    cur.taxa += calc.taxa_valor
    cur.faturado += calc.total_faturado
    if (cur.por_tipo[a.tipo_servico] !== undefined) cur.por_tipo[a.tipo_servico]++

    // Tempo médio: created_at -> finalizado_em
    if (a.status === 'finalizado' && a.finalizado_em && a.created_at) {
      const t1 = new Date(a.created_at).getTime()
      const t2 = new Date(a.finalizado_em).getTime()
      if (t2 > t1) {
        const horas = (t2 - t1) / 3600000
        // Soma na propriedade temporariamente, divide depois
        ;(cur as any)._somaHoras = ((cur as any)._somaHoras || 0) + horas
        ;(cur as any)._countHoras = ((cur as any)._countHoras || 0) + 1
      }
    }

    map.set(a.agente_user_id, cur)
  })

  const out: RankingAgente[] = []
  map.forEach((v) => {
    v.taxa_conversao_pct = v.demandas > 0 ? (v.finalizadas / v.demandas) * 100 : 0
    v.ticket_medio = v.demandas > 0 ? v.faturado / v.demandas : 0
    const sh = (v as any)._somaHoras || 0
    const ch = (v as any)._countHoras || 0
    v.tempo_medio_horas = ch > 0 ? sh / ch : 0
    delete (v as any)._somaHoras
    delete (v as any)._countHoras
    out.push(v)
  })
  return out.sort((a, b) => b.faturado - a.faturado)
}

/* ========== COMPARATIVO MES vs MES ANTERIOR ========== */
export interface Comparativo {
  atual: { demandas: number; faturado: number; markup: number }
  anterior: { demandas: number; faturado: number; markup: number }
  delta_demandas_pct: number
  delta_faturado_pct: number
  delta_markup_pct: number
}

export function comparativoMesAnterior(): Comparativo {
  const hoje = new Date()
  const inicioAtual = localDateToISODate(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const fimAtual = todayISODate()
  const inicioAnt = localDateToISODate(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1))
  const fimAnt = localDateToISODate(new Date(hoje.getFullYear(), hoje.getMonth(), 0))

  const atendsAtual = getAtendimentosFiltro({ data_inicio: inicioAtual, data_fim: fimAtual })
  const atendsAnt = getAtendimentosFiltro({ data_inicio: inicioAnt, data_fim: fimAnt })

  const totaliza = (lista: Atendimento[]) => {
    let faturado = 0, markup = 0
    lista.forEach((a) => {
      const c = calcularFinanceiro(a)
      faturado += c.total_faturado
      markup += c.markup
    })
    return { demandas: lista.length, faturado, markup }
  }

  const atual = totaliza(atendsAtual)
  const anterior = totaliza(atendsAnt)

  const delta = (a: number, b: number) => b > 0 ? ((a - b) / b) * 100 : (a > 0 ? 100 : 0)

  return {
    atual, anterior,
    delta_demandas_pct: delta(atual.demandas, anterior.demandas),
    delta_faturado_pct: delta(atual.faturado, anterior.faturado),
    delta_markup_pct: delta(atual.markup, anterior.markup),
  }
}

/* ========== DEMANDAS URGENTES EM ABERTO ========== */
export function demandasUrgentesAbertas(): Atendimento[] {
  return getAllAtendimentos().filter((a) =>
    ['em_andamento', 'aguardando_cliente', 'pendente'].includes(a.status)
    && (a.prioridade === 'urgente' || a.prioridade === 'alta')
  ).sort((a, b) => {
    if (a.prioridade === 'urgente' && b.prioridade !== 'urgente') return -1
    if (b.prioridade === 'urgente' && a.prioridade !== 'urgente') return 1
    return b.created_at.localeCompare(a.created_at)
  })
}

/* ========== TOP HOTÉIS USADOS POR EMPRESA ========== */
export function topHoteisPorEmpresa(empresaId: string, limit = 5): { hotel: string; total: number; cidade?: string }[] {
  const lista = getAtendimentosFiltro({ empresa_id: empresaId, tipo_servico: 'Hotel' })
  const map = new Map<string, { hotel: string; total: number; cidade?: string }>()
  lista.forEach((a) => {
    const h = a.detalhes_hotel?.hotel_nome
    if (!h) return
    const key = h.toLowerCase().trim()
    const cur = map.get(key) || { hotel: h, total: 0, cidade: a.detalhes_hotel?.cidade }
    cur.total++
    map.set(key, cur)
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, limit)
}

/* ========== TOP FUNCIONÁRIOS QUE MAIS VIAJAM ========== */
export function topFuncionariosViajantes(empresaId: string, limit = 5, funcionarios: Funcionario[] = []): { funcionario_id: string | null; nome: string; total: number; faturado: number }[] {
  const lista = getAtendimentosFiltro({ empresa_id: empresaId })
  const map = new Map<string, { funcionario_id: string | null; nome: string; total: number; faturado: number }>()
  lista.forEach((a) => {
    const funcionario = resolverFuncionarioAtendimento(a, funcionarios, 84)
    const key = chavePessoaRelatorio(a, funcionario)
    if (!key) return
    const calc = calcularFinanceiro(a)
    const cur = map.get(key) || { funcionario_id: funcionario?.id || a.funcionario_id, nome: funcionario?.nome || a.passageiro_nome, total: 0, faturado: 0 }
    cur.total++
    cur.faturado += calc.total_faturado
    map.set(key, cur)
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, limit)
}

/* ========== HISTÓRICO DE VIAGENS DE UM FUNCIONÁRIO ========== */
export interface ViagemFuncionario {
  atendimento_id: string
  data: string
  tipo: TipoServico
  destino?: string
  status: string
  faturado: number
  proxima?: boolean
}

export function historicoViagensFuncionario(funcionarioId: string, nomePassageiro?: string, funcionarios: Funcionario[] = []): ViagemFuncionario[] {
  const all = getAllAtendimentos()
  const lista = all.filter((a) => {
    if (a.funcionario_id === funcionarioId) return true
    if (resolverFuncionarioAtendimento(a, funcionarios, 84)?.id === funcionarioId) return true
    if (nomePassageiro && a.passageiro_nome.toLowerCase().trim() === nomePassageiro.toLowerCase().trim()) return true
    return false
  })

  const hoje = todayISODate()
  return lista.map((a) => {
    const calc = calcularFinanceiro(a)
    let destino: string | undefined
    let dataReferencia: string = a.data_atendimento || a.created_at.slice(0, 10)
    if (a.tipo_servico === 'Hotel') {
      destino = a.detalhes_hotel?.cidade
      if (a.detalhes_hotel?.data_checkin) dataReferencia = a.detalhes_hotel.data_checkin
    } else if (a.tipo_servico === 'Aéreo') {
      destino = a.detalhes_aereo?.destino
      if (a.detalhes_aereo?.data_ida) dataReferencia = a.detalhes_aereo.data_ida
    } else if (a.tipo_servico === 'Carro') {
      destino = a.detalhes_carro?.cidade_retirada
      if (a.detalhes_carro?.data_retirada) dataReferencia = a.detalhes_carro.data_retirada
    } else if (a.tipo_servico === 'Pacote') {
      destino = a.detalhes_pacote?.destino
      if (a.detalhes_pacote?.data_ida) dataReferencia = a.detalhes_pacote.data_ida
    }
    const dataNorm = dataDia(dataReferencia)
    return {
      atendimento_id: a.id,
      data: dataNorm,
      tipo: a.tipo_servico,
      destino,
      status: a.status,
      faturado: calc.total_faturado,
      proxima: dataNorm > hoje && (a.status === 'em_andamento' || a.status === 'aguardando_cliente'),
    }
  }).sort((a, b) => b.data.localeCompare(a.data))
}

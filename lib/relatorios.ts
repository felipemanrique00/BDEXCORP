import type { Atendimento, Empresa, Funcionario, StatusAtendimento, TipoServico } from '@/types'
import { calcularFinanceiro } from '@/types'
import { calcularPegadaAtendimento } from '@/lib/esg-carbon'
import { chavePessoaRelatorio, resolverFuncionarioAtendimento } from '@/lib/funcionario-identidade'

export type VisaoRelatorio = 'cliente' | 'agencia'

export type CategoriaRelatorio = {
  tipo: TipoServico
  quantidade: number
  custo: number
  venda: number
  markup: number
  taxa: number
  faturado: number
}

export type FonteReferenciaEconomia =
  | 'preco_sem_agencia'
  | 'cotacao_original'
  | 'tarifa_publica'
  | 'contrato'
  | 'outro'
  | 'benchmark_rota'
  | 'benchmark_categoria'
  | 'sem_referencia'

export type LinhaDetalheRelatorio = {
  id: string
  data: string
  passageiro: string
  funcionarioId?: string | null
  funcionarioCodigo?: string
  passageiroChave?: string
  nomeInformadoNaReserva?: string
  empresa?: string
  tipo: TipoServico
  localizador: string
  fornecedor: string
  destino: string
  centroCusto?: string
  solicitante?: string
  formaPagamento?: Atendimento['forma_pagamento']
  status: StatusAtendimento
  custo: number
  venda: number
  markup: number
  taxa: number
  total: number
  valorReferencia: number
  referenciaFonte: FonteReferenciaEconomia
  economia: number
  oportunidadeEconomia: number
  antecedenciaDias: number | null
  co2Kg: number
  pendencias: string[]
  rota?: string
  cidade?: string
  dataServico?: string
  dataCompra?: string
  companhia?: string
  bilhete?: string
  produto?: string
  tarifa?: number
  taxasServico?: number
  servicoResumo: string
  servicoDetalhes: Array<{ label: string; value: string }>
}

export type EconomiaRelatorio = {
  valorReferenciaTotal: number
  valorFinalTotal: number
  economiaTotal: number
  economiaCotacao: number
  economiaBenchmark: number
  oportunidadeTotal: number
  percentualEconomia: number
  itensComparados: number
  itensComEconomia: number
  itensComOportunidade: number
}

export type RankingRelatorio = {
  nome: string
  quantidade: number
  total: number
  economia: number
  oportunidade: number
}

export type RankingOperacionalRelatorio = RankingRelatorio & {
  media: number
}

export type SerieTemporalRelatorio = {
  periodo: string
  quantidade: number
  total: number
  economia: number
}

export type GovernancaRelatorio = {
  taxaCompletude: number
  taxaCentroCusto: number
  taxaPagamento: number
  taxaSolicitante: number
  taxaFinalizacao: number
  reservasUrgentes: number
  antecedenciaMediaDias: number
  pendencias: Array<{ label: string; quantidade: number }>
}

export type AnaliseRelatorio = {
  governanca: GovernancaRelatorio
  topCentrosCusto: RankingRelatorio[]
  topViajantes: RankingRelatorio[]
  topFornecedores: RankingRelatorio[]
  serieTemporal: SerieTemporalRelatorio[]
  co2TotalKg: number
  coberturaBenchmarkPct: number
  insights: string[]
}

export type RelatorioOperacional = {
  porEmpresa: RankingOperacionalRelatorio[]
  porServico: RankingOperacionalRelatorio[]
  porCentroCusto: RankingOperacionalRelatorio[]
  porCidade: RankingOperacionalRelatorio[]
  porRota: RankingOperacionalRelatorio[]
  porFornecedor: RankingOperacionalRelatorio[]
  porDiaSemana: RankingOperacionalRelatorio[]
  porAntecedencia: RankingOperacionalRelatorio[]
  aereo: {
    topRotas: RankingOperacionalRelatorio[]
    topCompanhias: RankingOperacionalRelatorio[]
    topPassageiros: RankingOperacionalRelatorio[]
  }
  hotel: {
    topHoteis: RankingOperacionalRelatorio[]
    topHospedes: RankingOperacionalRelatorio[]
    topCidades: RankingOperacionalRelatorio[]
  }
  carro: {
    topLocadoras: RankingOperacionalRelatorio[]
    diariaPorDiaSemana: RankingOperacionalRelatorio[]
    antecedencia: RankingOperacionalRelatorio[]
  }
  outros: {
    topProdutos: RankingOperacionalRelatorio[]
    topPassageiros: RankingOperacionalRelatorio[]
    topCidades: RankingOperacionalRelatorio[]
  }
}

export type MetricasRelatorio = {
  total: number
  porStatus: Record<StatusAtendimento, number>
  categorias: CategoriaRelatorio[]
  custoTotal: number
  vendaTotal: number
  markupTotal: number
  taxaTotal: number
  faturadoTotal: number
  margemMediaPct: number
  economia: EconomiaRelatorio
  analise: AnaliseRelatorio
}

const TIPOS: TipoServico[] = ['Aéreo', 'Hotel', 'Carro', 'Pacote', 'Outro']
const MIN_BENCHMARK_ITEMS = 3

type BenchmarkContext = {
  rota: Map<string, number>
  categoria: Map<TipoServico, number>
}

export function montarMetricasRelatorio(atendimentos: Atendimento[], funcionarios: Funcionario[] = []): MetricasRelatorio {
  const linhas = montarLinhasDetalhe(atendimentos, undefined, funcionarios)
  const porStatus: Record<StatusAtendimento, number> = {
    em_andamento: 0,
    aguardando_cliente: 0,
    finalizado: 0,
    cancelado: 0,
    pendente: 0,
  }

  const categorias = TIPOS.reduce((acc, tipo) => {
    acc[tipo] = { tipo, quantidade: 0, custo: 0, venda: 0, markup: 0, taxa: 0, faturado: 0 }
    return acc
  }, {} as Record<TipoServico, CategoriaRelatorio>)

  let custoTotal = 0
  let vendaTotal = 0
  let markupTotal = 0
  let taxaTotal = 0

  atendimentos.forEach((atendimento) => {
    const calc = calcularFinanceiro(atendimento)
    if (porStatus[atendimento.status] !== undefined) porStatus[atendimento.status] += 1

    const categoria = categorias[atendimento.tipo_servico]
    if (categoria) {
      categoria.quantidade += 1
      categoria.custo += calc.custo
      categoria.venda += calc.venda
      categoria.markup += calc.markup
      categoria.taxa += calc.taxa_valor
      categoria.faturado += calc.total_faturado
    }

    custoTotal += calc.custo
    vendaTotal += calc.venda
    markupTotal += calc.markup
    taxaTotal += calc.taxa_valor
  })

  const faturadoTotal = vendaTotal + taxaTotal
  const economia = montarEconomia(linhas, faturadoTotal)

  return {
    total: atendimentos.length,
    porStatus,
    categorias: Object.values(categorias),
    custoTotal,
    vendaTotal,
    markupTotal,
    taxaTotal,
    faturadoTotal,
    margemMediaPct: vendaTotal > 0 ? (markupTotal / vendaTotal) * 100 : 0,
    economia,
    analise: montarAnalise(linhas, atendimentos.length, porStatus),
  }
}

export function montarLinhasDetalhe(
  atendimentos: Atendimento[],
  empresaNomePorId?: Map<string, string>,
  funcionarios: Funcionario[] = [],
): LinhaDetalheRelatorio[] {
  const benchmark = montarBenchmark(atendimentos)
  const funcionariosEscopo = funcionarios

  return atendimentos.map((atendimento) => {
    const funcionario = resolverFuncionarioAtendimento(atendimento, funcionariosEscopo, 84)
    const calc = calcularFinanceiro(atendimento)
    const fornecedor = getFornecedor(atendimento)
    const destino = getDestino(atendimento)
    const referencia = resolverReferenciaEconomia(atendimento, calc.total_faturado)
    const economia = referencia.valor > 0 ? Math.max(0, referencia.valor - calc.total_faturado) : 0
    const oportunidadeEconomia = resolverOportunidadeEconomia(atendimento, calc.total_faturado, referencia.valor, benchmark)
    const pegada = calcularPegadaAtendimento(atendimento)

    return {
      id: atendimento.id,
      data: normalizarData(atendimento.data_atendimento || atendimento.created_at),
      passageiro: funcionario?.nome || atendimento.passageiro_nome,
      funcionarioId: funcionario?.id || atendimento.funcionario_id || null,
      funcionarioCodigo: funcionario?.codigo_identificacao,
      passageiroChave: chavePessoaRelatorio(atendimento, funcionario),
      nomeInformadoNaReserva: funcionario && atendimento.passageiro_nome && atendimento.passageiro_nome !== funcionario.nome ? atendimento.passageiro_nome : undefined,
      empresa: empresaNomePorId?.get(atendimento.empresa_id),
      tipo: atendimento.tipo_servico,
      localizador: getLocalizador(atendimento),
      fornecedor,
      destino,
      centroCusto: atendimento.centro_custo,
      solicitante: atendimento.solicitante_nome,
      formaPagamento: atendimento.forma_pagamento,
      status: atendimento.status,
      custo: calc.custo,
      venda: calc.venda,
      markup: calc.markup,
      taxa: calc.taxa_valor,
      total: calc.total_faturado,
      valorReferencia: referencia.valor,
      referenciaFonte: referencia.fonte,
      economia,
      oportunidadeEconomia,
      antecedenciaDias: calcularAntecedenciaDias(atendimento),
      co2Kg: pegada?.kg_co2 || 0,
      pendencias: pendenciasOperacionais(atendimento),
      rota: getRota(atendimento),
      cidade: getCidade(atendimento),
      dataServico: getDataInicioServico(atendimento),
      dataCompra: getDataCompra(atendimento),
      companhia: getCompanhia(atendimento),
      bilhete: getBilhete(atendimento),
      produto: getProduto(atendimento),
      tarifa: getNumberFromWintour(atendimento, ['total_tarifa', 'tarifa']) || atendimento.detalhes_aereo?.tarifa,
      taxasServico: getNumberFromWintour(atendimento, ['total_taxa', 'taxa_emb', 'taxas']) || atendimento.detalhes_aereo?.taxas,
      servicoResumo: getServicoResumo(atendimento),
      servicoDetalhes: getServicoDetalhes(atendimento),
    }
  })
}

export function montarRelatorioOperacional(
  atendimentos: Atendimento[],
  empresas: Empresa[] = [],
  funcionarios: Funcionario[] = [],
): RelatorioOperacional {
  const empresaNomePorId = new Map(empresas.map((empresa) => [empresa.id, empresa.nome]))
  const linhas = montarLinhasDetalhe(atendimentos, empresaNomePorId, funcionarios)
  const aereo = linhas.filter((linha) => linha.tipo === 'Aéreo')
  const hotel = linhas.filter((linha) => linha.tipo === 'Hotel')
  const carro = linhas.filter((linha) => linha.tipo === 'Carro')
  const outros = linhas.filter((linha) => linha.tipo === 'Outro' || linha.tipo === 'Pacote')

  return {
    porEmpresa: rankingOperacional(linhas, (linha) => linha.empresa || 'Empresa nao identificada'),
    porServico: rankingOperacional(linhas, (linha) => linha.tipo),
    porCentroCusto: rankingOperacional(linhas, (linha) => linha.centroCusto || 'Sem centro de custo'),
    porCidade: rankingOperacional(linhas, (linha) => linha.cidade || linha.destino || 'Cidade nao informada'),
    porRota: rankingOperacional(linhas, (linha) => linha.rota || linha.destino || 'Rota nao informada'),
    porFornecedor: rankingOperacional(linhas, (linha) => linha.fornecedor || 'Fornecedor nao informado'),
    porDiaSemana: rankingOperacional(linhas, (linha) => diaSemana(linha.dataServico || linha.data)),
    porAntecedencia: rankingOperacional(linhas, (linha) => bucketAntecedencia(linha.antecedenciaDias)),
    aereo: {
      topRotas: rankingOperacional(aereo, (linha) => linha.rota || linha.destino || 'Rota nao informada'),
      topCompanhias: rankingOperacional(aereo, (linha) => linha.companhia || linha.fornecedor || 'Companhia nao informada'),
      topPassageiros: rankingOperacional(aereo, (linha) => linha.passageiro || 'Passageiro nao informado', 10, (linha) => linha.passageiroChave || linha.passageiro),
    },
    hotel: {
      topHoteis: rankingOperacional(hotel, (linha) => linha.fornecedor || 'Hotel nao informado'),
      topHospedes: rankingOperacional(hotel, (linha) => linha.passageiro || 'Hospede nao informado', 10, (linha) => linha.passageiroChave || linha.passageiro),
      topCidades: rankingOperacional(hotel, (linha) => linha.cidade || linha.destino || 'Cidade nao informada'),
    },
    carro: {
      topLocadoras: rankingOperacional(carro, (linha) => linha.fornecedor || 'Locadora nao informada'),
      diariaPorDiaSemana: rankingOperacional(carro, (linha) => diaSemana(linha.dataServico || linha.data)),
      antecedencia: rankingOperacional(carro, (linha) => bucketAntecedencia(linha.antecedenciaDias)),
    },
    outros: {
      topProdutos: rankingOperacional(outros, (linha) => linha.produto || linha.fornecedor || linha.tipo),
      topPassageiros: rankingOperacional(outros, (linha) => linha.passageiro || 'Passageiro nao informado', 10, (linha) => linha.passageiroChave || linha.passageiro),
      topCidades: rankingOperacional(outros, (linha) => linha.cidade || linha.destino || 'Cidade nao informada'),
    },
  }
}

export function valorFinalCliente(atendimento: Atendimento): number {
  return calcularFinanceiro(atendimento).total_faturado
}

export function valorReferenciaEconomia(atendimento: Atendimento): number {
  const final = valorFinalCliente(atendimento)
  return resolverReferenciaEconomia(atendimento, final).valor
}

export function filtrarPeriodo(atendimentos: Atendimento[], inicio: string, fim: string): Atendimento[] {
  const ini = normalizarData(inicio)
  const dataFim = normalizarData(fim)
  return atendimentos.filter((atendimento) => {
    const data = normalizarData(atendimento.data_atendimento || atendimento.created_at)
    return (!ini || data >= ini) && (!dataFim || data <= dataFim)
  })
}

export function countUniqueTravelers(atendimentos: Atendimento[], funcionarios: Funcionario[] = []): number {
  const chaves = atendimentos
    .map((atendimento) => chavePessoaRelatorio(atendimento, resolverFuncionarioAtendimento(atendimento, funcionarios, 84)))
    .filter(Boolean)
  return new Set(chaves).size
}

export function countDaysInclusive(inicio: string, fim: string): number {
  const start = new Date(`${inicio}T00:00:00`)
  const end = new Date(`${fim}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, diff + 1)
}

export function normalizarCentroCusto(centro?: string | null): string {
  return String(centro || '').trim().toLocaleLowerCase('pt-BR')
}

export function getLocalizador(atendimento: Atendimento): string {
  return (
    atendimento.detalhes_aereo?.localizador ||
    atendimento.detalhes_hotel?.localizador ||
    atendimento.detalhes_carro?.localizador ||
    atendimento.detalhes_pacote?.localizador ||
    atendimento.serial_os ||
    '-'
  )
}

function montarEconomia(linhas: LinhaDetalheRelatorio[], faturadoTotal: number): EconomiaRelatorio {
  const valorReferenciaTotal = linhas.reduce((sum, item) => sum + item.valorReferencia, 0)
  const economiaTotal = linhas.reduce((sum, item) => sum + item.economia, 0)
  const economiaCotacao = linhas
    .filter((item) => item.referenciaFonte !== 'sem_referencia' && item.referenciaFonte !== 'benchmark_rota' && item.referenciaFonte !== 'benchmark_categoria')
    .reduce((sum, item) => sum + item.economia, 0)
  const economiaBenchmark = linhas
    .filter((item) => item.referenciaFonte === 'benchmark_rota' || item.referenciaFonte === 'benchmark_categoria')
    .reduce((sum, item) => sum + item.economia, 0)
  const oportunidadeTotal = linhas.reduce((sum, item) => sum + item.oportunidadeEconomia, 0)

  return {
    valorReferenciaTotal,
    valorFinalTotal: faturadoTotal,
    economiaTotal,
    economiaCotacao,
    economiaBenchmark,
    oportunidadeTotal,
    percentualEconomia: valorReferenciaTotal > 0 ? (economiaTotal / valorReferenciaTotal) * 100 : 0,
    itensComparados: linhas.filter((item) => item.valorReferencia > 0).length,
    itensComEconomia: linhas.filter((item) => item.economia > 0).length,
    itensComOportunidade: linhas.filter((item) => item.oportunidadeEconomia > 0).length,
  }
}

function montarAnalise(
  linhas: LinhaDetalheRelatorio[],
  total: number,
  porStatus: Record<StatusAtendimento, number>,
): AnaliseRelatorio {
  const linhasComReferencia = linhas.filter((item) => item.valorReferencia > 0).length
  const antecedencias = linhas
    .map((item) => item.antecedenciaDias)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const reservasUrgentes = linhas.filter((item) => typeof item.antecedenciaDias === 'number' && item.antecedenciaDias <= 2).length
  const pendencias = [
    { label: 'Sem centro de custo', quantidade: linhas.filter((item) => item.pendencias.includes('centro_custo')).length },
    { label: 'Sem forma de pagamento', quantidade: linhas.filter((item) => item.pendencias.includes('pagamento')).length },
    { label: 'Sem solicitante/autorizador', quantidade: linhas.filter((item) => item.pendencias.includes('solicitante')).length },
    { label: 'Reserva urgente', quantidade: reservasUrgentes },
  ]

  const governanca: GovernancaRelatorio = {
    taxaCompletude: taxa(linhas.filter((item) => item.pendencias.length === 0).length, total),
    taxaCentroCusto: taxa(linhas.filter((item) => !item.pendencias.includes('centro_custo')).length, total),
    taxaPagamento: taxa(linhas.filter((item) => !item.pendencias.includes('pagamento')).length, total),
    taxaSolicitante: taxa(linhas.filter((item) => !item.pendencias.includes('solicitante')).length, total),
    taxaFinalizacao: taxa(porStatus.finalizado, total),
    reservasUrgentes,
    antecedenciaMediaDias: media(antecedencias),
    pendencias,
  }

  const insights = gerarInsights(linhas, governanca)

  return {
    governanca,
    topCentrosCusto: ranking(linhas, (item) => item.centroCusto || 'Sem centro de custo'),
    topViajantes: ranking(linhas, (item) => item.passageiro || 'Passageiro nao informado', (item) => item.passageiroChave || item.passageiro),
    topFornecedores: ranking(linhas, (item) => item.fornecedor || 'Fornecedor nao informado'),
    serieTemporal: serieTemporal(linhas),
    co2TotalKg: linhas.reduce((sum, item) => sum + item.co2Kg, 0),
    coberturaBenchmarkPct: taxa(linhasComReferencia, total),
    insights,
  }
}

function montarBenchmark(atendimentos: Atendimento[]): BenchmarkContext {
  const porRota = new Map<string, number[]>()
  const porCategoria = new Map<TipoServico, number[]>()

  atendimentos.forEach((atendimento) => {
    const total = calcularFinanceiro(atendimento).total_faturado
    if (total <= 0 || atendimento.status === 'cancelado') return
    const rotaKey = benchmarkKey(atendimento)
    if (rotaKey) {
      const arr = porRota.get(rotaKey) || []
      arr.push(total)
      porRota.set(rotaKey, arr)
    }
    const cat = porCategoria.get(atendimento.tipo_servico) || []
    cat.push(total)
    porCategoria.set(atendimento.tipo_servico, cat)
  })

  return {
    rota: new Map(Array.from(porRota.entries()).filter(([, values]) => values.length >= MIN_BENCHMARK_ITEMS).map(([key, values]) => [key, percentil(values, 0.75)])),
    categoria: new Map(Array.from(porCategoria.entries()).filter(([, values]) => values.length >= MIN_BENCHMARK_ITEMS).map(([key, values]) => [key, percentil(values, 0.75)])),
  }
}

function resolverReferenciaEconomia(
  atendimento: Atendimento,
  final: number,
): { valor: number; fonte: FonteReferenciaEconomia } {
  const referenciaExplicita = Number(atendimento.valor_referencia_economia || 0)
  if (referenciaExplicita > 0) {
    return {
      valor: referenciaExplicita,
      fonte: atendimento.fonte_referencia_economia || 'preco_sem_agencia',
    }
  }

  const cotacao = Number(atendimento.valor_cotacao || 0)
  if (cotacao > final + 0.99) return { valor: cotacao, fonte: 'cotacao_original' }

  return { valor: 0, fonte: 'sem_referencia' }
}

function resolverOportunidadeEconomia(
  atendimento: Atendimento,
  final: number,
  referenciaCotacao: number,
  benchmark: BenchmarkContext,
): number {
  if (referenciaCotacao > 0) {
    return referenciaCotacao < final - 0.99 ? final - referenciaCotacao : 0
  }

  const rotaKey = benchmarkKey(atendimento)
  const rota = rotaKey ? benchmark.rota.get(rotaKey) || 0 : 0
  if (rota > 0 && rota < final - 0.99) return final - rota

  const categoria = benchmark.categoria.get(atendimento.tipo_servico) || 0
  if (categoria > 0 && categoria < final - 0.99) return final - categoria

  return 0
}

function ranking(
  linhas: LinhaDetalheRelatorio[],
  labelFn: (item: LinhaDetalheRelatorio) => string,
  keyFn: (item: LinhaDetalheRelatorio) => string = labelFn,
): RankingRelatorio[] {
  const map = new Map<string, RankingRelatorio>()
  linhas.forEach((item) => {
    const chave = keyFn(item).trim() || labelFn(item).trim() || 'Nao informado'
    const nome = labelFn(item).trim() || 'Nao informado'
    const current = map.get(chave) || { nome, quantidade: 0, total: 0, economia: 0, oportunidade: 0 }
    current.quantidade += 1
    current.total += item.total
    current.economia += item.economia
    current.oportunidade += item.oportunidadeEconomia
    map.set(chave, current)
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 8)
}

function rankingOperacional(
  linhas: LinhaDetalheRelatorio[],
  labelFn: (item: LinhaDetalheRelatorio) => string,
  limit = 10,
  keyFn: (item: LinhaDetalheRelatorio) => string = labelFn,
): RankingOperacionalRelatorio[] {
  const map = new Map<string, RankingOperacionalRelatorio>()
  linhas.forEach((item) => {
    const chave = keyFn(item).trim() || labelFn(item).trim() || 'Nao informado'
    const nome = labelFn(item).trim() || 'Nao informado'
    const current = map.get(chave) || { nome, quantidade: 0, total: 0, economia: 0, oportunidade: 0, media: 0 }
    current.quantidade += 1
    current.total += item.total
    current.economia += item.economia
    current.oportunidade += item.oportunidadeEconomia
    current.media = current.quantidade > 0 ? current.total / current.quantidade : 0
    map.set(chave, current)
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, limit)
}

function serieTemporal(linhas: LinhaDetalheRelatorio[]): SerieTemporalRelatorio[] {
  const map = new Map<string, SerieTemporalRelatorio>()
  linhas.forEach((item) => {
    const periodo = item.data ? item.data.slice(0, 7) : 'sem-data'
    const current = map.get(periodo) || { periodo, quantidade: 0, total: 0, economia: 0 }
    current.quantidade += 1
    current.total += item.total
    current.economia += item.economia
    map.set(periodo, current)
  })
  return Array.from(map.values()).sort((a, b) => a.periodo.localeCompare(b.periodo))
}

function gerarInsights(linhas: LinhaDetalheRelatorio[], governanca: GovernancaRelatorio): string[] {
  const insights: string[] = []
  const total = linhas.reduce((sum, item) => sum + item.total, 0)
  const economia = linhas.reduce((sum, item) => sum + item.economia, 0)
  const oportunidade = linhas.reduce((sum, item) => sum + item.oportunidadeEconomia, 0)
  const topTipo = ranking(linhas, (item) => item.tipo)[0]
  const topCentro = ranking(linhas, (item) => item.centroCusto || 'Sem centro de custo')[0]

  if (economia > 0) insights.push(`Economia registrada de ${percent(economia, total + economia)} sobre itens com cotacao/orcamento original.`)
  if (oportunidade > 0) insights.push(`Ha oportunidade de reduzir gastos em itens acima do benchmark interno.`)
  if (topTipo) insights.push(`${topTipo.nome} concentra ${percent(topTipo.total, total)} do gasto no periodo.`)
  if (topCentro && topCentro.nome !== 'Sem centro de custo') insights.push(`Centro de custo com maior impacto: ${topCentro.nome}.`)
  if (governanca.reservasUrgentes > 0) insights.push(`${governanca.reservasUrgentes} demanda(s) foram registradas com ate 2 dias de antecedencia.`)
  if (governanca.taxaCompletude < 85) insights.push('Cadastro operacional incompleto reduz a qualidade do BI; priorize centro de custo, pagamento e solicitante.')

  return insights.slice(0, 5)
}

function pendenciasOperacionais(atendimento: Atendimento): string[] {
  const pendencias: string[] = []
  if (!String(atendimento.centro_custo || '').trim()) pendencias.push('centro_custo')
  if (!atendimento.forma_pagamento) pendencias.push('pagamento')
  if (!String(atendimento.solicitante_nome || atendimento.autorizador_nome || atendimento.numero_solicitacao || '').trim()) pendencias.push('solicitante')
  return pendencias
}

function calcularAntecedenciaDias(atendimento: Atendimento): number | null {
  const dataPedido = normalizarData(atendimento.data_atendimento || atendimento.created_at)
  const dataServico = getDataInicioServico(atendimento)
  if (!dataPedido || !dataServico) return null
  const start = new Date(`${dataPedido}T00:00:00`).getTime()
  const end = new Date(`${dataServico}T00:00:00`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.round((end - start) / 86_400_000)
}

function getDataInicioServico(atendimento: Atendimento): string {
  return normalizarData(
    atendimento.detalhes_hotel?.data_checkin ||
    atendimento.detalhes_aereo?.data_ida ||
    atendimento.detalhes_carro?.data_retirada ||
    atendimento.detalhes_pacote?.data_ida ||
    String(atendimento.wintour_dados?.dt_inicio_servicos || '') ||
    String(atendimento.wintour_dados?.hotel_dt_check_in || '')
  )
}

function getDataCompra(atendimento: Atendimento): string {
  return normalizarData(
    atendimento.detalhes_aereo?.data_compra ||
    atendimento.detalhes_aereo?.data_emissao ||
    getStringFromWintour(atendimento, ['data_lancamento', 'data_venda', 'data_emissao', 'dt_interna_cadastro', 'dt_hr_ult_alteracao']) ||
    atendimento.data_atendimento
  )
}

function getFornecedor(atendimento: Atendimento): string {
  return (
    atendimento.detalhes_hotel?.hotel_nome ||
    atendimento.detalhes_aereo?.cia_aerea ||
    atendimento.detalhes_carro?.locadora ||
    atendimento.detalhes_pacote?.descricao ||
    String(atendimento.wintour_dados?.fornecedor_nome || '') ||
    String(atendimento.wintour_dados?.codigo_fornecedor || '') ||
    '-'
  )
}

function getCompanhia(atendimento: Atendimento): string {
  return (
    atendimento.detalhes_aereo?.cia_aerea ||
    getStringFromWintour(atendimento, ['cia', 'cia_iata', 'fornecedor_nome', 'fornecedor', 'codigo_fornecedor']) ||
    ''
  )
}

function getBilhete(atendimento: Atendimento): string {
  return (
    atendimento.detalhes_aereo?.numero_bilhete ||
    getStringFromWintour(atendimento, ['num_bilhete', 'numero_bilhete', 'venda', 'idv_externo', 'numero_requisicao']) ||
    atendimento.venda_numero ||
    ''
  )
}

function getProduto(atendimento: Atendimento): string {
  return (
    getStringFromWintour(atendimento, ['grupo_produto', 'codigo_produto', 'produto', 'tipo_emissao']) ||
    atendimento.tipo_servico
  )
}

function getDestino(atendimento: Atendimento): string {
  return (
    atendimento.detalhes_aereo?.destino ||
    atendimento.detalhes_hotel?.cidade ||
    atendimento.detalhes_carro?.cidade_retirada ||
    atendimento.detalhes_pacote?.destino ||
    String(atendimento.wintour_dados?.cid_dest_principal || '') ||
    '-'
  )
}

function getCidade(atendimento: Atendimento): string {
  return (
    atendimento.detalhes_hotel?.cidade ||
    atendimento.detalhes_carro?.cidade_retirada ||
    atendimento.detalhes_pacote?.destino ||
    getStringFromWintour(atendimento, ['fornecedor_cidade', 'cid_dest_principal', 'empresa_cidade']) ||
    getDestino(atendimento)
  )
}

function getRota(atendimento: Atendimento): string {
  const origem = atendimento.detalhes_aereo?.origem || getStringFromWintour(atendimento, ['origem', 'cidade_origem', 'origem_aeroporto'])
  const destino = atendimento.detalhes_aereo?.destino || getStringFromWintour(atendimento, ['destino', 'cidade_destino', 'cid_dest_principal', 'destino_aeroporto'])
  if (origem && destino) return `${origem} -> ${destino}`
  if (destino) return destino
  return ''
}

function getServicoResumo(atendimento: Atendimento): string {
  if (atendimento.tipo_servico === 'Aéreo') {
    return [getCompanhia(atendimento), getRota(atendimento), getBilhete(atendimento)].filter(Boolean).join(' | ') || 'Aereo'
  }
  if (atendimento.tipo_servico === 'Hotel') {
    return [getFornecedor(atendimento), getCidade(atendimento), getDataInicioServico(atendimento)].filter(Boolean).join(' | ') || 'Hotel'
  }
  if (atendimento.tipo_servico === 'Carro') {
    return [getFornecedor(atendimento), getCidade(atendimento), atendimento.detalhes_carro?.categoria].filter(Boolean).join(' | ') || 'Carro'
  }
  return [getProduto(atendimento), getFornecedor(atendimento), getCidade(atendimento)].filter(Boolean).join(' | ') || atendimento.tipo_servico
}

function getServicoDetalhes(atendimento: Atendimento): Array<{ label: string; value: string }> {
  const detalhes: Array<{ label: string; value: string }> = []
  const push = (label: string, value?: string | number | null) => {
    const text = String(value ?? '').trim()
    if (text) detalhes.push({ label, value: text })
  }

  if (atendimento.tipo_servico === 'Aéreo') {
    push('Rota', getRota(atendimento))
    push('Companhia', getCompanhia(atendimento))
    push('Bilhete', getBilhete(atendimento))
    push('Viagem', getDataInicioServico(atendimento))
    push('Compra', getDataCompra(atendimento))
    push('Classe', atendimento.detalhes_aereo?.classe)
    push('Status', atendimento.detalhes_aereo?.status_bilhete || getStringFromWintour(atendimento, ['status', 'situacao']))
  } else if (atendimento.tipo_servico === 'Hotel') {
    push('Hotel', getFornecedor(atendimento))
    push('Cidade', getCidade(atendimento))
    push('Check-in', atendimento.detalhes_hotel?.data_checkin || getStringFromWintour(atendimento, ['hotel_dt_check_in', 'dt_inicio_servicos']))
    push('Check-out', atendimento.detalhes_hotel?.data_checkout || getStringFromWintour(atendimento, ['hotel_dt_check_out', 'dt_fim_servicos']))
    push('Noites', atendimento.detalhes_hotel?.noites)
  } else if (atendimento.tipo_servico === 'Carro') {
    push('Locadora', getFornecedor(atendimento))
    push('Cidade', getCidade(atendimento))
    push('Retirada', atendimento.detalhes_carro?.data_retirada || getDataInicioServico(atendimento))
    push('Devolucao', atendimento.detalhes_carro?.data_devolucao || getStringFromWintour(atendimento, ['dt_fim_servicos']))
    push('Categoria', atendimento.detalhes_carro?.categoria)
  } else {
    push('Produto', getProduto(atendimento))
    push('Fornecedor', getFornecedor(atendimento))
    push('Cidade', getCidade(atendimento))
    push('Servico', getDataInicioServico(atendimento))
  }

  return detalhes.slice(0, 7)
}

function benchmarkKey(atendimento: Atendimento): string {
  const fornecedor = normalizeKey(getFornecedor(atendimento))
  const destino = normalizeKey(getDestino(atendimento))
  if (atendimento.tipo_servico === 'Aéreo') {
    const origem = normalizeKey(atendimento.detalhes_aereo?.origem || '')
    if (origem || destino) return `${atendimento.tipo_servico}|${origem}|${destino}`
  }
  if (fornecedor || destino) return `${atendimento.tipo_servico}|${fornecedor}|${destino}`
  return ''
}

function normalizarData(value?: string | null): string {
  if (!value) return ''
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return text.slice(0, 10)
}

function getStringFromWintour(atendimento: Atendimento, keys: string[]): string {
  const dados = atendimento.wintour_dados || {}
  for (const key of keys) {
    const value = dados[key]
    const text = String(value ?? '').trim()
    if (text && text !== '0' && text.toLowerCase() !== 'null' && text.toLowerCase() !== 'undefined') return text
  }
  return ''
}

function getNumberFromWintour(atendimento: Atendimento, keys: string[]): number {
  const dados = atendimento.wintour_dados || {}
  for (const key of keys) {
    const raw = dados[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    const text = String(raw ?? '').trim()
    if (!text) continue
    const normalized = text.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
    const value = Number(normalized)
    if (Number.isFinite(value) && value !== 0) return value
  }
  return 0
}

function diaSemana(data?: string): string {
  const normalizada = normalizarData(data)
  if (!normalizada) return 'Sem data'
  const date = new Date(`${normalizada}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 'Sem data'
  return ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'][date.getDay()]
}

function bucketAntecedencia(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Sem data'
  if (value < 0) return 'Pos viagem'
  if (value <= 2) return '0-2 dias'
  if (value <= 7) return '3-7 dias'
  if (value <= 14) return '8-14 dias'
  if (value <= 30) return '15-30 dias'
  return '31+ dias'
}

function percentil(values: number[], p: number): number {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index]
}

function media(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, item) => sum + item, 0) / values.length
}

function taxa(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

function percent(value: number, total: number): string {
  return `${taxa(value, total).toFixed(1)}%`
}

function normalizeKey(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

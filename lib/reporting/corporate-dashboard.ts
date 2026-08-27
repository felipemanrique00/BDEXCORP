import type { Atendimento, Empresa, Funcionario, StatusAtendimento, TipoServico } from '@/types'
import {
  countDaysInclusive,
  montarLinhasDetalhe,
  type LinhaDetalheRelatorio,
} from '@/lib/relatorios'

export type DashboardPage = 'painel' | 'consolidado' | 'analises' | 'detalhes'
export type DashboardCategoriaFiltro = 'todos' | TipoServico

export type DashboardFocus =
  | { kind: 'empresa'; value: string; label: string }
  | { kind: 'fornecedor'; value: string; label: string }
  | { kind: 'cidade'; value: string; label: string }
  | { kind: 'rota'; value: string; label: string }
  | { kind: 'mes'; value: string; label: string }
  | { kind: 'centro'; value: string; label: string }
  | null

export interface DashboardFiltros {
  categoria?: DashboardCategoriaFiltro
  empresa?: string
  status?: StatusAtendimento | 'todos'
  mes?: string
  query?: string
  focus?: DashboardFocus
}

export interface DashboardKpis {
  total: number
  media: number
  taxas: number
  transacoes: number
  viajantes: number
  economia: number
  oportunidade: number
  referencia: number
  co2Kg: number
}

export interface DashboardRanking {
  chave: string
  nome: string
  quantidade: number
  total: number
  taxas: number
  economia: number
  oportunidade: number
  percentual: number
  media: number
}

export interface DashboardSerieMensal extends DashboardRanking {
  label: string
  viajantes: number
}

export interface DashboardCategoria {
  tipo: TipoServico
  label: string
  quantidade: number
  total: number
  taxas: number
  economia: number
  percentual: number
  porDia: number
  porPessoa: number
  color: string
}

export interface DashboardMapPoint {
  chave: string
  nome: string
  cidade: string
  uf?: string
  codigo?: string
  lat: number
  lng: number
  quantidade: number
  total: number
  percentual: number
}

export interface DashboardGovernanca {
  completude: number
  reservasUrgentes: number
  antecedenciaMedia: number
  itensComparaveis: number
  coberturaComparavel: number
}

export interface DashboardReport {
  linhas: LinhaDetalheRelatorio[]
  kpis: DashboardKpis
  categorias: DashboardCategoria[]
  meses: DashboardSerieMensal[]
  empresas: DashboardRanking[]
  fornecedores: DashboardRanking[]
  cidades: DashboardRanking[]
  rotas: DashboardRanking[]
  centros: DashboardRanking[]
  tipoServico: DashboardRanking[]
  status: DashboardRanking[]
  mapa: DashboardMapPoint[]
  governanca: DashboardGovernanca
  totalDias: number
  filtrosAtivos: string[]
}

type GeoPoint = {
  chave: string
  nome: string
  cidade: string
  uf?: string
  codigo?: string
  lat: number
  lng: number
  aliases: string[]
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const CATEGORIAS_CANONICAS: TipoServico[] = ['Aéreo', 'Hotel', 'Carro', 'Rodoviário', 'Pacote', 'Outro']

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  AEREO: { label: 'Aéreo', color: '#11175f' },
  HOTEL: { label: 'Hospedagem', color: '#858585' },
  CARRO: { label: 'Locação / Transporte', color: '#10beb3' },
  RODOVIARIO: { label: 'Rodoviário / Ônibus', color: '#df4053' },
  PACOTE: { label: 'Pacote', color: '#5d78b6' },
  OUTRO: { label: 'Outros', color: '#f47b2d' },
}

const STATUS_LABELS: Record<StatusAtendimento, string> = {
  em_andamento: 'Em andamento',
  aguardando_cliente: 'Aguardando cliente',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
  pendente: 'Pendente',
}

const GEO_POINTS: GeoPoint[] = [
  geo('GYN', 'Goiânia / Santa Genoveva', 'Goiânia', 'GO', -16.632, -49.221, ['GOIANIA', 'GOIÂNIA', 'SANTA GENOVEVA']),
  geo('CGH', 'São Paulo / Congonhas', 'São Paulo', 'SP', -23.626, -46.656, ['SAO PAULO', 'SÃO PAULO', 'CONGONHAS']),
  geo('GRU', 'São Paulo / Guarulhos', 'São Paulo', 'SP', -23.435, -46.473, ['GUARULHOS']),
  geo('VCP', 'Campinas / Viracopos', 'Campinas', 'SP', -23.007, -47.134, ['CAMPINAS', 'VIRACOPOS']),
  geo('BSB', 'Brasília', 'Brasília', 'DF', -15.871, -47.918, ['BRASILIA', 'BRASÍLIA']),
  geo('CNF', 'Belo Horizonte / Confins', 'Belo Horizonte', 'MG', -19.624, -43.971, ['BELO HORIZONTE', 'CONFINS']),
  geo('PLU', 'Belo Horizonte / Pampulha', 'Belo Horizonte', 'MG', -19.851, -43.951, ['PAMPULHA']),
  geo('UDI', 'Uberlândia', 'Uberlândia', 'MG', -18.883, -48.225, ['UBERLANDIA', 'UBERLÂNDIA']),
  geo('UBA', 'Uberaba', 'Uberaba', 'MG', -19.765, -47.965, ['UBERABA']),
  geo('RAO', 'Ribeirão Preto', 'Ribeirão Preto', 'SP', -21.134, -47.774, ['RIBEIRAO PRETO', 'RIBEIRÃO PRETO']),
  geo('GIG', 'Rio de Janeiro / Galeão', 'Rio de Janeiro', 'RJ', -22.809, -43.251, ['RIO DE JANEIRO', 'GALEAO', 'GALEÃO']),
  geo('SDU', 'Rio de Janeiro / Santos Dumont', 'Rio de Janeiro', 'RJ', -22.91, -43.163, ['SANTOS DUMONT']),
  geo('POA', 'Porto Alegre', 'Porto Alegre', 'RS', -29.994, -51.171, ['PORTO ALEGRE']),
  geo('CWB', 'Curitiba', 'Curitiba', 'PR', -25.532, -49.176, ['CURITIBA']),
  geo('FLN', 'Florianópolis', 'Florianópolis', 'SC', -27.671, -48.552, ['FLORIANOPOLIS', 'FLORIANÓPOLIS']),
  geo('NVT', 'Navegantes', 'Navegantes', 'SC', -26.879, -48.651, ['NAVEGANTES']),
  geo('VIX', 'Vitória', 'Vitória', 'ES', -20.258, -40.286, ['VITORIA', 'VITÓRIA']),
  geo('SSA', 'Salvador', 'Salvador', 'BA', -12.908, -38.322, ['SALVADOR']),
  geo('REC', 'Recife', 'Recife', 'PE', -8.126, -34.923, ['RECIFE']),
  geo('FOR', 'Fortaleza', 'Fortaleza', 'CE', -3.776, -38.532, ['FORTALEZA']),
  geo('NAT', 'Natal', 'Natal', 'RN', -5.769, -35.366, ['NATAL']),
  geo('BEL', 'Belém', 'Belém', 'PA', -1.379, -48.476, ['BELEM', 'BELÉM']),
  geo('MAO', 'Manaus', 'Manaus', 'AM', -3.039, -60.05, ['MANAUS']),
  geo('CGB', 'Cuiabá', 'Cuiabá', 'MT', -15.652, -56.117, ['CUIABA', 'CUIABÁ']),
  geo('CGR', 'Campo Grande', 'Campo Grande', 'MS', -20.469, -54.672, ['CAMPO GRANDE']),
  geo('PMW', 'Palmas', 'Palmas', 'TO', -10.291, -48.357, ['PALMAS']),
  geo('IOS', 'Ilhéus', 'Ilhéus', 'BA', -14.815, -39.033, ['ILHEUS', 'ILHÉUS']),
  geo('MCZ', 'Maceió', 'Maceió', 'AL', -9.511, -35.792, ['MACEIO', 'MACEIÓ']),
  geo('AJU', 'Aracaju', 'Aracaju', 'SE', -10.985, -37.073, ['ARACAJU']),
  geo('JPA', 'João Pessoa', 'João Pessoa', 'PB', -7.146, -34.948, ['JOAO PESSOA', 'JOÃO PESSOA']),
  geo('SLZ', 'São Luís', 'São Luís', 'MA', -2.586, -44.236, ['SAO LUIS', 'SÃO LUÍS', 'SAO LUÍS', 'SÃO LUIS']),
  geo('THE', 'Teresina', 'Teresina', 'PI', -5.059, -42.824, ['TERESINA']),
  geo('LDB', 'Londrina', 'Londrina', 'PR', -23.334, -51.13, ['LONDRINA']),
  geo('MGF', 'Maringá', 'Maringá', 'PR', -23.479, -52.012, ['MARINGA', 'MARINGÁ']),
  geo('IGU', 'Foz do Iguaçu', 'Foz do Iguaçu', 'PR', -25.596, -54.487, ['FOZ DO IGUACU', 'FOZ DO IGUAÇU']),
  geo('ITB', 'Itumbiara', 'Itumbiara', 'GO', -18.419, -49.215, ['ITUMBIARA']),
  geo('ANP', 'Anápolis', 'Anápolis', 'GO', -16.328, -48.953, ['ANAPOLIS', 'ANÁPOLIS']),
  geo('GUR', 'Gurupi', 'Gurupi', 'TO', -11.728, -49.068, ['GURUPI']),
  geo('POR', 'Porangatu', 'Porangatu', 'GO', -13.44, -49.148, ['PORANGATU']),
]

export function montarCorporateDashboardReport(
  atendimentos: Atendimento[],
  empresas: Empresa[],
  funcionarios: Funcionario[],
  periodo: { inicio: string; fim: string },
  filtros: DashboardFiltros = {},
): DashboardReport {
  return montarCorporateDashboardReportDeLinhas(
    montarLinhasCorporateDashboard(atendimentos, empresas, funcionarios),
    periodo,
    filtros,
  )
}

export function montarLinhasCorporateDashboard(
  atendimentos: Atendimento[],
  empresas: Empresa[],
  funcionarios: Funcionario[],
): LinhaDetalheRelatorio[] {
  const empresaNomePorId = new Map(empresas.map((empresa) => [empresa.id, empresa.nome]))
  return montarLinhasDetalhe(atendimentos, empresaNomePorId, funcionarios)
}

export function montarCorporateDashboardReportDeLinhas(
  linhasBase: LinhaDetalheRelatorio[],
  periodo: { inicio: string; fim: string },
  filtros: DashboardFiltros = {},
): DashboardReport {
  const linhas = filtrarLinhas(linhasBase, filtros)
  const total = soma(linhas.map((linha) => linha.total))
  const taxas = soma(linhas.map((linha) => linha.taxa || linha.taxasServico || 0))
  const transacoes = linhas.length
  const viajantes = new Set(linhas.map((linha) => linha.passageiroChave || linha.funcionarioCodigo || normalize(linha.passageiro))).size
  const economia = soma(linhas.map((linha) => linha.economia))
  const oportunidade = soma(linhas.map((linha) => linha.oportunidadeEconomia))
  const referencia = soma(linhas.map((linha) => linha.valorReferencia))
  const co2Kg = soma(linhas.map((linha) => linha.co2Kg))
  const totalDias = countDaysInclusive(periodo.inicio, periodo.fim)

  return {
    linhas,
    kpis: {
      total,
      media: transacoes ? total / transacoes : 0,
      taxas,
      transacoes,
      viajantes,
      economia,
      oportunidade,
      referencia,
      co2Kg,
    },
    categorias: categorias(linhas, total, totalDias, viajantes),
    meses: serieMensal(linhas, periodo.inicio, periodo.fim, total),
    empresas: ranking(linhas, (linha) => linha.empresa || 'Empresa não informada', total),
    fornecedores: ranking(linhas, (linha) => fornecedorPrincipal(linha), total),
    cidades: ranking(linhas, (linha) => localizacaoPrincipal(linha), total),
    rotas: ranking(linhas, (linha) => rotaPrincipal(linha), total),
    centros: ranking(linhas, (linha) => linha.centroCusto || 'Sem centro de custo', total),
    tipoServico: ranking(linhas, (linha) => categoriaLabel(linha.tipo), total),
    status: ranking(linhas, (linha) => STATUS_LABELS[linha.status] || linha.status, total),
    mapa: mapa(linhas, total),
    governanca: governanca(linhas, transacoes),
    totalDias,
    filtrosAtivos: filtrosAtivos(filtros, linhas.length, linhasBase.length),
  }
}

export function categoriaLabel(tipo: string): string {
  return CATEGORY_META[categoriaKey(tipo)]?.label || tipo || 'Outros'
}

export function categoriaColor(tipo: string): string {
  return CATEGORY_META[categoriaKey(tipo)]?.color || '#11175f'
}

export function statusLabel(status: StatusAtendimento | string): string {
  return STATUS_LABELS[status as StatusAtendimento] || String(status || '-')
}

function filtrarLinhas(linhas: LinhaDetalheRelatorio[], filtros: DashboardFiltros): LinhaDetalheRelatorio[] {
  const categoria = filtros.categoria || 'todos'
  const status = filtros.status || 'todos'
  const query = normalize(filtros.query || '')
  return linhas.filter((linha) => {
    if (categoria !== 'todos' && categoriaKey(linha.tipo) !== categoriaKey(categoria)) return false
    if (filtros.empresa && linha.empresa !== filtros.empresa) return false
    if (status !== 'todos' && linha.status !== status) return false
    if (filtros.mes && mesChave(linha.data) !== filtros.mes) return false
    if (query) {
      const haystack = normalize([
        linha.passageiro,
        linha.funcionarioCodigo,
        linha.localizador,
        linha.fornecedor,
        linha.companhia,
        linha.cidade,
        linha.destino,
        linha.rota,
        linha.centroCusto,
        linha.solicitante,
      ].filter(Boolean).join(' '))
      if (!haystack.includes(query)) return false
    }
    if (filtros.focus) {
      const value = normalize(filtros.focus.value)
      if (filtros.focus.kind === 'empresa' && normalize(linha.empresa || '') !== value) return false
      if (filtros.focus.kind === 'fornecedor' && normalize(fornecedorPrincipal(linha)) !== value) return false
      if (filtros.focus.kind === 'cidade' && normalize(localizacaoPrincipal(linha)) !== value) return false
      if (filtros.focus.kind === 'rota' && normalize(rotaPrincipal(linha)) !== value) return false
      if (filtros.focus.kind === 'mes' && mesChave(linha.data) !== filtros.focus.value) return false
      if (filtros.focus.kind === 'centro' && normalize(linha.centroCusto || 'Sem centro de custo') !== value) return false
    }
    return true
  })
}

function categorias(linhas: LinhaDetalheRelatorio[], total: number, totalDias: number, viajantes: number): DashboardCategoria[] {
  return CATEGORIAS_CANONICAS.map((tipo) => {
    const subset = linhas.filter((linha) => categoriaKey(linha.tipo) === categoriaKey(tipo))
    const subtotal = soma(subset.map((linha) => linha.total))
    return {
      tipo,
      label: categoriaLabel(tipo),
      quantidade: subset.length,
      total: subtotal,
      taxas: soma(subset.map((linha) => linha.taxa || linha.taxasServico || 0)),
      economia: soma(subset.map((linha) => linha.economia)),
      percentual: total ? (subtotal / total) * 100 : 0,
      porDia: totalDias ? subtotal / totalDias : 0,
      porPessoa: viajantes ? subtotal / viajantes : 0,
      color: categoriaColor(tipo),
    }
  }).sort((a, b) => b.total - a.total)
}

function ranking(
  linhas: LinhaDetalheRelatorio[],
  labelFn: (linha: LinhaDetalheRelatorio) => string,
  totalGeral: number,
  limit = 12,
): DashboardRanking[] {
  const map = new Map<string, DashboardRanking>()
  linhas.forEach((linha) => {
    const nome = labelFn(linha).trim() || 'Não informado'
    const chave = normalize(nome) || nome
    const current = map.get(chave) || {
      chave,
      nome,
      quantidade: 0,
      total: 0,
      taxas: 0,
      economia: 0,
      oportunidade: 0,
      percentual: 0,
      media: 0,
    }
    current.quantidade += 1
    current.total += linha.total
    current.taxas += linha.taxa || linha.taxasServico || 0
    current.economia += linha.economia
    current.oportunidade += linha.oportunidadeEconomia
    map.set(chave, current)
  })
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      percentual: totalGeral ? (item.total / totalGeral) * 100 : 0,
      media: item.quantidade ? item.total / item.quantidade : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

function serieMensal(linhas: LinhaDetalheRelatorio[], inicio: string, fim: string, totalGeral: number): DashboardSerieMensal[] {
  const map = new Map<string, DashboardSerieMensal>()
  monthKeysBetween(inicio, fim).forEach((chave) => {
    map.set(chave, {
      chave,
      label: monthLabel(chave),
      nome: monthLabel(chave),
      quantidade: 0,
      total: 0,
      taxas: 0,
      economia: 0,
      oportunidade: 0,
      percentual: 0,
      media: 0,
      viajantes: 0,
    })
  })
  const viajantesPorMes = new Map<string, Set<string>>()
  linhas.forEach((linha) => {
    const chave = mesChave(linha.data)
    if (!map.has(chave)) {
      map.set(chave, {
        chave,
        label: monthLabel(chave),
        nome: monthLabel(chave),
        quantidade: 0,
        total: 0,
        taxas: 0,
        economia: 0,
        oportunidade: 0,
        percentual: 0,
        media: 0,
        viajantes: 0,
      })
    }
    const item = map.get(chave)!
    item.quantidade += 1
    item.total += linha.total
    item.taxas += linha.taxa || linha.taxasServico || 0
    item.economia += linha.economia
    item.oportunidade += linha.oportunidadeEconomia
    const set = viajantesPorMes.get(chave) || new Set<string>()
    set.add(linha.passageiroChave || linha.funcionarioCodigo || normalize(linha.passageiro))
    viajantesPorMes.set(chave, set)
  })
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      percentual: totalGeral ? (item.total / totalGeral) * 100 : 0,
      media: item.quantidade ? item.total / item.quantidade : 0,
      viajantes: viajantesPorMes.get(item.chave)?.size || 0,
    }))
    .sort((a, b) => a.chave.localeCompare(b.chave))
}

function mapa(linhas: LinhaDetalheRelatorio[], totalGeral: number): DashboardMapPoint[] {
  const map = new Map<string, DashboardMapPoint>()
  linhas.forEach((linha) => {
    const geoPoint = geoForLinha(linha)
    if (!geoPoint) return
    const current = map.get(geoPoint.chave) || {
      chave: geoPoint.chave,
      nome: geoPoint.nome,
      cidade: geoPoint.cidade,
      uf: geoPoint.uf,
      codigo: geoPoint.codigo,
      lat: geoPoint.lat,
      lng: geoPoint.lng,
      quantidade: 0,
      total: 0,
      percentual: 0,
    }
    current.quantidade += 1
    current.total += linha.total
    map.set(geoPoint.chave, current)
  })
  return Array.from(map.values())
    .map((item) => ({ ...item, percentual: totalGeral ? (item.total / totalGeral) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 35)
}

function governanca(linhas: LinhaDetalheRelatorio[], total: number): DashboardGovernanca {
  const campos = ['empresa', 'fornecedor', 'solicitante', 'formaPagamento', 'status'] as const
  const preenchidos = linhas.reduce((sum, linha) => sum + campos.filter((campo) => Boolean(linha[campo])).length, 0)
  const antecedencias = linhas
    .map((linha) => linha.antecedenciaDias)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const comparaveis = linhas.filter((linha) => linha.valorReferencia > 0).length
  return {
    completude: total ? (preenchidos / (total * campos.length)) * 100 : 0,
    reservasUrgentes: linhas.filter((linha) => typeof linha.antecedenciaDias === 'number' && linha.antecedenciaDias <= 2).length,
    antecedenciaMedia: antecedencias.length ? soma(antecedencias) / antecedencias.length : 0,
    itensComparaveis: comparaveis,
    coberturaComparavel: total ? (comparaveis / total) * 100 : 0,
  }
}

function filtrosAtivos(filtros: DashboardFiltros, linhasFiltradas: number, linhasBase: number): string[] {
  const chips = [`${linhasFiltradas} de ${linhasBase} demanda(s)`]
  if (filtros.categoria && filtros.categoria !== 'todos') chips.push(`Categoria: ${categoriaLabel(filtros.categoria)}`)
  if (filtros.empresa) chips.push(`Empresa: ${filtros.empresa}`)
  if (filtros.status && filtros.status !== 'todos') chips.push(`Status: ${statusLabel(filtros.status)}`)
  if (filtros.mes) chips.push(`Mês: ${monthLabel(filtros.mes)}`)
  if (filtros.query) chips.push(`Busca: ${filtros.query}`)
  if (filtros.focus) chips.push(filtros.focus.label)
  return chips
}

function geoForLinha(linha: LinhaDetalheRelatorio): GeoPoint | null {
  const rotaCodes = extractIataCodes(linha.rota || '')
  for (const code of rotaCodes) {
    const match = geoFor(code)
    if (match) return match
  }
  return geoFor(linha.cidade || '') || geoFor(linha.destino || '') || null
}

function geoFor(value: string): GeoPoint | null {
  const n = normalize(value)
  if (!n || n === '-') return null
  return GEO_POINTS.find((point) => {
    if (normalize(point.chave) === n || normalize(point.codigo || '') === n) return true
    if (normalize(point.cidade) === n || normalize(point.nome) === n) return true
    return point.aliases.some((alias) => normalize(alias) === n)
  }) || null
}

function geo(chave: string, nome: string, cidade: string, uf: string, lat: number, lng: number, aliases: string[]): GeoPoint {
  return { chave, codigo: chave.length === 3 ? chave : undefined, nome, cidade, uf, lat, lng, aliases: [chave, cidade, nome, ...aliases] }
}

function fornecedorPrincipal(linha: LinhaDetalheRelatorio): string {
  if (categoriaKey(linha.tipo) === 'AEREO') return linha.companhia || linha.fornecedor || 'Companhia não informada'
  if (categoriaKey(linha.tipo) === 'CARRO') return linha.fornecedor || 'Locadora não informada'
  return linha.fornecedor || linha.companhia || 'Fornecedor não informado'
}

function localizacaoPrincipal(linha: LinhaDetalheRelatorio): string {
  const geoPoint = geoForLinha(linha)
  if (geoPoint) return geoPoint.cidade
  return linha.cidade || linha.destino || 'Cidade não informada'
}

function rotaPrincipal(linha: LinhaDetalheRelatorio): string {
  const rota = String(linha.rota || '').trim()
  if (rota && rota !== '-') return rota
  return linha.destino || linha.cidade || 'Rota não informada'
}

function extractIataCodes(value: string): string[] {
  return Array.from(String(value || '').toUpperCase().matchAll(/\b[A-Z]{3}\b/g)).map((match) => match[0])
}

function monthKeysBetween(inicio: string, fim: string): string[] {
  const start = parseIsoDate(inicio)
  const end = parseIsoDate(fim)
  if (!start || !end) return []
  const current = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  const keys: string[] = []
  while (current <= last && keys.length < 72) {
    keys.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`)
    current.setMonth(current.getMonth() + 1)
  }
  return keys
}

function monthLabel(chave: string): string {
  const [year, month] = chave.split('-')
  const index = Number(month) - 1
  return `${MESES[index] || month}/${String(year || '').slice(2)}`
}

function mesChave(value: string): string {
  const date = parseIsoDate(value)
  if (!date) return 'sem-data'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function soma(values: number[]): number {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0)
}

function normalize(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function categoriaKey(tipo: string): string {
  const normalized = normalize(tipo).replace(/\s+/g, '')
  if (normalized.includes('AEREO')) return 'AEREO'
  if (normalized.includes('HOSPED') || normalized.includes('HOTEL')) return 'HOTEL'
  if (normalized.includes('RODOVIARIO') || normalized.includes('ONIBUS')) return 'RODOVIARIO'
  if (normalized.includes('CARRO') || normalized.includes('LOCACAO') || normalized.includes('TRANSPORTE')) return 'CARRO'
  if (normalized.includes('PACOTE')) return 'PACOTE'
  return 'OUTRO'
}

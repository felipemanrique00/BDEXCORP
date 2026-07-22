import type { Atendimento, Empresa, Funcionario } from '@/types'
import { resolverFuncionarioAtendimento } from '@/lib/funcionario-identidade'

export type AereoTrechoTipo = 'Somente ida' | 'Ida e volta' | 'Multitrecho' | 'Nao informado'

export interface RankingAereo {
  chave: string
  nome: string
  total: number
  transacoes: number
  percentual: number
  taxas: number
}

export interface SerieMensalAereo {
  chave: string
  label: string
  total: number
  transacoes: number
  taxas: number
}

export interface PontoMapaAereo {
  codigo: string
  nome: string
  cidade: string
  uf?: string
  lat: number
  lng: number
  total: number
  transacoes: number
}

export interface RotaMapaAereo {
  chave: string
  origemCodigo: string
  destinoCodigo: string
  origemNome: string
  destinoNome: string
  origemLat: number
  origemLng: number
  destinoLat: number
  destinoLng: number
  total: number
  transacoes: number
}

export interface DetalheAereo {
  id: string
  data: string
  empresa: string
  passageiro: string
  funcionarioCodigo?: string
  centroCusto?: string
  cia: string
  origem: string
  destino: string
  rota: string
  trechoTipo: AereoTrechoTipo
  localizador?: string
  bilhete?: string
  total: number
  taxas: number
  antecedenciaDias: number | null
}

export interface FiltrosAereoInterativos {
  empresaId?: string
  grupoEmpresaIds?: string[]
  cia?: string
  rota?: string
  cidadeOuAeroporto?: string
  trechoTipo?: AereoTrechoTipo
  mes?: string
}

export interface RelatorioAereoExecutivo {
  total: number
  custoMedio: number
  taxas: number
  transacoes: number
  viajantes: number
  serieMensal: SerieMensalAereo[]
  porEmpresa: RankingAereo[]
  porCia: RankingAereo[]
  porTrecho: RankingAereo[]
  topRotas: RankingAereo[]
  pontosMapa: PontoMapaAereo[]
  rotasMapa: RotaMapaAereo[]
  detalhes: DetalheAereo[]
  filtrosAtivos: number
}

type AeroportoGeo = {
  codigo: string
  nome: string
  cidade: string
  uf?: string
  lat: number
  lng: number
}

const AEROPORTOS: Record<string, AeroportoGeo> = {
  GYN: { codigo: 'GYN', nome: 'Santa Genoveva', cidade: 'Goiania', uf: 'GO', lat: -16.632, lng: -49.221 },
  CGH: { codigo: 'CGH', nome: 'Congonhas', cidade: 'Sao Paulo', uf: 'SP', lat: -23.626, lng: -46.656 },
  GRU: { codigo: 'GRU', nome: 'Guarulhos', cidade: 'Sao Paulo', uf: 'SP', lat: -23.435, lng: -46.473 },
  VCP: { codigo: 'VCP', nome: 'Viracopos', cidade: 'Campinas', uf: 'SP', lat: -23.007, lng: -47.134 },
  BSB: { codigo: 'BSB', nome: 'Brasilia', cidade: 'Brasilia', uf: 'DF', lat: -15.871, lng: -47.918 },
  CNF: { codigo: 'CNF', nome: 'Confins', cidade: 'Belo Horizonte', uf: 'MG', lat: -19.624, lng: -43.971 },
  PLU: { codigo: 'PLU', nome: 'Pampulha', cidade: 'Belo Horizonte', uf: 'MG', lat: -19.851, lng: -43.951 },
  GIG: { codigo: 'GIG', nome: 'Galeao', cidade: 'Rio de Janeiro', uf: 'RJ', lat: -22.809, lng: -43.251 },
  SDU: { codigo: 'SDU', nome: 'Santos Dumont', cidade: 'Rio de Janeiro', uf: 'RJ', lat: -22.91, lng: -43.163 },
  POA: { codigo: 'POA', nome: 'Salgado Filho', cidade: 'Porto Alegre', uf: 'RS', lat: -29.994, lng: -51.171 },
  CWB: { codigo: 'CWB', nome: 'Afonso Pena', cidade: 'Curitiba', uf: 'PR', lat: -25.532, lng: -49.176 },
  FLN: { codigo: 'FLN', nome: 'Hercilio Luz', cidade: 'Florianopolis', uf: 'SC', lat: -27.671, lng: -48.552 },
  NVT: { codigo: 'NVT', nome: 'Navegantes', cidade: 'Navegantes', uf: 'SC', lat: -26.879, lng: -48.651 },
  VIX: { codigo: 'VIX', nome: 'Vitoria', cidade: 'Vitoria', uf: 'ES', lat: -20.258, lng: -40.286 },
  SSA: { codigo: 'SSA', nome: 'Salvador', cidade: 'Salvador', uf: 'BA', lat: -12.908, lng: -38.322 },
  REC: { codigo: 'REC', nome: 'Recife', cidade: 'Recife', uf: 'PE', lat: -8.126, lng: -34.923 },
  FOR: { codigo: 'FOR', nome: 'Fortaleza', cidade: 'Fortaleza', uf: 'CE', lat: -3.776, lng: -38.532 },
  NAT: { codigo: 'NAT', nome: 'Natal', cidade: 'Natal', uf: 'RN', lat: -5.769, lng: -35.366 },
  BEL: { codigo: 'BEL', nome: 'Belem', cidade: 'Belem', uf: 'PA', lat: -1.379, lng: -48.476 },
  MAO: { codigo: 'MAO', nome: 'Manaus', cidade: 'Manaus', uf: 'AM', lat: -3.039, lng: -60.05 },
  CGB: { codigo: 'CGB', nome: 'Cuiaba', cidade: 'Cuiaba', uf: 'MT', lat: -15.652, lng: -56.117 },
  CGR: { codigo: 'CGR', nome: 'Campo Grande', cidade: 'Campo Grande', uf: 'MS', lat: -20.469, lng: -54.672 },
  UDI: { codigo: 'UDI', nome: 'Uberlandia', cidade: 'Uberlandia', uf: 'MG', lat: -18.883, lng: -48.225 },
  UBA: { codigo: 'UBA', nome: 'Uberaba', cidade: 'Uberaba', uf: 'MG', lat: -19.765, lng: -47.965 },
  RAO: { codigo: 'RAO', nome: 'Ribeirao Preto', cidade: 'Ribeirao Preto', uf: 'SP', lat: -21.134, lng: -47.774 },
  LDB: { codigo: 'LDB', nome: 'Londrina', cidade: 'Londrina', uf: 'PR', lat: -23.334, lng: -51.13 },
  MGF: { codigo: 'MGF', nome: 'Maringa', cidade: 'Maringa', uf: 'PR', lat: -23.479, lng: -52.012 },
  IGU: { codigo: 'IGU', nome: 'Foz do Iguacu', cidade: 'Foz do Iguacu', uf: 'PR', lat: -25.596, lng: -54.487 },
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function montarRelatorioAereoExecutivo(
  atendimentos: Atendimento[],
  empresas: Empresa[],
  funcionarios: Funcionario[],
  filtros: FiltrosAereoInterativos = {},
): RelatorioAereoExecutivo {
  const empresaPorId = new Map(empresas.map((empresa) => [empresa.id, empresa]))
  const grupoEmpresaIds = filtros.grupoEmpresaIds?.length ? new Set(filtros.grupoEmpresaIds) : null
  const detalhesBase = atendimentos
    .filter((atendimento) => isTipoAereo(atendimento.tipo_servico))
    .filter((atendimento) => !filtros.empresaId || atendimento.empresa_id === filtros.empresaId)
    .filter((atendimento) => !grupoEmpresaIds || grupoEmpresaIds.has(atendimento.empresa_id))
    .map((atendimento) => detalheFromAtendimento(atendimento, empresaPorId, funcionarios))

  const detalhes = detalhesBase.filter((detalhe) => {
    if (filtros.cia && detalhe.cia !== filtros.cia) return false
    if (filtros.rota && detalhe.rota !== filtros.rota) return false
    if (filtros.trechoTipo && detalhe.trechoTipo !== filtros.trechoTipo) return false
    if (filtros.mes && mesChave(detalhe.data) !== filtros.mes) return false
    if (filtros.cidadeOuAeroporto) {
      const alvo = normalizarTexto(filtros.cidadeOuAeroporto)
      const origem = normalizarTexto(`${detalhe.origem} ${aeroportoLabel(detalhe.origem)}`)
      const destino = normalizarTexto(`${detalhe.destino} ${aeroportoLabel(detalhe.destino)}`)
      if (!origem.includes(alvo) && !destino.includes(alvo)) return false
    }
    return true
  })

  const total = soma(detalhes.map((item) => item.total))
  const taxas = soma(detalhes.map((item) => item.taxas))
  const transacoes = detalhes.length
  const viajantes = new Set(detalhes.map((item) => item.funcionarioCodigo || normalizarTexto(item.passageiro))).size

  return {
    total,
    custoMedio: transacoes ? total / transacoes : 0,
    taxas,
    transacoes,
    viajantes,
    serieMensal: serieMensal(detalhes),
    porEmpresa: ranking(detalhes, (item) => item.empresa, total),
    porCia: ranking(detalhes, (item) => item.cia, total),
    porTrecho: ranking(detalhes, (item) => item.trechoTipo, total),
    topRotas: ranking(detalhes, (item) => item.rota, total),
    pontosMapa: pontosMapa(detalhes),
    rotasMapa: rotasMapa(detalhes),
    detalhes: detalhes.sort((a, b) => b.data.localeCompare(a.data)),
    filtrosAtivos: Object.values(filtros).filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length,
  }
}

function detalheFromAtendimento(
  atendimento: Atendimento,
  empresaPorId: Map<string, Empresa>,
  funcionarios: Funcionario[],
): DetalheAereo {
  const funcionario = resolverFuncionarioAtendimento(atendimento, funcionarios, 84)
  const aereo = atendimento.detalhes_aereo || {}
  const origem = normalizarPontoAereo(aereo.origem || trechoFromTexto(atendimento.observacoes)[0] || '')
  const destino = normalizarPontoAereo(aereo.destino || trechoFromTexto(atendimento.observacoes)[1] || '')
  const rota = montarRota(atendimento, origem, destino)
  const data = dataReferencia(atendimento)
  const taxas = Number(aereo.taxas || 0) + Number(atendimento.taxa_ativa ? atendimento.taxa_valor_fixo || 0 : 0)

  return {
    id: atendimento.id,
    data,
    empresa: empresaPorId.get(atendimento.empresa_id)?.nome || 'Empresa nao cadastrada',
    passageiro: funcionario?.nome || atendimento.passageiro_nome || 'Passageiro nao informado',
    funcionarioCodigo: funcionario?.codigo_identificacao,
    centroCusto: atendimento.centro_custo || funcionario?.centro_custo || undefined,
    cia: normalizarNomeRanking(aereo.cia_aerea || fornecedorFromAtendimento(atendimento) || 'Companhia nao informada'),
    origem: origem || '-',
    destino: destino || '-',
    rota,
    trechoTipo: tipoTrecho(atendimento, rota, origem, destino),
    localizador: aereo.localizador,
    bilhete: aereo.numero_bilhete,
    total: valorFinalCliente(atendimento),
    taxas,
    antecedenciaDias: antecedenciaDias(aereo.data_compra || atendimento.data_atendimento, aereo.data_ida || atendimento.data_atendimento),
  }
}

function ranking(detalhes: DetalheAereo[], keyFn: (item: DetalheAereo) => string, totalGeral: number): RankingAereo[] {
  const map = new Map<string, RankingAereo>()
  detalhes.forEach((item) => {
    const nome = keyFn(item) || '-'
    const atual = map.get(nome) || { chave: nome, nome, total: 0, transacoes: 0, percentual: 0, taxas: 0 }
    atual.total += item.total
    atual.taxas += item.taxas
    atual.transacoes += 1
    map.set(nome, atual)
  })
  return Array.from(map.values())
    .map((item) => ({ ...item, percentual: totalGeral ? (item.total / totalGeral) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)
}

function serieMensal(detalhes: DetalheAereo[]): SerieMensalAereo[] {
  const map = new Map<string, SerieMensalAereo>()
  detalhes.forEach((item) => {
    const chave = mesChave(item.data)
    const date = parseIsoDate(item.data)
    const label = date ? `${MESES[date.getMonth()]}/${String(date.getFullYear()).slice(2)}` : 'Sem data'
    const atual = map.get(chave) || { chave, label, total: 0, transacoes: 0, taxas: 0 }
    atual.total += item.total
    atual.taxas += item.taxas
    atual.transacoes += 1
    map.set(chave, atual)
  })
  return Array.from(map.values()).sort((a, b) => a.chave.localeCompare(b.chave))
}

function pontosMapa(detalhes: DetalheAereo[]): PontoMapaAereo[] {
  const map = new Map<string, PontoMapaAereo>()
  detalhes.forEach((item) => {
    ;[item.origem, item.destino].forEach((codigoOuCidade) => {
      const geo = geoFromPonto(codigoOuCidade)
      if (!geo) return
      const atual = map.get(geo.codigo) || {
        codigo: geo.codigo,
        nome: geo.nome,
        cidade: geo.cidade,
        uf: geo.uf,
        lat: geo.lat,
        lng: geo.lng,
        total: 0,
        transacoes: 0,
      }
      atual.total += item.total / 2
      atual.transacoes += 1
      map.set(geo.codigo, atual)
    })
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

function rotasMapa(detalhes: DetalheAereo[]): RotaMapaAereo[] {
  const map = new Map<string, RotaMapaAereo>()
  detalhes.forEach((item) => {
    const origem = geoFromPonto(item.origem)
    const destino = geoFromPonto(item.destino)
    if (!origem || !destino || origem.codigo === destino.codigo) return
    const chave = `${origem.codigo}/${destino.codigo}`
    const atual = map.get(chave) || {
      chave,
      origemCodigo: origem.codigo,
      destinoCodigo: destino.codigo,
      origemNome: origem.cidade,
      destinoNome: destino.cidade,
      origemLat: origem.lat,
      origemLng: origem.lng,
      destinoLat: destino.lat,
      destinoLng: destino.lng,
      total: 0,
      transacoes: 0,
    }
    atual.total += item.total
    atual.transacoes += 1
    map.set(chave, atual)
  })
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 80)
}

function valorFinalCliente(atendimento: Atendimento): number {
  return Number(atendimento.valor_venda ?? atendimento.valor_final ?? atendimento.valor_cotacao ?? 0) || 0
}

function dataReferencia(atendimento: Atendimento): string {
  return String(
    atendimento.detalhes_aereo?.data_emissao ||
    atendimento.detalhes_aereo?.data_compra ||
    atendimento.detalhes_aereo?.data_ida ||
    atendimento.data_atendimento ||
    atendimento.created_at ||
    '',
  ).slice(0, 10)
}

function mesChave(iso: string): string {
  const date = parseIsoDate(iso)
  if (!date) return 'sem-data'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseIsoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return null
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return Number.isFinite(date.getTime()) ? date : null
}

function antecedenciaDias(compra?: string, ida?: string): number | null {
  const c = parseIsoDate(String(compra || ''))
  const i = parseIsoDate(String(ida || ''))
  if (!c || !i) return null
  return Math.max(0, Math.round((i.getTime() - c.getTime()) / 86400000))
}

function tipoTrecho(atendimento: Atendimento, rota: string, origem: string, destino: string): AereoTrechoTipo {
  const codigos = rota.split('/').filter(Boolean)
  if (codigos.length >= 3) {
    if (codigos[0] === codigos[codigos.length - 1]) return 'Ida e volta'
    return 'Multitrecho'
  }
  if (atendimento.detalhes_aereo?.data_volta) return 'Ida e volta'
  if (origem && destino && origem !== '-' && destino !== '-') return 'Somente ida'
  return 'Nao informado'
}

function montarRota(atendimento: Atendimento, origem: string, destino: string): string {
  const texto = [
    atendimento.detalhes_aereo?.origem,
    atendimento.detalhes_aereo?.destino,
    atendimento.observacoes,
    atendimento.wintour_dados?.rota_resumida,
    atendimento.wintour_dados?.descricao,
  ].filter(Boolean).join(' ')
  const codigos = extrairCodigosIata(texto)
  if (codigos.length >= 2) return codigos.join('/')
  if (origem && destino && origem !== '-' && destino !== '-') return `${origem}/${destino}`
  return 'Rota nao informada'
}

function trechoFromTexto(texto?: string): [string, string] {
  const codigos = extrairCodigosIata(texto || '')
  if (codigos.length >= 2) return [codigos[0], codigos[1]]
  return ['', '']
}

function extrairCodigosIata(texto: string): string[] {
  const matches = String(texto || '').toUpperCase().match(/\b[A-Z]{3}\b/g) || []
  const blacklist = new Set(['PDF', 'CPF', 'CNPJ', 'PIX', 'SLA', 'BBT'])
  return matches.filter((codigo, index, arr) => !blacklist.has(codigo) && arr.indexOf(codigo) === index)
}

function normalizarPontoAereo(value: string): string {
  const raw = String(value || '').trim()
  const iatas = extrairCodigosIata(raw)
  if (iatas[0]) return iatas[0]
  return normalizarNomeRanking(raw)
}

function geoFromPonto(value: string): AeroportoGeo | null {
  const normalized = normalizarPontoAereo(value)
  if (!normalized || normalized === '-') return null
  if (AEROPORTOS[normalized]) return AEROPORTOS[normalized]
  const byCity = Object.values(AEROPORTOS).find((item) => normalizarTexto(item.cidade) === normalizarTexto(normalized))
  return byCity || null
}

function aeroportoLabel(value: string): string {
  const geo = geoFromPonto(value)
  return geo ? `${geo.codigo} ${geo.nome} ${geo.cidade} ${geo.uf || ''}` : value
}

function fornecedorFromAtendimento(atendimento: Atendimento): string {
  const text = String(atendimento.observacoes || '')
  const cia = text.match(/\b(LATAM|GOL|AZUL|TAM|DELTA|AMERICAN|AVIANCA|COPA|AIR\s*FRANCE|TAP)\b/i)?.[0]
  return cia || ''
}

function normalizarNomeRanking(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase() || '-'
}

function normalizarTexto(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTipoAereo(value: unknown): boolean {
  return normalizarTexto(String(value || '')).includes('aereo')
}

function soma(values: number[]): number {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0)
}

import type { Atendimento, Empresa, FormaPagamento, Funcionario, StatusAtendimento, TipoServico } from '@/types'
import { excelSerialToISODate, localDateToISODate, toISODateOnly } from '@/lib/date'
import { encontrarFuncionarioConfiavel, encontrarFuncionarioPorNomeInteligente } from '@/lib/funcionario-identidade'

export type WintourSourceFormat = 'xml' | 'xlsx' | 'csv' | 'pdf'

export interface WintourSaleRecord {
  source: WintourSourceFormat
  venda_numero: string
  data_venda: string
  produto: string
  tipo_servico: TipoServico
  empresa_codigo: string
  empresa_nome: string
  empresa_cnpj?: string
  empresa_endereco?: string
  empresa_cidade?: string
  empresa_estado?: string
  empresa_telefone?: string
  empresa_email?: string
  passageiro: string
  cpf?: string
  tipo_passageiro?: string
  centro_custo?: string
  forma_pagamento?: FormaPagamento | string
  valor_total: number
  valor_custo: number
  markup: number
  status: StatusAtendimento
  status_original?: string
  emissor_codigo?: string
  emissor_nome?: string
  solicitante_nome?: string
  aprovador_nome?: string
  departamento?: string
  projeto?: string
  matricula?: string
  numero_requisicao?: string
  descricao?: string
  moeda?: string
  fornecedor?: string
  fornecedor_codigo?: string
  fornecedor_nome?: string
  fornecedor_cnpj?: string
  fornecedor_endereco?: string
  fornecedor_cidade?: string
  fornecedor_estado?: string
  fornecedor_telefone?: string
  fornecedor_email?: string
  cia?: string
  cia_iata?: string
  origem?: string
  destino?: string
  localizador?: string
  data_inicio_servico?: string
  data_fim_servico?: string
  qtd_trechos_diarias?: number
  tipo_emissao?: string
  tipo_roteiro?: string
  canal_venda?: string
  canal_captacao?: string
  situacao_contabil?: string
  co2_kg?: number
  total_tarifa?: number
  total_taxa?: number
  total_outras_txs?: number
  total_fee?: number
  total_nao_faturado?: number
  hotel_num_apts?: number
  hotel_categoria?: string
  hotel_tipo_apto?: string
  hotel_num_hospedes?: number
  hotel_regime?: string
  hotel_tipo_pagto?: string
  hotel_confirmacao?: string
  hotel_data_confirmacao?: string
  hotel_confirmado_por?: string
  info_adicionais?: string
  info_internas?: string
  wintour_dados?: Record<string, string | number | boolean | null | undefined>
  warnings: string[]
  raw?: Record<string, any>
}

export interface WintourImportResult {
  file_name: string
  source_format: WintourSourceFormat
  records: WintourSaleRecord[]
  summary: {
    total_vendas: number
    total_venda: number
    total_custo: number
    total_markup: number
    periodo_inicio?: string
    periodo_fim?: string
    por_cliente: Record<string, { qtd: number; valor: number }>
    por_emissor: Record<string, { qtd: number; valor: number }>
    por_tipo: Record<string, { qtd: number; valor: number }>
  }
  warnings: string[]
}

const FIELD_ALIASES = {
  venda: ['venda_numero', 'venda', 'numero_venda', 'numero', 'nr_venda', 'num_venda', 'nro_venda', 'codigo_venda', 'id_venda', 'idv_externo', 'num_bilhete', 'numero_requisicao'],
  data: ['data_venda', 'data', 'emissao', 'data_emissao', 'dt_venda', 'dt_emissao', 'data_lancamento', 'dt_interna_cadastro', 'data_requisicao'],
  produto: ['produto', 'tipo', 'tipo_servico', 'servico', 'tipo_produto', 'cod_produto', 'codigo_produto', 'grupo_produto'],
  empresaCodigo: ['cod_cliente', 'codigo_cliente', 'cliente_codigo', 'codigo_empresa', 'cod_empresa', 'cliente_cod', 'cliente'],
  empresaNome: ['nome_cliente', 'cliente_nome', 'razao_social', 'nome_fantasia', 'empresa', 'nome_empresa', 'sacado'],
  passageiro: ['pax', 'passageiro', 'hospede', 'hóspede', 'viajante', 'cliente_passageiro', 'nome_passageiro', 'beneficiario', 'passageiro_normalizado', 'pax_normalizado'],
  cpf: ['cpf', 'cpf_passageiro', 'documento', 'doc_passageiro'],
  centroCusto: ['centro_custo', 'cc', 'codigo_cc', 'centro_de_custo', 'ccustos_cliente', 'desc_ccustos_cliente', 'departamento'],
  total: ['total_tarifa', 'total_cliente', 'total_liquidado_cli', 'total', 'valor_total', 'a_receber', 'valor_venda', 'tarifa', 'saldo_receber', 'vl_total'],
  custo: ['saldo_pagar', 'a_pagar', 'custo', 'valor_custo', 'liq_du', 'liquido_due', 'vl_custo', 'total_fornecedor', 'total_liquidado_forn', 'tarifa_net'],
  markup: ['markup', 'previsao_lucro', 'previsão_lucro', 'prev_lucro', 'prev_lucro_bruto', 'lucro', 'over', 'margem'],
  status: ['status', 'cod_status', 'cód_status', 'situacao', 'situação'],
  emissor: ['cod_emissor', 'emissor', 'usuario', 'consultor', 'agente', 'vendedor'],
  emissorNome: ['nome_emissor', 'emissor_nome', 'nome_consultor', 'consultor_nome'],
  solicitante: ['solicitante', 'nome_solicitante', 'requisitante', 'demandante'],
  aprovador: ['aprovador', 'autorizador', 'nome_aprovador', 'nome_autorizador'],
  departamento: ['departamento', 'setor', 'area', 'área', 'lotacao', 'lotação'],
  projeto: ['projeto', 'obra', 'projeto_obra', 'cod_projeto'],
  matricula: ['matricula', 'matrícula', 'registro_funcional'],
  numeroRequisicao: ['numero_requisicao', 'nr_requisicao', 'num_requisicao', 'requisicao', 'solicitacao', 'numero_solicitacao'],
  formaPagamento: ['forma_pagamento', 'forma_de_pagamento', 'forma_pgt', 'forma_pgto', 'fop', 'pagamento'],
  descricao: ['rota_resumida', 'rota', 'descricao', 'descrição', 'observacao', 'observação', 'trecho', 'motivo_viagem'],
  fornecedor: ['fornecedor', 'hotel', 'nome_hotel', 'cia', 'cia_aerea', 'companhia', 'locadora'],
  origem: ['origem', 'origem_aeroporto', 'cidade_origem', 'from'],
  destino: ['destino', 'destino_aeroporto', 'cidade_destino', 'cid_dest_principal', 'to'],
  localizador: ['localizador', 'locator', 'pnr', 'reserva', 'numero_confirmacao', 'confirmação', 'confirmacao'],
  dataInicio: ['data_inicio', 'data_checkin', 'checkin', 'dt_check_in', 'data_ida', 'inicio_servico', 'dt_inicio', 'dt_inicio_servicos'],
  dataFim: ['data_fim', 'data_checkout', 'checkout', 'dt_check_out', 'data_volta', 'fim_servico', 'dt_fim', 'dt_fim_servicos'],
} as const

function normKey(value: any): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactKey(value: any): string {
  return normKey(value).replace(/\s+/g, '_')
}

function looseKey(value: any): string {
  return compactKey(value).replace(/_/g, '')
}

function keyMatches(key: string, aliases: readonly string[]): boolean {
  const compact = compactKey(key)
  const loose = looseKey(key)
  return aliases.some((alias) => {
    const aliasCompact = compactKey(alias)
    const aliasLoose = looseKey(alias)
    return (
      compact === aliasCompact ||
      compact.startsWith(`${aliasCompact}_`) ||
      compact.includes(aliasCompact) ||
      loose === aliasLoose ||
      loose.includes(aliasLoose)
    )
  })
}

function normSearch(value: any): string {
  return normKey(value).replace(/\s+/g, ' ')
}

function str(value: any): string {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function filled(value: any): string | undefined {
  const text = str(value)
  return text ? text : undefined
}

export function parseWintourNumber(value: any): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  let clean = String(value)
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/[^\d.,-]/g, '')

  if (clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.')
  } else if (clean.includes('.')) {
    const parts = clean.split('.')
    const last = parts[parts.length - 1]
    const decimalDot = parts.length === 2 && last.length > 0 && last.length <= 2
    clean = decimalDot ? clean : clean.replace(/\./g, '')
  }

  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : 0
}

function positiveNumber(value: any): number | undefined {
  const parsed = Math.abs(parseWintourNumber(value))
  return parsed ? parsed : undefined
}

export function parseWintourDate(value: any): string {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localDateToISODate(value)
  }
  if (typeof value === 'number' && value > 25000 && value < 90000) {
    return excelSerialToISODate(value)
  }

  const text = str(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)

  const br = text.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)
  if (br) {
    let year = br[3]
    if (year.length === 2) year = `${Number(year) > 50 ? '19' : '20'}${year}`
    return `${year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  }

  const isoLike = toISODateOnly(text)
  if (isoLike) return isoLike
  return ''
}

export function mapearTipoServicoWintour(value: string, descricao = ''): TipoServico {
  const text = `${value} ${descricao}`.toUpperCase()
  if (/\b(TKT|AER|AEREO|AÉREO|PASSAGEM|VOO|FLIGHT|GOL|LATAM|AZUL|AD|G3|LA|JJ)\b/.test(text)) return 'Aéreo'
  if (/\b(HTL|HOTEL|HOSPED|DIARIA|DIÁRIA|CHECKIN|CHECK-IN)\b/.test(text)) return 'Hotel'
  if (/\b(CAR|LOC|LOCADORA|CARRO|VEICULO|VEÍCULO|MOVIDA|LOCALIZA|UNIDAS)\b/.test(text)) return 'Carro'
  if (/\b(PAC|PACOTE|PACKAGE)\b/.test(text)) return 'Pacote'
  return 'Outro'
}

export function mapearStatusWintour(value: string): StatusAtendimento {
  const text = normSearch(value).toUpperCase()
  if (/\b(CA|CANCELADO|CANCELADA|CANCEL)\b/.test(text)) return 'cancelado'
  if (/\b(ND|PENDENTE|ABERTO|EM ANDAMENTO|NAO EMITIDO|NAO CONFIRMADO)\b/.test(text)) return 'em_andamento'
  if (/\b(AGUARDANDO|APROVACAO|APROVAÇÃO)\b/.test(text)) return 'aguardando_cliente'
  if (/\b(CF|CONFIRMADO|CONFIRMADA|EMITIDO|EMITIDA|FATURADO|FINALIZADO)\b/.test(text)) return 'finalizado'
  return value ? 'finalizado' : 'em_andamento'
}

function normalizarFormaPagamento(value: string): FormaPagamento | string | undefined {
  const text = str(value).toUpperCase()
  if (['IV', 'PX', 'CP', 'CC'].includes(text)) return text as FormaPagamento
  if (!text) return undefined
  return text
}

function scoreHeaderRow(row: any[]): number {
  const cells = row.map(compactKey).join('|')
  let score = 0
  for (const aliases of Object.values(FIELD_ALIASES)) {
    if (aliases.some((a) => cells.includes(compactKey(a)))) score++
  }
  return score
}

async function sheetToRows(bufferOrText: ArrayBuffer | string, ext: string): Promise<any[][]> {
  const XLSX = await import('xlsx')
  const wb = ext === 'csv'
    ? XLSX.read(bufferOrText as string, { type: 'string', raw: false })
    : XLSX.read(bufferOrText as ArrayBuffer, { type: 'array', cellDates: true, cellText: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' })
}

function findHeaderRow(rows: any[][]): number {
  let bestIdx = -1
  let bestScore = 0
  rows.slice(0, 30).forEach((row, idx) => {
    const score = scoreHeaderRow(row)
    if (score > bestScore) {
      bestScore = score
      bestIdx = idx
    }
  })
  return bestScore >= 3 ? bestIdx : 0
}

function rowValue(row: any[], headers: string[], aliases: readonly string[]): any {
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]
    if (!header) continue
    if (keyMatches(header, aliases)) {
      const value = row[i]
      if (value != null && String(value).trim() !== '') return value
    }
  }
  return ''
}

function makeRecord(raw: Record<string, any>, source: WintourSourceFormat): WintourSaleRecord {
  const descricao = str(raw.descricao)
  const produto = str(raw.produto || raw.fornecedorNome || raw.fornecedor)
  const total = parseWintourNumber(raw.total)
  const custo = Math.abs(parseWintourNumber(raw.custo))
  const markup = parseWintourNumber(raw.markup) || Math.max(0, total - custo)
  const data_venda = parseWintourDate(raw.data) || parseWintourDate(raw.dataInicio)
  const dataInicio = parseWintourDate(raw.dataInicio)
  const dataFim = parseWintourDate(raw.dataFim)
  const statusOriginal = str(raw.status)
  const wintourDados = raw.wintourDados || {}
  const record: WintourSaleRecord = {
    source,
    venda_numero: str(raw.venda),
    data_venda,
    produto,
    tipo_servico: mapearTipoServicoWintour(produto, descricao),
    empresa_codigo: str(raw.empresaCodigo),
    empresa_nome: str(raw.empresaNome),
    empresa_cnpj: filled(raw.empresaCnpj),
    empresa_endereco: filled(raw.empresaEndereco),
    empresa_cidade: filled(raw.empresaCidade),
    empresa_estado: filled(raw.empresaEstado),
    empresa_telefone: filled(raw.empresaTelefone),
    empresa_email: filled(raw.empresaEmail),
    passageiro: str(raw.passageiro),
    cpf: str(raw.cpf) || undefined,
    tipo_passageiro: filled(raw.tipoPassageiro),
    centro_custo: str(raw.centroCusto) || undefined,
    forma_pagamento: normalizarFormaPagamento(str(raw.formaPagamento)),
    valor_total: total,
    valor_custo: custo,
    markup,
    status: mapearStatusWintour(statusOriginal),
    status_original: statusOriginal,
    emissor_codigo: str(raw.emissor) || undefined,
    emissor_nome: str(raw.emissorNome) || str(raw.emissor) || undefined,
    solicitante_nome: str(raw.solicitante) || undefined,
    aprovador_nome: str(raw.aprovador) || undefined,
    departamento: str(raw.departamento) || undefined,
    projeto: str(raw.projeto) || undefined,
    matricula: str(raw.matricula) || undefined,
    numero_requisicao: str(raw.numeroRequisicao) || undefined,
    descricao,
    moeda: filled(raw.moeda),
    fornecedor: str(raw.fornecedorNome || raw.fornecedor) || undefined,
    fornecedor_codigo: filled(raw.fornecedorCodigo),
    fornecedor_nome: filled(raw.fornecedorNome),
    fornecedor_cnpj: filled(raw.fornecedorCnpj),
    fornecedor_endereco: filled(raw.fornecedorEndereco),
    fornecedor_cidade: filled(raw.fornecedorCidade),
    fornecedor_estado: filled(raw.fornecedorEstado),
    fornecedor_telefone: filled(raw.fornecedorTelefone),
    fornecedor_email: filled(raw.fornecedorEmail),
    cia: str(raw.cia || raw.fornecedorNome || raw.fornecedor) || undefined,
    cia_iata: filled(raw.ciaIata),
    origem: str(raw.origem) || undefined,
    destino: str(raw.destino) || undefined,
    localizador: str(raw.localizador) || undefined,
    data_inicio_servico: dataInicio || undefined,
    data_fim_servico: dataFim || undefined,
    qtd_trechos_diarias: positiveNumber(raw.qtdTrechosDiarias),
    tipo_emissao: filled(raw.tipoEmissao),
    tipo_roteiro: filled(raw.tipoRoteiro),
    canal_venda: filled(raw.canalVenda),
    canal_captacao: filled(raw.canalCaptacao),
    situacao_contabil: filled(raw.situacaoContabil),
    co2_kg: positiveNumber(raw.co2Kg),
    total_tarifa: positiveNumber(raw.totalTarifa),
    total_taxa: positiveNumber(raw.totalTaxa),
    total_outras_txs: positiveNumber(raw.totalOutrasTxs),
    total_fee: positiveNumber(raw.totalFee),
    total_nao_faturado: positiveNumber(raw.totalNaoFaturado),
    hotel_num_apts: positiveNumber(raw.hotelNumApts),
    hotel_categoria: filled(raw.hotelCategoria),
    hotel_tipo_apto: filled(raw.hotelTipoApto),
    hotel_num_hospedes: positiveNumber(raw.hotelNumHospedes),
    hotel_regime: filled(raw.hotelRegime),
    hotel_tipo_pagto: filled(raw.hotelTipoPagto),
    hotel_confirmacao: filled(raw.hotelConfirmacao),
    hotel_data_confirmacao: parseWintourDate(raw.hotelDataConfirmacao) || undefined,
    hotel_confirmado_por: filled(raw.hotelConfirmadoPor),
    info_adicionais: filled(raw.infoAdicionais),
    info_internas: filled(raw.infoInternas),
    wintour_dados: wintourDados,
    warnings: [],
  }

  if (!record.venda_numero) record.warnings.push('Sem numero de venda')
  if (!record.data_venda) record.warnings.push('Sem data de venda')
  if (!record.passageiro) record.warnings.push('Sem passageiro/hospede')
  if (!record.empresa_nome && !record.empresa_codigo) record.warnings.push('Sem cliente/empresa')
  if (!record.valor_total && !record.valor_custo) record.warnings.push('Sem valores financeiros')
  return record
}

function parsePlanilhaWintour(fileName: string, rows: any[][], source: WintourSourceFormat): WintourImportResult {
  const headerIdx = findHeaderRow(rows)
  const headers = (rows[headerIdx] || []).map(compactKey)
  const records: WintourSaleRecord[] = []

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    if (!row.some((cell) => str(cell))) continue
    const raw = {
      venda: rowValue(row, headers, FIELD_ALIASES.venda),
      data: rowValue(row, headers, FIELD_ALIASES.data),
      produto: rowValue(row, headers, FIELD_ALIASES.produto),
      empresaCodigo: rowValue(row, headers, FIELD_ALIASES.empresaCodigo),
      empresaNome: rowValue(row, headers, FIELD_ALIASES.empresaNome),
      passageiro: rowValue(row, headers, FIELD_ALIASES.passageiro),
      cpf: rowValue(row, headers, FIELD_ALIASES.cpf),
      centroCusto: rowValue(row, headers, FIELD_ALIASES.centroCusto),
      total: rowValue(row, headers, FIELD_ALIASES.total),
      custo: rowValue(row, headers, FIELD_ALIASES.custo),
      markup: rowValue(row, headers, FIELD_ALIASES.markup),
      status: rowValue(row, headers, FIELD_ALIASES.status),
      emissor: rowValue(row, headers, FIELD_ALIASES.emissor),
      emissorNome: rowValue(row, headers, FIELD_ALIASES.emissorNome),
      solicitante: rowValue(row, headers, FIELD_ALIASES.solicitante),
      aprovador: rowValue(row, headers, FIELD_ALIASES.aprovador),
      departamento: rowValue(row, headers, FIELD_ALIASES.departamento),
      projeto: rowValue(row, headers, FIELD_ALIASES.projeto),
      matricula: rowValue(row, headers, FIELD_ALIASES.matricula),
      numeroRequisicao: rowValue(row, headers, FIELD_ALIASES.numeroRequisicao),
      formaPagamento: rowValue(row, headers, FIELD_ALIASES.formaPagamento),
      descricao: rowValue(row, headers, FIELD_ALIASES.descricao),
      fornecedor: rowValue(row, headers, FIELD_ALIASES.fornecedor),
      origem: rowValue(row, headers, FIELD_ALIASES.origem),
      destino: rowValue(row, headers, FIELD_ALIASES.destino),
      localizador: rowValue(row, headers, FIELD_ALIASES.localizador),
      dataInicio: rowValue(row, headers, FIELD_ALIASES.dataInicio),
      dataFim: rowValue(row, headers, FIELD_ALIASES.dataFim),
      linha: i + 1,
    }
    const record = makeRecord(raw, source)
    if (record.venda_numero || record.passageiro || record.empresa_nome) records.push(record)
  }

  return buildWintourResult(fileName, source, records)
}

function xmlValue(element: Element, aliases: readonly string[]): string {
  for (const attr of Array.from(element.attributes)) {
    if (keyMatches(attr.name, aliases)) return str(attr.value)
  }

  const children = Array.from(element.children)
  for (const child of children) {
    if (keyMatches(child.tagName, aliases)) return str(child.textContent)
  }

  for (const child of Array.from(element.querySelectorAll('*'))) {
    if (keyMatches(child.tagName, aliases)) return str(child.textContent)
  }

  return ''
}

function xmlDirect(element: Element, name: string): string {
  const wanted = looseKey(name)
  const child = Array.from(element.children).find((item) => looseKey(item.tagName) === wanted)
  return child ? str(child.textContent) : ''
}

function xmlPath(element: Element, ...path: string[]): string {
  let current: Element | undefined = element
  for (const part of path) {
    const wanted = looseKey(part)
    current = Array.from(current.children).find((item) => looseKey(item.tagName) === wanted)
    if (!current) return ''
  }
  return str(current.textContent)
}

function joinEndereco(...parts: string[]): string {
  return parts.map(str).filter(Boolean).join(', ')
}

function compactWintourDados(data: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => {
      if (value == null || value === '') return false
      if (typeof value === 'number' && value === 0) return false
      return true
    })
  ) as Record<string, string | number | boolean | null | undefined>
}

function maskSensitive(value: string): string {
  const text = str(value)
  if (!text) return ''
  if (text.includes('*') || text.includes('X')) return text
  const digits = text.replace(/\D/g, '')
  if (digits.length <= 4) return text
  return `****${digits.slice(-4)}`
}

function rawFromWintourBilhete(element: Element, index: number): Record<string, any> {
  const empresaEndereco = joinEndereco(
    xmlPath(element, 'dados_princ_cli', 'endereco'),
    xmlPath(element, 'dados_princ_cli', 'numero'),
    xmlPath(element, 'dados_princ_cli', 'complemento'),
    xmlPath(element, 'dados_princ_cli', 'bairro')
  )
  const fornecedorEndereco = joinEndereco(
    xmlPath(element, 'dados_princ_forn', 'endereco'),
    xmlPath(element, 'dados_princ_forn', 'numero'),
    xmlPath(element, 'dados_princ_forn', 'complemento'),
    xmlPath(element, 'dados_princ_forn', 'bairro')
  )
  const hotelCheckIn = xmlPath(element, 'roteiro', 'hotel', 'dt_check_in')
  const hotelCheckOut = xmlPath(element, 'roteiro', 'hotel', 'dt_check_out')
  const dados: Record<string, string | number | boolean | null | undefined> = {
    idv_externo: xmlDirect(element, 'idv_externo'),
    id_posto_atendimento: xmlDirect(element, 'id_posto_atendimento'),
    dt_interna_cadastro: xmlDirect(element, 'dt_interna_cadastro'),
    data_lancamento: xmlDirect(element, 'data_lancamento'),
    dt_hr_ult_alteracao: xmlDirect(element, 'dt_hr_ult_alteracao'),
    codigo_produto: xmlDirect(element, 'codigo_produto'),
    grupo_produto: xmlDirect(element, 'grupo_produto'),
    codigo_fornecedor: xmlDirect(element, 'codigo_fornecedor'),
    fornecedor_codigo: xmlDirect(element, 'fornecedor'),
    fornecedor_nome: xmlPath(element, 'dados_princ_forn', 'nome_fantasia') || xmlPath(element, 'dados_princ_forn', 'razao_social'),
    cia_iata: xmlDirect(element, 'cia_iata'),
    prestador_svc: xmlDirect(element, 'prestador_svc'),
    num_bilhete: xmlDirect(element, 'num_bilhete'),
    localizador: xmlDirect(element, 'localizador'),
    tour_code: xmlDirect(element, 'tour_code'),
    forma_de_pagamento: xmlDirect(element, 'forma_de_pagamento'),
    cartao_mp_mascarado: maskSensitive(xmlDirect(element, 'cartao_mp')),
    cartao_cp_mascarado: maskSensitive(xmlDirect(element, 'cartao_cp')),
    num_cc_mascarado: maskSensitive(xmlDirect(element, 'num_cc')),
    cod_autorizacao_cc_mascarado: maskSensitive(xmlDirect(element, 'cod_autorizacao_cc')),
    ccustos_agencia: xmlDirect(element, 'ccustos_agencia'),
    cliente_codigo: xmlDirect(element, 'cliente'),
    cliente_nome: xmlPath(element, 'dados_princ_cli', 'razao_social') || xmlPath(element, 'dados_princ_cli', 'nome_fantasia'),
    ccustos_cliente: xmlDirect(element, 'ccustos_cliente'),
    desc_ccustos_cliente: xmlDirect(element, 'desc_ccustos_cliente'),
    numero_requisicao: xmlDirect(element, 'numero_requisicao'),
    data_requisicao: xmlDirect(element, 'data_requisicao'),
    passageiro: xmlDirect(element, 'passageiro'),
    tipo_passageiro: xmlDirect(element, 'tipo_passageiro'),
    passageiro_normalizado: xmlDirect(element, 'passageiro_normalizado'),
    pax_normalizado: xmlDirect(element, 'pax_normalizado'),
    solicitante: xmlDirect(element, 'solicitante'),
    aprovador: xmlDirect(element, 'aprovador'),
    departamento: xmlDirect(element, 'departamento'),
    projeto: xmlDirect(element, 'projeto'),
    matricula: xmlDirect(element, 'matricula'),
    motivo_viagem: xmlDirect(element, 'motivo_viagem'),
    tipo_domest_inter: xmlDirect(element, 'tipo_domest_inter'),
    canal_captacao: xmlDirect(element, 'canal_captacao'),
    canal_venda: xmlDirect(element, 'canal_venda'),
    cod_status: xmlDirect(element, 'cod_status'),
    data_status: xmlDirect(element, 'data_status'),
    usr_status: xmlDirect(element, 'usr_status'),
    situacao_contabil: xmlDirect(element, 'situacao_contabil'),
    dt_inicio_servicos: xmlDirect(element, 'dt_inicio_servicos'),
    dt_fim_servicos: xmlDirect(element, 'dt_fim_servicos'),
    qtd_trechos_diarias: positiveNumber(xmlDirect(element, 'qtd_trechos_diarias')),
    rota_resumida: xmlDirect(element, 'rota_resumida'),
    cid_dest_principal: xmlDirect(element, 'cid_dest_principal'),
    tipo_emissao: xmlDirect(element, 'tipo_emissao'),
    co2_kg: positiveNumber(xmlDirect(element, 'co2_kg')),
    tipo_roteiro: xmlDirect(element, 'tipo_roteiro'),
    moeda: xmlDirect(element, 'moeda'),
    total_fornecedor: Math.abs(parseWintourNumber(xmlDirect(element, 'total_fornecedor'))),
    total_cliente: parseWintourNumber(xmlDirect(element, 'total_cliente')),
    prev_lucro_bruto: parseWintourNumber(xmlDirect(element, 'prev_lucro_bruto')),
    total_tarifa: parseWintourNumber(xmlDirect(element, 'total_tarifa')),
    total_taxa: parseWintourNumber(xmlDirect(element, 'total_taxa')),
    total_du: parseWintourNumber(xmlDirect(element, 'total_du')),
    total_outras_txs: parseWintourNumber(xmlDirect(element, 'total_outras_txs')),
    total_fee: parseWintourNumber(xmlDirect(element, 'total_fee')),
    total_nao_faturado: parseWintourNumber(xmlDirect(element, 'total_nao_faturado')),
    dt_liq_cliente: xmlDirect(element, 'dt_liq_cliente'),
    dt_liq_fornecedor: xmlDirect(element, 'dt_liq_fornecedor'),
    interface_lct: xmlDirect(element, 'interface_lct'),
    hotel_nr_apts: positiveNumber(xmlPath(element, 'roteiro', 'hotel', 'nr_apts')),
    hotel_categ_apt: xmlPath(element, 'roteiro', 'hotel', 'categ_apt'),
    hotel_tipo_apt: xmlPath(element, 'roteiro', 'hotel', 'tipo_apt'),
    hotel_dt_check_in: hotelCheckIn,
    hotel_dt_check_out: hotelCheckOut,
    hotel_nr_hospedes: positiveNumber(xmlPath(element, 'roteiro', 'hotel', 'nr_hospedes')),
    hotel_reg_alimentacao: xmlPath(element, 'roteiro', 'hotel', 'reg_alimentacao'),
    hotel_cod_tipo_pagto: xmlPath(element, 'roteiro', 'hotel', 'cod_tipo_pagto'),
    hotel_nr_confirmacao: xmlPath(element, 'roteiro', 'hotel', 'nr_confirmacao'),
    hotel_dt_confirmacao: xmlPath(element, 'roteiro', 'hotel', 'dt_confirmacao'),
    hotel_confirmado_por: xmlPath(element, 'roteiro', 'hotel', 'confirmado_por'),
    info_adicionais: xmlDirect(element, 'info_adicionais'),
    info_internas: xmlDirect(element, 'info_internas'),
  }

  return {
    venda: xmlDirect(element, 'idv_externo') || xmlDirect(element, 'num_bilhete') || xmlDirect(element, 'numero_requisicao'),
    data: xmlDirect(element, 'data_lancamento') || xmlDirect(element, 'dt_interna_cadastro'),
    produto: xmlDirect(element, 'grupo_produto') || xmlDirect(element, 'codigo_produto'),
    empresaCodigo: xmlDirect(element, 'cliente'),
    empresaNome: xmlPath(element, 'dados_princ_cli', 'razao_social') || xmlPath(element, 'dados_princ_cli', 'nome_fantasia') || xmlDirect(element, 'cliente'),
    empresaCnpj: xmlPath(element, 'dados_princ_cli', 'cpf_cnpj'),
    empresaEndereco,
    empresaCidade: xmlPath(element, 'dados_princ_cli', 'cidade'),
    empresaEstado: xmlPath(element, 'dados_princ_cli', 'estado'),
    empresaTelefone: xmlPath(element, 'dados_princ_cli', 'tel') || xmlPath(element, 'dados_princ_cli', 'celular'),
    empresaEmail: xmlPath(element, 'dados_princ_cli', 'email'),
    passageiro: xmlDirect(element, 'passageiro') || xmlDirect(element, 'passageiro_normalizado') || xmlDirect(element, 'pax_normalizado'),
    tipoPassageiro: xmlDirect(element, 'tipo_passageiro'),
    cpf: '',
    centroCusto: xmlDirect(element, 'ccustos_cliente') || xmlDirect(element, 'desc_ccustos_cliente') || xmlDirect(element, 'departamento'),
    total: xmlDirect(element, 'total_cliente') || xmlDirect(element, 'total_tarifa'),
    custo: xmlDirect(element, 'total_fornecedor') || xmlDirect(element, 'total_liquidado_forn') || xmlDirect(element, 'tarifa_net'),
    markup: xmlDirect(element, 'prev_lucro_bruto'),
    status: xmlDirect(element, 'cod_status'),
    emissor: xmlDirect(element, 'emissor'),
    emissorNome: xmlDirect(element, 'emissor'),
    solicitante: xmlDirect(element, 'solicitante'),
    aprovador: xmlDirect(element, 'aprovador'),
    departamento: xmlDirect(element, 'departamento'),
    projeto: xmlDirect(element, 'projeto'),
    matricula: xmlDirect(element, 'matricula'),
    numeroRequisicao: xmlDirect(element, 'numero_requisicao'),
    moeda: xmlDirect(element, 'moeda'),
    formaPagamento: xmlDirect(element, 'forma_de_pagamento'),
    descricao: xmlDirect(element, 'rota_resumida') || xmlDirect(element, 'motivo_viagem'),
    fornecedor: xmlPath(element, 'dados_princ_forn', 'nome_fantasia') || xmlPath(element, 'dados_princ_forn', 'razao_social') || xmlDirect(element, 'fornecedor'),
    fornecedorCodigo: xmlDirect(element, 'fornecedor') || xmlDirect(element, 'codigo_fornecedor'),
    fornecedorNome: xmlPath(element, 'dados_princ_forn', 'nome_fantasia') || xmlPath(element, 'dados_princ_forn', 'razao_social'),
    fornecedorCnpj: xmlPath(element, 'dados_princ_forn', 'cpf_cnpj'),
    fornecedorEndereco,
    fornecedorCidade: xmlPath(element, 'dados_princ_forn', 'cidade'),
    fornecedorEstado: xmlPath(element, 'dados_princ_forn', 'estado'),
    fornecedorTelefone: xmlPath(element, 'dados_princ_forn', 'tel') || xmlPath(element, 'dados_princ_forn', 'celular'),
    fornecedorEmail: xmlPath(element, 'dados_princ_forn', 'email'),
    cia: xmlPath(element, 'dados_princ_cia', 'nome_fantasia') || xmlPath(element, 'dados_princ_cia', 'razao_social'),
    ciaIata: xmlDirect(element, 'cia_iata'),
    origem: '',
    destino: xmlDirect(element, 'cid_dest_principal') || xmlPath(element, 'dados_princ_forn', 'cidade'),
    localizador: xmlPath(element, 'roteiro', 'hotel', 'nr_confirmacao') || xmlDirect(element, 'localizador'),
    dataInicio: hotelCheckIn || xmlDirect(element, 'dt_inicio_servicos'),
    dataFim: hotelCheckOut || xmlDirect(element, 'dt_fim_servicos'),
    qtdTrechosDiarias: xmlDirect(element, 'qtd_trechos_diarias'),
    tipoEmissao: xmlDirect(element, 'tipo_emissao'),
    tipoRoteiro: xmlDirect(element, 'tipo_roteiro'),
    canalVenda: xmlDirect(element, 'canal_venda'),
    canalCaptacao: xmlDirect(element, 'canal_captacao'),
    situacaoContabil: xmlDirect(element, 'situacao_contabil'),
    co2Kg: xmlDirect(element, 'co2_kg'),
    totalTarifa: xmlDirect(element, 'total_tarifa'),
    totalTaxa: xmlDirect(element, 'total_taxa'),
    totalOutrasTxs: xmlDirect(element, 'total_outras_txs'),
    totalFee: xmlDirect(element, 'total_fee'),
    totalNaoFaturado: xmlDirect(element, 'total_nao_faturado'),
    hotelNumApts: xmlPath(element, 'roteiro', 'hotel', 'nr_apts'),
    hotelCategoria: xmlPath(element, 'roteiro', 'hotel', 'categ_apt'),
    hotelTipoApto: xmlPath(element, 'roteiro', 'hotel', 'tipo_apt'),
    hotelNumHospedes: xmlPath(element, 'roteiro', 'hotel', 'nr_hospedes'),
    hotelRegime: xmlPath(element, 'roteiro', 'hotel', 'reg_alimentacao'),
    hotelTipoPagto: xmlPath(element, 'roteiro', 'hotel', 'cod_tipo_pagto'),
    hotelConfirmacao: xmlPath(element, 'roteiro', 'hotel', 'nr_confirmacao'),
    hotelDataConfirmacao: xmlPath(element, 'roteiro', 'hotel', 'dt_confirmacao'),
    hotelConfirmadoPor: xmlPath(element, 'roteiro', 'hotel', 'confirmado_por'),
    infoAdicionais: xmlDirect(element, 'info_adicionais'),
    infoInternas: xmlDirect(element, 'info_internas'),
    wintourDados: compactWintourDados(dados),
    xml_tag: element.tagName,
    xml_index: index + 1,
    wintour_layout: 'bilhetes/bilhete',
  }
}

function scoreXmlElement(element: Element): number {
  let score = 0
  for (const aliases of Object.values(FIELD_ALIASES)) {
    if (xmlValue(element, aliases)) score++
  }
  return score
}

function parseXmlWintour(fileName: string, text: string): WintourImportResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML invalido. Exporte novamente pelo Wintour.')

  const elements = doc.getElementsByTagName('*')
  const bilhetes: Element[] = []
  for (let i = 0; i < elements.length; i++) {
    const el = elements.item(i)
    if (el && looseKey(el.tagName) === 'bilhete') bilhetes.push(el)
  }

  if (bilhetes.length > 0) {
    const records = bilhetes
      .map((el, index) => makeRecord(rawFromWintourBilhete(el, index), 'xml'))
      .filter((record) => record.venda_numero || record.passageiro || record.empresa_nome)

    return buildWintourResult(fileName, 'xml', records)
  }

  const recordTags = new Set(['venda', 'vendas', 'sale', 'sales', 'registro', 'registros', 'item', 'itens', 'emissao', 'emissoes', 'bilhete', 'reserva'])
  const rawCandidates: Element[] = []
  for (let i = 0; i < elements.length; i++) {
    const el = elements.item(i)
    if (!el) continue
    const tag = compactKey(el.tagName)
    const score = scoreXmlElement(el)
    if ((recordTags.has(tag) && score >= 2) || score >= 4) rawCandidates.push(el)
  }

  const candidates = rawCandidates.filter((el) => !rawCandidates.some((other) => other !== el && el.contains(other)))
  const usable = candidates.length > 0 ? candidates : [doc.documentElement]

  const records = usable
    .map((el, index) => makeRecord(
      looseKey(el.tagName) === 'bilhete'
        ? rawFromWintourBilhete(el, index)
        : {
            venda: xmlValue(el, FIELD_ALIASES.venda),
            data: xmlValue(el, FIELD_ALIASES.data),
            produto: xmlValue(el, FIELD_ALIASES.produto),
            empresaCodigo: xmlValue(el, FIELD_ALIASES.empresaCodigo),
            empresaNome: xmlValue(el, FIELD_ALIASES.empresaNome),
            passageiro: xmlValue(el, FIELD_ALIASES.passageiro),
            cpf: xmlValue(el, FIELD_ALIASES.cpf),
            centroCusto: xmlValue(el, FIELD_ALIASES.centroCusto),
            total: xmlValue(el, FIELD_ALIASES.total),
            custo: xmlValue(el, FIELD_ALIASES.custo),
            markup: xmlValue(el, FIELD_ALIASES.markup),
            status: xmlValue(el, FIELD_ALIASES.status),
            emissor: xmlValue(el, FIELD_ALIASES.emissor),
            emissorNome: xmlValue(el, FIELD_ALIASES.emissorNome),
            solicitante: xmlValue(el, FIELD_ALIASES.solicitante),
            aprovador: xmlValue(el, FIELD_ALIASES.aprovador),
            departamento: xmlValue(el, FIELD_ALIASES.departamento),
            projeto: xmlValue(el, FIELD_ALIASES.projeto),
            matricula: xmlValue(el, FIELD_ALIASES.matricula),
            numeroRequisicao: xmlValue(el, FIELD_ALIASES.numeroRequisicao),
            formaPagamento: xmlValue(el, FIELD_ALIASES.formaPagamento),
            descricao: xmlValue(el, FIELD_ALIASES.descricao),
            fornecedor: xmlValue(el, FIELD_ALIASES.fornecedor),
            origem: xmlValue(el, FIELD_ALIASES.origem),
            destino: xmlValue(el, FIELD_ALIASES.destino),
            localizador: xmlValue(el, FIELD_ALIASES.localizador),
            dataInicio: xmlValue(el, FIELD_ALIASES.dataInicio),
            dataFim: xmlValue(el, FIELD_ALIASES.dataFim),
            xml_tag: el.tagName,
            xml_index: index + 1,
          },
      'xml'
    ))
    .filter((record) => record.venda_numero || record.passageiro || record.empresa_nome)

  return buildWintourResult(fileName, 'xml', records)
}

export async function parseWintourFile(file: File): Promise<WintourImportResult> {
  const ext = file.name.toLowerCase().split('.').pop() || ''
  if (ext === 'xml') {
    return parseXmlWintour(file.name, await file.text())
  }
  if (ext === 'csv') {
    return parsePlanilhaWintour(file.name, await sheetToRows(await file.text(), 'csv'), 'csv')
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return parsePlanilhaWintour(file.name, await sheetToRows(await file.arrayBuffer(), ext), 'xlsx')
  }
  throw new Error('Formato Wintour nao suportado nesta tela. Use XML, XLSX, XLS ou CSV.')
}

export function buildWintourResult(fileName: string, source: WintourSourceFormat, records: WintourSaleRecord[]): WintourImportResult {
  const por_cliente: Record<string, { qtd: number; valor: number }> = {}
  const por_emissor: Record<string, { qtd: number; valor: number }> = {}
  const por_tipo: Record<string, { qtd: number; valor: number }> = {}
  let total_venda = 0
  let total_custo = 0
  let total_markup = 0
  let periodo_inicio = ''
  let periodo_fim = ''

  for (const record of records) {
    total_venda += record.valor_total
    total_custo += record.valor_custo
    total_markup += record.markup

    const cliente = record.empresa_nome || record.empresa_codigo || 'Nao identificado'
    por_cliente[cliente] = por_cliente[cliente] || { qtd: 0, valor: 0 }
    por_cliente[cliente].qtd++
    por_cliente[cliente].valor += record.valor_total

    const emissor = record.emissor_codigo || 'Nao identificado'
    por_emissor[emissor] = por_emissor[emissor] || { qtd: 0, valor: 0 }
    por_emissor[emissor].qtd++
    por_emissor[emissor].valor += record.valor_total

    const tipo = record.tipo_servico
    por_tipo[tipo] = por_tipo[tipo] || { qtd: 0, valor: 0 }
    por_tipo[tipo].qtd++
    por_tipo[tipo].valor += record.valor_total

    if (record.data_venda) {
      if (!periodo_inicio || record.data_venda < periodo_inicio) periodo_inicio = record.data_venda
      if (!periodo_fim || record.data_venda > periodo_fim) periodo_fim = record.data_venda
    }
  }

  const semVenda = records.filter((r) => !r.venda_numero).length
  const semEmpresa = records.filter((r) => !r.empresa_nome && !r.empresa_codigo).length
  const warnings = [
    semVenda ? `${semVenda} registro(s) sem numero de venda; serao deduplicados por fingerprint.` : '',
    semEmpresa ? `${semEmpresa} registro(s) sem empresa/cliente; exigem revisao antes de importar.` : '',
  ].filter(Boolean)

  return {
    file_name: fileName,
    source_format: source,
    records,
    summary: {
      total_vendas: records.length,
      total_venda,
      total_custo,
      total_markup,
      periodo_inicio: periodo_inicio || undefined,
      periodo_fim: periodo_fim || undefined,
      por_cliente,
      por_emissor,
      por_tipo,
    },
    warnings,
  }
}

export function criarFingerprintWintour(record: WintourSaleRecord): string {
  if (record.venda_numero) {
    const empresa = normSearch(record.empresa_codigo || record.empresa_nome) || 'sem_empresa'
    return `venda:${empresa}:${normSearch(record.venda_numero)}`
  }
  return `fp:${normSearch([
    record.data_venda,
    record.empresa_codigo || record.empresa_nome,
    record.passageiro,
    record.tipo_servico,
    record.valor_total || record.valor_custo,
    record.localizador,
  ].join('|'))}`
}

export interface WintourDuplicateIndex {
  bySale: Map<string, Atendimento[]>
  byCompanySale: Map<string, Atendimento[]>
  byFingerprint: Map<string, Atendimento[]>
  byCompanyFingerprint: Map<string, Atendimento[]>
}

export function criarIndiceDuplicatasWintour(atendimentos: Atendimento[]): WintourDuplicateIndex {
  const index: WintourDuplicateIndex = {
    bySale: new Map(),
    byCompanySale: new Map(),
    byFingerprint: new Map(),
    byCompanyFingerprint: new Map(),
  }
  atendimentos.forEach((atendimento) => registrarAtendimentoNoIndiceWintour(index, atendimento))
  return index
}

export function registrarAtendimentoNoIndiceWintour(index: WintourDuplicateIndex, atendimento: Atendimento): void {
  const empresaId = String(atendimento.empresa_id || '').trim()
  const venda = String(atendimento.venda_numero || '').trim()
  if (venda) {
    addUniqueIndexValue(index.bySale, venda, atendimento)
    if (empresaId) addUniqueIndexValue(index.byCompanySale, `${empresaId}|${venda}`, atendimento)
  }

  const fingerprint = String(atendimento.observacoes_internas || '')
    .match(/wintour_fingerprint=([^|\s]+)/)?.[1]
  if (fingerprint) {
    addUniqueIndexValue(index.byFingerprint, fingerprint, atendimento)
    if (empresaId) addUniqueIndexValue(index.byCompanyFingerprint, `${empresaId}|${fingerprint}`, atendimento)
  }
}

export function encontrarDuplicataWintourNoIndice(
  record: WintourSaleRecord,
  index: WintourDuplicateIndex,
  empresaId?: string,
): Atendimento | undefined {
  const venda = String(record.venda_numero || '').trim()
  if (venda) {
    const candidatos = empresaId
      ? index.byCompanySale.get(`${empresaId}|${venda}`) || []
      : index.bySale.get(venda) || []
    if (candidatos.length === 1) return candidatos[0]
  }

  const fingerprint = criarFingerprintWintour(record)
  const candidatos = empresaId
    ? index.byCompanyFingerprint.get(`${empresaId}|${fingerprint}`) || []
    : index.byFingerprint.get(fingerprint) || []
  return candidatos[0]
}

export function encontrarDuplicataWintour(
  record: WintourSaleRecord,
  atendimentos: Atendimento[],
  empresaId?: string,
): Atendimento | undefined {
  return encontrarDuplicataWintourNoIndice(record, criarIndiceDuplicatasWintour(atendimentos), empresaId)
}

function addUniqueIndexValue(map: Map<string, Atendimento[]>, key: string, atendimento: Atendimento): void {
  const current = map.get(key)
  if (!current) {
    map.set(key, [atendimento])
    return
  }
  const existingIndex = current.findIndex((item) => item.id === atendimento.id)
  if (existingIndex >= 0) current[existingIndex] = atendimento
  else current.push(atendimento)
}

export function encontrarEmpresaWintour(record: WintourSaleRecord, empresas: Empresa[]): { empresa?: Empresa; score: number; motivo: string } {
  const codigo = normSearch(record.empresa_codigo)
  if (codigo) {
    const byCode = empresas.find((empresa) => normSearch(empresa.codigo_cliente || '') === codigo)
    if (byCode) return { empresa: byCode, score: 100, motivo: 'codigo_cliente' }
  }

  const alvo = normSearch(record.empresa_nome)
  if (!alvo) return { score: 0, motivo: 'sem_nome' }
  const tokens = alvo.split(' ').filter((token) => token.length > 2)

  const ranked = empresas
    .map((empresa) => {
      const nome = normSearch(empresa.nome)
      let score = 0
      if (nome === alvo) score = 100
      else if (nome.includes(alvo) || alvo.includes(nome)) score = 86
      else score = tokens.reduce((sum, token) => sum + (nome.includes(token) ? 12 : 0), 0)
      return { empresa, score }
    })
    .filter((item) => item.score >= 36)
    .sort((a, b) => b.score - a.score)

  return ranked[0] ? { ...ranked[0], motivo: 'nome' } : { score: 0, motivo: 'nao_encontrada' }
}

export function encontrarFuncionarioWintour(record: WintourSaleRecord, funcionarios: Funcionario[], empresaId?: string): { funcionario?: Funcionario; score: number } {
  const alvo = normSearch(record.passageiro)
  if (!alvo) return { score: 0 }
  const confiavel = encontrarFuncionarioConfiavel(
    funcionarios,
    { company_id: empresaId, nome: record.passageiro, cpf: record.cpf || '', matricula: record.matricula || '' },
    empresaId,
  )
  if (confiavel) return { funcionario: confiavel, score: 100 }

  const porNome = encontrarFuncionarioPorNomeInteligente(funcionarios, record.passageiro, empresaId, 84)
  if (porNome && !porNome.ambiguo) return { funcionario: porNome.funcionario, score: porNome.score }

  return { score: porNome?.score || 0 }
}

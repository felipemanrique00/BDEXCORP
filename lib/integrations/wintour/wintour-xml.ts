export const WINTOUR_MAX_SALES_PER_FILE = 100
export const WINTOUR_CREATION_XML_VERSION = 4
export const WINTOUR_XML_DECLARATION = '<?xml version="1.0" encoding="iso-8859-1"?>'

export type WintourMoney = number | string
export type WintourDate = string
export type WintourTime = string

export const WINTOUR_PAYMENT_METHODS = [
  'CA', 'PX', 'PD', 'IV', 'GR', 'CC', 'PL', 'CV', 'DF', 'CS', 'EB', 'CD', 'BT', 'AH',
  'IT', 'VR', 'CT', 'CP', 'RP', 'VP', 'CE', 'VC', 'AF', 'MP', 'FI', 'EP', 'EF', 'S1',
  'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'TR', 'VT', 'DM', 'CM', 'MF', '3F', 'XX',
] as const

export type WintourPaymentMethod = typeof WINTOUR_PAYMENT_METHODS[number]

export const WINTOUR_VALUE_CODES = [
  'tarifa', 'taxa', 'taxa_du', 'taxa_cartao_du', 'fee', 'fee2', 'outras_txs',
  'outras_txs2', 'outras_txs3', 'comissao_ag', 'over_ag', 'iss', 'desconto_cliente',
  'markup', 'comissao_emissor', 'over_emissor', 'comissao_promotor', 'comissao_gerente',
  'full_fare', 'best_fare', 'best_fare_disp', 'cambio', 'tarifa_moeda_estrang',
  'taxa_moeda_estrang', 'tx_du_moeda_estrang', 'outras_txs_moeda_estrang',
  'outras_txs2_moeda_estrang', 'outras_txs3_moeda_estrang', 'fee_moeda_estrang',
  'comissao_cliente', 'comissao_mp', 'tx_emissao', 'tx_cartao_virtual',
] as const

export type WintourValueCode = typeof WINTOUR_VALUE_CODES[number]

export const WINTOUR_DUE_DATE_CODES = [
  'cliente', 'fornecedor', 'cartao_mp', 'cartao_cp', 'kandir', 'emissor', 'promotor',
  'gerente', 'comissao_cliente',
] as const

export type WintourDueDateCode = typeof WINTOUR_DUE_DATE_CODES[number]

export interface WintourSaleValue {
  codigo: WintourValueCode
  valor: WintourMoney
  valor_df?: WintourMoney
  valor_mp?: WintourMoney
}

export interface WintourDueDate {
  codigo: WintourDueDateCode
  valor: WintourDate
}

export interface WintourCostCenterAllocation {
  ccustos_cliente: string
  percentual: WintourMoney
}

export interface WintourAirLeg {
  cia_iata: string
  numero_voo?: string
  aeroporto_origem: string
  aeroporto_destino: string
  data_partida?: WintourDate
  hora_partida?: WintourTime
  data_chegada?: WintourDate
  hora_chegada?: WintourTime
  classe?: string
  base_tarifaria?: string
  ticket_designator?: string
  conexao_arp_partida?: 0 | 1
  conexao_arp_chegada?: 0 | 1
  co2_kg?: number
}

export interface WintourHotelRoute {
  nr_apts: number
  categ_apt?: string
  tipo_apt: string
  dt_check_in: WintourDate
  dt_check_out: WintourDate
  nr_hospedes?: number
  reg_alimentacao?: string
  cod_tipo_pagto?: string
  dt_confirmacao?: WintourDate
  confirmado_por?: string
}

export interface WintourCarRoute {
  cidade_retirada?: string
  local_retirada: string
  dt_retirada: WintourDate
  hr_retirada?: WintourTime
  local_devolucao?: string
  dt_devolucao?: WintourDate
  hr_devolucao?: WintourTime
  categ_veiculo: string
  cod_tipo_pagto?: string
  dt_confirmacao?: WintourDate
  confirmado_por?: string
}

export interface WintourTransferIn {
  hotel_transfer_in: string
  cia_iata_chegada: string
  numero_voo_chegada: string
  data_chegada_voo: WintourDate
  hora_chegada_voo: WintourTime
  aeroporto_chegada: string
}

export interface WintourTransferOut {
  hotel_transfer_out: string
  data_apanhar_pax: WintourDate
  hora_apanhar_pax: WintourTime
  cia_iata_partida: string
  numero_voo_partida: string
  data_partida_voo: WintourDate
  hora_partida_voo: WintourTime
  aeroporto_partida: string
}

export type WintourRoute =
  | { aereo: { trechos: WintourAirLeg[] } }
  | { hotel: WintourHotelRoute }
  | { locacao: WintourCarRoute }
  | { outros: { descricao: string } }
  | { transfer: { transfer_in?: WintourTransferIn; transfer_out?: WintourTransferOut } }
  | { pacote: { cid_dest_principal?: string; data_inicio_pacote: WintourDate; data_fim_pacote: WintourDate; descricao_pacote: string } }
  | { outros_servicos: { cid_dest_principal?: string; data_inicio_outros_svcs: WintourDate; data_fim_outros_svcs: WintourDate; descricao_outros_svcs: string } }

export interface WintourCustomerData {
  acao_cli?: 'I' | 'U' | 'IU'
  razao_social?: string
  tipo_endereco?: string
  endereco?: string
  numero?: string
  complemento?: string
  bairro?: string
  cep?: string
  cidade?: string
  estado?: string
  tipo_fj?: 'F' | 'J'
  dt_nasc?: WintourDate
  tel?: string
  celular?: string
  cpf_cnpj?: string
  insc_identidade?: string
  sexo?: string
  dt_cadastro?: WintourDate
  email?: string
}

export interface WintourCreationSale {
  idv_externo: number
  id_posto_atendimento?: number
  posto_atendimento?: string
  dt_interna_cadastro: WintourDate
  data_lancamento: WintourDate
  codigo_produto: string
  fornecedor?: string
  prestador_svc: string
  num_bilhete: string
  localizador?: string
  tour_code?: string
  forma_de_pagamento: WintourPaymentMethod
  cartao_mp?: string
  cartao_cp?: string
  conta_taxas_adicionais?: string
  conta_taxas_adicionais2?: string
  cod_outras_txs?: string
  cod_outras_txs2?: string
  cod_outras_txs3?: string
  cta_tx_emissao?: string
  ccustos_agencia?: string
  moeda?: string
  emissor?: string
  promotor?: string
  gerente?: string
  cliente?: string
  ccustos_cliente?: string
  numero_requisicao?: string
  data_requisicao?: WintourDate
  passageiro: string
  tipo_passageiro: 'A' | 'C' | 'I'
  solicitante?: string
  aprovador?: string
  departamento?: string
  projeto?: string
  motivo_viagem?: string
  motivo_recusa?: string
  matricula?: string
  num_cc?: string
  cod_autorizacao_cc?: string
  tipo_domest_inter?: 'D' | 'I'
  scdp?: string
  canal_captacao?: string
  cta_du_rav?: 'TX-DU' | 'RAV-AG'
  situacao_contabil?: 'G' | 'N'
  tipo_roteiro_aereo?: 'OW' | 'RT'
  destino_rot_aereo?: string
  canal_venda?: string
  multi_ccustos_cli?: 'S' | 'N'
  rateio_ccustos_cli?: WintourCostCenterAllocation[]
  tipo_roteiro: 1 | 2 | 3 | 4 | 5 | 6 | 7
  tarifa_net: 0 | 1
  cid_dest_principal?: string
  tipo_emissao?: 'E' | 'R' | 'S'
  co2_kg?: number
  ndc_order_id?: string
  vendas_originais?: number[]
  bilhetes_conjugados?: string[]
  valores: WintourSaleValue[]
  vencimentos?: WintourDueDate[]
  roteiro: WintourRoute
  info_adicionais?: string
  info_internas?: string
  dados_cliente?: WintourCustomerData
}

export interface WintourCreationFile {
  nr_arquivo: number
  data_geracao: WintourDate
  hora_geracao: WintourTime
  nome_agencia: string
  vendas: WintourCreationSale[]
}

export const WINTOUR_UPDATE_FIELD_CODES = [
  'vl_tarifa', 'vl_taxa_br', 'outras_txs1_vista', 'outras_txs2_vista',
  'outras_txs3_vista', 'vl_tarifa_df', 'vl_taxa_df', 'outras_txs1_df',
  'outras_txs2_df', 'outras_txs3_df', 'vl_tarifa_cartao', 'vl_taxa_br_cartao',
  'outras_txs1_cartao', 'outras_txs2_cartao', 'outras_txs3_cartao', 'tarifa_y',
  'best_fare', 'best_fare_disp', 'outras_txs1_id_tx', 'outras_txs2_id_tx',
  'outras_txs3_id_tx', 'info_adcs', 'info_internas', 'dt_inicio_servicos',
  'dt_fim_servicos', 'fop', 'cta_cp', 'cta_cartao', 'cod_ccusto', 'tour_code',
  'vl_comiss_ag', 'solicitante', 'aprovador', 'gera_fin', 'status', 'data_lct',
  'cta_emissor', 'cta_promotor', 'cta_gerente', 'cta_fornecedor', 'cia',
  'cod_ccusto_cliente', 'id_pa', 'vl_comiss_emissor', 'vl_over_emissor',
  'vl_comiss_promotor', 'vl_comiss_gerente',
] as const

export type WintourUpdateFieldCode = typeof WINTOUR_UPDATE_FIELD_CODES[number]
export type WintourUpdateRemark = 'append' | 'xxmanter'

export interface WintourUpdateChange {
  field: WintourUpdateFieldCode
  content: string | number
  remark?: WintourUpdateRemark
}

export interface WintourSaleUpdate {
  nr: number
  changes: WintourUpdateChange[]
}

export interface WintourUpdateFile {
  recalculateCalculatedFields?: 'S' | 'N'
  sales: WintourSaleUpdate[]
}

export class WintourXmlValidationError extends Error {
  readonly code = 'WINTOUR_XML_VALIDATION_ERROR'
  readonly field?: string

  constructor(message: string, field?: string) {
    super(message)
    this.name = 'WintourXmlValidationError'
    this.field = field
  }
}

const PAYMENT_METHOD_SET = new Set<string>(WINTOUR_PAYMENT_METHODS)
const VALUE_CODE_SET = new Set<string>(WINTOUR_VALUE_CODES)
const DUE_DATE_CODE_SET = new Set<string>(WINTOUR_DUE_DATE_CODES)
const UPDATE_FIELD_SET = new Set<string>(WINTOUR_UPDATE_FIELD_CODES)

const VALUE_DF_OPTIONAL_PAYMENT_METHODS = new Set<WintourPaymentMethod>([
  'CE', 'VC', 'AF', 'S7', 'TR', 'VT',
])
const VALUE_MP_OPTIONAL_PAYMENT_METHODS = new Set<WintourPaymentMethod>(['EP', 'EF'])
const VALUE_SPLITS_REQUIRED_PAYMENT_METHODS = new Set<WintourPaymentMethod>(['DM', 'CM', 'MF', '3F'])
const MACHINE_PAYMENT_METHODS = new Set<WintourPaymentMethod>([
  'MP', 'FI', 'EP', 'EF', 'S6', 'TR', 'DM', 'CM', 'MF', '3F',
])

const CREATION_FILE_KEYS = new Set(['nr_arquivo', 'data_geracao', 'hora_geracao', 'nome_agencia', 'vendas'])
const CREATION_SALE_KEYS = new Set([
  'idv_externo', 'id_posto_atendimento', 'posto_atendimento', 'dt_interna_cadastro',
  'data_lancamento', 'codigo_produto', 'fornecedor', 'prestador_svc', 'num_bilhete',
  'localizador', 'tour_code', 'forma_de_pagamento', 'cartao_mp', 'cartao_cp',
  'conta_taxas_adicionais', 'conta_taxas_adicionais2', 'cod_outras_txs',
  'cod_outras_txs2', 'cod_outras_txs3', 'cta_tx_emissao', 'ccustos_agencia', 'moeda',
  'emissor', 'promotor', 'gerente', 'cliente', 'ccustos_cliente', 'numero_requisicao',
  'data_requisicao', 'passageiro', 'tipo_passageiro', 'solicitante', 'aprovador',
  'departamento', 'projeto', 'motivo_viagem', 'motivo_recusa', 'matricula', 'num_cc',
  'cod_autorizacao_cc', 'tipo_domest_inter', 'scdp', 'canal_captacao', 'cta_du_rav',
  'situacao_contabil', 'tipo_roteiro_aereo', 'destino_rot_aereo', 'canal_venda',
  'multi_ccustos_cli', 'rateio_ccustos_cli', 'tipo_roteiro', 'tarifa_net',
  'cid_dest_principal', 'tipo_emissao', 'co2_kg', 'ndc_order_id', 'vendas_originais',
  'bilhetes_conjugados', 'valores', 'vencimentos', 'roteiro', 'info_adicionais',
  'info_internas', 'dados_cliente',
])

const CUSTOMER_KEYS = new Set([
  'acao_cli', 'razao_social', 'tipo_endereco', 'endereco', 'numero', 'complemento',
  'bairro', 'cep', 'cidade', 'estado', 'tipo_fj', 'dt_nasc', 'tel', 'celular',
  'cpf_cnpj', 'insc_identidade', 'sexo', 'dt_cadastro', 'email',
])

const STRING_LIMITS: Record<string, number> = {
  posto_atendimento: 60, codigo_produto: 10, fornecedor: 60, prestador_svc: 60,
  num_bilhete: 10, localizador: 20, tour_code: 15, cartao_mp: 10, cartao_cp: 10,
  conta_taxas_adicionais: 10, conta_taxas_adicionais2: 10, cod_outras_txs: 2,
  cod_outras_txs2: 2, cod_outras_txs3: 2, cta_tx_emissao: 10, ccustos_agencia: 10,
  moeda: 3, emissor: 60, promotor: 60, gerente: 60, cliente: 60,
  ccustos_cliente: 70, numero_requisicao: 20, passageiro: 60, solicitante: 100,
  aprovador: 100, departamento: 40, projeto: 60, motivo_viagem: 60, motivo_recusa: 60,
  matricula: 20, num_cc: 20, cod_autorizacao_cc: 10, scdp: 15, canal_captacao: 10,
  destino_rot_aereo: 3, canal_venda: 3, cid_dest_principal: 10, ndc_order_id: 120,
  info_adicionais: 1200, info_internas: 1200,
}

type UpdateFieldKind = 'currency' | 'date' | 'string' | 'cdata' | 'branch' | 'financial' | 'payment'

const UPDATE_RULES: Record<WintourUpdateFieldCode, { kind: UpdateFieldKind; max?: number }> = {
  vl_tarifa: { kind: 'currency' }, vl_taxa_br: { kind: 'currency' },
  outras_txs1_vista: { kind: 'currency' }, outras_txs2_vista: { kind: 'currency' },
  outras_txs3_vista: { kind: 'currency' }, vl_tarifa_df: { kind: 'currency' },
  vl_taxa_df: { kind: 'currency' }, outras_txs1_df: { kind: 'currency' },
  outras_txs2_df: { kind: 'currency' }, outras_txs3_df: { kind: 'currency' },
  vl_tarifa_cartao: { kind: 'currency' }, vl_taxa_br_cartao: { kind: 'currency' },
  outras_txs1_cartao: { kind: 'currency' }, outras_txs2_cartao: { kind: 'currency' },
  outras_txs3_cartao: { kind: 'currency' }, tarifa_y: { kind: 'currency' },
  best_fare: { kind: 'currency' }, best_fare_disp: { kind: 'currency' },
  outras_txs1_id_tx: { kind: 'string', max: 2 }, outras_txs2_id_tx: { kind: 'string', max: 2 },
  outras_txs3_id_tx: { kind: 'string', max: 2 }, info_adcs: { kind: 'cdata', max: 1200 },
  info_internas: { kind: 'cdata', max: 1200 }, dt_inicio_servicos: { kind: 'date' },
  dt_fim_servicos: { kind: 'date' }, fop: { kind: 'payment', max: 2 },
  cta_cp: { kind: 'string', max: 10 }, cta_cartao: { kind: 'string', max: 10 },
  cod_ccusto: { kind: 'string', max: 10 }, tour_code: { kind: 'string', max: 10 },
  vl_comiss_ag: { kind: 'currency' }, solicitante: { kind: 'string', max: 100 },
  aprovador: { kind: 'string', max: 100 }, gera_fin: { kind: 'financial', max: 1 },
  status: { kind: 'string', max: 100 }, data_lct: { kind: 'date' },
  cta_emissor: { kind: 'string', max: 10 }, cta_promotor: { kind: 'string', max: 10 },
  cta_gerente: { kind: 'string', max: 10 }, cta_fornecedor: { kind: 'string', max: 10 },
  cia: { kind: 'string', max: 10 }, cod_ccusto_cliente: { kind: 'string', max: 35 },
  id_pa: { kind: 'branch' }, vl_comiss_emissor: { kind: 'currency' },
  vl_over_emissor: { kind: 'currency' }, vl_comiss_promotor: { kind: 'currency' },
  vl_comiss_gerente: { kind: 'currency' },
}

export function buildWintourCreationXml(input: WintourCreationFile): string {
  validateCreationFile(input)
  const lines = [WINTOUR_XML_DECLARATION, '<bilhetes>']
  pushTag(lines, 1, 'nr_arquivo', input.nr_arquivo)
  pushTag(lines, 1, 'data_geracao', input.data_geracao)
  pushTag(lines, 1, 'hora_geracao', input.hora_geracao)
  pushTag(lines, 1, 'nome_agencia', input.nome_agencia)
  pushTag(lines, 1, 'versao_xml', WINTOUR_CREATION_XML_VERSION)
  input.vendas.forEach((sale) => appendCreationSale(lines, sale))
  lines.push('</bilhetes>')
  return lines.join('\n')
}

export function buildWintourUpdateXml(input: WintourUpdateFile): string {
  validateUpdateFile(input)
  const lines = [WINTOUR_XML_DECLARATION, '<raiz>']
  pushTag(lines, 1, 'recalcula_campos_calculados', input.recalculateCalculatedFields || 'N')
  lines.push('  <vendas>')
  for (const sale of input.sales) {
    lines.push('    <venda>')
    pushTag(lines, 3, 'nr', sale.nr)
    lines.push('      <alteracoes>')
    for (const change of sale.changes) {
      const rule = UPDATE_RULES[change.field]
      lines.push('        <item>')
      pushTag(lines, 5, 'campo', change.field)
      const normalized = normalizeUpdateContent(change, rule)
      pushTag(lines, 5, 'conteudo', normalized, rule.kind === 'cdata')
      if (change.remark) pushTag(lines, 5, 'remark', change.remark)
      lines.push('        </item>')
    }
    lines.push('      </alteracoes>', '    </venda>')
  }
  lines.push('  </vendas>', '</raiz>')
  return lines.join('\n')
}

export function encodeWintourIso88591(text: string): Uint8Array {
  assertIso88591(text, 'xml')
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index)
  return bytes
}

function validateCreationFile(input: WintourCreationFile): void {
  assertPlainObject(input, 'arquivo')
  assertKnownKeys(input, CREATION_FILE_KEYS, 'arquivo')
  assertInteger(input.nr_arquivo, 'nr_arquivo', 1, 2_147_483_647)
  assertDate(input.data_geracao, 'data_geracao')
  assertTime(input.hora_geracao, 'hora_geracao')
  assertText(input.nome_agencia, 'nome_agencia', 50)
  assertSalesArray(input.vendas, 'vendas')
  input.vendas.forEach((sale, index) => validateCreationSale(sale, `vendas[${index}]`))
}

function validateCreationSale(sale: WintourCreationSale, path: string): void {
  assertPlainObject(sale, path)
  assertKnownKeys(sale, CREATION_SALE_KEYS, path)
  assertInteger(sale.idv_externo, `${path}.idv_externo`, 1, 9_999_999_999)
  if (sale.id_posto_atendimento != null) assertInteger(sale.id_posto_atendimento, `${path}.id_posto_atendimento`, 1, 2_147_483_647)
  assertDate(sale.dt_interna_cadastro, `${path}.dt_interna_cadastro`)
  assertDate(sale.data_lancamento, `${path}.data_lancamento`)
  assertText(sale.codigo_produto, `${path}.codigo_produto`, 10)
  assertText(sale.prestador_svc, `${path}.prestador_svc`, 60)
  assertText(sale.num_bilhete, `${path}.num_bilhete`, 10)
  assertEnum(sale.forma_de_pagamento, PAYMENT_METHOD_SET, `${path}.forma_de_pagamento`)
  assertText(sale.passageiro, `${path}.passageiro`, 60)
  assertEnum(sale.tipo_passageiro, new Set(['A', 'C', 'I']), `${path}.tipo_passageiro`)
  assertEnum(sale.tipo_domest_inter || 'D', new Set(['D', 'I']), `${path}.tipo_domest_inter`)
  assertInteger(sale.tipo_roteiro, `${path}.tipo_roteiro`, 1, 7)
  assertInteger(sale.tarifa_net, `${path}.tarifa_net`, 0, 1)
  for (const [field, max] of Object.entries(STRING_LIMITS)) {
    const value = (sale as unknown as Record<string, unknown>)[field]
    if (value != null) assertText(value, `${path}.${field}`, max)
  }
  if (sale.data_requisicao) assertDate(sale.data_requisicao, `${path}.data_requisicao`)
  if (sale.co2_kg != null) assertFiniteNumber(sale.co2_kg, `${path}.co2_kg`, 0)
  if (sale.moeda != null && !/^[A-Z]{3}$/.test(sale.moeda)) fail(`${path}.moeda`, 'deve conter tres letras maiusculas')
  validateValues(sale.valores, path, sale.forma_de_pagamento)
  validatePaymentRequirements(sale, path)
  validateCostCenterAllocation(sale, path)
  validateDueDates(sale.vencimentos, path)
  validateIntegerList(sale.vendas_originais, `${path}.vendas_originais`, 9_999_999_999)
  if (sale.bilhetes_conjugados) {
    sale.bilhetes_conjugados.forEach((ticket, index) => assertText(ticket, `${path}.bilhetes_conjugados[${index}]`, 10))
  }
  validateRoute(sale.tipo_roteiro, sale.roteiro, `${path}.roteiro`)
  if (sale.dados_cliente) validateCustomer(sale.dados_cliente, `${path}.dados_cliente`)
}

function validatePaymentRequirements(sale: WintourCreationSale, path: string): void {
  const cpRequired = new Set<WintourPaymentMethod>(['CP', 'RP', 'VP', 'S5', 'S7', 'TR', 'VT', 'CM'])
  const mpRequired = new Set<WintourPaymentMethod>(['MP', 'FI', 'EP', 'EF', 'S6', 'TR', 'DM', 'CM', 'MF', '3F'])
  if (cpRequired.has(sale.forma_de_pagamento)) assertText(sale.cartao_cp, `${path}.cartao_cp`, 10)
  if (mpRequired.has(sale.forma_de_pagamento)) assertText(sale.cartao_mp, `${path}.cartao_mp`, 10)
  const codes = new Set(sale.valores?.map((item) => item.codigo))
  if (codes.has('fee')) assertText(sale.conta_taxas_adicionais, `${path}.conta_taxas_adicionais`, 10)
  if (codes.has('fee2')) assertText(sale.conta_taxas_adicionais2, `${path}.conta_taxas_adicionais2`, 10)
  if (codes.has('outras_txs')) assertText(sale.cod_outras_txs, `${path}.cod_outras_txs`, 2)
  if (codes.has('outras_txs2')) assertText(sale.cod_outras_txs2, `${path}.cod_outras_txs2`, 2)
  if (codes.has('outras_txs3')) assertText(sale.cod_outras_txs3, `${path}.cod_outras_txs3`, 2)
  if (codes.has('tx_emissao')) assertText(sale.cta_tx_emissao, `${path}.cta_tx_emissao`, 10)
}

function validateCostCenterAllocation(sale: WintourCreationSale, path: string): void {
  if (sale.multi_ccustos_cli === 'S' && (!sale.rateio_ccustos_cli || sale.rateio_ccustos_cli.length === 0)) {
    fail(`${path}.rateio_ccustos_cli`, 'e obrigatorio quando multi_ccustos_cli=S')
  }
  if (sale.multi_ccustos_cli !== 'S' && sale.rateio_ccustos_cli?.length) {
    fail(`${path}.multi_ccustos_cli`, 'deve ser S quando houver rateio_ccustos_cli')
  }
  sale.rateio_ccustos_cli?.forEach((allocation, index) => {
    assertPlainObject(allocation, `${path}.rateio_ccustos_cli[${index}]`)
    assertKnownKeys(allocation, new Set(['ccustos_cliente', 'percentual']), `${path}.rateio_ccustos_cli[${index}]`)
    assertText(allocation.ccustos_cliente, `${path}.rateio_ccustos_cli[${index}].ccustos_cliente`, 70)
    normalizeMoney(allocation.percentual, `${path}.rateio_ccustos_cli[${index}].percentual`, 2)
  })
}

function validateValues(
  values: WintourSaleValue[],
  path: string,
  paymentMethod: WintourPaymentMethod,
): void {
  if (!Array.isArray(values) || values.length === 0) fail(`${path}.valores`, 'deve conter ao menos um valor')
  values.forEach((item, index) => {
    const itemPath = `${path}.valores[${index}]`
    assertPlainObject(item, itemPath)
    assertKnownKeys(item, new Set(['codigo', 'valor', 'valor_df', 'valor_mp']), itemPath)
    assertEnum(item.codigo, VALUE_CODE_SET, `${itemPath}.codigo`)
    normalizeMoney(item.valor, `${itemPath}.valor`, item.codigo === 'cambio' ? 8 : 2)
    if (item.valor_df != null) normalizeMoney(item.valor_df, `${itemPath}.valor_df`, 2)
    if (item.valor_mp != null) normalizeMoney(item.valor_mp, `${itemPath}.valor_mp`, 2)
    validatePaymentValueSplits(item, paymentMethod, itemPath)
  })
}

function validatePaymentValueSplits(
  item: WintourSaleValue,
  paymentMethod: WintourPaymentMethod,
  path: string,
): void {
  const requiresBothSplits = VALUE_SPLITS_REQUIRED_PAYMENT_METHODS.has(paymentMethod)
  const allowsValueDf = requiresBothSplits || VALUE_DF_OPTIONAL_PAYMENT_METHODS.has(paymentMethod)
  const feeWithMachinePayment = (item.codigo === 'fee' || item.codigo === 'fee2')
    && MACHINE_PAYMENT_METHODS.has(paymentMethod)
  const allowsValueMp = requiresBothSplits
    || VALUE_MP_OPTIONAL_PAYMENT_METHODS.has(paymentMethod)
    || feeWithMachinePayment

  if (item.valor_df != null && !allowsValueDf) {
    fail(`${path}.valor_df`, `nao e permitido para a forma de pagamento ${paymentMethod}`)
  }
  if (item.valor_mp != null && !allowsValueMp) {
    fail(`${path}.valor_mp`, `nao e permitido para a forma de pagamento ${paymentMethod}`)
  }
  if (requiresBothSplits && item.valor_df == null) {
    fail(`${path}.valor_df`, `e obrigatorio para a forma de pagamento ${paymentMethod}`)
  }
  if (requiresBothSplits && item.valor_mp == null && !feeWithMachinePayment) {
    fail(`${path}.valor_mp`, `e obrigatorio para a forma de pagamento ${paymentMethod}`)
  }
}

function validateDueDates(values: WintourDueDate[] | undefined, path: string): void {
  values?.forEach((item, index) => {
    const itemPath = `${path}.vencimentos[${index}]`
    assertPlainObject(item, itemPath)
    assertKnownKeys(item, new Set(['codigo', 'valor']), itemPath)
    assertEnum(item.codigo, DUE_DATE_CODE_SET, `${itemPath}.codigo`)
    assertDate(item.valor, `${itemPath}.valor`)
  })
}

function validateRoute(type: number, route: WintourRoute, path: string): void {
  assertPlainObject(route, path)
  const keys = Object.keys(route)
  if (keys.length !== 1) fail(path, 'deve conter exatamente um tipo de roteiro')
  const expected = ['aereo', 'hotel', 'locacao', 'outros', 'transfer', 'pacote', 'outros_servicos'][type - 1]
  if (keys[0] !== expected) fail(path, `deve conter o roteiro ${expected}`)
  const value = (route as unknown as Record<string, unknown>)[expected]
  assertPlainObject(value, `${path}.${expected}`)
  switch (expected) {
    case 'aereo': validateAirRoute(value as { trechos: WintourAirLeg[] }, `${path}.aereo`); break
    case 'hotel': validateHotelRoute(value as unknown as WintourHotelRoute, `${path}.hotel`); break
    case 'locacao': validateCarRoute(value as unknown as WintourCarRoute, `${path}.locacao`); break
    case 'outros': validateDescriptionRoute(value, 'descricao', `${path}.outros`); break
    case 'transfer': validateTransferRoute(value as { transfer_in?: WintourTransferIn; transfer_out?: WintourTransferOut }, `${path}.transfer`); break
    case 'pacote': validatePackageRoute(value, `${path}.pacote`, false); break
    case 'outros_servicos': validatePackageRoute(value, `${path}.outros_servicos`, true); break
  }
}

function validateAirRoute(route: { trechos: WintourAirLeg[] }, path: string): void {
  assertKnownKeys(route, new Set(['trechos']), path)
  if (!Array.isArray(route.trechos) || route.trechos.length === 0) fail(`${path}.trechos`, 'deve conter ao menos um trecho')
  const keys = new Set(['cia_iata', 'numero_voo', 'aeroporto_origem', 'aeroporto_destino', 'data_partida', 'hora_partida', 'data_chegada', 'hora_chegada', 'classe', 'base_tarifaria', 'ticket_designator', 'conexao_arp_partida', 'conexao_arp_chegada', 'co2_kg'])
  route.trechos.forEach((leg, index) => {
    const itemPath = `${path}.trechos[${index}]`
    assertPlainObject(leg, itemPath); assertKnownKeys(leg, keys, itemPath)
    assertText(leg.cia_iata, `${itemPath}.cia_iata`, 10)
    assertText(leg.aeroporto_origem, `${itemPath}.aeroporto_origem`, 10)
    assertText(leg.aeroporto_destino, `${itemPath}.aeroporto_destino`, 10)
    if (leg.numero_voo != null) assertText(leg.numero_voo, `${itemPath}.numero_voo`, 5)
    for (const field of ['data_partida', 'data_chegada'] as const) if (leg[field]) assertDate(leg[field]!, `${itemPath}.${field}`)
    for (const field of ['hora_partida', 'hora_chegada'] as const) if (leg[field]) assertTime(leg[field]!, `${itemPath}.${field}`)
    for (const field of ['conexao_arp_partida', 'conexao_arp_chegada'] as const) if (leg[field] != null) assertInteger(leg[field], `${itemPath}.${field}`, 0, 1)
    if (leg.co2_kg != null) assertFiniteNumber(leg.co2_kg, `${itemPath}.co2_kg`, 0)
  })
}

function validateHotelRoute(route: WintourHotelRoute, path: string): void {
  assertKnownKeys(route, new Set(['nr_apts', 'categ_apt', 'tipo_apt', 'dt_check_in', 'dt_check_out', 'nr_hospedes', 'reg_alimentacao', 'cod_tipo_pagto', 'dt_confirmacao', 'confirmado_por']), path)
  assertInteger(route.nr_apts, `${path}.nr_apts`, 1, 9999)
  assertText(route.tipo_apt, `${path}.tipo_apt`, 60)
  assertDate(route.dt_check_in, `${path}.dt_check_in`); assertDate(route.dt_check_out, `${path}.dt_check_out`)
  if (route.categ_apt != null) assertText(route.categ_apt, `${path}.categ_apt`, 10)
  if (route.nr_hospedes != null) assertInteger(route.nr_hospedes, `${path}.nr_hospedes`, 1, 9999)
  if (route.reg_alimentacao != null) assertText(route.reg_alimentacao, `${path}.reg_alimentacao`, 40)
  if (route.cod_tipo_pagto != null) assertText(route.cod_tipo_pagto, `${path}.cod_tipo_pagto`, 10)
  if (route.dt_confirmacao) assertDate(route.dt_confirmacao, `${path}.dt_confirmacao`)
  if (route.confirmado_por != null) assertText(route.confirmado_por, `${path}.confirmado_por`, 40)
}

function validateCarRoute(route: WintourCarRoute, path: string): void {
  assertKnownKeys(route, new Set(['cidade_retirada', 'local_retirada', 'dt_retirada', 'hr_retirada', 'local_devolucao', 'dt_devolucao', 'hr_devolucao', 'categ_veiculo', 'cod_tipo_pagto', 'dt_confirmacao', 'confirmado_por']), path)
  assertText(route.local_retirada, `${path}.local_retirada`, 100)
  assertDate(route.dt_retirada, `${path}.dt_retirada`)
  assertText(route.categ_veiculo, `${path}.categ_veiculo`, 100)
  if (route.cidade_retirada != null) assertText(route.cidade_retirada, `${path}.cidade_retirada`, 10)
  if (route.hr_retirada) assertTime(route.hr_retirada, `${path}.hr_retirada`)
  if (route.local_devolucao != null) assertText(route.local_devolucao, `${path}.local_devolucao`, 100)
  if (route.dt_devolucao) assertDate(route.dt_devolucao, `${path}.dt_devolucao`)
  if (route.hr_devolucao) assertTime(route.hr_devolucao, `${path}.hr_devolucao`)
  if (route.cod_tipo_pagto != null) assertText(route.cod_tipo_pagto, `${path}.cod_tipo_pagto`, 10)
  if (route.dt_confirmacao) assertDate(route.dt_confirmacao, `${path}.dt_confirmacao`)
  if (route.confirmado_por != null) assertText(route.confirmado_por, `${path}.confirmado_por`, 40)
}

function validateDescriptionRoute(route: Record<string, unknown>, field: string, path: string): void {
  assertKnownKeys(route, new Set([field]), path)
  assertText(route[field], `${path}.${field}`, 1800)
}

function validateTransferRoute(route: { transfer_in?: WintourTransferIn; transfer_out?: WintourTransferOut }, path: string): void {
  assertKnownKeys(route, new Set(['transfer_in', 'transfer_out']), path)
  if (!route.transfer_in && !route.transfer_out) fail(path, 'deve conter transfer_in ou transfer_out')
  if (route.transfer_in) {
    const item = route.transfer_in
    assertPlainObject(item, `${path}.transfer_in`)
    assertKnownKeys(item, new Set(['hotel_transfer_in', 'cia_iata_chegada', 'numero_voo_chegada', 'data_chegada_voo', 'hora_chegada_voo', 'aeroporto_chegada']), `${path}.transfer_in`)
    assertText(item.hotel_transfer_in, `${path}.transfer_in.hotel_transfer_in`, 60)
    assertText(item.cia_iata_chegada, `${path}.transfer_in.cia_iata_chegada`, 10)
    assertText(item.numero_voo_chegada, `${path}.transfer_in.numero_voo_chegada`, 5)
    assertDate(item.data_chegada_voo, `${path}.transfer_in.data_chegada_voo`)
    assertTime(item.hora_chegada_voo, `${path}.transfer_in.hora_chegada_voo`)
    assertText(item.aeroporto_chegada, `${path}.transfer_in.aeroporto_chegada`, 10)
  }
  if (route.transfer_out) {
    const item = route.transfer_out
    assertPlainObject(item, `${path}.transfer_out`)
    assertKnownKeys(item, new Set(['hotel_transfer_out', 'data_apanhar_pax', 'hora_apanhar_pax', 'cia_iata_partida', 'numero_voo_partida', 'data_partida_voo', 'hora_partida_voo', 'aeroporto_partida']), `${path}.transfer_out`)
    assertText(item.hotel_transfer_out, `${path}.transfer_out.hotel_transfer_out`, 60)
    assertDate(item.data_apanhar_pax, `${path}.transfer_out.data_apanhar_pax`)
    assertTime(item.hora_apanhar_pax, `${path}.transfer_out.hora_apanhar_pax`)
    assertText(item.cia_iata_partida, `${path}.transfer_out.cia_iata_partida`, 10)
    assertText(item.numero_voo_partida, `${path}.transfer_out.numero_voo_partida`, 5)
    assertDate(item.data_partida_voo, `${path}.transfer_out.data_partida_voo`)
    assertTime(item.hora_partida_voo, `${path}.transfer_out.hora_partida_voo`)
    assertText(item.aeroporto_partida, `${path}.transfer_out.aeroporto_partida`, 10)
  }
}

function validatePackageRoute(route: Record<string, unknown>, path: string, otherServices: boolean): void {
  const prefix = otherServices ? 'outros_svcs' : 'pacote'
  const start = `data_inicio_${prefix}`
  const end = `data_fim_${prefix}`
  const description = otherServices ? 'descricao_outros_svcs' : 'descricao_pacote'
  assertKnownKeys(route, new Set(['cid_dest_principal', start, end, description]), path)
  if (route.cid_dest_principal != null) assertText(route.cid_dest_principal, `${path}.cid_dest_principal`, 10)
  assertDate(route[start], `${path}.${start}`); assertDate(route[end], `${path}.${end}`)
  assertText(route[description], `${path}.${description}`, 1800)
}

function validateCustomer(customer: WintourCustomerData, path: string): void {
  assertPlainObject(customer, path); assertKnownKeys(customer, CUSTOMER_KEYS, path)
  const limits: Record<string, number> = {
    razao_social: 60, tipo_endereco: 20, endereco: 60, numero: 10, complemento: 20,
    bairro: 30, cep: 9, cidade: 30, estado: 2, tel: 80, celular: 60, cpf_cnpj: 18,
    insc_identidade: 30, sexo: 1, email: 100,
  }
  for (const [field, max] of Object.entries(limits)) {
    const value = (customer as unknown as Record<string, unknown>)[field]
    if (value != null) assertText(value, `${path}.${field}`, max)
  }
  if (customer.acao_cli) assertEnum(customer.acao_cli, new Set(['I', 'U', 'IU']), `${path}.acao_cli`)
  if (customer.tipo_fj) assertEnum(customer.tipo_fj, new Set(['F', 'J']), `${path}.tipo_fj`)
  if (customer.dt_nasc) assertDate(customer.dt_nasc, `${path}.dt_nasc`)
  if (customer.dt_cadastro) assertDate(customer.dt_cadastro, `${path}.dt_cadastro`)
}

function validateUpdateFile(input: WintourUpdateFile): void {
  assertPlainObject(input, 'arquivo')
  assertKnownKeys(input, new Set(['recalculateCalculatedFields', 'sales']), 'arquivo')
  assertEnum(input.recalculateCalculatedFields || 'N', new Set(['S', 'N']), 'recalculateCalculatedFields')
  assertSalesArray(input.sales, 'sales')
  input.sales.forEach((sale, saleIndex) => {
    const path = `sales[${saleIndex}]`
    assertPlainObject(sale, path); assertKnownKeys(sale, new Set(['nr', 'changes']), path)
    assertInteger(sale.nr, `${path}.nr`, 1, 9_999_999_999)
    if (!Array.isArray(sale.changes) || sale.changes.length === 0) fail(`${path}.changes`, 'deve conter ao menos uma alteracao')
    sale.changes.forEach((change, index) => validateUpdateChange(change, `${path}.changes[${index}]`))
    if (sale.changes.some((change) => change.field === 'id_pa') && sale.changes.length !== 1) {
      fail(`${path}.changes`, 'id_pa nao pode ser alterado junto com outros campos')
    }
  })
}

function validateUpdateChange(change: WintourUpdateChange, path: string): void {
  assertPlainObject(change, path); assertKnownKeys(change, new Set(['field', 'content', 'remark']), path)
  assertEnum(change.field, UPDATE_FIELD_SET, `${path}.field`)
  const rule = UPDATE_RULES[change.field]
  normalizeUpdateContent(change, rule, path)
  if (change.field === 'info_adcs' || change.field === 'info_internas') {
    if (change.remark != null && change.remark !== 'append') fail(`${path}.remark`, 'somente append e permitido para campos cdata')
  } else if (change.field === 'fop' && String(change.content) === 'XX') {
    if (change.remark != null && change.remark !== 'xxmanter') fail(`${path}.remark`, 'somente xxmanter e permitido para fop=XX')
  } else if (change.remark != null) {
    fail(`${path}.remark`, 'remark nao e permitido para este campo/conteudo')
  }
}

function normalizeUpdateContent(
  change: WintourUpdateChange,
  rule: { kind: UpdateFieldKind; max?: number },
  path = `alteracao.${change.field}`,
): string {
  switch (rule.kind) {
    case 'currency': return normalizeMoney(change.content, `${path}.content`, 2)
    case 'date': assertDate(change.content, `${path}.content`); return String(change.content)
    case 'branch': assertInteger(change.content, `${path}.content`, 1, 2_147_483_647); return String(change.content)
    case 'financial': assertEnum(String(change.content), new Set(['0', '1']), `${path}.content`); return String(change.content)
    case 'payment': assertEnum(String(change.content), PAYMENT_METHOD_SET, `${path}.content`); return String(change.content)
    case 'cdata':
    case 'string': assertText(change.content, `${path}.content`, rule.max || 1200); return String(change.content)
  }
}

function appendCreationSale(lines: string[], sale: WintourCreationSale): void {
  lines.push('  <bilhete>')
  const directFields = [
    'idv_externo', 'id_posto_atendimento', 'posto_atendimento', 'dt_interna_cadastro',
    'data_lancamento', 'codigo_produto', 'fornecedor', 'prestador_svc', 'num_bilhete',
    'localizador', 'tour_code', 'forma_de_pagamento', 'cartao_mp', 'cartao_cp',
    'conta_taxas_adicionais', 'conta_taxas_adicionais2', 'cod_outras_txs',
    'cod_outras_txs2', 'cod_outras_txs3', 'cta_tx_emissao', 'ccustos_agencia', 'moeda',
    'emissor', 'promotor', 'gerente', 'cliente', 'ccustos_cliente', 'numero_requisicao',
    'data_requisicao', 'passageiro', 'tipo_passageiro', 'solicitante', 'aprovador',
    'departamento', 'projeto', 'motivo_viagem', 'motivo_recusa', 'matricula', 'num_cc',
    'cod_autorizacao_cc', 'tipo_domest_inter', 'scdp', 'canal_captacao', 'cta_du_rav',
    'situacao_contabil', 'tipo_roteiro_aereo', 'destino_rot_aereo', 'canal_venda',
    'multi_ccustos_cli',
  ] as const
  directFields.forEach((field) => pushOptionalTag(lines, 2, field, sale[field]))
  appendAllocations(lines, sale.rateio_ccustos_cli)
  pushTag(lines, 2, 'tipo_roteiro', sale.tipo_roteiro)
  pushTag(lines, 2, 'tarifa_net', sale.tarifa_net)
  pushOptionalTag(lines, 2, 'cid_dest_principal', sale.cid_dest_principal)
  pushOptionalTag(lines, 2, 'tipo_emissao', sale.tipo_emissao)
  pushOptionalTag(lines, 2, 'co2_kg', sale.co2_kg)
  pushOptionalTag(lines, 2, 'ndc_order_id', sale.ndc_order_id)
  appendItemList(lines, 2, 'vendas_originais', sale.vendas_originais)
  appendItemList(lines, 2, 'bilhetes_conjugados', sale.bilhetes_conjugados)
  appendValues(lines, sale.valores)
  appendDueDates(lines, sale.vencimentos)
  appendRoute(lines, sale.roteiro)
  pushOptionalTag(lines, 2, 'info_adicionais', sale.info_adicionais, true)
  pushOptionalTag(lines, 2, 'info_internas', sale.info_internas, true)
  appendCustomer(lines, sale.dados_cliente)
  lines.push('  </bilhete>')
}

function appendAllocations(lines: string[], values?: WintourCostCenterAllocation[]): void {
  if (!values?.length) return
  lines.push('    <rateio_ccustos_cli>')
  values.forEach((item) => {
    lines.push('      <item>')
    pushTag(lines, 4, 'ccustos_cliente', item.ccustos_cliente)
    pushTag(lines, 4, 'percentual', normalizeMoney(item.percentual, 'percentual', 2))
    lines.push('      </item>')
  })
  lines.push('    </rateio_ccustos_cli>')
}

function appendItemList(lines: string[], indent: number, name: string, values?: Array<string | number>): void {
  if (!values?.length) return
  lines.push(`${'  '.repeat(indent)}<${name}>`)
  values.forEach((value) => pushTag(lines, indent + 1, 'item', value))
  lines.push(`${'  '.repeat(indent)}</${name}>`)
}

function appendValues(lines: string[], values: WintourSaleValue[]): void {
  lines.push('    <valores>')
  values.forEach((item) => {
    lines.push('      <item>')
    pushTag(lines, 4, 'codigo', item.codigo)
    pushTag(lines, 4, 'valor', normalizeMoney(item.valor, 'valor', item.codigo === 'cambio' ? 8 : 2))
    if (item.valor_df != null) pushTag(lines, 4, 'valor_df', normalizeMoney(item.valor_df, 'valor_df', 2))
    if (item.valor_mp != null) pushTag(lines, 4, 'valor_mp', normalizeMoney(item.valor_mp, 'valor_mp', 2))
    lines.push('      </item>')
  })
  lines.push('    </valores>')
}

function appendDueDates(lines: string[], values?: WintourDueDate[]): void {
  if (!values?.length) return
  lines.push('    <vencimentos>')
  values.forEach((item) => {
    lines.push('      <item>')
    pushTag(lines, 4, 'codigo', item.codigo); pushTag(lines, 4, 'valor', item.valor)
    lines.push('      </item>')
  })
  lines.push('    </vencimentos>')
}

function appendRoute(lines: string[], route: WintourRoute): void {
  lines.push('    <roteiro>')
  if ('aereo' in route) {
    lines.push('      <aereo>')
    route.aereo.trechos.forEach((leg) => appendObject(lines, 4, 'trecho', leg))
    lines.push('      </aereo>')
  } else if ('hotel' in route) appendObject(lines, 3, 'hotel', route.hotel)
  else if ('locacao' in route) appendObject(lines, 3, 'locacao', route.locacao)
  else if ('outros' in route) {
    lines.push('      <outros>', '        <roteiro_texto>')
    pushTag(lines, 5, 'descricao', route.outros.descricao, true)
    lines.push('        </roteiro_texto>', '      </outros>')
  } else if ('transfer' in route) {
    lines.push('      <transfer>')
    if (route.transfer.transfer_in) appendObject(lines, 4, 'transfer_in', route.transfer.transfer_in)
    if (route.transfer.transfer_out) appendObject(lines, 4, 'transfer_out', route.transfer.transfer_out)
    lines.push('      </transfer>')
  } else if ('pacote' in route) appendObject(lines, 3, 'pacote', route.pacote, new Set(['descricao_pacote']))
  else appendObject(lines, 3, 'outros_servicos', route.outros_servicos, new Set(['descricao_outros_svcs']))
  lines.push('    </roteiro>')
}

function appendCustomer(lines: string[], customer?: WintourCustomerData): void {
  if (!customer) return
  lines.push('    <dados_cliente>')
  Object.entries(customer).forEach(([field, value]) => pushOptionalTag(lines, 3, field, value))
  lines.push('    </dados_cliente>')
}

function appendObject(
  lines: string[],
  indent: number,
  name: string,
  value: object,
  cdataFields = new Set<string>(),
): void {
  lines.push(`${'  '.repeat(indent)}<${name}>`)
  Object.entries(value).forEach(([field, content]) => pushOptionalTag(lines, indent + 1, field, content, cdataFields.has(field)))
  lines.push(`${'  '.repeat(indent)}</${name}>`)
}

function pushOptionalTag(lines: string[], indent: number, name: string, value: unknown, cdata = false): void {
  if (value == null || value === '') return
  pushTag(lines, indent, name, value, cdata)
}

function pushTag(lines: string[], indent: number, name: string, value: unknown, cdata = false): void {
  const content = String(value)
  if (cdata) assertIso88591(content, name)
  else assertWintourXmlText(content, name)
  const encoded = cdata ? `<![CDATA[${content.replaceAll(']]>', ']]]]><![CDATA[>')}]]>` : encodeXmlText(content)
  lines.push(`${'  '.repeat(indent)}<${name}>${encoded}</${name}>`)
}

function encodeXmlText(value: string): string {
  let encoded = ''
  for (const char of value) {
    const code = char.codePointAt(0)!
    if (code > 126) encoded += `&#${code};`
    else if (char === '&') encoded += '&#38;'
    else if (char === '<') encoded += '&#60;'
    else if (char === '>') encoded += '&#62;'
    else encoded += char
  }
  return encoded
}

function normalizeMoney(value: unknown, field: string, decimals: 2 | 8): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e15) fail(field, 'deve ser um valor finito')
    return value.toFixed(decimals)
  }
  if (typeof value !== 'string') fail(field, 'deve ser numero ou string decimal')
  const pattern = decimals === 8 ? /^-?\d+\.\d{8}$/ : /^-?\d+\.\d{2}$/
  if (!pattern.test(value)) fail(field, `deve usar ponto e exatamente ${decimals} casas decimais`)
  return value
}

function assertSalesArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) fail(field, 'deve conter ao menos uma venda')
  if (value.length > WINTOUR_MAX_SALES_PER_FILE) fail(field, `nao pode exceder ${WINTOUR_MAX_SALES_PER_FILE} vendas`)
}

function assertKnownKeys(value: object, allowed: Set<string>, field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length) fail(field, `contem campos nao permitidos: ${unknown.join(', ')}`)
}

function assertPlainObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'deve ser um objeto')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(field, 'deve ser um objeto simples')
}

function assertInteger(value: unknown, field: string, min: number, max: number): asserts value is number {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(number) || Number(number) < min || Number(number) > max) {
    fail(field, `deve ser um inteiro entre ${min} e ${max}`)
  }
}

function assertFiniteNumber(value: unknown, field: string, min: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) fail(field, `deve ser numero finito maior ou igual a ${min}`)
}

function assertText(value: unknown, field: string, max: number): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') fail(field, 'deve ser texto nao vazio')
  if (value.length > max) fail(field, `nao pode exceder ${max} caracteres`)
  assertWintourXmlText(value, field)
}

function assertDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') fail(field, 'deve usar DD/MM/YYYY')
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) fail(field, 'deve usar DD/MM/YYYY')
  const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail(field, 'contem uma data invalida')
}

function assertTime(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(field, 'deve usar HH:NN')
}

function assertEnum(value: unknown, allowed: Set<string>, field: string): void {
  if (typeof value !== 'string' || !allowed.has(value)) fail(field, `valor nao permitido: ${String(value)}`)
}

function validateIntegerList(values: number[] | undefined, field: string, max: number): void {
  values?.forEach((value, index) => assertInteger(value, `${field}[${index}]`, 1, max))
}

function assertIso88591(value: string, field: string): void {
  for (const char of value) {
    const code = char.codePointAt(0)!
    if (code > 255 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      fail(field, 'contem caractere fora do ISO-8859-1 ou controle XML invalido')
    }
  }
}

function assertWintourXmlText(value: string, field: string): void {
  for (const char of value) {
    const code = char.codePointAt(0)!
    if ((code > 255 && code !== 0x20ac) || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      fail(field, 'contem caractere nao aceito pelo layout Wintour')
    }
  }
}

function fail(field: string, message: string): never {
  throw new WintourXmlValidationError(`${field}: ${message}`, field)
}

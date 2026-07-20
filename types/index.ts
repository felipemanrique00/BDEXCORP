// ============================================================
// Tipos TypeScript do Sistema BBT Corporativo
// V4: Config markup/taxa por empresa, users dinâmicos, produtividade
// ============================================================

export type UserRole = 'master' | 'company_admin' | 'colaborador'
export type PerfilBBT = 'agente' | 'lider' | 'gestor_financeiro' | 'operacional' | 'supervisor'

export interface Permissoes {
  ver_financeiro: boolean
  editar_financeiro: boolean
  cadastrar_empresas: boolean
  cadastrar_funcionarios: boolean
  cadastrar_hoteis: boolean
  editar_politicas: boolean
  gerar_relatorios: boolean
  importar_planilhas: boolean
  ver_produtividade_todos: boolean
  gerenciar_usuarios: boolean
  excluir_demandas: boolean
  aprovar_demandas: boolean
}

export const PERMISSOES_PADRAO_POR_PERFIL: Record<PerfilBBT, Permissoes> = {
  lider: {
    ver_financeiro: true, editar_financeiro: true,
    cadastrar_empresas: true, cadastrar_funcionarios: true, cadastrar_hoteis: true,
    editar_politicas: true, gerar_relatorios: true, importar_planilhas: true,
    ver_produtividade_todos: true, gerenciar_usuarios: true, excluir_demandas: true,
    aprovar_demandas: true,
  },
  gestor_financeiro: {
    ver_financeiro: true, editar_financeiro: true,
    cadastrar_empresas: false, cadastrar_funcionarios: false, cadastrar_hoteis: false,
    editar_politicas: false, gerar_relatorios: true, importar_planilhas: true,
    ver_produtividade_todos: true, gerenciar_usuarios: false, excluir_demandas: false,
    aprovar_demandas: true,
  },
  supervisor: {
    ver_financeiro: true, editar_financeiro: false,
    cadastrar_empresas: true, cadastrar_funcionarios: true, cadastrar_hoteis: true,
    editar_politicas: true, gerar_relatorios: true, importar_planilhas: true,
    ver_produtividade_todos: true, gerenciar_usuarios: false, excluir_demandas: false,
    aprovar_demandas: true,
  },
  agente: {
    ver_financeiro: false, editar_financeiro: false,
    cadastrar_empresas: false, cadastrar_funcionarios: true, cadastrar_hoteis: false,
    editar_politicas: false, gerar_relatorios: false, importar_planilhas: false,
    ver_produtividade_todos: false, gerenciar_usuarios: false, excluir_demandas: false,
    aprovar_demandas: false,
  },
  operacional: {
    ver_financeiro: false, editar_financeiro: false,
    cadastrar_empresas: false, cadastrar_funcionarios: false, cadastrar_hoteis: false,
    editar_politicas: false, gerar_relatorios: false, importar_planilhas: false,
    ver_produtividade_todos: false, gerenciar_usuarios: false, excluir_demandas: false,
    aprovar_demandas: false,
  },
}

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  company_id: string | null
  empresa_ids?: string[]
  grupo_ids?: string[]
  perfil_bbt?: PerfilBBT
  permissoes?: Permissoes
  avatar?: string
  ativo?: boolean
  created_at?: string
}

export type Cargo = 'Diretor' | 'Gerente' | 'Colaborador'

export interface ConfigCobrancaEmpresa {
  aplicar_markup: boolean
  markup_padrao_pct: number
  aplicar_taxa: boolean
  taxa_padrao_pct: number
  taxa_fixa_ativa: boolean
  taxa_valor_fixo: number
  observacoes: string
  sla_horas?: number       // V7: horas pra concluir uma demanda (default 24)
}

export const CONFIG_COBRANCA_PADRAO: ConfigCobrancaEmpresa = {
  aplicar_markup: true,
  markup_padrao_pct: 10,
  aplicar_taxa: true,
  taxa_padrao_pct: 10,
  taxa_fixa_ativa: false,
  taxa_valor_fixo: 0,
  observacoes: '',
  sla_horas: 24,
}

export interface Empresa {
  id: string
  nome: string
  cnpj: string
  grupo_id?: string | null
  codigo_cliente?: string
  endereco: string
  responsavel: string
  email_responsavel: string
  telefone: string
  centro_custo_padrao: string
  ativa: boolean
  is_master_holding?: boolean
  tech_travel_client_names?: string[]
  config_cobranca?: ConfigCobrancaEmpresa
  created_at: string
  updated_at?: string
}

export interface GrupoEmpresarial {
  id: string
  nome: string
  codigo?: string
  cnpj_matriz?: string
  descricao?: string
  responsavel_nome?: string
  responsavel_email?: string
  ativo: boolean
  empresa_ids: string[]
  created_at: string
  updated_at?: string
}

export interface Funcionario {
  id: string
  codigo_identificacao?: string
  company_id: string
  nome: string
  cpf: string
  data_nascimento: string
  telefone: string
  email: string
  rg?: string
  documento_tipo?: 'RG' | 'CNH' | 'CPF' | 'PASSAPORTE' | 'OUTRO'
  documento_numero?: string
  orgao_emissor?: string
  uf_emissor?: string
  documento_emissao?: string
  documento_validade?: string
  cnh_registro?: string
  cnh_categoria?: string
  cnh_primeira_habilitacao?: string
  nome_mae?: string
  nome_pai?: string
  naturalidade?: string
  nacionalidade?: string
  passaporte: string
  passaporte_validade: string
  milhagem: string
  preferencias: string
  cargo: Cargo
  cargo_original?: string
  centro_custo: string
  matricula?: string
  lotacao?: string
  aliases_nome?: string[]
  ativo: boolean
  created_at: string
  updated_at?: string
}

export type FormaPagamento = 'IV' | 'PX' | 'CP' | 'CC'

export const FORMAS_PAGAMENTO_LABEL: Record<FormaPagamento, string> = {
  IV: 'Faturado',
  PX: 'Pix',
  CP: 'Cartão da agência',
  CC: 'Cartão do cliente',
}

export interface Hotel {
  id: number
  nome: string
  cidade: string
  uf: string
  categoria?: '1' | '2' | '3' | '4' | '5'
  observacoes: string | null
  telefone: string | null
  faturado: boolean
  info_faturamento: string | null
  bebedouro: string | null
  valor_agua: number | null
  cafe_manha: string | null
  estacionamento: string | null
  tarifa_sgl: number | null
  tarifa_dbl: number | null
  tarifa_tpl: number | null
  formas_pagamento?: FormaPagamento[]
}

export type ClasseAerea = 'Econômica' | 'Econômica Premium' | 'Executiva' | 'Primeira'

export interface PoliticaCargo {
  id: string
  company_id: string
  cargo: Cargo
  titulo?: string
  escalao?: string
  limite_diaria_hotel: number
  hoteis_max_estrelas: number
  antecedencia_hotel_dias: number
  politica_hotel_texto?: string
  classe_aerea: ClasseAerea
  classe_aerea_internacional?: ClasseAerea
  valor_maximo_aereo_domestico: number
  valor_maximo_aereo_internacional: number
  antecedencia_aereo_domestico_dias: number
  antecedencia_aereo_internacional_dias: number
  politica_aerea_texto?: string
  aprovacao_automatica: boolean
  autorizador_user_id?: string
  observacoes: string
}

export type StatusAtendimento =
  | 'em_andamento' | 'aguardando_cliente' | 'finalizado' | 'cancelado' | 'pendente'

export const STATUS_LABEL: Record<StatusAtendimento, string> = {
  em_andamento: 'Em Andamento',
  aguardando_cliente: 'Aguardando Cliente',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
  pendente: 'Pendente',
}

export type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente'

export const PRIORIDADE_LABEL: Record<Prioridade, string> = {
  baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente',
}

export type TipoServico = 'Aéreo' | 'Hotel' | 'Carro' | 'Pacote' | 'Outro'
export type OrigemAtendimento = 'WhatsApp' | 'E-mail' | 'Telefone' | 'Indicação' | 'Portal' | 'Outro'
export type FonteReferenciaEconomiaAtendimento =
  | 'preco_sem_agencia'
  | 'cotacao_original'
  | 'tarifa_publica'
  | 'contrato'
  | 'outro'

/** Hóspede/Passageiro/Viajante adaptativo */
export function labelOcupante(tipo: TipoServico): string {
  switch (tipo) {
    case 'Hotel': return 'Hóspede'
    case 'Aéreo': return 'Passageiro'
    case 'Carro': return 'Passageiro'
    case 'Pacote': return 'Viajante'
    default: return 'Cliente'
  }
}

export interface DetalhesAereo {
  origem?: string
  destino?: string
  data_ida?: string
  data_volta?: string
  data_compra?: string
  data_emissao?: string
  cia_aerea?: string
  classe?: ClasseAerea
  localizador?: string
  internacional?: boolean
  numero_bilhete?: string
  numero_voo?: string
  tarifa?: number
  taxas?: number
  status_bilhete?: string
}

export interface DetalhesHotel {
  hotel_id?: number
  hotel_nome?: string
  cidade?: string
  data_checkin?: string
  data_checkout?: string
  num_hospedes?: number
  tipo_apto?: 'SGL' | 'DBL' | 'TPL'
  noites?: number
  tarifa_unitaria?: number
  localizador?: string
}

export interface DetalhesCarro {
  locadora?: string
  cidade_retirada?: string
  data_retirada?: string
  data_devolucao?: string
  categoria?: string
  localizador?: string
}

export interface DetalhesPacote {
  destino?: string
  data_ida?: string
  data_volta?: string
  descricao?: string
  localizador?: string
}

export interface Atendimento {
  id: string
  /** Identificador operacional legível usado para vincular demanda, cotação, reserva, emissão e voucher. */
  serial_os?: string
  empresa_id: string
  funcionario_id: string | null
  passageiro_nome: string
  tipo_servico: TipoServico
  valor_cotacao: number
  valor_final?: number
  /** Base comparável informada e auditável. Não representa custo, venda ou markup. */
  valor_referencia_economia?: number
  fonte_referencia_economia?: FonteReferenciaEconomiaAtendimento
  agente_user_id: string
  status: StatusAtendimento
  prioridade: Prioridade
  origem?: OrigemAtendimento
  observacoes: string
  data_atendimento: string
  detalhes_aereo?: DetalhesAereo
  detalhes_hotel?: DetalhesHotel
  detalhes_carro?: DetalhesCarro
  detalhes_pacote?: DetalhesPacote
  voucher_ids?: string[]
  motivo?: string

  valor_custo?: number
  valor_venda?: number
  taxa_percentual?: number
  taxa_ativa?: boolean
  taxa_valor_fixo?: number
  markup_valor?: number
  markup_desabilitado?: boolean

  venda_numero?: string
  emissor_codigo?: string
  emissor_nome?: string
  solicitante_nome?: string
  wintour_dados?: Record<string, string | number | boolean | null | undefined>
  origem_emissao?:
    | 'manual'
    | 'planilha'
    | 'voucher_pdf'
    | 'caixa_entrada'
    | 'pdf_emissao'
    | 'wintour_xml'
    | 'wintour_planilha'
    | 'wintour_pdf'
    | 'tech_travel_api'

  // --- V8: Campos adicionais para gestão completa ---
  forma_pagamento?: FormaPagamento     // como o cliente vai pagar (IV/PX/CP/CC)
  centro_custo?: string                // centro de custo da empresa
  projeto_obra?: string                // projeto/obra que justifica a viagem
  numero_solicitacao?: string          // número de solicitação interno do cliente
  autorizador_nome?: string            // quem autorizou (RH/gerente)
  contato_passageiro?: string          // telefone/email do hóspede pra emergência
  observacoes_internas?: string        // anotações que NÃO vão pro cliente

  // --- V5: Repasse automático e fluxo de demandas ---
  em_atendimento?: boolean // se já tem alguém trabalhando
  repassada_em?: string // ISO timestamp do último repasse
  repassada_de?: string // user_id de quem a demanda saiu
  repassada_para?: string // user_id pra quem foi repassada
  motivo_repasse?: string // ex: "Redistribuição por prioridade"
  historico_agentes?: Array<{ user_id: string; user_name: string; desde: string; ate?: string }>
  prioridade_calculada?: Prioridade // calculada automaticamente pelo sistema
  dias_ate_checkin?: number // diferença em dias entre hoje e data check-in/ida

  created_at: string
  updated_at?: string
  finalizado_em?: string
}

export interface LogAuditoria {
  id: string
  user_id: string
  user_name: string
  acao: 'criar' | 'editar' | 'excluir' | 'importar' | 'login' | 'anexar_voucher'
  entidade: string
  entidade_id: string
  descricao: string
  timestamp: string
}

export interface CalculoFinanceiro {
  custo: number
  venda: number
  markup: number
  taxa_valor: number
  total_faturado: number
  margem_pct: number
}

export function calcularFinanceiro(a: {
  valor_custo?: number
  valor_venda?: number
  valor_final?: number
  valor_cotacao?: number
  taxa_percentual?: number
  taxa_ativa?: boolean
  taxa_valor_fixo?: number
  markup_valor?: number
  markup_desabilitado?: boolean
}): CalculoFinanceiro {
  const custo = Number(a.valor_custo || 0)
  const markupExplicito = Number(a.markup_valor || 0)
  let venda: number
  if (a.markup_desabilitado) {
    venda = custo
  } else {
    venda = Number(a.valor_venda ?? a.valor_final ?? a.valor_cotacao ?? 0)
    if (venda === 0 && markupExplicito > 0) venda = custo + markupExplicito
  }
  const markup = venda - custo
  let taxa_valor = 0
  if (a.taxa_ativa) {
    if (a.taxa_valor_fixo && a.taxa_valor_fixo > 0) taxa_valor = a.taxa_valor_fixo
    else if (a.taxa_percentual && a.taxa_percentual > 0) taxa_valor = venda * (a.taxa_percentual / 100)
  }
  const total_faturado = venda + taxa_valor
  const margem_pct = venda > 0 ? (markup / venda) * 100 : 0
  return { custo, venda, markup, taxa_valor, total_faturado, margem_pct }
}

export function aplicarConfigEmpresa(
  custo: number,
  config: ConfigCobrancaEmpresa
): { venda_sugerida: number; taxa_ativa: boolean; taxa_percentual: number; taxa_valor_fixo: number; markup_desabilitado: boolean } {
  const markup_desabilitado = !config.aplicar_markup
  let venda_sugerida = custo
  if (config.aplicar_markup && config.markup_padrao_pct > 0) {
    venda_sugerida = custo * (1 + config.markup_padrao_pct / 100)
  }
  return {
    venda_sugerida,
    taxa_ativa: config.aplicar_taxa,
    taxa_percentual: config.taxa_fixa_ativa ? 0 : config.taxa_padrao_pct,
    taxa_valor_fixo: config.taxa_fixa_ativa ? config.taxa_valor_fixo : 0,
    markup_desabilitado,
  }
}

// ============================================================
// V10: VoucherEmitido — Voucher gerado pelo SISTEMA (com dados estruturados)
// Diferente do "Voucher" antigo (que é só anexo de PDF/imagem em IndexedDB)
// ============================================================

export type VoucherTipo = 'Hotel' | 'Aéreo' | 'Carro' | 'Pacote'
export type VoucherStatus = 'rascunho' | 'emitido' | 'confirmado' | 'cancelado'
export type VoucherOrigem = 'criado' | 'importado' | 'pdf' | 'ia'

export interface VoucherEmitido {
  id: string                          // ex: "H-26262"
  numero: string                      // numero sequencial: "26262"
  tipo: VoucherTipo                   // letra do prefixo: H, A, C, P
  status: VoucherStatus
  atendimento_id?: string             // demanda de origem (opcional)
  empresa_id: string
  funcionario_id?: string | null
  passageiro_nome: string             // pode ter mais de um (usar passageiros[])
  passageiros?: string[]              // múltiplos hóspedes
  cpf?: string

  // Fornecedor/Hotel
  fornecedor_nome: string             // ex: "STRASSEN HOTEL"
  fornecedor_endereco?: string
  fornecedor_cidade?: string
  fornecedor_telefone?: string
  fornecedor_email?: string

  // Hotel-specific
  hotel_categoria?: string            // STANDARD, SUPERIOR
  tipo_apartamento?: string           // INDIVIDUAL, DUPLO, TRIPLO
  num_apartamentos?: number
  num_hospedes?: number
  data_checkin?: string
  data_checkout?: string
  noites?: number
  regime?: string                     // CAFÉ DA MANHÃ, ALL INCLUSIVE
  forma_pagamento_voucher?: string    // FATURAR SOMENTE DIÁRIAS, FATURAR TUDO

  // Aéreo-specific
  cia_aerea?: string
  numero_voo?: string
  origem?: string
  destino?: string
  data_ida?: string
  data_volta?: string
  classe?: string
  localizador?: string

  // Carro-specific
  locadora?: string
  categoria_carro?: string
  retirada_local?: string
  retirada_data?: string
  devolucao_local?: string
  devolucao_data?: string

  // Confirmação
  numero_confirmacao?: string
  data_confirmacao?: string
  confirmado_por?: string

  // Financeiro
  valor_diaria?: number
  tarifa_total?: number
  taxas?: number
  total: number
  centro_custo?: string
  numero_solicitacao?: string

  observacoes?: string
  observacoes_internas?: string
  origem_voucher?: VoucherOrigem
  arquivo_original_nome?: string
  importado_em?: string
  fingerprint?: string

  // Auditoria
  emitido_por_user_id: string
  emitido_por_user_name: string
  created_at: string
  updated_at?: string
}

export const VOUCHER_PREFIX: Record<VoucherTipo, string> = {
  Hotel: 'H', Aéreo: 'A', Carro: 'C', Pacote: 'P',
}

export function gerarNumeroVoucher(tipo: VoucherTipo, lastNumero: number): string {
  const prefix = VOUCHER_PREFIX[tipo]
  const proximo = (lastNumero || 26261) + 1
  return `${prefix}-${proximo}`
}

// ============================================================
// V12: Conversação IA premium (GPT-5.2 + Gemini opcional)
// ============================================================
export interface MensagemChat {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  tool_calls?: any[]
}

export interface ConversaIA {
  id: string
  user_id: string
  titulo: string
  mensagens: MensagemChat[]
  created_at: string
  updated_at: string
}

// ============================================================
// Portal Empresas / Solicitantes
// ============================================================

export type StatusSolicitanteEmpresa = 'ativo' | 'bloqueado' | 'pendente'

export interface SolicitanteEmpresa {
  id: string
  company_id: string
  user_id?: string | null
  funcionario_id?: string | null
  nome: string
  email: string
  telefone?: string
  cargo?: string
  departamento?: string
  centro_custo?: string
  status: StatusSolicitanteEmpresa
  pode_criar_demanda: boolean
  pode_ver_vouchers: boolean
  pode_ver_financeiro: boolean
  limite_por_solicitacao?: number
  observacoes?: string
  created_at: string
  updated_at?: string
}

// ============================================================
// Carteira Digital Corporativa / Pix / Cartoes / Faturas
// ============================================================

export type StatusCarteiraCorporativa = 'ativa' | 'bloqueada' | 'pendente_configuracao'
export type TipoCartaoCorporativo = 'fisico' | 'virtual'
export type StatusCartaoCorporativo = 'ativo' | 'bloqueado' | 'cancelado' | 'pendente_emissao'
export type TipoMovimentoCarteira = 'credito' | 'debito' | 'estorno' | 'ajuste'
export type OrigemMovimentoCarteira = 'pix' | 'cartao' | 'fatura' | 'manual' | 'integracao'
export type StatusMovimentoCarteira = 'pendente' | 'processado' | 'falhou' | 'cancelado'
export type StatusFaturaCorporativa = 'aberta' | 'fechada' | 'paga' | 'vencida' | 'cancelada'

export interface CarteiraCorporativa {
  id: string
  company_id: string
  saldo_disponivel: number
  limite_credito: number
  limite_pix_diario: number
  limite_cartao_mensal: number
  status: StatusCarteiraCorporativa
  pix_habilitado: boolean
  cartao_habilitado: boolean
  provedor?: 'pendente' | 'stripe_issuing' | 'dock' | 'pismo' | 'efi_bank' | 'outro'
  conta_virtual?: string
  observacoes?: string
  created_at: string
  updated_at?: string
}

export interface CartaoCorporativo {
  id: string
  carteira_id: string
  company_id: string
  tipo: TipoCartaoCorporativo
  apelido: string
  portador_nome?: string
  funcionario_id?: string | null
  ultimos4?: string
  bandeira?: 'Visa' | 'Mastercard' | 'Elo' | 'Outra'
  limite: number
  gasto_mes: number
  status: StatusCartaoCorporativo
  merchant_lock?: string
  validade_mes?: number
  validade_ano?: number
  criado_por_user_id?: string
  created_at: string
  updated_at?: string
}

export interface MovimentoCarteiraCorporativa {
  id: string
  carteira_id: string
  company_id: string
  tipo: TipoMovimentoCarteira
  origem: OrigemMovimentoCarteira
  valor: number
  descricao: string
  status: StatusMovimentoCarteira
  atendimento_id?: string
  lancamento_id?: string
  cartao_id?: string
  created_at: string
  processado_em?: string
}

export interface FaturaCorporativa {
  id: string
  company_id: string
  numero: string
  periodo_inicio: string
  periodo_fim: string
  vencimento: string
  valor_total: number
  valor_pago: number
  status: StatusFaturaCorporativa
  lancamento_ids: string[]
  atendimento_ids: string[]
  observacoes?: string
  created_at: string
  updated_at?: string
}

// ============================================================
// V13 — Workflow de Aprovação corporativa
// ============================================================

export type StatusAprovacao =
  | 'pendente'
  | 'aprovada'
  | 'rejeitada'
  | 'expirada'
  | 'cancelada'

export type NivelAprovacao = 'gestor' | 'financeiro' | 'diretoria'

export interface PassoAprovacao {
  nivel: NivelAprovacao
  responsavel_user_id?: string
  responsavel_nome?: string
  status: StatusAprovacao
  comentario?: string
  decidido_em?: string
}

export interface SolicitacaoAprovacao {
  id: string
  atendimento_id: string
  empresa_id: string
  valor_total: number
  motivo_aprovacao: string
  violacoes_codigo: string[]
  passos: PassoAprovacao[]
  status: StatusAprovacao
  solicitado_por_user_id: string
  solicitado_por_nome: string
  created_at: string
  updated_at?: string
  decidido_em?: string
}

// ============================================================
// V13 — ESG / Pegada de Carbono
// ============================================================

export interface PegadaCarbono {
  atendimento_id?: string
  voucher_id?: string
  tipo: TipoServico
  kg_co2: number
  metodo: 'estimativa_distancia' | 'fator_padrao' | 'fornecedor'
  detalhes?: {
    km?: number
    noites?: number
    classe?: ClasseAerea
    fator_kg_per_unit?: number
  }
}

// ============================================================
// V13 — Duty of Care / risco em viagem
// ============================================================

export type StatusViajante =
  | 'planejada'      // ainda não começou
  | 'em_viagem'      // entre check-in e check-out
  | 'concluida'      // pós check-out
  | 'cancelada'

export type NivelRisco = 'baixo' | 'moderado' | 'alto' | 'critico'

export interface ViajanteEmCampo {
  voucher_id: string
  atendimento_id?: string
  funcionario_id?: string | null
  passageiro_nome: string
  empresa_id?: string
  empresa_nome?: string
  tipo: TipoServico
  destino: string
  uf?: string
  pais?: string
  inicio: string         // ISO (check-in / data ida)
  fim: string            // ISO (check-out / data volta)
  status: StatusViajante
  risco: NivelRisco
  alertas: string[]      // ex: "voo em <24h sem localizador"
  contato?: string
}

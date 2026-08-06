// ============================================================
// Tipos TypeScript do Sistema BBT Corporativo
// V4: Config markup/taxa por empresa, users dinâmicos, produtividade
// ============================================================

export type UserRole = 'master' | 'company_admin' | 'colaborador'
export type PerfilBBT = 'agente' | 'lider' | 'gestor_financeiro' | 'operacional' | 'supervisor'
export type CorporateProfile =
  | 'owner'
  | 'ceo'
  | 'group_admin'
  | 'executive_assistant'
  | 'group_finance'
  | 'manager'
  | 'viewer'
  | 'company_admin'
  | 'requester'
export type CorporateAccessMode = 'all_companies' | 'selected_companies'

export interface CorporateDelegationAuthority {
  sourceId: string
  source: 'group' | 'company'
  profile: CorporateProfile
  permissions: Permissoes
  companyIds: string[]
  accessMode: CorporateAccessMode | null
  canViewConsolidated: boolean
}

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
  ver_empresas: boolean
  ver_centros_custo: boolean
  gerenciar_centros_custo: boolean
  ver_consolidado_grupo: boolean
  ver_funcionarios: boolean
  gerenciar_funcionarios: boolean
  ver_solicitantes: boolean
  gerenciar_solicitantes: boolean
  criar_demandas: boolean
  ver_demandas: boolean
  ver_reservas: boolean
  ver_emissoes: boolean
  ver_vouchers: boolean
  ver_relatorios: boolean
  exportar_relatorios: boolean
  gerenciar_vinculos_acesso: boolean
  gerenciar_empresas_grupo: boolean
  alterar_configuracoes: boolean
  operar_cotacoes: boolean
  operar_reservas: boolean
  operar_emissoes: boolean
  operar_cancelamentos: boolean
  gerenciar_integracoes: boolean
  ver_politicas: boolean
  gerenciar_politicas: boolean
  publicar_politicas: boolean
  simular_politicas: boolean
  ver_aprovacoes: boolean
  decidir_aprovacoes: boolean
  ver_workflows: boolean
  gerenciar_workflows: boolean
  executar_workflows: boolean
  gerenciar_delegacoes: boolean
  usar_ia: boolean
  gerenciar_ia: boolean
  ver_arquivos: boolean
  gerenciar_arquivos: boolean
  ver_auditoria: boolean
  ver_inteligencia: boolean
  usar_busca_global: boolean
  ver_orcamentos: boolean
  gerenciar_orcamentos: boolean
  executar_automacoes: boolean
  gerenciar_automacoes: boolean
  acessar_portal_viajante: boolean
}

const CORPORATE_PERMISSIONS_DENIED = {
  ver_empresas: false,
  ver_centros_custo: false,
  gerenciar_centros_custo: false,
  ver_consolidado_grupo: false,
  ver_funcionarios: false,
  gerenciar_funcionarios: false,
  ver_solicitantes: false,
  gerenciar_solicitantes: false,
  criar_demandas: false,
  ver_demandas: false,
  ver_reservas: false,
  ver_emissoes: false,
  ver_vouchers: false,
  ver_relatorios: false,
  exportar_relatorios: false,
  gerenciar_vinculos_acesso: false,
  gerenciar_empresas_grupo: false,
  alterar_configuracoes: false,
  operar_cotacoes: false,
  operar_reservas: false,
  operar_emissoes: false,
  operar_cancelamentos: false,
  gerenciar_integracoes: false,
  ver_politicas: false,
  gerenciar_politicas: false,
  publicar_politicas: false,
  simular_politicas: false,
  ver_aprovacoes: false,
  decidir_aprovacoes: false,
  ver_workflows: false,
  gerenciar_workflows: false,
  executar_workflows: false,
  gerenciar_delegacoes: false,
  usar_ia: false,
  gerenciar_ia: false,
  ver_arquivos: false,
  gerenciar_arquivos: false,
  ver_auditoria: false,
  ver_inteligencia: false,
  usar_busca_global: false,
  ver_orcamentos: false,
  gerenciar_orcamentos: false,
  executar_automacoes: false,
  gerenciar_automacoes: false,
  acessar_portal_viajante: false,
} as const

export const PERMISSOES_PADRAO_POR_PERFIL: Record<PerfilBBT, Permissoes> = {
  lider: {
    ...CORPORATE_PERMISSIONS_DENIED,
    ver_financeiro: true, editar_financeiro: true,
    cadastrar_empresas: true, cadastrar_funcionarios: true, cadastrar_hoteis: true,
    editar_politicas: true, gerar_relatorios: true, importar_planilhas: true,
    ver_produtividade_todos: true, gerenciar_usuarios: true, excluir_demandas: true,
    aprovar_demandas: true,
    ver_empresas: true, ver_centros_custo: true, gerenciar_centros_custo: true, ver_consolidado_grupo: true,
    ver_funcionarios: true, gerenciar_funcionarios: true,
    ver_solicitantes: true, gerenciar_solicitantes: true,
    criar_demandas: true, ver_demandas: true, ver_reservas: true,
    ver_emissoes: true, ver_vouchers: true, ver_relatorios: true,
    exportar_relatorios: true, gerenciar_vinculos_acesso: true,
    gerenciar_empresas_grupo: true, alterar_configuracoes: true,
    operar_cotacoes: true, operar_reservas: true, operar_emissoes: true,
    operar_cancelamentos: true, gerenciar_integracoes: true,
    ver_politicas: true, gerenciar_politicas: true, publicar_politicas: true,
    simular_politicas: true, ver_aprovacoes: true, decidir_aprovacoes: true,
    ver_workflows: true, gerenciar_workflows: true, executar_workflows: true,
    gerenciar_delegacoes: true, usar_ia: true, gerenciar_ia: true,
    ver_arquivos: true, gerenciar_arquivos: true, ver_auditoria: true,
    ver_inteligencia: true, usar_busca_global: true,
    ver_orcamentos: true, gerenciar_orcamentos: true,
    executar_automacoes: true, gerenciar_automacoes: true,
    acessar_portal_viajante: true,
  },
  gestor_financeiro: {
    ...CORPORATE_PERMISSIONS_DENIED,
    ver_financeiro: true, editar_financeiro: true,
    cadastrar_empresas: false, cadastrar_funcionarios: false, cadastrar_hoteis: false,
    editar_politicas: false, gerar_relatorios: true, importar_planilhas: true,
    ver_produtividade_todos: true, gerenciar_usuarios: false, excluir_demandas: false,
    aprovar_demandas: true,
    ver_empresas: true, ver_centros_custo: true, ver_consolidado_grupo: true,
    ver_funcionarios: true, ver_demandas: true, ver_reservas: true,
    ver_emissoes: true, ver_vouchers: true, ver_relatorios: true,
    exportar_relatorios: true,
    operar_cotacoes: true,
    ver_politicas: true, ver_aprovacoes: true, decidir_aprovacoes: true,
    ver_workflows: true, executar_workflows: true, usar_ia: true,
    ver_arquivos: true, ver_auditoria: true, ver_inteligencia: true,
    usar_busca_global: true, ver_orcamentos: true, gerenciar_orcamentos: true,
  },
  supervisor: {
    ...CORPORATE_PERMISSIONS_DENIED,
    ver_financeiro: true, editar_financeiro: false,
    cadastrar_empresas: true, cadastrar_funcionarios: true, cadastrar_hoteis: true,
    editar_politicas: true, gerar_relatorios: true, importar_planilhas: true,
    ver_produtividade_todos: true, gerenciar_usuarios: false, excluir_demandas: false,
    aprovar_demandas: true,
    ver_empresas: true, ver_centros_custo: true, gerenciar_centros_custo: true, ver_consolidado_grupo: true,
    ver_funcionarios: true, gerenciar_funcionarios: true,
    ver_solicitantes: true, gerenciar_solicitantes: true,
    criar_demandas: true, ver_demandas: true, ver_reservas: true,
    ver_emissoes: true, ver_vouchers: true, ver_relatorios: true,
    exportar_relatorios: true,
    operar_cotacoes: true, operar_reservas: true, operar_emissoes: true,
    operar_cancelamentos: true, gerenciar_integracoes: true,
    ver_politicas: true, gerenciar_politicas: true, simular_politicas: true,
    ver_aprovacoes: true, decidir_aprovacoes: true, ver_workflows: true,
    gerenciar_workflows: true, executar_workflows: true, usar_ia: true,
    gerenciar_ia: true, ver_arquivos: true, gerenciar_arquivos: true,
    ver_auditoria: true, ver_inteligencia: true, usar_busca_global: true,
    ver_orcamentos: true, gerenciar_orcamentos: true,
    executar_automacoes: true, gerenciar_automacoes: true,
    acessar_portal_viajante: true,
  },
  agente: {
    ...CORPORATE_PERMISSIONS_DENIED,
    ver_financeiro: false, editar_financeiro: false,
    cadastrar_empresas: false, cadastrar_funcionarios: true, cadastrar_hoteis: false,
    editar_politicas: false, gerar_relatorios: false, importar_planilhas: false,
    ver_produtividade_todos: false, gerenciar_usuarios: false, excluir_demandas: false,
    aprovar_demandas: false,
    ver_empresas: true, ver_centros_custo: true, ver_funcionarios: true, gerenciar_funcionarios: true,
    ver_solicitantes: true, criar_demandas: true, ver_demandas: true,
    ver_reservas: true, ver_emissoes: true, ver_vouchers: true,
    operar_cotacoes: true, operar_reservas: true, operar_emissoes: true,
    operar_cancelamentos: true, gerenciar_integracoes: true,
    ver_politicas: true, ver_aprovacoes: true, ver_workflows: true,
    executar_workflows: true, usar_ia: true, ver_arquivos: true,
    gerenciar_arquivos: true, usar_busca_global: true,
    acessar_portal_viajante: true,
  },
  operacional: {
    ...CORPORATE_PERMISSIONS_DENIED,
    ver_financeiro: false, editar_financeiro: false,
    cadastrar_empresas: false, cadastrar_funcionarios: false, cadastrar_hoteis: false,
    editar_politicas: false, gerar_relatorios: false, importar_planilhas: false,
    ver_produtividade_todos: false, gerenciar_usuarios: false, excluir_demandas: false,
    aprovar_demandas: false,
    ver_empresas: true, ver_centros_custo: true, ver_funcionarios: true, ver_solicitantes: true,
    criar_demandas: true, ver_demandas: true, ver_reservas: true,
    ver_emissoes: true, ver_vouchers: true,
    operar_cotacoes: true, operar_reservas: true, operar_emissoes: true,
    operar_cancelamentos: true, gerenciar_integracoes: true,
    ver_workflows: true, executar_workflows: true, usar_ia: true,
    ver_arquivos: true, gerenciar_arquivos: true, usar_busca_global: true,
    acessar_portal_viajante: true,
  },
}

const NO_PERMISSIONS: Permissoes = {
  ...PERMISSOES_PADRAO_POR_PERFIL.operacional,
  criar_demandas: false,
  ver_demandas: false,
  ver_reservas: false,
  ver_emissoes: false,
  ver_vouchers: false,
  ver_empresas: false,
  ver_centros_custo: false,
  gerenciar_centros_custo: false,
  ver_funcionarios: false,
  ver_solicitantes: false,
  operar_cotacoes: false,
  operar_reservas: false,
  operar_emissoes: false,
  operar_cancelamentos: false,
  gerenciar_integracoes: false,
  ver_politicas: false,
  gerenciar_politicas: false,
  publicar_politicas: false,
  simular_politicas: false,
  ver_aprovacoes: false,
  decidir_aprovacoes: false,
  ver_workflows: false,
  gerenciar_workflows: false,
  executar_workflows: false,
  gerenciar_delegacoes: false,
  usar_ia: false,
  gerenciar_ia: false,
  ver_arquivos: false,
  gerenciar_arquivos: false,
  ver_auditoria: false,
  ver_inteligencia: false,
  usar_busca_global: false,
  ver_orcamentos: false,
  gerenciar_orcamentos: false,
  executar_automacoes: false,
  gerenciar_automacoes: false,
  acessar_portal_viajante: false,
}

function permissions(...enabled: Array<keyof Permissoes>): Permissoes {
  const value = { ...NO_PERMISSIONS }
  enabled.forEach((permission) => { value[permission] = true })
  return value
}

export const CORPORATE_PROFILE_PERMISSIONS: Record<CorporateProfile, Permissoes> = {
  owner: {
    ...permissions(...Object.keys(NO_PERMISSIONS) as Array<keyof Permissoes>),
    operar_cotacoes: false,
    operar_reservas: false,
    operar_emissoes: false,
    operar_cancelamentos: false,
    gerenciar_integracoes: false,
  },
  ceo: permissions(
    'ver_financeiro', 'ver_empresas', 'ver_centros_custo', 'ver_consolidado_grupo', 'ver_funcionarios',
    'ver_solicitantes', 'ver_demandas', 'aprovar_demandas', 'ver_reservas',
    'ver_emissoes', 'ver_vouchers', 'gerar_relatorios', 'ver_relatorios',
    'exportar_relatorios', 'ver_produtividade_todos',
    'ver_politicas', 'simular_politicas', 'ver_aprovacoes', 'decidir_aprovacoes',
    'ver_workflows', 'executar_workflows', 'usar_ia', 'ver_arquivos',
    'ver_auditoria', 'ver_inteligencia', 'usar_busca_global', 'ver_orcamentos',
  ),
  group_admin: permissions(
    'ver_empresas', 'ver_centros_custo', 'gerenciar_centros_custo', 'ver_consolidado_grupo', 'cadastrar_empresas', 'gerenciar_empresas_grupo',
    'ver_funcionarios', 'cadastrar_funcionarios', 'gerenciar_funcionarios',
    'ver_solicitantes', 'gerenciar_solicitantes', 'criar_demandas', 'ver_demandas',
    'aprovar_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers',
    'gerar_relatorios', 'ver_relatorios', 'exportar_relatorios', 'gerenciar_usuarios',
    'gerenciar_vinculos_acesso', 'editar_politicas', 'alterar_configuracoes',
    'ver_politicas', 'gerenciar_politicas', 'publicar_politicas', 'simular_politicas',
    'ver_aprovacoes', 'decidir_aprovacoes', 'gerenciar_workflows', 'gerenciar_delegacoes',
    'ver_workflows', 'executar_workflows', 'usar_ia', 'gerenciar_ia',
    'ver_arquivos', 'gerenciar_arquivos', 'ver_auditoria', 'ver_inteligencia',
    'usar_busca_global', 'ver_orcamentos', 'gerenciar_orcamentos',
    'executar_automacoes', 'gerenciar_automacoes', 'acessar_portal_viajante',
  ),
  executive_assistant: permissions(
    'ver_empresas', 'ver_centros_custo', 'ver_consolidado_grupo', 'ver_funcionarios', 'ver_solicitantes',
    'criar_demandas', 'ver_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers',
    'gerar_relatorios', 'ver_relatorios', 'exportar_relatorios',
    'ver_politicas', 'ver_aprovacoes',
    'ver_workflows', 'executar_workflows', 'usar_ia', 'ver_arquivos',
    'gerenciar_arquivos', 'usar_busca_global', 'acessar_portal_viajante',
  ),
  group_finance: permissions(
    'ver_empresas', 'ver_centros_custo', 'ver_consolidado_grupo', 'ver_funcionarios', 'ver_solicitantes',
    'ver_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers', 'ver_financeiro',
    'editar_financeiro', 'gerar_relatorios', 'ver_relatorios', 'exportar_relatorios',
    'ver_politicas', 'ver_aprovacoes', 'decidir_aprovacoes',
    'ver_workflows', 'executar_workflows', 'usar_ia', 'ver_arquivos',
    'ver_auditoria', 'ver_inteligencia', 'usar_busca_global',
    'ver_orcamentos', 'gerenciar_orcamentos',
  ),
  manager: permissions(
    'ver_empresas', 'ver_centros_custo', 'ver_consolidado_grupo', 'ver_funcionarios', 'ver_solicitantes',
    'criar_demandas', 'ver_demandas', 'aprovar_demandas', 'ver_reservas',
    'ver_emissoes', 'ver_vouchers', 'gerar_relatorios', 'ver_relatorios',
    'exportar_relatorios',
    'ver_politicas', 'simular_politicas', 'ver_aprovacoes', 'decidir_aprovacoes',
    'ver_workflows', 'executar_workflows', 'usar_ia', 'ver_arquivos',
    'ver_inteligencia', 'usar_busca_global', 'ver_orcamentos',
  ),
  viewer: permissions(
    'ver_empresas', 'ver_centros_custo', 'ver_funcionarios', 'ver_solicitantes', 'ver_demandas',
    'ver_reservas', 'ver_emissoes', 'ver_vouchers', 'ver_relatorios',
    'ver_politicas',
    'ver_workflows', 'usar_ia', 'ver_arquivos', 'ver_inteligencia',
    'usar_busca_global', 'ver_orcamentos',
  ),
  company_admin: permissions(
    'ver_empresas', 'ver_centros_custo', 'gerenciar_centros_custo', 'ver_funcionarios', 'cadastrar_funcionarios', 'gerenciar_funcionarios',
    'ver_solicitantes', 'gerenciar_solicitantes', 'criar_demandas', 'ver_demandas',
    'aprovar_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers',
    'gerar_relatorios', 'ver_relatorios', 'exportar_relatorios', 'editar_politicas',
    'alterar_configuracoes',
    'ver_politicas', 'gerenciar_politicas', 'simular_politicas',
    'ver_aprovacoes', 'decidir_aprovacoes', 'ver_workflows',
    'gerenciar_workflows', 'executar_workflows', 'gerenciar_delegacoes',
    'usar_ia', 'gerenciar_ia', 'ver_arquivos', 'gerenciar_arquivos',
    'ver_auditoria', 'ver_inteligencia', 'usar_busca_global',
    'ver_orcamentos', 'gerenciar_orcamentos',
    'executar_automacoes', 'gerenciar_automacoes', 'acessar_portal_viajante',
  ),
  requester: permissions(
    'ver_empresas', 'ver_centros_custo', 'ver_funcionarios', 'ver_solicitantes', 'criar_demandas',
    'ver_demandas', 'ver_reservas', 'ver_emissoes', 'ver_vouchers',
    'ver_politicas', 'ver_aprovacoes',
    'ver_workflows', 'usar_ia', 'ver_arquivos', 'usar_busca_global',
    'acessar_portal_viajante',
  ),
}

export type AuthorizationScopeType =
  | 'tenant'
  | 'group'
  | 'company'
  | 'organizational_unit'
  | 'cost_center'
  | 'project'
  | 'user'

export interface AuthorizationScopeGrant {
  id: string
  effect: 'allow' | 'deny'
  permission: keyof Permissoes
  resource: string
  actions: string[]
  scopeType: AuthorizationScopeType
  scopeId: string
  companyId: string | null
  fieldNames: string[]
  isBoundary: boolean
  conditions: Record<string, unknown>
}

export interface CorporateCompanyAccessSummary {
  companyId: string
  companyName: string
  groupId: string | null
  groupName: string | null
  sources: Array<'tenant_admin' | 'legacy_unscoped' | 'group_all' | 'group_selected' | 'direct'>
  profiles: CorporateProfile[]
  permissions: Permissoes
  delegationAuthorities?: CorporateDelegationAuthority[]
}

export interface CorporateGroupAccessSummary {
  groupId: string
  groupName: string
  companyIds: string[]
  canViewConsolidated: boolean
  accessModes: CorporateAccessMode[]
  profiles: CorporateProfile[]
  delegationAuthorities?: CorporateDelegationAuthority[]
}

export interface CorporateContextOption {
  type: 'company' | 'group'
  id: string
  label: string
  groupId: string | null
  companyIds: string[]
  canViewConsolidated: boolean
}

export interface CorporateAccessSummary {
  tenantWide: boolean
  companyIds: string[]
  groupIds: string[]
  companies: CorporateCompanyAccessSummary[]
  groups: CorporateGroupAccessSummary[]
  contexts: CorporateContextOption[]
  defaultContext: { type: 'company' | 'group'; id: string } | null
  refreshedAt: string
}

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  tenant_id?: string
  tenant_slug?: string
  membership_id?: string
  role_key?: string
  platform_admin?: boolean
  must_change_password?: boolean
  company_id: string | null
  empresa_ids?: string[]
  grupo_ids?: string[]
  perfil_bbt?: PerfilBBT
  permissoes?: Permissoes
  permission_overrides?: Partial<Permissoes>
  corporate_profile?: CorporateProfile
  corporate_access?: CorporateAccessSummary
  avatar?: string
  ativo?: boolean
  status?: 'invited' | 'active' | 'blocked' | 'inactive'
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
  centro_custo_padrao_id?: string | null
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
  cost_center_id?: string | null
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
  trip_type?: 'one_way' | 'round_trip' | 'multi_city'
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
  /** Trechos solicitados; os campos planos acima continuam como compatibilidade. */
  trechos?: AirDemandLeg[]
  preferred_airlines?: string[]
  baggage_pieces?: number
  flexible_dates?: boolean
  flexible_times?: boolean
}

export interface AirDemandLeg {
  sequence: number
  direction?: 'outbound' | 'return' | 'multi_city'
  origin: string
  destination: string
  departure_date: string
  earliest_time?: string
  latest_time?: string
}

export interface DetalhesHotel {
  hotel_id?: number
  /** Preferencias ordenadas informadas pelo solicitante (maximo de 10). */
  preferred_hotel_ids?: string[]
  /** Compatibilidade com demandas anteriores; espelha o primeiro item. */
  preferred_hotel_id?: string
  hotel_nome?: string
  cidade?: string
  country_id?: string
  subdivision_id?: string
  city_id?: string
  data_checkin?: string
  data_checkout?: string
  num_hospedes?: number
  tipo_apto?: 'SGL' | 'DBL' | 'TPL'
  noites?: number
  tarifa_unitaria?: number
  localizador?: string
  rooms?: HotelDemandRoom[]
  purpose?: string
  accessibility_notes?: string
  preferences?: Record<string, unknown>
  needs_review?: boolean
}

export interface HotelDemandGuest {
  slot_index: number
  role: 'responsible' | 'companion' | 'guest'
  employee_id?: string
  name: string
  email?: string
  phone?: string
  is_external: boolean
}

export interface HotelDemandRoom {
  client_id: string
  occupancy_code: 'single' | 'couple' | 'double' | 'twin' | 'triple' | 'quadruple' | 'family'
  notes?: string
  guests: HotelDemandGuest[]
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
  relational_version?: number
  relational_lifecycle_status?: string
  relational_lifecycle_version?: number
  /** Identificador operacional legível usado para vincular demanda, cotação, reserva, emissão e voucher. */
  serial_os?: string
  empresa_id: string
  solicitante_id?: string
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
  cost_center_id?: string | null        // FK relacional; centro_custo permanece como snapshot
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

export type VoucherTipo =
  | 'Hotel'
  | 'Aéreo'
  | 'Carro'
  | 'Pacote'
  | 'Rodoviário'
  | 'Ferroviário'
  | 'Transfer'
  | 'Seguro'
  | 'Lazer'
  | 'Marítimo'
  | 'Serviço'
export type VoucherStatus = 'rascunho' | 'emitido' | 'confirmado' | 'cancelado'
export type VoucherOrigem = 'criado' | 'importado' | 'pdf' | 'ia'
export type VoucherPresentationSource = 'company' | 'group' | 'system'

export interface VoucherPresentationSettings {
  showConfirmedValues: boolean
  showCancellationTerms: boolean
  showAdministrativeData: boolean
  sources: {
    showConfirmedValues: VoucherPresentationSource
    showCancellationTerms: VoucherPresentationSource
    showAdministrativeData: VoucherPresentationSource
  }
  groupId: string | null
}

export interface VoucherHospedeDetalhe {
  nome: string
  papel?: string
  principal?: boolean
  codigo?: string
  documento?: string
  email?: string
  telefone?: string
  quarto?: number
}

export interface VoucherQuartoDetalhe {
  numero: number
  acomodacao?: string
  categoria?: string
  regime?: string
  hospedes?: string[]
}

export interface VoucherTrechoAereo {
  sequencia: number
  companhia_codigo: string
  companhia_nome: string
  numero_voo: string
  classe_reserva: string
  cabine: string
  bagagens: number
  origem_codigo: string
  origem_nome?: string
  destino_codigo: string
  destino_nome?: string
  saida_em: string
  chegada_em: string
}

export interface VoucherBilheteAereo {
  passageiro_nome: string
  numero_bilhete: string
  companhia_codigo: string
  companhia_nome: string
}

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
  hospedes_detalhes?: VoucherHospedeDetalhe[]

  // Contexto corporativo e aprovação
  empresa_nome?: string
  empresa_documento?: string
  unidade_negocio?: string
  departamento?: string
  solicitante_nome?: string
  solicitante_email?: string
  autorizadores?: string[]
  autorizado_em?: string
  data_solicitacao?: string
  reserva_id?: string
  data_reserva?: string

  // Fornecedor operacional que efetivou a reserva
  fornecedor_nome: string             // ex: "STRASSEN HOTEL"
  fornecedor_codigo?: string
  fornecedor_endereco?: string
  fornecedor_cidade?: string
  fornecedor_telefone?: string
  fornecedor_email?: string
  canal_reserva?: string

  // Hotel-specific
  hotel_nome?: string
  hotel_endereco?: string
  hotel_cidade?: string
  hotel_telefone?: string
  hotel_email?: string
  hotel_categoria?: string            // STANDARD, SUPERIOR
  tipo_apartamento?: string           // INDIVIDUAL, DUPLO, TRIPLO
  quartos?: VoucherQuartoDetalhe[]
  num_apartamentos?: number
  num_hospedes?: number
  data_checkin?: string
  data_checkout?: string
  checkin_em?: string
  checkout_em?: string
  noites?: number
  regime?: string                     // CAFÉ DA MANHÃ, ALL INCLUSIVE
  forma_pagamento_voucher?: string    // FATURAR SOMENTE DIÁRIAS, FATURAR TUDO
  referencia_pagamento?: string
  condicoes_pagamento?: string
  prazo_cancelamento?: string
  politica_cancelamento?: string
  politica_no_show?: string
  reembolsavel?: boolean

  // Aéreo-specific
  cia_aerea?: string
  numero_voo?: string
  origem?: string
  destino?: string
  data_ida?: string
  data_volta?: string
  classe?: string
  localizador?: string
  sistema_reserva?: string
  prazo_emissao?: string
  tarifa_referencia?: number
  rav?: number
  rac?: number
  cambio?: number
  milhagem?: number
  trechos_aereos?: VoucherTrechoAereo[]
  bilhetes_aereos?: VoucherBilheteAereo[]

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
  taxas_diaria?: number
  taxa_servico?: number
  tarifa_total?: number
  taxas?: number
  total: number
  moeda?: string
  centro_custo?: string
  numero_solicitacao?: string

  observacoes?: string
  observacoes_internas?: string
  origem_voucher?: VoucherOrigem
  arquivo_original_nome?: string
  importado_em?: string
  fingerprint?: string

  // Configuracao efetiva calculada no servidor; nunca e persistida como dado do voucher.
  presentation_settings?: VoucherPresentationSettings

  // Auditoria
  emitido_por_user_id: string
  emitido_por_user_name: string
  created_at: string
  updated_at?: string
  version?: number
}

export const VOUCHER_PREFIX: Record<VoucherTipo, string> = {
  Hotel: 'H',
  Aéreo: 'A',
  Carro: 'C',
  Pacote: 'P',
  Rodoviário: 'R',
  Ferroviário: 'F',
  Transfer: 'T',
  Seguro: 'S',
  Lazer: 'L',
  Marítimo: 'M',
  Serviço: 'O',
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
  cost_center_id?: string | null
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
  version?: number
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
  version?: number
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
  version?: number
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

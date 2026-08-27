import {
  BarChart3,
  Bot,
  Briefcase,
  BrainCircuit,
  Building2,
  CalendarCheck,
  CreditCard,
  Database,
  FileBarChart,
  FileStack,
  FlaskConical,
  History,
  Hotel,
  Inbox,
  LayoutDashboard,
  Leaf,
  LibraryBig,
  Network,
  Navigation,
  Plane,
  ReceiptText,
  ServerCog,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { AI_SHORT_NAME } from '@/lib/branding'
import { canManageUserAccess, hasPermission } from '@/lib/auth'
import { isRequesterUser } from '@/lib/user-access-kind'
import type { User } from '@/types'

export interface SidebarMenuItem {
  href: string
  label: string
  description?: string
  icon: LucideIcon
  badge?: number
  hidden?: boolean
  activeWhen?: string[]
}

export interface SidebarMenuGroup {
  id: string
  label: string
  itens: SidebarMenuItem[]
}

export function buildSidebarMenu({
  user,
  naoLidas,
  novasDemandas,
  alertasHoje,
}: {
  user: User
  naoLidas: number
  novasDemandas: number
  alertasHoje: number
}): SidebarMenuGroup[] {
  const podeFinanceiro = hasPermission(user, 'ver_financeiro')
  const podeRelatorios = hasPermission(user, 'gerar_relatorios')
  const podeCadastrarEmpresas = hasPermission(user, 'cadastrar_empresas')
  const podeImportar = hasPermission(user, 'importar_planilhas')
  const podeAdministrarAcessos = canManageUserAccess(user)
  const podeVerAuditoria = user.platform_admin === true || (
    ['tenant_admin', 'financial_manager', 'supervisor', 'agent', 'operator'].includes(user.role_key || '')
    && hasPermission(user, 'ver_auditoria')
  )
  const podeProdutividade = hasPermission(user, 'ver_produtividade_todos')
  const podeAprovar = hasPermission(user, 'ver_aprovacoes') || hasPermission(user, 'aprovar_demandas')
  const podeVerEmpresas = hasPermission(user, 'ver_empresas')
  const podeVerDemandas = hasPermission(user, 'ver_demandas')
  const podeCriarDemandas = hasPermission(user, 'criar_demandas')
  const podeVerReservas = hasPermission(user, 'ver_reservas') || hasPermission(user, 'operar_reservas')
  const podeVerEmissoes = hasPermission(user, 'ver_emissoes') || hasPermission(user, 'operar_emissoes')
  const podeVerVouchers = hasPermission(user, 'ver_vouchers')
  const podeVerFuncionarios = hasPermission(user, 'ver_funcionarios')
  const podeVerPoliticas = hasPermission(user, 'ver_politicas')
  const podeGerenciarWorkflows = hasPermission(user, 'gerenciar_workflows')
  const podeGerenciarIntegracoes = hasPermission(user, 'gerenciar_integracoes')
  const podeAlterarConfiguracoes = hasPermission(user, 'alterar_configuracoes')
  const podeUsarIa = hasPermission(user, 'usar_ia')
  const podeGerenciarIa = hasPermission(user, 'gerenciar_ia')
  const podeVerInteligencia = hasPermission(user, 'ver_inteligencia')
  const podeAcessarPortalViajante = hasPermission(user, 'acessar_portal_viajante')
  const isRequester = isRequesterUser(user)

  return [
    {
      id: 'operacao',
      label: 'Operação',
      itens: [
        { href: '/dashboard', label: 'Dashboard executivo', description: 'Cockpit geral da operação', icon: LayoutDashboard, hidden: !podeProdutividade },
        {
          href: '/dashboard/portal-empresa',
          label: 'Portal empresas/Grupos',
          description: user.corporate_profile ? 'Portal corporativo autorizado' : 'Visão cliente, empresa e grupo',
          icon: Building2,
          hidden: !podeVerEmpresas,
        },
        {
          href: '/dashboard/portal-empresa-lab',
          label: 'Portal empresa · Laboratório',
          description: 'Teste do novo fluxo aéreo offline',
          icon: FlaskConical,
          hidden: !podeVerDemandas && !podeCriarDemandas,
        },
        {
          href: '/dashboard/minha-viagem',
          label: 'Minha viagem',
          description: 'Reservas, vouchers e suporte do viajante',
          icon: Navigation,
          hidden: !podeAcessarPortalViajante,
        },
        { href: '/dashboard/caixa-entrada', label: 'Entrada de demandas', description: 'E-mail, áudio, PDF e texto', icon: Inbox, badge: naoLidas || undefined, hidden: isRequester || !podeCriarDemandas },
        {
          href: '/dashboard/demandas',
          label: 'Fila de demandas',
          description: 'Triagem, SLA, status e alertas',
          icon: Briefcase,
          badge: alertasHoje || novasDemandas || undefined,
          hidden: isRequester || !podeVerDemandas,
        },
        { href: '/dashboard/reservas', label: 'Reservas e cotações', description: 'Fornecedores, APIs e portais', icon: CalendarCheck, hidden: isRequester || !podeVerReservas },
        { href: '/dashboard/vouchers', label: 'Vouchers emitidos', description: 'Documentos emitidos e enviados', icon: FileStack, hidden: isRequester || !podeVerVouchers },
        { href: '/dashboard/aprovacoes', label: 'Aprovações', description: 'Workflow multinível de viagens', icon: ShieldCheck, hidden: !podeAprovar },
        { href: '/dashboard/risco', label: 'Centro de risco', description: 'Duty of care e viajantes em campo', icon: ShieldAlert, hidden: isRequester || !podeVerDemandas },
        { href: '/dashboard/produtividade', label: 'Equipe e produtividade', description: 'Agentes, carga, fila e SLA', icon: BarChart3, hidden: !podeProdutividade },
        { href: '/dashboard/ia', label: `Central ${AI_SHORT_NAME}`, description: 'Assistente, canais e agente operacional', icon: Bot, activeWhen: ['/dashboard/ia', '/dashboard/ia-chat', '/dashboard/ia-operacional', '/dashboard/assistente'], hidden: !podeUsarIa },
      ],
    },
    {
      id: 'integracoes',
      label: 'Integrações',
      itens: [
        { href: '/dashboard/wintour', label: 'Wintour', description: 'Importação diária de vendas', icon: Database, hidden: !podeImportar },
        { href: '/dashboard/reservas', label: 'Conector Tech Travel', description: 'Aéreo, hotel, locação e OS', icon: Hotel, hidden: isRequester || !podeGerenciarIntegracoes },
        { href: '/dashboard/importar', label: 'Importações gerais', description: 'Planilhas, XML, PDF e bases gerais', icon: Upload, hidden: !podeImportar },
        { href: '/dashboard/emissoes', label: 'Emissões e importações', description: 'Tech Travel, XLS, XLSX e PDF', icon: FileStack, hidden: isRequester || !podeVerEmissoes },
      ],
    },
    {
      id: 'financeiro',
      label: 'Financeiro',
      itens: [
        { href: '/dashboard/financeiro', label: 'Financeiro operacional', description: 'Pagar, receber e caixa operacional', icon: Wallet, hidden: !podeFinanceiro },
        { href: '/dashboard/financeiro?aba=carteira', label: 'Carteira e cartões', description: 'Pix, cartões físicos/virtuais e limites', icon: CreditCard, hidden: !podeFinanceiro },
        { href: '/dashboard/financeiro?aba=faturas', label: 'Faturas corporativas', description: 'Fechamento e cobrança de clientes', icon: ReceiptText, hidden: !podeFinanceiro },
        { href: '/dashboard/reconciliacao', label: 'Reconciliação', description: 'Divergências e conferência financeira', icon: ShieldAlert, hidden: !hasPermission(user, 'editar_financeiro') },
      ],
    },
    {
      id: 'cadastros',
      label: 'Cadastros',
      itens: [
        { href: '/dashboard/empresas', label: 'Empresas', description: 'Clientes, políticas, acessos e contratos', icon: Building2, hidden: !podeVerEmpresas && !podeCadastrarEmpresas },
        { href: '/dashboard/grupos', label: 'Grupos / holdings', description: 'Holdings, grupos econômicos e vínculos', icon: Network, hidden: !hasPermission(user, 'gerenciar_empresas_grupo') },
        { href: '/dashboard/funcionarios', label: 'Viajantes', description: 'Funcionários, documentos e perfis', icon: Users, hidden: !podeVerFuncionarios },
        { href: '/dashboard/fornecedores', label: 'Fornecedores', description: 'Cadastro comercial e base geográfica', icon: Building2, hidden: isRequester || (!hasPermission(user, 'cadastrar_hoteis') && !podeVerReservas) },
        { href: '/dashboard/hoteis/catalogo', label: 'Hotéis', description: 'Propriedades, fornecedores e localidades', icon: Hotel, hidden: isRequester || (!hasPermission(user, 'cadastrar_hoteis') && !podeVerReservas) },
      ],
    },
    {
      id: 'inteligencia',
      label: 'Inteligência',
      itens: [
        { href: '/dashboard/inteligencia', label: 'Centro de Inteligência', description: 'Indicadores, oportunidades e riscos', icon: BrainCircuit, hidden: !podeVerInteligencia },
        { href: '/dashboard/relatorios', label: 'Relatórios e BI', description: 'Resumo executivo e análises', icon: FileBarChart, hidden: !podeRelatorios && !hasPermission(user, 'ver_relatorios') },
        { href: '/dashboard/relatorios/dashboard', label: 'Dashboard executivo', description: 'Mapa, evolução mensal, filtros e BI completo', icon: LayoutDashboard, hidden: !podeRelatorios && !hasPermission(user, 'ver_relatorios') },
        { href: '/dashboard/relatorios/aereo', label: 'Relatório aéreo executivo', description: 'Rotas, cias, mapa e custos aéreos', icon: Plane, hidden: !podeRelatorios && !hasPermission(user, 'ver_relatorios') },
        { href: '/dashboard/politicas', label: 'Políticas corporativas', description: 'Catálogo, versões, conflitos e simulação', icon: ShieldCheck, hidden: !podeVerPoliticas },
        { href: '/dashboard/ia/conhecimento', label: 'Base de conhecimento', description: 'Conteúdo corporativo autorizado para a BIA', icon: LibraryBig, hidden: !podeGerenciarIa },
        { href: '/dashboard/automacoes', label: 'Central de automações', description: 'Eventos, regras, workflows e execuções', icon: Zap, hidden: !hasPermission(user, 'executar_automacoes') && !hasPermission(user, 'gerenciar_automacoes') },
        { href: '/dashboard/sustentabilidade', label: 'Sustentabilidade', description: 'ESG e pegada de carbono', icon: Leaf, hidden: !hasPermission(user, 'ver_relatorios') },
        { href: '/dashboard/auditoria', label: 'Auditoria', description: 'Trilha de ações e alterações', icon: History, hidden: !podeVerAuditoria },
      ],
    },
    {
      id: 'admin',
      label: 'Administração',
      itens: [
        { href: '/dashboard/plataforma', label: 'Administração SaaS', description: 'Tenants, planos, limites e consumo', icon: ServerCog, hidden: user.platform_admin !== true },
        { href: '/dashboard/usuarios', label: 'Usuários e permissões', description: 'Equipe interna, clientes e escopos', icon: Shield, hidden: !podeAdministrarAcessos },
        { href: '/dashboard/workflows', label: 'Workflows empresariais', description: 'Processos, aprovações, delegações e SLA', icon: ShieldCheck, hidden: !podeGerenciarWorkflows },
        { href: '/dashboard/configuracoes', label: 'Configurações', description: 'Sistema, IA e conexões', icon: Settings, hidden: !podeAlterarConfiguracoes },
      ],
    },
  ]
}

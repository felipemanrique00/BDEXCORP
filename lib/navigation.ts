import {
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  CalendarCheck,
  CreditCard,
  Database,
  FileBarChart,
  FileStack,
  History,
  Hotel,
  Inbox,
  LayoutDashboard,
  Leaf,
  Network,
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
  type LucideIcon,
} from 'lucide-react'

import { AI_SHORT_NAME } from '@/lib/branding'
import { hasPermission } from '@/lib/auth'
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
  const podeFinanceiro = hasPermission(user, 'ver_financeiro') || hasPermission(user, 'gerenciar_usuarios')
  const podeRelatorios = hasPermission(user, 'gerar_relatorios')
  const podeCadastrarEmpresas = hasPermission(user, 'cadastrar_empresas')
  const podeImportar = hasPermission(user, 'importar_planilhas') || hasPermission(user, 'gerenciar_usuarios')
  const podeUsuarios = hasPermission(user, 'gerenciar_usuarios')
  const podeProdutividade = hasPermission(user, 'ver_produtividade_todos')
  const podeAprovar = hasPermission(user, 'aprovar_demandas') || user.role === 'master'
  const isCompanyUser = user.role !== 'master'

  return [
    {
      id: 'operacao',
      label: 'Operação',
      itens: [
        { href: '/dashboard', label: 'Dashboard executivo', description: 'Cockpit geral da operação', icon: LayoutDashboard, hidden: isCompanyUser },
        {
          href: '/dashboard/portal-empresa',
          label: 'Portal empresas/Grupos',
          description: isCompanyUser ? 'Portal do cliente' : 'Visão cliente, empresa e grupo',
          icon: Building2,
        },
        { href: '/dashboard/caixa-entrada', label: 'Entrada de demandas', description: 'E-mail, áudio, PDF e texto', icon: Inbox, badge: naoLidas || undefined, hidden: isCompanyUser },
        {
          href: '/dashboard/demandas',
          label: 'Fila de demandas',
          description: 'Triagem, SLA, status e alertas',
          icon: Briefcase,
          badge: alertasHoje || novasDemandas || undefined,
          hidden: isCompanyUser,
        },
        { href: '/dashboard/reservas', label: 'Reservas e cotações', description: 'Fornecedores, APIs e portais', icon: CalendarCheck, hidden: isCompanyUser || !podeImportar },
        { href: '/dashboard/vouchers', label: 'Vouchers emitidos', description: 'Documentos emitidos e enviados', icon: FileStack, hidden: isCompanyUser },
        { href: '/dashboard/aprovacoes', label: 'Aprovações', description: 'Workflow multinível de viagens', icon: ShieldCheck, hidden: isCompanyUser || !podeAprovar },
        { href: '/dashboard/risco', label: 'Centro de risco', description: 'Duty of care e viajantes em campo', icon: ShieldAlert, hidden: isCompanyUser },
        { href: '/dashboard/produtividade', label: 'Equipe e produtividade', description: 'Agentes, carga, fila e SLA', icon: BarChart3, hidden: isCompanyUser || !podeProdutividade },
        { href: '/dashboard/ia', label: `Central ${AI_SHORT_NAME}`, description: 'Assistente, canais e agente operacional', icon: Bot, activeWhen: ['/dashboard/ia', '/dashboard/ia-chat', '/dashboard/ia-operacional', '/dashboard/assistente'], hidden: isCompanyUser },
      ],
    },
    {
      id: 'integracoes',
      label: 'Integrações',
      itens: [
        { href: '/dashboard/wintour', label: 'Wintour', description: 'Importação diária de vendas', icon: Database, hidden: isCompanyUser || !podeImportar },
        { href: '/dashboard/reservas', label: 'Conector Tech Travel', description: 'Aéreo, hotel, locação e OS', icon: Hotel, hidden: isCompanyUser || !podeImportar },
        { href: '/dashboard/importar', label: 'Importações gerais', description: 'Planilhas, XML, PDF e bases gerais', icon: Upload, hidden: isCompanyUser || !podeImportar },
        { href: '/dashboard/emissoes', label: 'Emissões e importações', description: 'Tech Travel, XLS, XLSX e PDF', icon: FileStack, hidden: isCompanyUser || !podeImportar },
      ],
    },
    {
      id: 'financeiro',
      label: 'Financeiro',
      itens: [
        { href: '/dashboard/financeiro', label: 'Financeiro operacional', description: 'Pagar, receber e caixa operacional', icon: Wallet, hidden: isCompanyUser || !podeFinanceiro },
        { href: '/dashboard/financeiro?aba=carteira', label: 'Carteira e cartões', description: 'Pix, cartões físicos/virtuais e limites', icon: CreditCard, hidden: isCompanyUser || !podeFinanceiro },
        { href: '/dashboard/financeiro?aba=faturas', label: 'Faturas corporativas', description: 'Fechamento e cobrança de clientes', icon: ReceiptText, hidden: isCompanyUser || !podeFinanceiro },
        { href: '/dashboard/reconciliacao', label: 'Reconciliação', description: 'Divergências e conferência financeira', icon: ShieldAlert, hidden: isCompanyUser || !podeUsuarios },
      ],
    },
    {
      id: 'cadastros',
      label: 'Cadastros',
      itens: [
        { href: '/dashboard/empresas', label: 'Empresas', description: 'Clientes, políticas, acessos e contratos', icon: Building2, hidden: isCompanyUser || !podeCadastrarEmpresas },
        { href: '/dashboard/grupos', label: 'Grupos / holdings', description: 'Holdings, grupos econômicos e vínculos', icon: Network, hidden: isCompanyUser || !podeCadastrarEmpresas },
        { href: '/dashboard/funcionarios', label: 'Viajantes', description: 'Funcionários, documentos e perfis', icon: Users, hidden: isCompanyUser },
        { href: '/dashboard/hoteis', label: 'Hotéis', description: 'Fornecedores e tarifas negociadas', icon: Hotel, hidden: isCompanyUser },
      ],
    },
    {
      id: 'inteligencia',
      label: 'Inteligência',
      itens: [
        { href: '/dashboard/relatorios', label: 'Relatórios e BI', description: 'Resumo executivo e análises', icon: FileBarChart, hidden: isCompanyUser || !podeRelatorios },
        { href: '/dashboard/relatorios/dashboard', label: 'Dashboard executivo', description: 'Mapa, evolução mensal, filtros e BI completo', icon: LayoutDashboard, hidden: isCompanyUser || !podeRelatorios },
        { href: '/dashboard/relatorios/aereo', label: 'Relatório aéreo executivo', description: 'Rotas, cias, mapa e custos aéreos', icon: Plane, hidden: isCompanyUser || !podeRelatorios },
        { href: '/dashboard/sustentabilidade', label: 'Sustentabilidade', description: 'ESG e pegada de carbono', icon: Leaf, hidden: isCompanyUser },
        { href: '/dashboard/auditoria', label: 'Auditoria', description: 'Trilha de ações e alterações', icon: History, hidden: isCompanyUser || !podeUsuarios },
      ],
    },
    {
      id: 'admin',
      label: 'Administração',
      itens: [
        { href: '/dashboard/plataforma', label: 'Administração SaaS', description: 'Tenants, planos, limites e consumo', icon: ServerCog, hidden: user.platform_admin !== true },
        { href: '/dashboard/usuarios', label: 'Usuários e permissões', description: 'Equipe interna, clientes e escopos', icon: Shield, hidden: isCompanyUser || !podeUsuarios },
        { href: '/dashboard/configuracoes', label: 'Configurações', description: 'Sistema, IA e conexões', icon: Settings, hidden: isCompanyUser },
      ],
    },
  ]
}


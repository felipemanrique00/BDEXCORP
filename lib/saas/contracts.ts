export const SaaSRoles = [
  'master',
  'admin_bbt',
  'lider',
  'consultor',
  'financeiro',
  'auditor',
  'cliente_admin',
  'cliente_solicitante',
  'fornecedor',
  'assistente_ia',
  'suporte',
] as const

export type SaaSRole = (typeof SaaSRoles)[number]

export const SaaSPermissions = [
  'companies.read',
  'companies.write',
  'users.manage',
  'employees.read',
  'employees.write',
  'requesters.manage',
  'demands.read',
  'demands.write',
  'demands.approve',
  'hotels.read',
  'hotels.write',
  'reservations.read',
  'reservations.write',
  'vouchers.read',
  'vouchers.write',
  'vouchers.send',
  'finance.read',
  'finance.write',
  'reports.read',
  'reports.export',
  'assistant.configure',
  'assistant.use_tools',
  'audit.read',
] as const

export type SaaSPermission = (typeof SaaSPermissions)[number]

export const DefaultRolePermissions: Record<SaaSRole, SaaSPermission[]> = {
  master: [...SaaSPermissions],
  admin_bbt: [...SaaSPermissions],
  lider: [
    'companies.read',
    'employees.read',
    'requesters.manage',
    'demands.read',
    'demands.write',
    'demands.approve',
    'hotels.read',
    'hotels.write',
    'reservations.read',
    'reservations.write',
    'vouchers.read',
    'vouchers.write',
    'vouchers.send',
    'finance.read',
    'reports.read',
    'reports.export',
    'assistant.use_tools',
    'audit.read',
  ],
  consultor: [
    'companies.read',
    'employees.read',
    'demands.read',
    'demands.write',
    'hotels.read',
    'reservations.read',
    'reservations.write',
    'vouchers.read',
    'vouchers.write',
    'assistant.use_tools',
  ],
  financeiro: ['companies.read', 'demands.read', 'vouchers.read', 'finance.read', 'finance.write', 'reports.read', 'reports.export'],
  auditor: ['companies.read', 'employees.read', 'demands.read', 'vouchers.read', 'finance.read', 'reports.read', 'audit.read'],
  cliente_admin: ['employees.read', 'requesters.manage', 'demands.read', 'demands.write', 'vouchers.read', 'finance.read', 'reports.read'],
  cliente_solicitante: ['demands.read', 'demands.write', 'vouchers.read'],
  fornecedor: ['reservations.read', 'reservations.write', 'vouchers.read'],
  assistente_ia: ['assistant.use_tools'],
  suporte: ['companies.read', 'users.manage', 'audit.read'],
}

export const SaaSProductionModules = [
  {
    key: 'identity',
    name: 'Identidade, auth e permissoes',
    targetTables: ['tenants', 'users', 'user_credentials', 'user_sessions', 'roles', 'permissions', 'company_memberships'],
    mustBeServerFirst: true,
  },
  {
    key: 'companies',
    name: 'Empresas e portal cliente',
    targetTables: ['companies', 'requesters', 'employees'],
    mustBeServerFirst: true,
  },
  {
    key: 'operations',
    name: 'Demandas, reservas, hoteis e vouchers',
    targetTables: ['demands', 'demand_events', 'hotels', 'reservations', 'vouchers', 'generated_documents_core'],
    mustBeServerFirst: true,
  },
  {
    key: 'finance',
    name: 'Financeiro e conciliacao',
    targetTables: ['financial_entries'],
    mustBeServerFirst: true,
  },
  {
    key: 'assistant',
    name: 'Assistente IA, voz e WhatsApp',
    targetTables: ['assistant_settings', 'assistant_tools', 'conversations', 'message_queue_jobs'],
    mustBeServerFirst: true,
  },
  {
    key: 'audit',
    name: 'Auditoria e observabilidade',
    targetTables: ['audit_logs', 'assistant_audit_logs', 'integration_logs', 'security_event_logs'],
    mustBeServerFirst: true,
  },
] as const

export const SaaSMigrationPhases = [
  'Fase 0: inventario e backup dos dados atuais',
  'Fase 1: auth, tenants, users e permissoes',
  'Fase 2: empresas, funcionarios e solicitantes',
  'Fase 3: demandas, hoteis, reservas e vouchers',
  'Fase 4: documentos, PDFs e financeiro',
  'Fase 5: IA, WhatsApp, voz, filas e integracoes',
  'Fase 6: QA, CI/CD, observabilidade, backups e producao',
] as const

export function roleHasPermission(role: SaaSRole, permission: SaaSPermission): boolean {
  return DefaultRolePermissions[role]?.includes(permission) || false
}

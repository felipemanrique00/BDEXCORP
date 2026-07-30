export interface TenantResetForeignKey {
  childTable: string
  parentTable: string
}

export const TENANT_RESET_PRESERVED_TABLES = [
  'app_kv',
  'audit_logs',
  'auth_mfa_challenges',
  'password_reset_tokens',
  'policy_category_strategies',
  'policy_fact_definitions',
  'policy_template_categories',
  'policy_templates',
  'roles',
  'tenant_domain_rollouts',
  'tenant_memberships',
  'tenant_subscriptions',
  'tenant_usage_monthly',
  'user_invites',
  'user_mfa_methods',
  'user_mfa_recovery_codes',
  'user_sessions',
] as const

export const TENANT_BUSINESS_RESET_TABLES = [
  'ai_action_events',
  'ai_action_proposals',
  'ai_invocations',
  'assistant_agent_artifacts',
  'assistant_agent_memories',
  'assistant_agent_runs',
  'assistant_agent_tasks',
  'assistant_conversations',
  'assistant_events',
  'assistant_generated_documents',
  'assistant_integration_sessions',
  'assistant_messages',
  'assistant_settings',
  'assistant_tools',
  'approval_action_tokens',
  'approval_assignments',
  'approval_authorities',
  'approval_decisions',
  'approval_delegation_companies',
  'approval_delegation_groups',
  'approval_delegation_modules',
  'approval_delegations',
  'approval_edges',
  'approval_escalations',
  'approval_events',
  'approval_instances',
  'approval_nodes',
  'approval_notifications',
  'approval_rules',
  'approval_slas',
  'approval_steps',
  'approval_workflow_change_audits',
  'approval_workflow_definitions',
  'approval_workflow_scopes',
  'approval_workflow_versions',
  'approvals',
  'authorization_scope_grants',
  'automation_definitions',
  'automation_events',
  'automation_runs',
  'automation_version_scopes',
  'automation_versions',
  'budget_commitments',
  'budgets',
  'business_calendars',
  'business_groups',
  'calendar_holidays',
  'companies',
  'corporate_cards',
  'corporate_company_access_grants',
  'corporate_group_access_companies',
  'corporate_group_access_grants',
  'corporate_invoice_demands',
  'corporate_invoice_financial_entries',
  'corporate_invoices',
  'corporate_wallet_movements',
  'corporate_wallets',
  'cost_centers',
  'data_migration_discrepancies',
  'data_migration_runs',
  'demand_events',
  'demand_messages',
  'demand_transfer_requests',
  'demands',
  'domain_outbox',
  'employee_aliases',
  'employee_identity_counters',
  'employee_match_decisions',
  'employees',
  'enterprise_workflow_change_audits',
  'enterprise_workflow_commands',
  'enterprise_workflow_definitions',
  'enterprise_workflow_edges',
  'enterprise_workflow_events',
  'enterprise_workflow_executions',
  'enterprise_workflow_nodes',
  'enterprise_workflow_scopes',
  'enterprise_workflow_steps',
  'enterprise_workflow_versions',
  'exchange_rates',
  'financial_entries',
  'hotels',
  'idempotency_keys',
  'import_job_entity_snapshots',
  'import_jobs',
  'integration_action_logs',
  'integration_actor_mappings',
  'integration_company_mappings',
  'integration_providers',
  'integration_webhook_events',
  'intelligence_insight_events',
  'intelligence_insight_states',
  'knowledge_chunks',
  'knowledge_documents',
  'manual_hotel_bookings',
  'membership_corporate_preferences',
  'organizational_units',
  'policy_action_executions',
  'policy_actions',
  'policy_change_audits',
  'policy_conditions',
  'policy_conflicts',
  'policy_decisions',
  'policy_definitions',
  'policy_dependencies',
  'policy_evaluations',
  'policy_exceptions',
  'policy_publications',
  'policy_rule_sets',
  'policy_scopes',
  'policy_simulations',
  'policy_test_cases',
  'policy_versions',
  'policy_violations',
  'projects',
  'reconciliation_alert_events',
  'reconciliation_alerts',
  'reconciliation_runs',
  'report_snapshots',
  'requesters',
  'reservations',
  'stored_file_links',
  'stored_files',
  'tenant_ai_settings',
  'tenant_domain_rollout_companies',
  'tenant_number_sequences',
  'travel_cancellations',
  'travel_desk_notes',
  'travel_emissions',
  'travel_policy_justifications',
  'travel_provider_operations',
  'travel_quote_options',
  'travel_quotes',
  'travel_reapproval_checks',
  'travel_refund_events',
  'travel_refunds',
  'travel_segments',
  'travel_state_events',
  'vouchers',
] as const

export const TENANT_RESET_NULLABLE_EDGE_BREAKS: readonly TenantResetForeignKey[] = [
  { childTable: 'approval_instances', parentTable: 'approval_instances' },
  { childTable: 'automation_definitions', parentTable: 'automation_versions' },
  { childTable: 'cost_centers', parentTable: 'cost_centers' },
  { childTable: 'demands', parentTable: 'approval_instances' },
  { childTable: 'demands', parentTable: 'policy_evaluations' },
  { childTable: 'organizational_units', parentTable: 'organizational_units' },
  { childTable: 'policy_conditions', parentTable: 'policy_conditions' },
  { childTable: 'reservations', parentTable: 'policy_evaluations' },
  { childTable: 'reservations', parentTable: 'travel_quote_options' },
  { childTable: 'reservations', parentTable: 'travel_quotes' },
] as const

const RESET_TABLE_SET = new Set<string>(TENANT_BUSINESS_RESET_TABLES)
const PRESERVED_TABLE_SET = new Set<string>(TENANT_RESET_PRESERVED_TABLES)
const NULLABLE_EDGE_BREAK_SET = new Set(
  TENANT_RESET_NULLABLE_EDGE_BREAKS.map(edgeKey),
)

export class TenantResetPolicyError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'TenantResetPolicyError'
  }
}

export function buildTenantResetDeleteOrder(
  foreignKeys: readonly TenantResetForeignKey[],
): string[] {
  const adjacency = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()

  for (const table of TENANT_BUSINESS_RESET_TABLES) {
    adjacency.set(table, new Set())
    inDegree.set(table, 0)
  }

  for (const edge of foreignKeys) {
    if (!RESET_TABLE_SET.has(edge.childTable) || !RESET_TABLE_SET.has(edge.parentTable)) continue
    if (NULLABLE_EDGE_BREAK_SET.has(edgeKey(edge))) continue

    const parents = adjacency.get(edge.childTable)!
    if (parents.has(edge.parentTable)) continue
    parents.add(edge.parentTable)
    inDegree.set(edge.parentTable, (inDegree.get(edge.parentTable) || 0) + 1)
  }

  const ready = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([table]) => table)
    .sort()
  const order: string[] = []

  while (ready.length) {
    const table = ready.shift()!
    order.push(table)
    for (const parent of adjacency.get(table) || []) {
      const nextDegree = (inDegree.get(parent) || 0) - 1
      inDegree.set(parent, nextDegree)
      if (nextDegree === 0) {
        ready.push(parent)
        ready.sort()
      }
    }
  }

  if (order.length !== TENANT_BUSINESS_RESET_TABLES.length) {
    const blocked = [...inDegree.entries()]
      .filter(([, degree]) => degree > 0)
      .map(([table]) => table)
      .sort()
    throw new TenantResetPolicyError(
      `Dependencias ciclicas nao tratadas no reset: ${blocked.join(', ')}.`,
      'TENANT_RESET_CYCLE',
    )
  }

  return order
}

export function validateTenantResetSchema(args: {
  tenantTables: readonly string[]
  foreignKeys: readonly TenantResetForeignKey[]
}): string[] {
  const expectedTables = new Set([...RESET_TABLE_SET, ...PRESERVED_TABLE_SET])
  const actualTables = new Set(args.tenantTables)
  const missing = [...expectedTables].filter((table) => !actualTables.has(table)).sort()
  const unclassified = [...actualTables].filter((table) => !expectedTables.has(table)).sort()

  if (missing.length || unclassified.length) {
    throw new TenantResetPolicyError(
      [
        missing.length ? `tabelas ausentes: ${missing.join(', ')}` : '',
        unclassified.length ? `tabelas sem classificacao: ${unclassified.join(', ')}` : '',
      ].filter(Boolean).join('; '),
      'TENANT_RESET_SCHEMA_MISMATCH',
    )
  }

  const externalReferences = args.foreignKeys.filter((edge) => (
    RESET_TABLE_SET.has(edge.parentTable)
    && !RESET_TABLE_SET.has(edge.childTable)
  ))
  if (externalReferences.length) {
    const references = externalReferences
      .map((edge) => `${edge.childTable}->${edge.parentTable}`)
      .sort()
    throw new TenantResetPolicyError(
      `Tabelas preservadas referenciam dados apagaveis: ${references.join(', ')}.`,
      'TENANT_RESET_EXTERNAL_REFERENCE',
    )
  }

  return buildTenantResetDeleteOrder(args.foreignKeys)
}

function edgeKey(edge: TenantResetForeignKey): string {
  return `${edge.childTable}->${edge.parentTable}`
}

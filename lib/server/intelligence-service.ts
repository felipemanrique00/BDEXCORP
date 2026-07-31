import 'server-only'

import { createHash } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import type {
  IntelligenceBreakdown,
  IntelligenceFilters,
  IntelligenceInsight,
  IntelligenceInsightStatus,
  IntelligenceOverview,
  IntelligenceScope,
  IntelligenceSeverity,
} from '@/lib/intelligence'
import { authorizeOrThrow } from '@/lib/server/authorization-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  requireCompanyAccess,
  requireCompanySelectionAccess,
  requireGroupAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { Permissoes } from '@/types'

interface SummaryRow extends QueryResultRow {
  transactions: string
  total_spend: string
  travelers: string
  verified_savings: string
  comparable_items: string
  average_advance_days: string | null
  urgent_transactions: string
  missing_cost_center: string
  unmatched_employees: string
  overdue_sla: string
  overdue_sla_amount: string
}

interface SeriesRow extends QueryResultRow {
  key: string
  transactions: string
  total: string
  savings: string
}

interface BreakdownRow extends QueryResultRow {
  key: string
  label: string
  transactions: string
  total: string
}

interface GovernanceRow extends QueryResultRow {
  policy_evaluations: string
  policy_passed: string
  policy_violations: string
  pending_approvals: string
  overdue_approvals: string
  pending_refunds: string
  pending_refund_amount: string
  reconciliation_alerts: string
  critical_reconciliation_alerts: string
  budgets_at_risk: string
  budget_exposure: string
  outstanding_finance: string
}

interface InsightStateRow extends QueryResultRow {
  fingerprint: string
  status: IntelligenceInsightStatus
  version: string | number
  first_detected_at: Date | string
  last_detected_at: Date | string
  resolution_note: string | null
  inserted?: boolean
}

interface InsightDraft {
  fingerprint: string
  type: string
  severity: IntelligenceSeverity
  title: string
  description: string
  recommendation: string
  metricValue: number
  estimatedImpact: number
  companyId: string | null
  companyName: string | null
  evidence: Record<string, unknown>
}

export class IntelligenceServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'IntelligenceServiceError'
  }
}

const DEMAND_BASE_CTE = `
with raw_demands as (
  select
    demand.id,
    demand.company_id,
    coalesce(company.trade_name, company.legal_name) as company_name,
    demand.employee_id,
    demand.passenger_name_snapshot,
    demand.service_type,
    demand.status,
    demand.lifecycle_status,
    demand.travel_start_date,
    demand.cost_center,
    demand.final_amount,
    demand.estimated_amount,
    demand.sla_due_at,
    demand.created_at,
    demand.created_at::date as activity_date,
    case
      when coalesce(demand.metadata #>> '{legacySnapshot,valor_referencia_economia}', '')
        ~ '^[0-9]+([.][0-9]+)?$'
      then (demand.metadata #>> '{legacySnapshot,valor_referencia_economia}')::numeric
      when demand.estimated_amount > demand.final_amount
      then demand.estimated_amount
      else 0
    end as reference_amount,
    coalesce(
      nullif(trim(demand.metadata #>> '{serviceDetails,hotel,hotel_nome}'), ''),
      nullif(trim(demand.metadata #>> '{serviceDetails,air,cia_aerea}'), ''),
      nullif(trim(demand.metadata #>> '{serviceDetails,car,locadora}'), ''),
      nullif(trim(demand.metadata #>> '{serviceDetails,package,descricao}'), ''),
      nullif(trim(demand.metadata #>> '{legacySnapshot,wintour_dados,fornecedor_nome}'), ''),
      'Nao informado'
    ) as supplier
  from demands demand
  join companies company
    on company.tenant_id = demand.tenant_id
   and company.id = demand.company_id
  where demand.tenant_id = $1
    and demand.company_id = any($2::text[])
    and demand.deleted_at is null
    and demand.created_at::date between $3::date and $4::date
),
scoped_demands as (
  select
    raw_demands.*,
    greatest(reference_amount - final_amount, 0) as verified_savings,
    case
      when travel_start_date is null then null
      else travel_start_date - activity_date
    end as advance_days,
    status in ('cancelado', 'canceled', 'cancelled')
      or lifecycle_status in ('canceled', 'cancelled') as cancelled
  from raw_demands
)`

export async function getIntelligenceOverview(
  principal: RequestPrincipal,
  filters: IntelligenceFilters,
): Promise<IntelligenceOverview> {
  authorizeOrThrow(principal, {
    resource: 'intelligence',
    action: 'read',
    requiredPermission: 'ver_inteligencia',
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  })
  const scope = await resolveIntelligenceScope(principal, filters)
  const periodDays = daysInclusive(filters.startDate, filters.endDate)
  if (!scope.companyIds.length) {
    return emptyOverview(scope, filters, periodDays)
  }

  const financeCompanyIds = scopedCompanyIds(principal, scope.companyIds, 'ver_financeiro')
  const policyCompanyIds = scopedCompanyIds(principal, scope.companyIds, 'ver_politicas')
  const budgetCompanyIds = scopedCompanyIds(principal, scope.companyIds, 'ver_orcamentos')

  return withTenantTransaction(principal.tenantId, async (client) => {
    const queryValues = [
      principal.tenantId,
      scope.companyIds,
      filters.startDate,
      filters.endDate,
    ]
    const summaryResult = await client.query<SummaryRow>(
      `${DEMAND_BASE_CTE}
       select
         count(*) filter (where not cancelled)::text as transactions,
         coalesce(sum(final_amount) filter (where not cancelled), 0)::text as total_spend,
         count(distinct coalesce(
           employee_id,
           'name:' || lower(trim(passenger_name_snapshot))
         )) filter (where not cancelled)::text as travelers,
         coalesce(sum(verified_savings) filter (where not cancelled), 0)::text
           as verified_savings,
         count(*) filter (where not cancelled and reference_amount > 0)::text
           as comparable_items,
         avg(advance_days) filter (where not cancelled and advance_days >= 0)::text
           as average_advance_days,
         count(*) filter (where not cancelled and advance_days between 0 and 2)::text
           as urgent_transactions,
         count(*) filter (where not cancelled and coalesce(trim(cost_center), '') = '')::text
           as missing_cost_center,
         count(*) filter (where not cancelled and employee_id is null)::text
           as unmatched_employees,
         count(*) filter (
           where not cancelled
             and sla_due_at < now()
             and status not in ('finalizado', 'cancelado')
         )::text as overdue_sla,
         coalesce(sum(final_amount) filter (
           where not cancelled
             and sla_due_at < now()
             and status not in ('finalizado', 'cancelado')
         ), 0)::text as overdue_sla_amount
       from scoped_demands`,
      queryValues,
    )
    const summary = summaryResult.rows[0] || emptySummary()

    const monthlyRows = await client.query<SeriesRow>(
      `${DEMAND_BASE_CTE}
       select
         to_char(date_trunc('month', activity_date), 'YYYY-MM') as key,
         count(*)::text as transactions,
         coalesce(sum(final_amount), 0)::text as total,
         coalesce(sum(verified_savings), 0)::text as savings
       from scoped_demands
       where not cancelled
       group by date_trunc('month', activity_date)
       order by date_trunc('month', activity_date)`,
      queryValues,
    )
    const serviceRows = await queryBreakdown(client, queryValues, 'service_type', 'service_type')
    const companyRows = await queryBreakdown(client, queryValues, 'company_id', 'company_name')
    const statusRows = await queryBreakdown(client, queryValues, 'lifecycle_status', 'lifecycle_status')
    const supplierRows = await queryBreakdown(client, queryValues, 'supplier', 'supplier', 8)
    const governance = await queryGovernance(
      client,
      principal.tenantId,
      filters,
      scope.companyIds,
      policyCompanyIds,
      budgetCompanyIds,
      financeCompanyIds,
    )

    const totalSpend = numeric(summary.total_spend)
    const transactions = integer(summary.transactions)
    const serviceBreakdown = mapBreakdown(serviceRows, totalSpend, serviceLabel)
    const companyBreakdown = mapBreakdown(companyRows, totalSpend)
    const statusBreakdown = mapBreakdown(statusRows, totalSpend, statusLabel)
    const supplierBreakdown = mapBreakdown(supplierRows, totalSpend)
    const drafts = buildInsights({
      filters,
      scope,
      summary,
      governance,
      totalSpend,
      transactions,
      suppliers: supplierBreakdown,
    })
    const insights = await syncInsightStates(client, principal, filters, scope, drafts)
    const policyEvaluations = integer(governance.policy_evaluations)

    return {
      period: {
        startDate: filters.startDate,
        endDate: filters.endDate,
        days: periodDays,
      },
      scope,
      kpis: {
        totalSpend,
        transactions,
        travelers: integer(summary.travelers),
        averageTicket: transactions ? totalSpend / transactions : 0,
        verifiedSavings: numeric(summary.verified_savings),
        savingsCoveragePct: transactions
          ? (integer(summary.comparable_items) / transactions) * 100
          : 0,
        policyCompliancePct: policyEvaluations
          ? (integer(governance.policy_passed) / policyEvaluations) * 100
          : null,
        averageAdvanceDays: numeric(summary.average_advance_days),
        urgentTransactions: integer(summary.urgent_transactions),
        overdueSla: integer(summary.overdue_sla),
        pendingApprovals: integer(governance.pending_approvals),
        pendingRefunds: integer(governance.pending_refunds),
        outstandingFinance: financeCompanyIds.length
          ? numeric(governance.outstanding_finance)
          : null,
        financeCompanyCount: financeCompanyIds.length,
      },
      monthly: monthlyRows.rows.map((row) => ({
        period: row.key,
        label: monthLabel(row.key),
        transactions: integer(row.transactions),
        total: numeric(row.total),
        savings: numeric(row.savings),
      })),
      services: serviceBreakdown,
      companies: companyBreakdown,
      statuses: statusBreakdown,
      suppliers: supplierBreakdown,
      insights,
      generatedAt: new Date().toISOString(),
    }
  })
}

export async function transitionIntelligenceInsightState(
  principal: RequestPrincipal,
  fingerprint: string,
  input: IntelligenceFilters & {
    status: IntelligenceInsightStatus
    expectedVersion: number
    note: string
  },
): Promise<IntelligenceInsight> {
  authorizeOrThrow(principal, {
    resource: 'intelligence',
    action: 'manage',
    requiredPermission: 'gerenciar_ia',
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  })
  const overview = await getIntelligenceOverview(principal, input)
  const currentInsight = overview.insights.find((item) => item.fingerprint === fingerprint)
  if (!currentInsight) {
    throw new IntelligenceServiceError(
      'INTELLIGENCE_INSIGHT_NOT_CURRENT',
      'O sinal nao pertence ao periodo e escopo autorizados ou deixou de existir.',
      404,
    )
  }

  const updated = await withTenantTransaction(principal.tenantId, async (client) => {
    const actorId = principal.user.id
    const result = await client.query<InsightStateRow>(
      `update intelligence_insight_states
       set status = $4,
           acknowledged_by = case when $4 = 'acknowledged' then $5::uuid else null end,
           acknowledged_at = case when $4 = 'acknowledged' then now() else null end,
           resolved_by = case when $4 in ('resolved', 'dismissed') then $5::uuid else null end,
           resolved_at = case when $4 in ('resolved', 'dismissed') then now() else null end,
           resolution_note = case when $4 = 'open' then null else $6 end,
           version = version + 1,
           updated_at = now()
       where tenant_id = $1
         and fingerprint = $2
         and version = $3
       returning fingerprint, status, version, first_detected_at,
                 last_detected_at, resolution_note`,
      [
        principal.tenantId,
        fingerprint,
        input.expectedVersion,
        input.status,
        actorId,
        input.note.trim(),
      ],
    )
    const row = result.rows[0]
    if (!row) {
      throw new IntelligenceServiceError(
        'INTELLIGENCE_INSIGHT_CONFLICT',
        'O sinal foi atualizado por outra pessoa. Recarregue antes de repetir.',
        409,
      )
    }
    await client.query(
      `insert into intelligence_insight_events (
         tenant_id, insight_state_id, action, from_status, to_status,
         note, snapshot, actor_user_id
       )
       select tenant_id, id, $3, $4, $5, $6, last_snapshot, $7
       from intelligence_insight_states
       where tenant_id = $1 and fingerprint = $2`,
      [
        principal.tenantId,
        fingerprint,
        transitionAction(input.status),
        currentInsight.status,
        input.status,
        input.note.trim(),
        actorId,
      ],
    )
    return mergeInsightState(currentInsight, row)
  })

  await writeAuditEvent({
    action: `intelligence.insight.${transitionAction(input.status)}`,
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    entityType: 'intelligence_insight',
    entityId: fingerprint,
    metadata: {
      fromStatus: currentInsight.status,
      toStatus: input.status,
      contextType: overview.scope.type,
      contextId: overview.scope.id,
      companyIds: overview.scope.companyIds,
    },
  })
  return updated
}

async function resolveIntelligenceScope(
  principal: RequestPrincipal,
  filters: IntelligenceFilters,
): Promise<IntelligenceScope> {
  const allowedCompanies = (principal.corporateAccess?.companies || [])
    .filter((company) => company.permissions.ver_inteligencia)

  if (filters.companyIds?.length) {
    const companyIds = await requireCompanySelectionAccess(
      principal,
      filters.companyIds,
      'ver_inteligencia',
    )
    const companies = companyIds.map((companyId) => {
      const company = allowedCompanies.find((item) => item.companyId === companyId)
      return { id: companyId, name: company?.companyName || companyId }
    })

    if (companyIds.length === 1) {
      return {
        type: 'company',
        id: companyIds[0],
        label: companies[0]?.name || companyIds[0],
        companyIds,
        companies,
      }
    }

    const selectedIds = new Set(companyIds)
    const exactGroup = principal.corporateAccess?.contexts.find((context) => (
      context.type === 'group'
      && context.canViewConsolidated
      && context.companyIds.length === selectedIds.size
      && context.companyIds.every((companyId) => selectedIds.has(companyId))
    ))
    if (exactGroup) {
      return {
        type: 'group',
        id: exactGroup.id,
        label: exactGroup.label,
        companyIds,
        companies,
      }
    }

    return {
      type: 'tenant',
      id: null,
      label: `Selecao personalizada (${companyIds.length} empresas)`,
      companyIds,
      companies,
    }
  }

  if (filters.contextType === 'company' && filters.contextId) {
    const access = await requireCompanyAccess(principal, filters.contextId, 'ver_inteligencia')
    return {
      type: 'company',
      id: access.companyId,
      label: access.companyName,
      companyIds: [access.companyId],
      companies: [{ id: access.companyId, name: access.companyName }],
    }
  }

  if (filters.contextType === 'group' && filters.contextId) {
    const access = await requireGroupAccess(principal, filters.contextId, 'ver_inteligencia')
    if (!access.canViewConsolidated) {
      throw new IntelligenceServiceError(
        'INTELLIGENCE_CONSOLIDATED_DENIED',
        'A visao consolidada deste grupo nao esta autorizada.',
        403,
      )
    }
    const companyIds = access.companyIds.filter((companyId) => (
      allowedCompanies.some((company) => company.companyId === companyId)
    ))
    return {
      type: 'group',
      id: access.groupId,
      label: access.groupName,
      companyIds,
      companies: companyIds.map((companyId) => {
        const company = allowedCompanies.find((item) => item.companyId === companyId)
        return { id: companyId, name: company?.companyName || companyId }
      }),
    }
  }

  return {
    type: 'tenant',
    id: null,
    label: 'Empresas autorizadas',
    companyIds: allowedCompanies.map((company) => company.companyId),
    companies: allowedCompanies.map((company) => ({
      id: company.companyId,
      name: company.companyName,
    })),
  }
}

async function queryBreakdown(
  client: PoolClient,
  values: unknown[],
  keyExpression: string,
  labelExpression: string,
  limit = 12,
): Promise<BreakdownRow[]> {
  const result = await client.query<BreakdownRow>(
    `${DEMAND_BASE_CTE}
     select
       coalesce(nullif(trim(${keyExpression}), ''), 'not-informed') as key,
       coalesce(nullif(trim(${labelExpression}), ''), 'Nao informado') as label,
       count(*)::text as transactions,
       coalesce(sum(final_amount), 0)::text as total
     from scoped_demands
     where not cancelled
     group by 1, 2
     order by sum(final_amount) desc, count(*) desc
     limit ${Math.min(25, Math.max(1, limit))}`,
    values,
  )
  return result.rows
}

async function queryGovernance(
  client: PoolClient,
  tenantId: string,
  filters: IntelligenceFilters,
  companyIds: string[],
  policyCompanyIds: string[],
  budgetCompanyIds: string[],
  financeCompanyIds: string[],
): Promise<GovernanceRow> {
  const result = await client.query<GovernanceRow>(
    `select
       (select count(*) from policy_evaluations
        where tenant_id = $1
          and company_id = any($5::text[])
          and mode = 'enforce'
          and evaluated_at::date between $2::date and $3::date)::text
         as policy_evaluations,
       (select count(*) from policy_evaluations
        where tenant_id = $1
          and company_id = any($5::text[])
          and mode = 'enforce'
          and passed
          and evaluated_at::date between $2::date and $3::date)::text
         as policy_passed,
       (select count(*)
        from policy_violations violation
        join policy_evaluations evaluation
          on evaluation.tenant_id = violation.tenant_id
         and evaluation.id = violation.evaluation_id
        where violation.tenant_id = $1
          and evaluation.company_id = any($5::text[])
          and violation.status = 'open'
          and violation.created_at::date between $2::date and $3::date)::text
         as policy_violations,
       (select count(*) from approval_instances
        where tenant_id = $1
          and company_id = any($4::text[])
          and status in ('pending', 'in_progress'))::text
         as pending_approvals,
       (select count(*)
        from approval_steps step
        join approval_instances instance
          on instance.tenant_id = step.tenant_id
         and instance.id = step.approval_instance_id
        where step.tenant_id = $1
          and instance.company_id = any($4::text[])
          and step.status = 'pending'
          and step.due_at < now())::text
         as overdue_approvals,
       (select count(*) from travel_refunds
        where tenant_id = $1
          and company_id = any($4::text[])
          and status in ('pending', 'processing', 'partially_refunded'))::text
         as pending_refunds,
       (select coalesce(sum(greatest(
          coalesce(requested_amount, 0) - refunded_amount, 0
        )), 0) from travel_refunds
        where tenant_id = $1
          and company_id = any($4::text[])
          and status in ('pending', 'processing', 'partially_refunded'))::text
         as pending_refund_amount,
       (select count(*) from reconciliation_alerts
        where tenant_id = $1
          and company_id = any($4::text[])
          and status = 'open')::text
         as reconciliation_alerts,
       (select count(*) from reconciliation_alerts
        where tenant_id = $1
          and company_id = any($4::text[])
          and status = 'open'
          and severity in ('critico', 'alto'))::text
         as critical_reconciliation_alerts,
       (select count(*) from budgets
        where tenant_id = $1
          and company_id = any($6::text[])
          and status = 'active'
          and amount > 0
          and (committed_amount + consumed_amount) / amount >= 0.8)::text
         as budgets_at_risk,
       (select coalesce(sum(greatest(
          committed_amount + consumed_amount - (amount * 0.8), 0
        )), 0) from budgets
        where tenant_id = $1
          and company_id = any($6::text[])
          and status = 'active'
          and amount > 0
          and (committed_amount + consumed_amount) / amount >= 0.8)::text
         as budget_exposure,
       (select coalesce(sum(amount), 0) from financial_entries
        where tenant_id = $1
          and company_id = any($7::text[])
          and status not in ('paid', 'settled', 'cancelled', 'canceled')
          and due_date between $2::date and $3::date)::text
         as outstanding_finance`,
    [
      tenantId,
      filters.startDate,
      filters.endDate,
      companyIds,
      policyCompanyIds,
      budgetCompanyIds,
      financeCompanyIds,
    ],
  )
  return result.rows[0] || emptyGovernance()
}

function buildInsights(input: {
  filters: IntelligenceFilters
  scope: IntelligenceScope
  summary: SummaryRow
  governance: GovernanceRow
  totalSpend: number
  transactions: number
  suppliers: IntelligenceBreakdown[]
}): InsightDraft[] {
  const drafts: InsightDraft[] = []
  const commonEvidence = {
    startDate: input.filters.startDate,
    endDate: input.filters.endDate,
    companyCount: input.scope.companyIds.length,
  }
  const add = (value: Omit<InsightDraft, 'fingerprint'>) => {
    drafts.push({
      ...value,
      fingerprint: fingerprintFor(
        value.type,
        input.scope,
        input.filters,
        value.companyId,
      ),
    })
  }

  const overdueSla = integer(input.summary.overdue_sla)
  if (overdueSla > 0) {
    add({
      type: 'overdue_sla',
      severity: overdueSla >= 10 ? 'critical' : 'high',
      title: 'Demandas com SLA vencido',
      description: `${overdueSla} demanda(s) permanecem abertas depois do prazo de atendimento.`,
      recommendation: 'Priorize a fila vencida, registre o motivo e redistribua capacidade quando necessario.',
      metricValue: overdueSla,
      estimatedImpact: numeric(input.summary.overdue_sla_amount),
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, overdueSla },
    })
  }

  const urgent = integer(input.summary.urgent_transactions)
  if (urgent > 0) {
    const urgentPct = input.transactions ? (urgent / input.transactions) * 100 : 0
    add({
      type: 'late_purchase',
      severity: urgentPct >= 30 ? 'high' : 'warning',
      title: 'Compras com baixa antecedencia',
      description: `${urgent} transacao(oes) foram solicitadas com ate dois dias de antecedencia (${formatPct(urgentPct)}).`,
      recommendation: 'Atue com os centros de custo recorrentes e antecipe o planejamento das viagens.',
      metricValue: urgent,
      estimatedImpact: 0,
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, urgentPct },
    })
  }

  const unmatched = integer(input.summary.unmatched_employees)
  if (unmatched > 0) {
    add({
      type: 'unmatched_employee',
      severity: 'high',
      title: 'Reservas sem identidade consolidada',
      description: `${unmatched} demanda(s) ainda nao estao vinculadas a um ID unico de viajante.`,
      recommendation: 'Revise as sugestoes de identidade e confirme os vinculos antes de fechar o relatorio.',
      metricValue: unmatched,
      estimatedImpact: 0,
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, unmatched },
    })
  }

  const missingCostCenter = integer(input.summary.missing_cost_center)
  if (missingCostCenter > 0) {
    add({
      type: 'missing_cost_center',
      severity: missingCostCenter >= 10 ? 'high' : 'warning',
      title: 'Lancamentos sem centro de custo',
      description: `${missingCostCenter} transacao(oes) reduzem a rastreabilidade financeira por falta de centro de custo.`,
      recommendation: 'Complete a classificacao e torne o centro de custo obrigatorio na politica aplicavel.',
      metricValue: missingCostCenter,
      estimatedImpact: 0,
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, missingCostCenter },
    })
  }

  const violations = integer(input.governance.policy_violations)
  if (violations > 0) {
    add({
      type: 'open_policy_violations',
      severity: violations >= 10 ? 'critical' : 'high',
      title: 'Violacoes de politica em aberto',
      description: `${violations} violacao(oes) de politica aguardam justificativa, aprovacao ou remediacao.`,
      recommendation: 'Revise os bloqueios antes de reservar ou emitir e trate as excecoes no workflow oficial.',
      metricValue: violations,
      estimatedImpact: 0,
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, violations },
    })
  }

  const overdueApprovals = integer(input.governance.overdue_approvals)
  if (overdueApprovals > 0) {
    add({
      type: 'overdue_approval',
      severity: overdueApprovals >= 5 ? 'critical' : 'high',
      title: 'Aprovacoes fora do prazo',
      description: `${overdueApprovals} etapa(s) de aprovacao ultrapassaram o SLA configurado.`,
      recommendation: 'Acione o escalonamento previsto e confirme se os aprovadores continuam validos.',
      metricValue: overdueApprovals,
      estimatedImpact: 0,
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, overdueApprovals },
    })
  }

  const pendingRefunds = integer(input.governance.pending_refunds)
  if (pendingRefunds > 0) {
    add({
      type: 'pending_refund',
      severity: 'warning',
      title: 'Reembolsos pendentes',
      description: `${pendingRefunds} reembolso(s) ainda nao foram integralmente recebidos.`,
      recommendation: 'Acompanhe o protocolo do fornecedor e concilie o valor quando o credito ocorrer.',
      metricValue: pendingRefunds,
      estimatedImpact: numeric(input.governance.pending_refund_amount),
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, pendingRefunds },
    })
  }

  const budgetsAtRisk = integer(input.governance.budgets_at_risk)
  if (budgetsAtRisk > 0) {
    add({
      type: 'budget_risk',
      severity: 'critical',
      title: 'Orcamentos em faixa de risco',
      description: `${budgetsAtRisk} orcamento(s) ativos atingiram ao menos 80% entre consumo e compromisso.`,
      recommendation: 'Revise compromissos, previsao de viagens e necessidade de suplementacao autorizada.',
      metricValue: budgetsAtRisk,
      estimatedImpact: numeric(input.governance.budget_exposure),
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, budgetsAtRisk },
    })
  }

  const reconciliation = integer(input.governance.reconciliation_alerts)
  if (reconciliation > 0) {
    const critical = integer(input.governance.critical_reconciliation_alerts)
    add({
      type: 'reconciliation_alert',
      severity: critical > 0 ? 'critical' : 'warning',
      title: 'Divergencias de reconciliacao',
      description: `${reconciliation} alerta(s) de reconciliacao seguem abertos${critical ? `, sendo ${critical} de alta criticidade` : ''}.`,
      recommendation: 'Corrija a origem ou registre a resolucao na central de reconciliacao.',
      metricValue: reconciliation,
      estimatedImpact: 0,
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, reconciliation, critical },
    })
  }

  const comparable = integer(input.summary.comparable_items)
  const coverage = input.transactions ? (comparable / input.transactions) * 100 : 0
  if (input.transactions >= 5 && coverage < 50) {
    add({
      type: 'low_savings_coverage',
      severity: 'info',
      title: 'Baixa cobertura de economia comprovada',
      description: `Somente ${formatPct(coverage)} das transacoes possuem valor de referencia comparavel.`,
      recommendation: 'Registre a cotacao original ou outra referencia auditavel antes da emissao.',
      metricValue: coverage,
      estimatedImpact: 0,
      companyId: null,
      companyName: null,
      evidence: { ...commonEvidence, comparable, transactions: input.transactions },
    })
  }

  const topSupplier = input.suppliers[0]
  if (topSupplier && topSupplier.key !== 'not-informed' && topSupplier.percentage >= 45) {
    add({
      type: 'supplier_concentration',
      severity: topSupplier.percentage >= 70 ? 'high' : 'warning',
      title: 'Concentracao relevante em fornecedor',
      description: `${topSupplier.label} representa ${formatPct(topSupplier.percentage)} do valor final no periodo.`,
      recommendation: 'Compare alternativas e confirme se a concentracao decorre de contrato negociado.',
      metricValue: topSupplier.percentage,
      estimatedImpact: topSupplier.total,
      companyId: null,
      companyName: null,
      evidence: {
        ...commonEvidence,
        supplier: topSupplier.label,
        supplierTotal: topSupplier.total,
        totalSpend: input.totalSpend,
      },
    })
  }

  return drafts
}

async function syncInsightStates(
  client: PoolClient,
  principal: RequestPrincipal,
  filters: IntelligenceFilters,
  scope: IntelligenceScope,
  drafts: InsightDraft[],
): Promise<IntelligenceInsight[]> {
  const insights: IntelligenceInsight[] = []
  for (const draft of drafts) {
    const snapshot = {
      description: draft.description,
      recommendation: draft.recommendation,
      metricValue: draft.metricValue,
      estimatedImpact: draft.estimatedImpact,
      companyId: draft.companyId,
      companyName: draft.companyName,
      evidence: draft.evidence,
      period: { startDate: filters.startDate, endDate: filters.endDate },
      companyIds: scope.companyIds,
    }
    const result = await client.query<InsightStateRow>(
      `insert into intelligence_insight_states (
         tenant_id, fingerprint, insight_type, scope_type, scope_id,
         severity, title, last_snapshot
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (tenant_id, fingerprint) do update set
         severity = excluded.severity,
         title = excluded.title,
         last_snapshot = excluded.last_snapshot,
         last_detected_at = now(),
         updated_at = now()
       returning fingerprint, status, version, first_detected_at,
                 last_detected_at, resolution_note, (xmax = 0) as inserted`,
      [
        principal.tenantId,
        draft.fingerprint,
        draft.type,
        scope.type,
        scope.id,
        draft.severity,
        draft.title,
        JSON.stringify(snapshot),
      ],
    )
    const state = result.rows[0]
    if (!state) continue
    if (state.inserted) {
      await client.query(
        `insert into intelligence_insight_events (
           tenant_id, insight_state_id, action, to_status, snapshot
         )
         select tenant_id, id, 'detected', status, last_snapshot
         from intelligence_insight_states
         where tenant_id = $1 and fingerprint = $2`,
        [principal.tenantId, draft.fingerprint],
      )
    }
    insights.push(mergeInsightState(draft, state))
  }
  return insights.sort((left, right) => (
    severityRank(right.severity) - severityRank(left.severity)
    || right.estimatedImpact - left.estimatedImpact
    || left.title.localeCompare(right.title)
  ))
}

function mergeInsightState(
  draft: InsightDraft | IntelligenceInsight,
  state: InsightStateRow,
): IntelligenceInsight {
  return {
    ...draft,
    status: state.status,
    version: integer(state.version),
    firstDetectedAt: iso(state.first_detected_at),
    lastDetectedAt: iso(state.last_detected_at),
    resolutionNote: state.resolution_note,
  }
}

function scopedCompanyIds(
  principal: RequestPrincipal,
  selectedCompanyIds: string[],
  permission: keyof Permissoes,
): string[] {
  const selected = new Set(selectedCompanyIds)
  return (principal.corporateAccess?.companies || [])
    .filter((company) => selected.has(company.companyId) && company.permissions[permission])
    .map((company) => company.companyId)
}

function mapBreakdown(
  rows: BreakdownRow[],
  totalSpend: number,
  labelMapper: (value: string) => string = (value) => value,
): IntelligenceBreakdown[] {
  return rows.map((row) => {
    const total = numeric(row.total)
    return {
      key: row.key,
      label: labelMapper(row.label),
      transactions: integer(row.transactions),
      total,
      percentage: totalSpend ? (total / totalSpend) * 100 : 0,
    }
  })
}

function serviceLabel(value: string): string {
  return ({
    air: 'Aereo',
    hotel: 'Hospedagem',
    car: 'Locacao de veiculo',
    bus: 'Rodoviario',
    transfer: 'Transfer',
    insurance: 'Seguro viagem',
    package: 'Pacote',
    other: 'Outros',
  } as Record<string, string>)[value] || value
}

function statusLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function fingerprintFor(
  type: string,
  scope: IntelligenceScope,
  filters: IntelligenceFilters,
  companyId: string | null,
): string {
  return createHash('sha256').update(JSON.stringify({
    type,
    scopeType: scope.type,
    scopeId: scope.id,
    companyIds: [...scope.companyIds].sort(),
    companyId,
    startDate: filters.startDate,
    endDate: filters.endDate,
  })).digest('hex')
}

function transitionAction(status: IntelligenceInsightStatus): string {
  if (status === 'open') return 'reopened'
  return status
}

function emptyOverview(
  scope: IntelligenceScope,
  filters: IntelligenceFilters,
  days: number,
): IntelligenceOverview {
  return {
    period: { startDate: filters.startDate, endDate: filters.endDate, days },
    scope,
    kpis: {
      totalSpend: 0,
      transactions: 0,
      travelers: 0,
      averageTicket: 0,
      verifiedSavings: 0,
      savingsCoveragePct: 0,
      policyCompliancePct: null,
      averageAdvanceDays: 0,
      urgentTransactions: 0,
      overdueSla: 0,
      pendingApprovals: 0,
      pendingRefunds: 0,
      outstandingFinance: null,
      financeCompanyCount: 0,
    },
    monthly: [],
    services: [],
    companies: [],
    statuses: [],
    suppliers: [],
    insights: [],
    generatedAt: new Date().toISOString(),
  }
}

function emptySummary(): SummaryRow {
  return {
    transactions: '0',
    total_spend: '0',
    travelers: '0',
    verified_savings: '0',
    comparable_items: '0',
    average_advance_days: null,
    urgent_transactions: '0',
    missing_cost_center: '0',
    unmatched_employees: '0',
    overdue_sla: '0',
    overdue_sla_amount: '0',
  }
}

function emptyGovernance(): GovernanceRow {
  return {
    policy_evaluations: '0',
    policy_passed: '0',
    policy_violations: '0',
    pending_approvals: '0',
    overdue_approvals: '0',
    pending_refunds: '0',
    pending_refund_amount: '0',
    reconciliation_alerts: '0',
    critical_reconciliation_alerts: '0',
    budgets_at_risk: '0',
    budget_exposure: '0',
    outstanding_finance: '0',
  }
}

function daysInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime()
  const end = new Date(`${endDate}T00:00:00Z`).getTime()
  return Math.floor((end - start) / 86_400_000) + 1
}

function monthLabel(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, Math.max(0, month - 1), 1)))
}

function formatPct(value: number): string {
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`
}

function severityRank(value: IntelligenceSeverity): number {
  return ({ info: 0, warning: 1, high: 2, critical: 3 })[value]
}

function integer(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function numeric(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

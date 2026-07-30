import 'server-only'

import type { PoolClient, QueryResultRow } from 'pg'

import { sha256 } from '@/lib/policy'
import {
  detectarDemandasAtrasadas,
  detectarDivergenciasValor,
  detectarEmpresasSemCodigo,
  detectarFuncionariosSemCPF,
  detectarPassageirosSemFuncionario,
  detectarValoresZerados,
  detectarVendasDuplicadas,
  type AlertaInconsistencia,
} from '@/lib/reconciliacao'
import {
  reconciliationAlertIdSchema,
  reconciliationEntitySchema,
  reconciliationListQuerySchema,
  reconciliationResolutionSchema,
  reconciliationRunSchema,
  type ReconciliationAlertStatus,
  type ReconciliationCounts,
  type ReconciliationListQuery,
  type ReconciliationRunSummary,
  type RelationalReconciliationAlert,
} from '@/lib/reconciliation/schema'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type {
  Atendimento,
  Empresa,
  Funcionario,
  Prioridade,
  StatusAtendimento,
  TipoServico,
} from '@/types'

interface DemandRow extends QueryResultRow {
  id: string
  company_id: string
  employee_id: string | null
  demand_number: string
  service_type: string
  passenger_name_snapshot: string
  status: string
  priority: string
  travel_start_date: Date | string | null
  travel_end_date: Date | string | null
  estimated_amount: string | number
  final_amount: string | number
  metadata: Record<string, unknown>
  created_at: Date | string
  updated_at: Date | string
}

interface CompanyRow extends QueryResultRow {
  id: string
  group_id: string | null
  legal_name: string
  trade_name: string | null
  document_number: string | null
  customer_code: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  default_cost_center: string | null
  status: string
  created_at: Date | string
  updated_at: Date | string
}

interface EmployeeRow extends QueryResultRow {
  id: string
  company_id: string
  identification_code: string
  full_name: string
  document_number: string | null
  email: string | null
  phone: string | null
  job_title: string | null
  department: string | null
  cost_center: string | null
  registration_code: string | null
  status: string
  aliases: string[] | null
  created_at: Date | string
  updated_at: Date | string
}

interface AlertRow extends QueryResultRow {
  id: string
  company_id: string
  alert_key: string
  alert_type: RelationalReconciliationAlert['type']
  severity: RelationalReconciliationAlert['severity']
  title: string
  description: string
  entities: unknown
  suggested_action: string | null
  status: ReconciliationAlertStatus
  occurrence_count: string | number
  first_detected_at: Date | string
  last_detected_at: Date | string
  resolved_at: Date | string | null
  resolved_by: string | null
  resolved_by_name: string | null
  resolution_kind: string | null
  resolution_note: string | null
  version: string | number
  total_count?: string | number
}

interface ExistingAlertRow extends QueryResultRow {
  id: string
  status: ReconciliationAlertStatus
}

interface RunRow extends QueryResultRow {
  id: string
  started_at: Date | string
  completed_at: Date | string
}

const EMPTY_COUNTS: ReconciliationCounts = {
  critico: 0,
  alto: 0,
  medio: 0,
  baixo: 0,
  info: 0,
}

const SEVERITY_WEIGHT: Record<RelationalReconciliationAlert['severity'], number> = {
  critico: 5,
  alto: 4,
  medio: 3,
  baixo: 2,
  info: 1,
}

export class ReconciliationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ReconciliationServiceError'
  }
}

export async function listReconciliationAlerts(
  principal: RequestPrincipal,
  rawQuery: unknown,
): Promise<{
  items: RelationalReconciliationAlert[]
  total: number
  counts: ReconciliationCounts
}> {
  const query = reconciliationListQuerySchema.parse(rawQuery)
  const companyIds = await resolveCompanyScope(principal, query.companyId, 'ver_financeiro')
  if (!companyIds.length) return { items: [], total: 0, counts: { ...EMPTY_COUNTS } }

  return withTenantTransaction(principal.tenantId, async (client) => (
    listAlertsInTransaction(client, principal.tenantId, companyIds, query)
  ))
}

export async function runRelationalReconciliation(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<{
  run: ReconciliationRunSummary
  items: RelationalReconciliationAlert[]
  total: number
  counts: ReconciliationCounts
}> {
  const input = reconciliationRunSchema.parse(rawInput)
  const companyIds = await resolveCompanyScope(principal, input.companyId, 'editar_financeiro')
  if (!companyIds.length) {
    throw new ReconciliationServiceError(
      'RECONCILIATION_SCOPE_EMPTY',
      'Nenhuma empresa autorizada para executar a reconciliação.',
      403,
    )
  }

  const startedAt = new Date()
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [principal.tenantId, `reconciliation:${[...companyIds].sort().join(',')}`],
    )

    const [companiesResult, employeesResult, demandsResult] = await Promise.all([
      loadCompanies(client, principal.tenantId, companyIds),
      loadEmployees(client, principal.tenantId, companyIds),
      loadDemands(client, principal.tenantId, companyIds),
    ])
    const companies = companiesResult.rows.map(mapCompany)
    const employees = employeesResult.rows.map(mapEmployee)
    const demands = demandsResult.rows.map(mapDemand)
    const detected = deduplicateAlerts([
      ...detectarVendasDuplicadas(demands),
      ...detectarDivergenciasValor(demands),
      ...detectarPassageirosSemFuncionario(demands, employees),
      ...detectarEmpresasSemCodigo(companies, demands),
      ...detectarFuncionariosSemCPF(employees),
      ...detectarDemandasAtrasadas(demands),
      ...detectarValoresZerados(demands),
    ])

    const demandCompanies = new Map(demands.map((demand) => [demand.id, demand.empresa_id]))
    const employeeCompanies = new Map(employees.map((employee) => [employee.id, employee.company_id]))
    const detectedKeys: string[] = []

    for (const alert of detected) {
      const companyId = companyForAlert(alert, demandCompanies, employeeCompanies)
      if (!companyIds.includes(companyId)) {
        throw new ReconciliationServiceError(
          'RECONCILIATION_ALERT_SCOPE_INVALID',
          'Um alerta calculado ficou fora do escopo autorizado.',
          500,
          { alertKey: alert.id, companyId },
        )
      }
      detectedKeys.push(alert.id)
      await upsertDetectedAlert(client, principal, companyId, alert)
    }

    const autoResolved = await autoResolveMissingAlerts(
      client,
      principal,
      companyIds,
      detectedKeys,
    )
    const completedAt = new Date()
    const current = await listAlertsInTransaction(
      client,
      principal.tenantId,
      companyIds,
      reconciliationListQuerySchema.parse({ status: 'open', limit: 500 }),
    )
    const runResult = await client.query<RunRow>(
      `insert into reconciliation_runs (
         tenant_id, company_ids, scanned_demands, scanned_employees,
         detected_alerts, active_alerts, auto_resolved_alerts,
         counts_by_severity, started_at, completed_at, created_by
       ) values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       returning id, started_at, completed_at`,
      [
        principal.tenantId,
        JSON.stringify(companyIds),
        demands.length,
        employees.length,
        detected.length,
        current.total,
        autoResolved,
        JSON.stringify(current.counts),
        startedAt.toISOString(),
        completedAt.toISOString(),
        principal.user.id,
      ],
    )
    const runRow = runResult.rows[0]
    return {
      run: {
        id: runRow.id,
        scannedDemands: demands.length,
        scannedEmployees: employees.length,
        detectedAlerts: detected.length,
        activeAlerts: current.total,
        autoResolvedAlerts: autoResolved,
        counts: current.counts,
        startedAt: toIso(runRow.started_at),
        completedAt: toIso(runRow.completed_at),
      },
      ...current,
    }
  })

  await writeAuditEvent({
    action: 'finance.reconciliation.run',
    result: 'success',
    entityType: 'reconciliation_run',
    entityId: result.run.id,
    metadata: {
      companyIds,
      scannedDemands: result.run.scannedDemands,
      detectedAlerts: result.run.detectedAlerts,
      activeAlerts: result.run.activeAlerts,
      autoResolvedAlerts: result.run.autoResolvedAlerts,
    },
  })
  return result
}

export async function resolveReconciliationAlert(
  principal: RequestPrincipal,
  rawAlertId: string,
  rawInput: unknown,
): Promise<{ alert: RelationalReconciliationAlert }> {
  const alertId = reconciliationAlertIdSchema.parse(rawAlertId)
  const input = reconciliationResolutionSchema.parse(rawInput)

  const alert = await withTenantTransaction(principal.tenantId, async (client) => {
    const currentResult = await client.query<AlertRow>(
      `${alertSelect()}
       where alert.tenant_id = $1 and alert.id = $2
       for update of alert`,
      [principal.tenantId, alertId],
    )
    const current = currentResult.rows[0]
    if (!current) {
      throw new ReconciliationServiceError(
        'RECONCILIATION_ALERT_NOT_FOUND',
        'Alerta de reconciliação não encontrado.',
        404,
      )
    }
    await requireCompanyAccess(principal, current.company_id, 'editar_financeiro')
    if (input.resolutionKind === 'employee_linked') {
      await requireCompanyAccess(principal, current.company_id, 'gerenciar_funcionarios')
      await assertEmployeeLinkResolution(
        client,
        principal.tenantId,
        current,
        input.employeeId!,
      )
    }
    if (current.status !== 'open') {
      throw new ReconciliationServiceError(
        'RECONCILIATION_ALERT_ALREADY_CLOSED',
        'Este alerta já foi encerrado.',
        409,
        { status: current.status, version: Number(current.version) },
      )
    }

    const nextStatus = input.resolutionKind === 'ignored' ? 'ignored' : 'resolved'
    const updateResult = await client.query<AlertRow>(
      `update reconciliation_alerts alert set
         status = $3,
         resolved_at = now(),
         resolved_by = $4,
         resolution_kind = $5,
         resolution_note = $6,
         version = version + 1
       where tenant_id = $1
         and id = $2
         and status = 'open'
         and version = $7
       returning alert.*,
         (select name from users where id = alert.resolved_by) as resolved_by_name`,
      [
        principal.tenantId,
        alertId,
        nextStatus,
        principal.user.id,
        input.resolutionKind,
        input.note,
        input.expectedVersion,
      ],
    )
    const row = updateResult.rows[0]
    if (!row) {
      throw new ReconciliationServiceError(
        'RECONCILIATION_ALERT_VERSION_CONFLICT',
        'O alerta foi alterado por outro usuário. Atualize a página antes de continuar.',
        409,
        { currentVersion: Number(current.version) },
      )
    }
    await insertAlertEvent(
      client,
      principal.tenantId,
      alertId,
      nextStatus === 'ignored' ? 'ignored' : 'resolved',
      'open',
      nextStatus,
      input.note,
      principal.user.id,
    )
    return mapAlert(row)
  })

  await writeAuditEvent({
    action: alert.status === 'ignored'
      ? 'finance.reconciliation.alert_ignored'
      : 'finance.reconciliation.alert_resolved',
    result: 'success',
    entityType: 'reconciliation_alert',
    entityId: alert.id,
    metadata: {
      companyId: alert.companyId,
      alertType: alert.type,
      resolutionKind: alert.resolutionKind,
      version: alert.version,
    },
  })
  return { alert }
}

async function listAlertsInTransaction(
  client: PoolClient,
  tenantId: string,
  companyIds: string[],
  query: ReconciliationListQuery,
): Promise<{
  items: RelationalReconciliationAlert[]
  total: number
  counts: ReconciliationCounts
}> {
  const parameters: unknown[] = [
    tenantId,
    companyIds,
    query.status,
    query.severity || null,
    query.type || null,
  ]
  const rows = await client.query<AlertRow>(
    `${alertSelect('count(*) over()::text as total_count')}
     where alert.tenant_id = $1
       and alert.company_id = any($2::text[])
       and alert.status = $3
       and ($4::text is null or alert.severity = $4)
       and ($5::text is null or alert.alert_type = $5)
     order by
       case alert.severity
         when 'critico' then 0
         when 'alto' then 1
         when 'medio' then 2
         when 'baixo' then 3
         else 4
       end,
       alert.last_detected_at desc,
       alert.id
     limit $6 offset $7`,
    [...parameters, query.limit, query.offset],
  )
  const countRows = await client.query<{ severity: keyof ReconciliationCounts; total: string }>(
    `select severity, count(*)::text as total
     from reconciliation_alerts
     where tenant_id = $1
       and company_id = any($2::text[])
       and status = $3
       and ($4::text is null or severity = $4)
       and ($5::text is null or alert_type = $5)
     group by severity`,
    parameters,
  )
  const counts = { ...EMPTY_COUNTS }
  for (const row of countRows.rows) counts[row.severity] = Number(row.total)
  return {
    items: rows.rows.map(mapAlert),
    total: Number(rows.rows[0]?.total_count || 0),
    counts,
  }
}

function alertSelect(extraSelection?: string): string {
  return `select alert.*,
     resolver.name as resolved_by_name${extraSelection ? `,\n     ${extraSelection}` : ''}
   from reconciliation_alerts alert
   left join users resolver on resolver.id = alert.resolved_by`
}

async function assertEmployeeLinkResolution(
  client: PoolClient,
  tenantId: string,
  alert: AlertRow,
  employeeId: string,
): Promise<void> {
  if (alert.alert_type !== 'passageiro_sem_funcionario') {
    throw new ReconciliationServiceError(
      'RECONCILIATION_EMPLOYEE_LINK_NOT_APPLICABLE',
      'Este alerta não representa um vínculo pendente de funcionário.',
      409,
    )
  }
  const entities = reconciliationEntitySchema.array().safeParse(alert.entities)
  const demandIds = entities.success
    ? entities.data.filter((entity) => entity.tipo === 'Atendimento').map((entity) => entity.id)
    : []
  if (!demandIds.length) {
    throw new ReconciliationServiceError(
      'RECONCILIATION_ALERT_ENTITIES_INVALID',
      'O alerta não contém demandas válidas para confirmar o vínculo.',
      409,
    )
  }
  const employee = await client.query<{ id: string }>(
    `select id
     from employees
     where tenant_id = $1
       and id = $2
       and company_id = $3
       and status = 'active'
       and deleted_at is null`,
    [tenantId, employeeId, alert.company_id],
  )
  if (!employee.rows[0]) {
    throw new ReconciliationServiceError(
      'RECONCILIATION_EMPLOYEE_INVALID',
      'O funcionário vinculado não está ativo ou não pertence à empresa do alerta.',
      409,
    )
  }
  const linked = await client.query<{ total: string }>(
    `select count(*)::text as total
     from demands
     where tenant_id = $1
       and id = any($2::text[])
       and company_id = $3
       and employee_id = $4
       and deleted_at is null`,
    [tenantId, demandIds, alert.company_id, employeeId],
  )
  if (Number(linked.rows[0]?.total || 0) !== demandIds.length) {
    throw new ReconciliationServiceError(
      'RECONCILIATION_EMPLOYEE_LINK_UNCONFIRMED',
      'O vínculo ainda não está confirmado em todas as demandas do alerta.',
      409,
    )
  }
}

async function upsertDetectedAlert(
  client: PoolClient,
  principal: RequestPrincipal,
  companyId: string,
  alert: AlertaInconsistencia,
): Promise<void> {
  const existingResult = await client.query<ExistingAlertRow>(
    `select id, status
     from reconciliation_alerts
     where tenant_id = $1 and alert_key = $2
     for update`,
    [principal.tenantId, alert.id],
  )
  const existing = existingResult.rows[0]
  const fingerprint = sha256({
    companyId,
    type: alert.tipo,
    severity: alert.severidade,
    title: alert.titulo,
    description: alert.descricao,
    entities: alert.entidades,
  })

  if (!existing) {
    const inserted = await client.query<{ id: string }>(
      `insert into reconciliation_alerts (
         tenant_id, company_id, alert_key, alert_type, severity, title,
         description, entities, suggested_action, detection_fingerprint
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       returning id`,
      [
        principal.tenantId,
        companyId,
        alert.id,
        alert.tipo,
        alert.severidade,
        alert.titulo,
        alert.descricao,
        JSON.stringify(alert.entidades),
        alert.sugestao_acao || null,
        fingerprint,
      ],
    )
    await insertAlertEvent(
      client,
      principal.tenantId,
      inserted.rows[0].id,
      'detected',
      null,
      'open',
      null,
      principal.user.id,
    )
    return
  }

  const reopening = existing.status === 'auto_resolved'
  await client.query(
    `update reconciliation_alerts set
       company_id = $3,
       alert_type = $4,
       severity = $5,
       title = $6,
       description = $7,
       entities = $8::jsonb,
       suggested_action = $9,
       detection_fingerprint = $10,
       status = case when status = 'auto_resolved' then 'open' else status end,
       occurrence_count = occurrence_count + 1,
       last_detected_at = now(),
       resolved_at = case when status = 'auto_resolved' then null else resolved_at end,
       resolved_by = case when status = 'auto_resolved' then null else resolved_by end,
       resolution_kind = case when status = 'auto_resolved' then null else resolution_kind end,
       resolution_note = case when status = 'auto_resolved' then null else resolution_note end,
       version = version + 1
     where tenant_id = $1 and id = $2`,
    [
      principal.tenantId,
      existing.id,
      companyId,
      alert.tipo,
      alert.severidade,
      alert.titulo,
      alert.descricao,
      JSON.stringify(alert.entidades),
      alert.sugestao_acao || null,
      fingerprint,
    ],
  )
  if (reopening) {
    await insertAlertEvent(
      client,
      principal.tenantId,
      existing.id,
      'reopened',
      'auto_resolved',
      'open',
      'Inconsistência detectada novamente.',
      principal.user.id,
    )
  }
}

async function autoResolveMissingAlerts(
  client: PoolClient,
  principal: RequestPrincipal,
  companyIds: string[],
  detectedKeys: string[],
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `update reconciliation_alerts set
       status = 'auto_resolved',
       resolved_at = now(),
       resolved_by = $3,
       resolution_kind = 'no_longer_detected',
       resolution_note = 'A inconsistência não foi encontrada na execução mais recente.',
       version = version + 1
     where tenant_id = $1
       and company_id = any($2::text[])
       and status = 'open'
       and not (alert_key = any($4::text[]))
     returning id`,
    [principal.tenantId, companyIds, principal.user.id, detectedKeys],
  )
  for (const row of result.rows) {
    await insertAlertEvent(
      client,
      principal.tenantId,
      row.id,
      'auto_resolved',
      'open',
      'auto_resolved',
      'A inconsistência não foi encontrada na execução mais recente.',
      principal.user.id,
    )
  }
  return result.rowCount || 0
}

async function insertAlertEvent(
  client: PoolClient,
  tenantId: string,
  alertId: string,
  action: 'detected' | 'reopened' | 'resolved' | 'ignored' | 'auto_resolved',
  fromStatus: ReconciliationAlertStatus | null,
  toStatus: ReconciliationAlertStatus,
  note: string | null,
  actorUserId: string,
): Promise<void> {
  await client.query(
    `insert into reconciliation_alert_events (
       tenant_id, alert_id, action, from_status, to_status, note, actor_user_id
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, alertId, action, fromStatus, toStatus, note, actorUserId],
  )
}

async function resolveCompanyScope(
  principal: RequestPrincipal,
  companyId: string | undefined,
  permission: 'ver_financeiro' | 'editar_financeiro',
): Promise<string[]> {
  if (companyId) {
    await requireCompanyAccess(principal, companyId, permission)
    return [companyId]
  }
  return principal.corporateAccess?.companies
    .filter((company) => company.permissions[permission])
    .map((company) => company.companyId) || []
}

function loadCompanies(client: PoolClient, tenantId: string, companyIds: string[]) {
  return client.query<CompanyRow>(
    `select id, group_id, legal_name, trade_name, document_number,
            customer_code, contact_name, contact_email::text,
            contact_phone, default_cost_center, status, created_at, updated_at
     from companies
     where tenant_id = $1
       and id = any($2::text[])
       and deleted_at is null
     order by id`,
    [tenantId, companyIds],
  )
}

function loadEmployees(client: PoolClient, tenantId: string, companyIds: string[]) {
  return client.query<EmployeeRow>(
    `select employee.id, employee.company_id, employee.identification_code,
            employee.full_name, employee.document_number, employee.email::text,
            employee.phone, employee.job_title, employee.department,
            employee.cost_center, employee.registration_code, employee.status,
            employee.created_at, employee.updated_at,
            coalesce(
              array_agg(alias.original_alias order by alias.created_at)
                filter (where alias.id is not null),
              '{}'::text[]
            ) as aliases
     from employees employee
     left join employee_aliases alias
       on alias.tenant_id = employee.tenant_id and alias.employee_id = employee.id
     where employee.tenant_id = $1
       and employee.company_id = any($2::text[])
       and employee.deleted_at is null
     group by employee.id
     order by employee.id`,
    [tenantId, companyIds],
  )
}

function loadDemands(client: PoolClient, tenantId: string, companyIds: string[]) {
  return client.query<DemandRow>(
    `select id, company_id, employee_id, demand_number, service_type,
            passenger_name_snapshot, status, priority, travel_start_date,
            travel_end_date, estimated_amount, final_amount, metadata,
            created_at, updated_at
     from demands
     where tenant_id = $1
       and company_id = any($2::text[])
       and deleted_at is null
     order by id`,
    [tenantId, companyIds],
  )
}

function mapCompany(row: CompanyRow): Empresa {
  return {
    id: row.id,
    nome: row.trade_name || row.legal_name,
    cnpj: row.document_number || '',
    grupo_id: row.group_id,
    codigo_cliente: row.customer_code || undefined,
    endereco: '',
    responsavel: row.contact_name || '',
    email_responsavel: row.contact_email || '',
    telefone: row.contact_phone || '',
    centro_custo_padrao: row.default_cost_center || '',
    ativa: row.status === 'active',
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  }
}

function mapEmployee(row: EmployeeRow): Funcionario {
  const document = digits(row.document_number)
  return {
    id: row.id,
    codigo_identificacao: row.identification_code,
    company_id: row.company_id,
    nome: row.full_name,
    cpf: document.length === 11 ? document : '',
    data_nascimento: '',
    telefone: row.phone || '',
    email: row.email || '',
    passaporte: '',
    passaporte_validade: '',
    milhagem: '',
    preferencias: '',
    cargo: employeeRole(row.job_title),
    cargo_original: row.job_title || undefined,
    centro_custo: row.cost_center || '',
    matricula: row.registration_code || undefined,
    lotacao: row.department || undefined,
    aliases_nome: row.aliases || [],
    ativo: row.status === 'active',
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  }
}

function mapDemand(row: DemandRow): Atendimento {
  const legacy = recordValue(recordValue(row.metadata).legacySnapshot)
  const startDate = dateOnly(row.travel_start_date)
  const endDate = dateOnly(row.travel_end_date)
  const serviceType = normalizeServiceType(row.service_type)
  const fallbackDetails = serviceType === 'Hotel'
    ? { detalhes_hotel: { data_checkin: startDate || undefined, data_checkout: endDate || undefined } }
    : serviceType === 'Aéreo'
      ? { detalhes_aereo: { data_ida: startDate || undefined, data_volta: endDate || undefined } }
      : {}
  return {
    ...fallbackDetails,
    ...legacy,
    id: row.id,
    serial_os: row.demand_number,
    empresa_id: row.company_id,
    funcionario_id: row.employee_id,
    passageiro_nome: row.passenger_name_snapshot,
    tipo_servico: serviceType,
    valor_cotacao: numeric(row.estimated_amount),
    valor_final: numeric(row.final_amount),
    agente_user_id: '',
    status: normalizeStatus(row.status),
    prioridade: normalizePriority(row.priority),
    observacoes: '',
    data_atendimento: dateOnly(row.created_at) || '',
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  } as Atendimento
}

function deduplicateAlerts(alerts: AlertaInconsistencia[]): AlertaInconsistencia[] {
  const unique = new Map<string, AlertaInconsistencia>()
  for (const alert of alerts) {
    const current = unique.get(alert.id)
    if (!current || SEVERITY_WEIGHT[alert.severidade] > SEVERITY_WEIGHT[current.severidade]) {
      unique.set(alert.id, alert)
    }
  }
  return [...unique.values()]
}

function companyForAlert(
  alert: AlertaInconsistencia,
  demandCompanies: Map<string, string>,
  employeeCompanies: Map<string, string>,
): string {
  const candidates = new Set<string>()
  for (const entity of alert.entidades) {
    if (entity.tipo === 'Empresa') candidates.add(entity.id)
    if (entity.tipo === 'Atendimento') {
      const companyId = demandCompanies.get(entity.id)
      if (companyId) candidates.add(companyId)
    }
    if (entity.tipo === 'Funcionario') {
      const companyId = employeeCompanies.get(entity.id)
      if (companyId) candidates.add(companyId)
    }
  }
  if (candidates.size !== 1) {
    throw new ReconciliationServiceError(
      'RECONCILIATION_ALERT_COMPANY_AMBIGUOUS',
      'Não foi possível determinar uma única empresa para o alerta.',
      500,
      { alertKey: alert.id, companyIds: [...candidates] },
    )
  }
  return [...candidates][0]
}

function mapAlert(row: AlertRow): RelationalReconciliationAlert {
  const entities = reconciliationEntitySchema.array().safeParse(row.entities)
  return {
    id: row.id,
    companyId: row.company_id,
    alertKey: row.alert_key,
    type: row.alert_type,
    severity: row.severity,
    title: row.title,
    description: row.description,
    entities: entities.success ? entities.data : [],
    suggestedAction: row.suggested_action,
    status: row.status,
    occurrenceCount: Number(row.occurrence_count),
    firstDetectedAt: toIso(row.first_detected_at),
    lastDetectedAt: toIso(row.last_detected_at),
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
    resolvedBy: row.resolved_by_name || row.resolved_by,
    resolutionKind: row.resolution_kind,
    resolutionNote: row.resolution_note,
    version: Number(row.version),
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeServiceType(value: string): TipoServico {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (normalized.includes('hotel') || normalized.includes('hosped')) return 'Hotel'
  if (normalized.includes('aereo') || normalized.includes('flight') || normalized.includes('air')) return 'Aéreo'
  if (normalized.includes('carro') || normalized.includes('loca')) return 'Carro'
  if (normalized.includes('pacote')) return 'Pacote'
  return 'Outro'
}

function normalizeStatus(value: string): StatusAtendimento {
  const normalized = value.toLowerCase()
  if (['finalizado', 'completed', 'finished'].includes(normalized)) return 'finalizado'
  if (['cancelado', 'cancelled', 'canceled'].includes(normalized)) return 'cancelado'
  if (['aguardando_cliente', 'waiting_customer'].includes(normalized)) return 'aguardando_cliente'
  if (['pendente', 'pending', 'draft'].includes(normalized)) return 'pendente'
  return 'em_andamento'
}

function normalizePriority(value: string): Prioridade {
  const normalized = value.toLowerCase()
  if (['urgent', 'urgente'].includes(normalized)) return 'urgente'
  if (['high', 'alta'].includes(normalized)) return 'alta'
  if (['low', 'baixa'].includes(normalized)) return 'baixa'
  return 'media'
}

function employeeRole(value: string | null): Funcionario['cargo'] {
  const normalized = (value || '').toLowerCase()
  if (normalized.includes('diretor') || normalized.includes('ceo') || normalized.includes('presidente')) return 'Diretor'
  if (normalized.includes('gerent') || normalized.includes('gestor') || normalized.includes('coorden')) return 'Gerente'
  return 'Colaborador'
}

function numeric(value: unknown): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function digits(value: string | null): string {
  return (value || '').replace(/\D/g, '')
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

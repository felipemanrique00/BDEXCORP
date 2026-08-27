import 'server-only'

import type { PoolClient } from 'pg'

import type {
  DemandTransferRequest,
  DemandTransferStatus,
} from '@/lib/demand-transfer'
import {
  getEffectiveCompanyAccess,
  requireCompanyAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { writeAuditEvent } from '@/lib/server/audit-log'
import type { RequestPrincipal } from '@/lib/server/request-context'

const LegacyStorageKey = 'bbt-transferencias'
const LegacyMigrationLimit = 1_000

interface DemandTransferRow {
  id: string
  demand_id: string
  company_id: string
  company_name: string
  passenger_name: string
  source_user_id: string
  source_user_name: string
  destination_user_id: string
  destination_user_name: string
  reason: string
  status: DemandTransferStatus
  requested_demand_version: string | number
  response_reason: string | null
  requested_at: Date | string
  responded_at: Date | string | null
  expires_at: Date | string
}

interface LockedTransferRow extends DemandTransferRow {
  demand_version: string | number
  assigned_to_user_id: string | null
}

export class DemandTransferError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DemandTransferError'
  }
}

export async function listDemandTransfersForCurrentUser(
  principal: RequestPrincipal,
): Promise<DemandTransferRequest[]> {
  const allowedCompanyIds = companiesForPermission(principal, 'ver_demandas')
  if (!allowedCompanyIds.length) return []

  return withTenantTransaction(principal.tenantId, async (client) => {
    await bootstrapLegacyTransfers(client, principal)
    await client.query(
      `update demand_transfer_requests
       set status = 'expired', responded_at = now(),
           response_reason = 'Prazo da solicitacao expirado.'
       where tenant_id = $1
         and status = 'pending'
         and expires_at <= now()`,
      [principal.tenantId],
    )
    const result = await client.query<DemandTransferRow>(
      `${transferSelect()}
       where transfer.tenant_id = $1
         and transfer.company_id = any($2::text[])
         and (
           transfer.destination_user_id = $3
           or transfer.source_user_id = $3
         )
       order by
         case when transfer.status = 'pending' then 0 else 1 end,
         transfer.requested_at desc
       limit 200`,
      [principal.tenantId, allowedCompanyIds, principal.user.id],
    )
    return result.rows.map(mapTransfer)
  })
}

export async function createDemandTransferRequest(
  principal: RequestPrincipal,
  input: {
    demandId: string
    destinationUserId: string
    reason: string
    expectedDemandVersion: number
  },
): Promise<DemandTransferRequest> {
  const reason = normalizeReason(input.reason)
  assertUuid(input.destinationUserId, 'DESTINATION_USER_INVALID')
  if (input.destinationUserId === principal.user.id) {
    throw new DemandTransferError(
      'DEMAND_TRANSFER_SAME_USER',
      'A demanda ja esta atribuida ao usuario selecionado.',
      409,
    )
  }

  const targetAccess = await getEffectiveCompanyAccess(input.destinationUserId, principal.tenantId)
  const transfer = await withTenantTransaction(principal.tenantId, async (client) => {
    const demand = await client.query<{
      id: string
      company_id: string
      assigned_to_user_id: string | null
      version: string | number
    }>(
      `select demand.id, demand.company_id, demand.assigned_to_user_id, demand.version
       from demands demand
       where demand.tenant_id = $1 and demand.id = $2 and demand.deleted_at is null
         and (demand.travel_order_id is null or exists (
           select 1 from company_portal_travel_orders visible_order
           where visible_order.tenant_id = demand.tenant_id
             and visible_order.id = demand.travel_order_id
             and visible_order.status = 'submitted'
         ))
       for update`,
      [principal.tenantId, normalizeDemandId(input.demandId)],
    )
    const current = demand.rows[0]
    if (!current) {
      throw new DemandTransferError('DEMAND_NOT_FOUND', 'Demanda nao encontrada.', 404)
    }
    await requireCompanyAccess(principal, current.company_id, 'criar_demandas')
    const canRequestForOthers = Boolean(
      principal.user.permissoes?.ver_produtividade_todos
      || principal.user.permissoes?.gerenciar_usuarios,
    )
    if (current.assigned_to_user_id !== principal.user.id && !canRequestForOthers) {
      throw new DemandTransferError(
        'DEMAND_TRANSFER_SOURCE_DENIED',
        'Somente o responsavel atual ou um supervisor pode solicitar o repasse.',
        403,
      )
    }
    if (Number(current.version) !== input.expectedDemandVersion) {
      throw new DemandTransferError(
        'DEMAND_TRANSFER_STALE_VERSION',
        'A demanda mudou desde que a tela foi carregada. Atualize e tente novamente.',
        409,
        { expectedVersion: input.expectedDemandVersion, currentVersion: Number(current.version) },
      )
    }
    const targetCompany = targetAccess.companies.find((company) => company.companyId === current.company_id)
    if (!targetCompany?.permissions.criar_demandas) {
      throw new DemandTransferError(
        'DEMAND_TRANSFER_DESTINATION_DENIED',
        'O destinatario nao possui acesso operacional a empresa desta demanda.',
        422,
      )
    }
    const activeTarget = await client.query<{ active: boolean }>(
      `select true as active
       from tenant_memberships membership
       join users target on target.id = membership.user_id
       where membership.tenant_id = $1
         and membership.user_id = $2
         and membership.status = 'active'
         and target.status = 'active'
         and target.deleted_at is null`,
      [principal.tenantId, input.destinationUserId],
    )
    if (!activeTarget.rows[0]) {
      throw new DemandTransferError(
        'DEMAND_TRANSFER_DESTINATION_INACTIVE',
        'O destinatario nao possui vinculo ativo neste tenant.',
        422,
      )
    }

    try {
      const result = await client.query<{ id: string }>(
        `insert into demand_transfer_requests (
           tenant_id, demand_id, company_id, source_user_id,
           destination_user_id, reason, requested_demand_version
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          principal.tenantId,
          current.id,
          current.company_id,
          principal.user.id,
          input.destinationUserId,
          reason,
          Number(current.version),
        ],
      )
      const createdId = result.rows[0]?.id
      if (!createdId) {
        throw new DemandTransferError(
          'DEMAND_TRANSFER_CREATE_FAILED',
          'Nao foi possivel criar a solicitacao de repasse.',
          500,
        )
      }
      return loadTransferById(client, principal.tenantId, createdId)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DemandTransferError(
          'DEMAND_TRANSFER_ALREADY_PENDING',
          'Ja existe uma solicitacao pendente para esse destinatario.',
          409,
        )
      }
      throw error
    }
  })

  await writeAuditEvent({
    action: 'travel.demand.transfer.request',
    result: 'success',
    entityType: 'demand_transfer_request',
    entityId: transfer.id,
    metadata: {
      demandId: transfer.demandId,
      companyId: transfer.companyId,
      destinationUserId: transfer.destinationUserId,
    },
  })
  return transfer
}

export async function decideDemandTransferRequest(
  principal: RequestPrincipal,
  transferId: string,
  input: { action: 'accept' | 'reject' | 'cancel'; reason?: string },
): Promise<DemandTransferRequest> {
  assertUuid(transferId, 'DEMAND_TRANSFER_ID_INVALID')
  const responseReason = input.action === 'reject'
    ? normalizeReason(input.reason || '')
    : input.reason?.trim().slice(0, 2000) || null

  const transfer = await withTenantTransaction(principal.tenantId, async (client) => {
    const current = await loadLockedTransfer(client, principal.tenantId, transferId)
    if (current.status !== 'pending') {
      throw new DemandTransferError(
        'DEMAND_TRANSFER_ALREADY_DECIDED',
        'Essa solicitacao ja foi respondida.',
        409,
      )
    }
    if (new Date(current.expires_at).getTime() <= Date.now()) {
      await client.query(
        `update demand_transfer_requests
         set status = 'expired', responded_at = now(),
             response_reason = 'Prazo da solicitacao expirado.'
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, transferId],
      )
      throw new DemandTransferError(
        'DEMAND_TRANSFER_EXPIRED',
        'Essa solicitacao expirou.',
        409,
      )
    }

    if (input.action === 'cancel') {
      if (current.source_user_id !== principal.user.id) {
        throw new DemandTransferError(
          'DEMAND_TRANSFER_CANCEL_DENIED',
          'Somente quem solicitou pode cancelar o repasse.',
          403,
        )
      }
      await updateTransferDecision(client, principal.tenantId, transferId, 'cancelled', responseReason)
      return loadTransferById(client, principal.tenantId, transferId)
    }

    if (current.destination_user_id !== principal.user.id) {
      throw new DemandTransferError(
        'DEMAND_TRANSFER_DECISION_DENIED',
        'Somente o destinatario pode responder ao repasse.',
        403,
      )
    }
    await requireCompanyAccess(principal, current.company_id, 'criar_demandas')

    if (input.action === 'reject') {
      await updateTransferDecision(client, principal.tenantId, transferId, 'rejected', responseReason)
      return loadTransferById(client, principal.tenantId, transferId)
    }

    if (
      Number(current.demand_version) !== Number(current.requested_demand_version)
      || current.assigned_to_user_id !== current.source_user_id
    ) {
      throw new DemandTransferError(
        'DEMAND_TRANSFER_DEMAND_CHANGED',
        'A demanda mudou depois da solicitacao. Um novo repasse precisa ser solicitado.',
        409,
      )
    }

    const updated = await client.query(
      `update demands
       set assigned_to_user_id = $4,
           metadata = metadata || $5::jsonb,
           version = version + 1,
           updated_by = $4,
           updated_at = now()
       where tenant_id = $1 and id = $2 and version = $3 and deleted_at is null`,
      [
        principal.tenantId,
        current.demand_id,
        Number(current.demand_version),
        principal.user.id,
        JSON.stringify({
          lastTransferRequestId: transferId,
          lastTransferAcceptedAt: new Date().toISOString(),
        }),
      ],
    )
    if ((updated.rowCount || 0) !== 1) {
      throw new DemandTransferError(
        'DEMAND_TRANSFER_CONCURRENT_UPDATE',
        'A demanda foi alterada por outra operacao.',
        409,
      )
    }
    await client.query(
      `insert into demand_events (
         tenant_id, demand_id, actor_user_id, event_type, data
       ) values ($1, $2, $3, 'transfer_request_accepted', $4::jsonb)`,
      [
        principal.tenantId,
        current.demand_id,
        principal.user.id,
        JSON.stringify({
          transferRequestId: transferId,
          fromAssigneeUserId: current.source_user_id,
          toAssigneeUserId: current.destination_user_id,
          reason: current.reason,
          resultingVersion: Number(current.demand_version) + 1,
        }),
      ],
    )
    await updateTransferDecision(client, principal.tenantId, transferId, 'accepted', responseReason)
    return loadTransferById(client, principal.tenantId, transferId)
  })

  await writeAuditEvent({
    action: `travel.demand.transfer.${input.action}`,
    result: 'success',
    entityType: 'demand_transfer_request',
    entityId: transfer.id,
    metadata: {
      demandId: transfer.demandId,
      companyId: transfer.companyId,
      sourceUserId: transfer.sourceUserId,
      destinationUserId: transfer.destinationUserId,
    },
  })
  return transfer
}

async function loadLockedTransfer(
  client: PoolClient,
  tenantId: string,
  transferId: string,
): Promise<LockedTransferRow> {
  const result = await client.query<LockedTransferRow>(
    `${transferSelect(`
            , demand.version as demand_version
            , demand.assigned_to_user_id
          `)}
     where transfer.tenant_id = $1 and transfer.id = $2
     for update of transfer, demand`,
    [tenantId, transferId],
  )
  if (!result.rows[0]) {
    throw new DemandTransferError(
      'DEMAND_TRANSFER_NOT_FOUND',
      'Solicitacao de repasse nao encontrada.',
      404,
    )
  }
  return result.rows[0]
}

async function loadTransferById(
  client: PoolClient,
  tenantId: string,
  transferId: string,
): Promise<DemandTransferRequest> {
  const result = await client.query<DemandTransferRow>(
    `${transferSelect()}
     where transfer.tenant_id = $1 and transfer.id = $2`,
    [tenantId, transferId],
  )
  if (!result.rows[0]) {
    throw new DemandTransferError(
      'DEMAND_TRANSFER_NOT_FOUND',
      'Solicitacao de repasse nao encontrada.',
      404,
    )
  }
  return mapTransfer(result.rows[0])
}

function transferSelect(additionalColumns = ''): string {
  return `select transfer.id, transfer.demand_id, transfer.company_id,
                 coalesce(company.trade_name, company.legal_name) as company_name,
                 demand.passenger_name_snapshot as passenger_name,
                 transfer.source_user_id, source_user.name as source_user_name,
                 transfer.destination_user_id, destination_user.name as destination_user_name,
                 transfer.reason, transfer.status, transfer.requested_demand_version,
                 transfer.response_reason, transfer.requested_at,
                 transfer.responded_at, transfer.expires_at
                 ${additionalColumns}
          from demand_transfer_requests transfer
          join demands demand
            on demand.tenant_id = transfer.tenant_id
           and demand.id = transfer.demand_id
          join companies company
            on company.tenant_id = transfer.tenant_id
           and company.id = transfer.company_id
          join users source_user on source_user.id = transfer.source_user_id
          join users destination_user on destination_user.id = transfer.destination_user_id`
}

async function updateTransferDecision(
  client: PoolClient,
  tenantId: string,
  transferId: string,
  status: Exclude<DemandTransferStatus, 'pending' | 'expired'>,
  responseReason: string | null,
): Promise<void> {
  const result = await client.query(
    `update demand_transfer_requests
     set status = $3, response_reason = $4, responded_at = now()
     where tenant_id = $1 and id = $2 and status = 'pending'`,
    [tenantId, transferId, status, responseReason],
  )
  if ((result.rowCount || 0) !== 1) {
    throw new DemandTransferError(
      'DEMAND_TRANSFER_CONCURRENT_DECISION',
      'A solicitacao foi respondida por outra operacao.',
      409,
    )
  }
}

async function bootstrapLegacyTransfers(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<void> {
  const source = await client.query<{ value: unknown }>(
    'select value from app_kv where tenant_id = $1 and key = $2',
    [principal.tenantId, LegacyStorageKey],
  )
  if (!Array.isArray(source.rows[0]?.value)) return

  for (const raw of source.rows[0].value.slice(-LegacyMigrationLimit)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    const legacyId = text(item.id, 200)
    const demandId = text(item.atendimento_id, 200)
    const sourceUserId = text(item.origem_user_id, 80)
    const destinationUserId = text(item.destino_user_id, 80)
    const reason = text(item.motivo, 2000)
    if (
      !legacyId
      || !demandId
      || !isUuid(sourceUserId)
      || !isUuid(destinationUserId)
      || reason.length < 5
    ) continue
    const status = legacyStatus(item.status)
    const requestedAt = validDate(item.solicitada_em) || new Date().toISOString()
    const respondedAt = status === 'pending'
      ? null
      : validDate(item.respondida_em) || requestedAt
    await client.query(
      `insert into demand_transfer_requests (
         tenant_id, demand_id, company_id, source_user_id, destination_user_id,
         reason, status, requested_demand_version, response_reason,
         legacy_source_id, requested_at, responded_at, expires_at
       )
       select $1, demand.id, demand.company_id, $3::uuid, $4::uuid,
              $5, $6, demand.version, $7, $8, $9::timestamptz,
              $10::timestamptz, greatest($9::timestamptz + interval '7 days', now())
       from demands demand
       where demand.tenant_id = $1
         and demand.id = $2
         and exists (
           select 1 from tenant_memberships membership
           where membership.tenant_id = $1
             and membership.user_id = $3::uuid
         )
         and exists (
           select 1 from tenant_memberships membership
           where membership.tenant_id = $1
             and membership.user_id = $4::uuid
         )
       on conflict do nothing`,
      [
        principal.tenantId,
        demandId,
        sourceUserId,
        destinationUserId,
        reason,
        status,
        text(item.motivo_recusa, 2000) || null,
        legacyId,
        requestedAt,
        respondedAt,
      ],
    )
  }
}

function companiesForPermission(
  principal: RequestPrincipal,
  permission: 'ver_demandas' | 'criar_demandas',
): string[] {
  return principal.corporateAccess?.companies
    .filter((company) => company.permissions[permission])
    .map((company) => company.companyId) || []
}

function mapTransfer(row: DemandTransferRow): DemandTransferRequest {
  return {
    id: row.id,
    demandId: row.demand_id,
    companyId: row.company_id,
    companyName: row.company_name,
    passengerName: row.passenger_name,
    sourceUserId: row.source_user_id,
    sourceUserName: row.source_user_name,
    destinationUserId: row.destination_user_id,
    destinationUserName: row.destination_user_name,
    reason: row.reason,
    status: row.status,
    requestedDemandVersion: Number(row.requested_demand_version),
    responseReason: row.response_reason,
    requestedAt: new Date(row.requested_at).toISOString(),
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null,
    expiresAt: new Date(row.expires_at).toISOString(),
  }
}

function normalizeDemandId(value: string): string {
  const id = text(value, 200)
  if (!id) throw new DemandTransferError('DEMAND_ID_INVALID', 'Demanda invalida.', 400)
  return id
}

function normalizeReason(value: string): string {
  const reason = text(value, 2000)
  if (reason.length < 5) {
    throw new DemandTransferError(
      'DEMAND_TRANSFER_REASON_REQUIRED',
      'Informe um motivo com pelo menos cinco caracteres.',
      400,
    )
  }
  return reason
}

function assertUuid(value: string, code: string): void {
  if (!isUuid(value)) {
    throw new DemandTransferError(code, 'Identificador invalido.', 400)
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && !Array.isArray(error)
    && (error as { code?: unknown }).code === '23505',
  )
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function legacyStatus(value: unknown): DemandTransferStatus {
  if (value === 'aceita') return 'accepted'
  if (value === 'recusada') return 'rejected'
  if (value === 'cancelada') return 'cancelled'
  return 'pending'
}

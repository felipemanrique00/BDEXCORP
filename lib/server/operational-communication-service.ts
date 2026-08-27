import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import {
  EMPTY_CRM_SUMMARY,
  type CrmSummary,
  type OperationalCommunicationOverview,
  type TravelDeskNote,
} from '@/lib/operational-communications'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  requireCompanyAccess,
  requireCompanySelectionAccess,
  requireGroupAccess,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const LegacyMessagesKey = 'bbt-mensagens-thread'
const LegacyTravelDeskKey = 'bbt-travel-desk-v11'
const LegacyLimit = 1_000

interface CrmDemandRow {
  demand_id: string
  demand_created_at: Date | string
  demand_updated_at: Date | string
  demand_status: string
  message_type: 'received' | 'sent' | 'system_event' | 'internal_note' | null
  message_created_at: Date | string | null
}

interface TravelDeskNoteRow {
  id: string
  company_id: string | null
  company_name: string | null
  demand_id: string | null
  demand_number: string | null
  created_by_user_id: string
  created_by_name: string
  note: string
  status: TravelDeskNote['status']
  created_at: Date | string
  updated_at: Date | string
}

export class OperationalCommunicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'OperationalCommunicationError'
  }
}

export async function getOperationalCommunicationOverview(
  principal: RequestPrincipal,
  filters: {
    startDate: string
    endDate: string
    companyId?: string
    companyIds?: string[]
    groupId?: string
    serviceType?: string
  },
): Promise<OperationalCommunicationOverview> {
  const companyIds = await resolveCompanyScope(
    principal,
    filters.companyId,
    filters.companyIds,
    filters.groupId,
    'ver_demandas',
  )
  if (!companyIds.length) return { crm: EMPTY_CRM_SUMMARY, notes: [] }

  return withTenantTransaction(principal.tenantId, async (client) => {
    await bootstrapLegacyCommunications(client, principal)
    const crmRows = await client.query<CrmDemandRow>(
        `select demand.id as demand_id,
                demand.created_at as demand_created_at,
                demand.updated_at as demand_updated_at,
                demand.status as demand_status,
                message.message_type,
                message.created_at as message_created_at
         from demands demand
         left join demand_messages message
           on message.tenant_id = demand.tenant_id
          and message.demand_id = demand.id
         where demand.tenant_id = $1
           and demand.company_id = any($2::text[])
           and demand.deleted_at is null
           and (demand.travel_order_id is null or exists (
             select 1 from company_portal_travel_orders visible_order
             where visible_order.tenant_id = demand.tenant_id
               and visible_order.id = demand.travel_order_id
               and visible_order.status = 'submitted'
           ))
           and demand.created_at >= $3::date
           and demand.created_at < ($4::date + interval '1 day')
           and ($5::text is null or demand.service_type = $5)
         order by demand.id, message.created_at, message.id
         limit 20000`,
        [
          principal.tenantId,
          companyIds,
          filters.startDate,
          filters.endDate,
          filters.serviceType || null,
        ],
      )
    const noteRows = await client.query<TravelDeskNoteRow>(
        `${travelDeskNoteSelect()}
         where note.tenant_id = $1
           and (
             note.company_id = any($2::text[])
             or note.created_by_user_id = $3
           )
         order by note.created_at desc
         limit 30`,
        [principal.tenantId, companyIds, principal.user.id],
      )
    return {
      crm: calculateCrmSummary(crmRows.rows),
      notes: noteRows.rows.map(mapTravelDeskNote),
    }
  })
}

export async function createTravelDeskNote(
  principal: RequestPrincipal,
  input: { note: string; companyId?: string; demandId?: string },
): Promise<TravelDeskNote> {
  const noteText = input.note.trim()
  if (!noteText || noteText.length > 4_000) {
    throw new OperationalCommunicationError(
      'TRAVEL_DESK_NOTE_INVALID',
      'A nota deve conter entre 1 e 4000 caracteres.',
      400,
    )
  }

  const created = await withTenantTransaction(principal.tenantId, async (client) => {
    let companyId = input.companyId || null
    let demandId = input.demandId || null
    if (demandId) {
      const demand = await client.query<{ company_id: string }>(
        `select demand.company_id
         from demands demand
         where demand.tenant_id = $1 and demand.id = $2 and demand.deleted_at is null
           and (demand.travel_order_id is null or exists (
             select 1 from company_portal_travel_orders visible_order
             where visible_order.tenant_id = demand.tenant_id
               and visible_order.id = demand.travel_order_id
               and visible_order.status = 'submitted'
           ))`,
        [principal.tenantId, demandId],
      )
      if (!demand.rows[0]) {
        throw new OperationalCommunicationError(
          'TRAVEL_DESK_DEMAND_NOT_FOUND',
          'Demanda nao encontrada.',
          404,
        )
      }
      if (companyId && companyId !== demand.rows[0].company_id) {
        throw new OperationalCommunicationError(
          'TRAVEL_DESK_COMPANY_MISMATCH',
          'A demanda nao pertence a empresa informada.',
          422,
        )
      }
      companyId = demand.rows[0].company_id
    }
    if (companyId) await requireCompanyAccess(principal, companyId, 'criar_demandas')

    const id = `desk-${randomUUID()}`
    const result = await client.query<TravelDeskNoteRow>(
      `insert into travel_desk_notes (
         id, tenant_id, company_id, demand_id, created_by_user_id, note
       ) values ($1, $2, $3, $4, $5, $6)
       returning id, company_id, null::text as company_name, demand_id,
                 null::text as demand_number, created_by_user_id,
                 $7::text as created_by_name, note, status, created_at, updated_at`,
      [
        id,
        principal.tenantId,
        companyId,
        demandId,
        principal.user.id,
        noteText,
        principal.user.name,
      ],
    )
    if (!result.rows[0]) {
      throw new OperationalCommunicationError(
        'TRAVEL_DESK_NOTE_CREATE_FAILED',
        'Nao foi possivel salvar a nota.',
        500,
      )
    }
    return mapTravelDeskNote(result.rows[0])
  })

  await writeAuditEvent({
    action: 'travel_desk.note.create',
    result: 'success',
    entityType: 'travel_desk_note',
    entityId: created.id,
    metadata: {
      companyId: created.companyId,
      demandId: created.demandId,
    },
  })
  return created
}

async function resolveCompanyScope(
  principal: RequestPrincipal,
  requestedCompanyId: string | undefined,
  requestedCompanyIds: string[] | undefined,
  requestedGroupId: string | undefined,
  permission: 'ver_demandas',
): Promise<string[]> {
  const allowed = principal.corporateAccess?.companies
    .filter((company) => company.permissions[permission])
    .map((company) => company.companyId) || []
  if (requestedCompanyIds?.length) {
    return requireCompanySelectionAccess(principal, requestedCompanyIds, permission)
  }
  if (requestedCompanyId) {
    await requireCompanyAccess(principal, requestedCompanyId, permission)
    return [requestedCompanyId]
  }
  if (requestedGroupId) {
    const group = await requireGroupAccess(principal, requestedGroupId, permission)
    if (!group.canViewConsolidated) {
      throw new OperationalCommunicationError(
        'OPERATIONAL_COMMUNICATION_GROUP_DENIED',
        'A visao consolidada deste grupo nao esta autorizada.',
        403,
      )
    }
    return group.companyIds
  }
  return allowed
}

function calculateCrmSummary(rows: CrmDemandRow[]): CrmSummary {
  if (!rows.length) return EMPTY_CRM_SUMMARY
  const demands = new Map<string, {
    createdAt: number
    updatedAt: number
    status: string
    received: number[]
    sent: number[]
    lastType: CrmDemandRow['message_type']
    lastAt: number
  }>()
  for (const row of rows) {
    let demand = demands.get(row.demand_id)
    if (!demand) {
      demand = {
        createdAt: new Date(row.demand_created_at).getTime(),
        updatedAt: new Date(row.demand_updated_at).getTime(),
        status: row.demand_status,
        received: [],
        sent: [],
        lastType: null,
        lastAt: 0,
      }
      demands.set(row.demand_id, demand)
    }
    if (!row.message_created_at || !row.message_type) continue
    const timestamp = new Date(row.message_created_at).getTime()
    if (row.message_type === 'received') demand.received.push(timestamp)
    if (row.message_type === 'sent') demand.sent.push(timestamp)
    if (timestamp >= demand.lastAt) {
      demand.lastAt = timestamp
      demand.lastType = row.message_type
    }
  }

  const responseMinutes: number[] = []
  const resolutionHours: number[] = []
  let pending = 0
  const classes: CrmSummary['por_classificacao'] = {
    otimo: 0,
    bom: 0,
    ruim: 0,
    critico: 0,
    sem_dados: 0,
  }
  const now = Date.now()
  for (const demand of demands.values()) {
    const firstReceived = demand.received[0]
    const firstResponse = firstReceived
      ? demand.sent.find((timestamp) => timestamp > firstReceived)
      : undefined
    const pendingSince = demand.lastType === 'received'
      ? demand.lastAt
      : firstReceived && !firstResponse ? firstReceived : undefined
    const response = firstReceived && firstResponse
      ? Math.max(0, Math.round((firstResponse - firstReceived) / 60_000))
      : undefined
    if (response !== undefined) responseMinutes.push(response)
    if (pendingSince) pending += 1

    if (['finalizado', 'cancelado', 'completed', 'cancelled'].includes(demand.status)) {
      resolutionHours.push(Math.max(
        0,
        Math.round(((demand.updatedAt - demand.createdAt) / 3_600_000) * 10) / 10,
      ))
    }

    if (pendingSince) {
      const minutes = Math.max(0, Math.round((now - pendingSince) / 60_000))
      classes[minutes > 240 ? 'critico' : minutes > 60 ? 'ruim' : 'bom'] += 1
    } else if (response === undefined) {
      classes.sem_dados += 1
    } else if (response <= 15) {
      classes.otimo += 1
    } else if (response <= 60) {
      classes.bom += 1
    } else if (response <= 240) {
      classes.ruim += 1
    } else {
      classes.critico += 1
    }
  }

  return {
    total_threads: demands.size,
    com_pendencia: pending,
    resposta_media_minutos: average(responseMinutes, 0),
    resolucao_media_horas: average(resolutionHours, 1),
    por_classificacao: classes,
  }
}

async function bootstrapLegacyCommunications(
  client: PoolClient,
  principal: RequestPrincipal,
): Promise<void> {
  if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') return
  const source = await client.query<{ key: string; value: unknown }>(
    `select key, value
     from app_kv
     where tenant_id = $1 and key = any($2::text[])`,
    [principal.tenantId, [LegacyMessagesKey, LegacyTravelDeskKey]],
  )
  const values = new Map(source.rows.map((row) => [row.key, row.value]))
  await bootstrapLegacyMessages(client, principal, values.get(LegacyMessagesKey))
  await bootstrapLegacyTravelDesk(client, principal, values.get(LegacyTravelDeskKey))
}

async function bootstrapLegacyMessages(
  client: PoolClient,
  principal: RequestPrincipal,
  value: unknown,
): Promise<void> {
  if (!Array.isArray(value)) return
  for (const raw of value.slice(-LegacyLimit)) {
    const item = record(raw)
    const id = safeText(item?.id, 200)
    const demandId = safeText(item?.atendimento_id, 200)
    const content = safeText(item?.conteudo, 12_000)
    const createdAt = validDate(item?.timestamp)
    const messageType = legacyMessageType(item?.tipo)
    const channel = legacyChannel(item?.canal)
    if (!validId(id) || !demandId || !content || !createdAt || !messageType || !channel) continue
    const isRead = item?.lida === true
    await client.query(
      `insert into demand_messages (
         id, tenant_id, demand_id, company_id, message_type, channel,
         sender_name, content, attachments, is_read, important, read_at,
         legacy_source_id, created_at
       )
       select $2, demand.tenant_id, demand.id, demand.company_id, $3, $4,
              $5, $6, $7::jsonb, $8, $9, case when $8 then $10::timestamptz else null end,
              $2, $10::timestamptz
       from demands demand
       where demand.tenant_id = $1 and demand.id = $11
         and (demand.travel_order_id is null or exists (
           select 1 from company_portal_travel_orders visible_order
           where visible_order.tenant_id = demand.tenant_id
             and visible_order.id = demand.travel_order_id
             and visible_order.status = 'submitted'
         ))
       on conflict do nothing`,
      [
        principal.tenantId,
        id,
        messageType,
        channel,
        safeText(item?.remetente, 300) || null,
        content,
        JSON.stringify(Array.isArray(item?.anexos) ? item?.anexos.slice(0, 20) : []),
        isRead,
        item?.importante === true,
        createdAt,
        demandId,
      ],
    )
  }
}

async function bootstrapLegacyTravelDesk(
  client: PoolClient,
  principal: RequestPrincipal,
  value: unknown,
): Promise<void> {
  if (!Array.isArray(value)) return
  for (const raw of value.slice(-30)) {
    const item = record(raw)
    const note = safeText(item?.text, 4_000)
    const createdAt = validDate(item?.created_at)
    if (!note || !createdAt) continue
    const legacyId = createHash('sha256')
      .update(`${createdAt}|${note}`)
      .digest('hex')
    await client.query(
      `insert into travel_desk_notes (
         id, tenant_id, created_by_user_id, note, legacy_source_id, created_at
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict do nothing`,
      [
        `legacy-desk-${legacyId.slice(0, 32)}`,
        principal.tenantId,
        principal.user.id,
        note,
        legacyId,
        createdAt,
      ],
    )
  }
}

function travelDeskNoteSelect(): string {
  return `select note.id, note.company_id,
                 coalesce(company.trade_name, company.legal_name) as company_name,
                 note.demand_id, demand.demand_number,
                 note.created_by_user_id, author.name as created_by_name,
                 note.note, note.status, note.created_at, note.updated_at
          from travel_desk_notes note
          join users author on author.id = note.created_by_user_id
          left join companies company
            on company.tenant_id = note.tenant_id
           and company.id = note.company_id
          left join demands demand
            on demand.tenant_id = note.tenant_id
           and demand.id = note.demand_id`
}

function mapTravelDeskNote(row: TravelDeskNoteRow): TravelDeskNote {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    demandId: row.demand_id,
    demandNumber: row.demand_number,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    note: row.note,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function average(values: number[], decimals: 0 | 1): number {
  if (!values.length) return 0
  const value = values.reduce((sum, item) => sum + item, 0) / values.length
  return decimals === 0 ? Math.round(value) : Math.round(value * 10) / 10
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function validId(value: string): boolean {
  return value.length >= 2 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function legacyMessageType(value: unknown): CrmDemandRow['message_type'] {
  if (value === 'recebida') return 'received'
  if (value === 'enviada') return 'sent'
  if (value === 'evento_sistema') return 'system_event'
  if (value === 'nota_interna') return 'internal_note'
  return null
}

function legacyChannel(value: unknown): string | null {
  const normalized = safeText(value, 50).toLocaleLowerCase('pt-BR')
  if (normalized === 'whatsapp') return 'whatsapp'
  if (normalized === 'e-mail' || normalized === 'email') return 'email'
  if (normalized === 'telefone') return 'phone'
  if (normalized === 'sistema') return 'system'
  if (normalized === 'presencial') return 'in_person'
  if (normalized === 'outro') return 'other'
  return null
}

import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'

import type {
  AiActionProposal,
  AiActionStatus,
  AiActionType,
} from '@/lib/ai-actions'
import { executeAssistantTool } from '@/lib/assistant/tools'
import { createEntityId } from '@/lib/ids'
import { authorizeOrThrow } from '@/lib/server/authorization-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { requireCompanyAccess } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { createRelationalDemand } from '@/lib/server/demand-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

const proposalInputSchema = z.object({
  actionType: z.enum(['create_demand', 'create_hotel', 'human_handoff']),
  companyId: z.string().trim().min(1).max(200).nullable().optional(),
  summary: z.string().trim().min(3).max(1_000),
  payload: z.record(z.unknown()),
  idempotencyKey: z.string().trim().min(12).max(200),
  expiresInMinutes: z.number().int().min(5).max(1_440).default(30),
}).strict()

const hotelPayloadSchema = z.object({
  nome: z.string().trim().min(2).max(300),
  cidade: z.string().trim().min(2).max(200).nullable().optional(),
  uf: z.string().trim().min(2).max(10).nullable().optional(),
  pais: z.string().trim().min(2).max(80).default('BR'),
  telefone: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  endereco: z.string().trim().max(500).nullable().optional(),
  categoria: z.string().trim().max(80).nullable().optional(),
  faturado: z.boolean().default(false),
  info_faturamento: z.string().trim().max(1_000).nullable().optional(),
  observacoes: z.string().trim().max(2_000).nullable().optional(),
}).strict()

interface ProposalRow {
  id: string
  requested_by_user_id: string
  company_id: string | null
  action_type: AiActionType
  status: AiActionStatus
  summary: string
  payload: unknown
  result: unknown
  version: string | number
  expires_at: Date | string
  confirmed_at: Date | string | null
  executed_at: Date | string | null
  error_code: string | null
  error_message: string | null
  created_at: Date | string
  updated_at: Date | string
}

export class AiActionServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AiActionServiceError'
  }
}

export async function listAiActionProposals(
  principal: RequestPrincipal,
  options: { status?: AiActionStatus; limit?: number } = {},
): Promise<AiActionProposal[]> {
  authorizeOrThrow(principal, {
    action: 'read',
    resource: 'ai',
    requiredPermission: 'usar_ia',
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  })
  const canManage = Boolean(principal.user.permissoes?.gerenciar_ia)
  const limit = Math.max(1, Math.min(100, options.limit || 30))
  return withTenantTransaction(principal.tenantId, async (client) => {
    await expirePendingProposals(client, principal)
    const result = await client.query<ProposalRow>(
      `select id, requested_by_user_id, company_id, action_type, status,
              summary, payload, result, version, expires_at, confirmed_at,
              executed_at, error_code, error_message, created_at, updated_at
       from ai_action_proposals
       where tenant_id = $1
         and ($2::boolean or requested_by_user_id = $3)
         and ($4::text is null or status = $4)
       order by created_at desc
       limit $5`,
      [
        principal.tenantId,
        canManage,
        principal.user.id,
        options.status || null,
        limit,
      ],
    )
    return result.rows.map(toProposal)
  })
}

export async function prepareAiActionProposal(
  principal: RequestPrincipal,
  rawInput: unknown,
): Promise<{ proposal: AiActionProposal; replayed: boolean }> {
  authorizeOrThrow(principal, {
    action: 'execute',
    resource: 'ai',
    requiredPermission: 'usar_ia',
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  })
  const input = proposalInputSchema.parse(rawInput)
  const normalized = await validateActionPayload(principal, input.actionType, input.companyId || null, input.payload)
  const inputHash = hash({
    actionType: input.actionType,
    companyId: normalized.companyId,
    payload: normalized.payload,
  })

  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const existing = await client.query<ProposalRow>(
      `select id, requested_by_user_id, company_id, action_type, status,
              summary, payload, result, version, expires_at, confirmed_at,
              executed_at, error_code, error_message, created_at, updated_at
       from ai_action_proposals
       where tenant_id = $1 and idempotency_key = $2`,
      [principal.tenantId, input.idempotencyKey],
    )
    if (existing.rows[0]) {
      const row = existing.rows[0]
      if (row.requested_by_user_id !== principal.user.id || hash({
        actionType: row.action_type,
        companyId: row.company_id,
        payload: recordValue(row.payload),
      }) !== inputHash) {
        throw new AiActionServiceError(
          'AI_ACTION_IDEMPOTENCY_CONFLICT',
          'A chave de idempotencia ja foi usada por outra proposta.',
          409,
        )
      }
      return { proposal: toProposal(row), replayed: true }
    }

    const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
    const inserted = await client.query<ProposalRow>(
      `insert into ai_action_proposals (
         tenant_id, requested_by_user_id, company_id, action_type, status,
         summary, payload, idempotency_key, input_hash, expires_at
       ) values (
         $1, $2, $3, $4, 'pending_confirmation',
         $5, $6::jsonb, $7, $8, $9
       )
       returning id, requested_by_user_id, company_id, action_type, status,
                 summary, payload, result, version, expires_at, confirmed_at,
                 executed_at, error_code, error_message, created_at, updated_at`,
      [
        principal.tenantId,
        principal.user.id,
        normalized.companyId,
        input.actionType,
        input.summary,
        JSON.stringify(normalized.payload),
        input.idempotencyKey,
        inputHash,
        expiresAt,
      ],
    )
    const proposal = inserted.rows[0]
    await insertActionEvent(client, principal, proposal.id, 'prepared', {
      actionType: proposal.action_type,
      companyId: proposal.company_id,
    })
    return { proposal: toProposal(proposal), replayed: false }
  })

  await writeAuditEvent({
    action: 'assistant.action.prepare',
    result: 'success',
    entityType: 'ai_action_proposal',
    entityId: result.proposal.id,
    metadata: {
      actionType: result.proposal.actionType,
      companyId: result.proposal.companyId,
      replayed: result.replayed,
    },
  })
  return result
}

export async function confirmAiActionProposal(
  principal: RequestPrincipal,
  proposalId: string,
  input: { confirmation: true; expectedVersion: number; idempotencyKey: string },
): Promise<{ proposal: AiActionProposal; replayed: boolean }> {
  authorizeOrThrow(principal, {
    action: 'execute',
    resource: 'ai',
    requiredPermission: 'usar_ia',
    scope: { tenantId: principal.tenantId },
    allowEmptyCompanyScope: true,
  })
  if (input.confirmation !== true) {
    throw new AiActionServiceError(
      'AI_ACTION_CONFIRMATION_REQUIRED',
      'A execucao exige confirmacao humana explicita.',
      409,
    )
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AiActionServiceError('AI_ACTION_VERSION_INVALID', 'Versao da proposta invalida.', 400)
  }
  if (input.idempotencyKey.trim().length < 12 || input.idempotencyKey.length > 200) {
    throw new AiActionServiceError('AI_ACTION_IDEMPOTENCY_INVALID', 'Chave de idempotencia invalida.', 400)
  }

  const prepared = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<ProposalRow>(
      `select id, requested_by_user_id, company_id, action_type, status,
              summary, payload, result, version, expires_at, confirmed_at,
              executed_at, error_code, error_message, created_at, updated_at
       from ai_action_proposals
       where tenant_id = $1 and id = $2
       for update`,
      [principal.tenantId, proposalId],
    )
    const row = result.rows[0]
    if (!row) throw new AiActionServiceError('AI_ACTION_NOT_FOUND', 'Proposta nao encontrada.', 404)
    assertCanOperateProposal(principal, row)
    if (row.status === 'completed') return { row, replayed: true }
    if (row.status === 'executing') {
      throw new AiActionServiceError(
        'AI_ACTION_ALREADY_EXECUTING',
        'A proposta ja esta em execucao.',
        409,
      )
    }
    if (row.status !== 'pending_confirmation') {
      throw new AiActionServiceError(
        'AI_ACTION_NOT_CONFIRMABLE',
        `A proposta esta em estado ${row.status} e nao pode ser confirmada.`,
        409,
      )
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query(
        `update ai_action_proposals
         set status = 'expired', version = version + 1
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, row.id],
      )
      await insertActionEvent(client, principal, row.id, 'expired', {})
      throw new AiActionServiceError('AI_ACTION_EXPIRED', 'A proposta expirou e deve ser preparada novamente.', 409)
    }
    if (Number(row.version) !== input.expectedVersion) {
      throw new AiActionServiceError(
        'AI_ACTION_VERSION_CONFLICT',
        'A proposta foi alterada. Recarregue antes de confirmar.',
        409,
      )
    }
    await validateActionPayload(principal, row.action_type, row.company_id, recordValue(row.payload))
    const updated = await client.query<ProposalRow>(
      `update ai_action_proposals
       set status = 'executing',
           confirmed_by_user_id = $3,
           confirmed_at = now(),
           version = version + 1,
           result = jsonb_set(result, '{confirmationIdempotencyKey}', to_jsonb($4::text), true)
       where tenant_id = $1 and id = $2 and version = $5
       returning id, requested_by_user_id, company_id, action_type, status,
                 summary, payload, result, version, expires_at, confirmed_at,
                 executed_at, error_code, error_message, created_at, updated_at`,
      [
        principal.tenantId,
        row.id,
        principal.user.id,
        input.idempotencyKey,
        input.expectedVersion,
      ],
    )
    if (!updated.rows[0]) {
      throw new AiActionServiceError(
        'AI_ACTION_VERSION_CONFLICT',
        'A proposta foi alterada durante a confirmacao.',
        409,
      )
    }
    await insertActionEvent(client, principal, row.id, 'confirmed', {
      confirmationIdempotencyKey: input.idempotencyKey,
    })
    await insertActionEvent(client, principal, row.id, 'execution_started', {})
    return { row: updated.rows[0], replayed: false }
  })

  if (prepared.replayed) {
    return { proposal: toProposal(prepared.row), replayed: true }
  }

  try {
    const executionResult = await executeProposal(principal, prepared.row)
    const completed = await withTenantTransaction(principal.tenantId, async (client) => {
      const result = await client.query<ProposalRow>(
        `update ai_action_proposals
         set status = 'completed',
             result = $3::jsonb,
             executed_at = now(),
             version = version + 1,
             error_code = null,
             error_message = null
         where tenant_id = $1 and id = $2 and status = 'executing'
         returning id, requested_by_user_id, company_id, action_type, status,
                   summary, payload, result, version, expires_at, confirmed_at,
                   executed_at, error_code, error_message, created_at, updated_at`,
        [principal.tenantId, prepared.row.id, JSON.stringify(executionResult)],
      )
      if (!result.rows[0]) {
        throw new AiActionServiceError(
          'AI_ACTION_COMPLETION_CONFLICT',
          'Nao foi possivel confirmar a conclusao da proposta.',
          409,
        )
      }
      await insertActionEvent(client, principal, prepared.row.id, 'execution_completed', executionResult)
      return result.rows[0]
    })
    await writeAuditEvent({
      action: 'assistant.action.execute',
      result: 'success',
      entityType: 'ai_action_proposal',
      entityId: prepared.row.id,
      metadata: {
        actionType: prepared.row.action_type,
        companyId: prepared.row.company_id,
      },
    })
    return { proposal: toProposal(completed), replayed: false }
  } catch (error) {
    const failure = normalizeError(error)
    await withTenantTransaction(principal.tenantId, async (client) => {
      await client.query(
        `update ai_action_proposals
         set status = 'failed',
             error_code = $3,
             error_message = $4,
             version = version + 1
         where tenant_id = $1 and id = $2 and status = 'executing'`,
        [principal.tenantId, prepared.row.id, failure.code, failure.message.slice(0, 1_000)],
      )
      await insertActionEvent(client, principal, prepared.row.id, 'execution_failed', {
        code: failure.code,
        message: failure.message.slice(0, 500),
      })
    })
    await writeAuditEvent({
      action: 'assistant.action.execute',
      result: 'failure',
      entityType: 'ai_action_proposal',
      entityId: prepared.row.id,
      metadata: {
        actionType: prepared.row.action_type,
        companyId: prepared.row.company_id,
        errorCode: failure.code,
      },
    })
    throw error
  }
}

export async function rejectAiActionProposal(
  principal: RequestPrincipal,
  proposalId: string,
  expectedVersion: number,
): Promise<AiActionProposal> {
  const proposal = await withTenantTransaction(principal.tenantId, async (client) => {
    const current = await client.query<ProposalRow>(
      `select id, requested_by_user_id, company_id, action_type, status,
              summary, payload, result, version, expires_at, confirmed_at,
              executed_at, error_code, error_message, created_at, updated_at
       from ai_action_proposals
       where tenant_id = $1 and id = $2
       for update`,
      [principal.tenantId, proposalId],
    )
    const row = current.rows[0]
    if (!row) throw new AiActionServiceError('AI_ACTION_NOT_FOUND', 'Proposta nao encontrada.', 404)
    assertCanOperateProposal(principal, row)
    if (row.status === 'rejected') return row
    if (row.status !== 'pending_confirmation' || Number(row.version) !== expectedVersion) {
      throw new AiActionServiceError(
        'AI_ACTION_REJECTION_CONFLICT',
        'A proposta nao esta mais disponivel para rejeicao.',
        409,
      )
    }
    const updated = await client.query<ProposalRow>(
      `update ai_action_proposals
       set status = 'rejected', rejected_at = now(), version = version + 1
       where tenant_id = $1 and id = $2 and version = $3
       returning id, requested_by_user_id, company_id, action_type, status,
                 summary, payload, result, version, expires_at, confirmed_at,
                 executed_at, error_code, error_message, created_at, updated_at`,
      [principal.tenantId, proposalId, expectedVersion],
    )
    if (!updated.rows[0]) {
      throw new AiActionServiceError('AI_ACTION_REJECTION_CONFLICT', 'A proposta foi alterada.', 409)
    }
    await insertActionEvent(client, principal, proposalId, 'rejected', {})
    return updated.rows[0]
  })
  await writeAuditEvent({
    action: 'assistant.action.reject',
    result: 'success',
    entityType: 'ai_action_proposal',
    entityId: proposal.id,
  })
  return toProposal(proposal)
}

async function validateActionPayload(
  principal: RequestPrincipal,
  actionType: AiActionType,
  companyId: string | null,
  payload: Record<string, unknown>,
): Promise<{ companyId: string | null; payload: Record<string, unknown> }> {
  if (actionType === 'create_demand') {
    const demand = recordValue(payload.demand)
    const resolvedCompanyId = text(demand.empresa_id || demand.company_id || companyId)
    if (!resolvedCompanyId) {
      throw new AiActionServiceError(
        'AI_ACTION_COMPANY_REQUIRED',
        'A demanda precisa de uma empresa valida.',
        400,
      )
    }
    await requireCompanyAccess(principal, resolvedCompanyId, 'criar_demandas')
    return {
      companyId: resolvedCompanyId,
      payload: {
        demand,
        submit: payload.submit !== false,
      },
    }
  }

  if (actionType === 'create_hotel') {
    authorizeOrThrow(principal, {
      action: 'create',
      resource: 'companies',
      requiredPermission: 'cadastrar_hoteis',
      scope: { tenantId: principal.tenantId },
      allowEmptyCompanyScope: true,
    })
    return { companyId: null, payload: hotelPayloadSchema.parse(payload) }
  }

  const resolvedCompanyId = companyId || text(payload.companyId) || null
  if (resolvedCompanyId) await requireCompanyAccess(principal, resolvedCompanyId, 'criar_demandas')
  return {
    companyId: resolvedCompanyId,
    payload: {
      reason: z.string().trim().min(3).max(2_000).parse(payload.reason),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal').parse(payload.priority),
    },
  }
}

async function executeProposal(
  principal: RequestPrincipal,
  proposal: ProposalRow,
): Promise<Record<string, unknown>> {
  const payload = recordValue(proposal.payload)
  if (proposal.action_type === 'create_demand') {
    const result = await createRelationalDemand(
      principal,
      {
        demand: recordValue(payload.demand),
        submit: payload.submit !== false,
      },
      `ai-action:${proposal.id}:create-demand`,
    )
    return {
      entityType: 'demand',
      entityId: result.relational.id,
      demandNumber: result.relational.demandNumber,
      replayed: result.replayed,
    }
  }

  if (proposal.action_type === 'create_hotel') {
    const hotel = hotelPayloadSchema.parse(payload)
    return withTenantTransaction(principal.tenantId, async (client) => {
      const duplicate = await client.query<{ id: string }>(
        `select id
         from hotels
         where tenant_id = $1
           and deleted_at is null
           and lower(name) = lower($2)
           and lower(coalesce(city, '')) = lower(coalesce($3, ''))
           and lower(coalesce(state, '')) = lower(coalesce($4, ''))
         limit 1`,
        [principal.tenantId, hotel.nome, hotel.cidade || null, hotel.uf || null],
      )
      if (duplicate.rows[0]) {
        return {
          entityType: 'hotel',
          entityId: duplicate.rows[0].id,
          replayed: true,
          duplicate: true,
        }
      }
      const id = createEntityId('hotel')
      await client.query(
        `insert into hotels (
           id, tenant_id, name, city, state, country, phone, email,
           address, category, billing_enabled, billing_info, amenities,
           status
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13::jsonb, 'active'
         )`,
        [
          id,
          principal.tenantId,
          hotel.nome,
          hotel.cidade || null,
          hotel.uf?.toUpperCase() || null,
          hotel.pais.toUpperCase(),
          hotel.telefone || null,
          hotel.email || null,
          hotel.endereco || null,
          hotel.categoria || null,
          hotel.faturado,
          hotel.info_faturamento || null,
          JSON.stringify({ observacoes: hotel.observacoes || null, source: 'assistant.confirmed_action' }),
        ],
      )
      return { entityType: 'hotel', entityId: id, replayed: false }
    })
  }

  const result = await executeAssistantTool(
    'transferToHuman',
    payload,
    {
      userId: principal.user.id,
      userName: principal.user.name,
      userRole: principal.roleKey,
      companyId: proposal.company_id,
      channel: 'portal',
      confirmed: true,
    },
  )
  if (!result.ok) {
    throw new AiActionServiceError(
      'AI_HANDOFF_FAILED',
      result.error || 'Nao foi possivel criar o atendimento humano.',
      409,
    )
  }
  return { entityType: 'human_handoff', entityId: text(recordValue(result.data).id) || randomUUID() }
}

async function expirePendingProposals(
  client: import('pg').PoolClient,
  principal: RequestPrincipal,
): Promise<void> {
  const expired = await client.query<{ id: string }>(
    `update ai_action_proposals
     set status = 'expired', version = version + 1
     where tenant_id = $1
       and status = 'pending_confirmation'
       and expires_at <= now()
     returning id`,
    [principal.tenantId],
  )
  for (const row of expired.rows) {
    await insertActionEvent(client, principal, row.id, 'expired', {})
  }
}

async function insertActionEvent(
  client: import('pg').PoolClient,
  principal: RequestPrincipal,
  proposalId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into ai_action_events (
       tenant_id, proposal_id, event_type, actor_user_id, payload
     ) values ($1, $2, $3, $4, $5::jsonb)`,
    [
      principal.tenantId,
      proposalId,
      eventType,
      principal.user.id,
      JSON.stringify(payload),
    ],
  )
}

function assertCanOperateProposal(principal: RequestPrincipal, proposal: ProposalRow): void {
  if (
    proposal.requested_by_user_id !== principal.user.id
    && !principal.user.permissoes?.gerenciar_ia
  ) {
    throw new AiActionServiceError(
      'AI_ACTION_OWNER_DENIED',
      'A proposta pertence a outro usuario.',
      403,
    )
  }
}

function toProposal(row: ProposalRow): AiActionProposal {
  return {
    id: row.id,
    actionType: row.action_type,
    status: row.status,
    companyId: row.company_id,
    summary: row.summary,
    payloadPreview: previewPayload(row.action_type, recordValue(row.payload)),
    result: recordValue(row.result),
    version: Number(row.version),
    expiresAt: iso(row.expires_at),
    confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : null,
    executedAt: row.executed_at ? iso(row.executed_at) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function previewPayload(actionType: AiActionType, payload: Record<string, unknown>): Record<string, unknown> {
  if (actionType === 'create_demand') {
    const demand = recordValue(payload.demand)
    return {
      empresaId: demand.empresa_id || demand.company_id || null,
      passageiro: demand.passageiro_nome || demand.passenger_name || null,
      servico: demand.tipo_servico || demand.service_type || null,
      prioridade: demand.prioridade || demand.priority || null,
      destino: recordValue(demand.detalhes_hotel).cidade
        || recordValue(demand.detalhes_aereo).destino
        || recordValue(demand.detalhes_pacote).destino
        || null,
    }
  }
  if (actionType === 'create_hotel') {
    return {
      nome: payload.nome,
      cidade: payload.cidade,
      uf: payload.uf,
      categoria: payload.categoria,
    }
  }
  return {
    reason: payload.reason,
    priority: payload.priority,
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function iso(value: Date | string): string {
  return new Date(value).toISOString()
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof AiActionServiceError) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: error.name || 'AI_ACTION_FAILED', message: error.message }
  return { code: 'AI_ACTION_FAILED', message: 'Falha desconhecida ao executar a proposta.' }
}

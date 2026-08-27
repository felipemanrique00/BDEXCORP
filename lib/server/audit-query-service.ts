import 'server-only'

import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const optionalText = (max: number) => z.preprocess(
  (value) => String(value ?? '').trim() || undefined,
  z.string().max(max).optional(),
)

export const auditLogQuerySchema = z.object({
  action: optionalText(160),
  result: z.enum(['success', 'denied', 'failure']).optional(),
  entityType: optionalText(160),
  actorUserId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'O fim do periodo deve ser posterior ao inicio.',
    })
  }
})

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>

interface AuditLogRow extends QueryResultRow {
  id: string
  action: string
  result: 'success' | 'denied' | 'failure'
  entity_type: string | null
  entity_id: string | null
  actor_user_id: string | null
  actor_name: string | null
  actor_email: string | null
  request_id: string | null
  ip_address: string | null
  user_agent: string | null
  metadata: Record<string, unknown>
  created_at: Date | string
  total_count: string | number
}

export interface ServerAuditLog {
  id: string
  action: string
  result: 'success' | 'denied' | 'failure'
  entityType: string | null
  entityId: string | null
  actor: {
    id: string | null
    name: string | null
    email: string | null
  }
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface ServerImportJob {
  id: string
  source: string
  status: string
  fileName: string | null
  requestedBy: {
    id: string | null
    name: string | null
    email: string | null
  }
  totalRows: number
  processedRows: number
  errorRows: number
  summary: Record<string, unknown>
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export async function listServerAuditLogs(
  principal: RequestPrincipal,
  rawQuery: unknown,
): Promise<{ items: ServerAuditLog[]; total: number }> {
  const query = auditLogQuerySchema.parse(rawQuery)
  return withTenantTransaction(principal.tenantId, async (client) => {
    await bootstrapLegacyAuditLogs(client, principal.tenantId)
    const result = await client.query<AuditLogRow>(
      `select
         log.id,
         log.action,
         log.result,
         log.entity_type,
         log.entity_id,
         log.actor_user_id,
         actor.name as actor_name,
         actor.email as actor_email,
         log.request_id,
         host(log.ip_address) as ip_address,
         log.user_agent,
         log.metadata,
         log.created_at,
         count(*) over() as total_count
       from audit_logs log
       left join users actor on actor.id = log.actor_user_id
       where log.tenant_id = $1
         and (
           log.entity_type is distinct from 'travel_order'
           or exists (
             select 1
             from company_portal_travel_orders visible_order
             where visible_order.tenant_id = log.tenant_id
               and visible_order.id::text = log.entity_id
               and visible_order.status = 'submitted'
           )
         )
         and ($2::text is null or log.action ilike '%' || $2 || '%')
         and ($3::text is null or log.result = $3)
         and ($4::text is null or log.entity_type = $4)
         and ($5::uuid is null or log.actor_user_id = $5)
         and ($6::timestamptz is null or log.created_at >= $6)
         and ($7::timestamptz is null or log.created_at <= $7)
       order by log.created_at desc, log.id desc
       limit $8 offset $9`,
      [
        principal.tenantId,
        query.action || null,
        query.result || null,
        query.entityType || null,
        query.actorUserId || null,
        query.from || null,
        query.to || null,
        query.limit,
        query.offset,
      ],
    )
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        result: row.result,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actor: {
          id: row.actor_user_id,
          name: row.actor_name,
          email: row.actor_email,
        },
        requestId: row.request_id,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        metadata: row.metadata || {},
        createdAt: new Date(row.created_at).toISOString(),
      })),
      total: Number(result.rows[0]?.total_count || 0),
    }
  })
}

export async function listServerImportJobs(
  principal: RequestPrincipal,
  limit = 100,
): Promise<ServerImportJob[]> {
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)))
  return withTenantTransaction(principal.tenantId, async (client) => {
    await bootstrapLegacyImportTransactions(client, principal.tenantId)
    const result = await client.query<{
      id: string
      source: string
      status: string
      file_name: string | null
      requested_by: string | null
      requested_by_name: string | null
      requested_by_email: string | null
      total_rows: string | number
      processed_rows: string | number
      error_rows: string | number
      summary: Record<string, unknown>
      started_at: Date | string | null
      finished_at: Date | string | null
      created_at: Date | string
    }>(
      `select
         job.id,
         job.source,
         job.status,
         file.original_name as file_name,
         job.requested_by,
         actor.name as requested_by_name,
         actor.email as requested_by_email,
         job.total_rows,
         job.processed_rows,
         job.error_rows,
         job.summary,
         job.started_at,
         job.finished_at,
         job.created_at
       from import_jobs job
       left join users actor on actor.id = job.requested_by
       left join stored_files file
         on file.tenant_id = job.tenant_id and file.id = job.file_id
       where job.tenant_id = $1
       order by job.created_at desc, job.id desc
       limit $2`,
      [principal.tenantId, safeLimit],
    )
    return result.rows.map((row) => ({
      id: row.id,
      source: row.source,
      status: row.status,
      fileName: row.file_name,
      requestedBy: {
        id: row.requested_by,
        name: row.requested_by_name,
        email: row.requested_by_email,
      },
      totalRows: safeCount(row.total_rows),
      processedRows: safeCount(row.processed_rows),
      errorRows: safeCount(row.error_rows),
      summary: row.summary || {},
      startedAt: optionalIsoDate(row.started_at),
      finishedAt: optionalIsoDate(row.finished_at),
      createdAt: new Date(row.created_at).toISOString(),
    }))
  })
}

async function bootstrapLegacyAuditLogs(
  client: import('pg').PoolClient,
  tenantId: string,
): Promise<void> {
  await client.query(
    `insert into audit_logs (
       tenant_id,
       action,
       entity_type,
       entity_id,
       result,
       metadata,
       created_at
     )
     select
       $1,
       left('legacy.' || coalesce(nullif(trim(item->>'acao'), ''), 'event'), 160),
       nullif(left(trim(item->>'entidade'), 160), ''),
       nullif(left(trim(item->>'entidade_id'), 240), ''),
       'success',
       jsonb_strip_nulls(jsonb_build_object(
         'source', 'app_kv:bbt-auditoria',
         'legacyId', coalesce(nullif(trim(item->>'id'), ''), md5(item::text)),
         'legacyUserId', nullif(trim(item->>'user_id'), ''),
         'legacyUserName', nullif(trim(item->>'user_name'), ''),
         'description', nullif(left(item->>'descricao', 4000), '')
       )),
       case
         when coalesce(item->>'timestamp', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
           then (item->>'timestamp')::timestamptz
         else now()
       end
     from app_kv storage
     cross join lateral jsonb_array_elements(
       case
         when jsonb_typeof(storage.value) = 'array' then storage.value
         else '[]'::jsonb
       end
     ) item
     where storage.tenant_id = $1
       and storage.key = 'bbt-auditoria'
       and jsonb_typeof(item) = 'object'
     on conflict do nothing`,
    [tenantId],
  )
}

async function bootstrapLegacyImportTransactions(
  client: import('pg').PoolClient,
  tenantId: string,
): Promise<void> {
  await client.query(
    `insert into import_jobs (
       id,
       tenant_id,
       source,
       status,
       idempotency_key,
       total_rows,
       processed_rows,
       error_rows,
       summary,
       started_at,
       finished_at,
       created_at
     )
     select
       gen_random_uuid(),
       $1,
       'legacy_local_transaction',
       case item->>'status'
         when 'commitada' then 'completed'
         when 'revertida' then 'rolled_back'
         else 'processing'
       end,
       left(coalesce(nullif(trim(item->>'id'), ''), md5(item::text)), 240),
       greatest(
         0,
         case when coalesce(item#>>'{resumo,criadas}', '') ~ '^\\d+$' then (item#>>'{resumo,criadas}')::integer else 0 end
         + case when coalesce(item#>>'{resumo,atualizadas}', '') ~ '^\\d+$' then (item#>>'{resumo,atualizadas}')::integer else 0 end
         + case when coalesce(item#>>'{resumo,ignoradas}', '') ~ '^\\d+$' then (item#>>'{resumo,ignoradas}')::integer else 0 end
         + case when coalesce(item#>>'{resumo,erros}', '') ~ '^\\d+$' then (item#>>'{resumo,erros}')::integer else 0 end
       ),
       greatest(
         0,
         case when coalesce(item#>>'{resumo,criadas}', '') ~ '^\\d+$' then (item#>>'{resumo,criadas}')::integer else 0 end
         + case when coalesce(item#>>'{resumo,atualizadas}', '') ~ '^\\d+$' then (item#>>'{resumo,atualizadas}')::integer else 0 end
       ),
       greatest(
         0,
         case when coalesce(item#>>'{resumo,erros}', '') ~ '^\\d+$' then (item#>>'{resumo,erros}')::integer else 0 end
       ),
       jsonb_build_object(
         'source', 'app_kv:bbt-transacoes',
         'legacyId', coalesce(nullif(trim(item->>'id'), ''), md5(item::text)),
         'description', nullif(left(item->>'descricao', 4000), ''),
         'legacyStatus', nullif(item->>'status', ''),
         'legacyUserId', nullif(item->>'user_id', ''),
         'legacyUserName', nullif(item->>'user_name', ''),
         'legacySummary', coalesce(item->'resumo', '{}'::jsonb)
       ),
       case
         when coalesce(item->>'iniciada_em', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
           then (item->>'iniciada_em')::timestamptz
         else now()
       end,
       case
         when coalesce(item->>'finalizada_em', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
           then (item->>'finalizada_em')::timestamptz
         else null
       end,
       case
         when coalesce(item->>'iniciada_em', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
           then (item->>'iniciada_em')::timestamptz
         else now()
       end
     from app_kv storage
     cross join lateral jsonb_array_elements(
       case
         when jsonb_typeof(storage.value) = 'array' then storage.value
         else '[]'::jsonb
       end
     ) item
     where storage.tenant_id = $1
       and storage.key = 'bbt-transacoes'
       and jsonb_typeof(item) = 'object'
     on conflict (tenant_id, source, idempotency_key) do nothing`,
    [tenantId],
  )
}

function optionalIsoDate(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null
}

function safeCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

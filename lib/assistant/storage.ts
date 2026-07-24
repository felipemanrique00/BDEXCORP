import 'server-only'

import type { PoolClient } from 'pg'

import { createEntityId } from '@/lib/ids'
import { getStorageEntriesByKeys } from '@/lib/server-db'
import { getAccessibleCompanyIds } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import {
  requireRequestContext,
  type RequestPrincipal,
} from '@/lib/server/request-context'

export const ASSISTANT_KEYS = {
  settings: 'bbt-assistant-settings-v1',
  tools: 'bbt-assistant-tools-v1',
  auditLogs: 'bbt-assistant-audit-logs-v1',
  toolLogs: 'bbt-assistant-tool-logs-v1',
  conversations: 'bbt-assistant-conversations-v1',
  messageQueue: 'bbt-assistant-message-queue-v1',
  whatsappSession: 'bbt-assistant-whatsapp-session-v1',
  whatsappLogs: 'bbt-assistant-whatsapp-logs-v1',
  generatedDocuments: 'bbt-assistant-generated-documents-v1',
  voucherSendLogs: 'bbt-assistant-voucher-send-logs-v1',
  audioTranscriptions: 'bbt-assistant-audio-transcriptions-v1',
  audioGenerations: 'bbt-assistant-audio-generations-v1',
  securityEvents: 'bbt-assistant-security-events-v1',
  humanHandoffs: 'bbt-assistant-human-handoffs-v1',
  integrationLogs: 'bbt-assistant-integration-logs-v1',
} as const

export type AssistantStorageKey = (typeof ASSISTANT_KEYS)[keyof typeof ASSISTANT_KEYS]

interface RelationalReadResult {
  found: boolean
  value: unknown
}

export function createId(prefix: string): string {
  return createEntityId(prefix)
}

export async function getAssistantValue<T>(
  key: AssistantStorageKey,
  fallback: T,
): Promise<T> {
  const principal = requireRequestContext().principal
  const relational = await readAssistantValue(principal, key)
  if (relational.found) return relational.value as T

  const legacyEntries = await getStorageEntriesByKeys([key])
  const legacy = legacyEntries[key]
  if (legacy === undefined || legacy === null) return fallback

  await writeAssistantValue(principal, key, legacy)
  return legacy as T
}

export async function setAssistantValue<T>(
  key: AssistantStorageKey,
  value: T,
): Promise<void> {
  await writeAssistantValue(requireRequestContext().principal, key, value)
}

export async function appendAssistantList<T extends { createdAt?: string }>(
  key: AssistantStorageKey,
  item: T,
  limit = 500,
): Promise<T[]> {
  const principal = requireRequestContext().principal
  if (key === ASSISTANT_KEYS.generatedDocuments) {
    await writeGeneratedDocuments(principal, [item])
  } else {
    await appendAssistantEvent(principal, key, item)
  }
  const current = await readAssistantValue(principal, key, limit)
  return (Array.isArray(current.value) ? current.value : []) as T[]
}

/**
 * Compatibilidade somente para consumidores antigos ainda nao migrados.
 * Novas ferramentas da assistente nao podem usar esta funcao.
 */
export async function getRawAppKv<T>(key: string, fallback: T): Promise<T> {
  const entries = await getStorageEntriesByKeys([key])
  return entries[key] === undefined || entries[key] === null
    ? fallback
    : entries[key] as T
}

async function readAssistantValue(
  principal: RequestPrincipal,
  key: AssistantStorageKey,
  limit = 2_000,
): Promise<RelationalReadResult> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    if (key === ASSISTANT_KEYS.settings) {
      const result = await client.query<{ payload: unknown }>(
        'select payload from assistant_settings where tenant_id = $1',
        [principal.tenantId],
      )
      return { found: Boolean(result.rows[0]), value: result.rows[0]?.payload }
    }

    if (key === ASSISTANT_KEYS.tools) {
      const result = await client.query<{ definition: unknown }>(
        `select definition
         from assistant_tools
         where tenant_id = $1
         order by definition->>'name', tool_key`,
        [principal.tenantId],
      )
      return { found: result.rows.length > 0, value: result.rows.map((row) => row.definition) }
    }

    if (key === ASSISTANT_KEYS.conversations) {
      const conversations = await client.query<{ state: unknown }>(
        `select state
         from assistant_conversations
         where tenant_id = $1
         order by last_message_at desc, id
         limit 500`,
        [principal.tenantId],
      )
      const messages = await client.query<{ payload: unknown }>(
        `select payload
         from assistant_messages
         where tenant_id = $1
         order by created_at desc, id
         limit 2000`,
        [principal.tenantId],
      )
      return {
        found: conversations.rows.length > 0 || messages.rows.length > 0,
        value: {
          conversations: conversations.rows.map((row) => row.state),
          messages: messages.rows.map((row) => row.payload),
        },
      }
    }

    if (key === ASSISTANT_KEYS.whatsappSession) {
      const result = await client.query<{ state: unknown }>(
        `select state
         from assistant_integration_sessions
         where tenant_id = $1 and session_key = 'whatsapp:default'`,
        [principal.tenantId],
      )
      return { found: Boolean(result.rows[0]), value: result.rows[0]?.state }
    }

    if (key === ASSISTANT_KEYS.generatedDocuments) {
      const result = await client.query<{ payload: unknown }>(
        `select payload
         from assistant_generated_documents
         where tenant_id = $1
         order by created_at desc, id
         limit $2`,
        [principal.tenantId, boundedLimit(limit)],
      )
      return { found: result.rows.length > 0, value: result.rows.map((row) => row.payload) }
    }

    const result = await client.query<{ payload: unknown }>(
      `select payload
       from assistant_events
       where tenant_id = $1 and category = $2
       order by created_at desc, id
       limit $3`,
      [principal.tenantId, key, boundedLimit(limit)],
    )
    return { found: result.rows.length > 0, value: result.rows.map((row) => row.payload) }
  })
}

async function writeAssistantValue(
  principal: RequestPrincipal,
  key: AssistantStorageKey,
  value: unknown,
): Promise<void> {
  if (key === ASSISTANT_KEYS.generatedDocuments) {
    await writeGeneratedDocuments(principal, arrayValue(value))
    return
  }

  await withTenantTransaction(principal.tenantId, async (client) => {
    if (key === ASSISTANT_KEYS.settings) {
      await client.query(
        `insert into assistant_settings (tenant_id, payload, updated_by)
         values ($1, $2::jsonb, $3)
         on conflict (tenant_id) do update set
           payload = excluded.payload,
           version = assistant_settings.version + 1,
           updated_by = excluded.updated_by`,
        [principal.tenantId, JSON.stringify(recordValue(value)), principal.user.id],
      )
      return
    }

    if (key === ASSISTANT_KEYS.tools) {
      for (const definition of arrayValue(value)) {
        const tool = recordValue(definition)
        const toolKey = text(tool.id)
        if (!/^[A-Za-z][A-Za-z0-9_-]{1,119}$/.test(toolKey)) continue
        await client.query(
          `insert into assistant_tools (
             tenant_id, tool_key, definition, updated_by
           ) values ($1, $2, $3::jsonb, $4)
           on conflict (tenant_id, tool_key) do update set
             definition = excluded.definition,
             version = assistant_tools.version + 1,
             updated_by = excluded.updated_by`,
          [principal.tenantId, toolKey, JSON.stringify(tool), principal.user.id],
        )
      }
      return
    }

    if (key === ASSISTANT_KEYS.conversations) {
      await writeConversations(client, principal, recordValue(value))
      return
    }

    if (key === ASSISTANT_KEYS.whatsappSession) {
      const state = recordValue(value)
      await client.query(
        `insert into assistant_integration_sessions (
           tenant_id, session_key, provider, status, state, updated_by
         ) values ($1, 'whatsapp:default', $2, $3, $4::jsonb, $5)
         on conflict (tenant_id, session_key) do update set
           provider = excluded.provider,
           status = excluded.status,
           state = excluded.state,
           version = assistant_integration_sessions.version + 1,
           updated_by = excluded.updated_by`,
        [
          principal.tenantId,
          boundedText(state.provider, 120, 'whatsapp'),
          boundedText(state.status, 80, 'disconnected'),
          JSON.stringify(state),
          principal.user.id,
        ],
      )
      return
    }

    for (const item of arrayValue(value)) {
      await insertAssistantEvent(client, principal, key, recordValue(item))
    }
  })
}

async function writeConversations(
  client: PoolClient,
  principal: RequestPrincipal,
  state: Record<string, unknown>,
): Promise<void> {
  const allowedCompanyIds = new Set(getAccessibleCompanyIds(principal))
  const conversationIds = new Set<string>()

  for (const rawConversation of arrayValue(state.conversations)) {
    const conversation = recordValue(rawConversation)
    const id = boundedText(conversation.id, 200)
    if (id.length < 2) continue
    const companyId = authorizedCompanyId(conversation, allowedCompanyIds)
    const createdAt = isoDate(conversation.createdAt)
    const updatedAt = isoDate(conversation.updatedAt, createdAt)
    const lastMessageAt = isoDate(conversation.lastMessageAt, updatedAt)
    await client.query(
      `insert into assistant_conversations (
         id, tenant_id, owner_user_id, company_id, state,
         last_message_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       on conflict (tenant_id, id) do update set
         owner_user_id = coalesce(assistant_conversations.owner_user_id, excluded.owner_user_id),
         company_id = excluded.company_id,
         state = excluded.state,
         last_message_at = excluded.last_message_at,
         version = assistant_conversations.version + 1,
         updated_at = excluded.updated_at`,
      [
        id,
        principal.tenantId,
        principal.user.id,
        companyId,
        JSON.stringify({ ...conversation, companyId }),
        lastMessageAt,
        createdAt,
        updatedAt,
      ],
    )
    conversationIds.add(id)
  }

  for (const rawMessage of arrayValue(state.messages)) {
    const message = recordValue(rawMessage)
    const id = boundedText(message.id, 200)
    const conversationId = boundedText(message.conversationId, 200)
    if (id.length < 2 || !conversationIds.has(conversationId)) continue
    await client.query(
      `insert into assistant_messages (
         id, tenant_id, conversation_id, payload, created_at
       ) values ($1, $2, $3, $4::jsonb, $5)
       on conflict (tenant_id, id) do nothing`,
      [
        id,
        principal.tenantId,
        conversationId,
        JSON.stringify(message),
        isoDate(message.createdAt),
      ],
    )
  }
}

async function appendAssistantEvent(
  principal: RequestPrincipal,
  key: AssistantStorageKey,
  item: unknown,
): Promise<void> {
  await withTenantTransaction(principal.tenantId, (client) => (
    insertAssistantEvent(client, principal, key, recordValue(item))
  ))
}

async function insertAssistantEvent(
  client: PoolClient,
  principal: RequestPrincipal,
  key: AssistantStorageKey,
  item: Record<string, unknown>,
): Promise<void> {
  const allowedCompanyIds = new Set(getAccessibleCompanyIds(principal))
  const id = boundedText(item.id, 200) || createId('assistant_event')
  await client.query(
    `insert into assistant_events (
       id, tenant_id, company_id, category, payload, actor_user_id, created_at
     ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
     on conflict (tenant_id, id) do nothing`,
    [
      id,
      principal.tenantId,
      authorizedCompanyId(item, allowedCompanyIds),
      key,
      JSON.stringify({ ...item, id }),
      principal.user.id,
      isoDate(item.createdAt),
    ],
  )
}

async function writeGeneratedDocuments(
  principal: RequestPrincipal,
  documents: unknown[],
): Promise<void> {
  const allowedCompanyIds = new Set(getAccessibleCompanyIds(principal))
  await withTenantTransaction(principal.tenantId, async (client) => {
    for (const rawDocument of documents) {
      const document = recordValue(rawDocument)
      const id = boundedText(document.id, 200)
      if (id.length < 2) continue
      await client.query(
        `insert into assistant_generated_documents (
           id, tenant_id, company_id, document_type, status,
           payload, created_by, created_at
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         on conflict (tenant_id, id) do nothing`,
        [
          id,
          principal.tenantId,
          authorizedCompanyId(document, allowedCompanyIds),
          boundedText(document.type, 80, 'generic'),
          document.status === 'failed' ? 'failed' : 'generated',
          JSON.stringify(document),
          principal.user.id,
          isoDate(document.createdAt),
        ],
      )
    }
  })
}

function authorizedCompanyId(
  value: Record<string, unknown>,
  allowedCompanyIds: Set<string>,
): string | null {
  const companyId = text(value.companyId || value.company_id)
  return companyId && allowedCompanyIds.has(companyId) ? companyId : null
}

function boundedLimit(value: number): number {
  return Math.max(1, Math.min(2_000, Number(value) || 500))
}

function boundedText(
  value: unknown,
  limit: number,
  fallback = '',
): string {
  return (text(value) || fallback).slice(0, limit)
}

function isoDate(value: unknown, fallback = new Date().toISOString()): string {
  const date = new Date(text(value) || fallback)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

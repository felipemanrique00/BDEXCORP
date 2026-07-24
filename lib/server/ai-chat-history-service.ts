import 'server-only'

import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'

import type { AiChatHistoryMessage } from '@/lib/ai-chat-history'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const LegacyStorageKey = 'bbt-ia-chat-historico-v12'
const MaximumHistoryMessages = 60

interface MessageRow {
  payload: unknown
}

export class AiChatHistoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AiChatHistoryError'
  }
}

export async function listPersonalAiChatHistory(
  principal: RequestPrincipal,
): Promise<AiChatHistoryMessage[]> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const conversationId = personalConversationId(principal.user.id)
    await bootstrapLegacyHistory(client, principal, conversationId)
    const result = await client.query<MessageRow>(
      `select message.payload
       from assistant_messages message
       join assistant_conversations conversation
         on conversation.tenant_id = message.tenant_id
        and conversation.id = message.conversation_id
       where message.tenant_id = $1
         and message.conversation_id = $2
         and conversation.owner_user_id = $3
       order by message.created_at desc, message.id desc
       limit $4`,
      [
        principal.tenantId,
        conversationId,
        principal.user.id,
        MaximumHistoryMessages,
      ],
    )
    return result.rows
      .map((row) => parseMessage(row.payload))
      .filter((message): message is AiChatHistoryMessage => Boolean(message))
      .reverse()
  })
}

export async function appendPersonalAiChatHistory(
  principal: RequestPrincipal,
  messages: AiChatHistoryMessage[],
): Promise<void> {
  if (!messages.length) return
  if (messages.length > 10) {
    throw new AiChatHistoryError(
      'AI_CHAT_BATCH_TOO_LARGE',
      'Muitas mensagens em uma unica atualizacao.',
      413,
    )
  }

  await withTenantTransaction(principal.tenantId, async (client) => {
    const conversationId = personalConversationId(principal.user.id)
    await ensurePersonalConversation(client, principal, conversationId)
    await insertMessages(client, principal, conversationId, messages)
    await trimHistory(client, principal, conversationId)
  })
}

export async function clearPersonalAiChatHistory(
  principal: RequestPrincipal,
): Promise<void> {
  await withTenantTransaction(principal.tenantId, async (client) => {
    const conversationId = personalConversationId(principal.user.id)
    await client.query(
      `delete from assistant_messages message
       using assistant_conversations conversation
       where message.tenant_id = $1
         and message.conversation_id = $2
         and conversation.tenant_id = message.tenant_id
         and conversation.id = message.conversation_id
         and conversation.owner_user_id = $3`,
      [principal.tenantId, conversationId, principal.user.id],
    )
    await client.query(
      `update assistant_conversations
       set state = state || '{"messageCount":0}'::jsonb,
           last_message_at = now(),
           version = version + 1
       where tenant_id = $1 and id = $2 and owner_user_id = $3`,
      [principal.tenantId, conversationId, principal.user.id],
    )
  })

  await writeAuditEvent({
    action: 'assistant.personal_chat.clear',
    result: 'success',
    entityType: 'assistant_conversation',
    entityId: personalConversationId(principal.user.id),
  })
}

async function ensurePersonalConversation(
  client: PoolClient,
  principal: RequestPrincipal,
  conversationId: string,
): Promise<void> {
  const existing = await client.query<{ owner_user_id: string | null }>(
    `select owner_user_id
     from assistant_conversations
     where tenant_id = $1 and id = $2
     for update`,
    [principal.tenantId, conversationId],
  )
  if (existing.rows[0]?.owner_user_id && existing.rows[0].owner_user_id !== principal.user.id) {
    throw new AiChatHistoryError(
      'AI_CHAT_OWNER_MISMATCH',
      'A conversa solicitada pertence a outro usuario.',
      403,
    )
  }
  if (existing.rows[0]) return

  const now = new Date().toISOString()
  await client.query(
    `insert into assistant_conversations (
       id, tenant_id, owner_user_id, company_id, state,
       last_message_at, created_at, updated_at
     ) values ($1, $2, $3, null, $4::jsonb, $5, $5, $5)`,
    [
      conversationId,
      principal.tenantId,
      principal.user.id,
      JSON.stringify({
        channel: 'portal',
        kind: 'personal_ai_chat',
        participantName: principal.user.name,
        messageCount: 0,
      }),
      now,
    ],
  )
}

async function insertMessages(
  client: PoolClient,
  principal: RequestPrincipal,
  conversationId: string,
  messages: AiChatHistoryMessage[],
): Promise<void> {
  let lastMessageAt = messages[0]?.timestamp || new Date().toISOString()
  for (const message of messages) {
    validateMessage(message)
    await client.query(
      `insert into assistant_messages (
         id, tenant_id, conversation_id, payload, created_at
       ) values ($1, $2, $3, $4::jsonb, $5)
       on conflict (tenant_id, id) do nothing`,
      [
        message.id,
        principal.tenantId,
        conversationId,
        JSON.stringify(message),
        message.timestamp,
      ],
    )
    if (message.timestamp > lastMessageAt) lastMessageAt = message.timestamp
  }

  await client.query(
    `update assistant_conversations
     set last_message_at = greatest(last_message_at, $4::timestamptz),
         state = jsonb_set(
           state,
           '{messageCount}',
           to_jsonb((
             select count(*)
             from assistant_messages
             where tenant_id = $1 and conversation_id = $2
           )),
           true
         ),
         version = version + 1
     where tenant_id = $1 and id = $2 and owner_user_id = $3`,
    [principal.tenantId, conversationId, principal.user.id, lastMessageAt],
  )
}

async function trimHistory(
  client: PoolClient,
  principal: RequestPrincipal,
  conversationId: string,
): Promise<void> {
  await client.query(
    `delete from assistant_messages
     where tenant_id = $1
       and conversation_id = $2
       and id in (
         select id
         from assistant_messages
         where tenant_id = $1 and conversation_id = $2
         order by created_at desc, id desc
         offset $3
       )`,
    [principal.tenantId, conversationId, MaximumHistoryMessages],
  )
}

async function bootstrapLegacyHistory(
  client: PoolClient,
  principal: RequestPrincipal,
  conversationId: string,
): Promise<void> {
  if (!principal.platformAdmin && principal.roleKey !== 'tenant_admin') return

  const existing = await client.query<{ count: string }>(
    `select count(*)::text as count
     from assistant_messages
     where tenant_id = $1 and conversation_id = $2`,
    [principal.tenantId, conversationId],
  )
  if (Number(existing.rows[0]?.count || 0) > 0) return

  const source = await client.query<{ value: unknown }>(
    'select value from app_kv where tenant_id = $1 and key = $2',
    [principal.tenantId, LegacyStorageKey],
  )
  const legacyMessages = parseLegacyMessages(source.rows[0]?.value, principal.user.id)
  if (!legacyMessages.length) return

  await ensurePersonalConversation(client, principal, conversationId)
  await insertMessages(client, principal, conversationId, legacyMessages)
  await trimHistory(client, principal, conversationId)
}

function parseLegacyMessages(value: unknown, userId: string): AiChatHistoryMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(-MaximumHistoryMessages)
    .map((item, index) => {
      const parsed = parseMessage(item)
      if (!parsed) return null
      return {
        ...parsed,
        id: parsed.id || legacyMessageId(userId, parsed, index),
      }
    })
    .filter((message): message is AiChatHistoryMessage => Boolean(message))
}

function parseMessage(value: unknown): AiChatHistoryMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const message = value as Record<string, unknown>
  const role = message.role === 'user' || message.role === 'assistant' ? message.role : null
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  const timestamp = validIsoDate(message.timestamp)
  const provider = (
    message.provedor === 'openai'
    || message.provedor === 'gemini'
    || message.provedor === 'local'
  ) ? message.provedor : undefined
  if (!role || !content || content.length > 12_000 || !timestamp) return null
  return {
    id: typeof message.id === 'string' && validMessageId(message.id) ? message.id : '',
    role,
    content,
    timestamp,
    ...(provider ? { provedor: provider } : {}),
  }
}

function validateMessage(message: AiChatHistoryMessage): void {
  if (
    !validMessageId(message.id)
    || !['user', 'assistant'].includes(message.role)
    || !message.content.trim()
    || message.content.length > 12_000
    || !validIsoDate(message.timestamp)
    || (message.provedor && !['openai', 'gemini', 'local'].includes(message.provedor))
  ) {
    throw new AiChatHistoryError(
      'AI_CHAT_MESSAGE_INVALID',
      'Mensagem de historico invalida.',
      400,
    )
  }
}

function personalConversationId(userId: string): string {
  return `personal-ai-chat:${userId}`
}

function legacyMessageId(
  userId: string,
  message: AiChatHistoryMessage,
  index: number,
): string {
  const checksum = createHash('sha256')
    .update(`${message.role}|${message.timestamp}|${message.content}`)
    .digest('hex')
    .slice(0, 20)
  return `legacy-ai-chat:${userId}:${index}:${checksum}`
}

function validMessageId(value: string): boolean {
  return value.trim().length >= 2 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

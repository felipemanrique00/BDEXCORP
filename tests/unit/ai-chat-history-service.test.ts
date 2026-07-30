import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  writeAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: mocks.writeAuditEvent,
}))

import {
  appendPersonalAiChatHistory,
  clearPersonalAiChatHistory,
  listPersonalAiChatHistory,
} from '@/lib/server/ai-chat-history-service'

describe('personal AI chat history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.query.mockResolvedValue({ rows: [] })
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) =>
        operation({ query: mocks.query }),
    )
    mocks.writeAuditEvent.mockResolvedValue(undefined)
  })

  it('reads only the conversation owned by the authenticated user', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        payload: {
          id: 'ai-chat:message-a',
          role: 'user',
          content: 'Minha mensagem',
          timestamp: '2026-07-23T12:00:00.000Z',
        },
      }],
    })

    const messages = await listPersonalAiChatHistory(principal())

    expect(messages).toHaveLength(1)
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('conversation.owner_user_id = $3'),
      [
        '11111111-1111-4111-8111-111111111111',
        'personal-ai-chat:22222222-2222-4222-8222-222222222222',
        '22222222-2222-4222-8222-222222222222',
        60,
      ],
    )
  })

  it('creates and appends messages under the tenant and user from the session', async () => {
    await appendPersonalAiChatHistory(principal(), [{
      id: 'ai-chat:message-a',
      role: 'assistant',
      content: 'Resposta autorizada',
      timestamp: '2026-07-23T12:00:00.000Z',
      provedor: 'local',
    }])

    expect(mocks.withTenantTransaction).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.any(Function),
    )
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into assistant_conversations'),
      expect.arrayContaining([
        'personal-ai-chat:22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ]),
    )
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into assistant_messages'),
      expect.arrayContaining([
        'ai-chat:message-a',
        '11111111-1111-4111-8111-111111111111',
        'personal-ai-chat:22222222-2222-4222-8222-222222222222',
      ]),
    )
  })

  it('clears only the current user conversation and audits the action', async () => {
    await clearPersonalAiChatHistory(principal())

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('conversation.owner_user_id = $3'),
      [
        '11111111-1111-4111-8111-111111111111',
        'personal-ai-chat:22222222-2222-4222-8222-222222222222',
        '22222222-2222-4222-8222-222222222222',
      ],
    )
    expect(mocks.writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assistant.personal_chat.clear',
        entityId: 'personal-ai-chat:22222222-2222-4222-8222-222222222222',
      }),
    )
  })
})

function principal(): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'usuario@tenant.invalid',
      name: 'Usuario',
      role: 'company_admin',
      company_id: null,
      ativo: true,
      permissoes: PERMISSOES_PADRAO_POR_PERFIL.operacional,
    },
  }
}

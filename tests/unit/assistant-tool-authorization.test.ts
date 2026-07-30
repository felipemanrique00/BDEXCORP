import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  appendAssistantList: vi.fn(),
  createAssistantAuditLog: vi.fn(),
  createAssistantToolLog: vi.fn(),
  generateVoucherDocument: vi.fn(),
  getAssistantSettings: vi.fn(),
  getAssistantValue: vi.fn(),
  getAccessibleCompanyIds: vi.fn(),
  getFinancialOverview: vi.fn(),
  hasServerPermission: vi.fn(),
  listDemands: vi.fn(),
  listReservations: vi.fn(),
  listVouchers: vi.fn(),
  requireRequestContext: vi.fn(),
  setAssistantValue: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/assistant/storage', () => ({
  ASSISTANT_KEYS: {
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
  },
  appendAssistantList: mocks.appendAssistantList,
  createId: () => 'generated-id',
  getAssistantValue: mocks.getAssistantValue,
  setAssistantValue: mocks.setAssistantValue,
}))
vi.mock('@/lib/assistant/audit', () => ({
  createAssistantAuditLog: mocks.createAssistantAuditLog,
  createAssistantToolLog: mocks.createAssistantToolLog,
}))
vi.mock('@/lib/assistant/pdf', () => ({
  generateVoucherDocument: mocks.generateVoucherDocument,
}))
vi.mock('@/lib/assistant/settings', () => ({
  getAssistantSettings: mocks.getAssistantSettings,
}))
vi.mock('@/lib/security/api-guard', () => ({
  hasServerPermission: mocks.hasServerPermission,
}))
vi.mock('@/lib/server/corporate-access-service', () => ({
  getAccessibleCompanyIds: mocks.getAccessibleCompanyIds,
}))
vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))
vi.mock('@/lib/server/demand-service', () => ({
  listRelationalDemands: mocks.listDemands,
}))
vi.mock('@/lib/server/finance-service', () => ({
  getFinancialOverview: mocks.getFinancialOverview,
}))
vi.mock('@/lib/server/request-context', () => ({
  requireRequestContext: mocks.requireRequestContext,
}))
vi.mock('@/lib/server/travel-governance-service', () => ({
  listGovernedTravelReservations: mocks.listReservations,
}))
vi.mock('@/lib/server/voucher-service', () => ({
  listVouchers: mocks.listVouchers,
}))

import { executeAssistantTool } from '@/lib/assistant/tools'

describe('assistant tool authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAssistantValue.mockResolvedValue(null)
    mocks.setAssistantValue.mockResolvedValue(undefined)
    mocks.appendAssistantList.mockResolvedValue([])
    mocks.createAssistantToolLog.mockResolvedValue({
      inputSummary: '',
      outputSummary: '',
    })
    mocks.createAssistantAuditLog.mockResolvedValue({ id: 'audit-a' })
    mocks.getAccessibleCompanyIds.mockReturnValue(['company-a'])
    mocks.getAssistantSettings.mockResolvedValue({
      permissions: {
        allowedChannels: ['portal'],
        allowedModules: ['vouchers', 'financeiro'],
        allowFinancialData: true,
        allowPdfGeneration: true,
        allowWhatsAppSend: false,
      },
    })
    mocks.hasServerPermission.mockImplementation(
      (user: RequestPrincipal['user'], permission: string) =>
        Boolean(user.permissoes?.[permission as keyof NonNullable<typeof user.permissoes>]),
    )
  })

  it('ignores forged user and company identity and queries through the authenticated principal', async () => {
    const authenticated = principal({ ver_vouchers: true })
    mocks.requireRequestContext.mockReturnValue({ principal: authenticated })
    mocks.listVouchers.mockResolvedValue({
      total: 1,
      items: [{
        id: 'voucher-a',
        numero: '1025',
        localizador: 'ABC123',
        status: 'emitido',
        empresa_id: 'company-a',
        passageiro_nome: 'Pessoa autorizada',
      }],
    })

    const result = await executeAssistantTool(
      'getVoucherByCode',
      { code: 'ABC123' },
      {
        userId: 'forged-user',
        userName: 'Usuario forjado',
        userRole: 'master',
        companyId: 'company-b',
        channel: 'portal',
      },
    )

    expect(result.ok).toBe(true)
    expect(mocks.listVouchers).toHaveBeenCalledWith(
      authenticated,
      { search: 'ABC123', limit: 50 },
    )
    expect(mocks.createAssistantAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a',
        userName: 'Usuario autenticado',
        companyId: null,
      }),
    )
  })

  it('blocks financial data when the authenticated principal lacks the server permission', async () => {
    mocks.requireRequestContext.mockReturnValue({ principal: principal({ ver_financeiro: false }) })

    const result = await executeAssistantTool(
      'getFinancialSummary',
      { companyId: 'company-a' },
      {
        userId: 'forged-user',
        userRole: 'master',
        companyId: 'company-a',
        channel: 'portal',
      },
    )

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      error: 'Permissao insuficiente para esta consulta.',
    })
    expect(mocks.getFinancialOverview).not.toHaveBeenCalled()
  })
})

function principal(
  permissions: Partial<NonNullable<RequestPrincipal['user']['permissoes']>>,
): RequestPrincipal {
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: 'user-a',
      email: 'usuario@tenant.invalid',
      name: 'Usuario autenticado',
      role: 'company_admin',
      company_id: 'company-a',
      ativo: true,
      permissoes: permissions as RequestPrincipal['user']['permissoes'],
    },
  }
}

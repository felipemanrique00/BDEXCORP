import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { getAssistantSettings } from '@/lib/assistant/settings'
import { createAssistantAuditLog, createAssistantToolLog } from '@/lib/assistant/audit'
import { ASSISTANT_KEYS, appendAssistantList, getAssistantValue, setAssistantValue } from '@/lib/assistant/storage'
import { generateVoucherDocument } from '@/lib/assistant/pdf'
import { hasServerPermission } from '@/lib/security/api-guard'
import { getAccessibleCompanyIds } from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import { listRelationalDemands } from '@/lib/server/demand-service'
import { getFinancialOverview } from '@/lib/server/finance-service'
import { requireRequestContext, type RequestPrincipal } from '@/lib/server/request-context'
import { listGovernedTravelReservations } from '@/lib/server/travel-governance-service'
import { listVouchers } from '@/lib/server/voucher-service'
import type {
  AssistantToolDefinition,
  AssistantToolResult,
  AssistantToolRunContext,
  VoucherSendLog,
} from '@/lib/assistant/types'
import type { Permissoes, VoucherEmitido } from '@/types'

export const DEFAULT_ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  tool('getVoucherByCode', 'Localiza voucher por codigo, numero ou localizador.', 'read', 'vouchers', false, false),
  tool('getVoucherByCustomer', 'Busca vouchers pelo nome/documento do passageiro.', 'read', 'vouchers', true, false),
  tool('generateVoucherPDF', 'Gera documento HTML/PDF de voucher com mascara de dados sensiveis.', 'document', 'vouchers', true, true),
  tool('sendVoucherPDF', 'Envia um voucher persistido por um canal integrado.', 'message', 'whatsapp', true, true),
  tool('getDemandsByCustomer', 'Consulta demandas por cliente, passageiro ou empresa.', 'read', 'demandas', true, false),
  tool('getReservationDetails', 'Consulta reservas Tech Travel por OS, localizador ou identificador.', 'read', 'reservas', false, false),
  tool('searchHotels', 'Busca hoteis cadastrados por cidade, UF ou nome.', 'read', 'hoteis', false, false),
  tool('getFinancialSummary', 'Resumo financeiro controlado por permissao.', 'read', 'financeiro', true, false, ['ver_financeiro']),
  tool('transferToHuman', 'Abre handoff para atendimento humano.', 'handoff', 'atendimento', false, true),
  tool('createAuditLog', 'Registra auditoria manual da assistente.', 'write', 'auditoria', false, false),
  tool('getAvailableServices', 'Lista modulos e capacidades liberadas para a assistente.', 'read', 'configuracoes', false, false),
]

function tool(
  id: string,
  description: string,
  kind: AssistantToolDefinition['kind'],
  module: string,
  sensitive: boolean,
  requiresConfirmation: boolean,
  permissions: string[] = [],
): AssistantToolDefinition {
  return {
    id,
    name: id,
    description,
    kind,
    module,
    status: 'active',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions,
    channels: ['system', 'portal', 'test', 'whatsapp', 'voice'],
    sensitive,
    requiresConfirmation,
    whatsappEnabled: true,
    internalEnabled: true,
  }
}

export async function getAssistantTools(): Promise<AssistantToolDefinition[]> {
  const saved = await getAssistantValue<AssistantToolDefinition[] | null>(ASSISTANT_KEYS.tools, null)
  if (!saved) {
    await setAssistantValue(ASSISTANT_KEYS.tools, DEFAULT_ASSISTANT_TOOLS)
    return DEFAULT_ASSISTANT_TOOLS
  }
  const byId = new Map(saved.map((item) => [item.id, item]))
  const merged = DEFAULT_ASSISTANT_TOOLS.map((item) => ({ ...item, ...(byId.get(item.id) || {}) }))
  const extras = saved.filter((item) => !DEFAULT_ASSISTANT_TOOLS.some((base) => base.id === item.id))
  return [...merged, ...extras]
}

export async function updateAssistantTool(id: string, patch: Partial<AssistantToolDefinition>): Promise<AssistantToolDefinition | null> {
  const tools = await getAssistantTools()
  const index = tools.findIndex((item) => item.id === id)
  if (index < 0) return null
  tools[index] = { ...tools[index], ...patch, id }
  await setAssistantValue(ASSISTANT_KEYS.tools, tools)
  return tools[index]
}

export async function executeAssistantTool(
  toolId: string,
  input: unknown,
  context: AssistantToolRunContext,
): Promise<AssistantToolResult> {
  const started = Date.now()
  const principal = requireRequestContext().principal
  const authenticatedContext = authenticatedToolContext(principal, context)
  const tools = await getAssistantTools()
  const definition = tools.find((item) => item.id === toolId)
  if (!definition || definition.status !== 'active') {
    return finishTool(toolId, started, authenticatedContext, input, { ok: false, blocked: true, error: 'Ferramenta indisponivel.' })
  }

  const guard = await guardTool(definition, authenticatedContext, principal)
  if (guard) return finishTool(toolId, started, authenticatedContext, input, guard)
  if (definition.requiresConfirmation && !authenticatedContext.confirmed) {
    return finishTool(toolId, started, authenticatedContext, input, {
      ok: false,
      requiresConfirmation: true,
      error: 'Essa acao exige confirmacao humana.',
    })
  }

  try {
    switch (toolId) {
      case 'getVoucherByCode':
        return finishTool(toolId, started, authenticatedContext, input, await getVoucherByCode(input, principal))
      case 'getVoucherByCustomer':
        return finishTool(toolId, started, authenticatedContext, input, await getVoucherByCustomer(input, authenticatedContext, principal))
      case 'generateVoucherPDF':
        return finishTool(toolId, started, authenticatedContext, input, await generateVoucherPdfTool(input, authenticatedContext, principal))
      case 'sendVoucherPDF':
        return finishTool(toolId, started, authenticatedContext, input, await sendVoucherPdfTool(input, authenticatedContext))
      case 'getDemandsByCustomer':
        return finishTool(toolId, started, authenticatedContext, input, await getDemandsByCustomer(input, authenticatedContext, principal))
      case 'getReservationDetails':
        return finishTool(toolId, started, authenticatedContext, input, await getReservationDetails(input, principal))
      case 'searchHotels':
        return finishTool(toolId, started, authenticatedContext, input, await searchHotels(input, principal))
      case 'getFinancialSummary':
        return finishTool(toolId, started, authenticatedContext, input, await getFinancialSummary(input, authenticatedContext, principal))
      case 'transferToHuman':
        return finishTool(toolId, started, authenticatedContext, input, await transferToHuman(input, authenticatedContext))
      case 'createAuditLog':
        return finishTool(toolId, started, authenticatedContext, input, await createAuditLogTool(input, authenticatedContext))
      case 'getAvailableServices':
        return finishTool(toolId, started, authenticatedContext, input, await getAvailableServices())
      default:
        return finishTool(toolId, started, authenticatedContext, input, { ok: false, error: 'Ferramenta sem executor configurado.' })
    }
  } catch (error) {
    return finishTool(toolId, started, authenticatedContext, input, {
      ok: false,
      error: (error as Error)?.message || 'Falha ao executar ferramenta.',
    })
  }
}

async function guardTool(
  definition: AssistantToolDefinition,
  context: AssistantToolRunContext,
  principal: RequestPrincipal,
): Promise<AssistantToolResult | null> {
  const settings = await getAssistantSettings()
  if (!settings.permissions.allowedChannels.includes(context.channel)) {
    return { ok: false, blocked: true, error: 'Canal nao autorizado para a assistente.' }
  }
  if (!settings.permissions.allowedModules.includes(definition.module) && definition.module !== 'configuracoes') {
    return { ok: false, blocked: true, error: `Modulo ${definition.module} nao autorizado para a assistente.` }
  }
  if (definition.module === 'financeiro' && !settings.permissions.allowFinancialData) {
    return { ok: false, blocked: true, error: 'Dados financeiros bloqueados por configuracao.' }
  }
  if (definition.kind === 'document' && !settings.permissions.allowPdfGeneration) {
    return { ok: false, blocked: true, error: 'Geracao de documentos bloqueada por configuracao.' }
  }
  if (definition.kind === 'message' && !settings.permissions.allowWhatsAppSend) {
    return { ok: false, blocked: true, error: 'Envio de mensagens/arquivos bloqueado por configuracao.' }
  }
  const requiredPermission = permissionForAssistantModule(definition.module)
  if (requiredPermission && !hasServerPermission(principal.user, requiredPermission)) {
    return { ok: false, blocked: true, error: 'Permissao insuficiente para esta consulta.' }
  }
  return null
}

async function finishTool(
  toolId: string,
  started: number,
  context: AssistantToolRunContext,
  input: unknown,
  result: AssistantToolResult,
): Promise<AssistantToolResult> {
  const status = result.requiresConfirmation ? 'confirmation_required' : result.blocked ? 'blocked' : result.ok ? 'success' : 'error'
  const toolLog = await createAssistantToolLog({
    toolId,
    status,
    durationMs: Date.now() - started,
    userId: context.userId,
    companyId: context.companyId,
    channel: context.channel,
    conversationId: context.conversationId,
    inputSummary: summarize(input),
    outputSummary: summarize(result.data),
    error: result.error,
  })
  const audit = await createAssistantAuditLog({
    level: result.ok ? 'info' : result.blocked ? 'security' : 'warn',
    action: `assistant.tool.${toolId}`,
    module: 'assistant',
    userId: context.userId,
    userName: context.userName,
    companyId: context.companyId,
    channel: context.channel,
    conversationId: context.conversationId,
    toolId,
    inputSummary: toolLog.inputSummary,
    outputSummary: toolLog.outputSummary,
    error: result.error,
  })
  return { ...result, auditId: audit.id }
}

async function getVoucherByCode(
  input: unknown,
  principal: RequestPrincipal,
): Promise<AssistantToolResult> {
  const params = z.object({ code: z.string().min(1) }).parse(input)
  const vouchers = (await listVouchers(principal, {
    search: params.code,
    limit: 50,
  })).items
  const code = normalize(params.code)
  const found = vouchers.find((voucher) =>
    [voucher.id, voucher.numero, voucher.localizador, voucher.numero_confirmacao]
      .filter(Boolean)
      .some((value) => normalize(String(value)).includes(code)),
  )
  return found ? { ok: true, data: sanitizeVoucher(found) } : { ok: false, error: 'Voucher nao encontrado.' }
}

async function getVoucherByCustomer(
  input: unknown,
  context: AssistantToolRunContext,
  principal: RequestPrincipal,
): Promise<AssistantToolResult> {
  const params = z.object({ query: z.string().min(2), companyId: z.string().optional() }).parse(input)
  const result = await listVouchers(principal, {
    companyId: params.companyId || context.companyId || undefined,
    search: params.query,
    limit: 10,
  })
  return {
    ok: true,
    data: {
      total: result.total,
      vouchers: result.items.map(sanitizeVoucher),
    },
  }
}

async function generateVoucherPdfTool(
  input: unknown,
  context: AssistantToolRunContext,
  principal: RequestPrincipal,
): Promise<AssistantToolResult> {
  const params = z.object({ voucherId: z.string().min(1) }).parse(input)
  const vouchers = (await listVouchers(principal, {
    search: params.voucherId,
    limit: 50,
  })).items
  const normalizedId = normalize(params.voucherId)
  const voucher = vouchers.find((item) => (
    normalize(item.id) === normalizedId
    || normalize(item.numero) === normalizedId
  ))
  if (!voucher) return { ok: false, error: 'Voucher nao encontrado para gerar PDF.' }
  const document = await generateVoucherDocument(voucher, { createdBy: context.userId, protectSensitiveData: true })
  return { ok: true, data: document }
}

async function sendVoucherPdfTool(input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  const params = z.object({
    voucherId: z.string().min(1),
    documentId: z.string().optional(),
    recipientPhone: z.string().min(8),
    recipientName: z.string().optional(),
  }).parse(input)
  const error = 'Envio automatico bloqueado: o voucher precisa estar persistido como PDF e o adaptador do canal deve confirmar a entrega.'
  const log: VoucherSendLog = {
    id: `send-${randomUUID()}`,
    voucherId: params.voucherId,
    documentId: params.documentId,
    channel: context.channel,
    recipientPhone: params.recipientPhone,
    recipientName: params.recipientName,
    status: 'failed',
    error,
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.voucherSendLogs, log, 500)
  return { ok: false, error, data: log }
}

async function getDemandsByCustomer(
  input: unknown,
  context: AssistantToolRunContext,
  principal: RequestPrincipal,
): Promise<AssistantToolResult> {
  const params = z.object({ query: z.string().min(2).optional(), companyId: z.string().optional() }).parse(input)
  const result = await listRelationalDemands(principal, {
    companyId: params.companyId || context.companyId || undefined,
    search: params.query,
    limit: 20,
  })
  const matches = result.items
    .map((item) => ({
      id: item.id,
      serial_os: item.demandNumber,
      empresa: item.companyName,
      passageiro_nome: item.passengerName,
      tipo_servico: item.serviceType,
      status: item.operationalStatus,
      prioridade: item.priority,
      data_viagem: item.travelStartDate,
      valor_cotacao: item.estimatedAmount,
    }))
  return { ok: true, data: { total: result.total, demandas: matches } }
}

async function getReservationDetails(
  input: unknown,
  principal: RequestPrincipal,
): Promise<AssistantToolResult> {
  const params = z.object({ reservationId: z.string().min(1) }).parse(input)
  const reservations = (await listGovernedTravelReservations(principal, {
    search: params.reservationId,
    limit: 20,
  })).items
  const reference = normalize(params.reservationId)
  const found = reservations.find((item) => normalize([
    item.id,
    item.demandNumber,
    item.providerReference,
  ].filter(Boolean).join(' ')).includes(reference))
  return found ? { ok: true, data: found } : { ok: false, error: 'Reserva nao encontrada.' }
}

async function searchHotels(
  input: unknown,
  principal: RequestPrincipal,
): Promise<AssistantToolResult> {
  const params = z.object({ query: z.string().min(2), city: z.string().optional(), uf: z.string().optional() }).parse(input)
  const allowedReservationCompanies = principal.corporateAccess?.companies
    .filter((company) => company.permissions.ver_reservas)
    .map((company) => company.companyId) || []
  if (!allowedReservationCompanies.length) {
    return { ok: false, blocked: true, error: 'Permissao insuficiente para consultar hoteis.' }
  }
  const search = `%${[params.query, params.city, params.uf].filter(Boolean).join(' ').trim().slice(0, 200)}%`
  const matches = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{
      id: string
      name: string
      city: string | null
      state: string | null
      country: string
      category: string | null
      billing_enabled: boolean
      amenities: Record<string, unknown>
    }>(
      `select id, name, city, state, country, category, billing_enabled, amenities
       from hotels
       where tenant_id = $1
         and deleted_at is null
         and status = 'active'
         and concat_ws(' ', name, city, state, country) ilike $2
       order by name
       limit 20`,
      [principal.tenantId, search],
    )
    return result.rows.map((hotel) => ({
      id: hotel.id,
      nome: hotel.name,
      cidade: hotel.city,
      uf: hotel.state,
      pais: hotel.country,
      categoria: hotel.category,
      faturado: hotel.billing_enabled,
      comodidades: hotel.amenities,
    }))
  })
  return { ok: true, data: { total: matches.length, hoteis: matches } }
}

async function getFinancialSummary(
  input: unknown,
  context: AssistantToolRunContext,
  principal: RequestPrincipal,
): Promise<AssistantToolResult> {
  if (!hasServerPermission(principal.user, 'ver_financeiro')) {
    return { ok: false, blocked: true, error: 'Perfil sem permissao para resumo financeiro.' }
  }
  const params = z.object({ companyId: z.string().optional() }).parse(input || {})
  const overview = await getFinancialOverview(principal, {
    companyId: params.companyId || context.companyId || undefined,
  })
  return { ok: true, data: overview }
}

async function transferToHuman(input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  const params = z.object({ reason: z.string().min(1), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal') }).parse(input)
  const handoff = {
    id: `handoff-${randomUUID()}`,
    reason: params.reason,
    priority: params.priority,
    status: 'waiting_human',
    userId: context.userId,
    companyId: context.companyId,
    channel: context.channel,
    conversationId: context.conversationId,
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.humanHandoffs, handoff, 500)
  return { ok: true, data: handoff }
}

async function createAuditLogTool(input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  const params = z.object({ action: z.string().min(1), description: z.string().min(1) }).parse(input)
  const audit = await createAssistantAuditLog({
    level: 'info',
    action: params.action,
    module: 'assistant',
    userId: context.userId,
    userName: context.userName,
    companyId: context.companyId,
    channel: context.channel,
    conversationId: context.conversationId,
    inputSummary: params.description,
  })
  return { ok: true, data: audit }
}

async function getAvailableServices(): Promise<AssistantToolResult> {
  const settings = await getAssistantSettings()
  const tools = await getAssistantTools()
  return {
    ok: true,
    data: {
      active: settings.active,
      modules: settings.permissions.allowedModules,
      tools: tools.filter((item) => item.status === 'active').map((item) => ({ id: item.id, module: item.module, kind: item.kind })),
    },
  }
}

function sanitizeVoucher(voucher: VoucherEmitido): Partial<VoucherEmitido> {
  return {
    id: voucher.id,
    numero: voucher.numero,
    tipo: voucher.tipo,
    status: voucher.status,
    empresa_id: voucher.empresa_id,
    passageiro_nome: voucher.passageiro_nome,
    fornecedor_nome: voucher.fornecedor_nome,
    fornecedor_cidade: voucher.fornecedor_cidade,
    data_checkin: voucher.data_checkin,
    data_checkout: voucher.data_checkout,
    data_ida: voucher.data_ida,
    data_volta: voucher.data_volta,
    localizador: voucher.localizador,
    numero_confirmacao: voucher.numero_confirmacao,
    total: voucher.total,
    created_at: voucher.created_at,
  }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function summarize(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 300 ? `${text.slice(0, 300)}...` : text
}

function authenticatedToolContext(
  principal: RequestPrincipal,
  context: AssistantToolRunContext,
): AssistantToolRunContext {
  const accessibleCompanyIds = new Set(getAccessibleCompanyIds(principal))
  const requestedCompanyId = context.companyId || principal.user.company_id || null
  return {
    ...context,
    userId: principal.user.id,
    userName: principal.user.name,
    userRole: principal.roleKey,
    companyId: requestedCompanyId && accessibleCompanyIds.has(requestedCompanyId)
      ? requestedCompanyId
      : null,
  }
}

function permissionForAssistantModule(module: string): keyof Permissoes | null {
  return {
    vouchers: 'ver_vouchers',
    demandas: 'ver_demandas',
    reservas: 'ver_reservas',
    hoteis: 'ver_reservas',
    financeiro: 'ver_financeiro',
  }[module] as keyof Permissoes | undefined || null
}

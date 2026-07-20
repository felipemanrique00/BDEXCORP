import { z } from 'zod'

import { getAssistantSettings } from '@/lib/assistant/settings'
import { createAssistantAuditLog, createAssistantToolLog } from '@/lib/assistant/audit'
import { ASSISTANT_KEYS, appendAssistantList, getAssistantValue, getRawAppKv, setAssistantValue } from '@/lib/assistant/storage'
import { generateVoucherDocument } from '@/lib/assistant/pdf'
import type {
  AssistantToolDefinition,
  AssistantToolResult,
  AssistantToolRunContext,
  VoucherSendLog,
} from '@/lib/assistant/types'
import type { Atendimento, Empresa, Funcionario, Hotel, VoucherEmitido } from '@/types'

const STORAGE_DATA = 'bbt-data-v4'
const STORAGE_ATENDIMENTOS = 'bbt-atendimentos'
const STORAGE_VOUCHERS = 'bbt-vouchers-emitidos'
const STORAGE_TECH_RESERVATIONS = 'bbt-tech-travel-reservations-v1'
const STORAGE_FINANCEIRO = 'bbt-financeiro'

export const DEFAULT_ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  tool('getVoucherByCode', 'Localiza voucher por codigo, numero ou localizador.', 'read', 'vouchers', false, false),
  tool('getVoucherByCustomer', 'Busca vouchers pelo nome/documento do passageiro.', 'read', 'vouchers', true, false),
  tool('generateVoucherPDF', 'Gera documento HTML/PDF de voucher com mascara de dados sensiveis.', 'document', 'vouchers', true, true),
  tool('sendVoucherPDF', 'Registra envio de voucher por WhatsApp ou canal interno.', 'message', 'whatsapp', true, true),
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
  const tools = await getAssistantTools()
  const definition = tools.find((item) => item.id === toolId)
  if (!definition || definition.status !== 'active') {
    return finishTool(toolId, started, context, input, { ok: false, blocked: true, error: 'Ferramenta indisponivel.' })
  }

  const guard = await guardTool(definition, context)
  if (guard) return finishTool(toolId, started, context, input, guard)
  if (definition.requiresConfirmation && !context.confirmed) {
    return finishTool(toolId, started, context, input, {
      ok: false,
      requiresConfirmation: true,
      error: 'Essa acao exige confirmacao humana.',
    })
  }

  try {
    switch (toolId) {
      case 'getVoucherByCode':
        return finishTool(toolId, started, context, input, await getVoucherByCode(input))
      case 'getVoucherByCustomer':
        return finishTool(toolId, started, context, input, await getVoucherByCustomer(input, context))
      case 'generateVoucherPDF':
        return finishTool(toolId, started, context, input, await generateVoucherPdfTool(input, context))
      case 'sendVoucherPDF':
        return finishTool(toolId, started, context, input, await sendVoucherPdfTool(input, context))
      case 'getDemandsByCustomer':
        return finishTool(toolId, started, context, input, await getDemandsByCustomer(input, context))
      case 'getReservationDetails':
        return finishTool(toolId, started, context, input, await getReservationDetails(input))
      case 'searchHotels':
        return finishTool(toolId, started, context, input, await searchHotels(input))
      case 'getFinancialSummary':
        return finishTool(toolId, started, context, input, await getFinancialSummary(input, context))
      case 'transferToHuman':
        return finishTool(toolId, started, context, input, await transferToHuman(input, context))
      case 'createAuditLog':
        return finishTool(toolId, started, context, input, await createAuditLogTool(input, context))
      case 'getAvailableServices':
        return finishTool(toolId, started, context, input, await getAvailableServices())
      default:
        return finishTool(toolId, started, context, input, { ok: false, error: 'Ferramenta sem executor configurado.' })
    }
  } catch (error) {
    return finishTool(toolId, started, context, input, {
      ok: false,
      error: (error as Error)?.message || 'Falha ao executar ferramenta.',
    })
  }
}

async function guardTool(
  definition: AssistantToolDefinition,
  context: AssistantToolRunContext,
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

async function getVoucherByCode(input: unknown): Promise<AssistantToolResult> {
  const params = z.object({ code: z.string().min(1) }).parse(input)
  const vouchers = await getRawAppKv<VoucherEmitido[]>(STORAGE_VOUCHERS, [])
  const code = normalize(params.code)
  const found = vouchers.find((voucher) =>
    [voucher.id, voucher.numero, voucher.localizador, voucher.numero_confirmacao]
      .filter(Boolean)
      .some((value) => normalize(String(value)).includes(code)),
  )
  return found ? { ok: true, data: sanitizeVoucher(found) } : { ok: false, error: 'Voucher nao encontrado.' }
}

async function getVoucherByCustomer(input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  const params = z.object({ query: z.string().min(2), companyId: z.string().optional() }).parse(input)
  const vouchers = await getRawAppKv<VoucherEmitido[]>(STORAGE_VOUCHERS, [])
  const query = normalize(params.query)
  const companyId = context.companyId || params.companyId
  const matches = vouchers
    .filter((voucher) => !companyId || voucher.empresa_id === companyId)
    .filter((voucher) =>
      normalize([
        voucher.passageiro_nome,
        ...(voucher.passageiros || []),
        voucher.cpf,
        voucher.id,
        voucher.numero,
        voucher.localizador,
        voucher.numero_confirmacao,
      ].filter(Boolean).join(' ')).includes(query),
    )
    .slice(0, 10)
    .map(sanitizeVoucher)
  return { ok: true, data: { total: matches.length, vouchers: matches } }
}

async function generateVoucherPdfTool(input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  const params = z.object({ voucherId: z.string().min(1) }).parse(input)
  const vouchers = await getRawAppKv<VoucherEmitido[]>(STORAGE_VOUCHERS, [])
  const voucher = vouchers.find((item) => item.id === params.voucherId || item.numero === params.voucherId)
  if (!voucher) return { ok: false, error: 'Voucher nao encontrado para gerar PDF.' }
  const document = await generateVoucherDocument(voucher, { createdBy: context.userId, protectSensitiveData: true })
  return { ok: true, data: document }
}

async function sendVoucherPdfTool(input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  const params = z.object({
    voucherId: z.string().min(1),
    documentId: z.string().optional(),
    recipientPhone: z.string().optional(),
    recipientName: z.string().optional(),
  }).parse(input)
  const log: VoucherSendLog = {
    id: `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    voucherId: params.voucherId,
    documentId: params.documentId,
    channel: context.channel,
    recipientPhone: params.recipientPhone,
    recipientName: params.recipientName,
    status: context.channel === 'whatsapp' ? 'queued' : 'sent',
    createdAt: new Date().toISOString(),
  }
  await appendAssistantList(ASSISTANT_KEYS.voucherSendLogs, log, 500)
  return { ok: true, data: log }
}

async function getDemandsByCustomer(input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  const params = z.object({ query: z.string().min(2).optional(), companyId: z.string().optional() }).parse(input)
  const demands = await getRawAppKv<Atendimento[]>(STORAGE_ATENDIMENTOS, [])
  const companyId = context.companyId || params.companyId
  const query = normalize(params.query || '')
  const matches = demands
    .filter((item) => !companyId || item.empresa_id === companyId)
    .filter((item) => !query || normalize([item.id, item.passageiro_nome, item.solicitante_nome, item.numero_solicitacao].filter(Boolean).join(' ')).includes(query))
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      passageiro_nome: item.passageiro_nome,
      tipo_servico: item.tipo_servico,
      status: item.status,
      prioridade: item.prioridade,
      data_atendimento: item.data_atendimento,
      valor_cotacao: item.valor_cotacao,
    }))
  return { ok: true, data: { total: matches.length, demandas: matches } }
}

async function getReservationDetails(input: unknown): Promise<AssistantToolResult> {
  const params = z.object({ reservationId: z.string().min(1) }).parse(input)
  const reservations = await getRawAppKv<Array<Record<string, unknown>>>(STORAGE_TECH_RESERVATIONS, [])
  const found = reservations.find((item) =>
    normalize([item.id, item.idOs, item.localizador, item.sistema, item.reservationId, item.codigo].filter(Boolean).join(' ')).includes(
      normalize(params.reservationId),
    ),
  )
  return found ? { ok: true, data: found } : { ok: false, error: 'Reserva nao encontrada.' }
}

async function searchHotels(input: unknown): Promise<AssistantToolResult> {
  const params = z.object({ query: z.string().min(2), city: z.string().optional(), uf: z.string().optional() }).parse(input)
  const data = await getRawAppKv<{ empresas?: Empresa[]; funcionarios?: Funcionario[]; hoteis?: Hotel[] }>(STORAGE_DATA, {})
  const hotels = Array.isArray(data.hoteis) ? data.hoteis : []
  const q = normalize([params.query, params.city, params.uf].filter(Boolean).join(' '))
  const matches = hotels
    .filter((hotel) => normalize([hotel.nome, hotel.cidade, hotel.uf].filter(Boolean).join(' ')).includes(q))
    .slice(0, 20)
  return { ok: true, data: { total: matches.length, hoteis: matches } }
}

async function getFinancialSummary(_input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  if (!context.userRole || !['master', 'admin_bbt', 'financeiro', 'lider'].includes(context.userRole)) {
    return { ok: false, blocked: true, error: 'Perfil sem permissao para resumo financeiro.' }
  }
  const financeiro = await getRawAppKv<unknown>(STORAGE_FINANCEIRO, null)
  return { ok: true, data: summarizeFinanceiro(financeiro) }
}

async function transferToHuman(input: unknown, context: AssistantToolRunContext): Promise<AssistantToolResult> {
  const params = z.object({ reason: z.string().min(1), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal') }).parse(input)
  const handoff = {
    id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

function summarizeFinanceiro(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return { configured: false, message: 'Sem dados financeiros consolidados.' }
  if (Array.isArray(value)) return { configured: true, totalRegistros: value.length }
  return { configured: true, keys: Object.keys(value as Record<string, unknown>).slice(0, 20) }
}

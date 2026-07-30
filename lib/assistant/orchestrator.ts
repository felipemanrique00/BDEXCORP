import { getAssistantSettings } from '@/lib/assistant/settings'
import { createAssistantAuditLog } from '@/lib/assistant/audit'
import { inspectPromptSafety } from '@/lib/assistant/prompt-injection-guard'
import { executeAssistantTool } from '@/lib/assistant/tools'
import { ASSISTANT_KEYS, createId, getAssistantValue, setAssistantValue } from '@/lib/assistant/storage'
import type {
  AssistantChannel,
  AssistantConversation,
  AssistantConversationMessage,
  AssistantToolRunContext,
} from '@/lib/assistant/types'
import type { User } from '@/types'

interface ConversationState {
  conversations: AssistantConversation[]
  messages: AssistantConversationMessage[]
}

export interface AssistantProcessInput {
  text: string
  channel: AssistantChannel
  user?: User | null
  conversationId?: string
  participantPhone?: string
  participantName?: string
  confirmed?: boolean
}

export interface AssistantProcessResult {
  ok: boolean
  conversationId: string
  response: string
  responseMode: 'text' | 'audio'
  toolsCalled: Array<{ id: string; ok: boolean; error?: string; requiresConfirmation?: boolean }>
  blocked?: boolean
}

export async function processAssistantMessage(input: AssistantProcessInput): Promise<AssistantProcessResult> {
  const settings = await getAssistantSettings()
  const conversation = await upsertConversation(input)
  const context: AssistantToolRunContext = {
    userId: input.user?.id,
    userName: input.user?.name,
    userRole: input.user?.perfil_bbt || input.user?.role,
    companyId: input.user?.company_id,
    channel: input.channel,
    conversationId: conversation.id,
    confirmed: input.confirmed,
  }

  await appendMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    role: 'user',
    type: 'text',
    content: input.text,
    sensitive: false,
  })

  const safety = await inspectPromptSafety(input.text, {
    channel: input.channel,
    userId: input.user?.id,
    companyId: input.user?.company_id,
    conversationId: conversation.id,
  })
  if (safety.blocked) {
    const response = 'Nao posso executar esse pedido por politica de seguranca. Registrei o evento para auditoria.'
    await appendAssistantResponse(conversation.id, response)
    await createAssistantAuditLog({
      level: 'security',
      action: 'assistant.prompt_blocked',
      module: 'assistant',
      userId: input.user?.id,
      userName: input.user?.name,
      companyId: input.user?.company_id,
      channel: input.channel,
      conversationId: conversation.id,
      inputSummary: input.text.slice(0, 300),
      outputSummary: response,
    })
    return { ok: false, conversationId: conversation.id, response, responseMode: 'text', toolsCalled: [], blocked: true }
  }

  const intent = detectIntent(input.text)
  const toolsCalled: AssistantProcessResult['toolsCalled'] = []
  let response = ''

  if (intent === 'voucher') {
    const query = extractVoucherQuery(input.text)
    const lookup = await executeAssistantTool(query.code ? 'getVoucherByCode' : 'getVoucherByCustomer', query.code ? { code: query.code } : { query: query.query }, context)
    toolsCalled.push({ id: query.code ? 'getVoucherByCode' : 'getVoucherByCustomer', ok: lookup.ok, error: lookup.error })

    if (!lookup.ok || !lookup.data) {
      response = 'Nao localizei um voucher com esses dados. Envie codigo, localizador, CPF ou nome do passageiro para eu validar com seguranca.'
    } else if (wantsPdf(input.text)) {
      const voucherId = getFirstVoucherId(lookup.data)
      if (!voucherId) {
        response = 'Encontrei mais de um resultado. Informe o codigo exato do voucher para eu gerar o PDF correto.'
      } else {
        const doc = await executeAssistantTool('generateVoucherPDF', { voucherId }, context)
        toolsCalled.push({ id: 'generateVoucherPDF', ok: doc.ok, error: doc.error, requiresConfirmation: doc.requiresConfirmation })
        response = doc.ok
          ? `Gerei o documento do voucher ${voucherId}. O envio automatico por WhatsApp exige permissao e confirmacao no painel.`
          : doc.error || settings.errorMessage
      }
    } else {
      response = formatVoucherLookupResponse(lookup.data)
    }
  } else if (intent === 'hotel') {
    const query = input.text.replace(/hotel|hoteis|hot[eé]is/gi, '').trim() || input.text
    const result = await executeAssistantTool('searchHotels', { query }, context)
    toolsCalled.push({ id: 'searchHotels', ok: result.ok, error: result.error })
    response = result.ok ? formatHotelResponse(result.data) : result.error || settings.errorMessage
  } else if (intent === 'demanda') {
    const result = await executeAssistantTool('getDemandsByCustomer', { query: cleanQuery(input.text) }, context)
    toolsCalled.push({ id: 'getDemandsByCustomer', ok: result.ok, error: result.error })
    response = result.ok ? formatDemandResponse(result.data) : result.error || settings.errorMessage
  } else if (intent === 'financeiro') {
    const result = await executeAssistantTool('getFinancialSummary', {}, context)
    toolsCalled.push({ id: 'getFinancialSummary', ok: result.ok, error: result.error, requiresConfirmation: result.requiresConfirmation })
    response = result.ok ? formatFinancialResponse(result.data) : result.error || settings.unknownMessage
  } else if (intent === 'human') {
    const result = await executeAssistantTool(
      'transferToHuman',
      { reason: input.text, priority: 'normal' },
      { ...context, confirmed: input.confirmed === true },
    )
    toolsCalled.push({ id: 'transferToHuman', ok: result.ok, error: result.error, requiresConfirmation: result.requiresConfirmation })
    response = result.ok ? settings.humanHandoffMessage : result.error || settings.errorMessage
  } else {
    response = formatGeneralAssistantResponse(settings.initialMessage)
  }

  const responseMode = wantsAudio(input.text, settings.voice.responseMode) ? 'audio' : 'text'
  await appendAssistantResponse(conversation.id, response)
  return { ok: true, conversationId: conversation.id, response, responseMode, toolsCalled }
}

export async function getAssistantConversationState(): Promise<ConversationState> {
  return getAssistantValue<ConversationState>(ASSISTANT_KEYS.conversations, { conversations: [], messages: [] })
}

async function upsertConversation(input: AssistantProcessInput): Promise<AssistantConversation> {
  const state = await getAssistantConversationState()
  const now = new Date().toISOString()
  const existing = input.conversationId ? state.conversations.find((item) => item.id === input.conversationId) : undefined
  if (existing) {
    existing.lastMessageAt = now
    existing.updatedAt = now
    await setAssistantValue(ASSISTANT_KEYS.conversations, state)
    return existing
  }
  const created: AssistantConversation = {
    id: createId('conv'),
    channel: input.channel,
    status: 'open',
    participantName: input.participantName || input.user?.name,
    participantPhone: input.participantPhone,
    companyId: input.user?.company_id,
    tags: [],
    priority: 'normal',
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  }
  state.conversations = [created, ...state.conversations].slice(0, 500)
  await setAssistantValue(ASSISTANT_KEYS.conversations, state)
  return created
}

async function appendMessage(message: Omit<AssistantConversationMessage, 'id' | 'createdAt'>): Promise<void> {
  const state = await getAssistantConversationState()
  state.messages = [{ ...message, id: createId('msg'), createdAt: new Date().toISOString() }, ...state.messages].slice(0, 2000)
  await setAssistantValue(ASSISTANT_KEYS.conversations, state)
}

async function appendAssistantResponse(conversationId: string, content: string): Promise<void> {
  await appendMessage({
    conversationId,
    direction: 'outbound',
    role: 'assistant',
    type: 'text',
    content,
    sensitive: false,
  })
}

function detectIntent(text: string): 'voucher' | 'hotel' | 'demanda' | 'financeiro' | 'human' | 'general' {
  const value = normalize(text)
  if (/humano|atendente|consultor|pessoa|falar com/.test(value)) return 'human'
  if (/voucher|pdf|comprovante|localizador/.test(value)) return 'voucher'
  if (/demanda|pedido|solicitacao|sla/.test(value)) return 'demanda'
  if (/hotel|hoteis|hospedagem|cidade/.test(value)) return 'hotel'
  if (/financeiro|pagamento|fatura|cobranca|pendente|receber|pagar/.test(value)) return 'financeiro'
  return 'general'
}

function extractVoucherQuery(text: string): { code?: string; query: string } {
  const codeMatch = text.match(/\b([HACP]-?\d{3,}|[A-Z0-9]{5,})\b/i)
  return { code: codeMatch?.[1], query: cleanQuery(text) || text }
}

function cleanQuery(text: string): string {
  return text
    .replace(/voucher|pdf|comprovante|localize|enviar|envie|mande|demanda|pedido|sla/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function wantsPdf(text: string): boolean {
  return /pdf|comprovante|documento|envie|mande|enviar/.test(normalize(text))
}

function wantsAudio(text: string, mode: 'text' | 'audio' | 'auto'): boolean {
  if (mode === 'audio') return true
  if (mode === 'text') return false
  return /audio|voz|leia|fale|responda por audio/.test(normalize(text))
}

function getFirstVoucherId(data: unknown): string | null {
  const anyData = data as any
  if (anyData?.id) return String(anyData.id)
  if (Array.isArray(anyData?.vouchers) && anyData.vouchers.length === 1) return String(anyData.vouchers[0].id)
  return null
}

function formatVoucherLookupResponse(data: unknown): string {
  const anyData = data as any
  if (anyData?.id) return `Encontrei o voucher ${anyData.id} para ${anyData.passageiro_nome || 'passageiro informado'} com status ${anyData.status}.`
  const total = anyData?.total || 0
  const vouchers = Array.isArray(anyData?.vouchers) ? anyData.vouchers.slice(0, 5) : []
  if (!total) return 'Nao encontrei voucher com os dados informados.'
  return `Encontrei ${total} voucher(s): ${vouchers.map((item: any) => `${item.id} - ${item.passageiro_nome}`).join('; ')}. Informe o codigo exato para gerar/enviar o PDF.`
}

function formatHotelResponse(data: unknown): string {
  const anyData = data as any
  const hotels = Array.isArray(anyData?.hoteis) ? anyData.hoteis.slice(0, 5) : []
  if (!hotels.length) return 'Nao encontrei hoteis cadastrados para essa busca.'
  return `Encontrei ${anyData.total} hotel(is): ${hotels.map((hotel: any) => `${hotel.nome} (${hotel.cidade}/${hotel.uf})`).join('; ')}.`
}

function formatDemandResponse(data: unknown): string {
  const anyData = data as any
  const demands = Array.isArray(anyData?.demandas) ? anyData.demandas.slice(0, 5) : []
  if (!demands.length) return 'Nao encontrei demandas com esses dados.'
  return `Encontrei ${anyData.total} demanda(s): ${demands.map((item: any) => `${item.id} - ${item.status} - ${item.passageiro_nome}`).join('; ')}.`
}

function formatFinancialResponse(data: unknown): string {
  const value = data as any
  const totalReceber = Number(value?.totalReceber ?? value?.receber ?? value?.aReceber ?? 0)
  const totalPagar = Number(value?.totalPagar ?? value?.pagar ?? value?.aPagar ?? 0)
  const saldo = Number(value?.saldo ?? totalReceber - totalPagar)
  const itensPendentes = Number(value?.pendentes ?? value?.itensPendentes ?? value?.contasPendentes ?? 0)
  const vencidas = Number(value?.vencidas ?? value?.contasVencidas ?? 0)
  const partes = [
    'Resumo financeiro consultado com permissao.',
    `A receber: ${money(totalReceber)}.`,
    `A pagar: ${money(totalPagar)}.`,
    `Saldo previsto: ${money(saldo)}.`,
  ]
  if (itensPendentes) partes.push(`Pendencias abertas: ${itensPendentes}.`)
  if (vencidas) partes.push(`Atencao: ${vencidas} vencida(s).`)
  partes.push('Para conferir lancamentos e faturas, abra o modulo Financeiro.')
  return partes.join('\n')
}

function formatGeneralAssistantResponse(initialMessage: string): string {
  return [
    initialMessage || 'Sou a IA BIA do BBT Corporativo.',
    '',
    'Posso ajudar em operacoes reais do sistema:',
    '- Localizar voucher, demanda, funcionario, empresa, hotel e fornecedor.',
    '- Preparar demanda, cotacao, voucher, reserva assistida e relatorio.',
    '- Resumir financeiro, alertas, fila, produtividade e pendencias.',
    '- Encaminhar para humano quando a acao exigir confirmacao.',
    '',
    'Me envie o pedido com nome, empresa, destino ou data quando tiver. Exemplo: "localize o voucher do Pedro para Brasilia dia 15/08".',
  ].join('\n')
}

function money(value: number): string {
  if (!Number.isFinite(value)) return 'R$ 0,00'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

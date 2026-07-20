export type AIErrorKind =
  | 'quota'
  | 'auth'
  | 'not_configured'
  | 'rate_limit'
  | 'network'
  | 'blocked'
  | 'provider'

export interface FriendlyAIError {
  kind: AIErrorKind
  message: string
  technicalMessage: string
  provider?: string
  status?: number
}

function readMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  const anyError = error as any
  return String(
    anyError.message ||
      anyError.error ||
      anyError.detail?.error?.message ||
      anyError.detail?.message ||
      anyError.detail ||
      '',
  )
}

export function classifyAIError(error: unknown, provider = 'ia'): FriendlyAIError {
  const technicalMessage = readMessage(error)
  const lower = technicalMessage.toLowerCase()
  const status = Number((error as any)?.status || (error as any)?.statusCode || 0) || undefined

  if (
    status === 429 ||
    /quota|billing|insufficient_quota|exceeded|limite|rate-limit|rate limit/.test(lower)
  ) {
    return {
      kind: /rate/.test(lower) ? 'rate_limit' : 'quota',
      provider,
      status,
      technicalMessage,
      message:
        'A IA premium atingiu o limite da chave configurada agora. Vou continuar usando os dados internos do sistema; para busca web, imagem, audio e respostas abertas, revise o plano/billing da chave de IA.',
    }
  }

  if (status === 401 || status === 403 || /invalid api key|api_key|unauthorized|forbidden|permission|permiss/.test(lower)) {
    return {
      kind: 'auth',
      provider,
      status,
      technicalMessage,
      message:
        'A chave da IA nao foi aceita pelo provedor. O sistema continua em modo interno, mas a IA completa precisa de uma chave valida nas configuracoes do servidor.',
    }
  }

  if (
    status === 503 ||
    /openai_api_key_necessaria|gemini_api_key_necessaria|ia_nao_configurada|api key necessaria|nao configurada|não configurada/.test(lower)
  ) {
    return {
      kind: 'not_configured',
      provider,
      status,
      technicalMessage,
      message:
        'A IA premium ainda nao esta conectada neste ambiente. Posso consultar os dados internos e orientar o fluxo; recursos generativos, internet, imagem e audio dependem das chaves no servidor.',
    }
  }

  if (/network|fetch failed|failed to fetch|timeout|econn|socket|dns/.test(lower)) {
    return {
      kind: 'network',
      provider,
      status,
      technicalMessage,
      message:
        'Nao consegui falar com o provedor de IA neste momento. Vou responder com a base interna do sistema e voce pode tentar novamente em alguns segundos.',
    }
  }

  if (/blocked|safety|policy|seguranca|segurança/.test(lower)) {
    return {
      kind: 'blocked',
      provider,
      status,
      technicalMessage,
      message:
        'Nao posso executar esse pedido do jeito que foi enviado. Posso ajudar se voce reformular com uma acao operacional clara e dados permitidos.',
    }
  }

  return {
    kind: 'provider',
    provider,
    status,
    technicalMessage,
    message:
      'Nao consegui concluir com o modelo externo agora. Vou seguir em modo interno com os dados do sistema e manter a operacao funcionando.',
  }
}

export function aiErrorUserMessage(error: unknown, provider = 'ia'): string {
  return classifyAIError(error, provider).message
}

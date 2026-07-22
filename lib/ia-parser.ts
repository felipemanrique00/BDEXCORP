// ============================================================
// V12: IA Parser premium — roteia GPT-5.2 como cérebro e Gemini para busca Google.
// O front não precisa saber qual provedor está rodando: o /api/ia normaliza a resposta.
// ============================================================
'use client'

import { parseMensagem, type MensagemParsed } from './mensagem-parser'
import { aiErrorUserMessage } from './ai-friendly-errors'

export interface IAParserResult extends MensagemParsed {
  ia_usado: boolean
  ia_confianca?: 'alta' | 'media' | 'baixa'
  ia_resumo?: string
  ia_erro?: string
  ia_indisponivel?: boolean
  provedor?: ProvedorIA
}

export type ProvedorIA = 'openai' | 'gemini' | 'local'

export interface StatusIA {
  provedor: ProvedorIA
  modelo: string
  aceita_imagem: boolean
  aceita_audio?: boolean
  busca_web?: boolean
  modelo_pro?: string
  roteamento?: {
    cerebro: 'openai' | 'local'
    busca_hoteis: 'gemini' | 'openai' | 'local'
    audio: 'openai' | 'gemini' | 'local'
  }
}

const SYSTEM_PROMPT = `Você é o assistente de IA da BBT Agência de Viagens Corporativa (Trindade-GO).
Sua função é extrair dados de reservas de viagens corporativas de mensagens de WhatsApp, e-mails, prints e transcrições de áudio.

Retorne APENAS um JSON válido (sem markdown, sem explicações) com estes campos (use null quando não souber):
{
  "tipo_servico": "Hotel" | "Aéreo" | "Carro" | "Pacote",
  "passageiro_nome": string | null,
  "passageiros_lista": string[] | null,
  "empresa_nome": string | null,
  "empresa_faturar": string | null,
  "centro_custo": string | null,
  "solicitante_nome": string | null,
  "solicitante_email": string | null,
  "cpf": string | null,
  "telefone": string | null,
  "hotel_nome": string | null,
  "tipo_quarto": "SGL" | "DBL" | "TPL" | null,
  "valor_diaria": number | null,
  "cafe_manha": boolean | null,
  "cidade_destino": string | null,
  "cidade_origem": string | null,
  "data_checkin": "YYYY-MM-DD" | null,
  "data_checkout": "YYYY-MM-DD" | null,
  "data_ida": "YYYY-MM-DD" | null,
  "data_volta": "YYYY-MM-DD" | null,
  "num_hospedes": number | null,
  "urgente": boolean,
  "ia_confianca": "alta" | "media" | "baixa",
  "ia_resumo": "Resumo de 1 frase do que entendeu"
}

Regras:
- Datas SEMPRE em formato ISO (YYYY-MM-DD)
- Se mês sem ano, use ano atual ou próximo se a data já passou
- ia_confianca: "alta" se passageiro+datas+destino, "media" se faltar 1, "baixa" se incompleto
- Se passageiros_lista tem valores, use o primeiro como passageiro_nome
- Se vier somente um nome de pessoa, trate como passageiro_nome com ia_confianca "baixa"
- "PAX" pode ser quantidade ou nome do passageiro; se nao for numero, extraia como passageiro
- E-mails do Outlook podem vir em tabela; relacione cabecalhos e valores mesmo quando estiverem em linhas/colunas separadas
- NUNCA invente dados que não estejam na mensagem`

let _statusCache: StatusIA | null = null
let _statusCacheAt = 0
let _statusRequest: Promise<StatusIA> | null = null

export async function getStatusIA(forceRefresh = false): Promise<StatusIA> {
  const agora = Date.now()
  if (!forceRefresh && _statusCache && agora - _statusCacheAt < 60_000) {
    return _statusCache
  }
  if (_statusRequest) return _statusRequest

  _statusRequest = (async () => {
    try {
      const r = await fetch('/api/ia', { method: 'GET' })
      if (r.ok) {
        const data = await r.json()
        _statusCache = data
        _statusCacheAt = Date.now()
        return data
      }
    } catch (error) {
      console.warn('[ia-parser] Nao foi possivel consultar o provedor configurado.', {
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
    _statusCache = {
      provedor: 'local',
      modelo: 'regras-locais',
      aceita_imagem: false,
      aceita_audio: false,
      busca_web: false,
    }
    _statusCacheAt = Date.now()
    return _statusCache
  })().finally(() => {
    _statusRequest = null
  })

  return _statusRequest
}

export async function iaConfigurada(): Promise<boolean> {
  const s = await getStatusIA(true)
  return s.provedor !== 'local'
}

async function callIA(body: any): Promise<any> {
  const r = await fetch('/api/ia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    const msg = err.error || `HTTP ${r.status}`
    const e: any = new Error(msg)
    e.indisponivel = r.status === 503 || err.code === 'not_configured' || msg === 'IA_NAO_CONFIGURADA'
    e.provedor = err.provedor || 'local'
    e.code = err.code
    e.status = r.status
    e.technical = err.technical
    throw e
  }
  return r.json()
}

export async function parseMensagemComIA(texto: string): Promise<IAParserResult> {
  if (!texto || texto.trim().length < 5) {
    return { ia_usado: false, ia_erro: 'Texto muito curto' }
  }

  try {
    const anoAtual = new Date().getFullYear()
    const data = await callIA({
      model: 'gpt-5.2',
      task: 'extract',
      max_tokens: 1000,
      enable_search: false,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Extraia os dados desta mensagem de reserva corporativa:\n\n---\n${texto.slice(0, 4000)}\n---\n\nAno de referência: ${anoAtual}`,
        },
      ],
    })

    const rawText = data.content?.find((b: any) => b.type === 'text')?.text || ''
    const jsonStr = extrairJSON(rawText)
    const parsed = JSON.parse(jsonStr)

    return {
      ...parsed,
      ia_usado: true,
      provedor: data.provedor,
      modo: 'estruturado',
      fontes: Object.fromEntries(
        Object.entries(parsed)
          .filter(
            ([k, v]) =>
              v !== null &&
              v !== undefined &&
              !['ia_confianca', 'ia_resumo', 'urgente', 'modo'].includes(k),
          )
          .map(([k]) => [k, 'label' as const]),
      ),
    }
  } catch (e: any) {
    console.error('[IA Parser]', e)
    const local = parseMensagem(texto)
    return {
      ...local,
      ia_usado: false,
      ia_indisponivel: !!e.indisponivel,
      ia_erro: aiErrorUserMessage(e, e.provedor || 'ia'),
      ia_resumo: local.passageiro_nome
        ? `Modo local: identifiquei uma solicitação para ${local.passageiro_nome}.`
        : 'Modo local: leitura por regras, revise os campos antes de criar a demanda.',
    }
  }
}

export async function parseMensagemComIAEImagem(
  texto: string,
  imagemBase64?: string,
  imagemMime?: string,
): Promise<IAParserResult> {
  if (!imagemBase64 && !texto) return { ia_usado: false }

  // Imagem funciona com OpenAI GPT-5.2 ou Gemini.
  const status = await getStatusIA()
  if (imagemBase64 && !status.aceita_imagem) {
    return {
      ia_usado: false,
      ia_indisponivel: true,
      ia_erro: 'Leitura de imagem requer OPENAI_API_KEY ou GEMINI_API_KEY configurada.',
    }
  }

  try {
    const content: any[] = []

    if (imagemBase64 && imagemMime) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: imagemMime, data: imagemBase64 },
      })
      content.push({
        type: 'text',
        text: `Extraia os dados desta imagem de email/print de reserva corporativa.${
          texto ? `\n\nTexto adicional: ${texto}` : ''
        }\n\nAno: ${new Date().getFullYear()}`,
      })
    } else {
      content.push({
        type: 'text',
        text: `Extraia os dados:\n\n${texto.slice(0, 4000)}\n\nAno: ${new Date().getFullYear()}`,
      })
    }

    const data = await callIA({
      model: 'gpt-5.2',
      task: 'extract',
      max_tokens: 1000,
      enable_search: false,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })

    const rawText = data.content?.find((b: any) => b.type === 'text')?.text || ''
    const jsonStr = extrairJSON(rawText)
    const parsed = JSON.parse(jsonStr)

    return { ...parsed, ia_usado: true, provedor: data.provedor, modo: 'estruturado' }
  } catch (e: any) {
    const local = texto ? parseMensagem(texto) : {}
    return {
      ...local,
      ia_usado: false,
      ia_indisponivel: !!e.indisponivel,
      ia_erro: aiErrorUserMessage(e, e.provedor || 'ia'),
      ia_resumo: texto
        ? 'Usei leitura local do texto porque a IA premium nao concluiu a leitura da imagem.'
        : 'A imagem precisa da IA premium ativa para leitura confiavel. Envie tambem o texto quando possivel.',
    }
  }
}

export async function transcreverAudioComIA(): Promise<{
  texto: string
  erro?: string
  indisponivel?: boolean
}> {
  return {
    texto: '',
    erro: 'Transcrição de áudio via IA ainda não disponível. Use Web Speech API.',
    indisponivel: true,
  }
}

// ============================================================
// Chat IA — Felipe conversa em PT-BR
// ============================================================

export interface ChatContext {
  total_demandas?: number
  demandas_pendentes?: number
  total_empresas?: number
  total_funcionarios?: number
  ticket_medio?: number
  faturamento_mes?: number
  faturamento_mes_anterior?: number
  demandas_urgentes?: number
  demandas_proximo_checkin?: number
  agente_top?: string
  empresa_top?: string
  por_tipo?: Record<string, number>
  demandas_recentes?: any[]
  empresas_relevantes?: any[]
  funcionarios_relevantes?: any[]
  vouchers_relevantes?: any[]
  hoteis_relevantes?: any[]
  fornecedores_relevantes?: any[]
  base_unificada?: any[]
}

const CHAT_SYSTEM = (ctx: ChatContext) => `Você é a IA BIA, assistente inteligente do BBT Corporativo TRAVEL ELITE.
Fale como uma pessoa experiente de operação: natural, clara, direta e prestativa.
Não exponha IDs internos, nomes de funções, JSON, erro técnico, quote-id, appr-id, stack trace, payload, provider ou detalhes de implementação.
Quando criar ou preparar algo, explique o resultado em linguagem de trabalho: o que foi encontrado, o que falta confirmar e qual é o próximo passo.
Se faltar dado, peça só o dado que falta. Se não tiver certeza, diga isso de forma simples e proponha uma ação.
Evite resposta robotizada, termos secos demais e frases como "não sei responder no modo local".

Você pode:
- Responder perguntas sobre o sistema
- Analisar demandas e dar recomendações
- Sugerir como priorizar atendimentos
- Explicar funcionalidades
- Ajudar a redigir mensagens pra clientes
- Responder perguntas gerais quando a permissão de assunto permitir
- Quando faltar dado, pedir exatamente o dado que falta

Contexto atual real do sistema (use SÓ esses números, não invente):
- Total de demandas: ${ctx.total_demandas ?? 0}
- Demandas pendentes/ativas: ${ctx.demandas_pendentes ?? 0}
- Demandas urgentes: ${ctx.demandas_urgentes ?? 0}
- Demandas com check-in nos próximos 3 dias: ${ctx.demandas_proximo_checkin ?? 0}
- Empresas cadastradas: ${ctx.total_empresas ?? 0}
- Funcionários cadastrados: ${ctx.total_funcionarios ?? 0}
- Ticket médio: R$ ${(ctx.ticket_medio ?? 0).toFixed(2)}
- Faturamento do mês atual: R$ ${(ctx.faturamento_mes ?? 0).toFixed(2)}
- Faturamento do mês anterior: R$ ${(ctx.faturamento_mes_anterior ?? 0).toFixed(2)}
- Distribuição por tipo: ${JSON.stringify(ctx.por_tipo || {})}
- Agente top do mês: ${ctx.agente_top || 'sem dados'}
- Empresa com mais demandas: ${ctx.empresa_top || 'sem dados'}
- Demandas relevantes para a pergunta: ${JSON.stringify(ctx.demandas_recentes || [])}
- Empresas relevantes: ${JSON.stringify(ctx.empresas_relevantes || [])}
- Funcionários relevantes: ${JSON.stringify(ctx.funcionarios_relevantes || [])}
- Vouchers relevantes: ${JSON.stringify(ctx.vouchers_relevantes || [])}
- Hotéis relevantes: ${JSON.stringify(ctx.hoteis_relevantes || [])}
- Fornecedores/conectores relevantes: ${JSON.stringify(ctx.fornecedores_relevantes || [])}
- Base unificada pesquisável (demandas, vouchers criados/importados, empresas, funcionários, hotéis): ${JSON.stringify(ctx.base_unificada || [])}

Quando o usuário pedir dados internos (voucher, funcionário, hotel, demanda, financeiro, fornecedor/conector), use somente o contexto acima e deixe claro se não encontrou.
Quando precisar de internet, use a busca web do GPT-5.2 ou Gemini/Google Search, mas não invente telefone, tarifa ou endereço sem fonte.
Use markdown apenas para listas curtas. Responda em até 6 parágrafos.`

export async function chatComIA(
  mensagens: Array<{ role: 'user' | 'assistant'; content: string }>,
  contexto: ChatContext = {},
  options: { enableSearch?: boolean } = {},
): Promise<{
  resposta: string
  erro?: string
  indisponivel?: boolean
  modoLocal?: boolean
  provedor?: ProvedorIA
  sources?: Array<{ title?: string; uri?: string }>
}> {
  try {
    const data = await callIA({
      model: 'gpt-5.2',
      task: 'chat',
      max_tokens: 2000,
      system: CHAT_SYSTEM(contexto),
      enable_search: options.enableSearch ?? true,
      messages: mensagens.slice(-20),
    })
    const text = data.content?.find((b: any) => b.type === 'text')?.text || ''
    return { resposta: text, provedor: data.provedor, sources: data.sources || [] }
  } catch (e: any) {
    if (e.indisponivel) {
      return {
        resposta: chatLocal(mensagens, contexto),
        indisponivel: true,
        modoLocal: true,
        provedor: 'local',
      }
    }
    return {
      resposta: chatLocal(mensagens, contexto),
      erro: aiErrorUserMessage(e, e.provedor || 'ia'),
      indisponivel: true,
      modoLocal: true,
      provedor: 'local',
    }
  }
}

function dinheiro(v?: number): string {
  if (v == null || Number.isNaN(v)) return 'R$ 0,00'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function chatLocal(
  mensagens: Array<{ role: 'user' | 'assistant'; content: string }>,
  ctx: ChatContext,
): string {
  const ultima = mensagens[mensagens.length - 1]?.content || ''
  const q = ultima.toLowerCase()
  const relevantes = (ctx.base_unificada || [])
    .slice(0, 8)
    .map((item: any) => {
      const partes = [item.tipo, item.titulo, item.subtitulo].filter(Boolean).join(' - ')
      return item.link ? `${partes} (${item.link})` : partes
    })
    .filter(Boolean)

  // Saudação simples
  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|hey)\b/i.test(ultima.trim())) {
    return `Oi. Sou a IA BIA. Hoje voce tem **${ctx.demandas_pendentes ?? 0}** demanda(s) ativa(s)${
      ctx.demandas_urgentes ? `, sendo **${ctx.demandas_urgentes} urgente(s)**` : ''
    }. Posso localizar voucher, demanda, funcionario, hotel, fornecedor, financeiro ou preparar um atendimento.`
  }

  if (relevantes.length && !/(ajuda|help|comandos|o que voc[eê] faz)/.test(q)) {
    return [
      'Encontrei estes dados relacionados na base do sistema:',
      ...relevantes.map((item) => `- ${item}`),
      '',
      'Me diga a proxima acao: abrir, comparar, criar voucher, preparar cotacao ou gerar resumo.',
    ].join('\n')
  }

  if (/pendente|aberta|andamento|fila/.test(q)) {
    const linhas = [
      `Você tem **${ctx.demandas_pendentes ?? 0}** demanda(s) pendente(s) ou em andamento.`,
    ]
    if (ctx.demandas_urgentes && ctx.demandas_urgentes > 0) {
      linhas.push(`Dessas, **${ctx.demandas_urgentes} são urgentes** — trate primeiro.`)
    }
    if (ctx.demandas_proximo_checkin && ctx.demandas_proximo_checkin > 0) {
      linhas.push(`**${ctx.demandas_proximo_checkin}** com check-in/embarque nos próximos 3 dias.`)
    }
    linhas.push(
      '',
      'Sugestão:',
      '- Comece pelas urgentes sem agente.',
      '- Depois, as com check-in mais próximo.',
      '- Por último, as que estão aguardando cliente há mais tempo.',
    )
    return linhas.join('\n')
  }

  if (/produtiv|agente|equipe|ranking/.test(q)) {
    if (ctx.agente_top) {
      return `Agente com mais demandas no período: **${ctx.agente_top}**.\n\nNo modo local, abra a aba **Produtividade** pra ver o ranking completo, com volume, ticket médio e SLA por agente.`
    }
    return 'Sem dados suficientes pra ranking. Abra a aba **Produtividade** pra ver tudo.'
  }

  if (/cobran|email|e-mail|mensagem|cliente/.test(q)) {
    return [
      'Modelo de mensagem de cobrança/follow-up:',
      '',
      '> Olá, tudo bem?',
      '>',
      '> Passando pra reforçar o acompanhamento da solicitação pendente e confirmar se podemos seguir com a próxima etapa. Caso haja atualização de dados, autorização ou forma de pagamento, me envie por aqui que ajusto no sistema.',
      '>',
      '> Fico à disposição.',
      '> BBT Corporativo',
      '',
      'Personalize o nome do passageiro, número da solicitação e data antes de enviar.',
    ].join('\n')
  }

  if (/priori|urgente|sla|importante/.test(q)) {
    return [
      'Priorização recomendada:',
      '1. **Urgentes** com check-in/embarque hoje ou amanhã.',
      '2. Urgentes **sem agente** responsável.',
      '3. Aguardando cliente com **SLA estourando**.',
      '4. Empresas com maior volume ou ticket alto.',
      '5. Itens com **dados incompletos** — pra evitar retrabalho.',
    ].join('\n')
  }

  if (/fatur|receita|financeiro|mês|mes|ticket|faturament/.test(q)) {
    const atual = ctx.faturamento_mes ?? 0
    const anterior = ctx.faturamento_mes_anterior ?? 0
    const variacao = anterior > 0 ? ((atual - anterior) / anterior) * 100 : 0
    const linhas = [
      'Resumo financeiro:',
      `- Faturamento do **mês atual**: ${dinheiro(atual)}.`,
      `- Mês anterior: ${dinheiro(anterior)}.`,
    ]
    if (anterior > 0) {
      const sinal = variacao >= 0 ? '+' : ''
      linhas.push(`- Variação: **${sinal}${variacao.toFixed(1)}%**.`)
    }
    linhas.push(`- Ticket médio geral: ${dinheiro(ctx.ticket_medio)}.`)
    linhas.push(`- Empresas na base: ${ctx.total_empresas ?? 0}.`)
    if (ctx.empresa_top) linhas.push(`- Empresa que mais consome: **${ctx.empresa_top}**.`)
    return linhas.join('\n')
  }

  if (/empresa|cliente|conta/.test(q)) {
    return [
      `Você tem **${ctx.total_empresas ?? 0}** empresa(s) cadastrada(s).`,
      ctx.empresa_top ? `Empresa que mais consome: **${ctx.empresa_top}**.` : '',
      '',
      'Pra detalhes, abra **Cadastros > Empresas** e clique numa empresa pra ver o histórico, contatos e funcionários.',
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (/hotel|hote|hospedagem/.test(q)) {
    const n = ctx.por_tipo?.Hotel ?? 0
    return `No período, você tem **${n}** demanda(s) de hotel. Cadastros completos em **Cadastros > Hotéis** pra acelerar o lançamento.`
  }

  if (/aereo|aéreo|aviao|avião|voo|bilhete/.test(q)) {
    const n = ctx.por_tipo?.Aéreo ?? 0
    return `No período, você tem **${n}** demanda(s) aérea(s). Pra emissões em massa, abra **Importar Dados** e suba o relatório de emissões.`
  }

  if (/ajuda|help|o que voc[eê] faz|comandos/.test(q)) {
    return [
      'Eu sou a IA BIA dentro do BBT Corporativo.',
      '',
      'Posso atuar em:',
      '- Localizar voucher, demanda, funcionario, empresa, hotel e fornecedor.',
      '- Resumir fila, financeiro, alertas e produtividade.',
      '- Preparar demanda, voucher, cotacao e reserva de hotel quando a permissao estiver ativa.',
      '- Ler texto, imagem e audio quando a IA premium estiver conectada.',
      '- Pesquisar internet em tempo real quando a permissao web estiver ativa.',
      '',
      'Quando o provedor externo falhar, continuo em modo interno usando a base do sistema.',
    ].join('\n')
  }

  // Fallback
  return [
    'Consigo ajudar melhor se voce transformar isso em uma acao do sistema.',
    '',
    `Resumo atual: **${ctx.demandas_pendentes ?? 0}** demandas ativas, **${dinheiro(
      ctx.faturamento_mes,
    )}** faturado no mes, **${ctx.total_empresas ?? 0}** empresas e **${ctx.total_funcionarios ?? 0}** funcionarios na base.`,
    '',
    'Exemplos: "localize o voucher do Pedro", "quais demandas vencem hoje", "resuma o financeiro", "prepare cotacao de hotel em Brasilia".',
  ].join('\n')
}

function extrairJSON(texto: string): string {
  // Remove markdown code fences e tenta achar o primeiro { ... } válido
  const limpo = texto.replace(/```json|```/g, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio >= 0 && fim > inicio) return limpo.slice(inicio, fim + 1)
  return limpo
}

// ============================================================
// Sugestão de agente — heurística local (sem IA)
// ============================================================
export function sugerirAgente(
  textoDemanda: string,
  agentes: Array<{ id: string; nome: string; carga_atual: number }>,
): { agente_id: string; razao: string } | null {
  if (agentes.length === 0) return null
  const ordenados = [...agentes].sort((a, b) => a.carga_atual - b.carga_atual)
  return {
    agente_id: ordenados[0].id,
    razao: `Menor carga atual (${ordenados[0].carga_atual} demandas ativas)`,
  }
}

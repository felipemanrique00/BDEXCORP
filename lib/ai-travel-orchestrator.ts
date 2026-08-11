import { localDateToISODate, todayISODate } from '@/lib/date'
import type {
  Atendimento,
  Empresa,
  Funcionario,
  Hotel,
  PoliticaCargo,
  Prioridade,
  TipoServico,
} from '@/types'
import { parseMensagem, type MensagemParsed } from '@/lib/mensagem-parser'
import {
  buscarHoteisComIA,
  hotelJaExiste,
  normalizarTexto,
  sugestaoParaHotel,
  type HotelAISuggestion,
} from '@/lib/ia-hotel-search'
import { AI_NAME } from '@/lib/branding'
import { encontrarFuncionarioConfiavel, encontrarFuncionarioPorNomeInteligente } from '@/lib/funcionario-identidade'
import type { AiActionProposal, PrepareAiAction } from '@/lib/ai-actions'
import {
  MANUAL_DEMAND_BOOKING_MODE,
  shouldSubmitDemandOnCreate,
} from '@/lib/travel/demand-booking-mode'

export interface TravelAgentContext {
  empresas: Empresa[]
  funcionarios: Funcionario[]
  hoteis: Hotel[]
  atendimentos: Atendimento[]
  politicas?: PoliticaCargo[]
}

export interface TravelAgentOps {
  prepareAction?: PrepareAiAction
  currentUser?: { id: string; name?: string }
  politicas?: PoliticaCargo[]
}

export interface TravelAgentResponse {
  handled: boolean
  title?: string
  message: string
  badge?: string
  links?: Array<{ label: string; href: string; kind?: 'primary' | 'secondary' | 'download' }>
  cards?: Array<{ title: string; subtitle?: string; meta?: string; href?: string }>
  sources?: Array<{ title?: string; uri?: string }>
  actionProposals?: AiActionProposal[]
  provedor?: 'sistema' | 'openai' | 'gemini' | 'local'
}

type AgentIntent =
  | 'pedido_viagem'
  | 'cotacao'
  | 'emergencia'
  | 'cancelamento'
  | 'relatorio'
  | 'financeiro'
  | 'perfil'
  | 'desconhecido'

interface PolicyDecision {
  politica?: PoliticaCargo
  violations: string[]
  requiresApproval: boolean
  approverName?: string
}

interface HotelPlan {
  suggestions: HotelAISuggestion[]
  actionProposals: AiActionProposal[]
  summary: string
  sources: Array<{ title?: string; uri?: string }>
  externalWarning?: string
}

const CITY_UF: Record<string, string> = {
  'campo grande': 'MS',
  brasilia: 'DF',
  goiania: 'GO',
  trindade: 'GO',
  'sao paulo': 'SP',
  'rio de janeiro': 'RJ',
  recife: 'PE',
  salvador: 'BA',
  curitiba: 'PR',
  cuiaba: 'MT',
  manaus: 'AM',
  fortaleza: 'CE',
}

export function shouldHandleTravelAgent(pergunta: string): boolean {
  const q = normalizarTexto(pergunta)
  if (!q) return false
  if (/localize.*voucher|achar.*voucher|buscar.*voucher|dados.*funcionario|cpf/.test(q)) return false

  return /viagem|viajar|cotacao|cotacao|orcamento|orcamento|reserva|reservar|emitir|emissao|passagem|voo|aereo|hotel|hospedagem|diaria|locadora|carro|transfer|politica|aprovacao|aprovar|cancelar|remarcar|emergencia|cancelado|atrasado|overbooking|relatorio|gasto|economia|perfil|cadastro|centro de custo|financeiro/.test(q)
}

export async function runTravelAgent(
  pergunta: string,
  ctx: TravelAgentContext,
  ops: TravelAgentOps = {},
): Promise<TravelAgentResponse> {
  const intent = classificarIntent(pergunta)

  if (intent === 'relatorio' || intent === 'financeiro') {
    return responderRelatorio(pergunta, ctx, intent)
  }

  if (intent === 'emergencia' || intent === 'cancelamento') {
    return responderIncidente(pergunta, ctx, intent, ops)
  }

  if (intent === 'perfil') {
    return responderPerfil(pergunta, ctx)
  }

  if (!['pedido_viagem', 'cotacao'].includes(intent)) {
    return {
      handled: false,
      message: '',
    }
  }

  const parsed = parseMensagem(pergunta)
  const funcionario = encontrarFuncionario(pergunta, parsed, ctx.funcionarios)
  const empresa =
    encontrarEmpresa(pergunta, parsed, ctx.empresas) ||
    (funcionario ? ctx.empresas.find((e) => e.id === funcionario.company_id) : undefined)
  const tipo = inferirTipoServico(pergunta, parsed)
  const destino = limparDestino(parsed.cidade_destino || extrairDestinoLivre(pergunta))
  const origem = limparDestino(parsed.cidade_origem || extrairOrigemLivre(pergunta))
  const dataInicio = dataPrincipal(parsed, tipo) || extrairData(pergunta) || todayISODate()
  const dataFim = dataFinal(parsed, tipo) || extrairDataRetorno(pergunta, dataInicio)
  const prioridade = prioridadePorPergunta(pergunta, dataInicio)
  const politicas = ops.politicas || ctx.politicas || []
  const policy = avaliarPolitica({ tipo, parsed, funcionario, empresa, politicas, dataInicio })
  const hotelPlan = await montarPlanoHotel(pergunta, destino, ctx, ops, tipo)

  const demandInput = empresa
    ? montarAtendimento({
        empresa,
        funcionario,
        parsed,
        pergunta,
        tipo,
        destino,
        origem,
        dataInicio,
        dataFim,
        prioridade,
        currentUserId: ops.currentUser?.id || 'ia-operacional',
      })
    : null
  const demandProposal = demandInput && ops.prepareAction
    ? await ops.prepareAction({
        actionType: 'create_demand',
        companyId: empresa?.id || null,
        summary: `Criar demanda de ${demandInput.passageiro_nome}`,
        payload: {
          demand: demandInput,
          submit: shouldSubmitDemandOnCreate(MANUAL_DEMAND_BOOKING_MODE),
        },
        expiresInMinutes: 30,
      })
    : null

  return montarRespostaTriagem({
    empresa,
    funcionario,
    demandProposal,
    tipo,
    destino,
    dataInicio,
    dataFim,
    policy,
    hotelPlan,
  })
}

function classificarIntent(pergunta: string): AgentIntent {
  const q = normalizarTexto(pergunta)
  if (/emergencia|urgencia|voo cancelado|cancelado|perdeu conexao|hotel nao encontra|overbooking|atrasado|cartao recusado/.test(q)) return 'emergencia'
  if (/cancelar|cancelamento|remarcar|remarcacao|alterar reserva|antecipar retorno|reemitir/.test(q)) return 'cancelamento'
  if (/relatorio|gasto|gastou|economia|faturamento|area comercial|centro de custo|ticket medio|companhia.*atraso/.test(q)) return 'relatorio'
  if (/financeiro|cobranca|duplicada|tarifa acima|nota|fatura|pagamento|reembolso/.test(q)) return 'financeiro'
  if (/perfil|cadastro|documento|passaporte|milhagem|preferencia|restricao alimentar|dados do viajante/.test(q)) return 'perfil'
  if (/cotacao|cotacao|orcamento|orcamento|opcoes|melhores opcoes|comparar/.test(q)) return 'cotacao'
  if (/viagem|viajar|preciso ir|preciso de|reserva|reservar|emitir|hotel|hospedagem|passagem|voo|aereo|carro|locadora|transfer/.test(q)) return 'pedido_viagem'
  return 'desconhecido'
}

async function responderRelatorio(
  pergunta: string,
  ctx: TravelAgentContext,
  intent: AgentIntent,
): Promise<TravelAgentResponse> {
  const q = normalizarTexto(pergunta)
  const periodo = /mes passado/.test(q) ? 'mes_passado' : /ano/.test(q) ? 'ano' : 'mes_atual'
  const { inicio, fim } = rangePeriodo(periodo)
  const atendimentos = ctx.atendimentos.filter((a) => dataRegistro(a) >= inicio && dataRegistro(a) <= fim)
  const total = atendimentos.reduce((sum, a) => sum + valorAtendimento(a), 0)
  const porEmpresa = agrupar(atendimentos, (a) => ctx.empresas.find((e) => e.id === a.empresa_id)?.nome || 'Empresa sem cadastro')
  const porTipo = agrupar(atendimentos, (a) => a.tipo_servico)
  const urgentes = atendimentos.filter((a) => a.prioridade === 'urgente').length

  return {
    handled: true,
    title: intent === 'financeiro' ? 'Analise financeira IA' : 'Relatorio inteligente',
    badge: 'Dados reais do sistema',
    message: [
      `Periodo analisado: ${formatarData(inicio)} a ${formatarData(fim)}.`,
      `Total em demandas: ${dinheiro(total)} em ${atendimentos.length} registro(s).`,
      `Demandas urgentes no periodo: ${urgentes}.`,
      '',
      `Top empresas: ${topResumo(porEmpresa) || 'sem movimento no periodo'}.`,
      `Mix de servicos: ${topResumo(porTipo) || 'sem dados'}.`,
      '',
      recomendacaoRelatorio(atendimentos, total, urgentes),
    ].join('\n'),
    links: [
      { label: 'Abrir Relatorios', href: '/dashboard/relatorios', kind: 'primary' },
      { label: 'Abrir Financeiro', href: '/dashboard/financeiro', kind: 'secondary' },
      { label: `Painel da ${AI_NAME}`, href: '/dashboard/ia?tab=operacional', kind: 'secondary' },
    ],
    provedor: 'sistema',
  }
}

async function responderIncidente(
  pergunta: string,
  ctx: TravelAgentContext,
  intent: AgentIntent,
  ops: TravelAgentOps,
): Promise<TravelAgentResponse> {
  const funcionario = encontrarFuncionario(pergunta, {}, ctx.funcionarios)
  const atendimento = encontrarAtendimentoRelacionado(pergunta, ctx, funcionario)
  const proposal = ops.prepareAction
    ? await ops.prepareAction({
        actionType: 'human_handoff',
        companyId: atendimento?.empresa_id || funcionario?.company_id || null,
        summary: intent === 'emergencia'
          ? 'Escalar incidente urgente para atendimento humano'
          : 'Escalar alteração ou cancelamento para atendimento humano',
        payload: {
          reason: [
            pergunta,
            funcionario ? `Viajante identificado: ${funcionario.nome}.` : '',
            atendimento ? `Demanda relacionada: ${atendimento.id}.` : '',
          ].filter(Boolean).join('\n'),
          priority: 'urgent',
        },
        expiresInMinutes: 15,
      })
    : null

  return {
    handled: true,
    title: intent === 'emergencia' ? 'Suporte emergencial' : 'Alteracao de reserva',
    badge: proposal ? 'Aguardando confirmação urgente' : 'Revisão humana necessária',
    message: [
      proposal
        ? 'Preparei o escalonamento urgente para a equipe humana. Confirme a proposta abaixo para abrir o atendimento.'
        : 'Não criei tarefa automaticamente. Abra a fila de demandas para registrar o incidente com prioridade urgente.',
      funcionario ? `Viajante identificado: ${funcionario.nome}.` : 'Nao identifiquei o viajante com confianca; confirme os dados antes do escalonamento.',
      atendimento ? `Demanda relacionada: ${atendimento.passageiro_nome} (${atendimento.tipo_servico}).` : '',
      '',
      'Proximo passo: revisar reserva/localizador, politica da empresa, custo de multa e alternativa disponivel antes de executar cancelamento ou remarcacao.',
    ]
      .filter(Boolean)
      .join('\n'),
    links: [
      { label: 'Abrir demandas', href: '/dashboard/demandas', kind: 'primary' },
      { label: `Painel da ${AI_NAME}`, href: '/dashboard/ia?tab=operacional', kind: 'secondary' },
    ],
    actionProposals: proposal ? [proposal] : [],
    provedor: 'sistema',
  }
}

function responderPerfil(pergunta: string, ctx: TravelAgentContext): TravelAgentResponse {
  const funcionario = encontrarFuncionario(pergunta, {}, ctx.funcionarios)
  if (!funcionario) {
    return {
      handled: true,
      title: 'Perfil do viajante',
      badge: 'Cadastro necessario',
      message: 'Nao encontrei um viajante confiavel na base. Posso criar o cadastro quando a mensagem trouxer nome completo, empresa, documento, e-mail e telefone.',
      links: [{ label: 'Abrir Funcionarios', href: '/dashboard/funcionarios', kind: 'primary' }],
      provedor: 'sistema',
    }
  }
  const empresa = ctx.empresas.find((e) => e.id === funcionario.company_id)
  return {
    handled: true,
    title: 'Perfil do viajante',
    badge: 'Cadastro localizado',
    message: [
      `Viajante: ${funcionario.nome}.`,
      empresa ? `Empresa: ${empresa.nome}.` : '',
      `Cargo: ${funcionario.cargo}. Centro de custo: ${funcionario.centro_custo || 'nao informado'}.`,
      funcionario.email ? `E-mail: ${funcionario.email}.` : '',
      funcionario.telefone ? `Telefone: ${funcionario.telefone}.` : '',
      funcionario.milhagem ? `Milhagem: ${funcionario.milhagem}.` : '',
      funcionario.preferencias ? `Preferencias: ${funcionario.preferencias}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    links: [{ label: 'Abrir Funcionarios', href: '/dashboard/funcionarios', kind: 'primary' }],
    provedor: 'sistema',
  }
}

async function montarPlanoHotel(
  pergunta: string,
  destino: string,
  ctx: TravelAgentContext,
  ops: TravelAgentOps,
  tipo: TipoServico,
): Promise<HotelPlan> {
  if (!precisaHotel(pergunta, tipo)) {
    return { suggestions: [], actionProposals: [], summary: 'Hotel nao solicitado.', sources: [] }
  }

  const uf = extrairUF(pergunta) || CITY_UF[normalizarTexto(destino)] || ''
  const locais = ctx.hoteis
    .filter((h) => !destino || tokenMatch(destino, `${h.cidade} ${h.uf}`))
    .slice(0, 6)
    .map(hotelParaSugestao)

  let suggestions = locais
  let summary = locais.length
    ? `Usei ${locais.length} hotel(is) ja cadastrado(s) para ${destino || 'o destino informado'}.`
    : `Nao havia hotel local suficiente para ${destino || 'o destino informado'}.`
  let sources: Array<{ title?: string; uri?: string }> = []
  let externalWarning: string | undefined

  if (deveBuscarHotelNaWeb(pergunta, locais.length)) {
    try {
      const response = await buscarHoteisComIA({
        query: pergunta,
        cidade: destino || undefined,
        uf: uf || undefined,
        knownHotels: ctx.hoteis.map((h) => ({ nome: h.nome, cidade: h.cidade, uf: h.uf })),
      })
      suggestions = response.suggestions.length ? response.suggestions : suggestions
      summary = response.summary
      sources = response.citations || []
    } catch (e: any) {
      externalWarning = normalizarErroExterno(e?.message || 'Falha na busca web de hoteis.')
      summary = suggestions.length
        ? `${summary} A busca externa falhou; foram mantidos somente os hoteis reais do cadastro.`
        : `${summary} A busca externa falhou e nenhuma sugestao foi criada.`
    }
  }

  const podeCadastrar = Boolean(ops.prepareAction)
    && /cadastre|cadastrar|incluir|sem hotel|nao tem|não tem|novo hotel|hospedagem/.test(normalizarTexto(pergunta))
  const actionProposals = podeCadastrar
    ? await Promise.all(
        suggestions
          .filter((suggestion) => !hotelJaExiste(ctx.hoteis, suggestion.nome, suggestion.cidade, suggestion.uf))
          .slice(0, 3)
          .map((suggestion) =>
            ops.prepareAction!({
              actionType: 'create_hotel',
              summary: `Cadastrar hotel ${suggestion.nome}`,
              payload: sugestaoParaHotel(suggestion),
              expiresInMinutes: 30,
            }),
          ),
      )
    : []

  return { suggestions, actionProposals, summary, sources, externalWarning }
}

function avaliarPolitica({
  tipo,
  parsed,
  funcionario,
  empresa,
  politicas,
  dataInicio,
}: {
  tipo: TipoServico
  parsed: MensagemParsed
  funcionario?: Funcionario
  empresa?: Empresa
  politicas: PoliticaCargo[]
  dataInicio: string
}): PolicyDecision {
  const politica = funcionario
    ? politicas.find((p) => p.company_id === funcionario.company_id && p.cargo === funcionario.cargo)
    : empresa
    ? politicas.find((p) => p.company_id === empresa.id)
    : undefined
  const violations: string[] = []

  if (!politica) {
    return {
      violations: empresa ? ['Politica da empresa nao encontrada para este cargo.'] : ['Empresa nao identificada para aplicar politica.'],
      requiresApproval: true,
    }
  }

  const diasAntecedencia = diffDias(todayISODate(), dataInicio)
  if ((tipo === 'Hotel' || tipo === 'Pacote') && diasAntecedencia < politica.antecedencia_hotel_dias) {
    violations.push(`Antecedencia de hotel abaixo da politica (${diasAntecedencia} dia(s), minimo ${politica.antecedencia_hotel_dias}).`)
  }
  if ((tipo === 'Aéreo' || tipo === 'Pacote') && diasAntecedencia < politica.antecedencia_aereo_domestico_dias) {
    violations.push(`Antecedencia aerea abaixo da politica (${diasAntecedencia} dia(s), minimo ${politica.antecedencia_aereo_domestico_dias}).`)
  }
  if (parsed.valor_diaria && parsed.valor_diaria > politica.limite_diaria_hotel) {
    violations.push(`Diaria informada (${dinheiro(parsed.valor_diaria)}) acima do limite (${dinheiro(politica.limite_diaria_hotel)}).`)
  }

  return {
    politica,
    violations,
    requiresApproval: violations.length > 0 && !politica.aprovacao_automatica,
    approverName: politica.autorizador_user_id ? `Usuario ${politica.autorizador_user_id}` : undefined,
  }
}

function montarAtendimento({
  empresa,
  funcionario,
  parsed,
  pergunta,
  tipo,
  destino,
  origem,
  dataInicio,
  dataFim,
  prioridade,
  currentUserId,
}: {
  empresa: Empresa
  funcionario?: Funcionario
  parsed: MensagemParsed
  pergunta: string
  tipo: TipoServico
  destino: string
  origem: string
  dataInicio: string
  dataFim?: string
  prioridade: Prioridade
  currentUserId: string
}): Omit<Atendimento, 'id' | 'created_at' | 'updated_at'> {
  const passageiro = parsed.passageiro_nome || funcionario?.nome || extrairNomeLivre(pergunta) || 'Passageiro nao informado'
  return {
    empresa_id: empresa.id,
    funcionario_id: funcionario?.id || null,
    passageiro_nome: passageiro,
    tipo_servico: tipo,
    booking_mode: MANUAL_DEMAND_BOOKING_MODE,
    valor_cotacao: 0,
    valor_final: 0,
    valor_custo: 0,
    valor_venda: 0,
    agente_user_id: currentUserId,
    status: 'pendente',
    prioridade,
    origem: 'Outro',
    observacoes: [
      `Demanda criada pela ${AI_NAME}.`,
      pergunta,
      'Status: aguardando cotacao real de fornecedor.',
    ].join('\n\n'),
    data_atendimento: todayISODate(),
    origem_emissao: 'caixa_entrada',
    cost_center_id: parsed.centro_custo
      ? null
      : funcionario?.cost_center_id || empresa.centro_custo_padrao_id || null,
    centro_custo: parsed.centro_custo || funcionario?.centro_custo || empresa.centro_custo_padrao,
    contato_passageiro: parsed.telefone || undefined,
    detalhes_hotel:
      tipo === 'Hotel' || tipo === 'Pacote'
        ? {
            hotel_nome: parsed.hotel_nome || undefined,
            cidade: destino || undefined,
            data_checkin: parsed.data_checkin || dataInicio,
            data_checkout: parsed.data_checkout || dataFim,
            num_hospedes: parsed.num_hospedes || 1,
            tipo_apto: parsed.tipo_quarto,
            tarifa_unitaria: parsed.valor_diaria,
          }
        : undefined,
    detalhes_aereo:
      tipo === 'Aéreo' || tipo === 'Pacote'
        ? {
            origem: origem || undefined,
            destino: destino || undefined,
            data_ida: parsed.data_ida || dataInicio,
            data_volta: parsed.data_volta || dataFim,
            classe: undefined,
          }
        : undefined,
    detalhes_carro:
      tipo === 'Carro'
        ? {
            cidade_retirada: destino || undefined,
            data_retirada: dataInicio,
            data_devolucao: dataFim,
          }
        : undefined,
    detalhes_pacote:
      tipo === 'Pacote'
        ? {
            destino: destino || undefined,
            data_ida: parsed.data_ida || parsed.data_checkin || dataInicio,
            data_volta: parsed.data_volta || parsed.data_checkout || dataFim,
          }
        : undefined,
  }
}

function montarRespostaTriagem({
  empresa,
  funcionario,
  demandProposal,
  tipo,
  destino,
  dataInicio,
  dataFim,
  policy,
  hotelPlan,
}: {
  empresa?: Empresa
  funcionario?: Funcionario
  demandProposal: AiActionProposal | null
  tipo: TipoServico
  destino: string
  dataInicio: string
  dataFim?: string
  policy: PolicyDecision
  hotelPlan: HotelPlan
}): TravelAgentResponse {
  const pendencias = [
    !empresa ? 'Confirmar a empresa para aplicar politica, centro de custo e aprovador.' : '',
    !funcionario ? 'Confirmar ou cadastrar o viajante para vincular a demanda ao ID correto.' : '',
    ...policy.violations,
    hotelPlan.externalWarning ? `Pesquisa externa: ${hotelPlan.externalWarning}` : '',
  ].filter(Boolean)

  return {
    handled: true,
    title: demandProposal ? 'Demanda preparada para confirmação' : 'Dados preparados para cotação',
    badge: demandProposal ? 'Nenhuma gravação executada' : 'Aguardando dados obrigatórios',
    message: [
      demandProposal
        ? 'A demanda foi preparada sem valor inventado e aguarda sua confirmação abaixo.'
        : 'Os dados foram organizados, mas a demanda ainda precisa de uma empresa valida para ser registrada.',
      '',
      `Empresa: ${empresa?.nome || 'nao confirmada'}.`,
      `Viajante: ${funcionario?.nome || 'nao confirmado'}.`,
      `Servico: ${tipo}.`,
      `Destino: ${destino || 'nao informado'}.`,
      `Periodo: ${formatarData(dataInicio)}${dataFim ? ` ate ${formatarData(dataFim)}` : ''}.`,
      '',
      'Nenhuma tarifa foi inventada. O proximo passo e consultar a Tech Travel ou um fornecedor homologado.',
      pendencias.length ? ['Pendencias', ...pendencias.map((item) => `- ${item}`)].join('\n') : '',
      hotelPlan.actionProposals.length
        ? `${hotelPlan.actionProposals.length} cadastro(s) de hotel com fonte real também aguardam sua confirmação.`
        : '',
    ].filter(Boolean).join('\n'),
    links: [
      { label: 'Abrir reservas e cotacoes', href: '/dashboard/reservas', kind: 'primary' },
      { label: 'Abrir demandas', href: '/dashboard/demandas', kind: 'secondary' },
      { label: 'Abrir hoteis', href: `/dashboard/hoteis?busca=${encodeURIComponent(destino || '')}`, kind: 'secondary' },
    ],
    cards: hotelPlan.suggestions.slice(0, 6).map((hotel) => ({
      title: hotel.nome,
      subtitle: `${hotel.cidade}/${hotel.uf}`,
      meta: hotel.tarifa_sgl
        ? `Tarifa cadastrada: ${dinheiro(hotel.tarifa_sgl)}`
        : hotel.fonte_titulo || 'Sem tarifa cadastrada',
      href: hotel.fonte_url || `/dashboard/hoteis?busca=${encodeURIComponent(hotel.nome)}`,
    })),
    sources: hotelPlan.sources,
    actionProposals: [
      ...(demandProposal ? [demandProposal] : []),
      ...hotelPlan.actionProposals,
    ],
    provedor: 'sistema',
  }
}
function encontrarFuncionario(pergunta: string, parsed: Partial<MensagemParsed>, funcionarios: Funcionario[]): Funcionario | undefined {
  const nome = parsed.passageiro_nome || extrairNomeLivre(pergunta)
  const cpfTexto = parsed.cpf || pergunta.match(/\d{3}\D?\d{3}\D?\d{3}\D?\d{2}/)?.[0] || ''
  const confiavel = encontrarFuncionarioConfiavel(funcionarios, { cpf: cpfTexto })
  if (confiavel) return confiavel

  const match = encontrarFuncionarioPorNomeInteligente(funcionarios, nome, undefined, 84)
  return match && !match.ambiguo ? match.funcionario : undefined
}

function encontrarEmpresa(pergunta: string, parsed: Partial<MensagemParsed>, empresas: Empresa[]): Empresa | undefined {
  const alvo = normalizarTexto(`${parsed.empresa_faturar || ''} ${parsed.empresa_nome || ''} ${pergunta}`)
  return empresas
    .map((e) => {
      let score = 0
      const nome = normalizarTexto(e.nome)
      if (alvo.includes(nome)) score += 100
      nome.split(' ').filter((t) => t.length > 2).forEach((token) => {
        if (alvo.includes(token)) score += 16
      })
      if (e.cnpj && alvo.includes(e.cnpj.replace(/\D/g, ''))) score += 100
      return { e, score }
    })
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score)[0]?.e
}

function encontrarAtendimentoRelacionado(pergunta: string, ctx: TravelAgentContext, funcionario?: Funcionario): Atendimento | undefined {
  const destino = extrairDestinoLivre(pergunta)
  const data = extrairData(pergunta)
  return ctx.atendimentos
    .map((a) => {
      let score = 0
      const searchable = normalizarTexto(`${a.passageiro_nome} ${a.observacoes} ${a.detalhes_hotel?.cidade || ''} ${a.detalhes_aereo?.destino || ''}`)
      if (funcionario && (a.funcionario_id === funcionario.id || tokenMatch(funcionario.nome, searchable))) score += 60
      if (destino && tokenMatch(destino, searchable)) score += 25
      const date = a.detalhes_hotel?.data_checkin || a.detalhes_aereo?.data_ida || a.data_atendimento
      if (data && date && sameDateOrMonthDay(data, date)) score += 30
      return { a, score }
    })
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score)[0]?.a
}

function inferirTipoServico(pergunta: string, parsed: MensagemParsed): TipoServico {
  if (parsed.tipo_servico) return parsed.tipo_servico
  const q = normalizarTexto(pergunta)
  const hasHotel = /hotel|hospedagem|diaria|pousada/.test(q)
  const hasAereo = /aereo|voo|passagem|aviao|embarque/.test(q)
  const hasCarro = /carro|locadora|locacao|transfer/.test(q)
  if ((hasHotel && (hasAereo || /viagem|viajar|preciso ir/.test(q))) || /viagem completa|pacote/.test(q)) return 'Pacote'
  if (hasAereo) return 'Aéreo'
  if (hasHotel) return 'Hotel'
  if (hasCarro) return 'Carro'
  if (/viagem|viajar|preciso ir/.test(q)) return 'Pacote'
  return 'Outro'
}

function precisaHotel(pergunta: string, tipo: TipoServico): boolean {
  const q = normalizarTexto(pergunta)
  return tipo === 'Hotel' || tipo === 'Pacote' || /hotel|hospedagem|diaria|pousada|perto/.test(q)
}

function precisaAereo(pergunta: string, tipo: TipoServico): boolean {
  const q = normalizarTexto(pergunta)
  if (tipo === 'Aéreo' || tipo === 'Pacote') return true
  return /voo|aereo|passagem|aviao|embarque|viajar|preciso ir/.test(q) && !/somente hotel|apenas hotel/.test(q)
}

function precisaCarro(pergunta: string, tipo: TipoServico): boolean {
  const q = normalizarTexto(pergunta)
  return tipo === 'Carro' || /carro|locadora|locacao|transfer/.test(q)
}

function deveBuscarHotelNaWeb(pergunta: string, locais: number): boolean {
  const q = normalizarTexto(pergunta)
  return locais === 0 || /sem hotel|nao tem|não tem|cadastre|cadastrar|buscar|internet|google|telefone|hotel perto|hospedagem/.test(q)
}

function dataPrincipal(parsed: MensagemParsed, tipo: TipoServico): string | undefined {
  if (tipo === 'Hotel') return parsed.data_checkin
  if (tipo === 'Aéreo') return parsed.data_ida
  return parsed.data_ida || parsed.data_checkin
}

function dataFinal(parsed: MensagemParsed, tipo: TipoServico): string | undefined {
  if (tipo === 'Hotel') return parsed.data_checkout
  if (tipo === 'Aéreo') return parsed.data_volta
  return parsed.data_volta || parsed.data_checkout
}

function prioridadePorPergunta(pergunta: string, dataInicio?: string): Prioridade {
  const q = normalizarTexto(pergunta)
  if (/urgente|agora|hoje|emergencia/.test(q)) return 'urgente'
  if (dataInicio) {
    const dias = diffDias(todayISODate(), dataInicio)
    if (dias <= 1) return 'urgente'
    if (dias <= 3) return 'alta'
  }
  return 'media'
}

function hotelParaSugestao(hotel: Hotel): HotelAISuggestion {
  return {
    nome: hotel.nome,
    cidade: hotel.cidade,
    uf: hotel.uf,
    categoria: hotel.categoria,
    observacoes: hotel.observacoes,
    telefone: hotel.telefone,
    faturado: hotel.faturado,
    info_faturamento: hotel.info_faturamento,
    bebedouro: hotel.bebedouro,
    valor_agua: hotel.valor_agua,
    cafe_manha: hotel.cafe_manha,
    estacionamento: hotel.estacionamento,
    tarifa_sgl: hotel.tarifa_sgl,
    tarifa_dbl: hotel.tarifa_dbl,
    tarifa_tpl: hotel.tarifa_tpl,
    formas_pagamento: hotel.formas_pagamento,
    confianca: 'alta',
  }
}

function extrairDestinoLivre(pergunta: string): string {
  return (
    pergunta.match(/(?:para|pra|destino|em|hospedagem em)\s+([a-zA-ZÀ-ÿ\s]+?)(?:[-/,]\s*[A-Z]{2}\b|\s+dia|\s+no dia|\s+segunda|\s+terca|\s+terça|\s+quarta|\s+quinta|\s+sexta|\s+sabado|\s+sábado|\s+domingo|$)/i)?.[1] ||
    ''
  ).trim()
}

function extrairOrigemLivre(pergunta: string): string {
  return (
    pergunta.match(/(?:de|saindo de|origem)\s+([a-zA-ZÀ-ÿ\s]+?)\s+(?:para|pra|ate|até)/i)?.[1] ||
    ''
  ).trim()
}

function extrairNomeLivre(pergunta: string): string {
  return (
    pergunta.match(/(?:para|do|da|de|viajante|passageiro|hospede|hóspede)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+(?:\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+){1,4})/)?.[1] ||
    ''
  ).trim()
}

function extrairUF(pergunta: string): string {
  return pergunta.match(/\b([A-Z]{2})\b/)?.[1] || ''
}

function extrairData(pergunta: string): string | undefined {
  const numeric = pergunta.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/)
  if (!numeric) return extrairProximoDiaSemana(pergunta)
  const dia = numeric[1].padStart(2, '0')
  const mes = numeric[2].padStart(2, '0')
  let ano = numeric[3] || String(new Date().getFullYear())
  if (ano.length === 2) ano = `20${ano}`
  let iso = `${ano}-${mes}-${dia}`
  if (!numeric[3] && iso < todayISODate()) iso = `${new Date().getFullYear() + 1}-${mes}-${dia}`
  return iso
}

function extrairProximoDiaSemana(pergunta: string): string | undefined {
  const q = normalizarTexto(pergunta)
  const dias: Array<{ re: RegExp; day: number }> = [
    { re: /\bdomingo\b/, day: 0 },
    { re: /\bsegunda(?:-feira)?\b/, day: 1 },
    { re: /\bterca(?:-feira)?\b/, day: 2 },
    { re: /\bquarta(?:-feira)?\b/, day: 3 },
    { re: /\bquinta(?:-feira)?\b/, day: 4 },
    { re: /\bsexta(?:-feira)?\b/, day: 5 },
    { re: /\bsabado\b/, day: 6 },
  ]
  const alvo = dias.find((item) => item.re.test(q))
  if (!alvo) return undefined

  const hoje = new Date()
  const data = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  let diff = alvo.day - data.getDay()
  if (diff <= 0) diff += 7
  data.setDate(data.getDate() + diff)
  return localDateToISODate(data)
}

function extrairDataRetorno(pergunta: string, dataInicio?: string): string | undefined {
  const q = normalizarTexto(pergunta)
  const match = q.match(/(?:voltar|retornar|retorno|volta)\s+(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)/)
  if (!match) return undefined
  const retorno = extrairProximoDiaSemana(match[1])
  if (!retorno) return undefined
  if (!dataInicio || retorno > dataInicio) return retorno

  const date = new Date(`${retorno}T00:00:00`)
  date.setDate(date.getDate() + 7)
  return localDateToISODate(date)
}

function limparDestino(value: string): string {
  return value
    .replace(/\b(domingo|segunda(?:-feira)?|terca(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|sábado)\b.*$/i, '')
    .replace(/\b(ms|df|go|sp|rj|pr|mt|am|ce|ba|pe)\b$/i, '')
    .replace(/[-,]\s*$/g, '')
    .trim()
}

function diffDias(a: string, b: string): number {
  const da = new Date(`${a.slice(0, 10)}T00:00:00`)
  const db = new Date(`${b.slice(0, 10)}T00:00:00`)
  return Math.max(0, Math.round((db.getTime() - da.getTime()) / 86400000))
}

function sameDateOrMonthDay(a: string, b: string): boolean {
  const aa = a.slice(0, 10)
  const bb = b.slice(0, 10)
  return aa === bb || aa.slice(5) === bb.slice(5)
}

function tokenMatch(needle: string, haystack: string): boolean {
  const n = normalizarTexto(needle)
  const h = normalizarTexto(haystack)
  if (!n || !h) return false
  if (h.includes(n)) return true
  const tokens = n.split(' ').filter((t) => t.length > 2)
  return tokens.length > 0 && tokens.every((t) => h.includes(t))
}

function dataRegistro(a: Atendimento): string {
  return (a.data_atendimento || a.created_at || '').slice(0, 10)
}

function valorAtendimento(a: Atendimento): number {
  return Number(a.valor_venda || a.valor_final || a.valor_cotacao || 0)
}

function agrupar<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = keyFn(item) || 'sem grupo'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function topResumo(map: Record<string, number>): string {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v})`)
    .join(', ')
}

function rangePeriodo(periodo: string): { inicio: string; fim: string } {
  const now = new Date()
  const fim = todayISODate()
  if (periodo === 'ano') return { inicio: `${now.getFullYear()}-01-01`, fim }
  if (periodo === 'mes_passado') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    return { inicio: localDateToISODate(first), fim: localDateToISODate(last) }
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  return { inicio: localDateToISODate(first), fim }
}

function recomendacaoRelatorio(atendimentos: Atendimento[], total: number, urgentes: number): string {
  if (!atendimentos.length) return 'Sem movimento no periodo. Recomendo revisar pipeline aberto e cadastros incompletos.'
  if (urgentes > 0) return `Prioridade: tratar ${urgentes} demanda(s) urgente(s) antes de novas emissoes.`
  if (total > 50000) return 'Prioridade: revisar margem, politica por centro de custo e oportunidades de economia por antecedencia.'
  return 'Prioridade: manter fila por SLA, check-in proximo e demandas com dados incompletos.'
}

function normalizarErroExterno(message: string): string {
  if (/quota|billing|insufficient_quota|exceeded/i.test(message)) {
    return 'a busca em tempo real atingiu limite do provedor. Usei a base local e deixei a conferência para depois.'
  }
  if (/abort|timeout|timed out|tempo/i.test(message)) {
    return 'a busca em tempo real demorou demais. Usei a base local para não travar o atendimento.'
  }
  return 'a busca externa não respondeu agora. Usei a base local para manter o fluxo andando.'
}

function dinheiro(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

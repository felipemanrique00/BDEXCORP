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
import {
  addAgentApproval,
  addAgentQuote,
  addAgentRun,
  addAgentTask,
  upsertAgentMemory,
  type AgentQuoteOption,
} from '@/lib/ai-agent-storage'
import { AI_NAME } from '@/lib/branding'
import { selectSuppliersForService, type SupplierIntegration } from '@/lib/supplier-integrations'
import { encontrarFuncionarioConfiavel, encontrarFuncionarioPorNomeInteligente } from '@/lib/funcionario-identidade'

export interface TravelAgentContext {
  empresas: Empresa[]
  funcionarios: Funcionario[]
  hoteis: Hotel[]
  atendimentos: Atendimento[]
  politicas?: PoliticaCargo[]
}

export interface TravelAgentOps {
  addHotel?: (hotel: Omit<Hotel, 'id'>) => void
  createAtendimento?: (data: Omit<Atendimento, 'id' | 'created_at' | 'updated_at'>) => Atendimento | null
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
  cadastradas: HotelAISuggestion[]
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
  const quoteOptions = montarOpcoesCotacao({ pergunta, tipo, destino, origem, dataInicio, dataFim, hotelPlan, policy })
  const totalMin = minTotal(quoteOptions)
  const totalRecommended = recommendedTotal(quoteOptions)
  const approval = policy.requiresApproval
    ? addAgentApproval({
        status: 'pendente',
        requested_by_user_id: ops.currentUser?.id,
        approver_name: policy.approverName,
        empresa_id: empresa?.id,
        funcionario_id: funcionario?.id || null,
        amount: totalRecommended,
        reason: 'Cotacao gerada pela IA ficou fora de uma ou mais regras de politica.',
        policy_violations: policy.violations,
        payload: { pergunta, destino, dataInicio, dataFim, tipo },
      })
    : undefined

  const quote = addAgentQuote({
    empresa_id: empresa?.id,
    funcionario_id: funcionario?.id || null,
    destination: destino || undefined,
    start_date: dataInicio,
    end_date: dataFim,
    total_min: totalMin,
    total_recommended: totalRecommended,
    status: 'rascunho',
    options: quoteOptions,
    policy_violations: policy.violations,
    approval_id: approval?.id,
  })

  const atendimento = empresa && ops.createAtendimento
    ? ops.createAtendimento(montarAtendimento({
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
        totalRecommended,
        currentUserId: ops.currentUser?.id || 'ia-operacional',
        requiresApproval: policy.requiresApproval,
      }))
    : null

  criarTarefasOperacionais({
    atendimento,
    quoteId: quote.id,
    tipo,
    destino,
    dataInicio,
    requiresApproval: policy.requiresApproval,
    externalWarning: hotelPlan.externalWarning,
    prioridade,
  })

  salvarMemoriaSeAplicavel(pergunta, funcionario, empresa)

  const plan = [
    'Identificar viajante, empresa, centro de custo e politica aplicavel.',
    'Montar cotacao com a melhor opcao por custo-beneficio.',
    policy.requiresApproval ? 'Enviar excecao para aprovacao antes de emitir.' : 'Preparar reserva dentro da politica.',
    'Gerar voucher vinculado e iniciar monitoramento da viagem.',
  ]

  addAgentRun({
    input: pergunta,
    intent,
    status: policy.requiresApproval || hotelPlan.externalWarning ? 'pendente' : 'concluido',
    summary: `Cotacao ${quote.id} criada para ${destino || 'destino nao informado'}.`,
    plan,
    created_entities: [
      { type: 'cotacao', id: quote.id, label: 'Cotacao IA' },
      ...(approval ? [{ type: 'aprovacao', id: approval.id, label: 'Aprovacao pendente' }] : []),
      ...(atendimento ? [{ type: 'atendimento', id: atendimento.id, label: atendimento.passageiro_nome }] : []),
    ],
    blocked_by: [
      ...policy.violations,
      ...(hotelPlan.externalWarning ? [hotelPlan.externalWarning] : []),
    ],
  })

  return montarRespostaCotacao({
    empresa,
    funcionario,
    atendimento,
    quoteId: quote.id,
    approvalId: approval?.id,
    tipo,
    destino,
    dataInicio,
    dataFim,
    quoteOptions,
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

function responderRelatorio(pergunta: string, ctx: TravelAgentContext, intent: AgentIntent): TravelAgentResponse {
  const q = normalizarTexto(pergunta)
  const periodo = /mes passado/.test(q) ? 'mes_passado' : /ano/.test(q) ? 'ano' : 'mes_atual'
  const { inicio, fim } = rangePeriodo(periodo)
  const atendimentos = ctx.atendimentos.filter((a) => dataRegistro(a) >= inicio && dataRegistro(a) <= fim)
  const total = atendimentos.reduce((sum, a) => sum + valorAtendimento(a), 0)
  const porEmpresa = agrupar(atendimentos, (a) => ctx.empresas.find((e) => e.id === a.empresa_id)?.nome || 'Empresa sem cadastro')
  const porTipo = agrupar(atendimentos, (a) => a.tipo_servico)
  const urgentes = atendimentos.filter((a) => a.prioridade === 'urgente').length

  addAgentRun({
    input: pergunta,
    intent,
    status: 'concluido',
    summary: `Relatorio gerado para ${inicio} a ${fim}.`,
    plan: ['Ler demandas e vouchers da base unificada.', 'Cruzar valores por empresa e tipo.', 'Apontar riscos e proximas acoes.'],
  })

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

function responderIncidente(pergunta: string, ctx: TravelAgentContext, intent: AgentIntent, ops: TravelAgentOps): TravelAgentResponse {
  const funcionario = encontrarFuncionario(pergunta, {}, ctx.funcionarios)
  const atendimento = encontrarAtendimentoRelacionado(pergunta, ctx, funcionario)
  const prioridade: Prioridade = 'urgente'
  const task = addAgentTask({
    kind: intent === 'emergencia' ? 'emergencia' : 'integracao_externa',
    title: intent === 'emergencia' ? 'Incidente de viagem' : 'Alteracao/cancelamento de reserva',
    description: pergunta,
    status: 'pendente',
    priority: prioridade,
    requires_human: true,
    entity_type: atendimento ? 'atendimento' : undefined,
    entity_id: atendimento?.id,
    payload: { funcionario_id: funcionario?.id, operador: ops.currentUser?.id },
  })

  addAgentRun({
    input: pergunta,
    intent,
    status: 'pendente',
    summary: `Tarefa ${task.id} criada para atendimento emergencial.`,
    plan: ['Identificar reserva afetada.', 'Verificar politica e multas.', 'Buscar alternativas.', 'Escalar para humano antes de acao critica.'],
    created_entities: [{ type: 'tarefa', id: task.id, label: task.title }],
    blocked_by: ['Acoes criticas de cancelamento, multa ou remarcacao exigem validacao humana.'],
  })

  return {
    handled: true,
    title: intent === 'emergencia' ? 'Suporte emergencial' : 'Alteracao de reserva',
    badge: 'Escalado com prioridade urgente',
    message: [
      `Abri a tarefa operacional **${task.id}** como urgente.`,
      funcionario ? `Viajante identificado: ${funcionario.nome}.` : 'Nao identifiquei o viajante com confianca; a tarefa ficou aberta para triagem.',
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
    return { suggestions: [], cadastradas: [], summary: 'Hotel nao solicitado.', sources: [] }
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
      if (!suggestions.length) suggestions = fallbackHotels(destino, uf)
      summary = `${summary} Busca web indisponivel agora; deixei sugestoes operacionais para conferencia.`
    }
  }

  const cadastradas: HotelAISuggestion[] = []
  const podeCadastrar = Boolean(ops.addHotel) && /cadastre|cadastrar|incluir|sem hotel|nao tem|não tem|novo hotel|hospedagem/.test(normalizarTexto(pergunta))
  if (podeCadastrar) {
    suggestions
      .filter((s) => !hotelJaExiste(ctx.hoteis, s.nome, s.cidade, s.uf))
      .slice(0, 3)
      .forEach((s) => {
        ops.addHotel?.(sugestaoParaHotel(s))
        cadastradas.push(s)
      })
  }

  return { suggestions, cadastradas, summary, sources, externalWarning }
}

function montarOpcoesCotacao({
  pergunta,
  tipo,
  destino,
  origem,
  dataInicio,
  dataFim,
  hotelPlan,
  policy,
}: {
  pergunta: string
  tipo: TipoServico
  destino: string
  origem: string
  dataInicio: string
  dataFim?: string
  hotelPlan: HotelPlan
  policy: PolicyDecision
}): AgentQuoteOption[] {
  const options: AgentQuoteOption[] = []
  const dias = Math.max(1, dataFim ? diffDias(dataInicio, dataFim) : 1)
  const aereoSuppliers = fornecedoresOuFallback('aereo', ['Tech Travel / TTravel Connect'])
  const hotelSuppliers = fornecedoresOuFallback('hotelaria', ['Tech Travel / TTravel Connect'])
  const carroSuppliers = fornecedoresOuFallback('locacao', ['Tech Travel / TTravel Connect'])
  const pacoteSuppliers = fornecedoresOuFallback('pacotes', ['Tech Travel / TTravel Connect'])

  if (precisaAereo(pergunta, tipo)) {
    const base = estimarAereo(destino, dataInicio)
    const labels = ['Menor tarifa', 'Melhor custo-beneficio', 'Mais confortavel']
    const multipliers = [0.88, 1, 1.35]
    const advantages = ['Menor custo disponivel', 'Horario comercial, menor risco operacional', 'Voo direto e horario mais conveniente']
    const risks = ['Pode ter conexao, franquia menor ou horario ruim', 'Sujeito a disponibilidade no momento da emissao', 'Maior custo e possivel aprovacao']
    aereoSuppliers.slice(0, 3).forEach((supplier, index) => {
      options.push(option('aereo', labels[index], supplier.nome, base * multipliers[index], advantages[index], risks[index], policyStatus(policy), supplierPayload(supplier)))
    })
  }

  if (precisaHotel(pergunta, tipo)) {
    const hotels = hotelPlan.suggestions.length ? hotelPlan.suggestions : fallbackHotels(destino, extrairUF(pergunta))
    hotels.slice(0, 3).forEach((h, index) => {
      const diaria = h.tarifa_sgl || h.tarifa_dbl || estimarDiariaHotel(destino, index)
      const supplier = hotelSuppliers[index % hotelSuppliers.length]
      options.push(option(
        'hotel',
        index === 0 ? 'Hotel recomendado' : `Hotel opcao ${index + 1}`,
        supplier ? `${supplier.nome} - ${h.nome}` : h.nome,
        diaria * dias,
        h.telefone ? `Contato localizado: ${h.telefone}` : 'Perfil corporativo para conferencia',
        h.confianca === 'baixa' ? 'Telefone/tarifa precisam conferencia' : 'Confirmar disponibilidade antes de emitir',
        policyStatus(policy),
        { cidade: h.cidade, uf: h.uf, telefone: h.telefone, noites: dias, diaria, fornecedor: supplierPayload(supplier) },
      ))
    })
  }

  if (precisaCarro(pergunta, tipo)) {
    const base = 210 * dias
    carroSuppliers.slice(0, 2).forEach((supplier, index) => {
      options.push(option(
        'carro',
        index === 0 ? 'Locacao economica' : 'Locacao executiva',
        supplier.nome,
        base * (index === 0 ? 1 : 1.45),
        index === 0 ? 'Categoria economica e bom custo' : 'Maior conforto para agenda intensa',
        index === 0 ? 'Confirmar franquia e horario de retirada' : 'Maior custo',
        policyStatus(policy),
        supplierPayload(supplier),
      ))
    })
  }

  if (tipo === 'Pacote' || /lazer|pacote|operadora/.test(normalizarTexto(pergunta))) {
    pacoteSuppliers.slice(0, 3).forEach((supplier, index) => {
      const base = 1400 + index * 420
      options.push(option(
        'pacote',
        index === 0 ? 'Pacote recomendado' : `Pacote opcao ${index + 1}`,
        supplier.nome,
        base,
        'Operadora/consolidadora habilitada nas Configuracoes de fornecedores',
        'Confirmar disponibilidade, regras de cancelamento e comissionamento',
        policyStatus(policy),
        supplierPayload(supplier),
      ))
    })
  }

  if (!options.length) {
    options.push(option('pacote', 'Triagem operacional', origem || destino || 'BBT', 0, 'Dados ainda incompletos', 'IA precisa de origem, destino, datas e passageiro', 'requer_aprovacao'))
  }

  return options
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
  totalRecommended,
  currentUserId,
  requiresApproval,
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
  totalRecommended: number
  currentUserId: string
  requiresApproval: boolean
}): Omit<Atendimento, 'id' | 'created_at' | 'updated_at'> {
  const passageiro = parsed.passageiro_nome || funcionario?.nome || extrairNomeLivre(pergunta) || 'Passageiro nao informado'
  return {
    empresa_id: empresa.id,
    funcionario_id: funcionario?.id || null,
    passageiro_nome: passageiro,
    tipo_servico: tipo,
    valor_cotacao: totalRecommended,
    valor_final: totalRecommended,
    valor_custo: 0,
    valor_venda: totalRecommended,
    agente_user_id: currentUserId,
    status: requiresApproval ? 'pendente' : 'em_andamento',
    prioridade,
    origem: 'Outro',
    observacoes: [
      `Demanda criada pela ${AI_NAME}.`,
      pergunta,
      requiresApproval ? 'Status: aguardando aprovacao de politica.' : 'Status: preparada para reserva/emissao.',
    ].join('\n\n'),
    data_atendimento: todayISODate(),
    origem_emissao: 'caixa_entrada',
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

function criarTarefasOperacionais({
  atendimento,
  quoteId,
  tipo,
  destino,
  dataInicio,
  requiresApproval,
  externalWarning,
  prioridade,
}: {
  atendimento: Atendimento | null
  quoteId: string
  tipo: TipoServico
  destino: string
  dataInicio: string
  requiresApproval: boolean
  externalWarning?: string
  prioridade: Prioridade
}) {
  addAgentTask({
    kind: 'cotacao',
    title: 'Cotacao inteligente criada',
    description: `Cotacao ${quoteId} para ${destino || 'destino nao informado'}.`,
    status: 'concluida',
    priority: prioridade,
    requires_human: false,
    entity_type: 'cotacao',
    entity_id: quoteId,
  })
  if (requiresApproval) {
    addAgentTask({
      kind: 'aprovacao',
      title: 'Aprovacao de politica pendente',
      description: 'A cotacao tem excecao de politica e deve ser aprovada antes da emissao.',
      status: 'pendente',
      priority: prioridade,
      requires_human: true,
      entity_type: atendimento ? 'atendimento' : 'cotacao',
      entity_id: atendimento?.id || quoteId,
      due_at: dataInicio,
    })
  }
  if (tipo === 'Hotel' || tipo === 'Pacote') {
    addAgentTask({
      kind: 'reserva_hotel',
      title: 'Reservar hotel',
      description: externalWarning || 'Confirmar disponibilidade, tarifa, faturamento e prazo de cancelamento.',
      status: 'pendente',
      priority: prioridade,
      requires_human: Boolean(externalWarning),
      entity_type: atendimento ? 'atendimento' : 'cotacao',
      entity_id: atendimento?.id || quoteId,
      due_at: dataInicio,
    })
  }
  if (tipo === 'Aéreo' || tipo === 'Pacote') {
    addAgentTask({
      kind: 'reserva_aereo',
      title: 'Preparar emissao aerea',
      description: 'Validar horario, bagagem, politica e forma de pagamento antes de emitir.',
      status: 'pendente',
      priority: prioridade,
      requires_human: requiresApproval,
      entity_type: atendimento ? 'atendimento' : 'cotacao',
      entity_id: atendimento?.id || quoteId,
      due_at: dataInicio,
    })
  }
  addAgentTask({
    kind: 'voucher',
    title: 'Gerar voucher vinculado',
    description: 'Gerar e enviar voucher apos confirmacao/reserva.',
    status: 'pendente',
    priority: prioridade,
    requires_human: false,
    entity_type: atendimento ? 'atendimento' : 'cotacao',
    entity_id: atendimento?.id || quoteId,
  })
  addAgentTask({
    kind: 'monitoramento',
    title: 'Monitorar viagem',
    description: 'Acompanhar status, check-in, atraso, cancelamento e risco operacional ate o retorno.',
    status: 'pendente',
    priority: prioridade,
    requires_human: false,
    entity_type: atendimento ? 'atendimento' : 'cotacao',
    entity_id: atendimento?.id || quoteId,
    due_at: dataInicio,
  })
}

function montarRespostaCotacao({
  empresa,
  funcionario,
  atendimento,
  quoteId,
  approvalId,
  tipo,
  destino,
  dataInicio,
  dataFim,
  quoteOptions,
  policy,
  hotelPlan,
}: {
  empresa?: Empresa
  funcionario?: Funcionario
  atendimento: Atendimento | null
  quoteId: string
  approvalId?: string
  tipo: TipoServico
  destino: string
  dataInicio: string
  dataFim?: string
  quoteOptions: AgentQuoteOption[]
  policy: PolicyDecision
  hotelPlan: HotelPlan
}): TravelAgentResponse {
  const recomendado = quoteOptions.find((o) => /custo-beneficio|recomendado/i.test(o.label)) || quoteOptions[0]
  const pendencias = [
    !empresa ? 'Confirmar empresa para aplicar politica, centro de custo e aprovador correto.' : '',
    !funcionario ? 'Confirmar ou cadastrar o viajante para vincular a demanda ao perfil certo.' : '',
    policy.violations.length ? `Revisar politica: ${policy.violations.join(' ')}` : '',
    hotelPlan.externalWarning ? `Conferir busca externa: ${hotelPlan.externalWarning}` : '',
  ].filter(Boolean)

  return {
    handled: true,
    title: 'Cotação preparada',
    badge: policy.requiresApproval ? 'Precisa revisar política' : 'Pronta para revisão',
    message: [
      'Preparei uma cotação inicial para essa viagem.',
      '',
      'Resumo',
      `Empresa: ${empresa?.nome || 'preciso confirmar'}.`,
      `Viajante: ${funcionario ? `${funcionario.nome}${funcionario.cargo ? ` (${funcionario.cargo})` : ''}` : 'preciso confirmar ou cadastrar'}.`,
      `Serviço: ${tipo}.`,
      `Destino: ${destino || 'não informado'}.`,
      `Período: ${formatarData(dataInicio)}${dataFim ? ` até ${formatarData(dataFim)}` : ''}.`,
      '',
      recomendado
        ? [
            'Melhor opção inicial',
            `${recomendado.provider} - ${dinheiro(recomendado.price)}.`,
            `Motivo: ${recomendado.advantage}. Risco: ${recomendado.risk}.`,
          ].join('\n')
        : '',
      '',
      pendencias.length
        ? ['Antes de emitir', ...pendencias.map((item) => `- ${item}`)].join('\n')
        : 'Política: dentro das regras conhecidas. Pode seguir para reserva/voucher depois da conferência operacional.',
      hotelPlan.cadastradas.length ? `Cadastrei ${hotelPlan.cadastradas.length} hotel(is) novo(s) no módulo Hotéis.` : '',
      '',
      [
        'Próximos passos',
        '- Conferir empresa, viajante, datas e política.',
        policy.requiresApproval
          ? '- Aprovação registrada para revisão antes da emissão.'
          : '- Seguir para reserva e voucher quando a opção for confirmada.',
        '- Manter monitoramento da viagem depois da confirmação.',
      ].join('\n'),
    ]
      .filter(Boolean)
      .join('\n'),
    links: [
      { label: `Painel da ${AI_NAME}`, href: '/dashboard/ia?tab=operacional', kind: 'primary' },
      ...(atendimento ? [{ label: 'Criar voucher', href: `/dashboard/vouchers/novo?atendimento=${atendimento.id}`, kind: 'secondary' as const }] : []),
      { label: 'Reservas e cotacoes', href: '/dashboard/reservas', kind: 'secondary' },
      { label: 'Abrir demandas', href: '/dashboard/demandas', kind: 'secondary' },
      { label: 'Abrir hoteis', href: `/dashboard/hoteis?busca=${encodeURIComponent(destino || '')}`, kind: 'secondary' },
    ],
    cards: quoteOptions.slice(0, 6).map((o) => ({
      title: o.label,
      subtitle: `${o.provider} - ${dinheiro(o.price)}`,
      meta: `${o.advantage} | Risco: ${o.risk}`,
    })),
    sources: hotelPlan.sources,
    provedor: 'sistema',
  }
}

function salvarMemoriaSeAplicavel(pergunta: string, funcionario?: Funcionario, empresa?: Empresa) {
  if (!funcionario) return
  const q = normalizarTexto(pergunta)
  const preferencias: string[] = []
  if (/corredor/.test(q)) preferencias.push('Prefere assento no corredor.')
  if (/janela/.test(q)) preferencias.push('Prefere assento na janela.')
  if (/bagagem/.test(q)) preferencias.push('Costuma precisar de bagagem despachada.')
  if (/cafe|café/.test(q)) preferencias.push('Valoriza cafe da manha incluso.')
  if (/hotel perto|proximo|próximo/.test(q)) preferencias.push('Prioriza hotel perto do compromisso.')
  if (!preferencias.length) return

  upsertAgentMemory({
    entity_type: 'funcionario',
    entity_id: funcionario.id,
    key: 'preferencias_viagem',
    value: preferencias.join(' '),
    source: 'mensagem do agente IA',
    confidence: 'media',
  })
  if (empresa) {
    upsertAgentMemory({
      entity_type: 'empresa',
      entity_id: empresa.id,
      key: 'preferencias_operacionais',
      value: `Preferencia observada em demanda de ${funcionario.nome}: ${preferencias.join(' ')}`,
      source: 'mensagem do agente IA',
      confidence: 'baixa',
    })
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

function fornecedoresOuFallback(service: 'aereo' | 'hotelaria' | 'locacao' | 'pacotes', nomes: string[]): SupplierIntegration[] {
  const configured = selectSuppliersForService(service, 6)
  if (configured.length) return configured
  return nomes.map((nome, index) => ({
    id: nome.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    nome,
    tipo: 'outro',
    servicos: [service],
    capacidades: ['pesquisa', 'cotacao', 'reserva', 'voucher', 'status'],
    modo: 'portal_assistido',
    status: 'pendente_configuracao',
    prioridade: 50 - index,
    auth_type: 'portal',
    created_at: new Date().toISOString(),
  }))
}

function supplierPayload(supplier?: SupplierIntegration): Record<string, any> | undefined {
  if (!supplier) return undefined
  return {
    fornecedor_id: supplier.id,
    fornecedor_nome: supplier.nome,
    fornecedor_modo: supplier.modo,
    fornecedor_status: supplier.status,
    portal_url: supplier.portal_url,
    capacidades: supplier.capacidades,
  }
}

function option(
  service: AgentQuoteOption['service'],
  label: string,
  provider: string,
  price: number,
  advantage: string,
  risk: string,
  policy_status: AgentQuoteOption['policy_status'],
  payload?: Record<string, any>,
): AgentQuoteOption {
  return {
    id: `opt-${service}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    service,
    provider,
    price: Math.round(price),
    currency: 'BRL',
    advantage,
    risk,
    policy_status,
    payload,
  }
}

function policyStatus(policy: PolicyDecision): AgentQuoteOption['policy_status'] {
  if (policy.requiresApproval) return 'requer_aprovacao'
  if (policy.violations.length) return 'fora'
  return 'dentro'
}

function minTotal(options: AgentQuoteOption[]): number {
  const byService = new Map<string, number>()
  options.filter((o) => o.price > 0).forEach((o) => {
    byService.set(o.service, Math.min(byService.get(o.service) ?? Number.POSITIVE_INFINITY, o.price))
  })
  return Array.from(byService.values()).reduce((sum, value) => sum + value, 0)
}

function recommendedTotal(options: AgentQuoteOption[]): number {
  return options
    .filter((o) => /custo-beneficio|recomendado|economica/i.test(o.label))
    .reduce((sum, o) => sum + o.price, 0) || options.reduce((sum, o) => sum + o.price, 0)
}

function estimarAereo(destino: string, dataInicio: string): number {
  const key = normalizarTexto(destino)
  const base: Record<string, number> = {
    brasilia: 820,
    'sao paulo': 980,
    'rio de janeiro': 1120,
    recife: 1550,
    'campo grande': 1320,
    goiania: 620,
  }
  const dias = diffDias(todayISODate(), dataInicio)
  const urgency = dias <= 3 ? 1.35 : dias <= 7 ? 1.18 : 1
  return (base[key] || 1100) * urgency
}

function estimarDiariaHotel(destino: string, index: number): number {
  const key = normalizarTexto(destino)
  const base: Record<string, number> = {
    brasilia: 390,
    'sao paulo': 520,
    'rio de janeiro': 560,
    recife: 420,
    'campo grande': 360,
    goiania: 340,
  }
  return (base[key] || 330) * (index === 0 ? 1 : index === 1 ? 0.85 : 1.2)
}

function hotelParaSugestao(h: Hotel): HotelAISuggestion {
  return {
    nome: h.nome,
    cidade: h.cidade,
    uf: h.uf,
    categoria: h.categoria,
    observacoes: h.observacoes,
    telefone: h.telefone,
    faturado: h.faturado,
    info_faturamento: h.info_faturamento,
    bebedouro: h.bebedouro,
    valor_agua: h.valor_agua,
    cafe_manha: h.cafe_manha,
    estacionamento: h.estacionamento,
    tarifa_sgl: h.tarifa_sgl,
    tarifa_dbl: h.tarifa_dbl,
    tarifa_tpl: h.tarifa_tpl,
    formas_pagamento: h.formas_pagamento,
    confianca: 'alta',
  }
}

function fallbackHotels(destino: string, uf: string): HotelAISuggestion[] {
  const cidade = destino || 'Destino nao informado'
  const names = [
    `Hotel corporativo ${cidade}`,
    `ibis ${cidade}`,
    `Comfort Hotel ${cidade}`,
  ]
  return names.map((nome, index) => ({
    nome,
    cidade,
    uf: uf || CITY_UF[normalizarTexto(cidade)] || '',
    observacoes: 'Sugestao local para triagem. Confirmar telefone, tarifa e disponibilidade.',
    telefone: null,
    faturado: false,
    info_faturamento: null,
    bebedouro: null,
    valor_agua: null,
    cafe_manha: null,
    estacionamento: null,
    tarifa_sgl: estimarDiariaHotel(cidade, index),
    tarifa_dbl: null,
    tarifa_tpl: null,
    formas_pagamento: ['CC', 'PX'],
    fonte_url: `https://www.google.com/search?q=${encodeURIComponent(`${nome} telefone`)}`,
    fonte_titulo: 'Busca Google para conferencia',
    confianca: 'baixa',
  }))
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

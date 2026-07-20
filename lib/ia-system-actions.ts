import { todayISODate } from '@/lib/date'
import type { Atendimento, Empresa, Funcionario, Hotel, PoliticaCargo, VoucherEmitido } from '@/types'
import { chatComIA, parseMensagemComIA, type ChatContext, type ProvedorIA } from '@/lib/ia-parser'
import { aiErrorUserMessage } from '@/lib/ai-friendly-errors'
import { humanizeAIResponse, humanizeAIText } from '@/lib/ai-humanize'
import { buscarHoteisComIA, hotelJaExiste, normalizarTexto, sugestaoParaHotel, type HotelAISuggestion } from '@/lib/ia-hotel-search'
import { getAllAtendimentos } from '@/lib/atendimentos-storage'
import { getAllVouchersEmitidos } from '@/lib/vouchers-emitidos-storage'
import { buildUnifiedIndex, searchUnifiedIndex, type UnifiedEntity } from '@/lib/unified-search'
import { runTravelAgent, shouldHandleTravelAgent } from '@/lib/ai-travel-orchestrator'
import { deveUsarPesquisaTempoReal, pesquisarWebComIA } from '@/lib/ia-web-search'
import { AI_NAME } from '@/lib/branding'
import { encontrarFuncionarioConfiavel, encontrarFuncionarioPorNomeInteligente } from '@/lib/funcionario-identidade'
import {
  getSupplierIntegrations,
  prepararAcaoFornecedor,
  selectSuppliersForService,
  supplierSummaryForAI,
  type SupplierService,
} from '@/lib/supplier-integrations'

export interface SystemAIContext {
  empresas: Empresa[]
  funcionarios: Funcionario[]
  hoteis: Hotel[]
  atendimentos: Atendimento[]
  vouchers: VoucherEmitido[]
  unifiedIndex: UnifiedEntity[]
  fornecedores: ReturnType<typeof supplierSummaryForAI>
  politicas?: PoliticaCargo[]
}

export interface SystemAILink {
  label: string
  href: string
  kind?: 'primary' | 'secondary' | 'download'
}

export interface SystemAICard {
  title: string
  subtitle?: string
  meta?: string
  href?: string
}

export interface SystemAIResponse {
  handled: boolean
  title?: string
  message: string
  badge?: string
  links?: SystemAILink[]
  cards?: SystemAICard[]
  sources?: Array<{ title?: string; uri?: string }>
  provedor?: ProvedorIA | 'sistema'
}

interface SystemAIOps {
  addHotel?: (hotel: Omit<Hotel, 'id'>) => void
  createAtendimento?: (data: Omit<Atendimento, 'id' | 'created_at' | 'updated_at'>) => Atendimento | null
  currentUser?: { id: string; name?: string }
  politicas?: PoliticaCargo[]
  allowInternet?: boolean
}

export function buildSystemContext(params: {
  empresas: Empresa[]
  funcionarios: Funcionario[]
  hoteis: Hotel[]
  politicas?: PoliticaCargo[]
}): SystemAIContext {
  const base = {
    empresas: params.empresas,
    funcionarios: params.funcionarios,
    hoteis: params.hoteis,
    atendimentos: typeof window === 'undefined' ? [] : getAllAtendimentos(),
    vouchers: typeof window === 'undefined' ? [] : getAllVouchersEmitidos(),
    fornecedores: typeof window === 'undefined' ? [] : supplierSummaryForAI(),
    politicas: params.politicas || [],
  }
  return {
    ...base,
    unifiedIndex: buildUnifiedIndex(base),
  }
}

export async function responderComIASistema(
  pergunta: string,
  ctx: SystemAIContext,
  ops: SystemAIOps = {},
): Promise<SystemAIResponse> {
  const q = pergunta.trim()
  const done = (response: SystemAIResponse): SystemAIResponse => humanizeAIResponse(response)
  if (!q) return done({ handled: true, message: 'Me diga o que voce precisa localizar ou analisar.' })

  const voucherResponse = localizarVoucher(q, ctx)
  if (voucherResponse) return done(voucherResponse)

  const funcionarioResponse = localizarFuncionario(q, ctx)
  if (funcionarioResponse) return done(funcionarioResponse)

  const demandaResponse = localizarDemanda(q, ctx)
  if (demandaResponse) return done(demandaResponse)

  const fornecedorResponse = fluxoFornecedor(q, ctx)
  if (fornecedorResponse) return done(fornecedorResponse)

  const reservaHotelResponse = await fluxoReservaTech(q, ctx, ops)
  if (reservaHotelResponse) return done(reservaHotelResponse)

  if (shouldHandleTravelAgent(q)) {
    const agentResponse = await runTravelAgent(q, ctx, { ...ops, politicas: ops.politicas || ctx.politicas })
    if (agentResponse.handled) return done(agentResponse)
  }

  const criarDemandaResponse = await fluxoCriarDemanda(q, ctx, ops)
  if (criarDemandaResponse) return done(criarDemandaResponse)

  const criarVoucherResponse = fluxoCriarVoucher(q, ctx)
  if (criarVoucherResponse) return done(criarVoucherResponse)

  const hotelResponse = await fluxoHotelInteligente(q, ctx, ops)
  if (hotelResponse) return done(hotelResponse)

  const pesquisaResponse = await fluxoPesquisaTempoReal(q, ops)
  if (pesquisaResponse) return done(pesquisaResponse)

  return done({ handled: false, message: '' })
}

export async function responderChatSistema(
  historico: Array<{ role: 'user' | 'assistant'; content: string }>,
  ctx: SystemAIContext,
  options: { allowInternet?: boolean } = {},
): Promise<SystemAIResponse> {
  const contexto = buildChatContext(ctx, historico[historico.length - 1]?.content || '')
  try {
    const r = await chatComIA(historico, contexto, { enableSearch: options.allowInternet ?? true })
    const message = r.resposta || respostaLocalDeContinuidade(contexto, r.erro)
    return humanizeAIResponse({
      handled: true,
      message,
      provedor: r.provedor || 'sistema',
      badge: r.modoLocal ? 'Modo interno' : r.provedor === 'gemini' ? 'Gemini + Google' : r.provedor === 'openai' ? 'GPT-5.2' : r.provedor,
      sources: r.sources || [],
    })
  } catch (e: any) {
    return humanizeAIResponse({
      handled: true,
      message: respostaLocalDeContinuidade(contexto, aiErrorUserMessage(e, e?.provedor || 'ia')),
      provedor: 'sistema',
      badge: 'Modo interno',
      sources: [],
    })
  }
}

export function buildChatContext(ctx: SystemAIContext, pergunta = ''): ChatContext {
  const pendentes = ctx.atendimentos.filter((a) =>
    ['pendente', 'em_andamento', 'aguardando_cliente'].includes(a.status),
  )
  const urgentes = pendentes.filter((a) => a.prioridade === 'urgente').length
  const hoje = new Date()
  const tresDias = new Date(hoje.getTime() + 3 * 86400000)
  const proximoCheckin = pendentes.filter((a) => {
    const data =
      a.detalhes_aereo?.data_ida ||
      a.detalhes_hotel?.data_checkin ||
      a.detalhes_carro?.data_retirada ||
      a.detalhes_pacote?.data_ida
    if (!data) return false
    const d = new Date(data + 'T00:00:00')
    return d >= hoje && d <= tresDias
  }).length

  const mesAtual = hoje.getMonth()
  const anoAtual = hoje.getFullYear()
  const valorTotalMes = ctx.atendimentos
    .filter((a) => {
      const d = new Date(a.created_at)
      return d.getMonth() === mesAtual && d.getFullYear() === anoAtual
    })
    .reduce((s, a) => s + valorAtendimento(a), 0)
  const mesAnt = new Date(anoAtual, mesAtual - 1, 1)
  const valorTotalMesAnt = ctx.atendimentos
    .filter((a) => {
      const d = new Date(a.created_at)
      return d.getMonth() === mesAnt.getMonth() && d.getFullYear() === mesAnt.getFullYear()
    })
    .reduce((s, a) => s + valorAtendimento(a), 0)

  const ticket =
    ctx.atendimentos.length > 0
      ? ctx.atendimentos.reduce((s, a) => s + valorAtendimento(a), 0) / ctx.atendimentos.length
      : 0

  const porTipo: Record<string, number> = {}
  ctx.atendimentos.forEach((a) => {
    porTipo[a.tipo_servico] = (porTipo[a.tipo_servico] || 0) + 1
  })

  const empresaTopId = topBy(ctx.atendimentos.map((a) => a.empresa_id))
  const empresaTop = empresaTopId ? ctx.empresas.find((e) => e.id === empresaTopId)?.nome : undefined
  const query = normalizarTexto(pergunta)
  const termos = query.split(' ').filter((t) => t.length > 2)
  const match = (text: string) => termos.some((t) => normalizarTexto(text).includes(t))
  const baseUnificada = searchUnifiedIndex(pergunta, ctx.unifiedIndex, 15)

  return {
    total_demandas: ctx.atendimentos.length,
    demandas_pendentes: pendentes.length,
    demandas_urgentes: urgentes,
    demandas_proximo_checkin: proximoCheckin,
    total_empresas: ctx.empresas.length,
    total_funcionarios: ctx.funcionarios.length,
    ticket_medio: ticket,
    faturamento_mes: valorTotalMes,
    faturamento_mes_anterior: valorTotalMesAnt,
    por_tipo: porTipo,
    empresa_top: empresaTop,
    demandas_recentes: ctx.atendimentos
      .filter((a) => !termos.length || match(`${a.passageiro_nome} ${a.observacoes} ${a.detalhes_hotel?.cidade || ''} ${a.detalhes_aereo?.destino || ''}`))
      .slice(0, 12)
      .map((a) => ({
        id: a.id,
        serial_os: a.serial_os,
        passageiro: a.passageiro_nome,
        tipo: a.tipo_servico,
        status: a.status,
        prioridade: a.prioridade,
        empresa: ctx.empresas.find((e) => e.id === a.empresa_id)?.nome,
        data: a.detalhes_hotel?.data_checkin || a.detalhes_aereo?.data_ida || a.data_atendimento,
        destino: a.detalhes_hotel?.cidade || a.detalhes_aereo?.destino || a.detalhes_pacote?.destino,
      })),
    empresas_relevantes: ctx.empresas
      .filter((e) => !termos.length || match(`${e.nome} ${e.cnpj} ${e.responsavel}`))
      .slice(0, 10)
      .map((e) => ({ id: e.id, nome: e.nome, cnpj: e.cnpj, responsavel: e.responsavel, telefone: e.telefone })),
    funcionarios_relevantes: ctx.funcionarios
      .filter((f) => !termos.length || match(`${f.nome} ${f.cpf} ${f.email} ${f.telefone}`))
      .slice(0, 12)
      .map((f) => ({
        id: f.id,
        nome: f.nome,
        cpf: f.cpf,
        email: f.email,
        telefone: f.telefone,
        empresa: ctx.empresas.find((e) => e.id === f.company_id)?.nome,
        cargo: f.cargo,
        centro_custo: f.centro_custo,
      })),
    vouchers_relevantes: ctx.vouchers
      .filter((v) => !termos.length || match(`${v.id} ${v.passageiro_nome} ${v.fornecedor_nome} ${v.fornecedor_cidade || ''} ${v.destino || ''}`))
      .slice(0, 12)
      .map((v) => ({
        id: v.id,
        passageiro: v.passageiro_nome,
        fornecedor: v.fornecedor_nome,
        cidade: v.fornecedor_cidade || v.destino,
        checkin: v.data_checkin || v.data_ida || v.retirada_data,
        checkout: v.data_checkout || v.data_volta || v.devolucao_data,
        total: v.total,
        empresa: ctx.empresas.find((e) => e.id === v.empresa_id)?.nome,
      })),
    hoteis_relevantes: ctx.hoteis
      .filter((h) => !termos.length || match(`${h.nome} ${h.cidade} ${h.uf} ${h.telefone || ''}`))
      .slice(0, 12)
      .map((h) => ({ id: h.id, nome: h.nome, cidade: h.cidade, uf: h.uf, telefone: h.telefone, faturado: h.faturado })),
    fornecedores_relevantes: (ctx.fornecedores || [])
      .filter((s) => !termos.length || match(`${s.nome} ${s.tipo} ${s.status} ${s.modo} ${s.servicos.join(' ')} ${s.capacidades.join(' ')}`))
      .slice(0, 12),
    base_unificada: baseUnificada.map((item) => ({
      tipo: item.kind,
      id: item.id,
      titulo: item.title,
      subtitulo: item.subtitle,
      link: item.href,
      dados: item.payload,
    })),
  } as ChatContext
}

function respostaLocalDeContinuidade(ctx: ChatContext, aviso?: string): string {
  const linhas = [
    aviso ? humanizeAIText(aviso) : '',
    'Mesmo assim, consultei a base interna e posso seguir com a operação.',
    '',
    `Resumo do sistema: ${ctx.demandas_pendentes ?? 0} demanda(s) ativa(s), ${ctx.demandas_urgentes ?? 0} urgente(s), ${ctx.total_empresas ?? 0} empresa(s), ${ctx.total_funcionarios ?? 0} funcionário(s) e ${ctx.vouchers_relevantes?.length ?? 0} voucher(es) relevantes para a busca.`,
  ]

  const itens = [
    ...(ctx.base_unificada || []).slice(0, 5).map((item: any) => `${item.tipo}: ${item.titulo}${item.subtitulo ? ` - ${item.subtitulo}` : ''}`),
  ]

  if (itens.length) {
    linhas.push('', 'Itens relacionados encontrados:', ...itens.map((item) => `- ${item}`))
  }

  linhas.push('', 'Me diga a ação exata que você quer: localizar, abrir, criar voucher, preparar cotação, gerar resumo ou acionar fornecedor.')
  return humanizeAIText(linhas.filter(Boolean).join('\n'))
}

function fluxoFornecedor(pergunta: string, ctx: SystemAIContext): SystemAIResponse | null {
  const q = normalizarTexto(pergunta)
  if (!/(fornecedor|conector|integracao|integração|operadora|consolidadora|tech|ttravel|gds|ndc)/.test(q)) {
    return null
  }

  const service = inferirServicoFornecedor(q)
  const all = getSupplierIntegrations()
  const fornecedores = service
    ? selectSuppliersForService(service, 8)
    : all.filter((s) => q.includes(normalizarTexto(s.nome)) || q.includes(s.id) || s.servicos.some((serv) => q.includes(serv))).slice(0, 10)
  const lista = fornecedores.length ? fornecedores : all.slice(0, 10)

  const wantsAction = /(cotar|cotacao|cotação|reservar|reserva|emitir|emissao|emissão|status|testar|consultar|pesquisar)/.test(q)
  const actionLogs = wantsAction && service
    ? prepararAcaoFornecedor({
        service,
        action: /emitir|emissao|emissão/.test(q)
          ? 'emissao'
          : /reservar|reserva/.test(q)
          ? 'reserva'
          : /status|testar/.test(q)
          ? 'status'
          : 'cotacao',
        destino: extrairDestino(pergunta) || undefined,
        data_inicio: extrairData(pergunta) || undefined,
        payload: { pergunta },
      })
    : []

  const ativos = all.filter((s) => s.status === 'ativo').length
  const apiPendentes = all.filter((s) => s.modo === 'api' && s.status === 'pendente_configuracao').length

  return {
    handled: true,
    title: 'Hub de fornecedores',
    badge: service ? `Servico: ${service}` : 'Catalogo conectado',
    message: [
      `Tenho ${all.length} fornecedor(es) configurados no hub: ${ativos} ativo(s) e ${apiPendentes} aguardando credenciais/API.`,
      service ? `Para ${serviceLabelIA(service)}, vou priorizar: ${lista.map((s) => s.nome).slice(0, 6).join(', ')}.` : '',
      actionLogs.length
        ? `Preparei ${actionLogs.length} acao(oes) operacional(is) em Reservas e cotacoes para voce revisar e seguir.`
        : 'Posso preparar cotacao, reserva, emissao, voucher, importacao e consulta de status conforme a capacidade de cada fornecedor.',
      '',
      'Quando houver API contratada, a execucao fica automatica. Quando o fornecedor operar por portal, deixo o rascunho pronto e abro o fluxo assistido para o operador confirmar sem inventar tarifa ou reserva.',
    ]
      .filter(Boolean)
      .join('\n'),
    links: [
      { label: 'Abrir Reservas e cotacoes', href: '/dashboard/reservas', kind: 'primary' },
      { label: 'Configurar fornecedores', href: '/dashboard/configuracoes', kind: 'secondary' },
      { label: 'Abrir Central IA BIA', href: '/dashboard/ia', kind: 'secondary' },
    ],
    cards: lista.slice(0, 8).map((s) => ({
      title: s.nome,
      subtitle: `${s.servicos.map(serviceLabelIA).join(', ')} - ${s.modo} - ${s.status}`,
      meta: `Capacidades: ${s.capacidades.join(', ')}`,
      href: '/dashboard/reservas',
    })),
    provedor: 'sistema',
  }
}

async function fluxoCriarDemanda(pergunta: string, ctx: SystemAIContext, ops: SystemAIOps): Promise<SystemAIResponse | null> {
  if (!/(criar|nova|novo|lancar|lançar|cadastrar|registrar|abrir).{0,35}(demanda|atendimento|solicitacao|solicitação)|chegou uma demanda|demanda de/i.test(pergunta)) {
    return null
  }

  if (!ops.createAtendimento || !ops.currentUser) {
    return {
      handled: true,
      title: 'Criar demanda',
      badge: 'Ação disponível',
      message:
        'Consigo interpretar a demanda e abrir o cadastro. Para salvar automaticamente, use o popup rápido da IA no dashboard, que tem acesso de gravação ao sistema.',
      links: [{ label: 'Abrir Caixa de Entrada', href: '/dashboard/caixa-entrada', kind: 'primary' }],
      provedor: 'sistema',
    }
  }

  const parsed = await parseMensagemComIA(pergunta)
  const funcionario = parsed.passageiro_nome
    ? melhorFuncionarioNaPergunta(parsed.passageiro_nome, ctx.funcionarios)
    : melhorFuncionarioNaPergunta(pergunta, ctx.funcionarios)
  const empresaPorNome = melhorEmpresaNaPergunta(parsed.empresa_nome || parsed.empresa_faturar || pergunta, ctx.empresas)
  const empresa = funcionario ? ctx.empresas.find((e) => e.id === funcionario.company_id) || empresaPorNome : empresaPorNome

  if (!empresa) {
    return {
      handled: true,
      title: 'Falta empresa',
      badge: 'Demanda interpretada',
      message: [
        'Entendi a solicitação, mas não encontrei uma empresa confiável para vincular.',
        parsed.passageiro_nome ? `Passageiro: ${parsed.passageiro_nome}.` : '',
        parsed.cidade_destino ? `Destino: ${parsed.cidade_destino}.` : '',
        'Informe a empresa na frase ou cadastre o funcionário para eu criar a demanda automaticamente.',
      ]
        .filter(Boolean)
        .join('\n'),
      links: [{ label: 'Abrir Empresas', href: '/dashboard/empresas', kind: 'secondary' }],
      provedor: parsed.provedor || 'sistema',
    }
  }

  const tipo = normalizarTipoServicoIA(parsed.tipo_servico || inferirTipoServico(pergunta))
  const passageiro = parsed.passageiro_nome || funcionario?.nome || extrairNomeGenerico(pergunta) || 'Passageiro não informado'
  const atendimento = ops.createAtendimento({
    empresa_id: empresa.id,
    funcionario_id: funcionario?.id || null,
    passageiro_nome: passageiro,
    tipo_servico: tipo as any,
    valor_cotacao: parsed.valor_diaria || 0,
    valor_final: parsed.valor_diaria || 0,
    valor_custo: 0,
    valor_venda: parsed.valor_diaria || 0,
    agente_user_id: ops.currentUser.id,
    status: 'pendente',
    prioridade: parsed.urgente ? 'urgente' : 'media',
    origem: 'Outro',
    observacoes: [
    parsed.ia_resumo || `Demanda criada pela ${AI_NAME}.`,
      pergunta,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 900),
    data_atendimento: todayISODate(),
    origem_emissao: 'caixa_entrada',
    centro_custo: parsed.centro_custo || funcionario?.centro_custo || undefined,
    contato_passageiro: parsed.telefone || parsed.solicitante_email || undefined,
    detalhes_hotel:
      tipo === 'Hotel'
        ? {
            hotel_nome: parsed.hotel_nome || undefined,
            cidade: parsed.cidade_destino || undefined,
            data_checkin: parsed.data_checkin || undefined,
            data_checkout: parsed.data_checkout || undefined,
            num_hospedes: parsed.num_hospedes || 1,
            tipo_apto: parsed.tipo_quarto || undefined,
            tarifa_unitaria: parsed.valor_diaria || undefined,
          }
        : undefined,
    detalhes_aereo:
      tipo === 'Aéreo'
        ? {
            origem: parsed.cidade_origem || undefined,
            destino: parsed.cidade_destino || undefined,
            data_ida: parsed.data_ida || undefined,
            data_volta: parsed.data_volta || undefined,
          }
        : undefined,
    detalhes_pacote:
      tipo === 'Pacote'
        ? {
            destino: parsed.cidade_destino || undefined,
            data_ida: parsed.data_ida || parsed.data_checkin || undefined,
            data_volta: parsed.data_volta || parsed.data_checkout || undefined,
          }
        : undefined,
  })

  if (!atendimento) {
    return {
      handled: true,
      title: 'Falha ao criar demanda',
      message: 'Interpretei a solicitação, mas o navegador não conseguiu gravar no banco local.',
      provedor: parsed.provedor || 'sistema',
    }
  }

  return {
    handled: true,
    title: `Demanda criada`,
    badge: 'IA gravou no sistema',
    message: [
      `Criei a demanda de **${atendimento.passageiro_nome}**.`,
      `Empresa: ${empresa.nome}.`,
      `Tipo: ${atendimento.tipo_servico}. Prioridade: ${atendimento.prioridade}.`,
      parsed.cidade_destino ? `Destino: ${parsed.cidade_destino}.` : '',
      parsed.data_checkin || parsed.data_ida ? `Data principal: ${formatarDataBR(parsed.data_checkin || parsed.data_ida || '')}.` : '',
      'Ela já entra na base unificada de demandas e fica disponível para busca da IA e criação de voucher.',
    ]
      .filter(Boolean)
      .join('\n'),
    links: [
      { label: 'Abrir demandas', href: '/dashboard/demandas', kind: 'primary' },
      { label: 'Criar voucher', href: `/dashboard/vouchers/novo?atendimento=${atendimento.id}`, kind: 'secondary' },
    ],
    provedor: parsed.provedor || 'sistema',
  }
}

function fluxoCriarVoucher(pergunta: string, ctx: SystemAIContext): SystemAIResponse | null {
  if (!/(criar|gerar|emitir|fazer).{0,25}voucher/i.test(pergunta)) return null
  const demanda = localizarDemanda(pergunta.replace(/\bvoucher\b/gi, 'demanda'), ctx)
  const firstCardHref = demanda?.cards?.[0]?.href
  const data = extrairData(pergunta)
  const funcionario = melhorFuncionarioNaPergunta(pergunta, ctx.funcionarios)
  const destino = extrairDestino(pergunta)

  const candidatos = ctx.atendimentos
    .map((a) => {
      let score = 0
      const searchable = normalizarTexto(`${a.passageiro_nome} ${a.observacoes} ${a.detalhes_hotel?.cidade || ''} ${a.detalhes_aereo?.destino || ''}`)
      const dataAtd = a.detalhes_hotel?.data_checkin || a.detalhes_aereo?.data_ida || a.data_atendimento
      if (funcionario && a.funcionario_id === funcionario.id) score += 40
      if (funcionario && tokenMatch(funcionario.nome, searchable)) score += 30
      if (destino && tokenMatch(destino, searchable)) score += 25
      if (data && dataAtd && sameDateOrMonthDay(dataAtd, data)) score += 35
      return { a, score }
    })
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score)

  const atd = candidatos[0]?.a
  if (!atd) {
    return {
      handled: true,
      title: 'Voucher',
      badge: 'Demanda necessária',
      message: [
        'Para criar voucher com segurança, preciso localizar a demanda de origem.',
        data ? `Data informada: ${formatarDataBR(data)}.` : '',
        destino ? `Destino informado: ${destino}.` : '',
        'Crie ou localize a demanda primeiro; depois eu abro o voucher pré-preenchido.',
      ]
        .filter(Boolean)
        .join('\n'),
      links: [{ label: 'Novo voucher manual', href: '/dashboard/vouchers/novo', kind: 'primary' }],
      provedor: 'sistema',
    }
  }

  return {
    handled: true,
    title: 'Voucher pronto para emissão',
    badge: 'Pré-preenchido pela demanda',
    message: [
      `Encontrei a demanda de **${atd.passageiro_nome}**.`,
      'Abri o caminho do voucher já vinculado à demanda; a tela carrega empresa, passageiro, datas e fornecedor quando esses dados existem.',
    ].join('\n'),
    links: [
      { label: 'Criar voucher vinculado', href: `/dashboard/vouchers/novo?atendimento=${atd.id}`, kind: 'primary' },
      ...(firstCardHref ? [{ label: 'Ver demanda', href: firstCardHref, kind: 'secondary' as const }] : []),
    ],
    provedor: 'sistema',
  }
}

function localizarVoucher(pergunta: string, ctx: SystemAIContext): SystemAIResponse | null {
  if (!/\bvoucher\b/i.test(pergunta)) return null
  const q = normalizarTexto(pergunta)
  const data = extrairData(pergunta)
  const funcionario = melhorFuncionarioNaPergunta(pergunta, ctx.funcionarios)
  const nomeBusca = extrairNomeDepoisDeVoucher(pergunta) || funcionario?.nome || ''
  const destino = extrairDestino(pergunta)

  const candidatos = ctx.vouchers
    .map((v) => {
      let score = 0
      const passenger = normalizarTexto([v.passageiro_nome, ...(v.passageiros || [])].join(' '))
      const fornecedor = normalizarTexto(`${v.fornecedor_nome} ${v.fornecedor_cidade || ''} ${v.destino || ''} ${v.origem || ''}`)
      const voucherDate = v.data_checkin || v.data_ida || v.retirada_data || v.created_at?.slice(0, 10)

      if (nomeBusca && tokenMatch(nomeBusca, passenger)) score += 55
      if (funcionario && v.funcionario_id === funcionario.id) score += 25
      if (data && voucherDate && sameDateOrMonthDay(voucherDate, data)) score += 35
      if (destino && tokenMatch(destino, fornecedor)) score += 25
      if (q.includes(normalizarTexto(v.id)) || q.includes(normalizarTexto(v.numero))) score += 80
      return { v, score }
    })
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score)

  if (!candidatos.length) {
    return {
      handled: true,
      title: 'Voucher nao encontrado',
      badge: 'Busca interna',
      message: [
        'Procurei nos vouchers emitidos e nao encontrei um match confiavel.',
        nomeBusca ? `Nome buscado: ${nomeBusca}.` : '',
        destino ? `Destino: ${destino}.` : '',
        data ? `Data: ${formatarDataBR(data)}.` : '',
        'Tente informar nome completo, cidade e data do check-in/embarque.',
      ]
        .filter(Boolean)
        .join('\n'),
      links: [{ label: 'Abrir Vouchers', href: '/dashboard/vouchers', kind: 'secondary' }],
      provedor: 'sistema',
    }
  }

  const voucher = candidatos[0].v
  const empresa = ctx.empresas.find((e) => e.id === voucher.empresa_id)
  const func = voucher.funcionario_id ? ctx.funcionarios.find((f) => f.id === voucher.funcionario_id) : funcionario
  const dataPrincipal = voucher.data_checkin || voucher.data_ida || voucher.retirada_data
  const dataFim = voucher.data_checkout || voucher.data_volta || voucher.devolucao_data

  return {
    handled: true,
    title: `Voucher ${voucher.id}`,
    badge: 'Voucher localizado',
    message: [
      `Localizei o voucher **${voucher.id}**.`,
      `Passageiro: ${voucher.passageiro_nome}.`,
      empresa ? `Empresa: ${empresa.nome}.` : '',
      func ? `Funcionario cadastrado: ${func.nome}${func.cargo ? ` (${func.cargo})` : ''}.` : '',
      `Fornecedor: ${voucher.fornecedor_nome}${voucher.fornecedor_cidade ? ` - ${voucher.fornecedor_cidade}` : ''}.`,
      dataPrincipal ? `Periodo: ${formatarDataBR(dataPrincipal)}${dataFim ? ` ate ${formatarDataBR(dataFim)}` : ''}.` : '',
      voucher.numero_confirmacao ? `Confirmacao/localizador: ${voucher.numero_confirmacao}.` : voucher.localizador ? `Localizador: ${voucher.localizador}.` : '',
      `Total: ${dinheiro(voucher.total || 0)}.`,
      '',
      'Quer o arquivo? Abra o voucher e use **Imprimir / PDF** para baixar ou enviar.',
    ]
      .filter(Boolean)
      .join('\n'),
    links: [
      { label: 'Abrir voucher', href: `/dashboard/vouchers/${voucher.id}`, kind: 'primary' },
      { label: 'Imprimir / PDF', href: `/dashboard/vouchers/${voucher.id}`, kind: 'download' },
    ],
    cards: candidatos.slice(1, 4).map(({ v }) => ({
      title: v.id,
      subtitle: `${v.passageiro_nome} - ${v.fornecedor_nome}`,
      meta: [v.fornecedor_cidade, v.data_checkin || v.data_ida].filter(Boolean).join(' | '),
      href: `/dashboard/vouchers/${v.id}`,
    })),
    provedor: 'sistema',
  }
}

function localizarFuncionario(pergunta: string, ctx: SystemAIContext): SystemAIResponse | null {
  if (!/(funcionario|funcionaria|colaborador|passageiro|dados do|cpf|telefone|e-mail|email)/i.test(pergunta)) return null
  const funcionario = melhorFuncionarioNaPergunta(pergunta, ctx.funcionarios)
  if (!funcionario) return null
  const empresa = ctx.empresas.find((e) => e.id === funcionario.company_id)
  return {
    handled: true,
    title: funcionario.nome,
    badge: 'Funcionario localizado',
    message: [
      `Encontrei **${funcionario.nome}**.`,
      empresa ? `Empresa: ${empresa.nome}.` : '',
      funcionario.cargo ? `Cargo: ${funcionario.cargo}.` : '',
      funcionario.cpf ? `CPF: ${funcionario.cpf}.` : '',
      funcionario.email ? `E-mail: ${funcionario.email}.` : '',
      funcionario.telefone ? `Telefone: ${funcionario.telefone}.` : '',
      funcionario.centro_custo ? `Centro de custo: ${funcionario.centro_custo}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    links: [{ label: 'Abrir funcionarios', href: '/dashboard/funcionarios', kind: 'primary' }],
    provedor: 'sistema',
  }
}

function localizarDemanda(pergunta: string, ctx: SystemAIContext): SystemAIResponse | null {
  if (!/(demanda|atendimento|solicitacao|solicitação)/i.test(pergunta)) return null
  const funcionario = melhorFuncionarioNaPergunta(pergunta, ctx.funcionarios)
  const nome = funcionario?.nome || extrairNomeGenerico(pergunta)
  const destino = extrairDestino(pergunta)
  const data = extrairData(pergunta)

  const candidatos = ctx.atendimentos
    .map((a) => {
      let score = 0
      const searchable = normalizarTexto(`${a.passageiro_nome} ${a.observacoes} ${a.detalhes_hotel?.cidade || ''} ${a.detalhes_aereo?.destino || ''} ${a.detalhes_pacote?.destino || ''}`)
      const dataAtd = a.detalhes_hotel?.data_checkin || a.detalhes_aereo?.data_ida || a.detalhes_carro?.data_retirada || a.data_atendimento
      if (nome && tokenMatch(nome, searchable)) score += 45
      if (funcionario && a.funcionario_id === funcionario.id) score += 30
      if (destino && tokenMatch(destino, searchable)) score += 25
      if (data && dataAtd && sameDateOrMonthDay(dataAtd, data)) score += 30
      return { a, score }
    })
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score)

  if (!candidatos.length) return null
  const atd = candidatos[0].a
  const empresa = ctx.empresas.find((e) => e.id === atd.empresa_id)
  const dataAtd = atd.detalhes_hotel?.data_checkin || atd.detalhes_aereo?.data_ida || atd.detalhes_carro?.data_retirada || atd.data_atendimento

  return {
    handled: true,
    title: `Demanda ${atd.id.slice(-8).toUpperCase()}`,
    badge: 'Demanda localizada',
    message: [
      `Localizei a demanda de **${atd.passageiro_nome}**.`,
      empresa ? `Empresa: ${empresa.nome}.` : '',
      `Tipo: ${atd.tipo_servico}. Status: ${atd.status}. Prioridade: ${atd.prioridade}.`,
      dataAtd ? `Data principal: ${formatarDataBR(dataAtd)}.` : '',
      atd.detalhes_hotel?.hotel_nome ? `Hotel: ${atd.detalhes_hotel.hotel_nome}.` : '',
      atd.detalhes_aereo?.destino ? `Destino: ${atd.detalhes_aereo.destino}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    links: [{ label: 'Abrir demandas', href: '/dashboard/demandas', kind: 'primary' }],
    cards: candidatos.slice(1, 4).map(({ a }) => ({
      title: a.passageiro_nome,
      subtitle: `${a.tipo_servico} - ${a.status}`,
      meta: ctx.empresas.find((e) => e.id === a.empresa_id)?.nome,
      href: '/dashboard/demandas',
    })),
    provedor: 'sistema',
  }
}

async function fluxoHotelInteligente(pergunta: string, ctx: SystemAIContext, ops: SystemAIOps): Promise<SystemAIResponse | null> {
  if (!/(hotel|hoteis|hoteis|hotéis|hospedagem|pousada|diaria|diária)/i.test(pergunta)) return null
  const destino = extrairDestino(pergunta)
  const nomeHotel = extrairNomeHotel(pergunta)

  const existente = ctx.hoteis.find((h) => {
    const alvo = normalizarTexto(`${h.nome} ${h.cidade} ${h.uf}`)
    return (nomeHotel && tokenMatch(nomeHotel, alvo)) || (destino && tokenMatch(destino, alvo))
  })
  if (existente && !/cadastre|cadastrar|incluir|novo|nao tem|não tem|sem hotel/i.test(pergunta)) {
    return {
      handled: true,
      title: existente.nome,
      badge: 'Hotel ja cadastrado',
      message: [
        `Ja existe hotel cadastrado: **${existente.nome}** (${existente.cidade}/${existente.uf}).`,
        existente.telefone ? `Telefone: ${existente.telefone}.` : '',
        existente.faturado ? 'Marcado como faturado.' : 'Ainda nao esta marcado como faturado.',
      ]
        .filter(Boolean)
        .join('\n'),
      links: [{ label: 'Abrir hoteis', href: `/dashboard/hoteis?busca=${encodeURIComponent(existente.nome)}`, kind: 'primary' }],
      provedor: 'sistema',
    }
  }

  if (ops.allowInternet === false) {
    return {
      handled: true,
      title: 'Busca externa bloqueada',
      badge: 'Permissao da IA',
      message:
        'A pergunta exige pesquisa na internet para localizar ou cadastrar hotel. A permissao de internet da IA esta desativada em Configuracoes da IA.',
      links: [{ label: 'Configurar IA', href: '/dashboard/ia?tab=config', kind: 'secondary' }],
      provedor: 'sistema',
    }
  }

  let response
  try {
    response = await buscarHoteisComIA({
      query: pergunta,
      cidade: destino,
      knownHotels: ctx.hoteis.map((h) => ({ nome: h.nome, cidade: h.cidade, uf: h.uf })),
    })
  } catch (e: any) {
    const locais = ctx.hoteis
      .filter((h) => {
        const alvo = normalizarTexto(`${h.nome} ${h.cidade} ${h.uf}`)
        return (destino && tokenMatch(destino, alvo)) || (nomeHotel && tokenMatch(nomeHotel, alvo))
      })
      .slice(0, 6)
      .map((h) => ({
        nome: h.nome,
        cidade: h.cidade,
        uf: h.uf,
        categoria: h.categoria,
        observacoes: h.observacoes || 'Hotel ja cadastrado na base local.',
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
        fonte_url: null,
        fonte_titulo: 'Base local de hoteis',
        confianca: 'alta' as const,
      }))

    response = {
      source: 'local-fallback' as const,
      query: pergunta,
      summary: /quota|billing|exceeded|insufficient/i.test(e?.message || '')
        ? 'A busca web da IA retornou limite de quota/billing. Usei a base local e deixei a acao registrada para conferencia.'
        : `A busca web falhou (${e?.message || 'erro externo'}). Usei a base local para nao travar a operacao.`,
      suggestions: locais.length
        ? locais
        : [
            {
              nome: `Hotel corporativo ${destino || nomeHotel || 'destino'}`,
              cidade: destino || '',
              uf: '',
              categoria: undefined,
              observacoes: 'Sugestao local. Confirmar telefone, tarifa e disponibilidade antes de emitir.',
              telefone: null,
              faturado: false,
              info_faturamento: null,
              bebedouro: null,
              valor_agua: null,
              cafe_manha: null,
              estacionamento: null,
              tarifa_sgl: null,
              tarifa_dbl: null,
              tarifa_tpl: null,
              formas_pagamento: ['CC', 'PX'] as any,
              fonte_url: `https://www.google.com/search?q=${encodeURIComponent(`${destino || nomeHotel} hotel telefone`)}`,
              fonte_titulo: 'Busca Google para conferencia',
              confianca: 'baixa' as const,
            },
          ],
      citations: [],
      search_queries: [],
    }
  }

  const novas = response.suggestions.filter((s) => !hotelJaExiste(ctx.hoteis, s.nome, s.cidade, s.uf))
  const deveCadastrar = Boolean(ops.addHotel) && /(cadastre|cadastrar|incluir|demanda|hospedagem|preciso|nao tem|não tem|sem hotel)/i.test(pergunta)
  const cadastradas: HotelAISuggestion[] = []
  if (deveCadastrar) {
    novas.slice(0, 3).forEach((s) => {
      ops.addHotel?.(sugestaoParaHotel(s))
      cadastradas.push(s)
    })
  }

  return {
    handled: true,
    title: 'Busca inteligente de hoteis',
    badge: response.source === 'gemini-google' ? 'Gemini Google Search' : response.source === 'openai-web' ? 'GPT-5.2 Web Search' : 'Fallback local',
    message: [
      response.summary,
      cadastradas.length
        ? `Cadastrei automaticamente ${cadastradas.length} hotel(is) novo(s) no modulo Hoteis.`
        : novas.length
        ? 'Encontrei opcoes novas. Para cadastrar automaticamente, peça: "cadastre esses hoteis".'
        : 'Nao cadastrei duplicados; os principais resultados ja parecem existir na base.',
    ].join('\n'),
    links: [{ label: 'Ver em Hoteis', href: `/dashboard/hoteis?busca=${encodeURIComponent(destino || nomeHotel || pergunta)}`, kind: 'primary' }],
    cards: response.suggestions.slice(0, 6).map((h) => ({
      title: h.nome,
      subtitle: `${h.cidade}/${h.uf}${h.telefone ? ` - ${h.telefone}` : ''}`,
      meta: h.fonte_titulo || h.observacoes || undefined,
      href: h.fonte_url || `/dashboard/hoteis?busca=${encodeURIComponent(h.nome)}`,
    })),
    sources: response.citations,
    provedor: response.source === 'gemini-google' ? 'gemini' : response.source === 'openai-web' ? 'openai' : 'sistema',
  }
}

async function fluxoReservaTech(
  pergunta: string,
  ctx: SystemAIContext,
  ops: SystemAIOps,
): Promise<SystemAIResponse | null> {
  const q = normalizarTexto(pergunta)
  if (!/(cotar|cotacao|cotação|reservar|reserva|emitir|emissao|emissão|consultar disponibilidade|opcoes|opções|passagem|voo|aereo|aéreo|hotel|hospedagem|locacao|locação|carro|pacote)/.test(q)) {
    return null
  }

  const service = inferirServicoFornecedor(q) || (/hotel|hospedagem/.test(q) ? 'hotelaria' : /voo|passagem|aereo|aéreo/.test(q) ? 'aereo' : undefined)
  if (!service) return null

  const parsed = await parseMensagemComIA(pergunta)
  const funcionario = parsed.passageiro_nome
    ? melhorFuncionarioNaPergunta(parsed.passageiro_nome, ctx.funcionarios)
    : melhorFuncionarioNaPergunta(pergunta, ctx.funcionarios)
  const empresa =
    (funcionario ? ctx.empresas.find((e) => e.id === funcionario.company_id) : undefined) ||
    melhorEmpresaNaPergunta(parsed.empresa_nome || parsed.empresa_faturar || pergunta, ctx.empresas)
  const destino = parsed.cidade_destino || extrairDestino(pergunta)
  const origem = parsed.cidade_origem || undefined
  const dataInicio = parsed.data_checkin || parsed.data_ida || extrairData(pergunta) || undefined
  const dataFim = parsed.data_checkout || parsed.data_volta || undefined

  try {
    const response = await fetch('/api/travel/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service,
        empresaId: empresa?.id,
        origem,
        destino: destino || parsed.hotel_nome,
        dataInicio,
        dataFim,
        adultos: parsed.num_hospedes || 1,
        raw: {
          pergunta,
          passageiro: parsed.passageiro_nome || funcionario?.nome,
          centro_custo: parsed.centro_custo || funcionario?.centro_custo,
        },
      }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const notConfigured = payload?.code === 'TECH_NOT_CONFIGURED'
      return {
        handled: true,
        title: 'Tech Travel',
        badge: notConfigured ? 'Aguardando credenciais' : 'Consulta não concluída',
        message: notConfigured
          ? 'Consigo operar por esse caminho, mas a conexão Tech ainda precisa de login, senha e API key no servidor. Deixei o fluxo pronto: depois de configurar, a mesma pergunta consulta disponibilidade real.'
          : `Tentei consultar a Tech Travel, mas ela não respondeu como esperado: ${payload?.error || 'falha externa'}. Posso seguir com os dados internos e deixar a cotação preparada para revisão.`,
        links: [
          { label: 'Abrir Reservas', href: '/dashboard/reservas', kind: 'primary' },
          { label: 'Configurar Tech', href: '/dashboard/configuracoes', kind: 'secondary' },
        ],
        provedor: 'sistema',
      }
    }

    const quote = payload?.quote
    return {
      handled: true,
      title: 'Cotação Tech Travel',
      badge: `${serviceLabelIA(service)} conectado`,
      message: [
        quote?.options?.length
          ? `Consultei a Tech Travel e encontrei ${quote.options.length} opção(ões) para analisar.`
          : 'Consultei a Tech Travel, mas ela não retornou opções disponíveis com os dados informados.',
        empresa ? `Empresa: ${empresa.nome}.` : 'Empresa não identificada com segurança.',
        parsed.passageiro_nome || funcionario?.nome ? `Viajante: ${parsed.passageiro_nome || funcionario?.nome}.` : '',
        destino ? `Destino: ${destino}.` : '',
        dataInicio ? `Data principal: ${formatarDataBR(dataInicio)}${dataFim ? ` até ${formatarDataBR(dataFim)}` : ''}.` : '',
        'Posso usar essa cotação para preparar reserva, voucher ou acompanhar por OS quando você confirmar a opção.',
      ]
        .filter(Boolean)
        .join('\n'),
      links: [
        { label: 'Abrir Reservas', href: '/dashboard/reservas', kind: 'primary' },
        { label: 'Abrir Demandas', href: '/dashboard/demandas', kind: 'secondary' },
      ],
      cards: (quote?.options || []).slice(0, 6).map((option: any) => ({
        title: option.title,
        subtitle: option.subtitle || option.supplierName,
        meta: option.price ? dinheiro(Number(option.price)) : option.city || 'Tech Travel',
        href: '/dashboard/reservas',
      })),
      provedor: 'sistema',
    }
  } catch (error: any) {
    return {
      handled: true,
      title: 'Tech Travel',
      badge: 'Modo interno',
      message: `Não consegui chamar a integração Tech agora. Motivo: ${error?.message || 'falha local'}. A operação pode ser preparada em Reservas e executada quando a conexão estiver ativa.`,
      links: [{ label: 'Abrir Reservas', href: '/dashboard/reservas', kind: 'primary' }],
      provedor: 'sistema',
    }
  }
}

async function fluxoPesquisaTempoReal(pergunta: string, ops: SystemAIOps): Promise<SystemAIResponse | null> {
  if (!deveUsarPesquisaTempoReal(pergunta)) return null

  if (ops.allowInternet === false) {
    return {
      handled: true,
      title: 'Pesquisa web bloqueada',
      badge: 'Permissao da IA',
      message:
        'Essa pergunta precisa de pesquisa em tempo real, mas a internet da IA esta desativada em Configuracoes da IA.',
      links: [{ label: 'Configurar IA', href: '/dashboard/ia?tab=config', kind: 'secondary' }],
      provedor: 'sistema',
    }
  }

  try {
    const result = await pesquisarWebComIA({ query: pergunta, deep: /profundo|completo|detalhado|comparar|compare/i.test(pergunta) })
    return {
      handled: true,
      title: 'Pesquisa em tempo real',
      badge:
        result.source === 'openai-web'
          ? 'OpenAI Web Search'
          : result.source === 'gemini-google'
          ? 'Gemini Google Search'
          : 'Conferencia manual',
      message: [
        result.summary,
        '',
        result.answer,
        result.provider_error ? '\nA busca por API nao confirmou os dados; valide pela fonte manual antes de cadastrar ou emitir.' : '',
        result.action_items?.length ? `\nProximas acoes:\n${result.action_items.map((item) => `- ${item}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      links: result.sources
        .filter((source) => source.uri)
        .slice(0, 4)
        .map((source, index) => ({
          label: source.title || `Fonte ${index + 1}`,
          href: source.uri || '',
          kind: index === 0 ? 'primary' : 'secondary',
        })),
      sources: result.sources,
      provedor: result.source === 'openai-web' ? 'openai' : result.source === 'gemini-google' ? 'gemini' : 'sistema',
    }
  } catch (e: any) {
    return {
      handled: true,
      title: 'Pesquisa em tempo real',
      badge: 'Modo interno',
      message: [
        aiErrorUserMessage(e, e?.provedor || 'ia'),
        '',
        'Enquanto a busca externa nao responde, consigo usar a base interna do BBT. Se voce quiser telefone, endereco ou disponibilidade atualizada, confirme a pesquisa novamente depois que a chave/provedor estiver normal.',
      ].join('\n'),
      provedor: 'sistema',
    }
  }
}

function valorAtendimento(a: Atendimento): number {
  return a.valor_venda || a.valor_final || a.valor_cotacao || 0
}

function topBy(values: string[]): string | undefined {
  const counts = new Map<string, number>()
  values.filter(Boolean).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1))
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
}

function melhorFuncionarioNaPergunta(pergunta: string, funcionarios: Funcionario[]): Funcionario | undefined {
  const cpf = pergunta.match(/\d{3}\D?\d{3}\D?\d{3}\D?\d{2}/)?.[0] || ''
  const confiavel = encontrarFuncionarioConfiavel(funcionarios, { cpf })
  if (confiavel) return confiavel

  const match = encontrarFuncionarioPorNomeInteligente(funcionarios, pergunta, undefined, 84)
  return match && !match.ambiguo ? match.funcionario : undefined
}

function melhorEmpresaNaPergunta(pergunta: string, empresas: Empresa[]): Empresa | undefined {
  const q = normalizarTexto(pergunta)
  if (!q) return undefined
  return empresas
    .map((e) => {
      const nome = normalizarTexto(e.nome)
      const tokens = nome.split(' ').filter((t) => t.length > 2)
      let score = 0
      if (q.includes(nome)) score += 100
      tokens.forEach((t) => {
        if (q.includes(t)) score += 18
      })
      if (e.cnpj && q.includes(e.cnpj.replace(/\D/g, ''))) score += 90
      if (e.codigo_cliente && q.includes(normalizarTexto(e.codigo_cliente))) score += 60
      return { e, score }
    })
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score)[0]?.e
}

function normalizarTipoServicoIA(value: any): string {
  const tipo = normalizarTexto(String(value || ''))
  if (/aereo|voo|passagem|bilhete/.test(tipo)) return 'Aéreo'
  if (/hotel|hospedagem|diaria|pousada/.test(tipo)) return 'Hotel'
  if (/carro|locacao|locadora|veiculo/.test(tipo)) return 'Carro'
  if (/pacote/.test(tipo)) return 'Pacote'
  return 'Outro'
}

function inferirTipoServico(pergunta: string): string {
  return normalizarTipoServicoIA(pergunta)
}

function extrairNomeDepoisDeVoucher(pergunta: string): string {
  return (
    pergunta.match(/voucher\s+(?:do|da|de)\s+([^,]+?)(?:\s+para|\s+pro|\s+pra|\s+no dia|\s+dia|$)/i)?.[1] ||
    ''
  ).trim()
}

function extrairNomeGenerico(pergunta: string): string {
  return (
    pergunta.match(/(?:do|da|de|para|passageiro|hospede|hóspede)\s+([^,]+?)(?:\s+para|\s+pro|\s+pra|\s+dia|$)/i)?.[1] ||
    ''
  ).trim()
}

function extrairNomeHotel(pergunta: string): string {
  return (
    pergunta.match(/hotel\s+([^,]+?)(?:\s+em|\s+para|\s+telefone|\s+cadastre|$)/i)?.[1] ||
    ''
  ).trim()
}

function extrairDestino(pergunta: string): string {
  return (
    pergunta.match(/(?:para|pra|em|destino|cidade de|hospedagem em)\s+([a-zA-ZÀ-ÿ\s]+?)(?:[-/,]\s*[A-Z]{2}\b|\s+pro|\s+para o dia|\s+dia|\s+no dia|$)/i)?.[1] ||
    ''
  ).trim()
}

function extrairData(pergunta: string): string | null {
  const numeric = pergunta.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/)
  if (numeric) {
    const dia = numeric[1].padStart(2, '0')
    const mes = numeric[2].padStart(2, '0')
    let ano = numeric[3] || String(new Date().getFullYear())
    if (ano.length === 2) ano = `20${ano}`
    let iso = `${ano}-${mes}-${dia}`
    if (!numeric[3] && iso < todayISODate()) {
      iso = `${new Date().getFullYear() + 1}-${mes}-${dia}`
    }
    return iso
  }
  return null
}

function sameDateOrMonthDay(a: string, b: string): boolean {
  if (!a || !b) return false
  const aa = a.slice(0, 10)
  const bb = b.slice(0, 10)
  return aa === bb || aa.slice(5) === bb.slice(5)
}

function tokenMatch(needle: string, haystack: string): boolean {
  const n = normalizarTexto(needle)
  const h = normalizarTexto(haystack)
  if (!n || !h) return false
  if (h.includes(n) || n.includes(h)) return true
  const tokens = n.split(' ').filter((t) => t.length > 2)
  return tokens.length > 0 && tokens.every((t) => h.includes(t))
}

function formatarDataBR(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

function dinheiro(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function inferirServicoFornecedor(q: string): SupplierService | undefined {
  if (/aereo|aéreo|voo|passagem|bilhete|brt|flytour|ancoradouro|gds|ndc/.test(q)) return 'aereo'
  if (/hotel|hotelaria|hospedagem/.test(q)) return 'hotelaria'
  if (/locacao|locação|locadora|carro|veiculo|veículo/.test(q)) return 'locacao'
  if (/pacote|lazer|orinter|diversa|operadora/.test(q)) return 'pacotes'
  if (/transfer|traslado/.test(q)) return 'transfer'
  if (/seguro/.test(q)) return 'seguro'
  return undefined
}

function serviceLabelIA(service: SupplierService): string {
  const labels: Record<SupplierService, string> = {
    aereo: 'Aereo',
    hotelaria: 'Hotelaria',
    locacao: 'Locacao',
    pacotes: 'Pacotes',
    lazer: 'Lazer',
    transfer: 'Transfer',
    seguro: 'Seguro',
    outros: 'Outros',
  }
  return labels[service]
}

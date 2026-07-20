// ============================================================
// Motor de Priorização e Repasse Inteligente de Demandas
// V5 - Redistribui demandas por prioridade/urgência
// ============================================================

import type { Atendimento, Prioridade, User } from '@/types'
import { getAllUsers } from '@/lib/auth'
import { updateAtendimento, registrarLog } from '@/lib/atendimentos-storage'

/**
 * Calcula dias até o check-in (ou data de ida) de uma demanda.
 * Retorna número positivo se ainda falta, negativo se já passou, ou null se não há data.
 */
export function diasAteCheckin(a: Atendimento): number | null {
  let data: string | undefined
  if (a.tipo_servico === 'Hotel') data = a.detalhes_hotel?.data_checkin
  else if (a.tipo_servico === 'Aéreo') data = a.detalhes_aereo?.data_ida
  else if (a.tipo_servico === 'Carro') data = a.detalhes_carro?.data_retirada
  else if (a.tipo_servico === 'Pacote') data = a.detalhes_pacote?.data_ida

  if (!data) return null
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const d = new Date(data + 'T00:00:00')
  return Math.floor((d.getTime() - hoje.getTime()) / 86400000)
}

/**
 * Calcula prioridade automática baseada em:
 * - Proximidade do check-in
 * - Se já está em atendimento ou não
 * - Status atual
 * - Prioridade manual definida (se for alta/urgente, respeita)
 */
export function calcularPrioridadeAuto(a: Atendimento): Prioridade {
  // Se já marcada como urgente manualmente, mantém
  if (a.prioridade === 'urgente') return 'urgente'

  const dias = diasAteCheckin(a)
  if (dias === null) return a.prioridade || 'media'

  // Demanda em aberto sem atendimento → promove
  const semAtendimento = !a.em_atendimento || a.status === 'aguardando_cliente'

  if (dias < 0) return 'baixa' // já passou, não é mais urgente
  if (dias === 0 || dias === 1) return 'urgente'
  if (dias <= 3) return semAtendimento ? 'urgente' : 'alta'
  if (dias <= 7) return semAtendimento ? 'alta' : 'media'
  if (dias <= 15) return 'media'
  return 'baixa'
}

/**
 * Score numérico pra ordenar demandas. Maior = mais urgente.
 */
export function scorePrioridade(a: Atendimento): number {
  const p = calcularPrioridadeAuto(a)
  const base = { urgente: 1000, alta: 500, media: 200, baixa: 50 }[p] || 0
  const dias = diasAteCheckin(a) ?? 999
  // Quanto menor os dias, maior o score (inversamente)
  const fator = Math.max(0, 100 - dias * 5)
  // Bônus se não tem ninguém atendendo (prioridade de distribuição)
  const bonusSemAgente = a.em_atendimento === false ? 50 : 0
  return base + fator + bonusSemAgente
}

export interface SugestaoRepasse {
  atendimento: Atendimento
  agente_atual: string | null
  agente_sugerido: string
  motivo: string
  score: number
  dias_checkin: number | null
}

/**
 * Análise de balanceamento de carga da equipe.
 * Identifica demandas que deveriam ser repassadas de agentes sobrecarregados
 * com baixa prioridade para agentes ociosos com demandas urgentes.
 */
export function analisarRepasses(
  todosAtendimentos: Atendimento[]
): { sugestoes: SugestaoRepasse[]; carga_por_agente: Record<string, { nome: string; urgentes: number; altas: number; medias: number; baixas: number; total: number; mais_urgente_dias: number | null }> } {
  const users = getAllUsers().filter((u) => u.perfil_bbt && u.perfil_bbt !== 'gestor_financeiro' && u.ativo !== false)

  // Ativas = em_andamento, aguardando, nao_atendida
  const ativas = todosAtendimentos.filter((a) =>
    ['em_andamento', 'aguardando_cliente', 'pendente'].includes(a.status)
  )

  // Calcula carga por agente
  const carga_por_agente: Record<string, any> = {}
  for (const u of users) {
    const minhas = ativas.filter((a) => a.agente_user_id === u.id)
    const urgentes = minhas.filter((a) => calcularPrioridadeAuto(a) === 'urgente').length
    const altas = minhas.filter((a) => calcularPrioridadeAuto(a) === 'alta').length
    const medias = minhas.filter((a) => calcularPrioridadeAuto(a) === 'media').length
    const baixas = minhas.filter((a) => calcularPrioridadeAuto(a) === 'baixa').length
    const diasList = minhas.map(diasAteCheckin).filter((d): d is number => d !== null && d >= 0)
    const mais_urgente_dias = diasList.reduce<number | null>(
      (menor, dias) => (menor == null ? dias : Math.min(menor, dias)),
      null,
    )

    carga_por_agente[u.id] = {
      nome: u.name,
      urgentes, altas, medias, baixas,
      total: minhas.length,
      mais_urgente_dias,
    }
  }

  // Sem agente = aguardando redistribuição imediata
  const semAgente = ativas.filter((a) => !a.agente_user_id || a.em_atendimento === false)
  // Urgentes atrasadas
  const urgentesAtrasadas = ativas.filter((a) => {
    const d = diasAteCheckin(a)
    return d !== null && d <= 2 && d >= 0
  })

  const sugestoes: SugestaoRepasse[] = []

  // 1) Para cada demanda urgente/próxima: se o agente atual tem mais coisa urgente
  //    e existe agente com menos carga, sugere repasse
  for (const demanda of [...urgentesAtrasadas, ...semAgente]) {
    if (sugestoes.find((s) => s.atendimento.id === demanda.id)) continue

    const dias = diasAteCheckin(demanda)
    if (dias === null) continue

    const agenteAtual = demanda.agente_user_id
    const cargaAtual = agenteAtual ? carga_por_agente[agenteAtual] : null

    // Achar o agente com menor carga de urgentes (e diferente do atual)
    const candidatos = users
      .filter((u) => u.id !== agenteAtual)
      .map((u) => ({
        user: u,
        carga: carga_por_agente[u.id],
      }))
      .filter((c) => c.carga.total < (cargaAtual?.total || Infinity))
      .sort((a, b) => {
        // Priorizar quem tem menos urgentes, e em segundo critério menos total
        if (a.carga.urgentes !== b.carga.urgentes) return a.carga.urgentes - b.carga.urgentes
        return a.carga.total - b.carga.total
      })

    if (candidatos.length === 0) continue
    const escolhido = candidatos[0]

    let motivo = ''
    if (!agenteAtual) {
      motivo = `Demanda sem agente, ${escolhido.user.name} tem menor carga (${escolhido.carga.total} demandas)`
    } else if (dias <= 2) {
      motivo = `Check-in em ${dias}d. ${cargaAtual?.nome || 'Agente atual'} tem ${cargaAtual?.urgentes || 0} urgentes. ${escolhido.user.name} tem ${escolhido.carga.urgentes} urgentes`
    } else {
      motivo = `Rebalancear carga: ${cargaAtual?.nome || ''} tem ${cargaAtual?.total || 0} demandas`
    }

    sugestoes.push({
      atendimento: demanda,
      agente_atual: agenteAtual,
      agente_sugerido: escolhido.user.id,
      motivo,
      score: scorePrioridade(demanda),
      dias_checkin: dias,
    })
  }

  // 2) Para agentes com muitas demandas de BAIXA prioridade (check-in longe): 
  //    se tem mais de 5 e existe um agente com <3 demandas, sugere repassar 1 das baixas
  const sobreCarregados = Object.entries(carga_por_agente)
    .filter(([, c]: any) => c.total > 5)
    .map(([id, c]) => ({ id, carga: c as any }))

  for (const sc of sobreCarregados) {
    const minhasBaixas = ativas.filter(
      (a) => a.agente_user_id === sc.id && calcularPrioridadeAuto(a) === 'baixa'
    )
    for (const demanda of minhasBaixas) {
      if (sugestoes.find((s) => s.atendimento.id === demanda.id)) continue
      const alvo = Object.entries(carga_por_agente)
        .filter(([id, c]: any) => id !== sc.id && c.total < 3)
        .sort((a: any, b: any) => a[1].total - b[1].total)[0]
      if (!alvo) continue
      sugestoes.push({
        atendimento: demanda,
        agente_atual: sc.id,
        agente_sugerido: alvo[0],
        motivo: `${sc.carga.nome} tem ${sc.carga.total} demandas. ${(alvo[1] as any).nome} tem ${(alvo[1] as any).total}. Esta é baixa prioridade (check-in longe)`,
        score: scorePrioridade(demanda),
        dias_checkin: diasAteCheckin(demanda),
      })
    }
  }

  // Ordena sugestoes por score decrescente
  sugestoes.sort((a, b) => b.score - a.score)

  return { sugestoes, carga_por_agente }
}

/**
 * Executa um repasse: altera o agente de um atendimento e registra histórico.
 */
export function executarRepasse(
  atendimento: Atendimento,
  novoAgenteId: string,
  novoAgenteNome: string,
  quemRepassouId: string,
  quemRepassouNome: string,
  motivo: string
): boolean {
  const historico = atendimento.historico_agentes || []
  const agoraISO = new Date().toISOString()

  // Fechar período do agente atual
  if (atendimento.agente_user_id && historico.length > 0) {
    const ultimoAgente = historico[historico.length - 1]
    if (!ultimoAgente.ate) ultimoAgente.ate = agoraISO
  }

  // Adicionar o novo agente
  historico.push({ user_id: novoAgenteId, user_name: novoAgenteNome, desde: agoraISO })

  const updated = updateAtendimento(atendimento.id, {
    agente_user_id: novoAgenteId,
    repassada_em: agoraISO,
    repassada_de: atendimento.agente_user_id || undefined,
    repassada_para: novoAgenteId,
    motivo_repasse: motivo,
    historico_agentes: historico,
    em_atendimento: false, // novo agente ainda precisa aceitar
    updated_at: agoraISO,
  })

  if (!updated) return false

  registrarLog({
    user_id: quemRepassouId,
    user_name: quemRepassouNome,
    acao: 'editar',
    entidade: 'Atendimento',
    entidade_id: atendimento.id,
    descricao: `Repassou demanda "${atendimento.passageiro_nome}" para ${novoAgenteNome}: ${motivo}`,
  })

  return true
}

/**
 * Pega automaticamente uma demanda disponível (sem agente) para o user.
 */
export function pegarDemanda(
  atendimento: Atendimento,
  userId: string,
  userName: string
): boolean {
  const historico = atendimento.historico_agentes || []
  const agoraISO = new Date().toISOString()
  historico.push({ user_id: userId, user_name: userName, desde: agoraISO })

  return !!updateAtendimento(atendimento.id, {
    agente_user_id: userId,
    em_atendimento: true,
    historico_agentes: historico,
    updated_at: agoraISO,
  })
}

/**
 * Formata mensagem amigável sobre dias até check-in
 */
export function formatarDiasCheckin(dias: number | null): string {
  if (dias === null) return 'Sem data'
  if (dias < 0) return `Passou há ${Math.abs(dias)}d`
  if (dias === 0) return 'HOJE'
  if (dias === 1) return 'Amanhã'
  if (dias <= 7) return `Em ${dias} dias`
  if (dias <= 30) return `Em ${dias} dias`
  return `Em ${dias}d (${Math.round(dias / 30)}m)`
}

/**
 * Cor da urgência para UI
 */
export function corPrioridade(p: Prioridade): { bg: string; text: string; border: string } {
  switch (p) {
    case 'urgente': return { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', border: 'border-red-300 dark:border-red-700' }
    case 'alta': return { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700' }
    case 'media': return { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700' }
    case 'baixa': return { bg: 'bg-slate-50 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-300 dark:border-slate-600' }
  }
}

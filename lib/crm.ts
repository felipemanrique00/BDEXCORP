// ============================================================
// CRM OPERACIONAL — Threads + SLA
// Cada atendimento pode ter uma "thread" (linha do tempo) com:
//  - Mensagens recebidas (do cliente)
//  - Mensagens enviadas (pelo agente)
//  - Eventos do sistema (status mudou, repassada, etc)
// SLA é calculado pelo tempo entre primeira mensagem e primeira resposta,
// e pelo tempo até finalização.
// ============================================================

import { gerarId, registrarEvento } from './audit'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'

export type TipoMensagem = 'recebida' | 'enviada' | 'evento_sistema' | 'nota_interna'
export type CanalMensagem = 'WhatsApp' | 'E-mail' | 'Telefone' | 'Sistema' | 'Presencial' | 'Outro'

export interface MensagemThread {
  id: string
  atendimento_id: string
  tipo: TipoMensagem
  canal: CanalMensagem
  remetente?: string // nome de quem enviou (cliente ou agente)
  user_id?: string // se foi um user do sistema
  conteudo: string
  anexos?: Array<{ nome: string; tipo: string }> // metadata, sem o arquivo em si
  timestamp: string // ISO
  lida?: boolean
  importante?: boolean
}

const STORAGE_KEY = 'bbt-mensagens-thread'

function load(): MensagemThread[] {
  if (typeof window === 'undefined') return []
  return loadJSON<MensagemThread[]>(STORAGE_KEY, [])
}

function save(arr: MensagemThread[]) {
  if (typeof window === 'undefined') return
  // Mantém só as últimas 10000 mensagens (~2-5MB)
  const limitado = arr.slice(-1000).map((item) => ({ ...item, conteudo: item.conteudo?.slice(0, 2000) }))
  safeSetJSON(STORAGE_KEY, limitado)
}

export function adicionarMensagem(
  data: Omit<MensagemThread, 'id' | 'timestamp'>
): MensagemThread {
  const m: MensagemThread = {
    id: gerarId(),
    ...data,
    timestamp: new Date().toISOString(),
  }
  const all = load()
  all.push(m)
  save(all)

  // Evento de auditoria
  if (data.user_id) {
    registrarEvento({
      user_id: data.user_id,
      user_name: data.remetente || 'Sistema',
      acao: 'enviar_mensagem',
      entidade: 'Atendimento',
      entidade_id: data.atendimento_id,
      descricao: `Adicionou ${data.tipo} via ${data.canal}`,
      meta: { tipo: data.tipo, canal: data.canal, tem_anexo: !!data.anexos?.length },
    })
  }

  return m
}

export function getThread(atendimentoId: string): MensagemThread[] {
  return load()
    .filter((m) => m.atendimento_id === atendimentoId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export function getMensagensNaoLidas(atendimentoId: string): MensagemThread[] {
  return getThread(atendimentoId).filter((m) => m.tipo === 'recebida' && !m.lida)
}

export function marcarComoLida(mensagemId: string): boolean {
  const all = load()
  const m = all.find((x) => x.id === mensagemId)
  if (!m) return false
  m.lida = true
  save(all)
  return true
}

export function marcarThreadLida(atendimentoId: string): number {
  const all = load()
  let qtd = 0
  for (const m of all) {
    if (m.atendimento_id === atendimentoId && m.tipo === 'recebida' && !m.lida) {
      m.lida = true
      qtd++
    }
  }
  save(all)
  return qtd
}

// ============================================================
// CÁLCULO DE SLA
// ============================================================

export interface MetricasSLA {
  primeira_resposta_minutos?: number // tempo entre 1ª recebida e 1ª enviada
  resolucao_horas?: number // tempo entre criação e finalização
  total_mensagens: number
  mensagens_recebidas: number
  mensagens_enviadas: number
  ultima_atividade?: string
  pendente_resposta: boolean // tem mensagem recebida sem resposta posterior
  tempo_pendente_minutos?: number // se pendente, há quanto tempo
}

export function calcularSLA(
  atendimentoId: string,
  finalizado_em?: string,
  created_at?: string
): MetricasSLA {
  const mensagens = getThread(atendimentoId)
  const recebidas = mensagens.filter((m) => m.tipo === 'recebida')
  const enviadas = mensagens.filter((m) => m.tipo === 'enviada')

  const r: MetricasSLA = {
    total_mensagens: mensagens.length,
    mensagens_recebidas: recebidas.length,
    mensagens_enviadas: enviadas.length,
    pendente_resposta: false,
    ultima_atividade: mensagens[mensagens.length - 1]?.timestamp,
  }

  // Primeira resposta: tempo entre 1ª recebida e 1ª enviada APÓS ela
  if (recebidas.length > 0) {
    const primeira_recebida = recebidas[0].timestamp
    const primeira_resposta = enviadas.find((e) => e.timestamp > primeira_recebida)
    if (primeira_resposta) {
      const ms = new Date(primeira_resposta.timestamp).getTime() - new Date(primeira_recebida).getTime()
      r.primeira_resposta_minutos = Math.round(ms / 60000)
    } else {
      // Pendente: tem recebida sem resposta
      r.pendente_resposta = true
      const ms = Date.now() - new Date(primeira_recebida).getTime()
      r.tempo_pendente_minutos = Math.round(ms / 60000)
    }
  }

  // Tempo até finalização
  if (finalizado_em && created_at) {
    const ms = new Date(finalizado_em).getTime() - new Date(created_at).getTime()
    r.resolucao_horas = Math.round(ms / 3600000 * 10) / 10
  }

  // Verifica se a última mensagem foi recebida (ainda pendente)
  const ultima = mensagens[mensagens.length - 1]
  if (ultima && ultima.tipo === 'recebida') {
    r.pendente_resposta = true
    const ms = Date.now() - new Date(ultima.timestamp).getTime()
    r.tempo_pendente_minutos = Math.round(ms / 60000)
  }

  return r
}

/**
 * Classificação de SLA:
 * - "ótimo": resposta < 15 min
 * - "bom": 15-60 min
 * - "ruim": 1-4 h
 * - "crítico": > 4 h ou pendente há > 2 h
 */
export function classificarSLA(s: MetricasSLA): 'otimo' | 'bom' | 'ruim' | 'critico' | 'sem_dados' {
  if (s.pendente_resposta) {
    if ((s.tempo_pendente_minutos || 0) > 240) return 'critico'
    if ((s.tempo_pendente_minutos || 0) > 60) return 'ruim'
    return 'bom'
  }
  if (s.primeira_resposta_minutos === undefined) return 'sem_dados'
  if (s.primeira_resposta_minutos <= 15) return 'otimo'
  if (s.primeira_resposta_minutos <= 60) return 'bom'
  if (s.primeira_resposta_minutos <= 240) return 'ruim'
  return 'critico'
}

export function formatarDuracao(minutos: number | undefined): string {
  if (minutos === undefined) return '—'
  if (minutos < 60) return `${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h < 24) return m > 0 ? `${h}h ${m}min` : `${h}h`
  const d = Math.floor(h / 24)
  const hr = h % 24
  return hr > 0 ? `${d}d ${hr}h` : `${d}d`
}

// ============================================================
// AGREGAÇÕES
// ============================================================

export interface ResumoCRM {
  total_threads: number
  com_pendencia: number
  resposta_media_minutos: number
  resolucao_media_horas: number
  por_classificacao: Record<string, number>
}

export function calcularResumoCRM(atendimentos: Array<{ id: string; created_at: string; finalizado_em?: string }>): ResumoCRM {
  const slas = atendimentos.map((a) => calcularSLA(a.id, a.finalizado_em, a.created_at))
  const com_resposta = slas.filter((s) => s.primeira_resposta_minutos !== undefined)
  const com_resolucao = slas.filter((s) => s.resolucao_horas !== undefined)

  const classes = { otimo: 0, bom: 0, ruim: 0, critico: 0, sem_dados: 0 }
  for (const s of slas) {
    classes[classificarSLA(s)]++
  }

  return {
    total_threads: atendimentos.length,
    com_pendencia: slas.filter((s) => s.pendente_resposta).length,
    resposta_media_minutos: com_resposta.length > 0
      ? Math.round(com_resposta.reduce((acc, s) => acc + (s.primeira_resposta_minutos || 0), 0) / com_resposta.length)
      : 0,
    resolucao_media_horas: com_resolucao.length > 0
      ? Math.round(com_resolucao.reduce((acc, s) => acc + (s.resolucao_horas || 0), 0) / com_resolucao.length * 10) / 10
      : 0,
    por_classificacao: classes,
  }
}

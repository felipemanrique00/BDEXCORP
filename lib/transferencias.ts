// ============================================================
// TRANSFERÊNCIA ENTRE AGENTES — V7
// Fluxo:
//   1. Agente A solicita transferência da demanda X para Agente B (com motivo)
//   2. B recebe notificação (toast + badge no header)
//   3. B aceita ou recusa (com justificativa obrigatória se recusar)
//   4. Aceita: muda agente_user_id da demanda + audita
//      Recusada: aviso pra A com a justificativa
//   5. Tudo registrado no histórico_agentes da demanda
// ============================================================

import { gerarId, registrarEvento } from './audit'
import { updateAtendimento, getAtendimentoById } from './atendimentos-storage'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'

export type StatusTransferencia = 'pendente' | 'aceita' | 'recusada' | 'cancelada'

export interface SolicitacaoTransferencia {
  id: string
  atendimento_id: string
  passageiro_nome: string  // snapshot pra exibir mesmo se demanda mudar
  empresa_nome: string
  // De quem → Para quem
  origem_user_id: string
  origem_user_name: string
  destino_user_id: string
  destino_user_name: string
  // Justificativa
  motivo: string
  status: StatusTransferencia
  // Timestamps
  solicitada_em: string
  respondida_em?: string
  // Quando recusada
  motivo_recusa?: string
}

const STORAGE_KEY = 'bbt-transferencias'

function load(): SolicitacaoTransferencia[] {
  if (typeof window === 'undefined') return []
  return loadJSON<SolicitacaoTransferencia[]>(STORAGE_KEY, [])
}

function save(arr: SolicitacaoTransferencia[]) {
  if (typeof window === 'undefined') return
  safeSetJSON(STORAGE_KEY, arr.slice(-1000))
}

// ============================================================
// API
// ============================================================

export function solicitarTransferencia(opts: {
  atendimento_id: string
  origem_user_id: string
  origem_user_name: string
  destino_user_id: string
  destino_user_name: string
  motivo: string
}): SolicitacaoTransferencia | null {
  if (!opts.motivo || opts.motivo.trim().length < 5) {
    return null
  }
  const at = getAtendimentoById(opts.atendimento_id)
  if (!at) return null

  const sol: SolicitacaoTransferencia = {
    id: gerarId(),
    atendimento_id: opts.atendimento_id,
    passageiro_nome: at.passageiro_nome,
    empresa_nome: '',  // pode ser preenchido pelo caller
    origem_user_id: opts.origem_user_id,
    origem_user_name: opts.origem_user_name,
    destino_user_id: opts.destino_user_id,
    destino_user_name: opts.destino_user_name,
    motivo: opts.motivo.trim(),
    status: 'pendente',
    solicitada_em: new Date().toISOString(),
  }
  const all = load()
  all.push(sol)
  save(all)

  registrarEvento({
    user_id: opts.origem_user_id,
    user_name: opts.origem_user_name,
    acao: 'solicitar_transferencia',
    entidade: 'Atendimento',
    entidade_id: opts.atendimento_id,
    descricao: `Solicitou transferência de ${at.passageiro_nome} para ${opts.destino_user_name}. Motivo: ${opts.motivo}`,
    meta: { destino: opts.destino_user_id, motivo: opts.motivo },
  })
  return sol
}

export function aceitarTransferencia(
  solicitacaoId: string,
  userId: string,
  userName: string
): boolean {
  const all = load()
  const sol = all.find((s) => s.id === solicitacaoId)
  if (!sol || sol.status !== 'pendente') return false
  if (sol.destino_user_id !== userId) return false  // segurança: só destinatário pode aceitar

  const at = getAtendimentoById(sol.atendimento_id)
  if (!at) return false

  // Atualiza demanda
  const historico = (at as any).historico_agentes || []
  historico.push({
    user_id: at.agente_user_id,
    user_name: sol.origem_user_name,
    desde: at.created_at,
    ate: new Date().toISOString(),
    motivo_saida: `Transferida para ${sol.destino_user_name}: ${sol.motivo}`,
  })

  updateAtendimento(sol.atendimento_id, {
    agente_user_id: sol.destino_user_id,
    historico_agentes: historico,
    repassada_em: new Date().toISOString(),
    repassada_de: sol.origem_user_id,
    repassada_para: sol.destino_user_id,
  } as any)

  sol.status = 'aceita'
  sol.respondida_em = new Date().toISOString()
  save(all)

  registrarEvento({
    user_id: userId,
    user_name: userName,
    acao: 'aceitar_transferencia',
    entidade: 'Atendimento',
    entidade_id: sol.atendimento_id,
    descricao: `Aceitou transferência de ${sol.passageiro_nome} (de ${sol.origem_user_name})`,
  })
  return true
}

export function recusarTransferencia(
  solicitacaoId: string,
  userId: string,
  userName: string,
  motivoRecusa: string
): boolean {
  if (!motivoRecusa || motivoRecusa.trim().length < 5) return false
  const all = load()
  const sol = all.find((s) => s.id === solicitacaoId)
  if (!sol || sol.status !== 'pendente') return false
  if (sol.destino_user_id !== userId) return false

  sol.status = 'recusada'
  sol.respondida_em = new Date().toISOString()
  sol.motivo_recusa = motivoRecusa.trim()
  save(all)

  registrarEvento({
    user_id: userId,
    user_name: userName,
    acao: 'recusar_transferencia',
    entidade: 'Atendimento',
    entidade_id: sol.atendimento_id,
    descricao: `Recusou transferência de ${sol.passageiro_nome}. Motivo: ${motivoRecusa}`,
  })
  return true
}

export function cancelarTransferencia(solicitacaoId: string, userId: string): boolean {
  const all = load()
  const sol = all.find((s) => s.id === solicitacaoId)
  if (!sol || sol.status !== 'pendente') return false
  if (sol.origem_user_id !== userId) return false  // só quem solicitou pode cancelar
  sol.status = 'cancelada'
  sol.respondida_em = new Date().toISOString()
  save(all)
  return true
}

// ============================================================
// QUERIES
// ============================================================

export function getTransferenciasPendentes(userId: string): SolicitacaoTransferencia[] {
  return load()
    .filter((s) => s.status === 'pendente' && s.destino_user_id === userId)
    .sort((a, b) => b.solicitada_em.localeCompare(a.solicitada_em))
}

export function getTransferenciasEnviadas(userId: string): SolicitacaoTransferencia[] {
  return load()
    .filter((s) => s.origem_user_id === userId)
    .sort((a, b) => b.solicitada_em.localeCompare(a.solicitada_em))
}

export function getTransferenciasPorDemanda(atendimentoId: string): SolicitacaoTransferencia[] {
  return load()
    .filter((s) => s.atendimento_id === atendimentoId)
    .sort((a, b) => b.solicitada_em.localeCompare(a.solicitada_em))
}

export function contarPendentesParaUsuario(userId: string): number {
  return load().filter((s) => s.status === 'pendente' && s.destino_user_id === userId).length
}

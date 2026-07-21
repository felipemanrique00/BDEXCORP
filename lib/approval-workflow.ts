// ============================================================
// APPROVAL WORKFLOW — V13
//
// Workflow multi-nível de aprovação de viagem corporativa.
// Inspirado em SAP Concur multi-step approval e Navan Dynamic Policy.
//
// Regra de roteamento (default):
//   - sem violação + valor < R$ 2.000          → não exige aprovação
//   - violação leve OU valor entre 2k-10k       → 1 nível (gestor)
//   - violação de bloqueio OU valor 10k-30k     → 2 níveis (gestor + financeiro)
//   - viagem internacional OU valor > R$ 30.000 → 3 níveis (gestor + financeiro + diretoria)
//
// Persistência via localStorage (`bbt-aprovacoes`). API segue o
// mesmo padrão do `atendimentos-storage.ts` / `vouchers-emitidos-storage.ts`.
// ============================================================

import type {
  Atendimento,
  Empresa,
  NivelAprovacao,
  PassoAprovacao,
  SolicitacaoAprovacao,
  StatusAprovacao,
} from '@/types'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'
import { createEntityId } from '@/lib/ids'
import type { Violacao } from '@/lib/policy-engine'

const STORAGE_KEY = 'bbt-aprovacoes'

function load(): SolicitacaoAprovacao[] {
  if (typeof window === 'undefined') return []
  return loadJSON<SolicitacaoAprovacao[]>(STORAGE_KEY, [])
}

function save(list: SolicitacaoAprovacao[]): boolean {
  return safeSetJSON(STORAGE_KEY, list)
}

// ============================================================
// Roteamento / criação
// ============================================================

export function calcularNiveisNecessarios(args: {
  atendimento: Atendimento
  violacoes: Violacao[]
  internacional?: boolean
}): NivelAprovacao[] {
  const { atendimento, violacoes, internacional } = args
  const valor = atendimento.valor_cotacao || atendimento.valor_venda || 0
  const temBloqueio = violacoes.some((v) => v.severidade === 'bloqueio')
  const temAviso = violacoes.some((v) => v.severidade === 'aviso')
  const ehInternacional =
    internacional ?? !!atendimento.detalhes_aereo?.internacional

  if (ehInternacional || valor > 30000) return ['gestor', 'financeiro', 'diretoria']
  if (temBloqueio || valor > 10000) return ['gestor', 'financeiro']
  if (temAviso || valor > 2000) return ['gestor']
  return []
}

export function criarSolicitacao(args: {
  atendimento: Atendimento
  empresa?: Empresa | null
  violacoes: Violacao[]
  motivo: string
  solicitante_user_id: string
  solicitante_nome: string
}): SolicitacaoAprovacao | null {
  const niveis = calcularNiveisNecessarios({
    atendimento: args.atendimento,
    violacoes: args.violacoes,
  })
  if (niveis.length === 0) return null

  const id = createEntityId('apv')
  const passos: PassoAprovacao[] = niveis.map((nivel) => ({ nivel, status: 'pendente' }))
  const solicitacao: SolicitacaoAprovacao = {
    id,
    atendimento_id: args.atendimento.id,
    empresa_id: args.atendimento.empresa_id,
    valor_total: args.atendimento.valor_cotacao || args.atendimento.valor_venda || 0,
    motivo_aprovacao: args.motivo,
    violacoes_codigo: args.violacoes.map((v) => v.codigo),
    passos,
    status: 'pendente',
    solicitado_por_user_id: args.solicitante_user_id,
    solicitado_por_nome: args.solicitante_nome,
    created_at: new Date().toISOString(),
  }

  const list = load()
  list.push(solicitacao)
  save(list)
  return solicitacao
}

// ============================================================
// Consulta
// ============================================================

export function getAllSolicitacoes(): SolicitacaoAprovacao[] {
  return load().sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getSolicitacoesPendentes(): SolicitacaoAprovacao[] {
  return load().filter((s) => s.status === 'pendente')
}

export function getSolicitacaoPorAtendimento(
  atendimentoId: string,
): SolicitacaoAprovacao | undefined {
  return load().find((s) => s.atendimento_id === atendimentoId)
}

export function getSolicitacaoById(id: string): SolicitacaoAprovacao | undefined {
  return load().find((s) => s.id === id)
}

export function getSolicitacoesParaUsuario(
  userId: string,
): SolicitacaoAprovacao[] {
  return load().filter(
    (s) =>
      s.status === 'pendente' &&
      s.passos.some(
        (p) =>
          p.status === 'pendente' &&
          (!p.responsavel_user_id || p.responsavel_user_id === userId),
      ),
  )
}

// ============================================================
// Decisões
// ============================================================

function passoAtual(s: SolicitacaoAprovacao): PassoAprovacao | undefined {
  return s.passos.find((p) => p.status === 'pendente')
}

export function aprovarPasso(args: {
  solicitacao_id: string
  aprovador_user_id: string
  aprovador_nome: string
  comentario?: string
}): SolicitacaoAprovacao | null {
  const list = load()
  const idx = list.findIndex((s) => s.id === args.solicitacao_id)
  if (idx === -1) return null
  const s = list[idx]
  const passo = passoAtual(s)
  if (!passo) return null

  passo.status = 'aprovada'
  passo.responsavel_user_id = args.aprovador_user_id
  passo.responsavel_nome = args.aprovador_nome
  passo.comentario = args.comentario
  passo.decidido_em = new Date().toISOString()

  // Próximo passo? Se sim, mantém pendente; senão, aprova solicitação inteira
  const proximo = s.passos.find((p) => p.status === 'pendente')
  if (!proximo) {
    s.status = 'aprovada'
    s.decidido_em = new Date().toISOString()
  }
  s.updated_at = new Date().toISOString()

  list[idx] = s
  save(list)
  return s
}

export function rejeitarSolicitacao(args: {
  solicitacao_id: string
  aprovador_user_id: string
  aprovador_nome: string
  comentario: string
}): SolicitacaoAprovacao | null {
  const list = load()
  const idx = list.findIndex((s) => s.id === args.solicitacao_id)
  if (idx === -1) return null
  const s = list[idx]
  const passo = passoAtual(s)
  if (!passo) return null

  passo.status = 'rejeitada'
  passo.responsavel_user_id = args.aprovador_user_id
  passo.responsavel_nome = args.aprovador_nome
  passo.comentario = args.comentario
  passo.decidido_em = new Date().toISOString()

  s.status = 'rejeitada'
  s.decidido_em = new Date().toISOString()
  s.updated_at = new Date().toISOString()

  list[idx] = s
  save(list)
  return s
}

export function cancelarSolicitacao(id: string): boolean {
  const list = load()
  const idx = list.findIndex((s) => s.id === id)
  if (idx === -1) return false
  list[idx].status = 'cancelada'
  list[idx].updated_at = new Date().toISOString()
  return save(list)
}

// ============================================================
// Helpers para UI
// ============================================================

export function rotuloNivel(n: NivelAprovacao): string {
  switch (n) {
    case 'gestor': return 'Gestor direto'
    case 'financeiro': return 'Financeiro'
    case 'diretoria': return 'Diretoria'
  }
}

export function rotuloStatus(s: StatusAprovacao): string {
  switch (s) {
    case 'pendente': return 'Pendente'
    case 'aprovada': return 'Aprovada'
    case 'rejeitada': return 'Rejeitada'
    case 'expirada': return 'Expirada'
    case 'cancelada': return 'Cancelada'
  }
}

export function corStatus(s: StatusAprovacao): 'green' | 'red' | 'amber' | 'slate' {
  switch (s) {
    case 'aprovada': return 'green'
    case 'rejeitada': return 'red'
    case 'pendente': return 'amber'
    default: return 'slate'
  }
}

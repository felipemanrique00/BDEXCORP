// ============================================================
// PIPELINE DE IMPORTAÇÃO
// Toda importação passa pelas fases:
//   1. EXTRAIR (parser do arquivo)
//   2. NORMALIZAR (normalizers.ts)
//   3. VALIDAR (validators.ts → Zod)
//   4. RESOLVER (encontrar empresa/funcionário/etc)
//   5. CONFLITO? (duplicidade, divergência) → fila de revisão
//   6. PERSISTIR (dentro de transação com rollback)
//   7. RECONCILIAR (rodar detectores)
// ============================================================

import type { Atendimento, Empresa, Funcionario } from '@/types'
import { iniciarTransacao, commitarTransacao, registrarEvento, gerarId } from './audit'
import { validar, atendimentoSchema, linhaEmissaoSchema } from './validators'
import { chavedeNome, similaridade } from './normalizers'
import { loadJSON, safeSetJSON } from '@/lib/storage-quota'
import { encontrarFuncionarioConfiavel, encontrarFuncionarioPorNomeInteligente } from '@/lib/funcionario-identidade'

export type StatusItemFila = 'pendente' | 'aprovado' | 'rejeitado' | 'duvida'

export interface ItemImportacao {
  id: string
  tx_id: string // referência à transação
  origem: 'pdf_emissao' | 'planilha_xlsx' | 'voucher_pdf'
  arquivo_nome: string
  // Dados originais (do parser)
  dados_brutos: any
  // Dados normalizados/validados
  dados_normalizados?: any
  // Resolução
  empresa_match?: { id: string; nome: string; score: number; metodo: string }
  funcionario_match?: { id: string; nome: string; score: number; metodo: string }
  // Conflitos
  duplicado_de?: string // id do atendimento existente
  divergencias?: string[] // lista de problemas
  // Erros de validação
  erros?: Array<{ campo: string; mensagem: string }>
  // Status
  status: StatusItemFila
  motivo_revisao?: string
  // Resultado final
  atendimento_id?: string // se aprovado e persistido
  created_at: string
  resolvido_em?: string
  resolvido_por?: string
}

const STORAGE_FILA = 'bbt-fila-importacao'

function loadFila(): ItemImportacao[] {
  if (typeof window === 'undefined') return []
  return loadJSON<ItemImportacao[]>(STORAGE_FILA, [])
}

function saveFila(arr: ItemImportacao[]): boolean {
  if (typeof window === 'undefined') return false
  // Mantém só os últimos 5000 itens
  return safeSetJSON(STORAGE_FILA, arr.slice(-500))
}

// ============================================================
// FASE 4: RESOLVER ENTIDADES (empresa, funcionário)
// ============================================================

export function resolverEmpresa(
  empresas: Empresa[],
  candidato: { codigo?: string; nome?: string; cnpj?: string }
): { id: string; nome: string; score: number; metodo: string } | null {
  // 1. Match exato por código (mais forte)
  if (candidato.codigo) {
    const cod = candidato.codigo.toUpperCase().trim()
    const e = empresas.find((x) => (x.codigo_cliente || '').toUpperCase().trim() === cod)
    if (e) return { id: e.id, nome: e.nome, score: 100, metodo: 'codigo_exato' }
  }
  // 2. Match por CNPJ
  if (candidato.cnpj) {
    const cnpj = candidato.cnpj.replace(/\D/g, '')
    const e = empresas.find((x) => x.cnpj && x.cnpj.replace(/\D/g, '') === cnpj)
    if (e) return { id: e.id, nome: e.nome, score: 100, metodo: 'cnpj_exato' }
  }
  // 3. Match por nome (similaridade)
  if (candidato.nome) {
    const matches = empresas
      .map((e) => ({ e, score: similaridade(candidato.nome!, e.nome) }))
      .filter((m) => m.score >= 70)
      .sort((a, b) => b.score - a.score)
    if (matches.length > 0) {
      return { id: matches[0].e.id, nome: matches[0].e.nome, score: matches[0].score, metodo: 'nome_similar' }
    }
  }
  return null
}

export function resolverFuncionario(
  funcionarios: Funcionario[],
  candidato: { cpf?: string; nome?: string; email?: string; codigo?: string; codigo_identificacao?: string; matricula?: string },
  empresaId?: string
): { id: string; nome: string; score: number; metodo: string } | null {
  let pool = funcionarios.filter((f) => f.ativo !== false)
  if (empresaId) pool = pool.filter((f) => f.company_id === empresaId)

  const confiavel = encontrarFuncionarioConfiavel(pool, {
    cpf: candidato.cpf || '',
    email: candidato.email || '',
    codigo: candidato.codigo || candidato.codigo_identificacao || '',
    codigo_identificacao: candidato.codigo_identificacao || candidato.codigo || '',
    matricula: candidato.matricula || '',
  }, empresaId)
  if (confiavel) return { id: confiavel.id, nome: confiavel.nome, score: 100, metodo: 'identificador_confiavel' }

  if (candidato.nome) {
    const match = encontrarFuncionarioPorNomeInteligente(pool, candidato.nome, empresaId, 84)
    if (match && !match.ambiguo) {
      return { id: match.funcionario.id, nome: match.funcionario.nome, score: match.score, metodo: match.motivo }
    }
  }
  return null
}

// ============================================================
// FASE 5: DETECÇÃO DE CONFLITO/DUPLICIDADE
// ============================================================

export interface IndiceDuplicatasAtendimento {
  porVenda: Map<string, Atendimento>
  porEmpresaVenda: Map<string, Atendimento>
  porPessoaDataEmpresa: Map<string, Atendimento>
}

function chaveVenda(vendaNumero: string): string {
  return vendaNumero.trim().toUpperCase()
}

function chaveEmpresaVenda(empresaId: string, vendaNumero: string): string {
  return `${empresaId}\u001f${chaveVenda(vendaNumero)}`
}

function chavePessoaDataEmpresa(empresaId: string, passageiro: string, data: string): string {
  return `${empresaId}\u001f${data}\u001f${chavedeNome(passageiro)}`
}

export function criarIndiceDuplicatas(
  atendimentos: Atendimento[],
): IndiceDuplicatasAtendimento {
  const indice: IndiceDuplicatasAtendimento = {
    porVenda: new Map(),
    porEmpresaVenda: new Map(),
    porPessoaDataEmpresa: new Map(),
  }
  atendimentos.forEach((atendimento) => indexarAtendimentoDuplicado(indice, atendimento, false))
  return indice
}

export function indexarAtendimentoDuplicado(
  indice: IndiceDuplicatasAtendimento,
  atendimento: Atendimento,
  sobrescrever = true,
): void {
  const set = (map: Map<string, Atendimento>, key: string) => {
    if (sobrescrever || !map.has(key)) map.set(key, atendimento)
  }
  if (atendimento.venda_numero) {
    set(indice.porVenda, chaveVenda(atendimento.venda_numero))
    if (atendimento.empresa_id) {
      set(
        indice.porEmpresaVenda,
        chaveEmpresaVenda(atendimento.empresa_id, atendimento.venda_numero),
      )
    }
  }
  if (atendimento.empresa_id && atendimento.passageiro_nome && atendimento.data_atendimento) {
    set(
      indice.porPessoaDataEmpresa,
      chavePessoaDataEmpresa(
        atendimento.empresa_id,
        atendimento.passageiro_nome,
        atendimento.data_atendimento,
      ),
    )
  }
}

export function detectarDuplicataNoIndice(
  indice: IndiceDuplicatasAtendimento,
  candidato: { venda_numero?: string; passageiro?: string; data?: string; empresa_id?: string },
): Atendimento | null {
  if (candidato.venda_numero) {
    const porVenda = candidato.empresa_id
      ? indice.porEmpresaVenda.get(chaveEmpresaVenda(candidato.empresa_id, candidato.venda_numero))
      : indice.porVenda.get(chaveVenda(candidato.venda_numero))
    if (porVenda) return porVenda
  }
  if (candidato.passageiro && candidato.data && candidato.empresa_id) {
    return indice.porPessoaDataEmpresa.get(
      chavePessoaDataEmpresa(candidato.empresa_id, candidato.passageiro, candidato.data),
    ) || null
  }
  return null
}

export function detectarDuplicata(
  atendimentos: Atendimento[],
  candidato: { venda_numero?: string; passageiro?: string; data?: string; empresa_id?: string }
): Atendimento | null {
  // 1. Match exato por venda_numero (mais forte)
  if (candidato.venda_numero) {
    const venda = chaveVenda(candidato.venda_numero)
    const a = atendimentos.find((x) =>
      Boolean(x.venda_numero)
      && chaveVenda(x.venda_numero!) === venda
      && (!candidato.empresa_id || x.empresa_id === candidato.empresa_id)
    )
    if (a) return a
  }
  // 2. Match por passageiro + data + empresa
  if (candidato.passageiro && candidato.data && candidato.empresa_id) {
    const chave = chavedeNome(candidato.passageiro)
    const a = atendimentos.find((x) =>
      chavedeNome(x.passageiro_nome) === chave &&
      x.data_atendimento === candidato.data &&
      x.empresa_id === candidato.empresa_id
    )
    if (a) return a
  }
  return null
}

// ============================================================
// FILA DE REVISÃO
// ============================================================

export function adicionarItemFila(item: Omit<ItemImportacao, 'id' | 'created_at'>): ItemImportacao {
  const novo: ItemImportacao = {
    id: gerarId(),
    created_at: new Date().toISOString(),
    ...item,
  }
  const all = loadFila()
  all.push(novo)
  if (!saveFila(all)) {
    throw new Error('Não foi possível preparar o item da importação para persistência.')
  }
  return novo
}

export function getFila(filtro: { tx_id?: string; status?: StatusItemFila } = {}): ItemImportacao[] {
  let r = loadFila()
  if (filtro.tx_id) r = r.filter((i) => i.tx_id === filtro.tx_id)
  if (filtro.status) r = r.filter((i) => i.status === filtro.status)
  return r.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function atualizarItemFila(id: string, patch: Partial<ItemImportacao>): boolean {
  const all = loadFila()
  const i = all.findIndex((x) => x.id === id)
  if (i < 0) return false
  all[i] = { ...all[i], ...patch }
  return saveFila(all)
}

export function aprovarItemFila(
  id: string,
  userId: string,
  userName: string,
  atendimentoId?: string
): boolean {
  return atualizarItemFila(id, {
    status: 'aprovado',
    atendimento_id: atendimentoId,
    resolvido_em: new Date().toISOString(),
    resolvido_por: userName,
  })
}

export function rejeitarItemFila(
  id: string,
  userId: string,
  userName: string,
  motivo: string
): boolean {
  return atualizarItemFila(id, {
    status: 'rejeitado',
    motivo_revisao: motivo,
    resolvido_em: new Date().toISOString(),
    resolvido_por: userName,
  })
}

export function contarFila(): { total: number; pendente: number; duvida: number; aprovado: number; rejeitado: number } {
  const all = loadFila()
  return {
    total: all.length,
    pendente: all.filter((i) => i.status === 'pendente').length,
    duvida: all.filter((i) => i.status === 'duvida').length,
    aprovado: all.filter((i) => i.status === 'aprovado').length,
    rejeitado: all.filter((i) => i.status === 'rejeitado').length,
  }
}

export function limparFilaResolvidos(): boolean {
  const all = loadFila()
  return saveFila(all.filter((i) => i.status === 'pendente' || i.status === 'duvida'))
}

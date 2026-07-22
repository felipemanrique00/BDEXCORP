import type { Funcionario } from '@/types'

export const CODIGO_FUNCIONARIO_INICIAL = 1000
const PARTICULAS_NOME = new Set(['da', 'de', 'di', 'do', 'das', 'dos', 'del', 'della', 'e'])
const SUFIXOS_NOME = new Map([
  ['jr', 'junior'],
  ['júnior', 'junior'],
  ['junior', 'junior'],
  ['filho', 'filho'],
  ['neto', 'neto'],
  ['sobrinho', 'sobrinho'],
])

export type MatchFuncionario = {
  funcionario: Funcionario
  score: number
  motivo: string
  ambiguo?: boolean
}

type NomePessoaNormalizado = {
  normalizados: string[]
  tokens: string[]
  tokenSet: Set<string>
  primeiro?: string
  ultimo?: string
}

export function normalizarCodigoIdentificacao(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

export function normalizarTextoIdentidade(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9@._+\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizarNomePessoa(value: unknown): NomePessoaNormalizado {
  const raw = String(value ?? '').trim()
  const variantesRaw = new Set<string>()
  if (raw) variantesRaw.add(raw)

  if (raw.includes('/')) {
    const partes = raw.split('/').map((parte) => parte.trim()).filter(Boolean)
    if (partes.length >= 2) {
      variantesRaw.add([partes.slice(1).join(' '), partes[0]].filter(Boolean).join(' '))
    }
  }

  if (raw.includes(',')) {
    const partes = raw.split(',').map((parte) => parte.trim()).filter(Boolean)
    if (partes.length >= 2) {
      variantesRaw.add([partes.slice(1).join(' '), partes[0]].filter(Boolean).join(' '))
    }
  }

  const normalizados = Array.from(variantesRaw)
    .map((item) => normalizarTextoIdentidade(item.replace(/[\\/_,;]+/g, ' ')))
    .map(normalizarSufixosNome)
    .filter(Boolean)

  const tokens = selecionarMelhorTokenizacao(normalizados)
  return {
    normalizados: Array.from(new Set(normalizados)),
    tokens,
    tokenSet: new Set(tokens),
    primeiro: tokens[0],
    ultimo: tokens[tokens.length - 1],
  }
}

export function normalizarDocumento(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function normalizarEmail(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR')
}

export function normalizarAliasesFuncionario(aliases: unknown): string[] {
  const itens = Array.isArray(aliases)
    ? aliases
    : String(aliases ?? '').split(/\r?\n|;/)
  const seen = new Set<string>()
  const normalizados: string[] = []

  itens.forEach((item) => {
    const alias = String(item ?? '').replace(/\s+/g, ' ').trim()
    if (alias.length < 2) return
    const chave = normalizarNomePessoa(alias).normalizados[0] || normalizarTextoIdentidade(alias)
    if (!chave || seen.has(chave)) return
    seen.add(chave)
    normalizados.push(alias)
  })

  return normalizados.slice(0, 40)
}

export function proximoCodigoIdentificacao(funcionarios: Array<Pick<Funcionario, 'codigo_identificacao'>>): string {
  const maior = funcionarios.reduce((max, funcionario) => {
    const codigo = Number(normalizarCodigoIdentificacao(funcionario.codigo_identificacao))
    return Number.isFinite(codigo) ? Math.max(max, codigo) : max
  }, CODIGO_FUNCIONARIO_INICIAL - 1)
  return String(maior + 1)
}

export function criarSequenciadorCodigoIdentificacao(
  funcionarios: Array<Pick<Funcionario, 'codigo_identificacao'>>,
): () => string {
  const codigosUsados = new Set<string>()
  let maiorCodigo = CODIGO_FUNCIONARIO_INICIAL - 1

  for (const funcionario of funcionarios) {
    const codigo = normalizarCodigoIdentificacao(funcionario.codigo_identificacao)
    if (!codigo) continue
    codigosUsados.add(codigo)
    maiorCodigo = Math.max(maiorCodigo, Number(codigo))
  }

  return () => {
    let codigo: string
    do {
      maiorCodigo += 1
      codigo = String(maiorCodigo)
    } while (codigosUsados.has(codigo))
    codigosUsados.add(codigo)
    return codigo
  }
}

export function garantirCodigoIdentificacao(
  funcionario: Funcionario,
  funcionariosBase: Array<Pick<Funcionario, 'id' | 'codigo_identificacao'>>,
): Funcionario {
  const codigoAtual = normalizarCodigoIdentificacao(funcionario.codigo_identificacao)
  const usadoPorOutro = codigoAtual
    ? funcionariosBase.some((item) => item.id !== funcionario.id && normalizarCodigoIdentificacao(item.codigo_identificacao) === codigoAtual)
    : false
  const aliasesNome = normalizarAliasesFuncionario(funcionario.aliases_nome)

  if (codigoAtual && !usadoPorOutro) {
    return { ...funcionario, codigo_identificacao: codigoAtual, aliases_nome: aliasesNome }
  }

  return {
    ...funcionario,
    aliases_nome: aliasesNome,
    codigo_identificacao: proximoCodigoIdentificacao(funcionariosBase),
  }
}

export function normalizarFuncionariosComCodigo(funcionarios: Funcionario[]): Funcionario[] {
  const resultado: Funcionario[] = []
  const codigosUsados = new Set<string>()
  let maiorCodigo = CODIGO_FUNCIONARIO_INICIAL - 1

  for (const funcionario of funcionarios) {
    const codigoAtual = normalizarCodigoIdentificacao(funcionario.codigo_identificacao)
    let codigo = codigoAtual

    if (!codigo || codigosUsados.has(codigo)) {
      do {
        maiorCodigo += 1
        codigo = String(maiorCodigo)
      } while (codigosUsados.has(codigo))
    } else {
      maiorCodigo = Math.max(maiorCodigo, Number(codigo))
    }

    codigosUsados.add(codigo)
    resultado.push({
      ...funcionario,
      codigo_identificacao: codigo,
      aliases_nome: normalizarAliasesFuncionario(funcionario.aliases_nome),
    })
  }
  return resultado
}

export function encontrarFuncionarioPorCodigo(
  funcionarios: Funcionario[],
  codigo: unknown,
  empresaId?: string | null,
): Funcionario | null {
  const codigoNormalizado = normalizarCodigoIdentificacao(codigo)
  if (!codigoNormalizado) return null
  return (
    funcionarios.find((funcionario) => {
      if (empresaId && funcionario.company_id !== empresaId) return false
      return normalizarCodigoIdentificacao(funcionario.codigo_identificacao) === codigoNormalizado
    }) || null
  )
}

export function compararNomeFuncionario(nomeInformado: unknown, funcionario: Pick<Funcionario, 'nome' | 'aliases_nome'>): { score: number; motivo: string } {
  const alvo = normalizarNomePessoa(nomeInformado)
  const cadastrado = normalizarNomePessoa(funcionario.nome)
  if (alvo.tokens.length === 0 || cadastrado.tokens.length === 0) return { score: 0, motivo: 'nome_vazio' }

  const aliases = normalizarAliasesFuncionario(funcionario.aliases_nome)
  const aliasExato = aliases.some((alias) => {
    const aliasNormalizado = normalizarNomePessoa(alias)
    return alvo.normalizados.some((nome) => aliasNormalizado.normalizados.includes(nome))
  })
  if (aliasExato) {
    return { score: 100, motivo: 'alias_manual' }
  }

  if (alvo.normalizados.some((nome) => cadastrado.normalizados.includes(nome))) {
    return { score: 100, motivo: 'nome_exato' }
  }

  const intersecao = alvo.tokens.filter((token) => cadastrado.tokenSet.has(token))
  const intersecaoSet = new Set(intersecao)
  const alvoSubset = alvo.tokens.every((token) => cadastrado.tokenSet.has(token))
  const cadastradoSubset = cadastrado.tokens.every((token) => alvo.tokenSet.has(token))
  const mesmoPrimeiro = Boolean(alvo.primeiro && cadastrado.primeiro && alvo.primeiro === cadastrado.primeiro)
  const mesmoUltimo = Boolean(alvo.ultimo && cadastrado.ultimo && alvo.ultimo === cadastrado.ultimo)

  if (alvoSubset && cadastradoSubset) return { score: 97, motivo: 'mesmos_tokens' }
  if (mesmoPrimeiro && mesmoUltimo && intersecaoSet.size >= 2) return { score: 94, motivo: 'primeiro_ultimo' }
  if (mesmoPrimeiro && alvoSubset && alvo.tokens.length >= 2) return { score: 92, motivo: 'nome_parcial_cadastrado' }
  if (mesmoPrimeiro && cadastradoSubset && cadastrado.tokens.length >= 2) return { score: 90, motivo: 'cadastro_contido_no_nome' }
  if (mesmoPrimeiro && intersecaoSet.size >= 2) return { score: 86 + Math.min(6, intersecaoSet.size * 2), motivo: 'primeiro_e_sobrenome' }

  const temSufixoAlvo = alvo.tokens.some((token) => ['junior', 'filho', 'neto', 'sobrinho'].includes(token))
  if (mesmoPrimeiro && temSufixoAlvo && intersecaoSet.size >= 2) return { score: 88, motivo: 'primeiro_e_sufixo' }

  const coberturaAlvo = intersecaoSet.size / Math.max(1, alvo.tokenSet.size)
  const coberturaCadastro = intersecaoSet.size / Math.max(1, cadastrado.tokenSet.size)
  if (mesmoPrimeiro && coberturaAlvo >= 0.66 && coberturaCadastro >= 0.5 && intersecaoSet.size >= 2) {
    return { score: 84, motivo: 'cobertura_parcial' }
  }

  if (alvo.tokens.length === 1 && mesmoPrimeiro) return { score: 62, motivo: 'apenas_primeiro_nome' }
  if (intersecaoSet.size >= 2 && coberturaAlvo >= 0.66 && coberturaCadastro >= 0.5) return { score: 76, motivo: 'tokens_sem_primeiro_nome' }

  return { score: Math.round(Math.max(coberturaAlvo, coberturaCadastro) * 60), motivo: 'baixa_similaridade' }
}

export function buscarFuncionariosPorNomeInteligente(
  funcionarios: Funcionario[],
  nomeInformado: unknown,
  empresaId?: string | null,
  limit = 10,
): MatchFuncionario[] {
  const base = empresaId ? funcionarios.filter((funcionario) => funcionario.company_id === empresaId) : funcionarios
  return base
    .map((funcionario) => {
      const match = compararNomeFuncionario(nomeInformado, funcionario)
      return { funcionario, score: match.score, motivo: match.motivo }
    })
    .filter((item) => item.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function encontrarFuncionarioPorNomeInteligente(
  funcionarios: Funcionario[],
  nomeInformado: unknown,
  empresaId?: string | null,
  minScore = 84,
): MatchFuncionario | null {
  const ranked = buscarFuncionariosPorNomeInteligente(funcionarios, nomeInformado, empresaId, 3)
  const top = ranked[0]
  if (!top || top.score < minScore) return null
  const segundo = ranked[1]
  if (segundo && segundo.score >= minScore && top.score - segundo.score < 8) {
    if (top.motivo === 'alias_manual' && segundo.motivo !== 'alias_manual' && segundo.motivo !== 'nome_exato') {
      return top
    }
    return { ...top, ambiguo: true }
  }
  return top
}

export function chaveConfiavelFuncionario(funcionario: Partial<Funcionario>, empresaId?: string | null): string {
  const empresa = empresaId || funcionario.company_id || ''
  const codigo = normalizarCodigoIdentificacao(funcionario.codigo_identificacao)
  if (codigo) return `${empresa}|codigo:${codigo}`

  const documento = normalizarDocumento(funcionario.cpf || funcionario.documento_numero)
  if (documento.length >= 5) return `${empresa}|doc:${documento}`

  const email = normalizarEmail(funcionario.email)
  if (email) return `${empresa}|email:${email}`

  const matricula = normalizarTextoIdentidade(funcionario.matricula)
  if (matricula) return `${empresa}|matricula:${matricula}`

  return ''
}

export function encontrarFuncionarioConfiavel(
  funcionarios: Funcionario[],
  dados: Partial<Funcionario> & { nome_informado?: string; codigo?: unknown },
  empresaId?: string | null,
): Funcionario | null {
  const empresa = empresaId || dados.company_id || null
  const porCodigo = encontrarFuncionarioPorCodigo(funcionarios, dados.codigo ?? dados.codigo_identificacao, empresa)
  if (porCodigo) return porCodigo

  const documento = normalizarDocumento(dados.cpf || dados.documento_numero)
  if (documento.length >= 5) {
    const encontrado = funcionarios.find((funcionario) => {
      if (empresa && funcionario.company_id !== empresa) return false
      return normalizarDocumento(funcionario.cpf || funcionario.documento_numero) === documento
    })
    if (encontrado) return encontrado
  }

  const email = normalizarEmail(dados.email)
  if (email) {
    const encontrado = funcionarios.find((funcionario) => {
      if (empresa && funcionario.company_id !== empresa) return false
      return normalizarEmail(funcionario.email) === email
    })
    if (encontrado) return encontrado
  }

  const matricula = normalizarTextoIdentidade(dados.matricula)
  if (matricula) {
    const encontrado = funcionarios.find((funcionario) => {
      if (empresa && funcionario.company_id !== empresa) return false
      return normalizarTextoIdentidade(funcionario.matricula) === matricula
    })
    if (encontrado) return encontrado
  }

  return null
}

export function resolverFuncionarioAtendimento(
  atendimento: { funcionario_id?: string | null; passageiro_nome?: string; empresa_id?: string },
  funcionarios: Funcionario[],
  minScore = 84,
): Funcionario | null {
  if (atendimento.funcionario_id) {
    return funcionarios.find((funcionario) => funcionario.id === atendimento.funcionario_id) || null
  }
  const match = encontrarFuncionarioPorNomeInteligente(funcionarios, atendimento.passageiro_nome, atendimento.empresa_id, minScore)
  return match && !match.ambiguo ? match.funcionario : null
}

export function chavePessoaRelatorio(atendimento: { funcionario_id?: string | null; passageiro_nome?: string }, funcionario?: Funcionario | null): string {
  if (funcionario?.id) return `func:${funcionario.id}`
  if (atendimento.funcionario_id) return `func:${atendimento.funcionario_id}`
  const nome = normalizarTextoIdentidade(atendimento.passageiro_nome)
  return nome ? `nome:${nome}` : ''
}

function normalizarSufixosNome(value: string): string {
  return value
    .split(/\s+/)
    .map((token) => SUFIXOS_NOME.get(token) || token)
    .join(' ')
}

function selecionarMelhorTokenizacao(normalizados: string[]): string[] {
  const variantes = normalizados
    .map((nome) => nome.split(/\s+/).filter((token) => token && !PARTICULAS_NOME.has(token)))
    .filter((tokens) => tokens.length > 0)
  if (variantes.length === 0) return []
  return variantes.sort((a, b) => b.length - a.length)[0]
}

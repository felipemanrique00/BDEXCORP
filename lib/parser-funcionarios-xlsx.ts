// ============================================================
// PARSER PLANILHA DE FUNCIONÁRIOS — V7
//
// Layout esperado (formato Vitamedic verificado):
//   Nome Func. | Centro De Custo | Descrição CC | Cargo | CPF | Dt Nascimento
//
// Mas tolera variações:
//   Nome | CC | Setor | Cargo | CPF | Nascimento
// e outros sinônimos.
// ============================================================

import * as XLSX from 'xlsx'
import { toISODateOnly } from '@/lib/date'

export interface FuncionarioParsed {
  nome: string
  cpf: string             // só dígitos (11)
  cargo: string
  centro_custo: string
  descricao_cc: string
  data_nascimento: string // ISO
  aliases_nome: string[]
  warnings: string[]
}

export interface ResultadoParseFuncionarios {
  empresa_nome_arquivo?: string  // detectado do nome do arquivo, se possível
  total_linhas: number
  funcionarios: FuncionarioParsed[]
  duplicatas_internas: number
  warnings_globais: string[]
}

// === Helpers ===

function normalizarCPF(s: any): string {
  if (!s) return ''
  const d = String(s).replace(/\D/g, '')
  if (d.length !== 11) return ''
  if (/^(\d)\1{10}$/.test(d)) return ''
  // Validação dígito verificador
  let soma = 0
  for (let i = 0; i < 9; i++) soma += parseInt(d[i]) * (10 - i)
  let dv1 = 11 - (soma % 11); if (dv1 >= 10) dv1 = 0
  if (dv1 !== parseInt(d[9])) return ''
  soma = 0
  for (let i = 0; i < 10; i++) soma += parseInt(d[i]) * (11 - i)
  let dv2 = 11 - (soma % 11); if (dv2 >= 10) dv2 = 0
  if (dv2 !== parseInt(d[10])) return ''
  return d
}

function normalizarNome(s: any): string {
  if (!s) return ''
  const t = String(s).replace(/\s+/g, ' ').trim().toLowerCase()
  const particulas = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
  return t.split(' ').map((p, i) => i > 0 && particulas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function normalizarData(s: any): string {
  const iso = toISODateOnly(s)
  if (iso) return iso
  if (!s) return ''
  const t = String(s).trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    let ano = parseInt(m[3])
    if (ano < 100) ano = ano < 50 ? 2000 + ano : 1900 + ano
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return ''
}

// Mapeia variações de nome de coluna
const COLUNAS_NOME = ['nome func', 'nome funcionario', 'nome funcionário', 'nome', 'funcionario', 'funcionário', 'colaborador', 'employee']
const COLUNAS_CPF = ['cpf', 'cpf func', 'cpf colaborador']
const COLUNAS_CARGO = ['cargo', 'funcao', 'função', 'position']
const COLUNAS_CC = ['centro de custo', 'cc', 'centro custo', 'cost center', 'codigo cc']
const COLUNAS_DESC_CC = ['descrição cc', 'descricao cc', 'descrição', 'departamento', 'setor', 'department']
const COLUNAS_NASC = ['dt nascimento', 'data nascimento', 'nascimento', 'data nasc', 'birthdate', 'data de nascimento']
const COLUNAS_ALIASES = ['aliases', 'alias', 'nomes alternativos', 'nome wintour', 'nome relatorio', 'nome relatório', 'nome aereo', 'nome aéreo', 'nome hotel']

function detectarColuna(header: string[], candidatos: string[]): number {
  const norm = header.map((h) => String(h || '').toLowerCase().trim().replace(/[^\w\s]/g, ''))
  for (let i = 0; i < norm.length; i++) {
    for (const c of candidatos) {
      const cn = c.replace(/[^\w\s]/g, '')
      if (norm[i] === cn || norm[i].startsWith(cn + ' ') || norm[i] === cn.replace(/\s/g, '')) {
        return i
      }
    }
  }
  return -1
}

export async function parsePlanilhaFuncionarios(file: File): Promise<ResultadoParseFuncionarios> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

  // Detecta nome da empresa pelo nome do arquivo
  let empresa_nome_arquivo: string | undefined
  const nomeArq = file.name.toUpperCase()
  const mEmp = nomeArq.match(/(VITAMEDIC|REFRESCOS|GOIASTELE|ALFA|VITAPHARMA|WAY\d+|REBICA|HOLDING|ROTA[\s_]?BBT)/i)
  if (mEmp) empresa_nome_arquivo = mEmp[1].toUpperCase()

  const funcionarios: FuncionarioParsed[] = []
  const warnings_globais: string[] = []
  const cpfsVistos = new Set<string>()
  let duplicatas_internas = 0
  let total_linhas = 0

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as any[][]
    if (rows.length === 0) continue

    // Detecta linha do header (procura nas primeiras 5 linhas)
    let headerIdx = 0
    let header: string[] = []
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const r = rows[i].map((c) => String(c || '').toLowerCase())
      if (r.some((c) => /(nome|cpf|cargo)/i.test(c))) {
        headerIdx = i
        header = rows[i].map((c) => String(c || ''))
        break
      }
    }
    if (header.length === 0) {
      warnings_globais.push(`Sheet "${sheetName}": header não detectado, ignorada`)
      continue
    }

    const cNome = detectarColuna(header, COLUNAS_NOME)
    const cCpf = detectarColuna(header, COLUNAS_CPF)
    const cCargo = detectarColuna(header, COLUNAS_CARGO)
    const cCC = detectarColuna(header, COLUNAS_CC)
    const cDescCC = detectarColuna(header, COLUNAS_DESC_CC)
    const cNasc = detectarColuna(header, COLUNAS_NASC)
    const cAliases = detectarColuna(header, COLUNAS_ALIASES)

    if (cNome < 0) {
      warnings_globais.push(`Sheet "${sheetName}": coluna de nome não encontrada`)
      continue
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every((c) => !c || String(c).trim() === '')) continue
      total_linhas++

      const nomeRaw = row[cNome]
      if (!nomeRaw || String(nomeRaw).trim().length < 2) continue

      const cpfRaw = cCpf >= 0 ? row[cCpf] : ''
      const warnings: string[] = []

      const cpf = normalizarCPF(cpfRaw)
      if (cpfRaw && !cpf) warnings.push(`CPF inválido: ${cpfRaw}`)
      if (cpf && cpfsVistos.has(cpf)) {
        warnings.push('CPF duplicado na própria planilha')
        duplicatas_internas++
      }
      if (cpf) cpfsVistos.add(cpf)

      const f: FuncionarioParsed = {
        nome: normalizarNome(nomeRaw),
        cpf,
        cargo: cCargo >= 0 ? String(row[cCargo] || '').trim() : '',
        centro_custo: cCC >= 0 ? String(row[cCC] || '').trim() : '',
        descricao_cc: cDescCC >= 0 ? String(row[cDescCC] || '').trim() : '',
        data_nascimento: cNasc >= 0 ? normalizarData(row[cNasc]) : '',
        aliases_nome: cAliases >= 0 ? String(row[cAliases] || '').split(/\r?\n|;|\|/).map((item) => item.trim()).filter(Boolean) : [],
        warnings,
      }
      funcionarios.push(f)
    }
  }

  return {
    empresa_nome_arquivo,
    total_linhas,
    funcionarios,
    duplicatas_internas,
    warnings_globais,
  }
}

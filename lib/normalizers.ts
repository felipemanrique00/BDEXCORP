import { formatDateBR, toISODateOnly } from '@/lib/date'

// ============================================================
// NORMALIZADORES — fonte única de verdade pra padronização de dados
// Tudo que entra no sistema (parsers, formulários, importações)
// passa por aqui. Garante consistência absoluta.
// ============================================================

/**
 * Normaliza um nome de pessoa:
 * - Remove espaços extras
 * - Title case (primeira letra maiúscula, resto minúscula)
 * - Trata partículas (de, da, dos, e) em minúscula
 * - Remove caracteres estranhos
 */
export function normalizarNome(s: string | null | undefined): string {
  if (!s) return ''
  const limpo = s
    .replace(/[^\p{L}\s'-]/gu, ' ') // só letras, espaço, hífen, apóstrofo
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  const particulas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'del', 'della', 'van', 'von'])
  return limpo
    .split(' ')
    .map((p, i) => {
      if (i > 0 && particulas.has(p)) return p
      // Trata hífen e apóstrofo
      return p
        .split(/(['-])/)
        .map((parte) => (parte === '-' || parte === "'" ? parte : parte.charAt(0).toUpperCase() + parte.slice(1)))
        .join('')
    })
    .join(' ')
}

/**
 * Normaliza chave de busca de nome (sem acentos, lowercase, sem espaços extras).
 * Usado pra deduplicação e match.
 */
export function chavedeNome(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * Normaliza CPF: aceita "123.456.789-00", "12345678900", "123 456 789 00"
 * Retorna 11 dígitos OU '' se inválido.
 */
export function normalizarCPF(s: string | null | undefined): string {
  if (!s) return ''
  const digitos = s.replace(/\D/g, '')
  if (digitos.length !== 11) return ''
  // Validação de CPF (dígito verificador)
  if (/^(\d)\1{10}$/.test(digitos)) return '' // todos iguais
  let soma = 0
  for (let i = 0; i < 9; i++) soma += parseInt(digitos[i]) * (10 - i)
  let dv1 = 11 - (soma % 11)
  if (dv1 >= 10) dv1 = 0
  if (dv1 !== parseInt(digitos[9])) return ''
  soma = 0
  for (let i = 0; i < 10; i++) soma += parseInt(digitos[i]) * (11 - i)
  let dv2 = 11 - (soma % 11)
  if (dv2 >= 10) dv2 = 0
  if (dv2 !== parseInt(digitos[10])) return ''
  return digitos
}

/** Formata CPF normalizado pra exibição: 123.456.789-00 */
export function formatarCPF(cpf: string): string {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/**
 * Normaliza CNPJ. Retorna 14 dígitos ou ''.
 */
export function normalizarCNPJ(s: string | null | undefined): string {
  if (!s) return ''
  const d = s.replace(/\D/g, '')
  if (d.length !== 14) return ''
  if (/^(\d)\1{13}$/.test(d)) return ''
  // Validação de CNPJ
  const calc = (base: string) => {
    const len = base.length
    const nums = base.split('').map(Number)
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = nums.reduce((acc, n, i) => acc + n * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  if (calc(d.slice(0, 12)) !== parseInt(d[12])) return ''
  if (calc(d.slice(0, 13)) !== parseInt(d[13])) return ''
  return d
}

export function formatarCNPJ(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/**
 * Normaliza telefone para formato +55XX9XXXXXXXX (DDI Brasil)
 * Aceita: (62) 99999-9999, 62999999999, +5562999999999, etc
 */
export function normalizarTelefone(s: string | null | undefined): string {
  if (!s) return ''
  let d = s.replace(/\D/g, '')
  // Remove 55 inicial se vier
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  // Aceita 10 (fixo) ou 11 (celular) dígitos
  if (d.length < 10 || d.length > 11) return ''
  return d
}

export function formatarTelefone(t: string): string {
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

/**
 * Normaliza data para ISO YYYY-MM-DD.
 * Aceita: "23/04/2026", "23/04/26", "2026-04-23", "23-04-2026", "23 abr 2026"
 */
export function normalizarData(s: string | number | Date | null | undefined): string {
  const iso = toISODateOnly(s)
  if (iso) return iso
  if (!s) return ''
  const t = String(s).trim()

  // ISO já: YYYY-MM-DD
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const ano = parseInt(m[1]), mes = parseInt(m[2]), dia = parseInt(m[3])
    if (ano >= 1900 && ano <= 2100 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return `${m[1]}-${m[2]}-${m[3]}`
    }
  }

  // DD/MM/YYYY ou DD/MM/YY ou DD-MM-YYYY
  m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (m) {
    const dia = parseInt(m[1]), mes = parseInt(m[2])
    let ano = parseInt(m[3])
    if (ano < 100) ano = ano < 50 ? 2000 + ano : 1900 + ano
    if (ano >= 1900 && ano <= 2100 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    }
  }

  // "23 abr 2026" ou "23 de abril de 2026"
  const meses: Record<string, string> = {
    jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
    jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
  }
  m = t.toLowerCase().match(/(\d{1,2})\s*(?:de\s+)?(\w{3,})\s*(?:de\s+)?(\d{2,4})/)
  if (m) {
    const dia = parseInt(m[1])
    const mesNome = m[2].slice(0, 3)
    const mes = meses[mesNome]
    let ano = parseInt(m[3])
    if (ano < 100) ano = ano < 50 ? 2000 + ano : 1900 + ano
    if (mes && dia >= 1 && dia <= 31) {
      return `${ano}-${mes}-${String(dia).padStart(2, '0')}`
    }
  }

  return ''
}

/** Formata data ISO pra exibição BR: 23/04/2026 */
export function formatarData(iso: string | null | undefined): string {
  return formatDateBR(iso, '')
}

/**
 * Normaliza valor monetário em qualquer formato BR/EN.
 * Aceita: "1.234,56", "1234.56", "R$ 1.234,56", "1234,56", "1234"
 * Retorna: número (em reais, com decimal)
 */
export function normalizarValor(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0
  if (typeof s === 'number') return Math.round(s * 100) / 100
  let t = String(s).trim().replace(/R\$\s?/i, '').replace(/\s/g, '')
  if (!t) return 0
  // Detecta separador decimal
  // Caso 1: tem vírgula como decimal: "1.234,56" → "1234.56"
  if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) {
    t = t.replace(/\./g, '').replace(',', '.')
  }
  // Caso 2: tem ponto como decimal: "1234.56" - mantém
  // Caso 3: só dígitos: "1234"
  const n = parseFloat(t.replace(/[^\d.\-]/g, ''))
  if (isNaN(n)) return 0
  return Math.round(n * 100) / 100 // 2 casas decimais sempre
}

export function formatarValor(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Normaliza email: lowercase + trim + valida formato básico
 */
export function normalizarEmail(s: string | null | undefined): string {
  if (!s) return ''
  const t = s.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return ''
  return t
}

/**
 * Normaliza string genérica: trim + colapsar espaços + uppercase opcional
 */
export function normalizarTexto(s: string | null | undefined, opts: { upper?: boolean; max?: number } = {}): string {
  if (!s) return ''
  let t = String(s).replace(/\s+/g, ' ').trim()
  if (opts.upper) t = t.toUpperCase()
  if (opts.max && t.length > opts.max) t = t.slice(0, opts.max)
  return t
}

/**
 * Normaliza status de emissão (CF=finalizado, ND=não disponível, NC=não convalidado, etc)
 * Mapeia pra nosso domínio interno.
 */
export function normalizarStatusEmissao(s: string | null | undefined): 'finalizado' | 'em_andamento' | 'pendente' | 'cancelado' {
  if (!s) return 'em_andamento'
  const t = String(s).trim().toUpperCase()
  if (['CF', 'CONFIRMADO', 'FINALIZADO', 'OK', 'EMITIDO'].includes(t)) return 'finalizado'
  if (['ND', 'NC', 'PENDENTE', 'AGUARDANDO'].includes(t)) return 'pendente'
  if (['CA', 'CANCELADO', 'CANCEL'].includes(t)) return 'cancelado'
  return 'em_andamento'
}

/**
 * Normaliza tipo de serviço a partir de qualquer string livre.
 * Mantém compat com TipoServico do nosso types.
 */
export function normalizarTipoServico(s: string | null | undefined): 'Hotel' | 'Aéreo' | 'Carro' | 'Pacote' | 'Outro' {
  if (!s) return 'Outro'
  const t = String(s).toLowerCase()
  if (/hotel|hospedag|htl|pousada|resort/.test(t)) return 'Hotel'
  if (/aero|voo|tkt|passag|aereo|aérea|airline|cia/.test(t)) return 'Aéreo'
  if (/carr|loca[çc][aã]o|veicul|car/.test(t)) return 'Carro'
  if (/pacot|package/.test(t)) return 'Pacote'
  return 'Outro'
}

/**
 * Compara duas strings ignorando acentos/case, retorna similaridade 0-100
 * Usa Levenshtein normalizado.
 */
export function similaridade(a: string, b: string): number {
  const ka = chavedeNome(a)
  const kb = chavedeNome(b)
  if (!ka || !kb) return 0
  if (ka === kb) return 100

  // Levenshtein
  const m = ka.length, n = kb.length
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = ka[i - 1] === kb[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  const dist = dp[m][n]
  const maxLen = Math.max(m, n)
  return Math.round((1 - dist / maxLen) * 100)
}

// ============================================================
// PARSER PLANILHA DE HOTÉIS — V7
//
// Layout flexível. Detecta colunas por sinônimos:
//   Nome | Cidade | UF | Telefone | Categoria | Tarifa SGL | Tarifa DBL | Tarifa TPL
//   + observações, bebedouro, café, estacionamento, faturado
// ============================================================

import * as XLSX from 'xlsx'

export interface HotelParsed {
  nome: string
  cidade: string
  uf: string
  telefone: string
  categoria: string  // '1' a '5' ou ''
  observacoes: string
  faturado: boolean
  info_faturamento: string
  bebedouro: string
  valor_agua: number | null
  cafe_manha: string
  estacionamento: string
  tarifa_sgl: number | null
  tarifa_dbl: number | null
  tarifa_tpl: number | null
  warnings: string[]
}

export interface ResultadoParseHoteis {
  total_linhas: number
  hoteis: HotelParsed[]
  duplicatas_internas: number
  warnings_globais: string[]
}

// === Helpers ===

function normalizarTexto(s: any): string {
  if (s === null || s === undefined) return ''
  return String(s).replace(/\s+/g, ' ').trim()
}

function normalizarUF(s: any): string {
  const t = normalizarTexto(s).toUpperCase()
  if (t.length === 2) return t
  // Mapeamento de nomes completos
  const mapa: Record<string, string> = {
    'GOIAS': 'GO', 'GOIÁS': 'GO', 'SAO PAULO': 'SP', 'SÃO PAULO': 'SP',
    'RIO DE JANEIRO': 'RJ', 'MINAS GERAIS': 'MG', 'PARANA': 'PR', 'PARANÁ': 'PR',
    'BAHIA': 'BA', 'CEARA': 'CE', 'CEARÁ': 'CE', 'PERNAMBUCO': 'PE',
    'DISTRITO FEDERAL': 'DF', 'BRASILIA': 'DF', 'BRASÍLIA': 'DF',
    'ESPIRITO SANTO': 'ES', 'ESPÍRITO SANTO': 'ES', 'SANTA CATARINA': 'SC',
    'RIO GRANDE DO SUL': 'RS', 'RIO GRANDE DO NORTE': 'RN', 'PIAUI': 'PI', 'PIAUÍ': 'PI',
    'PARA': 'PA', 'PARÁ': 'PA', 'AMAZONAS': 'AM', 'MATO GROSSO': 'MT',
    'MATO GROSSO DO SUL': 'MS', 'TOCANTINS': 'TO', 'MARANHAO': 'MA', 'MARANHÃO': 'MA',
    'PARAIBA': 'PB', 'PARAÍBA': 'PB', 'ALAGOAS': 'AL', 'SERGIPE': 'SE',
    'RONDONIA': 'RO', 'RONDÔNIA': 'RO', 'RORAIMA': 'RR', 'AMAPA': 'AP', 'AMAPÁ': 'AP',
    'ACRE': 'AC',
  }
  return mapa[t] || t.slice(0, 2)
}

function parseValor(s: any): number | null {
  if (s === null || s === undefined || s === '') return null
  if (typeof s === 'number') return Math.round(s * 100) / 100
  let t = String(s).trim().replace(/[Rr]\$\s*/g, '').replace(/\s/g, '')
  if (!t) return null
  // BR: 1.234,56 -> 1234.56 / EN: 1,234.56 -> 1234.56
  if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) {
    t = t.replace(/\./g, '').replace(',', '.')
  } else if (t.includes(',') && !t.includes('.')) {
    t = t.replace(',', '.')
  }
  const n = parseFloat(t.replace(/[^\d.\-]/g, ''))
  if (isNaN(n)) return null
  return Math.round(n * 100) / 100
}

function parseBoolean(s: any): boolean {
  if (typeof s === 'boolean') return s
  if (typeof s === 'number') return s !== 0
  const t = String(s || '').toLowerCase().trim()
  return ['sim', 's', 'yes', 'y', 'true', '1', 'x'].includes(t)
}

function parseCategoria(s: any): string {
  if (!s) return ''
  const t = String(s).trim()
  // Aceita "5", "5*", "5 estrelas", "5 ESTRELAS", etc
  const m = t.match(/(\d)/)
  if (m && parseInt(m[1]) >= 1 && parseInt(m[1]) <= 5) return m[1]
  return ''
}

const COLUNAS = {
  nome: ['nome', 'hotel', 'nome hotel', 'nome do hotel', 'name'],
  cidade: ['cidade', 'city', 'municipio', 'município'],
  uf: ['uf', 'estado', 'state'],
  telefone: ['telefone', 'tel', 'fone', 'phone', 'contato'],
  categoria: ['categoria', 'classificacao', 'classificação', 'estrelas', 'category'],
  observacoes: ['observacoes', 'observações', 'obs', 'observacao', 'observação', 'notes', 'notas'],
  faturado: ['faturado', 'faturar', 'fatura'],
  info_faturamento: ['info faturamento', 'info_faturamento', 'dados faturamento', 'cnpj'],
  bebedouro: ['bebedouro', 'agua', 'água'],
  valor_agua: ['valor agua', 'valor água', 'valor da agua', 'valor da água', 'preco agua', 'preço água'],
  cafe_manha: ['cafe da manha', 'café da manhã', 'cafe manha', 'café manhã', 'breakfast'],
  estacionamento: ['estacionamento', 'parking', 'garagem'],
  tarifa_sgl: ['tarifa sgl', 'tarifa single', 'sgl', 'single', 'individual', 'tarifa individual', 'tarifa apt single'],
  tarifa_dbl: ['tarifa dbl', 'tarifa double', 'dbl', 'double', 'duplo', 'tarifa duplo', 'tarifa apt duplo'],
  tarifa_tpl: ['tarifa tpl', 'tarifa triple', 'tpl', 'triple', 'triplo', 'tarifa triplo', 'tarifa apt triplo'],
}

function detectarColuna(header: string[], candidatos: string[]): number {
  const norm = header.map((h) => String(h || '').toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' '))
  for (let i = 0; i < norm.length; i++) {
    for (const c of candidatos) {
      const cn = c.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ')
      if (norm[i] === cn) return i
    }
  }
  // 2ª passagem: contains
  for (let i = 0; i < norm.length; i++) {
    for (const c of candidatos) {
      const cn = c.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ')
      if (norm[i].includes(cn) || cn.includes(norm[i])) return i
    }
  }
  return -1
}

export async function parsePlanilhaHoteis(file: File): Promise<ResultadoParseHoteis> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

  const hoteis: HotelParsed[] = []
  const warnings_globais: string[] = []
  const nomesVistos = new Set<string>()
  let duplicatas_internas = 0
  let total_linhas = 0

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as any[][]
    if (rows.length === 0) continue

    // Detecta linha do header (procura nas primeiras 8 linhas)
    let headerIdx = -1
    let header: string[] = []
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const r = rows[i].map((c) => String(c || '').toLowerCase())
      // Header de hotéis: tem "nome" ou "hotel" + "cidade" ou "uf"
      const temNome = r.some((c) => /(nome|hotel)/i.test(c))
      const temLocal = r.some((c) => /(cidade|uf|estado)/i.test(c))
      if (temNome && temLocal) {
        headerIdx = i
        header = rows[i].map((c) => String(c || ''))
        break
      }
    }
    if (headerIdx < 0) {
      warnings_globais.push(`Sheet "${sheetName}": header não detectado (precisa ter colunas Nome + Cidade ou UF)`)
      continue
    }

    const c = {
      nome: detectarColuna(header, COLUNAS.nome),
      cidade: detectarColuna(header, COLUNAS.cidade),
      uf: detectarColuna(header, COLUNAS.uf),
      telefone: detectarColuna(header, COLUNAS.telefone),
      categoria: detectarColuna(header, COLUNAS.categoria),
      observacoes: detectarColuna(header, COLUNAS.observacoes),
      faturado: detectarColuna(header, COLUNAS.faturado),
      info_faturamento: detectarColuna(header, COLUNAS.info_faturamento),
      bebedouro: detectarColuna(header, COLUNAS.bebedouro),
      valor_agua: detectarColuna(header, COLUNAS.valor_agua),
      cafe_manha: detectarColuna(header, COLUNAS.cafe_manha),
      estacionamento: detectarColuna(header, COLUNAS.estacionamento),
      tarifa_sgl: detectarColuna(header, COLUNAS.tarifa_sgl),
      tarifa_dbl: detectarColuna(header, COLUNAS.tarifa_dbl),
      tarifa_tpl: detectarColuna(header, COLUNAS.tarifa_tpl),
    }

    if (c.nome < 0) {
      warnings_globais.push(`Sheet "${sheetName}": coluna de nome não encontrada`)
      continue
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every((cell) => !cell || String(cell).trim() === '')) continue
      total_linhas++

      const nomeRaw = row[c.nome]
      if (!nomeRaw || String(nomeRaw).trim().length < 2) continue

      const warnings: string[] = []
      const nome = normalizarTexto(nomeRaw)
      const chave = nome.toLowerCase()
      if (nomesVistos.has(chave)) {
        warnings.push('Hotel duplicado na própria planilha')
        duplicatas_internas++
      }
      nomesVistos.add(chave)

      const hotel: HotelParsed = {
        nome,
        cidade: c.cidade >= 0 ? normalizarTexto(row[c.cidade]) : '',
        uf: c.uf >= 0 ? normalizarUF(row[c.uf]) : '',
        telefone: c.telefone >= 0 ? normalizarTexto(row[c.telefone]) : '',
        categoria: c.categoria >= 0 ? parseCategoria(row[c.categoria]) : '',
        observacoes: c.observacoes >= 0 ? normalizarTexto(row[c.observacoes]) : '',
        faturado: c.faturado >= 0 ? parseBoolean(row[c.faturado]) : false,
        info_faturamento: c.info_faturamento >= 0 ? normalizarTexto(row[c.info_faturamento]) : '',
        bebedouro: c.bebedouro >= 0 ? normalizarTexto(row[c.bebedouro]) : '',
        valor_agua: c.valor_agua >= 0 ? parseValor(row[c.valor_agua]) : null,
        cafe_manha: c.cafe_manha >= 0 ? normalizarTexto(row[c.cafe_manha]) : '',
        estacionamento: c.estacionamento >= 0 ? normalizarTexto(row[c.estacionamento]) : '',
        tarifa_sgl: c.tarifa_sgl >= 0 ? parseValor(row[c.tarifa_sgl]) : null,
        tarifa_dbl: c.tarifa_dbl >= 0 ? parseValor(row[c.tarifa_dbl]) : null,
        tarifa_tpl: c.tarifa_tpl >= 0 ? parseValor(row[c.tarifa_tpl]) : null,
        warnings,
      }
      if (!hotel.cidade) hotel.warnings.push('Cidade não preenchida')
      if (!hotel.uf) hotel.warnings.push('UF não preenchida')
      hoteis.push(hotel)
    }
  }

  return {
    total_linhas,
    hoteis,
    duplicatas_internas,
    warnings_globais,
  }
}

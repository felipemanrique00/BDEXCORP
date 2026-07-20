// ============================================================
// Parser da planilha de emissões/previsão de lucros
// Formato identificado na planilha "previsão_de_lucros_empresa_way_01-03_a_31-03.xlsx"
//
// Estrutura:
//   - Linhas 1-4: cabeçalho do sistema BBT (ignora)
//   - Linha 5: títulos das colunas
//   - Linhas 6+: dados das vendas
//
// Colunas mapeadas:
//   Venda Nº | Data Venda | Produto (HTL/TKT) | Cod. Cliente | Nome Cliente
//   Nrs. FT (Cli) | Tour Code | Rota Resumida | Pax | Total Tarifa
//   Markup | Cod. Emissor | Saldo Pagar | Previsão Lucro | Cód. Status
// ============================================================

import * as XLSX from 'xlsx'

export interface LinhaEmissao {
  venda_numero: string
  data_venda: string
  produto: 'HTL' | 'TKT' | 'OUTRO'
  cod_cliente: string
  nome_cliente: string
  nrs_ft: string
  tour_code: string
  rota_resumida: string
  pax: string                  // Nome do passageiro/hóspede
  tipo_pax: string             // ADT, CHD, INF
  total_tarifa: number         // o que o cliente paga
  total_taxas: number
  markup: number
  cod_emissor: string          // "FELIPE" etc
  saldo_receber: number
  saldo_pagar: number          // custo
  previsao_lucro: number
  status: string
  forma_pagamento: string
  cia: string
  contrato: string
  tipo_servico: 'Hotel' | 'Aéreo' | 'Carro' | 'Outro'
  // validação
  valido: boolean
  aviso?: string
}

export interface ResumoEmissao {
  linhas: LinhaEmissao[]
  total_vendas: number
  total_tarifa: number
  total_custo: number
  total_markup: number
  total_lucro: number
  por_produto: Record<string, { qtd: number; lucro: number }>
  por_emissor: Record<string, { qtd: number; lucro: number }>
  por_cliente: Record<string, { qtd: number; lucro: number }>
  periodo_detectado?: string
}

function num(v: any): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function str(v: any): string {
  return v == null ? '' : String(v).trim()
}

function parseDataExcel(v: any): string {
  if (!v) return ''
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(v).trim()
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // Excel serial
  const n = Number(s)
  if (!isNaN(n) && n > 25000 && n < 60000) {
    const epoch = new Date(Date.UTC(1899, 11, 30))
    const date = new Date(epoch.getTime() + n * 86400000)
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  }
  // dd/mm/yyyy
  const m = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
  if (m) {
    let [, d, mes, a] = m
    if (a.length === 2) a = (parseInt(a) > 50 ? '19' : '20') + a
    return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return s
}

function tipoServicoDo(produto: string): LinhaEmissao['tipo_servico'] {
  const p = produto.toUpperCase()
  if (p === 'HTL') return 'Hotel'
  if (p === 'TKT') return 'Aéreo'
  if (p === 'CAR' || p === 'LOC') return 'Carro'
  return 'Outro'
}

function produtoTipo(p: string): LinhaEmissao['produto'] {
  const up = p.toUpperCase()
  if (up === 'HTL') return 'HTL'
  if (up === 'TKT') return 'TKT'
  return 'OUTRO'
}

export async function parsePlanilhaEmissoes(file: File): Promise<ResumoEmissao> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { cellDates: true, cellNF: false, cellText: false })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]

  // Busca a linha de cabeçalho (a que contém "Venda Nº")
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' })
  let headerRowIdx = -1
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i]
    if (row && row.some((c: any) => String(c || '').trim().toLowerCase().startsWith('venda'))) {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx === -1) throw new Error('Não encontrei a linha de cabeçalho da planilha (procurei por "Venda Nº")')

  const headers: string[] = rows[headerRowIdx].map((h: any) => String(h || '').trim())

  function idx(...nomes: string[]): number {
    for (const n of nomes) {
      const alvo = n.toLowerCase().trim()
      const i = headers.findIndex((h) => h.toLowerCase().trim() === alvo || h.toLowerCase().trim().startsWith(alvo))
      if (i !== -1) return i
    }
    return -1
  }

  const iVendaN = idx('Venda Nº', 'Venda No', 'Venda N°')
  const iData = idx('Data Venda')
  const iProduto = idx('Produto')
  const iCodCliente = idx('Cod. Cliente', 'Cód. Cliente', 'Código Cliente')
  const iNomeCliente = idx('Nome Cliente')
  const iNrsFT = idx('Nrs. FT (Cli)', 'Nrs. FT')
  const iTourCode = idx('Tour Code')
  const iRota = idx('Rota Resumida', 'Descrição')
  const iPax = idx('Pax', 'Passageiro')
  const iTipoPax = idx('Tipo pax', 'Tipo Pax')
  const iTotalTarifa = idx('Total Tarifa')
  const iTotalTaxas = idx('Total Taxas')
  const iMarkup = idx('Markup')
  const iCodEmissor = idx('Cod. Emissor', 'Cód. Emissor', 'Emissor')
  const iSaldoReceber = idx('Saldo Receber')
  const iSaldoPagar = idx('Saldo Pagar')
  const iPrevisaoLucro = idx('Previsão Lucro', 'Previsao Lucro', 'Lucro')
  const iStatus = idx('Cód. Status', 'Cod. Status', 'Status')
  const iFormaPgt = idx('Forma Pgt.', 'Forma Pgto', 'Forma Pagamento')
  const iCia = idx('Cia', 'Cia.')
  const iContrato = idx('Contrato')

  if (iVendaN === -1 || iPax === -1) {
    throw new Error('Planilha não tem as colunas esperadas (Venda Nº e Pax)')
  }

  const linhas: LinhaEmissao[] = []
  const dataVendas: string[] = []

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue
    const venda_numero = str(row[iVendaN])
    const pax = str(row[iPax])
    if (!venda_numero && !pax) continue // linha vazia
    if (!venda_numero || !pax) {
      // Linha parcial — pula
      continue
    }

    const produto_str = str(row[iProduto])
    const data_venda = parseDataExcel(row[iData])
    if (data_venda) dataVendas.push(data_venda)

    const linha: LinhaEmissao = {
      venda_numero,
      data_venda,
      produto: produtoTipo(produto_str),
      cod_cliente: str(row[iCodCliente]),
      nome_cliente: str(row[iNomeCliente]),
      nrs_ft: str(row[iNrsFT]),
      tour_code: str(row[iTourCode]),
      rota_resumida: str(row[iRota]),
      pax,
      tipo_pax: str(row[iTipoPax]),
      total_tarifa: num(row[iTotalTarifa]),
      total_taxas: num(row[iTotalTaxas]),
      markup: num(row[iMarkup]),
      cod_emissor: str(row[iCodEmissor]),
      saldo_receber: num(row[iSaldoReceber]),
      saldo_pagar: num(row[iSaldoPagar]),
      previsao_lucro: num(row[iPrevisaoLucro]),
      status: str(row[iStatus]),
      forma_pagamento: str(row[iFormaPgt]),
      cia: str(row[iCia]),
      contrato: str(row[iContrato]),
      tipo_servico: tipoServicoDo(produto_str),
      valido: true,
    }

    // Validação
    if (!linha.venda_numero || !linha.pax) {
      linha.valido = false
      linha.aviso = 'Sem número de venda ou passageiro'
    }

    linhas.push(linha)
  }

  // Resumo
  const por_produto: Record<string, { qtd: number; lucro: number }> = {}
  const por_emissor: Record<string, { qtd: number; lucro: number }> = {}
  const por_cliente: Record<string, { qtd: number; lucro: number }> = {}

  let total_tarifa = 0, total_custo = 0, total_markup = 0, total_lucro = 0

  linhas.forEach((l) => {
    total_tarifa += l.total_tarifa
    total_custo += l.saldo_pagar
    total_markup += l.markup
    total_lucro += l.previsao_lucro

    const pp = l.produto || 'OUTRO'
    if (!por_produto[pp]) por_produto[pp] = { qtd: 0, lucro: 0 }
    por_produto[pp].qtd++
    por_produto[pp].lucro += l.previsao_lucro

    if (l.cod_emissor) {
      if (!por_emissor[l.cod_emissor]) por_emissor[l.cod_emissor] = { qtd: 0, lucro: 0 }
      por_emissor[l.cod_emissor].qtd++
      por_emissor[l.cod_emissor].lucro += l.previsao_lucro
    }

    if (l.nome_cliente) {
      if (!por_cliente[l.nome_cliente]) por_cliente[l.nome_cliente] = { qtd: 0, lucro: 0 }
      por_cliente[l.nome_cliente].qtd++
      por_cliente[l.nome_cliente].lucro += l.previsao_lucro
    }
  })

  // Período detectado
  let periodo_detectado: string | undefined
  if (dataVendas.length > 0) {
    const sorted = [...dataVendas].sort()
    periodo_detectado = `${sorted[0]} a ${sorted[sorted.length - 1]}`
  }

  return {
    linhas,
    total_vendas: linhas.length,
    total_tarifa,
    total_custo,
    total_markup,
    total_lucro,
    por_produto,
    por_emissor,
    por_cliente,
    periodo_detectado,
  }
}

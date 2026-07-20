// ============================================================
// Parser do PDF "Mapa de Produção - Analítico" da BBT
// Formato real usado pelo sistema de emissão do Felipe
// ============================================================

import type { TipoServico, Atendimento } from '@/types'

export interface LinhaEmissaoPDF {
  venda_numero: string
  tipo_registro: string // D, etc
  data_venda: string // ISO YYYY-MM-DD
  produto: string // Código do hotel/cia (ex: IBISGYN, JJ, AD, F00222)
  form_nr_doc?: string // Form/Nr Doc
  cod_cliente?: string // WAY153, WAY262, VITAMEDIC, REFRESCOS etc
  cliente_nome: string
  rota_descricao: string // Descrição do serviço
  passageiro: string
  tarifa: number
  taxas: number
  total: number // A Rec
  custo: number // A Pagar / Liq.Du
  markup: number // Prev. Lucro / Over
  emissor: string // FELIPE
  forma_pagamento: string // IV, PX, CP, CC, XX
  status: string // CF, ND, NC (finalizado / nao disponivel / não convalidado?)
  tipo_servico: TipoServico
  fornecedor?: string
}

export interface ResumoEmissaoPDF {
  total_vendas: number
  total_faturado: number
  total_custo: number
  total_markup: number
  por_emissor: Record<string, { qtd: number; lucro: number }>
  por_cliente: Record<string, { qtd: number; lucro: number }>
  por_produto: Record<string, { qtd: number; lucro: number }>
  periodo_detectado: { inicio?: string; fim?: string }
  linhas: LinhaEmissaoPDF[]
}

/**
 * Extrai texto de um PDF usando pdfjs-dist
 */
async function processPDFPages(file: File, onPageText: (pageText: string) => void): Promise<void> {
  if (typeof window === 'undefined') throw new Error('Só funciona no navegador')

  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs' as any)
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs`

  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      try {
        const content = await page.getTextContent()
        onPageText(content.items.map((item: any) => item.str).join('\n'))
      } finally {
        page.cleanup?.()
      }

      if (i % 5 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    await pdf.destroy?.()
  }

}

function parsearPaginaEmissoes(pagina: string): LinhaEmissaoPDF[] {
  const textoPagina = pagina
    .replace(/BBT AGENCIA DE VIAGENS.*?\n/g, '\n')
    .replace(/GLOBAIS\n/g, '')
    .replace(/Mapa de Produ.*?P.g\.\s*\d+/g, '')
    .replace(/\d{2}\/\d{2}\/\d{4}\n+ref\. \d+ \/ felipe.*?\n/g, '')
    .replace(/Filtro\(s\).*?\n/g, '')
    .replace(/Venda Filial\s*\n.*?Comiss\. Ag\./g, '')

  const tokens = textoPagina.split('\n').map((l) => l.trim()).filter(Boolean)
  const blocos: string[][] = []
  let blocoAtual: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (/^\d{5}$/.test(t) && i + 1 < tokens.length && tokens[i + 1] === 'D') {
      if (blocoAtual.length > 0) blocos.push(blocoAtual)
      blocoAtual = [t]
    } else {
      blocoAtual.push(t)
    }
  }
  if (blocoAtual.length > 0) blocos.push(blocoAtual)

  return blocos
    .map((bloco) => parsearBloco(bloco))
    .filter((linha): linha is LinhaEmissaoPDF => Boolean(linha))
}

/**
 * Parseia data no formato DD/MM/YYYY para ISO
 */
function parseData(s: string): string {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (!m) return ''
  const d = m[1], mm = m[2]
  let y = m[3]
  if (y.length === 2) y = '20' + y
  return `${y}-${mm}-${d}`
}

/**
 * Parseia número brasileiro "1.234,56" para 1234.56
 */
function parseNumero(s: string): number {
  if (!s) return 0
  const clean = s.trim().replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

/**
 * Classifica tipo de serviço baseado no produto e tipo do registro
 */
function classificarTipoServico(produto: string, tipoReg: string): TipoServico {
  const p = produto.toUpperCase()
  // Códigos de companhias aéreas conhecidas
  if (['G3', 'JJ', 'AD', 'LA', 'AZUL', 'GOL', 'LATAM'].includes(p)) return 'Aéreo'
  // Locadoras
  if (['MOVIDA', 'LOCALIZA', 'LOCALIZACW', 'UNIDAS'].includes(p)) return 'Carro'
  // Transfer não é tipo primário - vira "Outro"
  if (p.includes('VANGO') || p.includes('VAN ') || tipoReg === 'TRP') return 'Outro'
  // Tipo TKT = Aéreo
  if (tipoReg === 'TKT') return 'Aéreo'
  if (tipoReg === 'CAR') return 'Carro'
  if (tipoReg === 'TRP') return 'Outro'
  if (tipoReg === 'ADT' || tipoReg === 'OTS') return 'Outro'
  // Default: Hotel
  return 'Hotel'
}

/**
 * Mapeia código de cliente para nome amigável conhecido
 */
function mapearClientePorCodigo(nomeCompleto: string): { codigo?: string; nome: string } {
  const n = nomeCompleto.toUpperCase()
  // Way concessionárias
  if (n.includes('ROTA SERTANEJA')) return { codigo: 'WAY153', nome: 'Concessionária Rota Sertaneja MG-GO S.A' }
  if (n.includes('RODOVIA BR 262') || n.includes('BR-262') || n.includes('BR 262 MG')) return { codigo: 'WAY262', nome: 'Concessionária da Rodovia BR 262 MG S.A.' }
  if (n.includes('ROTA AGRO')) return { codigo: 'WAY364', nome: 'Concessionária Rota Agro MT-GO S.A.' }
  // Outras empresas recorrentes
  if (n.includes('REFRESCOS BANDEIRANTES')) return { codigo: 'REFRESCOS', nome: 'Refrescos Bandeirantes (Coca-Cola)' }
  if (n.includes('VITAMEDIC')) return { codigo: 'VITAMEDIC', nome: 'Vitamedic Indústria Farmacêutica' }
  if (n.includes('GOIASTELECOM') || n.includes('GOIAS TELECOMUNICACOES')) return { codigo: 'GOIASTELE', nome: 'Goiás Telecomunicações' }
  if (n.includes('ALVES FARIA')) return { codigo: 'ALFA', nome: 'Centro Educacional Alves Faria (Faculdade Alfa)' }
  if (n.includes('REBICA')) return { codigo: 'REBICA', nome: 'Rebica Indústria e Comércio' }
  if (n.includes('N&L')) return { codigo: 'NL', nome: 'N&L Indústria e Comércio' }
  if (n.includes('ROTA BBT')) return { codigo: 'ROTABBT', nome: 'Rota BBT Turismo' }
  if (n.includes('HOLDING')) return { codigo: 'HOLDING', nome: 'Holding' }
  return { nome: nomeCompleto }
}

/**
 * Parseia o PDF do Mapa de Produção Analítico.
 *
 * O PDF é estruturado em blocos por venda. Cada venda ocupa múltiplas
 * linhas devido ao layout de colunas. Estratégia: identifica o início de
 * cada bloco pelo padrão "Nº_VENDA D DD/MM/YYYY" e extrai os campos.
 */
export async function parsePDFEmissoes(file: File): Promise<ResumoEmissaoPDF> {
  const linhas: LinhaEmissaoPDF[] = []
  await processPDFPages(file, (pagina) => {
    linhas.push(...parsearPaginaEmissoes(pagina))
  })

  // Splits por PAGE_BREAK e limpa cabeçalhos
  const paginas: string[] = []

  for (const pagina of paginas) {
    // Remove linhas do cabeçalho repetido (reconhecíveis)
    const textoPagina = pagina
      .replace(/BBT AGENCIA DE VIAGENS.*?\n/g, '\n')
      .replace(/GLOBAIS\n/g, '')
      .replace(/Mapa de Produ.*?P[aá]g\.\s*\d+/g, '')
      .replace(/\d{2}\/\d{2}\/\d{4}\n+ref\. \d+ \/ felipe.*?\n/g, '')
      .replace(/Filtro\(s\).*?\n/g, '')
      .replace(/Venda Filial\s*\n.*?Comiss\. Ag\./g, '')

    const tokens = textoPagina.split('\n').map((l) => l.trim()).filter(Boolean)

    // Identifica blocos por padrão: número de 5 dígitos sozinho na linha (Nº da venda)
    // Ex: "23081", "25314", etc
    const blocos: string[][] = []
    let blocoAtual: string[] = []

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      // Detector de nova venda: 5 dígitos, linha seguinte tem "D"
      if (/^\d{5}$/.test(t) && i + 1 < tokens.length && tokens[i + 1] === 'D') {
        if (blocoAtual.length > 0) blocos.push(blocoAtual)
        blocoAtual = [t]
      } else {
        blocoAtual.push(t)
      }
    }
    if (blocoAtual.length > 0) blocos.push(blocoAtual)

    for (const bloco of blocos) {
      const linha = parsearBloco(bloco)
      if (linha) linhas.push(linha)
    }
  }

  // Calcular resumo
  const por_emissor: Record<string, { qtd: number; lucro: number }> = {}
  const por_cliente: Record<string, { qtd: number; lucro: number }> = {}
  const por_produto: Record<string, { qtd: number; lucro: number }> = {}

  let total_faturado = 0
  let total_custo = 0
  let total_markup = 0
  let data_min = ''
  let data_max = ''

  for (const l of linhas) {
    total_faturado += l.total
    total_custo += l.custo
    total_markup += l.markup

    if (!por_emissor[l.emissor]) por_emissor[l.emissor] = { qtd: 0, lucro: 0 }
    por_emissor[l.emissor].qtd++
    por_emissor[l.emissor].lucro += l.markup

    if (l.cliente_nome) {
      const k = l.cliente_nome.substring(0, 50)
      if (!por_cliente[k]) por_cliente[k] = { qtd: 0, lucro: 0 }
      por_cliente[k].qtd++
      por_cliente[k].lucro += l.markup
    }

    if (l.produto) {
      if (!por_produto[l.produto]) por_produto[l.produto] = { qtd: 0, lucro: 0 }
      por_produto[l.produto].qtd++
      por_produto[l.produto].lucro += l.markup
    }

    if (l.data_venda) {
      if (!data_min || l.data_venda < data_min) data_min = l.data_venda
      if (!data_max || l.data_venda > data_max) data_max = l.data_venda
    }
  }

  return {
    total_vendas: linhas.length,
    total_faturado,
    total_custo,
    total_markup,
    por_emissor,
    por_cliente,
    por_produto,
    periodo_detectado: { inicio: data_min, fim: data_max },
    linhas,
  }
}

/**
 * Parseia um bloco de tokens (linhas de uma única venda) e extrai os campos.
 */
function parsearBloco(bloco: string[]): LinhaEmissaoPDF | null {
  if (bloco.length < 6) return null

  // Primeiro token: Nº da venda
  const venda_numero = bloco[0]
  if (!/^\d{5}$/.test(venda_numero)) return null

  // Segundo: D (tipo_registro)
  const tipo_registro = bloco[1] // geralmente "D"
  if (tipo_registro !== 'D') return null

  // Terceiro: data de venda DD/MM/YYYY
  const data_venda = parseData(bloco[2] || '')

  // Quarto: produto (código do hotel/cia, ex: URUACU, IBISGYN, G3, JJ, etc)
  const produto = (bloco[3] || '').trim()

  // Procurar forma de pagamento: IV, PX, CP, CC, XX, ND, CF
  let forma_pagamento = ''
  let status = 'CF'
  let idx_fop = -1

  for (let i = 4; i < Math.min(bloco.length, 20); i++) {
    const t = bloco[i]
    if (['IV', 'PX', 'CP', 'CC', 'XX'].includes(t)) {
      forma_pagamento = t
      idx_fop = i
      break
    }
  }

  // Status aparece geralmente como "CF", "ND", "NC" perto do final do bloco
  for (const t of bloco) {
    if (['CF', 'ND', 'NC'].includes(t)) {
      status = t
      // não dá break pra pegar o último (valor mais à direita no PDF)
    }
  }

  // Procurar nome do cliente (linha com CONCESSIONARIA, REFRESCOS, VITAMEDIC, etc)
  // Normalmente o nome do fornecedor (empresa cliente) aparece após forma de pagto
  let cliente_nome = ''
  let fornecedor = ''
  let descricao_servico = ''
  let passageiro = ''

  for (let i = Math.max(4, idx_fop + 1); i < bloco.length; i++) {
    const t = bloco[i]
    if (!cliente_nome && /LTDA|S\.A\.?$|S\/A|CONCESSIONARIA|INDUSTRIA|COMERCIO|EDUCACIONAL|FARMACÊUTICA|FARMACEUTICA|HOLDING|TELECOMUNICACOES/i.test(t)) {
      cliente_nome = t
      break
    }
  }

  // Encontrar a linha de descrição/passageiro - é uma linha mais longa que contém texto descritivo
  // Exemplos: "HOTEL COMFORT URUACU DEIVIDE VIEIRA ALVES"
  //          "01 SUÍTE LAGO SINGLE - 02/03/26 a 03/03/26 RENATO SIGOLO"
  //          "GYN/CGH/GYN PRADO DOS SANTOS/HIPOLITO MR"
  for (let i = 4; i < bloco.length; i++) {
    const t = bloco[i]
    if (t.length > 20 && /\d{2}\/\d{2}\/\d{2}|HOTEL|APT|INDIVIDUAL|TIGO|TRANSFER|DUPLO|TRIPLO|CGH|GYN|BSB|CNF|GRU|VCP|UDI|UBA|SDU|VIX|FLN|FOR|REC|POA|BHZ/i.test(t)) {
      descricao_servico = t
      break
    }
  }

  // Passageiro: está geralmente logo antes do valor da tarifa ou numa linha curta com nome
  // Estratégia: pegar a última sequência de letras maiúsculas + espaços do bloco
  for (let i = bloco.length - 1; i >= 4; i--) {
    const t = bloco[i]
    // Nome tem letras, espaços, acentos e pode ter "&"
    if (/^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ ]{5,60}$/i.test(t) && !t.includes('/') &&
        !/^(FELIPE|REFRESCOS|VITAMEDIC|BBT|E-HTL|FOR-BRT|FOR-ANCORA|FLYTOUR|TREND|WAY\d+|GOIASTELE|ALFA|HOLDING|ROTABBT|REBICA|NL|CINTERFACE)$/i.test(t) &&
        !/LTDA|S\.A|INDUSTRIA|CONCESSIONARIA|EDUCACIONAL/i.test(t)) {
      passageiro = t
      break
    }
  }

  // Se não encontrou passageiro, tentar extrair da descrição_servico
  if (!passageiro && descricao_servico) {
    // Depois do último " - " ou depois de "/": após o último separador vem o nome
    const m = descricao_servico.match(/(?:- |\/)([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ ]{5,})$/)
    if (m) passageiro = m[1].trim()
    else {
      // Pegar últimas palavras em maiúsculas
      const words = descricao_servico.split(/\s+/).reverse()
      const nomeWords: string[] = []
      for (const w of words) {
        if (/^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ&]{2,}$/i.test(w)) nomeWords.unshift(w)
        else if (nomeWords.length >= 2) break
      }
      if (nomeWords.length >= 2) passageiro = nomeWords.join(' ')
    }
  }

  // Parsear valores: Tarifa (primeiro número grande), Total/ARec (aparece junto com "A Pagar")
  // Estratégia: pegar TODOS os números e posicioná-los conforme padrão.
  const numeros: number[] = []
  for (const t of bloco) {
    // Padrão número BR: "1.234,56" ou "123,45" ou "777,00"
    if (/^-?[\d.]+,\d{2}$/.test(t)) {
      numeros.push(parseNumero(t))
    }
  }

  // Heurística: em blocos normais (linhas CF), aparecem mais ou menos nesta ordem:
  // tarifa, taxas, total_rec, custo_pagar, markup/lucro, markup_val
  const tarifa = numeros[0] || 0
  // Se status é ND/NC pode não ter valores
  let total = 0
  let custo = 0
  let markup = 0
  let taxas = 0

  // Tenta achar markup: geralmente é o último número que se repete ou valor pequeno
  // "A Pagar" vem antes de "Prev. Lucro"
  // Estratégia simplificada: usa o último número maior ou igual a zero como markup
  // e o maior como total_faturado
  if (numeros.length >= 2) {
    // Último número costuma ser o markup (ou Prev. Lucro)
    markup = numeros[numeros.length - 1] || 0
    // Maior número costuma ser o total faturado
    total = numeros.reduce((maior, valor) => Math.max(maior, valor), 0)
    // Custo: entre os valores intermediários
    if (numeros.length >= 3) {
      // Pegar o segundo maior como total ou custo
      const sorted = [...numeros].sort((a, b) => b - a)
      total = sorted[0]
      custo = sorted[1] || 0
    } else {
      custo = total - markup
    }
    taxas = numeros.find((n) => n > 0 && n < 100) || 0
  }

  // Cliente mapeado
  const clienteInfo = mapearClientePorCodigo(cliente_nome)

  // Tipo de serviço
  const tipoReg = bloco.find((t) => ['HTL', 'TKT', 'CAR', 'TRP', 'ADT', 'OTS'].includes(t)) || 'HTL'
  const tipo_servico = classificarTipoServico(produto, tipoReg)

  return {
    venda_numero,
    tipo_registro,
    data_venda,
    produto,
    cod_cliente: clienteInfo.codigo,
    cliente_nome: clienteInfo.nome,
    rota_descricao: descricao_servico,
    passageiro: passageiro.trim(),
    tarifa,
    taxas,
    total,
    custo,
    markup,
    emissor: 'FELIPE',
    forma_pagamento,
    status,
    tipo_servico,
    fornecedor: cliente_nome,
  }
}

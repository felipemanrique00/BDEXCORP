// ============================================================
// DETECTOR DE TIPO DE ARQUIVO — V7
// Recebe um File e devolve o "tipo" identificado, baseado em:
//   - Extensão
//   - Nome do arquivo
//   - Conteúdo (sniff dos primeiros bytes/linhas)
// ============================================================

export type TipoImportacao =
  | 'mapa_producao_pdf'      // Mapa de Produção - Analítico (BBT)
  | 'voucher_bbt_pdf'        // Voucher Nº H NNNNN
  | 'planilha_funcionarios'  // XLSX com colunas Nome/CPF/Centro de Custo
  | 'planilha_hoteis'        // XLSX de hotéis
  | 'planilha_emissoes'      // XLSX de emissões/vendas
  | 'wintour_xml'            // XML oficial de exportacao de vendas Wintour
  | 'desconhecido'

export interface DeteccaoArquivo {
  tipo: TipoImportacao
  confianca: 'alta' | 'media' | 'baixa'
  motivo: string
  preview?: string
}

async function lerPrimeirosBytesPDF(file: File): Promise<string> {
  if (typeof window === 'undefined') return ''
  try {
    const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs')
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs'
    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    const page = await pdf.getPage(1)
    const content = await page.getTextContent()
    return (content.items as any[]).map((i) => i.str).join(' ').slice(0, 2000)
  } catch {
    return ''
  }
}

async function lerHeaderXLSX(file: File): Promise<string[]> {
  try {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', sheetRows: 3 })
    const sheets: string[] = []
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]
      for (const row of rows) {
        for (const cell of row) {
          if (cell) sheets.push(String(cell).toLowerCase().trim())
        }
      }
    }
    return sheets
  } catch {
    return []
  }
}

export async function detectarTipoArquivo(file: File): Promise<DeteccaoArquivo> {
  const nome = file.name.toLowerCase()
  const ext = nome.split('.').pop() || ''

  // === XML Wintour ===
  if (ext === 'xml') {
    let texto = ''
    try {
      texto = (await file.text()).slice(0, 5000)
    } catch {
      texto = ''
    }
    if (/wintour|venda|emiss[aã]o|cliente|passageiro|pax/i.test(texto) || /wintour|venda|emiss/i.test(nome)) {
      return {
        tipo: 'wintour_xml',
        confianca: /wintour/i.test(texto + nome) ? 'alta' : 'media',
        motivo: 'XML de exportacao de vendas detectado',
        preview: texto.slice(0, 200),
      }
    }
    return {
      tipo: 'wintour_xml',
      confianca: 'baixa',
      motivo: 'XML detectado. Use a tela Wintour para importar e validar o layout.',
      preview: texto.slice(0, 200),
    }
  }

  // === PDFs ===
  if (ext === 'pdf') {
    const texto = await lerPrimeirosBytesPDF(file)

    if (/Mapa\s+de\s+Produ[çc][ãa]o/i.test(texto)) {
      return {
        tipo: 'mapa_producao_pdf',
        confianca: 'alta',
        motivo: 'Texto "Mapa de Produção" encontrado',
        preview: texto.slice(0, 200),
      }
    }
    if (/VOUCHER\s+N[º°]/i.test(texto) && /BBT\s+AGENCIA/i.test(texto)) {
      return {
        tipo: 'voucher_bbt_pdf',
        confianca: 'alta',
        motivo: 'Voucher BBT identificado',
        preview: texto.slice(0, 200),
      }
    }
    // Heurística mais fraca pelo nome
    if (/voucher/i.test(nome)) {
      return {
        tipo: 'voucher_bbt_pdf',
        confianca: 'media',
        motivo: 'Nome do arquivo sugere voucher (não confirmado por conteúdo)',
        preview: texto.slice(0, 200),
      }
    }
    if (/mapa.*produ|emiss/i.test(nome)) {
      return {
        tipo: 'mapa_producao_pdf',
        confianca: 'media',
        motivo: 'Nome do arquivo sugere Mapa de Produção',
      }
    }
    return {
      tipo: 'desconhecido',
      confianca: 'baixa',
      motivo: 'PDF não identificado como Mapa ou Voucher',
      preview: texto.slice(0, 200),
    }
  }

  // === Planilhas ===
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    const cells = await lerHeaderXLSX(file)
    const corpus = cells.join(' | ')

    // Funcionários: tem "nome func" + "cpf" + "centro de custo"
    const tem = (re: RegExp) => re.test(corpus)
    if (tem(/nome\s*func|colaborador/i) && tem(/cpf|cargo/i) && tem(/centro\s*de\s*custo|cc/i)) {
      return {
        tipo: 'planilha_funcionarios',
        confianca: 'alta',
        motivo: 'Colunas de funcionário detectadas',
      }
    }
    // Hotéis: tem "hotel" + "cidade"/"uf"
    if (tem(/\bhotel\b|hospedagem|pousada/i) && tem(/cidade|uf|estado/i)) {
      return {
        tipo: 'planilha_hoteis',
        confianca: 'alta',
        motivo: 'Colunas de hotéis detectadas',
      }
    }
    // Emissões/Mapa: venda + cliente/valor/tarifa OU qualquer combo de emissão
    if (tem(/venda|emiss[ãa]o/i) && tem(/cliente|tarifa|markup/i)) {
      return {
        tipo: 'planilha_emissoes',
        confianca: 'alta',
        motivo: 'Colunas de emissões detectadas',
      }
    }
    // Fallback mais permissivo por nome de coluna comum em planilhas BBT
    if (tem(/passageiro|hospede|h[oó]spede/i)) {
      return { tipo: 'planilha_emissoes', confianca: 'media', motivo: 'Colunas de hóspedes detectadas' }
    }
    // Heurística pelo nome do arquivo
    if (/funcion[áa]ri|colaborador|equipe/i.test(nome)) {
      return { tipo: 'planilha_funcionarios', confianca: 'media', motivo: 'Nome sugere planilha de funcionários' }
    }
    if (/hotel|hosped/i.test(nome)) {
      return { tipo: 'planilha_hoteis', confianca: 'media', motivo: 'Nome sugere planilha de hotéis' }
    }
    if (/emiss|venda|mapa|producao|produção/i.test(nome)) {
      return { tipo: 'planilha_emissoes', confianca: 'media', motivo: 'Nome sugere emissões/mapa de produção' }
    }
    // Qualquer XLSX → assume emissões com confiança baixa (melhor que "desconhecido")
    return {
      tipo: 'planilha_emissoes',
      confianca: 'baixa',
      motivo: 'Planilha não reconhecida — tente importar como Emissões ou escolha o tipo manualmente',
    }
  }

  return {
    tipo: 'desconhecido',
    confianca: 'baixa',
    motivo: `Extensão "${ext}" não suportada. Use PDF, Excel, CSV ou XML.`,
  }
}

export const LABELS_TIPO: Record<TipoImportacao, { titulo: string; descricao: string; icone: string }> = {
  mapa_producao_pdf: {
    titulo: 'Mapa de Produção',
    descricao: 'PDF analítico do sistema BBT com vendas, custos e markups',
    icone: 'PDF',
  },
  voucher_bbt_pdf: {
    titulo: 'Voucher BBT',
    descricao: 'Voucher de hospedagem do sistema BBT (formato H NNNNN)',
    icone: 'HTL',
  },
  planilha_funcionarios: {
    titulo: 'Planilha de Funcionários',
    descricao: 'Lista de colaboradores com Nome, CPF, Centro de Custo, Cargo',
    icone: 'RH',
  },
  planilha_hoteis: {
    titulo: 'Planilha de Hotéis',
    descricao: 'Catálogo de hotéis com Cidade, UF, contatos',
    icone: 'HOT',
  },
  planilha_emissoes: {
    titulo: 'Planilha de Emissões',
    descricao: 'Excel com vendas/emissões de viagens',
    icone: 'AIR',
  },
  wintour_xml: {
    titulo: 'XML Wintour',
    descricao: 'Exportação oficial diária de vendas/emissões do Wintour',
    icone: 'XML',
  },
  desconhecido: {
    titulo: 'Não identificado',
    descricao: 'Não consegui identificar o tipo do arquivo',
    icone: '?',
  },
}

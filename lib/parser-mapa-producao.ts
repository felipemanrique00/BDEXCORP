// ============================================================
// PARSER MAPA DE PRODUÇÃO — V7 (layout-aware, robusto)
//
// Estrutura real do PDF (verificada com PDF da Vitamedic 09-15/03/2026):
//
// CABEÇALHO:
//   "BBT AGENCIA DE VIAGENS E TURISMO GLOBAIS"
//   "Mapa de Produção - Analítico Período : Lançamento DD/MM/YYYY a DD/MM/YYYY"
//   "ref. 10904 / felipe Filtro(s) : [Cliente: VITAMEDIC ...]"
//
// CADA REGISTRO ocupa cerca de 8-12 linhas no texto extraído.
// Padrão começa por: NUMERO_VENDA "D" DATA "D" PRODUTO ...
// Ex: "23646 D 10/03/2026 IBISFEIRA D RES0 29382-..."
//
// Termina com: "TIPO HTL/TKT/CAR/TRP" + STATUS "CF/ND/CA"
//
// FIM: linha "TOTAIS:" + valores agregados + "Número de vendas: NN"
// ============================================================

export interface RegistroMapa {
  // Identificação
  venda_numero: string
  filial: string         // "D"
  tipo_registro: 'HTL' | 'TKT' | 'CAR' | 'TRP' | string
  // Datas
  data_venda: string     // ISO YYYY-MM-DD
  // Produto / Serviço
  produto: string        // ex: IBISFEIRAD, LA, G3, MOVIDA
  forma_documento: string // ex: RES0 29382, 4001 106467, 2277 119413, MV1N DKI1M4
  // Cliente
  cod_cliente: string    // ex: 6793
  centro_custo: string   // ex: 7004215
  cliente_nome: string   // ex: VITAMEDIC INDÚSTRIA FARMACÊUTICA LTDA
  // Passageiro / Serviço
  passageiro_completo: string  // ex: LINS MOTTA CARICIO DE MENEZES/REBECA
  passageiro_nome: string      // primeiro nome (REBECA)
  passageiro_sobrenome: string // sobrenomes (LINS MOTTA CARICIO DE MENEZES)
  rota_descricao: string       // descrição completa do serviço
  data_inicio_servico?: string // extraído de "19/03/26 a 20/03/26"
  data_fim_servico?: string
  // Valores
  tarifa: number
  taxa_emb: number
  desc_cliente: number
  a_receber: number
  a_pagar: number
  prev_lucro: number
  markup: number
  // Pessoas
  emissor: string        // ex: LAI, TAY, KARINE
  fornecedor: string     // ex: TREND, FOR-ANCORA, CACULEPA
  promotor: string
  // Status
  status: 'CF' | 'ND' | 'NC' | 'CA' | string
  fop: string            // forma de pagamento: IV, PX, XX
  // Auditoria do parsing
  raw_lines: string[]    // linhas originais (debug)
  warnings: string[]     // problemas encontrados nesta linha
}

export interface ResultadoParseMapa {
  cliente_filtro: string         // "VITAMEDIC INDÚSTRIA FARMACÊUTICA LTDA"
  periodo_inicio: string         // ISO
  periodo_fim: string            // ISO
  total_paginas: number
  registros: RegistroMapa[]
  totais_pdf: {
    tarifa: number
    a_receber: number
    a_pagar: number
    prev_lucro: number
    numero_vendas: number
  }
  estatisticas: {
    extraidos: number
    com_warnings: number
    por_tipo: Record<string, number>
    por_status: Record<string, number>
  }
  warnings_globais: string[]
}

// ============================================================
// EXTRAÇÃO BRUTA DO TEXTO DO PDF
// ============================================================

async function extrairTextoPDF(file: File): Promise<{ paginas: string[][]; total: number }> {
  if (typeof window === 'undefined') throw new Error('Só funciona no navegador')
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs'

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const paginas: string[][] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    // Linhas: cada item na ordem que veio (já é praticamente ordem de leitura)
    const linhas: string[] = []
    let linhaAtual = ''
    let yAnterior: number | null = null

    for (const item of content.items as any[]) {
      const y = item.transform[5]
      const txt = (item.str || '').trim()
      if (!txt) continue
      if (yAnterior === null || Math.abs(y - yAnterior) < 2) {
        // Mesma linha
        linhaAtual = linhaAtual ? `${linhaAtual} ${txt}` : txt
      } else {
        if (linhaAtual) linhas.push(linhaAtual.trim())
        linhaAtual = txt
      }
      yAnterior = y
    }
    if (linhaAtual) linhas.push(linhaAtual.trim())
    paginas.push(linhas.filter((l) => l.length > 0))
  }

  return { paginas, total: pdf.numPages }
}

// ============================================================
// HELPERS
// ============================================================

function normalizarData(s: string): string {
  if (!s) return ''
  const t = s.trim()
  // DD/MM/YYYY
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  // DD/MM/YY
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (m) {
    const ano = parseInt(m[3]) < 50 ? 2000 + parseInt(m[3]) : 1900 + parseInt(m[3])
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return ''
}

function parseValor(s: string): number {
  if (!s) return 0
  let t = s.trim().replace(/\s/g, '')
  // BR: 1.234,56 → 1234.56 / EN: 1,234.56 → 1234.56
  if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) {
    t = t.replace(/\./g, '').replace(',', '.')
  } else if (t.includes(',') && !t.includes('.')) {
    t = t.replace(',', '.')
  }
  const n = parseFloat(t.replace(/[^\d.\-]/g, ''))
  return isNaN(n) ? 0 : Math.round(n * 100) / 100
}

function normalizarPassageiro(raw: string): { completo: string; nome: string; sobrenome: string } {
  // Formato BBT: "SOBRENOME COMPOSTO/PRIMEIRO_NOME"
  // Ex: "LINS MOTTA CARICIO DE MENEZES/REBECA" → nome="REBECA", sobrenome="LINS MOTTA CARICIO DE MENEZES"
  const t = raw.trim()
  if (t.includes('/')) {
    const [sobrenome, nome] = t.split('/').map((s) => s.trim())
    return {
      completo: `${nome} ${sobrenome}`.replace(/\s+/g, ' ').trim(),
      nome: nome || '',
      sobrenome: sobrenome || '',
    }
  }
  return { completo: t, nome: t, sobrenome: '' }
}

function extrairCabecalho(linhas: string[]): { cliente: string; periodo_inicio: string; periodo_fim: string } {
  let cliente = ''
  let periodo_inicio = ''
  let periodo_fim = ''

  for (const linha of linhas.slice(0, 10)) {
    // "Mapa de Produção - Analítico Período : Lançamento 09/03/2026 a 15/03/2026"
    const mPer = linha.match(/(?:Lan[çc]amento|Per[íi]odo)[\s:]*(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/i)
    if (mPer) {
      periodo_inicio = normalizarData(mPer[1])
      periodo_fim = normalizarData(mPer[2])
    }
    // "Filtro(s) : [Cliente: VITAMEDIC INDÚSTRIA FARMACÊUTICA LTDA]"
    const mCli = linha.match(/Cliente:\s*([^\]]+)/i)
    if (mCli) {
      cliente = mCli[1].trim()
    }
  }

  return { cliente, periodo_inicio, periodo_fim }
}

function extrairTotais(linhas: string[]): { tarifa: number; a_receber: number; a_pagar: number; prev_lucro: number; numero_vendas: number } {
  let totais = { tarifa: 0, a_receber: 0, a_pagar: 0, prev_lucro: 0, numero_vendas: 0 }
  for (let i = linhas.length - 1; i >= 0; i--) {
    const linha = linhas[i]
    const mVendas = linha.match(/N[úu]mero de vendas:\s*(\d+)/i)
    if (mVendas) totais.numero_vendas = parseInt(mVendas[1])
  }
  // O bloco "TOTAIS:" tem números variados — extraímos os principais por linha
  // Procuramos por uma linha que tenha "TOTAIS:" e várias linhas seguintes com valores
  const idxTotais = linhas.findIndex((l) => /^TOTAIS:/i.test(l) || /TOTAIS:/i.test(l))
  if (idxTotais >= 0) {
    // Dump dos próximos valores brutos
    const bloco = linhas.slice(Math.max(0, idxTotais - 5), Math.min(linhas.length, idxTotais + 10)).join(' ')
    const numeros = (bloco.match(/[\d.]+,\d{2}/g) || []).map(parseValor).filter((n) => n > 0)
    // Pegamos os 3 maiores valores como totais (tarifa, a receber, a pagar)
    const ord = [...numeros].sort((a, b) => b - a)
    if (ord[0]) totais.tarifa = ord[0]
    if (ord[1]) totais.a_pagar = ord[1]
    if (ord[2]) totais.prev_lucro = ord[2]
  }
  return totais
}

// ============================================================
// PARSING DE REGISTROS
// ============================================================

/**
 * Detecta se uma linha é o INÍCIO de um novo registro.
 * Padrão: começa com "NUMERO D DATA" — ex: "23646 D 10/03/2026 ..."
 */
function ehInicioRegistro(linha: string): RegExpMatchArray | null {
  return linha.match(/^(\d{4,6})\s+(D)\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)/)
}

/**
 * Detecta se uma linha contém o "tipo de registro" no formato "N HTL" / "N TKT" etc
 * Ex: "23646 IBISFEIRAD 2 HTL"
 */
function extrairTipoRegistro(linha: string): string | null {
  const m = linha.match(/\b(?:1|2)\s+(HTL|TKT|CAR|TRP|ADT|OTS)\b/)
  return m ? m[1] : null
}

function extrairStatus(linha: string): string | null {
  // "FOR-ANCORAVITAMEDIC CF" — só pegamos no fim da linha
  const m = linha.match(/\b(CF|ND|NC|CA)\b\s*(?:G\s+ADT|$)/)
  return m ? m[1] : null
}

/**
 * Extrai o intervalo de datas que aparece em descrições como:
 *  "01 QUARTO PADRÃO COM 1 CAMA CASAL - 19/03/26 a 20/03/26 LINS MOTTA..."
 *  "22/03/26 a 26/03/26 - GRUPO D INTERMEDIARIO HATCH AUTOMATI ..."
 */
function extrairPeriodoServico(texto: string): { inicio?: string; fim?: string } {
  const m = texto.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*a\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/)
  if (!m) return {}
  return { inicio: normalizarData(m[1]), fim: normalizarData(m[2]) }
}

/**
 * Extrai o nome do passageiro quando ele aparece numa linha solta.
 * Heurística: linha que tem "/" e não tem dígitos (ou poucos), em maiúsculas.
 */
function ehLinhaPassageiro(linha: string): boolean {
  const t = linha.trim()
  if (!t.includes('/')) return false
  if (t.length < 5) return false
  // Tem dígitos demais? Provavelmente é número de doc, não passageiro
  const digitos = (t.match(/\d/g) || []).length
  if (digitos > t.length * 0.3) return false
  // Tem letras maiúsculas?
  const maiusculas = (t.match(/[A-ZÀ-Ÿ]/g) || []).length
  return maiusculas > 5
}

/**
 * Função CENTRAL: a partir de TODAS as linhas extraídas do PDF (concatenadas
 * em ordem natural de leitura), agrupa as linhas em "blocos de registro" e
 * extrai os campos.
 */
function processarLinhas(todasLinhas: string[], cliente_filtro: string): RegistroMapa[] {
  // 1) Localiza todos os ÍNDICES de início de registro
  const indicesInicio: number[] = []
  for (let i = 0; i < todasLinhas.length; i++) {
    if (ehInicioRegistro(todasLinhas[i])) indicesInicio.push(i)
  }

  // 2) Para cada início, o bloco vai até o próximo início (ou fim)
  const blocos: { inicio: number; fim: number }[] = []
  for (let i = 0; i < indicesInicio.length; i++) {
    const ini = indicesInicio[i]
    const fim = i + 1 < indicesInicio.length ? indicesInicio[i + 1] - 1 : todasLinhas.length - 1
    blocos.push({ inicio: ini, fim })
  }

  // 3) Processa cada bloco
  const registros: RegistroMapa[] = []
  for (const bloco of blocos) {
    const linhasBloco = todasLinhas.slice(bloco.inicio, bloco.fim + 1)
    const reg = processarBlocoRegistro(linhasBloco, cliente_filtro)
    if (reg) registros.push(reg)
  }

  return registros
}

function processarBlocoRegistro(linhas: string[], cliente_filtro: string): RegistroMapa | null {
  const warnings: string[] = []
  const primeira = linhas[0]
  const m = ehInicioRegistro(primeira)
  if (!m) return null

  const venda_numero = m[1]
  const filial = m[2]
  const data_venda = normalizarData(m[3])
  const restoLinha1 = m[4]

  // resto da linha 1: "IBISFEIRA D RES0 29382- 6793 IV 7004215"
  // ou: "LA 2277 119413 6789 IV 7004210"
  // ou: "MOVIDA MV1N DKI1M4 6783 IV 7002310"
  // padrão: PRODUTO ... CODCLI (4 dígitos) FOP (IV|PX|XX) CCUSTO (7 dígitos)
  let produto = ''
  let forma_documento = ''
  let cod_cliente = ''
  let fop = ''
  let centro_custo = ''

  // Procura o padrão "DDDD (IV|PX|XX) DDDDDDD" no fim da linha
  const mFim = restoLinha1.match(/^(.+?)\s+(\d{4})\s+(IV|PX|XX)\s+(\d{6,7})\s*$/)
  if (mFim) {
    const antes = mFim[1]
    cod_cliente = mFim[2]
    fop = mFim[3]
    centro_custo = mFim[4]
    // antes = "IBISFEIRA D RES0 29382-"  → produto="IBISFEIRAD" forma_documento="RES0 29382"
    // antes = "LA 2277 119413"          → produto="LA"          forma_documento="2277 119413"
    // antes = "MOVIDA MV1N DKI1M4"      → produto="MOVIDA"      forma_documento="MV1N DKI1M4"
    const partes = antes.trim().split(/\s+/)
    if (partes.length >= 1) {
      // produto = primeira "palavra coerente" (até 12 chars sem números)
      // No PDF, produtos costumam ser tudo junto: IBISFEIRAD, IBISBUDGE
      // Se a 2ª palavra for de 1 letra (continuação), juntamos
      if (partes.length >= 2 && partes[1].length === 1) {
        produto = partes[0] + partes[1]
        forma_documento = partes.slice(2).join(' ').replace(/-$/, '')
      } else {
        produto = partes[0]
        forma_documento = partes.slice(1).join(' ').replace(/-$/, '')
      }
    }
  } else {
    warnings.push('Cabeçalho da linha não bateu com padrão esperado')
    produto = restoLinha1.split(/\s+/)[0] || ''
  }

  // Restante do bloco: tem o nome do cliente, o passageiro/descrição, valores, emissor, etc
  // Estratégia: identifica linhas notáveis pelo conteúdo, não pela posição
  let cliente_nome = cliente_filtro // default: pega do filtro do PDF
  let passageiro_completo = ''
  let rota_descricao = ''
  let emissor = ''
  let fornecedor = ''
  let promotor = ''
  let tipo_registro = ''
  let status = ''
  let valores_numericos: number[] = []
  let datas_servico: { inicio?: string; fim?: string } = {}

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i].trim()
    if (!linha) continue

    // Cliente nome (linha grande em maiúsculas, com palavras de empresa)
    if (/(LTDA|S\.A\.|SA|EIRELI|ME |EPP|INDÚSTRIA|FARMAC|TURISMO|COMERCIAL)/i.test(linha) && linha.length > 15) {
      if (!cliente_nome || cliente_nome === cliente_filtro) {
        cliente_nome = linha
      }
      continue
    }

    // Período do serviço + nome do passageiro (frequente na mesma linha)
    const periodo = extrairPeriodoServico(linha)
    if (periodo.inicio) {
      datas_servico = periodo
      // Tenta extrair o nome do passageiro depois do período
      const aposPeriodo = linha.split(/\d{1,2}\/\d{1,2}\/\d{2,4}/).slice(2).join(' ').trim()
      if (aposPeriodo && aposPeriodo.includes('/') && !passageiro_completo) {
        const nomeCandidato = aposPeriodo.replace(/^[\s\-]+/, '').trim()
        if (ehLinhaPassageiro(nomeCandidato)) {
          passageiro_completo = nomeCandidato
        }
      }
      if (!rota_descricao) rota_descricao = linha
      continue
    }

    // Linha do passageiro pura (nome e sobrenome com /)
    if (ehLinhaPassageiro(linha) && !passageiro_completo) {
      passageiro_completo = linha
      continue
    }

    // Linha que termina com "/NOME" e começa com rota tipo "GRU/GYN" — descrição de aéreo
    if (/^[A-Z]{3}(\/[A-Z]{3})+\s+\S+\/\S+/.test(linha) && !rota_descricao) {
      rota_descricao = linha
      // Extrai passageiro do final
      const partes = linha.split(/\s+/)
      const ultima = partes[partes.length - 1]
      if (ultima.includes('/')) passageiro_completo = ultima
      continue
    }

    // Linha que tem só valores numéricos com vírgula
    const numerosLinha = (linha.match(/[\d.]+,\d{2}/g) || []).map(parseValor)
    if (numerosLinha.length > 0 && /^[\d.,\s]+/.test(linha)) {
      valores_numericos.push(...numerosLinha)
      continue
    }

    // Tarifa + Emissor: "282,47 LAI"
    const mTarifaEmissor = linha.match(/^([\d.]+,\d{2})\s+([A-Z]{2,8})\b/)
    if (mTarifaEmissor) {
      valores_numericos.push(parseValor(mTarifaEmissor[1]))
      if (!emissor) emissor = mTarifaEmissor[2]
      // Pode ter mais valores depois
      const resto = linha.substring(mTarifaEmissor[0].length)
      const maisNum = (resto.match(/[\d.]+,\d{2}/g) || []).map(parseValor)
      valores_numericos.push(...maisNum)
      continue
    }

    // Tipo do registro: "2 HTL", "2 TKT", "1 CAR" etc
    const mTipo = extrairTipoRegistro(linha)
    if (mTipo && !tipo_registro) tipo_registro = mTipo

    // Status: CF/ND/NC/CA no fim
    const mStatus = extrairStatus(linha)
    if (mStatus && !status) status = mStatus

    // Fornecedor: linha com hífen e maiúsculas: FOR-ANCORA, FOR-BRT
    if (/^[A-Z]+-[A-Z]+/.test(linha) && !fornecedor) {
      const m = linha.match(/^([A-Z]+(?:-[A-Z]+)+)/)
      if (m) fornecedor = m[1]
    }

    // Promotor pode vir junto: "FOR-ANCORAVITAMEDIC CF"
    // Se a linha tem o nome do cliente colado, separa
    const matchPromCliente = linha.match(/^([A-Z\-]+)([A-Z]+)\s+(CF|ND|NC|CA)/)
    if (matchPromCliente && !promotor) {
      promotor = matchPromCliente[1]
      if (!status) status = matchPromCliente[3]
    }

    // Recheck status
    if (/\bCF\b/.test(linha) && !status) status = 'CF'
    else if (/\bND\b/.test(linha) && !status) status = 'ND'
    else if (/\bNC\b/.test(linha) && !status) status = 'NC'
  }

  // Distribui os valores numéricos em campos significativos
  // Heurística: o primeiro grande é tarifa, depois a_pagar, depois a_receber, depois markup
  let tarifa = 0, taxa_emb = 0, desc_cliente = 0, a_receber = 0, a_pagar = 0, prev_lucro = 0, markup = 0
  if (valores_numericos.length > 0) {
    const ord = [...valores_numericos].sort((a, b) => b - a)
    tarifa = ord[0] || 0
    a_pagar = ord[1] || 0
    a_receber = ord[2] || 0
    markup = ord[ord.length - 1] || 0
    if (ord.length >= 3) prev_lucro = a_receber > a_pagar ? a_receber - a_pagar : 0
  }

  if (!passageiro_completo) warnings.push('Passageiro não identificado')
  if (!tipo_registro) warnings.push('Tipo de registro (HTL/TKT/CAR) não identificado')
  if (valores_numericos.length === 0) warnings.push('Nenhum valor monetário encontrado')

  const pax = normalizarPassageiro(passageiro_completo)

  return {
    venda_numero,
    filial,
    tipo_registro: tipo_registro || 'OTS',
    data_venda,
    produto,
    forma_documento,
    cod_cliente,
    centro_custo,
    cliente_nome,
    passageiro_completo: pax.completo,
    passageiro_nome: pax.nome,
    passageiro_sobrenome: pax.sobrenome,
    rota_descricao,
    data_inicio_servico: datas_servico.inicio,
    data_fim_servico: datas_servico.fim,
    tarifa,
    taxa_emb,
    desc_cliente,
    a_receber,
    a_pagar,
    prev_lucro,
    markup,
    emissor,
    fornecedor,
    promotor,
    status: status || 'CF',
    fop,
    raw_lines: linhas,
    warnings,
  }
}

// ============================================================
// API PÚBLICA
// ============================================================

export async function parseMapaProducao(file: File): Promise<ResultadoParseMapa> {
  const { paginas, total } = await extrairTextoPDF(file)
  const todasLinhas: string[] = paginas.flat()

  const cab = extrairCabecalho(todasLinhas)
  const totais = extrairTotais(todasLinhas)
  const registros = processarLinhas(todasLinhas, cab.cliente)

  // Estatísticas
  const por_tipo: Record<string, number> = {}
  const por_status: Record<string, number> = {}
  let com_warnings = 0
  for (const r of registros) {
    por_tipo[r.tipo_registro] = (por_tipo[r.tipo_registro] || 0) + 1
    por_status[r.status] = (por_status[r.status] || 0) + 1
    if (r.warnings.length > 0) com_warnings++
  }

  const warnings_globais: string[] = []
  if (!cab.cliente) warnings_globais.push('Cliente do filtro não identificado')
  if (!cab.periodo_inicio) warnings_globais.push('Período do PDF não identificado')
  if (totais.numero_vendas > 0 && registros.length !== totais.numero_vendas) {
    warnings_globais.push(`PDF declara ${totais.numero_vendas} vendas mas extraímos ${registros.length}`)
  }

  return {
    cliente_filtro: cab.cliente,
    periodo_inicio: cab.periodo_inicio,
    periodo_fim: cab.periodo_fim,
    total_paginas: total,
    registros,
    totais_pdf: totais,
    estatisticas: {
      extraidos: registros.length,
      com_warnings,
      por_tipo,
      por_status,
    },
    warnings_globais,
  }
}

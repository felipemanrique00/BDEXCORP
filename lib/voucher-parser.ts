import { buscarFuncionariosPorNomeInteligente } from '@/lib/funcionario-identidade'

// ============================================================
// Parser de Voucher V4 — Otimizado com 12 PDFs reais do Felipe
// Layout BBT padrão:
//   VOUCHER Nº H XXXXX
//   Cliente (Client): NOME DO HÓSPEDE
//   Para (To): NOME DO HOTEL
//   Endereço (Address): ...
//   Cidade (City): CIDADE
//   Categoria: SINGLE/STANDARD   Tipo apt: INDIVIDUAL/LUXO/etc
//   Check-In: XX/XX/XXXX   Check-Out: XX/XX/XXXX
//   Noites: N   Hóspedes: N
//   Tipo de Pagamento: FATURAR SOMENTE DIARIAS E TAXAS
//   Regime de Alimentação: BREAKFAST/CAFÉ DA MANHÃ
// ============================================================

export interface VoucherParsed {
  passageiro?: string
  hotel?: string
  endereco?: string
  cidade?: string
  empresa_nome?: string
  voucher_numero?: string
  localizador?: string
  data_emissao?: string
  data_checkin?: string
  data_checkout?: string
  noites?: number
  num_hospedes?: number
  num_apts?: number
  categoria?: string
  tipo_apto?: 'SGL' | 'DBL' | 'TPL'
  tipo_apto_texto?: string // Ex: "INDIVIDUAL", "LUXO", "EXECUTIVO CASAL"
  tipo_pagamento?: string
  regime_alimentacao?: string
  telefone_hotel?: string
  confirmacao_numero?: string
  confirmado_por?: string
  fontes: Record<string, 'arquivo' | 'pdf' | 'ambos'>
}

function norm(s: string): string {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function parseDataBR(s: string): string | undefined {
  if (!s) return undefined
  const m = s.trim().match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
  if (!m) return undefined
  let [, d, mes, a] = m
  if (a.length === 2) a = (parseInt(a) > 50 ? '19' : '20') + a
  return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// ============================================================
// NOME DO ARQUIVO
// Padrão Felipe:
//   voucher - ALEX RODRIGUES GODINHO - Hotel select - Itumbiara - Empresa Refrescobandeirantes.pdf
//   voucher -MARCELO MORABITO - hotel jk.pdf
//   voucher_-_ANDRÉ_KAZUO_-_San_Juan.pdf
// ============================================================

export function parseVoucherFileName(nomeArquivo: string): Partial<VoucherParsed> {
  const result: Partial<VoucherParsed> = {}
  let nome = nomeArquivo.replace(/\.(pdf|PDF)$/, '')
  // _ vira espaço; múltiplos espaços viram 1
  nome = nome.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

  // Divide por " - " (com ou sem espaço antes/depois)
  const partes = nome.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean)
  if (partes.length === 0) return result

  // Remove "voucher" inicial
  let idx = 0
  if (norm(partes[idx]) === 'voucher' || norm(partes[idx]).startsWith('voucher ')) {
    if (norm(partes[idx]) === 'voucher') idx++
    else partes[idx] = partes[idx].replace(/^voucher\s*/i, '').trim()
  }

  if (partes[idx]) {
    result.passageiro = titleCase(partes[idx].trim())
    idx++
  }

  if (partes[idx]) {
    let hotel = partes[idx].trim()
    const hotelNorm = norm(hotel)
    if (!hotelNorm.startsWith('hotel') && !hotelNorm.startsWith('hosp')) {
      hotel = `Hotel ${hotel}`
    }
    result.hotel = titleCase(hotel)
    idx++
  }

  if (partes[idx]) {
    result.cidade = titleCase(partes[idx].trim())
    idx++
  }

  if (partes[idx]) {
    let emp = partes[idx].trim()
    emp = emp.replace(/^empresa\s+/i, '').trim()
    result.empresa_nome = titleCase(emp)
  }

  return result
}

// ============================================================
// EXTRAÇÃO DE TEXTO DO PDF (via pdfjs-dist)
// ============================================================

export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs')
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs'
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    let fullText = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      // Preserva quebras entre blocos (usa \n quando o item termina com "EOL" hint)
      const pageText = content.items
        .map((it: any) => (it.str || '') + ((it as any).hasEOL ? '\n' : ' '))
        .join('')
      fullText += pageText + '\n\n'
    }
    return fullText
  } catch (e) {
    console.error('Erro extraindo texto do PDF:', e)
    return ''
  }
}

// ============================================================
// PARSE DO CONTEÚDO — otimizado com 12 vouchers reais
// ============================================================

export function parseVoucherContent(texto: string): Partial<VoucherParsed> {
  const result: Partial<VoucherParsed> = {}
  if (!texto || texto.length < 20) return result

  // Versão single-line p/ maioria dos regex
  const t = texto.replace(/\s+/g, ' ')

  // ===== VOUCHER Nº =====
  // Padrões observados: "VOUCHER Nº H 25314", "VOUCHER H25314"
  const mVoucher = t.match(/voucher\s*n?[ºo°]?\s*([A-Z]?\s*\d{4,})/i)
  if (mVoucher) {
    const numero = mVoucher[1].replace(/\s+/g, '').trim().toUpperCase()
    // Formata "H25314" -> "H 25314"
    const formatted = numero.match(/^([A-Z])(\d+)$/) ? numero.replace(/^([A-Z])(\d+)$/, '$1 $2') : numero
    result.voucher_numero = formatted
    result.localizador = formatted
  }

  // ===== DATA DE EMISSÃO =====
  const mEmissao = t.match(/data\s+de\s+emiss[ãa]o\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
  if (mEmissao) result.data_emissao = parseDataBR(mEmissao[1])

  // ===== CLIENTE / PASSAGEIRO =====
  // Padrões: "Cliente (Client): NOME", "Cliente (Client) : NOME"
  // Nos vouchers reais: "Cliente (Client): ALEX RODRIGUES GODINHO"
  // Pode vir antes ou depois de "Obs (Remarks):"
  const mCliente = t.match(/cliente\s*\(\s*client\s*\)\s*:\s*([A-ZÀ-Ÿ][A-ZÀ-Ÿ\s&]+?)(?=\s+(?:data\s+de\s+emiss|obs\s*\(|para\s*\(|dados\s+da|endere|telefone|cidade|categoria|tipo\s+apt|$))/i)
  if (mCliente) {
    const nome = mCliente[1].trim().replace(/\s+/g, ' ')
    if (nome.length >= 3) result.passageiro = titleCase(nome)
  }

  // ===== PARA (HOTEL) =====
  // "Para (To): HOTEL JK" ou "Para (To): SAN JUAN BUSINESS SÃO PAULO"
  // Pode conter parênteses/acentos: "HOTEL PAULISTA PRIME - IBIA (HOTEL PAULISTA PRIME)"
  const mHotel = t.match(/para\s*\(\s*to\s*\)\s*:\s*(.+?)(?=\s+endere[çc]o|\s+address|\s+cidade|\s+city|\s{2,})/i)
  if (mHotel) {
    let hotel = mHotel[1].trim()
    // Remove conteúdo entre parênteses duplicado
    hotel = hotel.replace(/\s*\([^)]*\)\s*$/, '').trim()
    if (hotel.length >= 3) result.hotel = titleCase(hotel)
  }

  // ===== ENDEREÇO =====
  const mEndereco = t.match(/endere[çc]o\s*\(\s*address\s*\)\s*:\s*(.+?)(?=\s+cidade|\s+city|\s+telefone|\s+phone|\s{2,})/i)
  if (mEndereco) {
    const end = mEndereco[1].trim().replace(/\s+/g, ' ')
    if (end.length > 3) result.endereco = titleCase(end)
  }

  // ===== CIDADE =====
  const mCidade = t.match(/cidade\s*\(\s*city\s*\)\s*:\s*([A-ZÀ-Ÿ][A-ZÀ-Ÿ\s]+?)(?=\s+(?:telefone|phone|cliente|obs|endere|sr\.\s+cliente|dados\s+da|\s{2,}|$))/i)
  if (mCidade) {
    const cid = mCidade[1].trim()
    if (cid.length >= 2) result.cidade = titleCase(cid)
  }

  // ===== TELEFONE HOTEL =====
  const mTel = t.match(/telefone\s*\(\s*phone\s*#?\s*\)\s*:\s*\(?(\d{2})\)?\s*(\d{4,5})[\s-]?(\d{4})/i)
  if (mTel) result.telefone_hotel = `(${mTel[1]}) ${mTel[2]}-${mTel[3]}`

  // ===== CHECK-IN / CHECK-OUT =====
  // Padrão cabeçalho seguido das datas: "Check-In Check-Out ... 08/04/2026 09/04/2026"
  const mDatasJuntas = t.match(/check-?in\s+check-?out[^\d]*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
  if (mDatasJuntas) {
    result.data_checkin = parseDataBR(mDatasJuntas[1])
    result.data_checkout = parseDataBR(mDatasJuntas[2])
  } else {
    // Separadas: "Check-In: 27/04/2026"
    const mIn = t.match(/check-?in\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
    if (mIn) result.data_checkin = parseDataBR(mIn[1])
    const mOut = t.match(/check-?out\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
    if (mOut) result.data_checkout = parseDataBR(mOut[1])
  }

  // ===== NOITES / HÓSPEDES =====
  // Na tabela: "27/04/2026 29/04/2026 2 1" (data check-in, data check-out, noites, hóspedes)
  const mTabela = t.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,3})\s+(\d{1,3})/)
  if (mTabela) {
    result.noites = parseInt(mTabela[3])
    result.num_hospedes = parseInt(mTabela[4])
  } else {
    const mN = t.match(/noites\s*:?\s*(\d{1,3})/i)
    if (mN) result.noites = parseInt(mN[1])
    const mH = t.match(/h[óo]spedes\s*:?\s*(\d{1,3})/i)
    if (mH) result.num_hospedes = parseInt(mH[1])
  }

  // ===== NR. APTS =====
  const mApts = t.match(/nr?\.?\s*apt?s\s*:?\s*(\d{1,3})/i)
  if (mApts) result.num_apts = parseInt(mApts[1])

  // ===== TIPO DE APTO / CATEGORIA =====
  // Vouchers reais têm duas colunas: "Categoria" e "Tipo apt."
  // Exemplos: "SINGLE" + "INDIVIDUAL"
  //           "STANDARD" + "INDIVIDUAL"
  //           "SINGLE" + "EXECUTIVO CASAL"
  //           "SINGLE" + "QUARTO LUXO CASAL"

  if (/\bsingle\b/i.test(t)) result.tipo_apto = 'SGL'
  else if (/\bdouble\b|\bduplo\b/i.test(t)) result.tipo_apto = 'DBL'
  else if (/\btriple\b|\btriplo\b/i.test(t)) result.tipo_apto = 'TPL'
  else if (/\bstandard\b/i.test(t) && /individual/i.test(t)) result.tipo_apto = 'SGL'

  // Categoria (SINGLE/STANDARD/DOUBLE/TRIPLE)
  const mCatTop = t.match(/categoria[^a-zA-Z]*?(single|standard|double|duplo|triple|triplo|suite|superior|deluxe|master)/i)
  if (mCatTop) result.categoria = titleCase(mCatTop[1])

  // Tipo apt (INDIVIDUAL, LUXO, EXECUTIVO CASAL, etc)
  const mTipoApt = t.match(/tipo\s+apt\.?\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\s]+?)(?=\s+(?:check|\d{1,2}\/\d|tipo\s+de\s+pagamento|regime|\s{2,}))/i)
  if (mTipoApt) {
    const tp = mTipoApt[1].trim().replace(/\s+/g, ' ')
    // Valida — não pega "INDIVIDUAL CHECK-IN" ou coisas do header
    if (tp.length >= 3 && tp.length <= 40 && !/check|hospedes|noites/i.test(tp)) {
      result.tipo_apto_texto = titleCase(tp)
    }
  }

  // ===== TIPO DE PAGAMENTO =====
  if (/faturar\s+somente\s+di[áa]rias\s+e\s+taxas/i.test(t)) {
    result.tipo_pagamento = 'Faturar somente diárias e taxas'
  } else if (/faturar\s+tudo/i.test(t)) {
    result.tipo_pagamento = 'Faturar tudo'
  } else if (/\bpix\b/i.test(t)) {
    result.tipo_pagamento = 'Pix'
  } else if (/cart[ãa]o\s+da\s+ag[êe]ncia/i.test(t) || /\bCP\b/.test(t)) {
    result.tipo_pagamento = 'Cartão da agência'
  } else if (/cart[ãa]o/i.test(t)) {
    result.tipo_pagamento = 'Cartão'
  } else if (/faturado|iv\b/i.test(t)) {
    result.tipo_pagamento = 'Faturado'
  }

  // ===== REGIME DE ALIMENTAÇÃO =====
  if (/caf[ée]\s+da\s+manh[ãa]/i.test(t)) result.regime_alimentacao = 'Café da manhã'
  else if (/breakfast/i.test(t)) result.regime_alimentacao = 'Café da manhã'
  else if (/\bbb\b/i.test(t)) result.regime_alimentacao = 'Café da manhã'
  else if (/meia\s+pens/i.test(t)) result.regime_alimentacao = 'Meia pensão'
  else if (/pens[ãa]o\s+compl/i.test(t)) result.regime_alimentacao = 'Pensão completa'
  else if (/all[- ]?inclusive/i.test(t)) result.regime_alimentacao = 'All inclusive'
  else if (/sem\s+alim/i.test(t)) result.regime_alimentacao = 'Sem alimentação'

  // ===== NÚMERO DE CONFIRMAÇÃO =====
  const mConf = t.match(/nr\.?\s*confirma[çc][ãa]o\s*:?\s*([A-Z0-9\-]+)/i)
  if (mConf) {
    const c = mConf[1].trim()
    if (c && c !== '000000' && c.length >= 4) result.confirmacao_numero = c
  }

  // ===== CONFIRMADO POR =====
  const mConfPor = t.match(/confirmado\s+por\s*:?\s*([A-ZÀ-Ÿ]{2,30})/i)
  if (mConfPor) result.confirmado_por = titleCase(mConfPor[1].trim())

  return result
}

// ============================================================
// PARSER PRINCIPAL
// ============================================================

export async function parseVoucher(file: File): Promise<VoucherParsed> {
  const fromName = parseVoucherFileName(file.name)
  const texto = await extractTextFromPDF(file)
  const fromPDF = texto ? parseVoucherContent(texto) : {}

  const result: VoucherParsed = { fontes: {} }

  const keys: (keyof VoucherParsed)[] = [
    'passageiro', 'hotel', 'endereco', 'cidade', 'empresa_nome',
    'voucher_numero', 'localizador', 'data_emissao',
    'data_checkin', 'data_checkout', 'noites', 'num_hospedes', 'num_apts',
    'categoria', 'tipo_apto', 'tipo_apto_texto', 'tipo_pagamento',
    'regime_alimentacao', 'telefone_hotel', 'confirmacao_numero', 'confirmado_por',
  ]

  for (const k of keys) {
    const valPdf = (fromPDF as any)[k]
    const valNome = (fromName as any)[k]
    if (valPdf != null && valPdf !== '') {
      (result as any)[k] = valPdf
      result.fontes[k] = valNome ? 'ambos' : 'pdf'
    } else if (valNome != null && valNome !== '') {
      (result as any)[k] = valNome
      result.fontes[k] = 'arquivo'
    }
  }

  return result
}

// ============================================================
// MATCH DE FUNCIONÁRIO
// ============================================================

export interface FuncMatch {
  id: string
  nome: string
  empresa_id: string
  codigo_identificacao?: string
  cpf?: string
  score: number
}

export function encontrarFuncionarioPorNome(
  nomeBusca: string,
  funcionarios: { id: string; nome: string; company_id: string; cpf?: string; codigo_identificacao?: string; matricula?: string }[],
  empresaIdFiltro?: string
): FuncMatch[] {
  if (!nomeBusca || nomeBusca.trim().length < 2) return []
  return buscarFuncionariosPorNomeInteligente(funcionarios as any, nomeBusca, empresaIdFiltro, 10)
    .map((match) => ({
      id: match.funcionario.id,
      nome: match.funcionario.nome,
      empresa_id: match.funcionario.company_id,
      codigo_identificacao: match.funcionario.codigo_identificacao,
      cpf: match.funcionario.cpf,
      score: match.score,
    }))
}

/** Match também por CPF — mais preciso quando disponível */
export function encontrarFuncionarioPorCPF(
  cpf: string,
  funcionarios: { id: string; nome: string; company_id: string; cpf?: string }[]
): { id: string; nome: string; empresa_id: string } | null {
  const cpfLimpo = (cpf || '').replace(/\D/g, '')
  if (cpfLimpo.length !== 11) return null
  const f = funcionarios.find((x) => x.cpf?.replace(/\D/g, '') === cpfLimpo)
  return f ? { id: f.id, nome: f.nome, empresa_id: f.company_id } : null
}

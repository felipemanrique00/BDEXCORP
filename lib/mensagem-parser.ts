import type { TipoServico } from '@/types'

export interface MensagemParsed {
  tipo_servico?: TipoServico
  passageiro_nome?: string
  passageiros_lista?: string[]
  empresa_nome?: string
  empresa_faturar?: string
  centro_custo?: string
  solicitante_nome?: string
  solicitante_email?: string
  cidade_origem?: string
  cidade_destino?: string
  hotel_nome?: string
  tipo_quarto?: 'SGL' | 'DBL' | 'TPL'
  valor_diaria?: number
  cafe_manha?: boolean
  faturar_observacao?: string
  data_ida?: string
  data_volta?: string
  data_checkin?: string
  data_checkout?: string
  num_hospedes?: number
  cpf?: string
  telefone?: string
  observacoes?: string
  urgente?: boolean
  modo?: 'estruturado' | 'conversacional'
  fontes?: Record<string, 'label' | 'heuristica'>
}

const LABELS: Record<string, string> = {
  nome: 'nome',
  passageiro: 'passageiro',
  passageira: 'passageiro',
  passageiros: 'pax',
  viajante: 'passageiro',
  cliente: 'passageiro',
  hospede: 'hospedes',
  hospedes: 'hospedes',
  hóspede: 'hospedes',
  hóspedes: 'hospedes',
  pax: 'pax',
  cpf: 'cpf',
  rg: 'rg',
  email: 'email',
  'e-mail': 'email',
  telefone: 'telefone',
  celular: 'telefone',
  fone: 'telefone',
  contato: 'telefone',
  empresa: 'empresa',
  'cliente empresa': 'empresa',
  'razao social': 'empresa',
  'razão social': 'empresa',
  faturar: 'faturar',
  'faturar para': 'faturar_para',
  'centro custo': 'centro_custo',
  'centro de custo': 'centro_custo',
  solicitante: 'solicitante',
  autorizador: 'solicitante',
  'nome completo': 'solicitante',
  cidade: 'cidade_destino',
  destino: 'cidade_destino',
  'cidade destino': 'cidade_destino',
  origem: 'cidade_origem',
  saida: 'cidade_origem',
  saída: 'cidade_origem',
  'cidade origem': 'cidade_origem',
  hotel: 'hotel',
  checkin: 'checkin',
  'check-in': 'checkin',
  'check in': 'checkin',
  entrada: 'checkin',
  chegada: 'checkin',
  checkout: 'checkout',
  'check-out': 'checkout',
  'check out': 'checkout',
  saida_hotel: 'checkout',
  partida: 'checkout',
  ida: 'ida',
  'data ida': 'ida',
  volta: 'volta',
  retorno: 'volta',
  'data volta': 'volta',
  servico: 'servico',
  serviço: 'servico',
  tipo: 'servico',
  'tipo quarto': 'tipo_quarto',
  'tipo de quarto': 'tipo_quarto',
  diaria: 'valor_diaria',
  diária: 'valor_diaria',
  'valor diaria': 'valor_diaria',
  'valor diária': 'valor_diaria',
  observacao: 'observacoes',
  observação: 'observacoes',
  observacoes: 'observacoes',
  observações: 'observacoes',
  obs: 'observacoes',
}

const MESES: Record<string, number> = {
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  março: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
}

const STOP_NOME = /\b(hotel|hospedagem|check|checkout|checkin|entrada|saida|saída|cidade|destino|origem|empresa|faturar|centro|custo|cpf|telefone|email|e-mail|diaria|diária|valor|voucher|demanda|reserva|passagem|voo|aereo|aéreo|carro|locacao|locação|bom|boa|favor|obrigad|urgente)\b/i

function norm(value: string): string {
  return (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function setFonte(result: MensagemParsed, field: string, fonte: 'label' | 'heuristica') {
  if (!result.fontes) result.fontes = {}
  result.fontes[field] = fonte
}

function parseDataBR(value: string, anoDefault?: number): string | undefined {
  if (!value) return undefined
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const m = value.trim().match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/)
  if (!m) return undefined

  const dia = Number(m[1])
  const mes = Number(m[2])
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return undefined

  let ano = m[3] ? Number(m[3]) : anoDefault || new Date().getFullYear()
  if (ano < 100) ano += ano > 50 ? 1900 : 2000

  if (!m[3]) {
    const hoje = new Date()
    const candidato = new Date(ano, mes - 1, dia)
    const ontem = new Date(hoje)
    ontem.setDate(hoje.getDate() - 1)
    if (candidato < ontem) ano += 1
  }

  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function parseDataExtensa(value: string): string | undefined {
  const m = value.match(/(\d{1,2})\s+de\s+([a-zçãé]+)(?:\s+de\s+(\d{2,4}))?/i)
  if (!m) return undefined
  const mes = MESES[norm(m[2])]
  if (!mes) return undefined
  let ano = m[3] ? Number(m[3]) : new Date().getFullYear()
  if (ano < 100) ano += 2000
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
}

function detectarLabel(raw: string): { label: string; value: string } | null {
  const line = raw.trim()
  if (!line) return null

  const inline = line.match(/^([A-Za-zÀ-ÿ0-9\s\-/.]{2,45}?)\s*:\s*(.*)$/)
  if (inline) {
    const key = LABELS[norm(inline[1]).replace(/\s+/g, ' ')]
    return key ? { label: key, value: inline[2].trim() } : null
  }

  const loose = LABELS[norm(line.replace(/[:：]+$/g, '')).replace(/\s+/g, ' ')]
  return loose ? { label: loose, value: '' } : null
}

function splitColunas(line: string): string[] {
  const clean = line.trim()
  if (!clean) return []
  if (clean.includes('\t')) return clean.split('\t').map((v) => v.trim()).filter(Boolean)
  if (clean.includes('|')) return clean.split('|').map((v) => v.trim()).filter(Boolean)
  const spaced = clean.split(/\s{2,}/).map((v) => v.trim()).filter(Boolean)
  return spaced.length >= 2 ? spaced : [clean]
}

function splitNomes(value: string): string[] {
  return value
    .split(/\n|,|;|\s+\/\s+|\s+\+\s+/)
    .map((v) =>
      compact(
        v
          .replace(/^(sr\.?|sra\.?|dr\.?|dra\.?)\s+/i, '')
          .replace(/\s+(?:de|do|da|dos|das|para|pra|em|no|na|dia)$/i, ''),
      ),
    )
    .filter((v) => v.length >= 3 && !STOP_NOME.test(v))
}

function aplicarNome(result: MensagemParsed, value: string, fonte: 'label' | 'heuristica') {
  const nomes = splitNomes(value)
  if (!nomes.length) return
  if (!result.passageiros_lista) result.passageiros_lista = []
  nomes.forEach((nome) => {
    if (!result.passageiros_lista!.some((item) => norm(item) === norm(nome))) result.passageiros_lista!.push(nome)
  })
  if (!result.passageiro_nome) {
    result.passageiro_nome = result.passageiros_lista[0]
    setFonte(result, 'passageiro_nome', fonte)
  }
  if (result.passageiros_lista.length > 1) {
    result.num_hospedes = result.passageiros_lista.length
    setFonte(result, 'num_hospedes', fonte)
  }
}

function aplicarTipoServico(result: MensagemParsed, value: string) {
  const v = norm(value)
  const temHotel = /\b(hotel|hospedagem|diaria|pernoite|apartamento|apto)\b/.test(v)
  const temAereo = /\b(aereo|voo|voos|passagem|bilhete|ida|volta)\b/.test(v)
  const temCarro = /\b(carro|locacao|locadora|aluguel)\b/.test(v)
  if (temHotel && temAereo) result.tipo_servico = 'Pacote'
  else if (temHotel) result.tipo_servico = 'Hotel'
  else if (temAereo) result.tipo_servico = 'Aéreo'
  else if (temCarro) result.tipo_servico = 'Carro'
  else if (/\bpacote\b/.test(v)) result.tipo_servico = 'Pacote'
}

function aplicarLabel(result: MensagemParsed, label: string, value: string): boolean {
  const valor = compact(value)
  if (!valor) return false

  if (['nome', 'passageiro', 'hospedes'].includes(label)) {
    aplicarNome(result, valor, 'label')
    return true
  }

  if (label === 'pax' || label === 'passageiros' || label === 'pessoas') {
    const qtd = valor.match(/^\d+$/)
    if (qtd) {
      result.num_hospedes = Number(qtd[0])
      setFonte(result, 'num_hospedes', 'label')
    } else {
      aplicarNome(result, valor, 'label')
    }
    return true
  }

  if (label === 'cpf') {
    const digitos = valor.replace(/\D/g, '')
    if (digitos.length === 11) {
      result.cpf = digitos
      setFonte(result, 'cpf', 'label')
    }
    return true
  }

  if (label === 'email') {
    const email = valor.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
    if (email) {
      result.solicitante_email = email
      setFonte(result, 'solicitante_email', 'label')
    }
    return true
  }

  if (label === 'telefone') {
    const digitos = valor.replace(/\D/g, '')
    if (digitos.length >= 10) {
      result.telefone = digitos
      setFonte(result, 'telefone', 'label')
    }
    return true
  }

  if (label === 'empresa') {
    result.empresa_nome = valor
    setFonte(result, 'empresa_nome', 'label')
    return true
  }

  if (label === 'faturar_para') {
    result.empresa_faturar = valor
    if (!result.empresa_nome) result.empresa_nome = valor
    setFonte(result, 'empresa_faturar', 'label')
    return true
  }

  if (label === 'faturar') {
    result.faturar_observacao = valor
    return true
  }

  if (label === 'centro_custo') {
    result.centro_custo = valor
    setFonte(result, 'centro_custo', 'label')
    return true
  }

  if (label === 'solicitante') {
    result.solicitante_nome = valor
    setFonte(result, 'solicitante_nome', 'label')
    return true
  }

  if (label === 'cidade_destino') {
    result.cidade_destino = valor
    setFonte(result, 'cidade_destino', 'label')
    return true
  }

  if (label === 'cidade_origem') {
    result.cidade_origem = valor
    setFonte(result, 'cidade_origem', 'label')
    return true
  }

  if (label === 'hotel') {
    result.hotel_nome = valor
    result.tipo_servico ||= 'Hotel'
    setFonte(result, 'hotel_nome', 'label')
    return true
  }

  if (label === 'checkin') {
    result.data_checkin = parseDataBR(valor) || parseDataExtensa(valor)
    result.tipo_servico ||= 'Hotel'
    setFonte(result, 'data_checkin', 'label')
    return true
  }

  if (label === 'checkout') {
    result.data_checkout = parseDataBR(valor) || parseDataExtensa(valor)
    result.tipo_servico ||= 'Hotel'
    setFonte(result, 'data_checkout', 'label')
    return true
  }

  if (label === 'ida') {
    result.data_ida = parseDataBR(valor) || parseDataExtensa(valor)
    setFonte(result, 'data_ida', 'label')
    return true
  }

  if (label === 'volta') {
    result.data_volta = parseDataBR(valor) || parseDataExtensa(valor)
    setFonte(result, 'data_volta', 'label')
    return true
  }

  if (label === 'servico') {
    aplicarTipoServico(result, valor)
    return true
  }

  if (label === 'tipo_quarto') {
    const v = norm(valor)
    if (/individual|single|sgl|simples/.test(v)) result.tipo_quarto = 'SGL'
    else if (/duplo|double|dbl|casal/.test(v)) result.tipo_quarto = 'DBL'
    else if (/triplo|triple|tpl/.test(v)) result.tipo_quarto = 'TPL'
    result.tipo_servico ||= 'Hotel'
    setFonte(result, 'tipo_quarto', 'label')
    return true
  }

  if (label === 'valor_diaria') {
    const match = valor.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:[.,]\d{2})?)/)
    if (match) {
      const numero = Number(match[1].replace(/\./g, '').replace(',', '.'))
      if (numero > 0) {
        result.valor_diaria = numero
        setFonte(result, 'valor_diaria', 'label')
      }
    }
    if (/cafe|café|breakfast/i.test(valor)) result.cafe_manha = true
    result.tipo_servico ||= 'Hotel'
    return true
  }

  if (label === 'observacoes') {
    result.observacoes = valor
    return true
  }

  return false
}

function aplicarTabelas(result: MensagemParsed, linhas: string[]) {
  for (const line of linhas) {
    const colunas = splitColunas(line)
    if (colunas.length < 2) continue
    const label = detectarLabel(colunas[0])
    if (label && !label.value) aplicarLabel(result, label.label, colunas.slice(1).join(' '))
  }

  for (let i = 0; i < linhas.length - 1; i++) {
    const labels = splitColunas(linhas[i]).map(detectarLabel).filter((v): v is { label: string; value: string } => Boolean(v))
    const valores = splitColunas(linhas[i + 1])
    if (labels.length >= 2 && valores.length >= 2) {
      labels.forEach((label, idx) => {
        if (valores[idx]) aplicarLabel(result, label.label, valores[idx])
      })
    }
  }

  for (let i = 0; i < linhas.length - 3; i++) {
    const labels: Array<{ label: string; value: string }> = []
    let cursor = i
    while (cursor < linhas.length) {
      const label = detectarLabel(linhas[cursor])
      if (!label || label.value) break
      labels.push(label)
      cursor++
    }
    if (labels.length < 2) continue
    const valores = linhas.slice(cursor, cursor + labels.length)
    if (valores.length === labels.length && valores.every((value) => !detectarLabel(value))) {
      labels.forEach((label, idx) => aplicarLabel(result, label.label, valores[idx]))
      break
    }
  }
}

function aplicarLabels(result: MensagemParsed, linhas: string[]) {
  for (let i = 0; i < linhas.length; i++) {
    const label = detectarLabel(linhas[i])
    if (!label) continue
    if (label.value) {
      aplicarLabel(result, label.label, label.value)
      continue
    }

    const valores: string[] = []
    let cursor = i + 1
    while (cursor < linhas.length && !detectarLabel(linhas[cursor])) {
      valores.push(linhas[cursor])
      cursor++
    }
    if (valores.length) {
      aplicarLabel(result, label.label, valores.join('\n'))
      i = cursor - 1
    }
  }
}

function aplicarCabecalhosEmail(result: MensagemParsed, text: string) {
  const from = text.match(/(?:^|\n)(?:de|from)\s*:\s*(?:"?([^"<\n]+)"?\s*)?<([^>\s]+@[^>\s]+)>/i)
  if (from) {
    if (!result.solicitante_nome && from[1]) {
      result.solicitante_nome = compact(from[1])
      setFonte(result, 'solicitante_nome', 'heuristica')
    }
    if (!result.solicitante_email) {
      result.solicitante_email = from[2]
      setFonte(result, 'solicitante_email', 'heuristica')
    }
  }

  const subject = text.match(/(?:^|\n)(?:assunto|subject)\s*:\s*(.+)/i)?.[1]
  if (subject && !result.observacoes) result.observacoes = `Assunto: ${compact(subject)}`
}

function aplicarHeuristicasComuns(result: MensagemParsed, text: string) {
  const t = compact(text)
  const tn = norm(t)

  aplicarCabecalhosEmail(result, text)
  if (!result.tipo_servico) aplicarTipoServico(result, t)
  if (/\b(urgente|urgencia|urgência|hoje|agora|imediato|asap|plantao|plantão)\b/i.test(t)) result.urgente = true

  if (!result.cpf) {
    const cpf = t.match(/\b(\d{3}\.?\d{3}\.?\d{3}[-.]?\d{2})\b/)
    if (cpf) {
      result.cpf = cpf[1].replace(/\D/g, '')
      setFonte(result, 'cpf', 'heuristica')
    }
  }

  if (!result.telefone) {
    const tel = t.match(/\(?(\d{2})\)?\s*9?\s*(\d{4,5})[\s-]?(\d{4})/)
    if (tel) {
      result.telefone = `${tel[1]}${tel[2]}${tel[3]}`
      setFonte(result, 'telefone', 'heuristica')
    }
  }

  if (!result.passageiro_nome) {
    const namePatterns = [
      /(?:passageiro|passageira|hospede|hóspede|viajante|pax|cliente)\s*:?\s*([A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{2,}(?:\s+[A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{1,}){0,5})/i,
      /(?:voucher|demanda|reserva)\s+(?:do|da|de)\s+([A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{2,}(?:\s+[A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{1,}){0,5})/i,
      /\bpara\s+(?:o\s+|a\s+)?(?:sr\.?|sra\.?|dr\.?|dra\.?)?\s*([A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{2,}(?:\s+[A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{1,}){0,5})/i,
      /\b(?:sr\.?|sra\.?|dr\.?|dra\.?)\s+([A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{2,}(?:\s+[A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{1,}){0,5})/i,
    ]
    for (const pattern of namePatterns) {
      const found = t.match(pattern)?.[1]
      if (found && nomePessoaProvavel(found)) {
        aplicarNome(result, found, 'heuristica')
        break
      }
    }
  }

  if (!result.cidade_origem || !result.cidade_destino) {
    const dePara = t.match(/\b(?:de|sair de|saindo de|voo de|origem)\s+([A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{2,}(?:\s+[A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{1,}){0,3})\s+(?:para|pra|até|ate|destino)\s+([A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{2,}(?:\s+[A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{1,}){0,3})/i)
    if (dePara) {
      result.cidade_origem ||= compact(dePara[1])
      result.cidade_destino ||= compact(dePara[2])
      setFonte(result, 'cidade_destino', 'heuristica')
    }
  }

  if (!result.cidade_destino) {
    const destino = t.match(/\b(?:em|na cidade de|no municipio de|destino|para|pra|até|ate)\s+([A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{2,}(?:\s+[A-ZÀ-ÿ][A-ZÀ-ÿa-zà-ÿ]{1,}){0,3})(?:\s*[-/]\s*[A-Z]{2})?/i)
    if (destino) {
      const cidade = compact(destino[1])
      if (!nomePessoaProvavel(cidade) || /\b(campo|grande|brasilia|brasília|goiania|goiânia|sao|são|rio|belo|horizonte)\b/i.test(cidade)) {
        result.cidade_destino = cidade
        setFonte(result, 'cidade_destino', 'heuristica')
      }
    }
  }

  const checkin = t.match(/(?:check-?in|entrada|chegada)\s*:?\s*(?:dia\s+)?(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)/i)
  const checkout = t.match(/(?:check-?out|saida|saída|partida)\s*:?\s*(?:dia\s+)?(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)/i)
  if (checkin && !result.data_checkin) result.data_checkin = parseDataBR(checkin[1])
  if (checkout && !result.data_checkout) result.data_checkout = parseDataBR(checkout[1])

  const ida = t.match(/(?:ida|partida|embarque)\s*:?\s*(?:dia\s+)?(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)/i)
  const volta = t.match(/(?:volta|retorno)\s*:?\s*(?:dia\s+)?(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)/i)
  if (ida && !result.data_ida) result.data_ida = parseDataBR(ida[1])
  if (volta && !result.data_volta) result.data_volta = parseDataBR(volta[1])

  aplicarIntervaloDatas(result, t)

  if (!result.data_checkin && !result.data_ida) {
    const datas = Array.from(t.matchAll(/(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)/g)).map((m) => parseDataBR(m[1])).filter(Boolean) as string[]
    if (datas[0]) aplicarDataInicial(result, datas[0])
    if (datas[1]) aplicarDataFinal(result, datas[1])
  }

  if (!result.data_checkin && !result.data_ida) {
    const extensas = Array.from(t.matchAll(/(\d{1,2}\s+de\s+[a-zçãé]+(?:\s+de\s+\d{2,4})?)/gi)).map((m) => parseDataExtensa(m[1])).filter(Boolean) as string[]
    if (extensas[0]) aplicarDataInicial(result, extensas[0])
    if (extensas[1]) aplicarDataFinal(result, extensas[1])
  }

  const pax = t.match(/(\d+)\s*(?:pax|passageiros?|hospedes?|hóspedes?|pessoas?|adultos?)/i)
  if (pax && !result.num_hospedes) {
    result.num_hospedes = Number(pax[1])
    setFonte(result, 'num_hospedes', 'heuristica')
  }

  if (!result.empresa_nome) {
    const empresa = t.match(/(?:empresa|cliente empresa|razao social|razão social|de parte da)\s*:?\s*([A-ZÀ-ÿ0-9][A-ZÀ-ÿa-zà-ÿ0-9&.\-\s]{2,60})/i)
    if (empresa) {
      result.empresa_nome = compact(empresa[1])
      setFonte(result, 'empresa_nome', 'heuristica')
    }
  }

  if (!result.hotel_nome) {
    const hotel = t.match(/\bhotel\s+([A-ZÀ-ÿ0-9][A-ZÀ-ÿa-zà-ÿ0-9&.\-\s]{2,50})(?:\s+(?:check|entrada|cidade|para|dia|de\s+\d)|$)/i)
    if (hotel && !/hotel|hospedagem/i.test(compact(hotel[1]))) {
      result.hotel_nome = compact(hotel[1])
      result.tipo_servico ||= 'Hotel'
      setFonte(result, 'hotel_nome', 'heuristica')
    }
  }

  if (/cafe|café|breakfast/i.test(t)) result.cafe_manha = true
  if (!result.tipo_servico && (result.hotel_nome || result.data_checkin || result.data_checkout || result.tipo_quarto || result.valor_diaria)) {
    result.tipo_servico = 'Hotel'
  }
  if (/\baereo|aéreo|voo|passagem|bilhete/.test(tn) && (result.data_ida || result.cidade_destino)) result.tipo_servico ||= 'Aéreo'

  inferirPassageiroSolto(result, text)
}

function aplicarIntervaloDatas(result: MensagemParsed, text: string) {
  const range = text.match(/(\d{1,2})(?:[\/\-.](\d{1,2}))?\s*(?:a|ate|até|ao|-)\s*(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/i)
  if (!range) return

  const mesInicial = range[2] || range[4]
  const ano = range[5] ? `/${range[5]}` : ''
  const inicio = parseDataBR(`${range[1]}/${mesInicial}${ano}`)
  const fim = parseDataBR(`${range[3]}/${range[4]}${ano}`)
  if (inicio) aplicarDataInicial(result, inicio)
  if (fim) aplicarDataFinal(result, fim)
}

function aplicarDataInicial(result: MensagemParsed, data: string) {
  if (result.tipo_servico === 'Aéreo') result.data_ida ||= data
  else result.data_checkin ||= data
}

function aplicarDataFinal(result: MensagemParsed, data: string) {
  if (result.tipo_servico === 'Aéreo') result.data_volta ||= data
  else result.data_checkout ||= data
}

function nomePessoaProvavel(value: string): boolean {
  const clean = compact(value.replace(/\b(sr\.?|sra\.?|dr\.?|dra\.?)\b/gi, ''))
  if (!clean || clean.length < 3 || clean.length > 80) return false
  if (/[0-9@]/.test(clean) || STOP_NOME.test(clean)) return false
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length > 6) return false
  return words.every((word) => /^[A-Za-zÀ-ÿ'.-]{2,}$/.test(word))
}

function inferirPassageiroSolto(result: MensagemParsed, text: string) {
  if (result.passageiro_nome) return

  const linhas = text
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean)
    .filter((line) => !detectarLabel(line))
    .filter((line) => !/^(de|from|para|to|assunto|subject|data|date)\s*:/i.test(line))
    .filter((line) => !/[<>{}@]/.test(line))
    .filter((line) => !/\d{1,2}[\/\-.]\d{1,2}/.test(line))

  const candidatos = linhas.filter(nomePessoaProvavel)
  if (candidatos.length === 1) {
    aplicarNome(result, candidatos[0], 'heuristica')
    return
  }

  const textoCurto = compact(text)
  if (linhas.length <= 2 && nomePessoaProvavel(textoCurto)) {
    aplicarNome(result, textoCurto, 'heuristica')
  }
}

function parseEstruturado(text: string): MensagemParsed {
  const result: MensagemParsed = { modo: 'estruturado', fontes: {} }
  const linhas = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  aplicarTabelas(result, linhas)
  aplicarLabels(result, linhas)
  aplicarHeuristicasComuns(result, text)

  result.observacoes ||= text.trim().slice(0, 1000)
  return result
}

function parseConversacional(text: string): MensagemParsed {
  const result: MensagemParsed = { modo: 'conversacional', fontes: {} }
  aplicarHeuristicasComuns(result, text)
  result.observacoes ||= text.trim().slice(0, 1000)
  return result
}

function isEstruturada(text: string): boolean {
  const linhas = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (linhas.length < 2) return false

  const labelsInline = linhas.filter((line) => Boolean(detectarLabel(line))).length
  if (labelsInline >= 2) return true

  for (let i = 0; i < linhas.length - 1; i++) {
    const labels = splitColunas(linhas[i]).map(detectarLabel).filter(Boolean)
    const valores = splitColunas(linhas[i + 1])
    if (labels.length >= 2 && valores.length >= 2) return true
  }

  return false
}

export function parseMensagem(text: string): MensagemParsed {
  if (!text || text.trim().length < 3) return { fontes: {} }
  return isEstruturada(text) ? parseEstruturado(text) : parseConversacional(text)
}

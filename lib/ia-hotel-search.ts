import type { FormaPagamento, Hotel } from '@/types'

export interface HotelAISuggestion extends Omit<Hotel, 'id'> {
  endereco?: string | null
  site?: string | null
  fonte_url?: string | null
  fonte_titulo?: string | null
  confianca?: 'alta' | 'media' | 'baixa'
}

export interface HotelSearchResponse {
  source: 'gemini-google' | 'openai-web' | 'local-catalog'
  query: string
  summary: string
  suggestions: HotelAISuggestion[]
  search_queries?: string[]
  citations?: Array<{ title: string; uri: string }>
}

export async function buscarHoteisComIA(params: {
  query: string
  cidade?: string
  uf?: string
  knownHotels?: Array<Pick<Hotel, 'nome' | 'cidade' | 'uf'>>
}): Promise<HotelSearchResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const r = await fetch('/api/ia/hotel-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
    return data
  } finally {
    clearTimeout(timeout)
  }
}

export function sugestaoParaHotel(s: HotelAISuggestion): Omit<Hotel, 'id'> {
  return {
    nome: s.nome || 'Hotel sem nome',
    cidade: s.cidade || '',
    uf: (s.uf || '').toUpperCase().slice(0, 2),
    categoria: s.categoria,
    observacoes:
      s.observacoes ||
      [
        s.endereco ? `Endereco: ${s.endereco}` : '',
        s.site ? `Site: ${s.site}` : '',
        s.fonte_titulo ? `Fonte: ${s.fonte_titulo}` : '',
      ]
        .filter(Boolean)
        .join(' | ') ||
      null,
    telefone: limparTelefone(s.telefone),
    faturado: s.faturado ?? false,
    info_faturamento: s.info_faturamento || null,
    bebedouro: s.bebedouro || null,
    valor_agua: s.valor_agua ?? null,
    cafe_manha: s.cafe_manha || null,
    estacionamento: s.estacionamento || null,
    tarifa_sgl: s.tarifa_sgl ?? null,
    tarifa_dbl: s.tarifa_dbl ?? null,
    tarifa_tpl: s.tarifa_tpl ?? null,
    formas_pagamento: normalizarFormas(s.formas_pagamento),
  }
}

export function extrairDestinoHotel(texto: string): { cidade?: string; uf?: string; query: string } {
  const raw = texto.trim()
  const ufMatch = raw.match(/\b([A-Z]{2})\b/i)
  const uf = ufMatch?.[1]?.toUpperCase()
  const cidadeMatch =
    raw.match(/(?:em|para|cidade de|hospedagem em)\s+([a-zA-ZÀ-ÿ\s]+?)(?:[-/,]\s*[A-Z]{2}\b|$)/i) ||
    raw.match(/^([a-zA-ZÀ-ÿ\s]+?)(?:[-/,]\s*[A-Z]{2}\b|$)/i)
  const cidade = cidadeMatch?.[1]?.replace(/\b(hotel|hotéis|hoteis|hospedagem|pousada)\b/gi, '').trim()
  return { cidade: cidade || undefined, uf, query: raw }
}

export function hotelJaExiste(
  hoteis: Array<Pick<Hotel, 'nome' | 'cidade' | 'uf'>>,
  nome?: string | null,
  cidade?: string | null,
  uf?: string | null,
): boolean {
  const n = normalizarTexto(nome || '')
  const c = normalizarTexto(cidade || '')
  const u = (uf || '').toUpperCase()
  if (!n) return false
  return hoteis.some((h) => {
    const hotelNome = normalizarTexto(h.nome)
    const mesmoNome = hotelNome === n || hotelNome.includes(n) || n.includes(hotelNome)
    const mesmaCidade = !c || normalizarTexto(h.cidade) === c
    const mesmoUf = !u || h.uf.toUpperCase() === u
    return mesmoNome && mesmaCidade && mesmoUf
  })
}

export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function limparTelefone(value?: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length >= 8 ? digits : value.trim()
}

function normalizarFormas(formas?: FormaPagamento[]): FormaPagamento[] {
  if (!formas?.length) return ['CC', 'PX']
  return Array.from(new Set(formas.filter(Boolean)))
}

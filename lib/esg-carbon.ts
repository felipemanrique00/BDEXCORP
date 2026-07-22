// ============================================================
// ESG / PEGADA DE CARBONO — V13
//
// Calcula CO₂e (kg) por viagem/voucher usando fatores reconhecidos:
//
// AÉREO  — DEFRA 2024 / ICAO. Fatores em kg CO₂e por passageiro·km:
//          curta (<463 km)         0.255 (econ) / 0.382 (exec)
//          média  (463-3700 km)    0.156 / 0.234
//          longa  (>3700 km)       0.150 / 0.435 (exec) / 0.580 (1ª)
//          (uplift de carga, irradiative forcing já embutido)
//
// HOTEL  — Hotel Carbon Measurement Initiative (HCMI):
//          BR/AL média 25 kg CO₂e por noite/quarto (4★).
//          Ajuste por estrelas (3★ ~18, 5★ ~32).
//
// CARRO  — DEFRA: 0.171 kg CO₂e/km (médio).
//          Considera 200 km/dia se distância não informada.
//
// Os números são intencionalmente conservadores (sem precisão de
// emissão por aeronave específica, mas reportável em relatórios ESG).
// ============================================================

import type { Atendimento, ClasseAerea, PegadaCarbono, VoucherEmitido } from '@/types'

// --- Distâncias aproximadas entre cidades brasileiras / capitais ---
// Coordenadas (lat,lng) das principais capitais para cálculo Haversine.
const CAPITAIS_COORD: Record<string, { lat: number; lng: number; nome: string }> = {
  'BSB': { lat: -15.78, lng: -47.92, nome: 'Brasília' },
  'GRU': { lat: -23.43, lng: -46.47, nome: 'São Paulo (GRU)' },
  'CGH': { lat: -23.62, lng: -46.65, nome: 'São Paulo (CGH)' },
  'GIG': { lat: -22.81, lng: -43.25, nome: 'Rio de Janeiro' },
  'CWB': { lat: -25.53, lng: -49.17, nome: 'Curitiba' },
  'POA': { lat: -29.99, lng: -51.17, nome: 'Porto Alegre' },
  'BEL': { lat: -1.38, lng: -48.47, nome: 'Belém' },
  'FOR': { lat: -3.78, lng: -38.53, nome: 'Fortaleza' },
  'REC': { lat: -8.13, lng: -34.92, nome: 'Recife' },
  'SSA': { lat: -12.91, lng: -38.32, nome: 'Salvador' },
  'GYN': { lat: -16.63, lng: -49.22, nome: 'Goiânia' },
  'CGB': { lat: -15.65, lng: -56.12, nome: 'Cuiabá' },
  'CGR': { lat: -20.47, lng: -54.67, nome: 'Campo Grande' },
  'MAO': { lat: -3.04, lng: -60.05, nome: 'Manaus' },
  'BHZ': { lat: -19.84, lng: -43.95, nome: 'Belo Horizonte' },
  'FLN': { lat: -27.67, lng: -48.55, nome: 'Florianópolis' },
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

function lookupCidade(codeOrNome: string): { lat: number; lng: number } | null {
  const k = codeOrNome.trim().toUpperCase()
  if (CAPITAIS_COORD[k]) return CAPITAIS_COORD[k]
  // Busca por nome aproximado
  for (const [, v] of Object.entries(CAPITAIS_COORD)) {
    if (v.nome.toUpperCase().includes(k) || k.includes(v.nome.toUpperCase().split(' ')[0])) {
      return v
    }
  }
  return null
}

function fatorAereoPorKm(km: number, classe?: ClasseAerea, internacional?: boolean): number {
  // kg CO₂e por passageiro · km
  const isExec = classe === 'Executiva' || classe === 'Primeira'
  const isPrimeira = classe === 'Primeira'
  const isPremium = classe === 'Econômica Premium'

  if (km < 463) {
    return isExec ? 0.382 : 0.255
  }
  if (km < 3700 && !internacional) {
    if (isPrimeira) return 0.435
    if (isExec) return 0.234
    if (isPremium) return 0.195
    return 0.156
  }
  // Longa / internacional
  if (isPrimeira) return 0.580
  if (isExec) return 0.435
  if (isPremium) return 0.225
  return 0.150
}

export function calcularCO2Aereo(args: {
  origem?: string
  destino?: string
  classe?: ClasseAerea
  internacional?: boolean
  pax?: number
  ida_volta?: boolean
}): PegadaCarbono {
  const pax = args.pax || 1
  const ida_volta = args.ida_volta !== false

  const a = args.origem ? lookupCidade(args.origem) : null
  const b = args.destino ? lookupCidade(args.destino) : null

  let km = 0
  if (a && b) {
    km = haversineKm(a, b)
  } else if (args.internacional) {
    km = 7000 // estimativa default vôo internacional
  } else {
    km = 1500 // estimativa default doméstico
  }

  const trechos = ida_volta ? 2 : 1
  const fator = fatorAereoPorKm(km, args.classe, args.internacional)
  const kg_co2 = km * trechos * pax * fator

  return {
    tipo: 'Aéreo',
    kg_co2: Math.round(kg_co2 * 10) / 10,
    metodo: a && b ? 'estimativa_distancia' : 'fator_padrao',
    detalhes: { km: Math.round(km), classe: args.classe, fator_kg_per_unit: fator },
  }
}

export function calcularCO2Hotel(args: { noites?: number; estrelas?: number; pax?: number }): PegadaCarbono {
  const noites = args.noites || 1
  const pax = args.pax || 1
  const estrelas = args.estrelas || 4
  // Tabela kg CO₂e por noite/quarto, BR
  const fator =
    estrelas <= 2 ? 14 :
    estrelas === 3 ? 18 :
    estrelas === 4 ? 25 :
    32 // 5★+

  const kg_co2 = noites * fator * Math.max(1, Math.ceil(pax / 2))
  return {
    tipo: 'Hotel',
    kg_co2: Math.round(kg_co2 * 10) / 10,
    metodo: 'fator_padrao',
    detalhes: { noites, fator_kg_per_unit: fator },
  }
}

export function calcularCO2Carro(args: { dias?: number; km_dia?: number }): PegadaCarbono {
  const dias = args.dias || 1
  const km_dia = args.km_dia || 200
  const fator = 0.171 // DEFRA médio
  const kg_co2 = dias * km_dia * fator
  return {
    tipo: 'Carro',
    kg_co2: Math.round(kg_co2 * 10) / 10,
    metodo: 'fator_padrao',
    detalhes: { km: dias * km_dia, fator_kg_per_unit: fator },
  }
}

// ============================================================
// Cálculo a partir de um Atendimento ou Voucher
// ============================================================

export function calcularPegadaAtendimento(a: Atendimento): PegadaCarbono | null {
  if (a.tipo_servico === 'Aéreo' && a.detalhes_aereo) {
    return {
      ...calcularCO2Aereo({
        origem: a.detalhes_aereo.origem,
        destino: a.detalhes_aereo.destino,
        classe: a.detalhes_aereo.classe,
        internacional: a.detalhes_aereo.internacional,
        ida_volta: !!a.detalhes_aereo.data_volta,
      }),
      atendimento_id: a.id,
    }
  }
  if (a.tipo_servico === 'Hotel' && a.detalhes_hotel) {
    return {
      ...calcularCO2Hotel({
        noites: a.detalhes_hotel.noites,
        pax: a.detalhes_hotel.num_hospedes,
      }),
      atendimento_id: a.id,
    }
  }
  if (a.tipo_servico === 'Carro' && a.detalhes_carro) {
    let dias = 1
    if (a.detalhes_carro.data_retirada && a.detalhes_carro.data_devolucao) {
      const d1 = new Date(a.detalhes_carro.data_retirada).getTime()
      const d2 = new Date(a.detalhes_carro.data_devolucao).getTime()
      dias = Math.max(1, Math.round((d2 - d1) / 86400000))
    }
    return { ...calcularCO2Carro({ dias }), atendimento_id: a.id }
  }
  return null
}

export function calcularPegadaVoucher(v: VoucherEmitido): PegadaCarbono | null {
  if (v.tipo === 'Hotel') {
    const noites = (v as any).noites || (v as any).num_noites || 1
    return {
      ...calcularCO2Hotel({ noites }),
      voucher_id: v.id,
    }
  }
  if (v.tipo === 'Aéreo') {
    return {
      ...calcularCO2Aereo({}),
      voucher_id: v.id,
    }
  }
  if (v.tipo === 'Carro') {
    return { ...calcularCO2Carro({}), voucher_id: v.id }
  }
  return null
}

// ============================================================
// Equivalências amigáveis para relatório ESG
// ============================================================

export function arvoresEquivalentes(kgCO2: number): number {
  // 1 árvore tropical absorve ~22 kg CO₂/ano
  return Math.round((kgCO2 / 22) * 10) / 10
}

export function carrosEquivalentes(kgCO2: number): number {
  // 1 carro médio emite ~4600 kg CO₂/ano
  return Math.round((kgCO2 / 4600) * 100) / 100
}

export function formatarKg(kg: number): string {
  if (kg < 1000) return `${kg.toFixed(1)} kg`
  return `${(kg / 1000).toFixed(2)} t`
}

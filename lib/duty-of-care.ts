// ============================================================
// DUTY OF CARE — V13
//
// Rastreia viajantes em campo (entre check-in e check-out, ou em
// período de viagem aérea), calcula nível de risco e emite alertas.
//
// Inspirado em: SAP Concur Risk Messaging, Egencia Traveler Tracking,
// Navan Trip Tracker.
//
// Avaliação de risco é simples e local: usa data atual + alertas
// operacionais existentes. Pode ser estendido com integração de feed
// externo (ISOS, Riskline) no futuro.
// ============================================================

import type {
  Atendimento,
  NivelRisco,
  StatusViajante,
  TipoServico,
  ViajanteEmCampo,
  VoucherEmitido,
} from '@/types'

function diffDays(aIso: string, bIso: string): number {
  return Math.floor(
    (new Date(aIso).getTime() - new Date(bIso).getTime()) / 86400000,
  )
}

function statusEmCampo(inicio: string, fim: string): StatusViajante {
  const hoje = new Date()
  const i = new Date(inicio)
  const f = new Date(fim)
  if (hoje < i) return 'planejada'
  if (hoje > f) return 'concluida'
  return 'em_viagem'
}

// Cidades brasileiras com risco elevado segundo índices urbanos públicos
// (lista enxuta, ilustrativa — pode ser substituída por feed externo)
const RISCO_DESTINO: Record<string, NivelRisco> = {
  'rio de janeiro': 'moderado',
  'salvador': 'moderado',
  'manaus': 'moderado',
  'são luís': 'moderado',
  'fortaleza': 'moderado',
}

// Países com nível de risco para viagens corporativas (DFAT/UK FCO style)
const RISCO_PAIS: Record<string, NivelRisco> = {
  'venezuela': 'alto',
  'ucrânia': 'critico',
  'russia': 'alto',
  'rússia': 'alto',
  'haiti': 'critico',
  'sudão': 'critico',
  'iraque': 'alto',
  'iran': 'alto',
  'irã': 'alto',
  'siria': 'critico',
  'síria': 'critico',
  'afeganistão': 'critico',
}

function calcularRisco(args: {
  destino: string
  pais?: string
  status: StatusViajante
  alertas: string[]
}): NivelRisco {
  let risco: NivelRisco = 'baixo'

  const destLower = (args.destino || '').toLowerCase()
  for (const [k, v] of Object.entries(RISCO_DESTINO)) {
    if (destLower.includes(k)) {
      risco = v
      break
    }
  }

  if (args.pais) {
    const paisLower = args.pais.toLowerCase()
    for (const [k, v] of Object.entries(RISCO_PAIS)) {
      if (paisLower.includes(k)) {
        risco = pioresca(risco, v)
        break
      }
    }
  }

  // Alertas operacionais elevam risco
  if (args.alertas.length >= 3) risco = pioresca(risco, 'alto')
  else if (args.alertas.length >= 1) risco = pioresca(risco, 'moderado')

  return risco
}

function pioresca(a: NivelRisco, b: NivelRisco): NivelRisco {
  const ordem: Record<NivelRisco, number> = { baixo: 1, moderado: 2, alto: 3, critico: 4 }
  return ordem[a] > ordem[b] ? a : b
}

// ============================================================
// Construção da lista de viajantes em campo
// ============================================================

export function listarViajantes(args: {
  atendimentos: Atendimento[]
  vouchers: VoucherEmitido[]
  empresas?: { id: string; nome: string }[]
  apenasEmCampo?: boolean
}): ViajanteEmCampo[] {
  const empresasById = new Map((args.empresas || []).map((e) => [e.id, e.nome]))
  const result: ViajanteEmCampo[] = []

  // Vouchers emitidos têm dados mais confiáveis (datas firmadas)
  for (const v of args.vouchers) {
    if (v.status === 'cancelado') continue
    const inicio = (v as any).data_checkin || (v as any).data_ida || (v as any).data_inicio
    const fim = (v as any).data_checkout || (v as any).data_volta || (v as any).data_fim
    if (!inicio || !fim) continue

    const status = statusEmCampo(inicio, fim)
    const alertas: string[] = []

    if (status === 'em_viagem' && diffDays(fim, new Date().toISOString()) <= 1) {
      alertas.push('Encerra em até 24h')
    }

    const destino =
      (v as any).hotel_cidade ||
      (v as any).destino ||
      (v as any).cidade ||
      (v as any).hotel_nome ||
      'Destino não informado'

    const pais = (v as any).pais

    const risco = calcularRisco({ destino, pais, status, alertas })

    const item: ViajanteEmCampo = {
      voucher_id: v.id,
      atendimento_id: (v as any).atendimento_id,
      funcionario_id: (v as any).funcionario_id || null,
      passageiro_nome: v.passageiro_nome || (v as any).hospede_nome || 'Sem nome',
      empresa_id: (v as any).empresa_id,
      empresa_nome:
        (v as any).empresa_nome ||
        ((v as any).empresa_id ? empresasById.get((v as any).empresa_id) : undefined),
      tipo: (v.tipo as TipoServico) || 'Outro',
      destino,
      uf: (v as any).uf,
      pais,
      inicio,
      fim,
      status,
      risco,
      alertas,
      contato: (v as any).passageiro_contato,
    }
    result.push(item)
  }

  if (args.apenasEmCampo) {
    return result.filter((r) => r.status === 'em_viagem')
  }
  return result.sort((a, b) => a.inicio.localeCompare(b.inicio))
}

// ============================================================
// Métricas para a página de risco
// ============================================================

export function metricasViajantes(lista: ViajanteEmCampo[]) {
  const emCampo = lista.filter((v) => v.status === 'em_viagem')
  const proximas7d = lista.filter(
    (v) =>
      v.status === 'planejada' &&
      diffDays(v.inicio, new Date().toISOString()) <= 7,
  )
  const criticos = lista.filter((v) => v.risco === 'critico' || v.risco === 'alto')

  const porPais = new Map<string, number>()
  for (const v of emCampo) {
    const pais = v.pais || 'Brasil'
    porPais.set(pais, (porPais.get(pais) || 0) + 1)
  }

  const porUf = new Map<string, number>()
  for (const v of emCampo) {
    if (v.uf) porUf.set(v.uf, (porUf.get(v.uf) || 0) + 1)
  }

  return {
    em_campo: emCampo.length,
    proximas_7d: proximas7d.length,
    risco_alto_ou_critico: criticos.length,
    distribuicao_paises: Array.from(porPais.entries())
      .map(([pais, qtd]) => ({ pais, qtd }))
      .sort((a, b) => b.qtd - a.qtd),
    distribuicao_ufs: Array.from(porUf.entries())
      .map(([uf, qtd]) => ({ uf, qtd }))
      .sort((a, b) => b.qtd - a.qtd),
  }
}

export function rotuloRisco(r: NivelRisco): string {
  switch (r) {
    case 'baixo': return 'Baixo'
    case 'moderado': return 'Moderado'
    case 'alto': return 'Alto'
    case 'critico': return 'Crítico'
  }
}

export function corRisco(r: NivelRisco): string {
  switch (r) {
    case 'baixo': return 'green'
    case 'moderado': return 'amber'
    case 'alto': return 'orange'
    case 'critico': return 'red'
  }
}

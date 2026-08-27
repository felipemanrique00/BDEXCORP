import type { TipoServico, VoucherTipo } from '@/types'

import type { OfflineTravelService } from './schema'

export interface OfflineServiceCapabilities {
  demand: boolean
  quote: boolean
  formalChoice: boolean
  approvalSummary: boolean
  reservation: boolean
  issuance: boolean
  voucher: boolean
}

export interface OfflineServiceDefinition {
  key: OfflineTravelService
  relationalCode: string
  label: string
  shortLabel: string
  capabilities: OfflineServiceCapabilities
}

const LABELS: Record<OfflineTravelService, string> = {
  aereo: 'Aéreo',
  hotelaria: 'Hotelaria',
  locacao: 'Locação de veículo',
  rodoviario: 'Rodoviário',
  ferroviario: 'Ferroviário',
  transfer: 'Transfer',
  seguro: 'Seguro viagem',
  pacotes: 'Pacote',
  lazer: 'Lazer',
  maritimo: 'Marítimo',
  outros: 'Outro serviço',
}

const SEGMENT_TYPES: Record<OfflineTravelService, string> = {
  aereo: 'air',
  hotelaria: 'hotel',
  locacao: 'car',
  rodoviario: 'bus',
  ferroviario: 'rail',
  transfer: 'transfer',
  seguro: 'insurance',
  pacotes: 'package',
  lazer: 'leisure',
  maritimo: 'maritime',
  outros: 'service',
}

const VOUCHER_TYPES: Record<OfflineTravelService, VoucherTipo> = {
  aereo: 'Aéreo',
  hotelaria: 'Hotel',
  locacao: 'Carro',
  rodoviario: 'Rodoviário',
  ferroviario: 'Ferroviário',
  transfer: 'Transfer',
  seguro: 'Seguro',
  pacotes: 'Pacote',
  lazer: 'Lazer',
  maritimo: 'Marítimo',
  outros: 'Serviço',
}

const RELATIONAL_CODES: Record<OfflineTravelService, string> = {
  aereo: 'air',
  hotelaria: 'hotel',
  locacao: 'car',
  rodoviario: 'bus',
  ferroviario: 'rail',
  transfer: 'transfer',
  seguro: 'insurance',
  pacotes: 'package',
  lazer: 'leisure',
  maritimo: 'maritime',
  outros: 'other',
}

const COMPLETE: OfflineServiceCapabilities = {
  demand: true,
  quote: true,
  formalChoice: true,
  approvalSummary: true,
  reservation: true,
  issuance: true,
  voucher: true,
}

const OPERATION_ONLY: OfflineServiceCapabilities = {
  demand: true,
  quote: false,
  formalChoice: false,
  approvalSummary: false,
  reservation: true,
  issuance: true,
  voucher: true,
}

export const OFFLINE_SERVICE_DEFINITIONS: readonly OfflineServiceDefinition[] = [
  { key: 'hotelaria', relationalCode: 'hotel', label: LABELS.hotelaria, shortLabel: 'Hotel', capabilities: COMPLETE },
  { key: 'aereo', relationalCode: 'air', label: LABELS.aereo, shortLabel: 'Aéreo', capabilities: COMPLETE },
  { key: 'locacao', relationalCode: 'car', label: LABELS.locacao, shortLabel: 'Carro', capabilities: COMPLETE },
  { key: 'rodoviario', relationalCode: 'bus', label: LABELS.rodoviario, shortLabel: 'Rodoviário', capabilities: COMPLETE },
  { key: 'transfer', relationalCode: 'transfer', label: LABELS.transfer, shortLabel: 'Transfer', capabilities: OPERATION_ONLY },
  { key: 'seguro', relationalCode: 'insurance', label: LABELS.seguro, shortLabel: 'Seguro', capabilities: OPERATION_ONLY },
  { key: 'ferroviario', relationalCode: 'rail', label: LABELS.ferroviario, shortLabel: 'Ferroviário', capabilities: OPERATION_ONLY },
  { key: 'pacotes', relationalCode: 'package', label: LABELS.pacotes, shortLabel: 'Pacote', capabilities: OPERATION_ONLY },
  { key: 'lazer', relationalCode: 'leisure', label: LABELS.lazer, shortLabel: 'Lazer', capabilities: OPERATION_ONLY },
  { key: 'maritimo', relationalCode: 'maritime', label: LABELS.maritimo, shortLabel: 'Marítimo', capabilities: OPERATION_ONLY },
  { key: 'outros', relationalCode: 'other', label: LABELS.outros, shortLabel: 'Outros', capabilities: OPERATION_ONLY },
] as const

const SERVICE_BY_KEY = new Map(OFFLINE_SERVICE_DEFINITIONS.map((item) => [item.key, item]))
const SERVICE_BY_RELATIONAL_CODE = new Map(OFFLINE_SERVICE_DEFINITIONS.map((item) => [item.relationalCode, item]))

export function offlineServiceLabel(service: OfflineTravelService): string {
  return LABELS[service]
}

export function offlineSegmentType(service: OfflineTravelService): string {
  return SEGMENT_TYPES[service]
}

export function offlineVoucherType(service: OfflineTravelService): VoucherTipo {
  return VOUCHER_TYPES[service]
}

export function offlineServiceDefinition(service: OfflineTravelService): OfflineServiceDefinition {
  return SERVICE_BY_KEY.get(service)!
}

export function offlineServiceFromDemand(value: string): OfflineTravelService | null {
  const normalized = normalizeService(value)
  if (!normalized) return null
  const relational = SERVICE_BY_RELATIONAL_CODE.get(normalized)
  if (relational) return relational.key

  const aliases: Array<[OfflineTravelService, readonly string[]]> = [
    ['aereo', ['aereo', 'voo', 'passagem aerea']],
    ['hotelaria', ['hotel', 'hotelaria', 'hospedagem']],
    ['locacao', ['carro', 'locacao', 'aluguel de carro']],
    ['rodoviario', ['rodoviario', 'onibus']],
    ['ferroviario', ['ferroviario', 'trem']],
    ['transfer', ['transfer', 'traslado']],
    ['seguro', ['seguro', 'seguro viagem']],
    ['pacotes', ['pacote', 'pacotes']],
    ['lazer', ['lazer', 'evento', 'ingresso']],
    ['maritimo', ['maritimo', 'navio', 'cruzeiro']],
    ['outros', ['outro', 'outros']],
  ]
  return aliases.find(([, values]) => values.includes(normalized))?.[0] || null
}

/**
 * Mantém a fronteira com as telas legadas tipada e localizada. O domínio
 * relacional usa códigos como `air` e `hotel`; `Atendimento` ainda espera os
 * rótulos de `TipoServico`.
 */
export function offlineLegacyServiceType(value: string): TipoServico {
  const service = offlineServiceFromDemand(value)
  if (service === 'aereo') return 'Aéreo'
  if (service === 'hotelaria') return 'Hotel'
  if (service === 'locacao') return 'Carro'
  if (service === 'rodoviario') return 'Rodoviário'
  if (service === 'pacotes' || service === 'lazer' || service === 'transfer' || service === 'seguro') {
    return 'Pacote'
  }
  return 'Outro'
}

function normalizeService(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

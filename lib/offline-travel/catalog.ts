import type { VoucherTipo } from '@/types'

import type { OfflineTravelService } from './schema'

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

export function offlineServiceLabel(service: OfflineTravelService): string {
  return LABELS[service]
}

export function offlineSegmentType(service: OfflineTravelService): string {
  return SEGMENT_TYPES[service]
}

export function offlineVoucherType(service: OfflineTravelService): VoucherTipo {
  return VOUCHER_TYPES[service]
}

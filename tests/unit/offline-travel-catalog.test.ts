import { describe, expect, it } from 'vitest'

import {
  OFFLINE_SERVICE_DEFINITIONS,
  offlineLegacyServiceType,
  offlineSegmentType,
  offlineServiceDefinition,
  offlineServiceFromDemand,
  offlineServiceLabel,
  offlineVoucherType,
} from '@/lib/offline-travel/catalog'
import {
  OFFLINE_TRAVEL_PROVIDER,
  OFFLINE_TRAVEL_SERVICES,
  type OfflineTravelService,
} from '@/lib/offline-travel/schema'
import { VOUCHER_PREFIX, type VoucherTipo } from '@/types'

const EXPECTED_MAPPINGS: Array<{
  service: OfflineTravelService
  segment: string
  voucher: VoucherTipo
  prefix: string
}> = [
  { service: 'aereo', segment: 'air', voucher: 'Aéreo', prefix: 'A' },
  { service: 'hotelaria', segment: 'hotel', voucher: 'Hotel', prefix: 'H' },
  { service: 'locacao', segment: 'car', voucher: 'Carro', prefix: 'C' },
  { service: 'rodoviario', segment: 'bus', voucher: 'Rodoviário', prefix: 'R' },
  { service: 'ferroviario', segment: 'rail', voucher: 'Ferroviário', prefix: 'F' },
  { service: 'transfer', segment: 'transfer', voucher: 'Transfer', prefix: 'T' },
  { service: 'seguro', segment: 'insurance', voucher: 'Seguro', prefix: 'S' },
  { service: 'pacotes', segment: 'package', voucher: 'Pacote', prefix: 'P' },
  { service: 'lazer', segment: 'leisure', voucher: 'Lazer', prefix: 'L' },
  { service: 'maritimo', segment: 'maritime', voucher: 'Marítimo', prefix: 'M' },
  { service: 'outros', segment: 'service', voucher: 'Serviço', prefix: 'O' },
]

describe('offline travel catalog', () => {
  it('uses a stable provider key for relational reservations and emissions', () => {
    expect(OFFLINE_TRAVEL_PROVIDER).toBe('manual-offline')
  })

  it('has exactly one complete mapping for every supported service', () => {
    expect(EXPECTED_MAPPINGS.map((item) => item.service)).toEqual([...OFFLINE_TRAVEL_SERVICES])
    expect(new Set(EXPECTED_MAPPINGS.map((item) => item.segment)).size).toBe(11)
  })

  it.each(EXPECTED_MAPPINGS)(
    'maps $service to segment $segment and voucher $voucher',
    ({ service, segment, voucher, prefix }) => {
      expect(offlineServiceLabel(service).trim().length).toBeGreaterThan(2)
      expect(offlineSegmentType(service)).toBe(segment)
      expect(offlineSegmentType(service)).toMatch(/^[a-z][a-z0-9_]{1,39}$/)
      expect(offlineVoucherType(service)).toBe(voucher)
      expect(VOUCHER_PREFIX[offlineVoucherType(service)]).toBe(prefix)
    },
  )

  it('centralizes relational demand codes and module capabilities', () => {
    expect(OFFLINE_SERVICE_DEFINITIONS).toHaveLength(OFFLINE_TRAVEL_SERVICES.length)
    expect(offlineServiceFromDemand('air')).toBe('aereo')
    expect(offlineServiceFromDemand('Aéreo')).toBe('aereo')
    expect(offlineServiceFromDemand('car')).toBe('locacao')
    expect(offlineServiceFromDemand('bus')).toBe('rodoviario')
    expect(offlineLegacyServiceType('air')).toBe('Aéreo')
    expect(offlineLegacyServiceType('hotel')).toBe('Hotel')
    expect(offlineLegacyServiceType('car')).toBe('Carro')
    expect(offlineLegacyServiceType('transfer')).toBe('Pacote')
    expect(offlineLegacyServiceType('bus')).toBe('Rodoviário')
    expect(offlineServiceDefinition('hotelaria').capabilities.formalChoice).toBe(true)
    expect(offlineServiceDefinition('aereo').capabilities.formalChoice).toBe(true)
    expect(offlineServiceDefinition('locacao').capabilities.formalChoice).toBe(true)
    expect(offlineServiceDefinition('rodoviario').capabilities.formalChoice).toBe(true)
    expect(offlineServiceDefinition('transfer').capabilities.formalChoice).toBe(false)
  })
})

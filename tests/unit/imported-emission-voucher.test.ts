import { describe, expect, it } from 'vitest'

import {
  voucherFromImportedEmission,
  type ImportedEmissionVoucherLine,
} from '@/lib/emissions/imported-emission-voucher'
import type { TechEmissionRecord } from '@/lib/integrations/tech/tech-emissions-types'
import type { Atendimento } from '@/types'

const demand = {
  id: 'demand-01',
  empresa_id: 'company-01',
} as Atendimento

const actor = {
  id: 'user-01',
  name: 'Operador BBT',
}

function techEmission(overrides: Partial<TechEmissionRecord> = {}): TechEmissionRecord {
  return {
    externalId: 'tech-emission-01',
    saleNumber: 'SALE-01',
    agencyName: 'BBT',
    clientName: 'Empresa Alfa',
    osNumber: 'OS-001',
    passengerName: 'Aldo Fernandes Junior',
    service: 'Aéreo',
    locator: 'ABC123',
    supplier: 'Companhia Aerea',
    customerFare: 1_000,
    customerTaxes: 100,
    customerTotal: 1_100,
    supplierFare: 900,
    supplierTaxes: 100,
    supplierTotal: 1_000,
    costCenter: 'COMERCIAL',
    issuedAt: '2026-07-20T12:00:00.000Z',
    cancelled: false,
    reservationCancelled: false,
    ticketCancelled: false,
    segments: [{
      origin: 'GYN',
      destination: 'GRU',
      departureAt: '2026-08-02T10:00:00.000Z',
      flightNumber: 'BBT123',
    }],
    ...overrides,
  }
}

function importedLine(overrides: Partial<ImportedEmissionVoucherLine> = {}): ImportedEmissionVoucherLine {
  const tech = techEmission()
  return {
    venda_numero: tech.saleNumber,
    data_venda: '2026-07-20',
    passageiro: tech.passengerName,
    tipo_servico: tech.service,
    total: tech.customerTotal,
    status: 'CF',
    produto: tech.supplier,
    tech,
    ...overrides,
  }
}

describe('imported emission voucher', () => {
  it('keeps a stable identity across retries and links the relational demand', () => {
    const first = voucherFromImportedEmission(
      importedLine(),
      demand,
      'employee-01',
      'tech',
      actor,
      new Date('2026-07-20T13:00:00.000Z'),
    )
    const replay = voucherFromImportedEmission(
      importedLine(),
      demand,
      'employee-01',
      'tech',
      actor,
      new Date('2026-07-21T13:00:00.000Z'),
    )

    expect(replay.id).toBe(first.id)
    expect(replay.fingerprint).toBe(first.fingerprint)
    expect(first).toMatchObject({
      atendimento_id: 'demand-01',
      empresa_id: 'company-01',
      funcionario_id: 'employee-01',
      tipo: 'Aéreo',
      status: 'confirmado',
      localizador: 'ABC123',
      numero_solicitacao: 'OS-001',
    })
  })

  it('keeps cancellation authoritative even when the source status is confirmed', () => {
    const line = importedLine({
      tech: techEmission({ cancelled: true }),
      status: 'CF',
    })

    const voucher = voucherFromImportedEmission(line, demand, null, 'tech', actor)

    expect(voucher.status).toBe('cancelado')
  })

  it('maps real hotel dates and daily rate without inventing reservation data', () => {
    const hotel = techEmission({
      service: 'Hotel',
      supplier: 'Hotel Central',
      locator: undefined,
      ticket: undefined,
      hotelDailyRate: 450,
      segments: [{
        origin: 'GYN',
        destination: 'BSB',
        departureAt: '2026-08-02T14:00:00.000Z',
        arrivalAt: '2026-08-05T11:00:00.000Z',
      }],
    })
    const line = importedLine({
      tipo_servico: 'Hotel',
      produto: hotel.supplier,
      status: 'EM',
      tech: hotel,
    })

    const voucher = voucherFromImportedEmission(line, demand, null, 'tech', actor)

    expect(voucher).toMatchObject({
      tipo: 'Hotel',
      status: 'emitido',
      data_checkin: '2026-08-02',
      data_checkout: '2026-08-05',
      valor_diaria: 450,
    })
  })
})
